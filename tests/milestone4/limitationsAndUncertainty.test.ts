/**
 * Phase 4 Milestone 4: limitations, uncertainty and consistency.
 *
 * Limit codes and limit citations, the consistency checks (which flag and never
 * change anything), the plain-language limitation summary, truncated or
 * incomplete responses, and the evaluation figures. No model is called.
 */

import { afterEach, describe, expect, it, jest } from '@jest/globals'
import { readFileSync } from 'node:fs'
import path from 'node:path'

jest.mock('server-only', () => ({}), { virtual: true })

import { IMAGE_LIMITS, OBSERVATION_STATUSES, inspectObservations, resolveCite } from '@/lib/services/openai/observationsSchema'
import { inspectEvidence } from '@/lib/services/openai/ratingEvidenceSchema'
import { checkConsistency } from '@/lib/services/consistencyService'
import { buildCompleteAnalysisResult } from '@/lib/services/analysisResultService'
import { computeVerdict } from '@/lib/services/analysisService'
import { buildVisualEvidence } from '@/lib/services/visualEvidenceService'
import { analyzeWithOpenAI } from '@/lib/services/openai/openAIAnalysisService'
import { occasionContextOf } from '@/lib/constants/occasionProfiles'
import { limitationSentences } from '@/components/fashion/LimitationsSummary'
import { ANALYSIS_OUTPUT_SCHEMA_VERSION } from '@/lib/services/openai/openAIAnalysisSchema'
import { evaluateRecording } from '@/evaluation/evaluate'
import { datasetPaths, loadCases, loadRecording, loadReferenceSet } from '@/evaluation/load'
import { UNAVAILABLE_BEFORE_PHASE4 } from '@/evaluation/multiImageReasoning'
import type { Dimensions } from '@/types/schema'
import { allRated, makeDimensions, makePng, openAIResponse } from '../helpers/fixtures'
import { captureLogs } from '../logging/logTestUtils'
import { evidenceFor, image } from '../helpers/visualFixtures'

const SYSTEM_PROMPT = readFileSync(path.join(process.cwd(), 'memory', 'SYSTEM_PROMPT.md'), 'utf8')
const PROFILE = { preferredStyles: ['Classic'], favoriteColors: [], occasionPreferences: [] }
const single = (overrides: Record<string, unknown> = {}) => inspectObservations({ images: [image(1, overrides)] }, { mode: 'single', garmentCount: 1 }).value

afterEach(() => { jest.restoreAllMocks() })

describe('visual limitations', () => {
  it('cover the categories of the milestone in stable codes', () => {
    expect([...IMAGE_LIMITS]).toEqual(['lighting', 'shadow', 'occlusion', 'cropped', 'blur', 'low_resolution', 'angle', 'partial_view', 'image_text', 'several_items'])
    expect(SYSTEM_PROMPT).toContain('limits: max 4 of lighting|shadow|occlusion|cropped|blur|low_resolution|angle|partial_view|image_text|several_items.')
  })

  it('can be cited by a rating only when that image reported the limit', () => {
    const observations = single({ limits: ['lighting', 'partial_view'] })
    expect(resolveCite('g1.lighting', observations)).toMatchObject({ field: 'limit', limit: 'lighting' })
    expect(resolveCite('g1.partial_view', observations)).toMatchObject({ field: 'limit', limit: 'partial_view' })
    expect(resolveCite('g1.blur', observations)).toBeNull()
    expect(resolveCite('g2.lighting', observations)).toBeNull()
  })

  it('tie a limit to the dimension it weakened through evidence, and refuse a limit that was never reported', () => {
    const dimensions = allRated('Good')
    const context = { dimensions, observations: single({ limits: ['lighting'] }), hasStyleDna: false, hasStylePreferences: true }
    const tied = inspectEvidence(evidenceFor(dimensions, { color: { cites: ['g1.colour', 'g1.lighting'], support: 'partial', missing: 'Lighting makes the colour uncertain' } }), context)
    expect(tied.value.dimensions.color?.cites).toEqual(['g1.colour', 'g1.lighting'])
    const invented = inspectEvidence(evidenceFor(dimensions, { color: { cites: ['g1.colour', 'g1.blur'] } }), context)
    expect(invented.problems.color).toEqual(['invalid_citation'])
  })

  it('are summarised in plain words, per photo, without repeats or invented limits', () => {
    const observations = inspectObservations({
      images: [image(1, { limits: ['lighting', 'shadow'], colour_status: 'uncertain' }), image(2, { pattern: 'unclear', limits: ['partial_view'] })],
      views: { same_garment: 'unclear', conflicts: 'View 2 is mostly out of frame' },
    }, { mode: 'same_garment_views', garmentCount: 2 }).value ?? undefined
    expect(limitationSentences(observations, 'same_garment_views')).toEqual([
      'Lighting may change how colours look in view 1.',
      'Strong shadows hide part of view 1.',
      'Too little of the garment is visible in view 2.',
      'The pattern in view 2 is not clearly visible.',
      'The views may not all show the same garment.',
    ])
    expect(limitationSentences(single() ?? undefined, 'single')).toEqual([])
    expect(limitationSentences({ availability: 'unavailable', images: [] }, 'single')).toEqual([])
    expect(limitationSentences(undefined, 'single')).toEqual([])
  })
})

