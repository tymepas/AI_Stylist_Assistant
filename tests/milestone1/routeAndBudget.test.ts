/**
 * Phase 4 Milestone 1 through the real API route, plus the prompt and output
 * budget safeguards.
 *
 * OpenAI is mocked: no network call, no spend. Every image is synthetic.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { readFileSync } from 'node:fs'
import path from 'node:path'

jest.mock('server-only', () => ({}), { virtual: true })

import { POST } from '@/app/api/[[...path]]/route'
import { resolveModelConfig } from '@/lib/services/openai/modelConfig'
import { ANALYSIS_OUTPUT_SCHEMA_VERSION, schemaHasVisualEvidence, validateRawOpenAIAnalysis } from '@/lib/services/openai/openAIAnalysisSchema'
import { IMAGE_LIMITS, MAX_DETAILS, inspectObservations } from '@/lib/services/openai/observationsSchema'
import { EVIDENCE_SOURCES, MAX_CITES, inspectEvidence } from '@/lib/services/openai/ratingEvidenceSchema'
import { utf8ByteLength } from '@/lib/services/requestLimits'
import { computeVerdict } from '@/lib/services/analysisService'
import { allRated, makeDimensions, makePng, openAIResponse } from '../helpers/fixtures'
import { captureLogs } from '../logging/logTestUtils'
import { evidenceFor, image } from '../helpers/visualFixtures'

const originalEnv = { ...process.env }
const PROFILE = JSON.stringify({ preferredStyles: ['Classic'], favoriteColors: ['Navy'], occasionPreferences: [] })

function analyzeForm(garmentCount = 1, mode?: string): FormData {
  const data = new FormData()
  data.append('occasion', 'Client Presentation')
  data.append('photo', makePng(800, 800, 'photo.png', 200))
  for (let index = 0; index < garmentCount; index += 1) data.append('garment', makePng(800, 800, `garment-${index}.png`, 60 + index * 30))
  data.append('styleProfile', PROFILE)
  if (mode) data.append('garmentMode', mode)
  return data
}

function post(body: FormData) {
  return POST(new Request('http://localhost/api/analyze', { method: 'POST', body }), { params: Promise.resolve({ path: ['analyze'] }) })
}

const respond = (output: Record<string, unknown>) => openAIResponse(output, { usage: { input_tokens: 1, output_tokens: 1 } })

beforeEach(() => {
  process.env = { ...originalEnv, ANALYSIS_MODE: 'openai', OPENAI_API_KEY: 'sk-test-fake-key-visual-0000', OPENAI_MODEL: 'gpt-6.1-terra' }
})

afterEach(() => {
  process.env = { ...originalEnv }
  jest.restoreAllMocks()
})

describe('the analysis route with observations and evidence', () => {
  it('returns validated observations and evidence next to the verdict the application calculated', async () => {
    const dimensions = makeDimensions({ occasion: 'Good', color: 'Excellent', formality: 'Good', seasonality: 'Fair', style_preference_match: 'Good' })
    jest.spyOn(global, 'fetch').mockImplementation(async () => respond({ status: 'complete', observations: { images: [image(1)] }, dimensions, evidence: evidenceFor(dimensions) }))
    captureLogs()
    const body = await (await post(analyzeForm())).json()
    expect(body.observations).toEqual({ availability: 'available', images: [image(1)] })
    expect(body.evidence.availability).toBe('available')
    expect([body.overall_recommendation, body.verdict_score]).toEqual(Object.values(computeVerdict(dimensions)))
  })

  it('keeps valid ratings and the verdict when both blocks are malformed, and marks them unavailable', async () => {
    const dimensions = allRated('Good')
    jest.spyOn(global, 'fetch').mockImplementation(async () => respond({ status: 'complete', observations: { images: 'navy blazer' }, dimensions, evidence: ['g1.type'] }))
    const logs = captureLogs()
    const response = await post(analyzeForm())
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ status: 'complete', overall_recommendation: 'Recommended', verdict_score: 4, dimensions })
    expect(body.observations).toEqual({ availability: 'unavailable', images: [] })
    expect(body.evidence).toEqual({ availability: 'unavailable', dimensions: {} })
    expect(logs.text()).not.toContain('navy blazer')
  })

  it('keeps the six ratings, unchanged, when the model leaves both blocks out (an analysis-output/2 answer)', async () => {
    const dimensions = allRated('Fair')
    jest.spyOn(global, 'fetch').mockImplementation(async () => respond({ status: 'complete', dimensions }))
    captureLogs()
    const body = await (await post(analyzeForm())).json()
    expect(body.dimensions).toEqual(dimensions)
    expect(body.overall_recommendation).toBe('Consider Alternatives')
    expect(body.observations.availability).toBe('unavailable')
  })

  it('maps observations to the images of each garment mode', async () => {
    const dimensions = allRated('Good')
    const views = { images: [image(1), image(2, { details: ['back vent'] })], views: { same_garment: 'yes' } }
    jest.spyOn(global, 'fetch').mockImplementation(async () => respond({ status: 'complete', observations: views, dimensions, evidence: evidenceFor(dimensions) }))
    captureLogs()
    const viewsBody = await (await post(analyzeForm(2, 'same_garment_views'))).json()
    expect(viewsBody.observations.views).toEqual({ same_garment: 'yes' })
    expect(viewsBody.observations.images).toHaveLength(2)

    // The same two entries sent for an outfit carry a views entry, which belongs to views only: refused.
    const outfitBody = await (await post(analyzeForm(2, 'outfit_items'))).json()
    expect(outfitBody.observations.availability).toBe('unavailable')
    expect(outfitBody.overall_recommendation).toBe(viewsBody.overall_recommendation)
  })

  it('keeps the six ratings when the model puts views at the top level instead of inside observations', async () => {
    const dimensions = allRated('Good')
    jest.spyOn(global, 'fetch').mockImplementation(async () => respond({ status: 'complete', observations: { images: [image(1), image(2)] }, views: { same_garment: 'yes' }, dimensions, evidence: evidenceFor(dimensions) }))
    captureLogs()
    const response = await post(analyzeForm(2, 'same_garment_views'))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ status: 'complete', overall_recommendation: 'Recommended', dimensions })
    expect(body.observations.availability).toBe('unavailable')
    expect(body).not.toHaveProperty('views')
  })

  it('still refuses an output that carries its own verdict, whatever the new blocks contain', () => {
    const dimensions = allRated('Good')
    expect(() => validateRawOpenAIAnalysis({ status: 'complete', dimensions, observations: { images: [image(1)] }, evidence: evidenceFor(dimensions), overall_recommendation: 'Highly Recommended' })).toThrow()
  })
})

describe('mock mode (Preview)', () => {
  it('returns mock observations and evidence that say no image was analysed', async () => {
    process.env = { ...originalEnv, ANALYSIS_MODE: 'mock' }
    jest.spyOn(Math, 'random').mockReturnValue(0.1)
    const fetchSpy = jest.spyOn(global, 'fetch')
    captureLogs()
    // Mock mode waits 1.4 to 2.4 seconds on purpose, to look like a real analysis.
    const body = await (await post(analyzeForm(3, 'outfit_items'))).json()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(body.observations.availability).toBe('available')
    expect(body.observations.images.map((entry: { image: number; details: string[] }) => [entry.image, entry.details])).toEqual([1, 2, 3].map((n) => [n, ['Mock example: no image was analysed']]))
    expect(body.evidence.availability).toBe('available')
    // A mock result describes no photo, so it carries no consistency flags (Phase 4 Milestone 4).
    expect(body.consistency).toBeUndefined()
  }, 20_000)
})

describe('versions', () => {
  it('the output schema is analysis-output/4 (Phase 4), and only /3 or later is expected to carry the blocks', () => {
    expect(ANALYSIS_OUTPUT_SCHEMA_VERSION).toBe('analysis-output/4')
    expect(schemaHasVisualEvidence('analysis-output/3')).toBe(true)
    expect(schemaHasVisualEvidence('analysis-output/4')).toBe(true)
    for (const older of ['analysis-output/2', 'analysis-output/1', 'analysis-output/0', 'profile-output/1.0', 'nonsense']) expect(schemaHasVisualEvidence(older)).toBe(false)
  })
})

describe('budget safeguards: no limit was raised to make room', () => {
  it('keeps the model configuration exactly as it was', () => {
    const terra = resolveModelConfig('gpt-6.1-terra')!
    const gpt41 = resolveModelConfig('gpt-4.1')!
    expect(terra.operations.analysis).toEqual({ maxOutputTokens: 4_000, timeoutMs: 45_000, maxTextInputTokens: 8_000 })
    expect(gpt41.operations.analysis).toEqual({ maxOutputTokens: 1_500, timeoutMs: 20_000, maxTextInputTokens: 8_000 })
    expect([terra.reasoningEffort, terra.maxImageInputTokens]).toEqual(['low', 3_600])
  })

  /**
   * The largest blocks validation can accept: three images with every field at its longest, a views note at
   * its longest, and evidence for six dimensions with every source, four citations and the longest note.
   * Every token covers at least one byte, so the byte count is a hard upper bound on the tokens the two
   * blocks can add to an answer.
   */
  function largestBlocks(): { observations: unknown; evidence: unknown } {
    const longest = (length: number) => 'w'.repeat(length - 2).padStart(length - 1, ' ').replace(/^ /, 'a') + 'z'
    const entry = (n: number) => image(n, {
      garment: longest(32),
      category: 'traditional_wear',
      identification: 'uncertain',
      colours: { dominant: ['multicolour', 'silver'], secondary: ['purple'] },
      colour_status: 'uncertain',
      pattern: 'textured',
      details: Array.from({ length: MAX_DETAILS }, (_, index) => `${index}${longest(47)}`),
      limits: [...IMAGE_LIMITS].sort((a, b) => b.length - a.length).slice(0, 4),
    })
    const observations = { images: [entry(1), entry(2), entry(3)], views: { same_garment: 'unclear', conflicts: longest(100) } }
    const unrated = makeDimensions({ occasion: 'Unable to Evaluate', color: 'Unable to Evaluate', formality: 'Unable to Evaluate', seasonality: 'Unable to Evaluate', style_preference_match: 'Unable to Evaluate' })
    const dimensions = { ...unrated, style: { ...unrated.style, rating: 'Unable to Evaluate' as const } }
    const dimension = { sources: [...EVIDENCE_SOURCES], cites: ['g1.d1', 'g2.d2', 'g3.d3', 'g1.d2'].slice(0, MAX_CITES), support: 'insufficient', missing: longest(80) }
    const evidence = Object.fromEntries(['occasion', 'color', 'formality', 'seasonality', 'style', 'style_preference_match'].map((key) => [key, dimension]))
    // Both must really be accepted, or the bound would not be a bound.
    const validObservations = inspectObservations(observations, { mode: 'same_garment_views', garmentCount: 3 }).value
    expect(validObservations).not.toBeNull()
    const inspected = inspectEvidence(evidence, { dimensions, observations: validObservations, hasStyleDna: true, hasStylePreferences: true })
    expect(inspected.problems).toEqual({})
    return { observations, evidence }
  }

  it('bounds what the two blocks can add to an answer: at most 3,200 bytes, so at most 3,200 tokens', () => {
    const blocks = largestBlocks()
    const bytes = utf8ByteLength(JSON.stringify(blocks))
    // Measured when the limits were set (Phase 4 Milestone 1): 3,174 bytes. Raising any field limit must keep this true.
    expect(bytes).toBeLessThanOrEqual(3_200)
  })

  it('keeps every scenarios-v3 reference answer under 3,600 bytes, so under 3,600 tokens even at one token per byte', () => {
    // The reference outputs are hand-written, so this bounds their shape, not what a model will write. Real token
    // counts are only known from usage reported by a live run, which needs separate approval.
    const recording = JSON.parse(readFileSync(path.join(process.cwd(), 'evaluation', 'datasets', 'scenarios-v3', 'recording.json'), 'utf8')) as { entries: Array<{ output: Record<string, unknown> }> }
    const sizes = recording.entries.map((entry) => ({
      total: utf8ByteLength(JSON.stringify(entry.output)),
      blocks: utf8ByteLength(JSON.stringify({ observations: entry.output.observations, evidence: entry.output.evidence })),
    }))
    expect(Math.max(...sizes.map((size) => size.total))).toBeLessThanOrEqual(3_600)
    // The two new blocks are less than half of the largest answers.
    const largest = sizes.reduce((a, b) => (b.total > a.total ? b : a))
    expect(largest.blocks / largest.total).toBeLessThan(0.5)

  })
})
