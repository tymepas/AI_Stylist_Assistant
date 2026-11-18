/**
 * Phase 4 Milestone 1: rating evidence, its cross-references to observations,
 * and its isolation from the verdict and from the Shopping Advisor.
 *
 * No model is called; every block is hand-written.
 */

import { afterEach, describe, expect, it, jest } from '@jest/globals'
import { buildCompleteAnalysisResult } from '@/lib/services/analysisResultService'
import { computeVerdict } from '@/lib/services/analysisService'
import { buildShoppingAdvisor } from '@/lib/services/shoppingAdvisorService'
import { EVIDENCE_PROBLEMS, inspectEvidence, type EvidenceContext } from '@/lib/services/openai/ratingEvidenceSchema'
import { inspectObservations } from '@/lib/services/openai/observationsSchema'
import { buildVisualEvidence, hasStylePreferences } from '@/lib/services/visualEvidenceService'
import { mockVisualEvidenceRaw } from '@/lib/services/mockVisualEvidence'
import { GARMENT_MODES } from '@/lib/constants/garmentModes'
import type { RawOpenAIDimensions } from '@/types/openai'
import { allRated, makeDimensions, VALID_RECOMMENDATION } from '../helpers/fixtures'
import { captureLogs } from '../logging/logTestUtils'
import { evidenceFor, image } from '../helpers/visualFixtures'

const EMPTY_PROFILE = { preferredStyles: [], favoriteColors: [], occasionPreferences: [] }
const PROFILE = { preferredStyles: ['Classic'], favoriteColors: ['Navy'], occasionPreferences: [] }

const observations = inspectObservations({ images: [image(1, { details: ['notched lapels', 'two-button front'] })] }, { mode: 'single', garmentCount: 1 }).value

function context(dimensions: RawOpenAIDimensions, overrides: Partial<EvidenceContext> = {}): EvidenceContext {
  return { dimensions, observations, hasStyleDna: false, hasStylePreferences: true, ...overrides }
}

afterEach(() => {
  jest.restoreAllMocks()
})

