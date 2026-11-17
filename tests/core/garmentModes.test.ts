/**
 * Garment modes: one garment image, several views of one garment, or several
 * items of one outfit. Covers the shared rules, the prompt context each mode
 * adds, the per-mode prompt versions, the per-item notes of an outfit, and the
 * cost bounds with several images. No network is used.
 */

import { describe, expect, it, jest } from '@jest/globals'
import { readFileSync } from 'node:fs'
import path from 'node:path'

jest.mock('server-only', () => ({}), { virtual: true })

import { manifestSchema, maxCostPerCallMicroUsd, runCases, type AnalyzeFn, type PreparedCase, type RunOptions } from '@/benchmark/harness'
import { GARMENT_MODES, GARMENT_MODE_LABELS, MAX_GARMENT_IMAGES, garmentCountProblem, garmentCountRange, isGarmentMode } from '@/lib/constants/garmentModes'
import { buildCompleteAnalysisResult } from '@/lib/services/analysisResultService'
import { SUPPORTED_MODEL_IDS, estimateMaxCostMicroUsd, resolveModelConfig } from '@/lib/services/openai/modelConfig'
import { buildAnalysisContent, buildUserContext, computeAnalysisPromptVersion, getAnalysisPromptVersion } from '@/lib/services/openai/openAIAnalysisService'
import { OUTFIT_COMPONENT_ASSESSMENTS, validateOutfitComponents } from '@/lib/services/openai/outfitComponentsSchema'
import { buildOutfitComponents } from '@/lib/services/outfitComponentsService'
import { MAX_OCCASION_LENGTH, MAX_STYLE_PROFILE_BYTES, utf8ByteLength } from '@/lib/services/requestLimits'
import { allRated, makePng } from '../helpers/fixtures'
import { VALID_COMPLETE_PROFILE } from '../phase3/fixtures'

const SYSTEM_PROMPT = readFileSync(path.join(process.cwd(), 'memory', 'SYSTEM_PROMPT.md'), 'utf8')
const EMPTY_PROFILE = { preferredStyles: [], favoriteColors: [], occasionPreferences: [] }
const lines = (text: string): string[] => text.split(/\r?\n/)
const firstLine = (text: string): string => lines(text)[0]

// Recorded versions of the prompt template for each garment mode. A change to any instruction
// line of a mode changes its version; update the value here so the change is visible in review.
// Changed in Phase 4 Milestone 1 (analysis-output/3, observations and evidence). Before: single 3c78bd7bbd3b,
// views 26de11106f0a, outfit ff754a0c0e59. A recording made with one of those can never carry these.
const SINGLE_PROMPT_VERSION = '8dd94dba7564'
const VIEWS_PROMPT_VERSION = 'cc0b04509e09'
const OUTFIT_PROMPT_VERSION = '9be41c46ccc1'

describe('garment mode rules', () => {
  it('has exactly three modes and at most three garment images', () => {
    expect([...GARMENT_MODES]).toEqual(['single', 'same_garment_views', 'outfit_items'])
    expect(MAX_GARMENT_IMAGES).toBe(3)
    for (const mode of GARMENT_MODES) expect(GARMENT_MODE_LABELS[mode].title.length).toBeGreaterThan(0)
  })

  it('recognises only the known modes', () => {
    for (const mode of GARMENT_MODES) expect(isGarmentMode(mode)).toBe(true)
    for (const value of ['', 'auto', 'SINGLE', 'views', null, undefined, 2, {}]) expect(isGarmentMode(value)).toBe(false)
  })

  it('needs one image for a single garment and two or three for the other modes', () => {
    expect(garmentCountRange('single')).toEqual({ min: 1, max: 1 })
    expect(garmentCountRange('same_garment_views')).toEqual({ min: 2, max: 3 })
    expect(garmentCountRange('outfit_items')).toEqual({ min: 2, max: 3 })
  })

  it('explains every count that does not fit, and never suggests the mode was changed', () => {
    const table: Array<[Parameters<typeof garmentCountProblem>[0], number, RegExp | null]> = [
      ['single', 0, /add a photo of the garment/],
      ['single', 1, null],
      ['single', 2, /One garment photo is expected/],
      ['same_garment_views', 1, /at least two views/],
      ['same_garment_views', 2, null],
      ['same_garment_views', 3, null],
      ['same_garment_views', 4, /up to 3 garment photos/],
      ['outfit_items', 0, /at least two outfit items/],
      ['outfit_items', 3, null],
      ['outfit_items', 4, /up to 3 garment photos/],
    ]
    for (const [mode, count, expected] of table) {
      const problem = garmentCountProblem(mode, count)
      if (expected === null) expect({ mode, count, problem }).toEqual({ mode, count, problem: null })
      else expect(problem).toMatch(expected)
    }
  })
})