describe('the four uncertainty states', () => {
  it('are the same in the schema, the prompt and the report wording', () => {
    expect([...OBSERVATION_STATUSES]).toEqual(['observed', 'uncertain', 'not_visible'])
    expect(SYSTEM_PROMPT).toContain('identification: observed|uncertain|not_visible')
    expect(SYSTEM_PROMPT).toContain('Unable to Evaluate')
    expect(SYSTEM_PROMPT).not.toMatch(/\d+\s?%|percent|probability/i)
  })
})

describe('consistency checks', () => {
  const navy = single({ colours: { dominant: ['navy'], secondary: [] } }) ?? undefined
  const withReason = (key: keyof Dimensions, reason: string, base = allRated('Good') as unknown as Dimensions): Dimensions => ({ ...base, [key]: { ...base[key], reason } })

  it('flag a garment colour that was never observed, naming it from the colour vocabulary only', () => {
    expect(checkConsistency({ dimensions: withReason('color', 'The red jacket is bold for the office.'), observations: navy })).toEqual([{ dimension: 'color', code: 'colour_not_observed', detail: 'red' }])
  })

  it('do not flag colours that describe the person, a dress code or the occasion', () => {
    expect(checkConsistency({ dimensions: withReason('color', 'The navy suit works. It flatters a warm skin tone with pink undertones.'), observations: navy })).toEqual([])
    expect(checkConsistency({ dimensions: withReason('occasion', 'A suit falls short of a black tie dress code.'), observations: navy, occasion: 'Black Tie Event' })).toEqual([])
    expect(checkConsistency({ dimensions: withReason('color', 'The navy blazer is right.'), observations: navy })).toEqual([])
  })

  it('flag an occasion explanation about a different occasion, but not one that also names the selected occasion', () => {
    expect(checkConsistency({ dimensions: withReason('occasion', 'Perfect for a relaxed beach outing.'), occasion: 'Office Work' })).toEqual([{ dimension: 'occasion', code: 'occasion_not_selected', detail: 'beach' }])
    expect(checkConsistency({ dimensions: withReason('occasion', 'Better suited to the office than to a beach.'), occasion: 'Office Work' })).toEqual([])
  })

  it.each<[string, string]>([
    ['a compound with the observed colour', 'The navy blue jacket is sharp.'],
    ['a hyphenated dress code', 'It is not black-tie formal.'],
    ['a suggestion about shoes that were not photographed', 'Brown shoes would complement it.'],
    ['an idiom', 'It feels red carpet ready.'],
  ])('do not flag %s', (_label, reason) => {
    expect(checkConsistency({ dimensions: withReason('color', reason), observations: navy })).toEqual([])
  })

  it('do not flag "off-white" against an observed cream', () => {
    const cream = single({ colours: { dominant: ['cream'], secondary: [] } }) ?? undefined
    expect(checkConsistency({ dimensions: withReason('color', 'The off-white knit is soft.'), observations: cream })).toEqual([])
  })

  it.each<[string, string]>([
    ['Wedding Guest', 'A cocktail dress is ideal.'],
    ['Formal Dinner', 'A sleek cocktail dress suits it.'],
    ['Award Ceremony', 'Meets black tie expectations.'],
    ['Beach', 'It has a relaxed vacation feel.'],
  ])('do not flag a dress code or a closely related occasion (%s)', (occasion, reason) => {
    expect(checkConsistency({ dimensions: withReason('occasion', reason), occasion })).toEqual([])
  })

  it('match the selected occasion by whole words only', () => {
    expect(checkConsistency({ dimensions: withReason('occasion', 'The blazer works for a wedding.'), occasion: 'Office Work' })).toEqual([{ dimension: 'occasion', code: 'occasion_not_selected', detail: 'wedding' }])
  })

  it('flag an Excellent, High-confidence rating whose evidence says the support is only partial', () => {
    const dimensions = makeDimensions({ occasion: 'Excellent', color: 'Good', formality: 'Good', seasonality: 'Good', style_preference_match: 'Good' }) as unknown as Dimensions
    expect(checkConsistency({ dimensions, evidence: { availability: 'available', dimensions: { occasion: { sources: ['occasion'], cites: [], support: 'partial', missing: 'Dress code unknown' } } } })).toEqual([{ dimension: 'occasion', code: 'confident_on_partial_evidence' }])
  })

  it('only flag: the ratings and the verdict are exactly what they would be without the check', () => {
    const dimensions = withReason('color', 'The red jacket is bold.', allRated('Excellent') as unknown as Dimensions)
    const visual = buildVisualEvidence({ rawObservations: { images: [image(1)] }, rawEvidence: evidenceFor(dimensions as never), dimensions: dimensions as never, garmentMode: 'single', garmentCount: 1, hasStyleDna: false, styleProfile: PROFILE })
    const result = buildCompleteAnalysisResult(dimensions as never, undefined, { ...visual, occasionContext: occasionContextOf('Office Work') })
    expect(result.consistency?.flags).toEqual([{ dimension: 'color', code: 'colour_not_observed', detail: 'red' }])
    expect(result.dimensions).toEqual(dimensions)
    expect([result.overall_recommendation, result.verdict_score]).toEqual(Object.values(computeVerdict(dimensions)))
  })
})