describe('evidence for each of the six dimensions', () => {
  it('is available when every dimension cites existing observations and names inputs that were sent', () => {
    const dimensions = allRated('Good')
    const result = inspectEvidence(evidenceFor(dimensions), context(dimensions))
    expect(result.value.availability).toBe('available')
    expect(Object.keys(result.value.dimensions).sort()).toEqual(['color', 'formality', 'occasion', 'seasonality', 'style', 'style_preference_match'])
    expect(result.value.dimensions.color).toEqual({ sources: ['person_photo', 'garment_images'], cites: ['g1.colour'], support: 'sufficient' })
  })

  it('keeps the dimensions that are valid when others are not: partial, never all-or-nothing', () => {
    const dimensions = allRated('Good')
    const raw = evidenceFor(dimensions, { color: { cites: ['g2.colour'] } })
    const result = inspectEvidence(raw, context(dimensions))
    expect(result.value.availability).toBe('partial')
    expect(result.value.dimensions.color).toBeUndefined()
    expect(result.problems.color).toEqual(['invalid_citation'])
    expect(Object.keys(result.value.dimensions)).toHaveLength(5)
  })

  it('is unavailable when the block is not an object, or has an unknown key', () => {
    const dimensions = allRated('Good')
    expect(inspectEvidence('the colour is navy', context(dimensions))).toMatchObject({ value: { availability: 'unavailable', dimensions: {} }, blockProblems: ['schema'] })
    expect(inspectEvidence({ ...evidenceFor(dimensions), verdict: { sources: ['occasion'], cites: [], support: 'sufficient' } }, context(dimensions)).blockProblems).toEqual(['schema'])
  })

  it.each<[string, (dimensions: RawOpenAIDimensions) => Record<string, unknown>, Partial<EvidenceContext>, string]>([
    ['a dimension left out', (d) => { const raw = evidenceFor(d); delete raw.seasonality; return raw }, {}, 'missing_dimension'],
    ['an unknown source', (d) => evidenceFor(d, { occasion: { sources: ['wardrobe'] } }), {}, 'schema'],
    ['a free-text explanation field', (d) => evidenceFor(d, { occasion: { reason: 'It suits the office.' } }), {}, 'schema'],
    ['a citation in the wrong format', (d) => evidenceFor(d, { occasion: { cites: ['image 1 type'] } }), {}, 'schema'],
    ['five citations', (d) => evidenceFor(d, { formality: { cites: ['g1.type', 'g1.colour', 'g1.pattern', 'g1.d1', 'g1.d2'] } }), {}, 'schema'],
    ['a missing note longer than 80 characters', (d) => evidenceFor(d, { occasion: { support: 'partial', missing: 'x'.repeat(81) } }), {}, 'schema'],
    ['a citation of an image that was not sent', (d) => evidenceFor(d, { color: { cites: ['g3.colour'] } }), {}, 'invalid_citation'],
    ['a citation of a detail that was never observed', (d) => evidenceFor(d, { formality: { cites: ['g1.d3'] } }), {}, 'invalid_citation'],
    ['any citation when the observations are unavailable', (d) => evidenceFor(d), { observations: null }, 'invalid_citation'],
    ['citations without the garment images as a source', (d) => evidenceFor(d, { color: { sources: ['person_photo'] } }), {}, 'source_mismatch'],
    ['Style DNA named when none was sent', (d) => evidenceFor(d, { style_preference_match: { sources: ['garment_images', 'style_dna'] } }), {}, 'unsupplied_source'],
    ['style preferences named when the user stated none', (d) => evidenceFor(d, { style: { sources: ['garment_images', 'style_preferences'] } }), { hasStylePreferences: false }, 'unsupplied_source'],
    ['the same source twice', (d) => evidenceFor(d, { occasion: { sources: ['occasion', 'occasion'] } }), {}, 'duplicate_entry'],
    ['a rated dimension with insufficient support', (d) => evidenceFor(d, { occasion: { support: 'insufficient', missing: 'Nothing visible' } }), {}, 'support_conflict'],
    ['partial support with no note of what was missing', (d) => evidenceFor(d, { occasion: { support: 'partial' } }), {}, 'missing_unexplained'],
    ['a price judgement in the missing note', (d) => evidenceFor(d, { occasion: { support: 'partial', missing: 'Looks expensive for the office' } }), {}, 'unsupported_text'],
  ])('drops a dimension with %s', (_label, build, overrides, problem) => {
    const dimensions = allRated('Good')
    const result = inspectEvidence(build(dimensions), context(dimensions, overrides))
    expect(Object.values(result.problems).flat()).toContain(problem)
    expect(result.value.availability).not.toBe('available')
    expect(EVIDENCE_PROBLEMS).toContain(problem)
  })

  it('an unrated dimension may not claim sufficient support; insufficient with a note is accepted', () => {
    const dimensions = makeDimensions({ occasion: 'Good', color: 'Good', formality: 'Good', seasonality: 'Unable to Evaluate', style_preference_match: 'Good' })
    const conflicting = inspectEvidence(evidenceFor(dimensions, { seasonality: { support: 'sufficient', missing: undefined } }), context(dimensions))
    expect(conflicting.problems.seasonality).toEqual(['support_conflict'])
    const honest = inspectEvidence(evidenceFor(dimensions), context(dimensions))
    expect(honest.value.dimensions.seasonality).toEqual({ sources: ['garment_images'], cites: ['g1.type'], support: 'insufficient', missing: 'Not enough is visible to judge this' })
  })

  it('accepts Style DNA as a source exactly when a profile was sent', () => {
    const dimensions = allRated('Good')
    const raw = evidenceFor(dimensions, { style_preference_match: { sources: ['garment_images', 'style_preferences', 'style_dna'] } })
    expect(inspectEvidence(raw, context(dimensions, { hasStyleDna: true })).value.availability).toBe('available')
    expect(inspectEvidence(raw, context(dimensions, { hasStyleDna: false })).problems.style_preference_match).toEqual(['unsupplied_source'])
  })

  it('knows when the user stated preferences', () => {
    expect(hasStylePreferences(EMPTY_PROFILE)).toBe(false)
    expect(hasStylePreferences({ ...EMPTY_PROFILE, favoriteColors: ['Navy'] })).toBe(true)
  })
})