describe('prompt context per garment mode', () => {
  // analysis-output/3 (Phase 4 Milestone 1): every fixed rule is in the system prompt, stated once. The user
  // message names the image mode explicitly in EVERY mode, a single garment image included, and carries the data.
  it('names the image mode in every mode, a single garment image included', () => {
    expect(buildUserContext('Office Work', EMPTY_PROFILE, VALID_COMPLETE_PROFILE)).toBe(buildUserContext('Office Work', EMPTY_PROFILE, VALID_COMPLETE_PROFILE, { mode: 'single', count: 1 }))
    expect(firstLine(buildUserContext('Office Work', EMPTY_PROFILE))).toBe('Image mode: single. Garment image 1 shows one garment.')
    expect(buildAnalysisContent('c', 'data:photo', 'data:garment')).toEqual(buildAnalysisContent('c', 'data:photo', ['data:garment'], 'single'))
  })

  it('tells the model that several views show one garment, and asks for the views entry', () => {
    const text = buildUserContext('Office Work', EMPTY_PROFILE, undefined, { mode: 'same_garment_views', count: 2 })
    expect(firstLine(text)).toBe('Image mode: same_garment_views. Garment images 1 to 2 are views of ONE garment; include observations.views.')
    expect(text).not.toContain('outfit_components')
    expect(SYSTEM_PROMPT).toContain('same_garment_views: views of ONE garment. Use them together as evidence about one item, never as separate garments.')
    expect(SYSTEM_PROMPT).toContain('same_garment_views only: observations.views {"same_garment":"yes|no|unclear","conflicts":""}; explain conflicts (max 100 chars) unless yes.')
  })

  it('tells the model that several items form one outfit, and asks for advisory per-item notes', () => {
    const text = buildUserContext('Office Work', EMPTY_PROFILE, undefined, { mode: 'outfit_items', count: 3 })
    expect(firstLine(text)).toBe('Image mode: outfit_items. Garment images 1 to 3 are 3 DIFFERENT items worn together; include outfit_components.')
    expect(SYSTEM_PROMPT).toContain('outfit_items: DIFFERENT items worn together. Rate the outfit as a whole.')
    expect(SYSTEM_PROMPT).toContain('outfit_items only: top-level outfit_components, one per garment image in order')
    expect(SYSTEM_PROMPT).toContain('Advisory blocks never change a rating.')
    for (const assessment of OUTFIT_COMPONENT_ASSESSMENTS) expect(SYSTEM_PROMPT).toContain(assessment)
  })

  it('keeps every rule in the system prompt once, and the closing line last in every mode', () => {
    for (const garments of [undefined, { mode: 'same_garment_views' as const, count: 3 }, { mode: 'outfit_items' as const, count: 2 }]) {
      const text = buildUserContext('Office Work', EMPTY_PROFILE, VALID_COMPLETE_PROFILE, garments)
      expect(text.endsWith('Return one JSON object only.')).toBe(true)
      // No rule is repeated in the message: the message holds the mode and the data only.
      expect(text.replace('include observations.views.', '')).not.toMatch(/shopping_advisor|recommendations|rating|confidence|observations|evidence/)
    }
    expect(SYSTEM_PROMPT).toContain('You never decide the overall verdict: the application calculates it from your six ratings.')
    expect(SYSTEM_PROMPT).toContain('Add no other field: no verdict, score or recommendation.')
    expect(SYSTEM_PROMPT).toContain('No score estimate, retailers, links, price, stock, discounts, brand, material quality, durability or comfort.')
  })

  it('never puts a verdict field into the output shapes it asks for', () => {
    const shapes = lines(SYSTEM_PROMPT).filter((line) => line.startsWith('Complete: ') || line.startsWith('Unable: ') || line.startsWith('outfit_items only:'))
    expect(shapes).toHaveLength(3)
    for (const shape of shapes) expect(shape).not.toMatch(/verdict|score|"recommendation"/i)
  })

  it('no longer refers to a schema document the model never receives', () => {
    expect(SYSTEM_PROMPT).not.toContain('AI_OUTPUT_SCHEMA')
    expect(SYSTEM_PROMPT).not.toContain('.md')
  })

  it('labels every garment image by number and role', () => {
    const labels = (mode: 'single' | 'same_garment_views' | 'outfit_items', count: number) =>
      buildAnalysisContent('context', 'data:photo', Array.from({ length: count }, (_, i) => `data:g${i}`), mode).filter((part) => part.type === 'input_text').map((part) => (part as { text: string }).text)
    expect(labels('single', 1)).toEqual(['context', 'Person image:', 'Garment image 1:'])
    expect(labels('same_garment_views', 2)).toEqual(['context', 'Person image:', 'Garment image 1 of 2 (view):', 'Garment image 2 of 2 (view):'])
    expect(labels('outfit_items', 3)).toEqual(['context', 'Person image:', 'Garment image 1 of 3 (item):', 'Garment image 2 of 3 (item):', 'Garment image 3 of 3 (item):'])
  })
})

