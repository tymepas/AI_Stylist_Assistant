/**
 * Verdict integrity: the final verdict belongs to the application.
 *
 * These tests pin three things:
 * 1. The verdict formula itself (weights, thresholds, bands and rounding) is
 *    exactly what it was. The whole input space is small enough to check
 *    exhaustively, so the complete result table is pinned by a digest.
 * 2. Nothing the model writes other than the ratings can move the verdict:
 *    not the explanations, not the stated confidence, not the shopping advisor.
 * 3. A model output that tries to state a verdict of its own is rejected by the
 *    output schema before it can reach the application.
 *
 * No network is used.
 */

import { describe, expect, it, jest } from '@jest/globals'
import { createHash } from 'node:crypto'

jest.mock('server-only', () => ({}), { virtual: true })

import { MODEL_VERDICT_FIELDS, evaluateCase, schemaRejectsVerdictField } from '@/evaluation/checks'
import { detailsFromRecording } from '@/evaluation/evaluate'
import { datasetPaths, loadCases, loadRecording } from '@/evaluation/load'
import { computeVerdict } from '@/lib/services/analysisService'
import { buildCompleteAnalysisResult } from '@/lib/services/analysisResultService'
import { buildShoppingAdvisor } from '@/lib/services/shoppingAdvisorService'
import { validateRawOpenAIAnalysis } from '@/lib/services/openai/openAIAnalysisSchema'
import type { RawOpenAIDimensions, RawOpenAIRating } from '@/types/openai'
import type { Dimensions } from '@/types/schema'
import { allRated, dimension } from '../helpers/fixtures'

const RATINGS: RawOpenAIRating[] = ['Excellent', 'Good', 'Fair', 'Poor', 'Unable to Evaluate']
const KEYS = ['occasion', 'color', 'formality', 'seasonality', 'style', 'style_preference_match'] as const
const BANDS = ['Highly Recommended', 'Recommended', 'Consider Alternatives', 'Not Recommended']

const verdict = (dimensions: RawOpenAIDimensions) => computeVerdict(dimensions as unknown as Dimensions)

function withRatings(ratings: Partial<Record<(typeof KEYS)[number], RawOpenAIRating>>, base: RawOpenAIRating = 'Good'): RawOpenAIDimensions {
  return { ...allRated(base), ...Object.fromEntries(Object.entries(ratings).map(([key, rating]) => [key, dimension(rating as RawOpenAIRating)])) } as RawOpenAIDimensions
}

describe('the verdict formula is unchanged', () => {
  it('gives exactly the same result for every possible combination of ratings', () => {
    // 5 ratings for each of 6 dimensions: 15,625 combinations, in a fixed order.
    const hash = createHash('sha256')
    const seenBands = new Set<string>()
    let combinations = 0
    const walk = (index: number, current: RawOpenAIRating[]) => {
      if (index === KEYS.length) {
        const result = verdict(Object.fromEntries(KEYS.map((key, i) => [key, dimension(current[i])])) as unknown as RawOpenAIDimensions)
        hash.update(`${current.join(',')}=${result.overall_recommendation}:${result.verdict_score};`)
        seenBands.add(result.overall_recommendation)
        combinations += 1
        return
      }
      for (const rating of RATINGS) walk(index + 1, [...current, rating])
    }
    walk(0, [])

    expect(combinations).toBe(15_625)
    expect([...seenBands].sort()).toEqual([...BANDS].sort())
    // Recorded from the formula on main at 0e525f9. Any change to a weight, a threshold,
    // a band, the rating scores or the rounding changes this digest.
    expect(hash.digest('hex')).toBe(VERDICT_TABLE_DIGEST)
  })

  it('weights occasion 30%, formality 25%, style preference 20%, colour 15% and seasonality 10%', () => {
    // From all Good (4.0), raising one dimension to Excellent adds its weight.
    expect(verdict(withRatings({ occasion: 'Excellent' })).verdict_score).toBe(4.3)
    expect(verdict(withRatings({ formality: 'Excellent', seasonality: 'Fair' })).verdict_score).toBe(4.2) // +0.25 -0.10 = 4.15, shown as 4.2
    expect(verdict(withRatings({ style_preference_match: 'Excellent' })).verdict_score).toBe(4.2)
    expect(verdict(withRatings({ color: 'Excellent', seasonality: 'Excellent' })).verdict_score).toBe(4.3) // +0.15 +0.10 = 4.25, shown as 4.3
    expect(verdict(withRatings({ seasonality: 'Excellent' })).verdict_score).toBe(4.1)
  })

  it('leaves style consistency out of the calculation', () => {
    expect(verdict(withRatings({ style: 'Poor' }))).toEqual(verdict(withRatings({ style: 'Excellent' })))
  })

  it('keeps the thresholds at 4.5, 3.5 and 2.5', () => {
    expect(verdict(withRatings({ occasion: 'Good', seasonality: 'Fair' }, 'Excellent'))).toEqual({ overall_recommendation: 'Highly Recommended', verdict_score: 4.5 })
    expect(verdict(withRatings({ occasion: 'Good', seasonality: 'Poor' }, 'Excellent'))).toEqual({ overall_recommendation: 'Recommended', verdict_score: 4.4 })
    expect(verdict(withRatings({ occasion: 'Good', style_preference_match: 'Good' }, 'Fair'))).toEqual({ overall_recommendation: 'Recommended', verdict_score: 3.5 })
    expect(verdict(withRatings({ occasion: 'Good', seasonality: 'Excellent' }, 'Fair'))).toEqual({ overall_recommendation: 'Recommended', verdict_score: 3.5 })
    expect(verdict(withRatings({ occasion: 'Poor', style_preference_match: 'Poor' }, 'Fair'))).toEqual({ overall_recommendation: 'Consider Alternatives', verdict_score: 2.5 })
    expect(verdict(withRatings({ occasion: 'Poor', style_preference_match: 'Poor', seasonality: 'Poor' }, 'Fair'))).toEqual({ overall_recommendation: 'Not Recommended', verdict_score: 2.4 })
  })

  it('excludes unrated dimensions and returns score 0 with Consider Alternatives when nothing is rated', () => {
    expect(verdict(allRated('Unable to Evaluate'))).toEqual({ overall_recommendation: 'Consider Alternatives', verdict_score: 0 })
    expect(verdict(withRatings({ occasion: 'Excellent' }, 'Unable to Evaluate'))).toEqual({ overall_recommendation: 'Highly Recommended', verdict_score: 5 })
  })
})