describe('the application builds both blocks separately from the ratings', () => {
  const input = (overrides: Partial<Parameters<typeof buildVisualEvidence>[0]> = {}): Parameters<typeof buildVisualEvidence>[0] => {
    const dimensions = allRated('Good')
    return {
      rawObservations: { images: [image(1)] },
      rawEvidence: evidenceFor(dimensions),
      dimensions,
      garmentMode: 'single',
      garmentCount: 1,
      hasStyleDna: false,
      styleProfile: PROFILE,
      requestId: 'req-visual',
      ...overrides,
    }
  }

  it('returns both blocks when both are valid, and logs nothing', () => {
    const logs = captureLogs()
    const result = buildVisualEvidence(input())
    expect(result.observations.availability).toBe('available')
    expect(result.evidence.availability).toBe('available')
    expect(logs.events()).toEqual([])
  })

  it('marks missing blocks unavailable and says they were absent', () => {
    const logs = captureLogs()
    const result = buildVisualEvidence(input({ rawObservations: undefined, rawEvidence: undefined }))
    expect(result).toEqual({ observations: { availability: 'unavailable', images: [] }, evidence: { availability: 'unavailable', dimensions: {} } })
    expect(logs.events().map((event) => [event.event, event.validation])).toEqual([['observations_unavailable', 'absent'], ['rating_evidence_unavailable', 'absent']])
  })

  it('logs problem codes and schema paths only, never the text of the block', () => {
    const logs = captureLogs()
    const result = buildVisualEvidence(input({
      rawObservations: { images: [image(1, { details: ['PRIVATE-DETAIL-MARKER 100% silk'] })] },
      rawEvidence: { ...evidenceFor(allRated('Good')), occasion: { sources: ['occasion'], cites: [], support: 'partial', missing: 'PRIVATE-NOTE-MARKER' } },
    }))
    expect(result.observations.availability).toBe('unavailable')
    const events = logs.events()
    expect(events.find((event) => event.event === 'observations_unavailable')).toMatchObject({ validation: 'failed', problem_codes: ['unsupported_text'], request_id: 'req-visual' })
    expect(events.find((event) => event.event === 'rating_evidence_unavailable')).toMatchObject({ validation: 'partial', problem_codes: ['invalid_citation'], dimension_count: 1 })
    expect(logs.text()).not.toMatch(/PRIVATE-|silk/)
  })

  it('drops evidence that cites observations which were refused: a rating never rests on something that does not exist', () => {
    const result = buildVisualEvidence(input({ rawObservations: { images: [image(1, { category: 'jacket' })] } }))
    expect(result.observations.availability).toBe('unavailable')
    expect(result.evidence.availability).toBe('unavailable')
  })
})

