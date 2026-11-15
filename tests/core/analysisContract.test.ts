/**
 * Characterisation tests for the model-output contract and the application-built report.
 * Guards the product rule that the model rates dimensions and the application,
 * never the model, produces the verdict.
 */

import { describe, expect, it } from '@jest/globals'
import { validateRawOpenAIAnalysis } from '@/lib/services/openai/openAIAnalysisSchema'
import { buildCompleteAnalysisResult } from '@/lib/services/analysisResultService'
import { buildShoppingAdvisor } from '@/lib/services/shoppingAdvisorService'
import { allRated, dimension, makeDimensions, VALID_RECOMMENDATION } from '../helpers/fixtures'

const completeOutput = () => ({ status: 'complete', dimensions: allRated('Good') })

/** Untyped view of a dimension so tests can inject values the schema must reject. */
const loose = (value: object) => value as unknown as Record<string, unknown>

describe('validateRawOpenAIAnalysis — accepted shapes', () => {
  it('accepts a complete analysis with all six dimensions', () => {
    expect(validateRawOpenAIAnalysis(completeOutput())).toEqual(completeOutput())
  })

  it('accepts an unable_to_analyze response', () => {
    const value = { status: 'unable_to_analyze', reason: 'No person is visible.', confidence: 'Low', next_step: 'Upload a clearer photo.' }
    expect(validateRawOpenAIAnalysis(value)).toEqual(value)
  })

  it('passes shopping_advisor through untouched for separate validation', () => {
    const value = { ...completeOutput(), shopping_advisor: { anything: ['is', 'allowed', 'here'] } }
    expect(validateRawOpenAIAnalysis(value)).toEqual(value)
  })
})

describe('validateRawOpenAIAnalysis — the model cannot supply verdict fields', () => {
  it.each([
    ['overall_recommendation', 'Highly Recommended'],
    ['verdict_score', 5],
    ['weighted_score', 5],
    ['things_to_consider', ['Buy it']],
    ['analysis_based_on', { considered: [], not_considered: [] }],
    ['next_step', 'Buy it now'],
  ])('rejects a complete analysis that includes %s', (field, value) => {
    expect(() => validateRawOpenAIAnalysis({ ...completeOutput(), [field]: value })).toThrow()
  })

  it('rejects verdict fields smuggled inside a dimension', () => {
    const value = completeOutput()
    ;loose(value.dimensions.occasion).verdict_score = 5
    expect(() => validateRawOpenAIAnalysis(value)).toThrow()
  })
})

describe('validateRawOpenAIAnalysis — rejected shapes', () => {
  it('rejects a missing dimension', () => {
    const { seasonality: _omit, ...rest } = allRated('Good')
    expect(() => validateRawOpenAIAnalysis({ status: 'complete', dimensions: rest })).toThrow()
  })

  it('rejects an unknown dimension', () => {
    expect(() => validateRawOpenAIAnalysis({ status: 'complete', dimensions: { ...allRated('Good'), price: dimension('Good') } })).toThrow()
  })

  it.each(['Very Good', 'excellent', '5', ''])('rejects rating %j', (rating) => {
    const value = completeOutput()
    ;loose(value.dimensions.color).rating = rating
    expect(() => validateRawOpenAIAnalysis(value)).toThrow()
  })

  it('rejects an invalid confidence value', () => {
    const value = completeOutput()
    ;loose(value.dimensions.color).confidence = 'Certain'
    expect(() => validateRawOpenAIAnalysis(value)).toThrow()
  })

  it('rejects a blank reason', () => {
    const value = completeOutput()
    value.dimensions.color.reason = '   '
    expect(() => validateRawOpenAIAnalysis(value)).toThrow()
  })

  it('rejects unable_to_analyze with confidence other than Low', () => {
    expect(() => validateRawOpenAIAnalysis({ status: 'unable_to_analyze', reason: 'x', confidence: 'High', next_step: 'y' })).toThrow()
  })

  it('rejects an unknown status', () => {
    expect(() => validateRawOpenAIAnalysis({ status: 'partial', dimensions: allRated('Good') })).toThrow()
  })
})

