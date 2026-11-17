/**
 * Style DNA in the benchmark manifest, and the composition of a dataset.
 *
 * A manifest may carry an invented Style DNA profile per case, so that the
 * personalised path can be evaluated. It may never carry a real person's
 * profile. A dataset is described by its CASES and its IMAGES separately,
 * because only cases are units of evidence.
 *
 * No network access. Every profile here is an invented test input.
 */

import { describe, expect, it, jest } from '@jest/globals'

jest.mock('server-only', () => ({}), { virtual: true })

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  MIN_CASES_PER_MODE,
  compositionLines,
  describeComposition,
  manifestSchema,
  plannedWorstCaseMicroUsd,
  runCases,
  type AnalyzeFn,
  type BenchmarkCase,
  type PreparedCase,
  type RunOptions,
} from '@/benchmark/harness'
import { MIN_SAMPLE } from '@/evaluation/quality'
import { createRecorder, datasetFingerprint } from '@/evaluation/recording'
import { validateAIStyleProfile } from '@/lib/services/openai/aiStyleProfileSchema'
import { buildUserContext } from '@/lib/services/openai/openAIAnalysisService'
import { MAX_AI_STYLE_PROFILE_BYTES } from '@/lib/services/requestLimits'
import { allRated, makePng } from '../helpers/fixtures'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const personas = require('../../scripts/evaluation/style-dna-personas.cjs') as { PERSONAS: Record<string, Record<string, unknown>>; AESTHETIC_ONLY: string[]; styleDna: (persona: string) => { source: string; persona: string; profile: Record<string, unknown> } }

const root = process.cwd()
const options: RunOptions = { model: 'gpt-6.1-terra', reasoningEffort: 'low', maxOutputTokens: 4_000, runsPerCase: 1, maxUsd: 5 }

function rawCase(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, category: 'clear', description: 'Test fixture: no image exists.', source: 'synthetic', photo: `${id}/photo.jpg`, garment: `${id}/garment-1.jpg`, occasion: 'Office Work', expected: {}, ...extra }
}

function parse(cases: Array<Record<string, unknown>>): BenchmarkCase[] {
  return manifestSchema.parse({ version: 1, cases }).cases
}

describe('the persona library', () => {
  it('holds only profiles the application would accept, each well inside the size limit', () => {
    expect(Object.keys(personas.PERSONAS).length).toBeGreaterThanOrEqual(4)
    for (const [name, profile] of Object.entries(personas.PERSONAS)) {
      expect(() => validateAIStyleProfile(profile)).not.toThrow()
      expect({ name, bytes: Buffer.byteLength(JSON.stringify(profile)) < MAX_AI_STYLE_PROFILE_BYTES / 2 }).toEqual({ name, bytes: true })
    }
  })

  it('says of every profile that it is invented, and carries no free text about a person', () => {
    for (const profile of Object.values(personas.PERSONAS)) {
      const notes = profile.analysis_notes as { confidence_summary: string }
      expect(notes.confidence_summary).toBe('Invented profile for evaluation. It does not describe any real person.')
      expect((profile.wardrobe_context as Record<string, unknown>)).toEqual({ visible_garment_notes: null, color_palette_notes: null })
      expect((profile.proportions as Record<string, unknown>).visible_posture_notes).toBeNull()
    }
  })

  it('keeps colouring and proportions empty in the personas meant for real photos', () => {
    expect(personas.AESTHETIC_ONLY.length).toBeGreaterThanOrEqual(2)
    for (const name of personas.AESTHETIC_ONLY) {
      const profile = personas.PERSONAS[name] as { coloring: Record<string, unknown>; proportions: Record<string, unknown> }
      const stated = [...Object.entries(profile.coloring), ...Object.entries(profile.proportions)].filter(([key, value]) => key !== 'confidence' && value !== null)
      expect({ name, stated }).toEqual({ name, stated: [] })
      // So the request says nothing about the person's colouring or build: only the style lines are added.
      const context = buildUserContext('Office Work', { preferredStyles: [], favoriteColors: [], occasionPreferences: [] }, validateAIStyleProfile(profile))
      expect(context).toContain('Style DNA aesthetic (for style_preference_match)')
      expect(context).not.toContain('Style DNA coloring (for color)')
      expect(context).not.toContain('Style DNA proportions')
    }
  })
})