describe('prompt version per garment mode', () => {
  it('matches the recorded version for a single garment image', async () => {
    expect(computeAnalysisPromptVersion(SYSTEM_PROMPT)).toBe(SINGLE_PROMPT_VERSION)
    expect(computeAnalysisPromptVersion(SYSTEM_PROMPT, 'single')).toBe(SINGLE_PROMPT_VERSION)
    await expect(getAnalysisPromptVersion()).resolves.toBe(SINGLE_PROMPT_VERSION)
  })

  it('matches the recorded version for each multi-image mode', async () => {
    expect(computeAnalysisPromptVersion(SYSTEM_PROMPT, 'same_garment_views')).toBe(VIEWS_PROMPT_VERSION)
    expect(computeAnalysisPromptVersion(SYSTEM_PROMPT, 'outfit_items')).toBe(OUTFIT_PROMPT_VERSION)
    await expect(getAnalysisPromptVersion('outfit_items')).resolves.toBe(OUTFIT_PROMPT_VERSION)
  })

  it('differs between modes, because each mode sends a different template', () => {
    expect(new Set([SINGLE_PROMPT_VERSION, VIEWS_PROMPT_VERSION, OUTFIT_PROMPT_VERSION]).size).toBe(3)
  })

  it('changes with the system prompt in every mode', () => {
    for (const mode of GARMENT_MODES) expect(computeAnalysisPromptVersion(`${SYSTEM_PROMPT}\nOne more rule.`, mode)).not.toBe(computeAnalysisPromptVersion(SYSTEM_PROMPT, mode))
  })
})