describe('isolation: nothing in either block reaches the verdict', () => {
  const ratingSets: RawOpenAIDimensions[] = [
    allRated('Excellent'),
    allRated('Poor'),
    makeDimensions({ occasion: 'Good', color: 'Fair', formality: 'Excellent', seasonality: 'Unable to Evaluate', style_preference_match: 'Poor' }),
    makeDimensions({ occasion: 'Unable to Evaluate', color: 'Unable to Evaluate', formality: 'Unable to Evaluate', seasonality: 'Unable to Evaluate', style_preference_match: 'Unable to Evaluate' }),
  ]

  it.each(ratingSets.map((dimensions, index) => [index, dimensions] as const))('ratings set %i: the same verdict with valid, invalid, partial or missing blocks', (_index, dimensions) => {
    const expected = computeVerdict(dimensions)
    const variants = [
      buildVisualEvidence({ rawObservations: { images: [image(1)] }, rawEvidence: evidenceFor(dimensions), dimensions, garmentMode: 'single', garmentCount: 1, hasStyleDna: false, styleProfile: PROFILE }),
      buildVisualEvidence({ rawObservations: 'garbage', rawEvidence: { occasion: 'garbage' }, dimensions, garmentMode: 'single', garmentCount: 1, hasStyleDna: false, styleProfile: PROFILE }),
      buildVisualEvidence({ rawObservations: undefined, rawEvidence: undefined, dimensions, garmentMode: 'single', garmentCount: 1, hasStyleDna: false, styleProfile: PROFILE }),
    ]
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    for (const visual of variants) {
      const result = buildCompleteAnalysisResult(dimensions, undefined, visual)
      expect({ band: result.overall_recommendation, score: result.verdict_score }).toEqual({ band: expected.overall_recommendation, score: expected.verdict_score })
      // The ratings are returned exactly as given.
      expect(result.dimensions).toEqual(dimensions)
    }
  })

  it('a block that disagrees with the ratings never changes them: evidence is dropped, the rating stays', () => {
    const dimensions = allRated('Excellent')
    const visual = buildVisualEvidence({ rawObservations: { images: [image(1)] }, rawEvidence: evidenceFor(dimensions, { occasion: { support: 'insufficient', missing: 'Nothing visible' } }), dimensions, garmentMode: 'single', garmentCount: 1, hasStyleDna: false, styleProfile: PROFILE })
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const result = buildCompleteAnalysisResult(dimensions, undefined, visual)
    expect(result.dimensions.occasion.rating).toBe('Excellent')
    expect(result.evidence?.dimensions.occasion).toBeUndefined()
    expect(result.overall_recommendation).toBe('Highly Recommended')
  })

  it('the Shopping Advisor is built without the blocks and the blocks without the advisor', () => {
    const dimensions = allRated('Fair')
    const advisor = buildShoppingAdvisor({ recommendations: [VALID_RECOMMENDATION] }, true)
    const visual = buildVisualEvidence({ rawObservations: { images: [image(1)] }, rawEvidence: evidenceFor(dimensions), dimensions, garmentMode: 'single', garmentCount: 1, hasStyleDna: true, styleProfile: PROFILE })
    const withBoth = buildCompleteAnalysisResult(dimensions, advisor, visual)
    const advisorOnly = buildCompleteAnalysisResult(dimensions, advisor)
    expect(withBoth.shopping_advisor).toEqual(advisorOnly.shopping_advisor)
    expect([withBoth.overall_recommendation, withBoth.verdict_score]).toEqual([advisorOnly.overall_recommendation, advisorOnly.verdict_score])
    expect(withBoth.observations).toEqual(visual.observations)
  })

  it('computeVerdict reads the six ratings and nothing else', () => {
    const source = computeVerdict.toString()
    for (const field of ['observations', 'evidence', 'shopping_advisor', 'outfit_components']) expect(source).not.toContain(field)
  })
})

describe('mock mode', () => {
  it.each(GARMENT_MODES.map((mode) => [mode, mode === 'single' ? 1 : 3] as const))('%s: the mock blocks pass the production validation and say no image was analysed', (mode, count) => {
    for (const dimensions of [allRated('Good'), makeDimensions({ occasion: 'Poor', color: 'Unable to Evaluate', formality: 'Fair', seasonality: 'Good', style_preference_match: 'Poor' })]) {
      for (const [hasStyleDna, profile] of [[false, EMPTY_PROFILE], [true, PROFILE]] as const) {
        const raw = mockVisualEvidenceRaw(dimensions, mode, count, { hasStyleDna, hasStylePreferences: hasStylePreferences(profile) })
        const visual = buildVisualEvidence({ ...raw, dimensions, garmentMode: mode, garmentCount: count, hasStyleDna, styleProfile: profile })
        expect(visual.observations.availability).toBe('available')
        expect(visual.evidence.availability).toBe('available')
        expect(visual.observations.images).toHaveLength(count)
        for (const entry of visual.observations.images) {
          expect(entry.details).toEqual(['Mock example: no image was analysed'])
          // Nothing is reported as observed: no image was analysed.
          expect(entry).toMatchObject({ identification: 'not_visible', category: 'unclear', colour_status: 'not_visible', pattern: 'unclear', garment: null })
        }
      }
    }
  })
})