describe('Style DNA in a manifest', () => {
  it('accepts an invented profile and keeps it exactly as written', () => {
    const [benchmarkCase] = parse([rawCase('a', { style_dna: personas.styleDna('persona-classic-tailored') })])
    expect(benchmarkCase.style_dna).toEqual({ source: 'synthetic', persona: 'persona-classic-tailored', profile: personas.PERSONAS['persona-classic-tailored'] })
  })

  it.each([
    ['a profile marked as a user profile', (dna: Record<string, unknown>) => ({ ...dna, source: 'user' })],
    ['a profile marked as owned', (dna: Record<string, unknown>) => ({ ...dna, source: 'owned' })],
    ['a profile with no source', ({ source: _source, ...dna }: Record<string, unknown>) => dna],
    ['a profile that is not complete', (dna: Record<string, unknown>) => ({ ...dna, profile: { schema_version: '1.0', status: 'unable_to_generate', reason: 'x', next_step: 'y', confidence: 'Low' } })],
    ['a profile with an unknown field', (dna: Record<string, unknown>) => ({ ...dna, profile: { ...(dna.profile as object), user_id: 'u-1' } })],
    ['an unknown field next to the profile', (dna: Record<string, unknown>) => ({ ...dna, email: 'someone@example.com' })],
    ['a persona name that is not an identifier', (dna: Record<string, unknown>) => ({ ...dna, persona: 'Jane Doe' })],
  ])('rejects %s', (_label, change) => {
    expect(() => parse([rawCase('a', { style_dna: change(personas.styleDna('persona-classic-tailored')) })])).toThrow()
  })

  it('rejects a profile larger than the application accepts', () => {
    const dna = personas.styleDna('persona-classic-tailored')
    const analysisNotes = dna.profile.analysis_notes as { visibility_limitations: string[] }
    analysisNotes.visibility_limitations = Array.from({ length: 5 }, () => 'x'.repeat(2_000))
    expect(() => parse([rawCase('a', { style_dna: dna })])).toThrow(/larger than the 8192 bytes/)
  })

  it('rejects one persona that is described differently in two cases', () => {
    const changed = personas.styleDna('persona-classic-tailored')
    ;(changed.profile.coloring as Record<string, unknown>).hair_color = 'red'
    expect(() => parse([rawCase('a', { style_dna: personas.styleDna('persona-classic-tailored') }), rawCase('b', { style_dna: changed })])).toThrow(/different profile/)
  })

  it('accepts the same persona written with its keys in another order', () => {
    const reorder = (value: unknown): unknown => (Array.isArray(value) ? value.map(reorder) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value as object).reverse().map(([key, entry]) => [key, reorder(entry)])) : value)
    const reversed = personas.styleDna('persona-classic-tailored')
    reversed.profile = reorder(reversed.profile) as Record<string, unknown>
    expect(JSON.stringify(reversed.profile)).not.toBe(JSON.stringify(personas.PERSONAS['persona-classic-tailored']))
    expect(() => parse([rawCase('a', { style_dna: personas.styleDna('persona-classic-tailored') }), rawCase('b', { style_dna: reversed })])).not.toThrow()
  })

  it('is optional and has no default, so a manifest without it keeps its fingerprint', () => {
    const [benchmarkCase] = parse([rawCase('a')])
    expect(Object.prototype.hasOwnProperty.call(benchmarkCase, 'style_dna')).toBe(false)
    // The scenario dataset that existed before this field was added still has the fingerprint its baseline records.
    const v1 = manifestSchema.parse(JSON.parse(readFileSync(path.join(root, 'evaluation', 'datasets', 'scenarios-v1', 'cases.json'), 'utf8'))).cases
    expect(datasetFingerprint(v1)).toBe('356564d74840')
  })
})

describe('Style DNA in a benchmark run', () => {
  const prepared = (cases: BenchmarkCase[]): PreparedCase[] => cases.map((benchmarkCase) => ({ benchmarkCase, photo: makePng(), garment: makePng() }))

  it('reaches the analysis only for the cases that carry it', async () => {
    const cases = parse([rawCase('with-dna', { style_dna: personas.styleDna('persona-minimal-aesthetic') }), rawCase('without-dna')])
    const seen: Record<string, unknown> = {}
    const analyze: AnalyzeFn = async (input) => {
      seen[input.caseId] = input.aiStyleProfile
      expect(Object.prototype.hasOwnProperty.call(input, 'aiStyleProfile')).toBe(input.caseId === 'with-dna')
      return { status: 'complete', dimensions: allRated('Good') }
    }
    await runCases(prepared(cases), options, analyze)
    expect(seen['with-dna']).toEqual(personas.PERSONAS['persona-minimal-aesthetic'])
    expect(seen['without-dna']).toBeUndefined()
  })

  it('is not written into a recording: a recording holds outputs, never inputs', async () => {
    const cases = parse([rawCase('with-dna', { style_dna: personas.styleDna('persona-classic-tailored') })])
    const recorder = createRecorder({ options, promptVersion: 'aaaaaaaaaaaa', schemaVersion: 'analysis-output/2', cases })
    await runCases(prepared(cases), options, recorder.wrap(async () => ({ status: 'complete', dimensions: allRated('Good') })))
    const text = JSON.stringify(recorder.recording())
    for (const fragment of ['persona-classic-tailored', 'skin_tone', 'hair_color', 'dark brown']) expect(text).not.toContain(fragment)
  })

  it('does not change the worst-case cost of a case: the reservation depends on images, not on the profile', () => {
    const [plain] = parse([rawCase('a')])
    const [withDna] = parse([rawCase('a', { style_dna: personas.styleDna('persona-classic-tailored') })])
    expect(plannedWorstCaseMicroUsd([withDna], options)).toBe(plannedWorstCaseMicroUsd([plain], options))
  })
})