describe('per-item notes of an outfit', () => {
  const note = (item: number, extra: Record<string, unknown> = {}) => ({ item, garment_type: 'top', assessment: 'Works', note: 'This item fits in with the other items.', ...extra })

  it('accepts one note per garment image and returns them in image order', () => {
    expect(validateOutfitComponents([note(3), note(1), note(2)], 3).map((entry) => entry.item)).toEqual([1, 2, 3])
    expect(validateOutfitComponents([note(1), note(2)], 2)).toHaveLength(2)
  })

  it.each([
    ['fewer notes than images', [note(1), note(2)], 3],
    ['more notes than images', [note(1), note(2), note(3)], 2],
    ['one image described twice', [note(1), note(1)], 2],
    ['an image number that does not exist', [note(1), note(4)], 2],
    ['a single note', [note(1)], 2],
    ['an unknown garment type', [note(1, { garment_type: 'hat' }), note(2)], 2],
    ['an unknown assessment', [note(1, { assessment: 'Excellent' }), note(2)], 2],
    ['a note that is too short', [note(1, { note: 'ok' }), note(2)], 2],
    ['an extra field such as a verdict or a score', [note(1, { verdict_score: 5 }), note(2)], 2],
    ['something that is not a list', { items: [note(1), note(2)] }, 2],
  ])('rejects %s', (_label, value, count) => {
    expect(() => validateOutfitComponents(value, count)).toThrow()
  })

  it('exist only in outfit mode; any other mode ignores them', () => {
    const notes = [note(1), note(2)]
    expect(buildOutfitComponents(notes, 'outfit_items', 2)).toMatchObject({ availability: 'available' })
    expect(buildOutfitComponents(notes, 'same_garment_views', 2)).toEqual({ availability: 'not_applicable', items: [] })
    expect(buildOutfitComponents(notes, 'single', 1)).toEqual({ availability: 'not_applicable', items: [] })
    expect(buildOutfitComponents('garbage', 'outfit_items', 2)).toEqual({ availability: 'unavailable', items: [] })
  })

  it('use labels that are not ratings, scores or verdict bands', () => {
    const forbidden = ['Excellent', 'Good', 'Fair', 'Poor', 'Highly Recommended', 'Recommended', 'Consider Alternatives', 'Not Recommended']
    for (const assessment of OUTFIT_COMPONENT_ASSESSMENTS) expect(forbidden).not.toContain(assessment)
  })

  it('never change the verdict or the rest of a result', () => {
    const dimensions = allRated('Fair')
    const plain = buildCompleteAnalysisResult(dimensions)
    const withNotes = buildCompleteAnalysisResult(dimensions, undefined, { garmentMode: 'outfit_items', outfitComponents: buildOutfitComponents([note(1, { assessment: 'Works well' }), note(2, { assessment: 'Works well' })], 'outfit_items', 2) })
    expect(withNotes).toMatchObject({ ...plain })
    expect(withNotes.outfit_components?.items).toHaveLength(2)
    // A single-garment result carries neither field.
    expect('garment_mode' in plain || 'outfit_components' in plain).toBe(false)
    expect(buildCompleteAnalysisResult(dimensions, undefined, { garmentMode: 'same_garment_views', outfitComponents: buildOutfitComponents(undefined, 'same_garment_views', 2) })).toMatchObject({ garment_mode: 'same_garment_views' })
  })
})

describe('cost bounds with several images', () => {
  it('reserves more for every additional image, by exactly the per-image bound', () => {
    for (const model of SUPPORTED_MODEL_IDS) {
      const config = resolveModelConfig(model)!
      const perImage = Math.ceil(config.maxImageInputTokens * config.pricing.inputUsdPerMTok)
      for (let images = 2; images < 1 + MAX_GARMENT_IMAGES; images += 1) {
        expect(estimateMaxCostMicroUsd(config, 'analysis', images + 1) - estimateMaxCostMicroUsd(config, 'analysis', images)).toBe(perImage)
      }
    }
  })

  it('keeps the analysis text within the text-token bound in every mode, at the largest client input', () => {
    // Worst case: 4-byte characters everywhere the client controls text, as in tests/spend/spendUnits.test.ts.
    const occasion = '\u{1F600}'.repeat(MAX_OCCASION_LENGTH / 2)
    const filler = '\u{1F600}'.repeat(Math.floor((MAX_STYLE_PROFILE_BYTES - 80) / 4))
    const styleProfile = { preferredStyles: [filler], favoriteColors: [], occasionPreferences: [] }
    const aiProfile = {
      ...VALID_COMPLETE_PROFILE,
      coloring: { ...VALID_COMPLETE_PROFILE.coloring, hair_color: '\u{1F600}'.repeat(20), skin_tone_depth: 'medium light' as const },
      style_keywords: (['Minimalist', 'Streetwear', 'Bohemian', 'Romantic', 'Eclectic'] as const).map((keyword) => ({ keyword, confidence: 'High' as const, source: 'observed' as const })),
    }
    for (const mode of GARMENT_MODES) {
      const count = mode === 'single' ? 1 : MAX_GARMENT_IMAGES
      const context = buildUserContext(occasion, styleProfile, aiProfile, { mode, count })
      const labels = buildAnalysisContent('', 'p', Array.from({ length: count }, () => 'a'), mode).filter((part) => part.type === 'input_text').map((part) => (part as { text: string }).text).join('')
      const textBytes = utf8ByteLength(SYSTEM_PROMPT) + utf8ByteLength(context) + utf8ByteLength(labels) + 200
      for (const model of SUPPORTED_MODEL_IDS) {
        expect({ mode, model, fits: textBytes <= resolveModelConfig(model)!.operations.analysis.maxTextInputTokens }).toEqual({ mode, model, fits: true })
      }
    }
  })
})