describe('truncated or incomplete responses', () => {
  const originalEnv = { ...process.env }
  const run = () => analyzeWithOpenAI({ photo: makePng(), garment: makePng(800, 800, 'g.png', 90), occasion: 'Office Work', styleProfile: PROFILE })
  afterEach(() => { process.env = { ...originalEnv } })

  it('fail the whole analysis when the provider stops at the output cap: nothing partial is ever returned', async () => {
    process.env = { ...originalEnv, OPENAI_API_KEY: 'sk-test-fake-key-trunc-0000', OPENAI_MODEL: 'gpt-6.1-terra' }
    const logs = captureLogs()
    jest.spyOn(global, 'fetch').mockImplementation(async () => openAIResponse('{"status":"complete","observations":{"images":[{"image":1,', { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }))
    await expect(run()).rejects.toMatchObject({ code: 'incomplete' })
    expect(logs.events().find((event) => event.event === 'openai_response_not_completed')).toMatchObject({ outcome: 'incomplete:max_output_tokens' })
  })

  it('fail as invalid when completed output is cut short JSON', async () => {
    process.env = { ...originalEnv, OPENAI_API_KEY: 'sk-test-fake-key-trunc-0000', OPENAI_MODEL: 'gpt-6.1-terra' }
    captureLogs()
    jest.spyOn(global, 'fetch').mockImplementation(async () => openAIResponse('{"status":"complete","dimensions":{"occasion":{"rating":"Good"'))
    await expect(run()).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('keep the ratings when only the informational blocks are missing, because they are validated apart', async () => {
    process.env = { ...originalEnv, OPENAI_API_KEY: 'sk-test-fake-key-trunc-0000', OPENAI_MODEL: 'gpt-6.1-terra' }
    captureLogs()
    jest.spyOn(global, 'fetch').mockImplementation(async () => openAIResponse({ status: 'complete', dimensions: allRated('Good') }))
    await expect(run()).resolves.toMatchObject({ status: 'complete', dimensions: allRated('Good') })
  })
})

describe('uncertainty figures in the evaluation', () => {
  const root = process.cwd()
  const evaluate = (dataset: 'scenarios-v3' | 'scenarios-v4', change?: (recording: ReturnType<typeof loadRecording>) => void) => {
    const paths = datasetPaths(root, dataset)
    const cases = loadCases(paths.casesPath)
    const recording = loadRecording(paths.recordingPath)
    change?.(recording)
    return evaluateRecording(recording, cases, { promptVersion: 'aaaaaaaaaaaa', schemaVersion: ANALYSIS_OUTPUT_SCHEMA_VERSION }, 'mock', paths.referencesPath ? { references: loadReferenceSet(paths.referencesPath, cases) } : {})
  }
  const without = (caseId: string) => evaluate('scenarios-v4', (recording) => { recording.entries = recording.entries.filter((entry) => entry.case_id !== caseId) })

  it('are unavailable for a recording made before analysis-output/4', () => {
    expect(evaluate('scenarios-v3').quality.uncertainty).toMatchObject({ applicable: false, reason: UNAVAILABLE_BEFORE_PHASE4 })
  })

  it('detect the cases written to fail them', () => {
    const report = evaluate('scenarios-v4')
    expect(report.cases.filter((entry) => entry.status !== 'pass').map((entry) => entry.case_id)).toEqual([])
    const block = report.quality.uncertainty
    expect(block.uncertain_colour_restraint_rate.value).toBeLessThan(1)
    expect(without('v4-uncertain-colour-overconfident').quality.uncertainty.uncertain_colour_restraint_rate.value).toBe(1)
    expect(block.unidentified_garment_restraint_rate.value).toBeLessThan(1)
    expect(without('v4-unidentified-overconfident').quality.uncertainty.unidentified_garment_restraint_rate.value).toBe(1)
    expect(block.consistency_flag_rate.value).toBeGreaterThan(0)
    const noFlags = evaluate('scenarios-v4', (recording) => { recording.entries = recording.entries.filter((entry) => !entry.case_id.startsWith('v4-consistency-')) })
    expect(noFlags.quality.uncertainty.consistency_flag_rate.value).toBe(0)
  })

  it('score reviewer-listed limits as recall, from synthetic references only', () => {
    const recall = evaluate('scenarios-v4').quality.visual_evidence.by_tier.synthetic.limit_recall
    expect(recall.value).toBeLessThan(1)
    expect(without('v4-limit-not-linked').quality.visual_evidence.by_tier.synthetic.limit_recall.value).toBe(1)
    expect(evaluate('scenarios-v4').quality.visual_evidence.by_tier.image_reviewed.limit_recall.status).toBe('unavailable')
  })
})