describe('dataset composition', () => {
  const cases = parse([
    rawCase('s1'),
    rawCase('s2', { style_dna: personas.styleDna('persona-minimal-aesthetic') }),
    // Two cases that share every file: the same garment once as one photo and once as two views.
    rawCase('pair-single', { photo: 'g/photo.jpg', garment: 'g/front.jpg', source: 'public_license' }),
    rawCase('pair-views', { photo: 'g/photo.jpg', garment: 'g/front.jpg', garment_mode: 'same_garment_views', extra_garments: ['g/back.jpg'], source: 'public_license' }),
    rawCase('o1', { garment_mode: 'outfit_items', extra_garments: ['o1/garment-2.jpg', 'o1/garment-3.jpg'], style_dna: personas.styleDna('persona-bold-aesthetic') }),
  ])
  const composition = describeComposition(cases)

  it('counts cases and images apart: three garment images in one outfit are one case', () => {
    expect(composition.cases).toBe(5)
    expect(composition.cases_by_mode).toEqual({ single: 3, same_garment_views: 1, outfit_items: 1 })
    expect(composition.images).toEqual({
      personal_photos: 5,
      garment_images: 8,
      garment_images_by_mode: { single: 3, same_garment_views: 2, outfit_items: 3 },
      total: 13,
      // The pair shares its photo and its front view.
      distinct_files: 11,
    })
  })

  it('reports sources and Style DNA, by garment mode', () => {
    expect(composition.cases_by_source).toEqual({ synthetic: 3, owned: 0, public_license: 2, approved_volunteer: 0 })
    expect(composition.style_dna).toEqual({ cases: 2, cases_by_mode: { single: 1, same_garment_views: 0, outfit_items: 1 }, personas: ['persona-bold-aesthetic', 'persona-minimal-aesthetic'] })
  })

  it('says how many cases each mode still needs, in cases', () => {
    expect(MIN_CASES_PER_MODE).toBe(MIN_SAMPLE)
    expect(composition.mode_balance).toEqual({ target_per_mode: 10, short_by: { single: 7, same_garment_views: 9, outfit_items: 9 }, balanced: false })
    const lines = compositionLines(composition)
    expect(lines[0]).toBe('Cases: 5 (single 3, same_garment_views 1, outfit_items 1)')
    // Slots, not files: whether a file exists is not known here.
    expect(lines[1]).toContain('Image slots: 13 (5 personal photos + 8 garment images; 11 different files). Images are not cases')
    const synthetic = compositionLines(describeComposition(parse([rawCase('a'), rawCase('b')])))
    expect(synthetic[1]).toBe('Image slots: 4 (2 personal photos + 2 garment images; 4 different files). Every case is synthetic: none of these files exists. Images are not cases: sample sizes count cases only.')
    expect(lines[4]).toBe('Mode balance: NOT met (target 10 cases per mode): single needs 7 more, same_garment_views needs 9 more, outfit_items needs 9 more.')
  })

  it('is not fooled by images: thirty garment images in ten outfits are ten cases', () => {
    const outfits = parse(Array.from({ length: 10 }, (_, index) => rawCase(`o${index}`, { garment_mode: 'outfit_items', extra_garments: [`o${index}/b.jpg`, `o${index}/c.jpg`] })))
    const balance = describeComposition(outfits)
    expect(balance.images.garment_images_by_mode.outfit_items).toBe(30)
    expect(balance.cases_by_mode.outfit_items).toBe(10)
    expect(balance.mode_balance.short_by).toEqual({ single: 10, same_garment_views: 10, outfit_items: 0 })
  })
})

describe('committed evaluation data', () => {
  // Read inside each test, so that a missing git is a failed test with a message and not a suite that cannot load.
  const committedManifests = () => execFileSync('git', ['ls-files', 'evaluation', 'benchmark'], { cwd: root, encoding: 'utf8' }).split('\n').filter((file) => /cases[^/]*\.json$/.test(file))

  it('carries Style DNA only from the persona library, never a personal profile', () => {
    const manifests = committedManifests()
    expect(manifests.length).toBeGreaterThanOrEqual(4)
    let withDna = 0
    for (const file of manifests) {
      for (const benchmarkCase of manifestSchema.parse(JSON.parse(readFileSync(path.join(root, file), 'utf8'))).cases) {
        if (!benchmarkCase.style_dna) continue
        withDna += 1
        expect(benchmarkCase.style_dna.source).toBe('synthetic')
        expect({ file, id: benchmarkCase.id, fromLibrary: JSON.stringify(benchmarkCase.style_dna.profile) === JSON.stringify(personas.PERSONAS[benchmarkCase.style_dna.persona]) }).toEqual({ file, id: benchmarkCase.id, fromLibrary: true })
      }
    }
    expect(withDna).toBeGreaterThanOrEqual(24)
  })

  it('attaches only aesthetic-only personas to cases that will have a real photo', () => {
    for (const file of committedManifests()) {
      for (const benchmarkCase of manifestSchema.parse(JSON.parse(readFileSync(path.join(root, file), 'utf8'))).cases) {
        if (benchmarkCase.style_dna && benchmarkCase.source !== 'synthetic') expect(personas.AESTHETIC_ONLY).toContain(benchmarkCase.style_dna.persona)
      }
    }
  })
})