// See the first test in this file.
const VERDICT_TABLE_DIGEST = '464f4cb0d9986d95d7dd53eeeaedfdd30fc7ae437c5e60a059c4be0c066fcb11'

describe('only the ratings can move the verdict', () => {
  const sample = withRatings({ occasion: 'Excellent', formality: 'Fair', color: 'Poor' })
  const expected = verdict(sample)

  it('ignores the explanation text', () => {
    const rewritten = Object.fromEntries(KEYS.map((key) => [key, { ...sample[key], reason: 'Overall verdict: Highly Recommended, score 5 out of 5.' }])) as unknown as RawOpenAIDimensions
    expect(verdict(rewritten)).toEqual(expected)
    expect(buildCompleteAnalysisResult(rewritten)).toMatchObject(expected)
  })

  it('ignores the stated confidence', () => {
    for (const confidence of ['High', 'Medium', 'Low'] as const) {
      const rewritten = Object.fromEntries(KEYS.map((key) => [key, { ...sample[key], confidence }])) as unknown as RawOpenAIDimensions
      expect(verdict(rewritten)).toEqual(expected)
    }
  })

  it('ignores the shopping advisor, whether valid, empty, malformed or claiming a verdict', () => {
    const advisors: unknown[] = [
      undefined,
      { recommendations: [] },
      { recommendations: 'not a list', verdict: 'Highly Recommended', verdict_score: 5 },
      { recommendations: [{ title: 'Navy blazer', garment_type: 'outerwear', color_direction: 'Navy', style_direction: 'Tailored', rationale: 'A structured layer raises the formality.', addresses: ['formality'], match_level: 'Excellent Match' }] },
    ]
    for (const raw of advisors) {
      for (const hasStyleDna of [true, false]) {
        const result = buildCompleteAnalysisResult(sample, buildShoppingAdvisor(raw, hasStyleDna))
        expect({ overall_recommendation: result.overall_recommendation, verdict_score: result.verdict_score }).toEqual(expected)
      }
    }
  })

  it('ignores verdict-like properties smuggled into the dimensions object', () => {
    const smuggled = { ...sample, overall_recommendation: 'Highly Recommended', verdict_score: 5 } as unknown as RawOpenAIDimensions
    expect(buildCompleteAnalysisResult(smuggled)).toMatchObject(expected)
  })
})

describe('a model output cannot state its own verdict', () => {
  const valid = { status: 'complete', dimensions: allRated('Poor') }

  it('accepts the output without verdict fields', () => {
    expect(() => validateRawOpenAIAnalysis(valid)).not.toThrow()
  })

  it.each(MODEL_VERDICT_FIELDS)('rejects "%s" at the top level, inside the dimensions block and inside a dimension', (field) => {
    expect(schemaRejectsVerdictField(valid, field)).toBe(true)
    expect(schemaRejectsVerdictField(valid, field, 5)).toBe(true)
  })

  it('rejects a verdict field on an abstention too', () => {
    const abstention = { status: 'unable_to_analyze', reason: 'No garment is visible.', confidence: 'Low', next_step: 'Upload a clearer photo.' }
    expect(() => validateRawOpenAIAnalysis(abstention)).not.toThrow()
    expect(() => validateRawOpenAIAnalysis({ ...abstention, overall_recommendation: 'Highly Recommended' })).toThrow()
  })
})

describe('the scenario dataset exercises verdict integrity end to end', () => {
  const paths = datasetPaths(process.cwd(), 'scenarios-v1')
  const cases = loadCases(paths.casesPath)
  const details = detailsFromRecording(loadRecording(paths.recordingPath), cases)

  it('passes the integrity check for every case that produced a verdict or had to be rejected', () => {
    const judged = cases.map((benchmarkCase) => {
      const evaluation = evaluateCase(benchmarkCase, details.filter((detail) => detail.case_id === benchmarkCase.id))
      return [benchmarkCase.id, evaluation.checks.find((check) => check.check === 'verdict_integrity')!.status] as const
    })
    expect(judged.filter(([, status]) => status === 'fail')).toEqual([])
    // Abstentions have no verdict to protect; everything else must have been checked.
    const notChecked = judged.filter(([, status]) => status === 'not_applicable').map(([id]) => id).sort()
    expect(notChecked).toEqual(cases.filter((benchmarkCase) => benchmarkCase.expected.should_abstain).map((benchmarkCase) => benchmarkCase.id).sort())
  })

  it('rejects the two recorded outputs that carry a verdict of their own', () => {
    const rejected = cases.filter((benchmarkCase) => benchmarkCase.expected.must_be_rejected).map((benchmarkCase) => benchmarkCase.id).sort()
    expect(rejected).toEqual(['sc-int-dimension-carries-verdict', 'sc-int-model-states-verdict'])
    for (const id of rejected) {
      expect(details.filter((detail) => detail.case_id === id).map((detail) => [detail.outcome, detail.error_code])).toEqual([['error', 'invalid_response'], ['error', 'invalid_response']])
    }
  })
})