describe('benchmark manifest and runner with several garment images', () => {
  const baseCase = {
    id: 'multi',
    category: 'multiple_garments',
    description: 'Synthetic case.',
    source: 'synthetic',
    photo: 'photo.jpg',
    garment: 'garment-1.jpg',
    occasion: 'Office Work',
    expected: {},
  }
  const manifest = (extra: Record<string, unknown>) => manifestSchema.safeParse({ version: 1, cases: [{ ...baseCase, ...extra }] })

  it('accepts a mode with a matching number of images and rejects a mismatch', () => {
    expect(manifest({}).success).toBe(true)
    expect(manifest({ garment_mode: 'single' }).success).toBe(true)
    expect(manifest({ garment_mode: 'outfit_items', extra_garments: ['garment-2.jpg', 'garment-3.jpg'] }).success).toBe(true)
    expect(manifest({ garment_mode: 'same_garment_views', extra_garments: ['garment-2.jpg'] }).success).toBe(true)
    // The mode is never inferred from the images, and the images are never trimmed to fit the mode.
    expect(manifest({ extra_garments: ['garment-2.jpg'] }).success).toBe(false)
    expect(manifest({ garment_mode: 'single', extra_garments: ['garment-2.jpg'] }).success).toBe(false)
    expect(manifest({ garment_mode: 'outfit_items' }).success).toBe(false)
    expect(manifest({ garment_mode: 'outfit_items', extra_garments: ['a.jpg', 'b.jpg', 'c.jpg'] }).success).toBe(false)
    expect(manifest({ garment_mode: 'collage', extra_garments: ['garment-2.jpg'] }).success).toBe(false)
  })

  it('passes every garment image and the mode to the analysis, and budgets for every image', async () => {
    const options: RunOptions = { model: 'gpt-6.1-terra', reasoningEffort: 'low', maxOutputTokens: 4_000, runsPerCase: 1, maxUsd: 5 }
    const parsed = manifestSchema.parse({ version: 1, cases: [{ ...baseCase, garment_mode: 'outfit_items', extra_garments: ['garment-2.jpg', 'garment-3.jpg'] }] })
    const prepared: PreparedCase[] = [{ benchmarkCase: parsed.cases[0], photo: makePng(), garment: makePng(800, 800, 'g1.png', 60), extraGarments: [makePng(800, 800, 'g2.png', 70), makePng(800, 800, 'g3.png', 80)] }]
    const seen: Array<{ extra: number; mode: string | undefined }> = []
    const analyze: AnalyzeFn = async (input) => {
      seen.push({ extra: input.extraGarments?.length ?? 0, mode: input.garmentMode })
      return { status: 'complete', dimensions: allRated('Good') }
    }
    const outcome = await runCases(prepared, options, analyze)
    expect(seen).toEqual([{ extra: 2, mode: 'outfit_items' }])
    expect(outcome.records).toHaveLength(1)
    expect(maxCostPerCallMicroUsd(options, 4)).toBeGreaterThan(maxCostPerCallMicroUsd(options))
    expect(maxCostPerCallMicroUsd(options)).toBe(maxCostPerCallMicroUsd(options, 2))

    // A cap that covers a two-image call but not a four-image call stops before the call is made.
    const tight = { ...options, maxUsd: (maxCostPerCallMicroUsd(options, 2) + 1) / 1_000_000 }
    const stopped = await runCases(prepared, tight, analyze)
    expect(stopped.stoppedEarly).toBe(true)
    expect(seen).toHaveLength(1)
  })
})