describe('buildCompleteAnalysisResult', () => {
  it('computes the verdict from ratings and adds application-owned fields', () => {
    const result = buildCompleteAnalysisResult(allRated('Excellent'))
    expect(result).toMatchObject({
      status: 'complete',
      overall_recommendation: 'Highly Recommended',
      verdict_score: 5,
      next_step: 'You can move forward with this purchase with confidence.',
      analysis_based_on: {
        considered: ['photo', 'garment', 'occasion', 'style_preference'],
        not_considered: ['price', 'material_quality', 'brand', 'durability', 'comfort'],
      },
      things_to_consider: ['No major conflicts were identified across the evaluated dimensions.'],
    })
  })

  it.each([
    ['Excellent', 'You can move forward with this purchase with confidence.'],
    ['Good', 'This is a strong option; review the considerations before making your decision.'],
    ['Fair', 'Compare this with a few alternatives before purchasing.'],
    ['Poor', 'Consider choosing a different garment for this occasion.'],
  ] as const)('maps all-%s ratings to its fixed next step', (rating, nextStep) => {
    expect(buildCompleteAnalysisResult(allRated(rating)).next_step).toBe(nextStep)
  })

  it('lists Fair, Poor and Unable to Evaluate dimensions as considerations, labelled by the application', () => {
    const dimensions = makeDimensions({ occasion: 'Fair', formality: 'Excellent', style_preference_match: 'Poor', color: 'Good', seasonality: 'Unable to Evaluate', style: 'Good' })
    const result = buildCompleteAnalysisResult(dimensions)
    expect(result.things_to_consider).toEqual([
      `Occasion compatibility: ${dimensions.occasion.reason}`,
      `Seasonality: ${dimensions.seasonality.reason}`,
      `Style preference match: ${dimensions.style_preference_match.reason}`,
    ])
  })

  it('defaults the advisor to unavailable when none is supplied', () => {
    expect(buildCompleteAnalysisResult(allRated('Good')).shopping_advisor).toEqual({ availability: 'unavailable', recommendations: [] })
  })
})

describe('Shopping Advisor cannot change the verdict', () => {
  const advisorVariants: Array<[string, unknown, boolean]> = [
    ['valid advisor with Style DNA', { recommendations: [VALID_RECOMMENDATION] }, true],
    ['valid advisor without Style DNA', { recommendations: [VALID_RECOMMENDATION] }, false],
    ['invalid advisor', { recommendations: [{ title: 'x' }] }, true],
    ['advisor claiming a verdict', { recommendations: [VALID_RECOMMENDATION], verdict_score: 5, overall_recommendation: 'Highly Recommended' }, true],
    ['missing advisor', undefined, true],
  ]

  it.each(advisorVariants)('%s leaves verdict, score, considerations and next step unchanged', (_label, rawAdvisor, hasStyleDna) => {
    const dimensions = makeDimensions({ occasion: 'Poor', formality: 'Fair', style_preference_match: 'Poor', color: 'Good', seasonality: 'Fair' })
    const baseline = buildCompleteAnalysisResult(dimensions)
    const withAdvisor = buildCompleteAnalysisResult(dimensions, buildShoppingAdvisor(rawAdvisor, hasStyleDna))
    const { shopping_advisor: _a, ...baselineCore } = baseline
    const { shopping_advisor: _b, ...advisorCore } = withAdvisor
    expect(advisorCore).toEqual(baselineCore)
  })

  it('rejects an advisor payload with extra top-level fields rather than passing them through', () => {
    expect(buildShoppingAdvisor({ recommendations: [VALID_RECOMMENDATION], verdict_score: 5 }, true)).toEqual({ availability: 'unavailable', recommendations: [] })
  })

  it('rejects more than three recommendations', () => {
    const four = Array.from({ length: 4 }, () => VALID_RECOMMENDATION)
    expect(buildShoppingAdvisor({ recommendations: four }, true)).toEqual({ availability: 'unavailable', recommendations: [] })
  })
})
