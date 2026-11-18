/**
 * Phase 4 Milestone 3: multi-view and outfit reasoning.
 *
 * View differences, item contributions (validated against the observations),
 * their isolation from the ratings and the verdict, the API path, and the
 * evaluation figures. No model is called; every output is hand-written.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'

jest.mock('server-only', () => ({}), { virtual: true })

import { POST } from '@/app/api/[[...path]]/route'
import { inspectObservations } from '@/lib/services/openai/observationsSchema'
import { CONTRIBUTION_PROBLEMS, inspectContributions, parseOutfitComponents } from '@/lib/services/openai/outfitComponentsSchema'
import { buildOutfitComponents } from '@/lib/services/outfitComponentsService'
import { buildCompleteAnalysisResult } from '@/lib/services/analysisResultService'
import { computeVerdict } from '@/lib/services/analysisService'
import { MODE_RULES } from '@/lib/services/openai/openAIAnalysisService'
import { ANALYSIS_OUTPUT_SCHEMA_VERSION } from '@/lib/services/openai/openAIAnalysisSchema'
import { evaluateRecording } from '@/evaluation/evaluate'
import { datasetPaths, loadCases, loadRecording, loadReferenceSet } from '@/evaluation/load'
import { UNAVAILABLE_BEFORE_PHASE4 } from '@/evaluation/multiImageReasoning'
import { allRated, makeDimensions, makePng, openAIResponse } from '../helpers/fixtures'
import { captureLogs } from '../logging/logTestUtils'
import { evidenceFor, image } from '../helpers/visualFixtures'

const outfitObservations = inspectObservations({ images: [image(1, { category: 'suiting', garment: 'blazer' }), image(2, { category: 'bottom', garment: 'joggers', colours: { dominant: ['grey'], secondary: [] }, details: ['elastic cuffs'] })] }, { mode: 'outfit_items', garmentCount: 2 }).value
const item = (number: number, garment_type: string, effect: Record<string, unknown> = {}) => ({ item: number, garment_type, assessment: 'Works', note: 'A note long enough to pass validation.', ...effect })

describe('views of one garment', () => {
  const views = (extra: Record<string, unknown>, second: Record<string, unknown> = {}) => inspectObservations({ images: [image(1), image(2, second)], views: { same_garment: 'yes', ...extra } }, { mode: 'same_garment_views', garmentCount: 2 })

  it('accepts differences that are missing evidence or lighting, and keeps them', () => {
    expect(views({ differences: ['detail_hidden', 'colour_lighting'] }).value?.views).toEqual({ same_garment: 'yes', differences: ['detail_hidden', 'colour_lighting'] })
  })

  it('refuses one garment that is also a different item, and "not the same" without a different item', () => {
    expect(views({ differences: ['different_item'] }).problems).toContain('views_contradiction')
    expect(inspectObservations({ images: [image(1), image(2)], views: { same_garment: 'no', differences: ['colour_lighting'], conflicts: 'Colours differ' } }, { mode: 'same_garment_views', garmentCount: 2 }).problems).toContain('views_contradiction')
    expect(inspectObservations({ images: [image(1), image(2)], views: { same_garment: 'no', differences: ['different_item'], conflicts: 'View 2 is a shirt' } }, { mode: 'same_garment_views', garmentCount: 2 }).problems).toEqual([])
    expect(views({ differences: ['detail_hidden', 'detail_hidden'] }).problems).toContain('views_contradiction')
    expect(views({ differences: ['torn'] }).problems).toEqual(['schema'])
  })

  it('asks for differences, per view observation and lowered confidence in views mode only', () => {
    expect(MODE_RULES.same_garment_views).toContain('Observe each view on its own')
    expect(MODE_RULES.same_garment_views).toContain('lower affected confidence')
    expect(MODE_RULES.outfit_items).not.toContain('differences')
  })
})

describe('item contributions', () => {
  const inspect = (items: unknown[], observations = outfitObservations) => inspectContributions(parseOutfitComponents(items, 2), observations)

  it('keeps a contribution that cites the item\'s own visible observations', () => {
    const result = inspect([item(1, 'suiting', { supports: ['formality'], cites: ['g1.type'] }), item(2, 'bottom', { tension: ['formality', 'occasion'], unclear: ['seasonality'], cites: ['g2.type', 'g2.d1'] })])
    expect(result.problems.size).toBe(0)
    expect(result.contributions.get(2)).toEqual({ supports: [], tension: ['formality', 'occasion'], unclear: ['seasonality'], cites: ['g2.type', 'g2.d1'] })
  })

  it.each<[string, unknown, string]>([
    ['a dimension in two lists', item(1, 'suiting', { supports: ['formality'], tension: ['formality'], cites: ['g1.type'] }), 'overlapping_dimension'],
    ['an effect with no citation', item(1, 'suiting', { supports: ['color'] }), 'uncited_effect'],
    ['a citation of another item', item(1, 'suiting', { supports: ['color'], cites: ['g2.colour'] }), 'foreign_citation'],
    ['a detail that was never observed', item(1, 'suiting', { supports: ['style'], cites: ['g1.d3'] }), 'invalid_citation'],
    ['a type that contradicts the observation', item(1, 'top', { supports: ['style'], cites: ['g1.colour'] }), 'identity_mismatch'],
  ])('drops a contribution with %s, and keeps the note', (_label, first, problem) => {
    const result = inspect([first, item(2, 'bottom', { supports: ['occasion'], cites: ['g2.type'] })])
    expect(result.problems.get(1)).toContain(problem)
    expect(result.contributions.has(1)).toBe(false)
    expect(result.contributions.has(2)).toBe(true)
    expect(CONTRIBUTION_PROBLEMS).toContain(problem)
  })

  it('refuses every cited contribution when the observations are unavailable, but accepts "too little to judge" only with a visible citation', () => {
    const items = [item(1, 'suiting', { supports: ['formality'], cites: ['g1.type'] }), item(2, 'bottom', { unclear: ['color'], cites: ['g2.d1'] })]
    expect(inspect(items, null).contributions.size).toBe(0)
    expect(inspect(items).contributions.size).toBe(2)
  })

  it('treats items that say nothing about the dimensions as silent, not as errors', () => {
    const result = inspect([item(1, 'suiting'), item(2, 'bottom')])
    expect(result.silent).toEqual([1, 2])
    expect(result.problems.size).toBe(0)
  })

  it('reports contributions as available, partial or unavailable, logging codes only', () => {
    const logs = captureLogs()
    expect(buildOutfitComponents([item(1, 'suiting', { supports: ['formality'], cites: ['g1.type'] }), item(2, 'bottom', { supports: ['color'], cites: ['g2.colour'] })], 'outfit_items', 2, 'req-m3', outfitObservations).contributions).toBe('available')
    expect(buildOutfitComponents([item(1, 'suiting', { supports: ['formality'], cites: ['g1.type'] }), item(2, 'top', { supports: ['color'], cites: ['g2.colour'] })], 'outfit_items', 2, 'req-m3', outfitObservations).contributions).toBe('partial')
    expect(buildOutfitComponents([item(1, 'suiting'), item(2, 'bottom')], 'outfit_items', 2, 'req-m3', outfitObservations).contributions).toBe('unavailable')
    expect(logs.events().find((event) => event.event === 'outfit_contributions_unavailable')).toMatchObject({ validation: 'partial', problem_codes: ['identity_mismatch'], request_id: 'req-m3' })
    expect(logs.text()).not.toContain('A note long enough')
  })

  it('never changes a rating or the verdict: the six ratings stay those of the whole outfit', () => {
    const dimensions = makeDimensions({ occasion: 'Fair', color: 'Good', formality: 'Poor', seasonality: 'Good', style_preference_match: 'Good' })
    const withContributions = buildCompleteAnalysisResult(dimensions, undefined, { garmentMode: 'outfit_items', outfitComponents: buildOutfitComponents([item(1, 'suiting', { supports: ['formality', 'occasion', 'color', 'seasonality', 'style', 'style_preference_match'], cites: ['g1.type'] }), item(2, 'bottom', { supports: ['formality'], cites: ['g2.type'] })], 'outfit_items', 2, undefined, outfitObservations) })
    expect([withContributions.overall_recommendation, withContributions.verdict_score]).toEqual(Object.values(computeVerdict(dimensions)))
    expect(withContributions.dimensions).toEqual(dimensions)
  })
})

describe('outfit contributions through the API', () => {
  const originalEnv = { ...process.env }
  const form = () => {
    const data = new FormData()
    data.append('occasion', 'Client Presentation')
    data.append('photo', makePng(800, 800, 'photo.png', 200))
    data.append('garment', makePng(800, 800, 'g1.png', 60))
    data.append('garment', makePng(800, 800, 'g2.png', 120))
    data.append('garmentMode', 'outfit_items')
    data.append('styleProfile', JSON.stringify({ preferredStyles: [], favoriteColors: [], occasionPreferences: [] }))
    return data
  }
  const post = () => POST(new Request('http://localhost/api/analyze', { method: 'POST', body: form() }), { params: Promise.resolve({ path: ['analyze'] }) })
  beforeEach(() => { process.env = { ...originalEnv, ANALYSIS_MODE: 'openai', OPENAI_API_KEY: 'sk-test-fake-key-outfit-0000', OPENAI_MODEL: 'gpt-6.1-terra' } })
  afterEach(() => { process.env = { ...originalEnv }; jest.restoreAllMocks() })

  it('returns item contributions checked against the observations of the same answer', async () => {
    const dimensions = allRated('Good')
    const observations = { images: [image(1, { category: 'suiting', garment: 'blazer' }), image(2, { category: 'bottom', garment: 'joggers', details: ['elastic cuffs'] })] }
    jest.spyOn(global, 'fetch').mockImplementation(async () => openAIResponse({
      status: 'complete', observations, dimensions, evidence: evidenceFor(dimensions),
      outfit_components: [item(1, 'suiting', { supports: ['formality'], cites: ['g1.type'] }), item(2, 'top', { tension: ['formality'], cites: ['g2.type'] })],
    }, { usage: { input_tokens: 1, output_tokens: 1 } }))
    captureLogs()
    const body = await (await post()).json()
    expect(body.outfit_components.contributions).toBe('partial')
    expect(body.outfit_components.items[0].contribution).toEqual({ supports: ['formality'], tension: [], unclear: [], cites: ['g1.type'] })
    expect(body.outfit_components.items[1]).not.toHaveProperty('contribution')
    expect(body.outfit_components.items[1].note).toBe('A note long enough to pass validation.')
    expect([body.overall_recommendation, body.verdict_score]).toEqual(['Recommended', 4])
  })
})

describe('multi-view and outfit figures in the evaluation', () => {
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
    expect(evaluate('scenarios-v3').quality.multi_image_reasoning).toMatchObject({ applicable: false, reason: UNAVAILABLE_BEFORE_PHASE4 })
  })

  it('pass every scenarios-v4 case, including the expected item contributions', () => {
    const report = evaluate('scenarios-v4')
    expect(report.cases.filter((entry) => entry.status !== 'pass').map((entry) => [entry.case_id, entry.failure_reasons])).toEqual([])
    expect(report.composition.cases_by_mode.same_garment_views).toBeGreaterThanOrEqual(10)
    expect(report.composition.cases_by_mode.outfit_items).toBeGreaterThanOrEqual(10)
  })

  it('each figure detects exactly the case written to fail it', () => {
    const report = evaluate('scenarios-v4').quality.multi_image_reasoning
    expect(report.view_colour_difference_explained_rate.value).toBeLessThan(1)
    expect(without('v4-views-lighting-unexplained').quality.multi_image_reasoning.view_colour_difference_explained_rate.value).toBe(1)
    expect(report.view_conflict_confidence_rate.value).toBeLessThan(1)
    expect(without('v4-views-conflict-overconfident').quality.multi_image_reasoning.view_conflict_confidence_rate.value).toBe(1)
    expect(report.duplicate_identity_rate.value).toBeGreaterThan(0)
    expect(without('v4-outfit-duplicate-item').quality.multi_image_reasoning.duplicate_identity_rate.value).toBe(0)
    expect(report.identity_mismatch_rate.value).toBeGreaterThan(0)
    expect(without('v4-outfit-identity-mismatch').quality.multi_image_reasoning.identity_mismatch_rate.value).toBe(0)
    expect(report.outfit_colour_evidence_breadth_rate.value).toBe(1)
  })

  it('fails the blocking check when the contributions a case expects do not come back', () => {
    const report = evaluate('scenarios-v4', (recording) => {
      for (const entry of recording.entries.filter((item) => item.case_id === 'v4-outfit-office-three')) {
        for (const component of (entry.output as { outfit_components: Array<Record<string, unknown>> }).outfit_components) component.cites = ['g9.type'].slice(1)
      }
    })
    const failure = report.cases.find((entry) => entry.case_id === 'v4-outfit-office-three')
    expect(failure?.status).toBe('fail')
    expect(failure?.failure_reasons.join(' ')).toMatch(/item contributions were unavailable, expected available/)
  })
})
