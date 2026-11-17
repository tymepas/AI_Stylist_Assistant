/**
 * Quality metrics: per-dimension agreement, grounding, calibration and
 * multi-image results.
 *
 * Every expected value below was worked out by hand from the fixture described
 * in tests/helpers/qualityFixture.ts, so this checks the metric code rather
 * than echoing it. The fixture is test data: no image, no reviewer and no model
 * exists behind it.
 *
 * No network is used.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'

jest.mock('server-only', () => ({}), { virtual: true })

import { evaluateRecording, renderMarkdown, serializeReport, type EvaluationReport } from '@/evaluation/evaluate'
import { MIN_SAMPLE, UNAVAILABLE_FIXTURE_OUTPUTS, UNAVAILABLE_NO_GROUND_TRUTH, compareRating, meanMetric, mentions, noiseMargin, normaliseText, rateMetric } from '@/evaluation/quality'
import { degrade, fixtureCases, fixtureRecording, fixtureReferences, type FixtureBasis, type FixtureOutput } from '../helpers/qualityFixture'

const CURRENT = { promptVersion: 'aaaaaaaaaaaa', schemaVersion: 'analysis-output/2' }

function evaluate(basis: FixtureBasis, provenance: 'model' | 'synthetic_fixture', change?: (output: FixtureOutput, caseId: string, run: number) => FixtureOutput, caseIds?: string[]): EvaluationReport {
  const cases = fixtureCases(basis)
  return evaluateRecording(fixtureRecording(cases, provenance, change), cases, CURRENT, 'replay', { references: fixtureReferences(basis), selection: caseIds ? { caseIds } : undefined })
}

let fetchSpy: jest.SpiedFunction<typeof fetch>
beforeEach(() => {
  fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() => { throw new Error('Network access is not allowed in an evaluation.') })
})
afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled()
  jest.restoreAllMocks()
})

describe('comparing a rating with its reference', () => {
  it('measures distance in bands on the four-band scale', () => {
    expect(compareRating('Good', 'Good')).toEqual({ exact: true, within_one: true, distance: 0, severe: false })
    expect(compareRating('Excellent', 'Good')).toEqual({ exact: false, within_one: true, distance: 1, severe: false })
    expect(compareRating('Poor', 'Good')).toEqual({ exact: false, within_one: false, distance: 2, severe: true })
    expect(compareRating('Excellent', 'Poor')).toEqual({ exact: false, within_one: false, distance: 3, severe: true })
  })

  it('treats "Unable to Evaluate" as off the scale: it agrees only with itself and has no distance', () => {
    expect(compareRating('Unable to Evaluate', 'Unable to Evaluate')).toEqual({ exact: true, within_one: true, distance: null, severe: false })
    expect(compareRating('Unable to Evaluate', 'Good')).toEqual({ exact: false, within_one: false, distance: null, severe: true })
    expect(compareRating('Good', 'Unable to Evaluate')).toEqual({ exact: false, within_one: false, distance: null, severe: true })
  })
})

describe('a metric states how far it can be trusted', () => {
  it('is unavailable, with a null value and never 0, when there is nothing to measure', () => {
    expect(rateMetric([], 'because')).toEqual({ status: 'unavailable', reason: 'because', value: null, n: 0, se: null })
    expect(meanMetric([], 'because')).toEqual({ status: 'unavailable', reason: 'because', value: null, n: 0, se: null })
  })

  it('is only indicative below the minimum sample', () => {
    const metric = rateMetric(Array.from({ length: MIN_SAMPLE - 1 }, () => 1), 'unused')
    expect(metric).toMatchObject({ status: 'insufficient_sample', value: 1, n: MIN_SAMPLE - 1 })
    expect(metric.reason).toMatch(/at least 10 are needed/)
  })

  it('is measured from the minimum sample on, with a binomial standard error for a rate', () => {
    // 8 of 10 agree: p = 0.8, se = sqrt(0.8 * 0.2 / 10) = 0.1265
    expect(rateMetric([1, 1, 1, 1, 1, 1, 1, 1, 0, 0], 'unused')).toEqual({ status: 'measured', value: 0.8, n: 10, se: 0.1265 })
  })

  it('gives a mean its own standard error', () => {
    // Ten values, five 0 and five 2: mean 1, sample variance 10/9, se = sqrt(10/9/10) = 0.3333
    expect(meanMetric([0, 0, 0, 0, 0, 2, 2, 2, 2, 2], 'unused')).toEqual({ status: 'measured', value: 1, n: 10, se: 0.3333 })
  })

  it('never lets the noise margin fall below its floor', () => {
    expect(noiseMargin('rate', 0, 0)).toBe(0.05)
    expect(noiseMargin('bands', 0, 0)).toBe(0.25)
    // 1.96 * sqrt(0.1^2 + 0.1^2) = 0.2772
    expect(noiseMargin('rate', 0.1, 0.1)).toBe(0.2772)
  })
})

describe('agreement with human-reviewed references, per dimension', () => {
  let report: EvaluationReport
  beforeEach(() => { report = evaluate('image_review', 'model') })

  it('is available once model outputs meet image-reviewed references', () => {
    expect(report.quality.image_grounded_accuracy).toEqual({ status: 'available', cases: 17 })
    expect(report.references.cases_by_tier).toEqual({ image_reviewed: 17, brief_derived: 0, synthetic: 0, unreviewed: 0 })
    expect(report.references).toMatchObject({ image_reviewers: ['test-reviewer'], image_reviews_from: '2026-11-01', image_reviews_to: '2026-11-01' })
  })

  it('reports exact agreement, agreement within one band and the mean absolute error for each dimension', () => {
    const { dimensions, coverage } = report.quality.agreement.image_reviewed
    expect(coverage).toMatchObject({ status: 'measured', value: 1, n: 17 })
    for (const key of ['occasion', 'color', 'formality', 'style_preference_match'] as const) {
      expect(dimensions[key].exact_rate).toMatchObject({ status: 'measured', value: 1, n: 17 })
      expect(dimensions[key].within_one_rate).toMatchObject({ value: 1, n: 17 })
      expect(dimensions[key].mae).toMatchObject({ status: 'measured', value: 0, n: 17 })
    }
    // style: the 8 single cases match (Fair); the other 9 give Good, one band off.
    expect(dimensions.style.exact_rate).toMatchObject({ status: 'measured', value: 0.4706, n: 17 }) // 8 / 17
    expect(dimensions.style.within_one_rate).toMatchObject({ value: 1, n: 17 })
    expect(dimensions.style.mae).toMatchObject({ value: 0.5294, n: 17 }) // 9 / 17
  })

  it('counts a dimension neither side rated as agreement, and leaves it out of the mean absolute error', () => {
    // seasonality: 13 cases rated Good by both; in the 4 view cases reference and output both say it cannot be judged.
    const { seasonality } = report.quality.agreement.image_reviewed.dimensions
    expect(seasonality.exact_rate).toMatchObject({ value: 1, n: 17 })
    expect(seasonality.mae).toMatchObject({ value: 0, n: 13 })
  })

  it('counts one case once, however often it was run', () => {
    // Every case has two runs, so 34 runs stand behind n = 17.
    expect(report.metrics.runs).toBe(34)
    expect(report.quality.agreement.image_reviewed.dimensions.occasion.exact_rate.n).toBe(17)
  })

  it('scores a disagreement in one of two runs as half a case', () => {
    const half = evaluate('image_review', 'model', (output, caseId, run) => (caseId === 'q-single-01' && run === 2
      ? { ...output, dimensions: { ...output.dimensions, occasion: { ...output.dimensions.occasion, rating: 'Poor' } } }
      : output))
    const { occasion } = half.quality.agreement.image_reviewed.dimensions
    expect(occasion.exact_rate.value).toBe(0.9706) // 16.5 / 17
    expect(occasion.mae.value).toBe(0.0882) // one case with a mean error of 1.5 bands (0 and 3): 1.5 / 17
  })
})

describe('missing dimensions and missing outputs', () => {
  it('counts an output that leaves a rated dimension unrated as a disagreement with no distance', () => {
    const report = evaluate('image_review', 'model', (output, caseId) => (caseId === 'q-single-01'
      ? { ...output, dimensions: { ...output.dimensions, formality: { ...output.dimensions.formality, rating: 'Unable to Evaluate' } } }
      : output))
    const { formality } = report.quality.agreement.image_reviewed.dimensions
    expect(formality.exact_rate).toMatchObject({ value: 0.9412, n: 17 }) // 16 / 17
    expect(formality.within_one_rate.value).toBe(0.9412)
    expect(formality.mae).toMatchObject({ value: 0, n: 16 })
  })

  it('reports lower coverage, not lower agreement, when a referenced case produced no ratings', () => {
    const cases = fixtureCases('image_review')
    const recording = fixtureRecording(cases, 'model')
    for (const entry of recording.entries.filter((candidate) => candidate.case_id === 'q-single-01')) {
      Object.assign(entry, { outcome: 'error', error_code: 'timeout', output: undefined })
      delete entry.output
    }
    const report = evaluateRecording(recording, cases, CURRENT, 'replay', { references: fixtureReferences('image_review') })
    const agreement = report.quality.agreement.image_reviewed
    expect(agreement).toMatchObject({ reference_cases: 17, cases_with_output: 16 })
    expect(agreement.coverage).toMatchObject({ value: 0.9412, n: 17 })
    expect(agreement.dimensions.occasion.exact_rate).toMatchObject({ value: 1, n: 16 })
  })
})

describe('reference tiers are never mixed', () => {
  it('reads "Unavailable: insufficient human-reviewed ground truth" without references, never zero', () => {
    const cases = fixtureCases('synthetic')
    const report = evaluateRecording(fixtureRecording(cases, 'model'), cases, CURRENT, 'replay')
    expect(UNAVAILABLE_NO_GROUND_TRUTH).toBe('Unavailable: insufficient human-reviewed ground truth')
    expect(report.quality.image_grounded_accuracy).toEqual({ status: 'unavailable', reason: UNAVAILABLE_NO_GROUND_TRUTH, cases: 0 })
    for (const dimension of Object.values(report.quality.agreement.image_reviewed.dimensions)) {
      expect(dimension.exact_rate).toEqual({ status: 'unavailable', reason: UNAVAILABLE_NO_GROUND_TRUTH, value: null, n: 0, se: null })
      expect(dimension.mae.value).toBeNull()
    }
    expect(renderMarkdown(report)).toContain('Unavailable: insufficient human-reviewed ground truth')
    expect(report.next_steps.join('\n')).toMatch(/Add human-reviewed cases/)
  })

  it('keeps synthetic expectations out of the human-reviewed figures, whatever they say', () => {
    const report = evaluate('synthetic', 'model')
    expect(report.references.cases_by_tier).toEqual({ image_reviewed: 0, brief_derived: 0, synthetic: 17, unreviewed: 0 })
    expect(report.quality.image_grounded_accuracy).toEqual({ status: 'unavailable', reason: UNAVAILABLE_NO_GROUND_TRUTH, cases: 0 })
    expect(report.quality.agreement.image_reviewed.dimensions.occasion.exact_rate.value).toBeNull()
    expect(report.quality.agreement.synthetic.dimensions.occasion.exact_rate).toMatchObject({ status: 'measured', value: 1, n: 17 })
    expect(report.quality.calibration.image_reviewed.high_confidence_error_rate.value).toBeNull()
    expect(report.quality.garment_identification.image_reviewed.garment_type_accuracy.value).toBeNull()
    const markdown = renderMarkdown(report)
    expect(markdown).toContain('Synthetic expectations (a check of the evaluation code, not accuracy)')
    expect(markdown).not.toContain('### Human-reviewed images')
  })

  it('keeps brief-derived expectations apart from both', () => {
    const report = evaluate('brief', 'model')
    expect(report.references.cases_by_tier).toMatchObject({ image_reviewed: 0, brief_derived: 17, synthetic: 0 })
    expect(report.quality.image_grounded_accuracy.status).toBe('unavailable')
    expect(report.quality.agreement.brief_derived.dimensions.style.exact_rate.value).toBe(0.4706)
    expect(report.quality.agreement.synthetic.dimensions.style.exact_rate.value).toBeNull()
  })

  it('does not score hand-written outputs against human reviews: that would say nothing about a model', () => {
    const report = evaluate('image_review', 'synthetic_fixture')
    // The references are still counted as what they are.
    expect(report.references.cases_by_tier.image_reviewed).toBe(17)
    expect(report.quality.image_grounded_accuracy).toEqual({ status: 'unavailable', reason: UNAVAILABLE_FIXTURE_OUTPUTS, cases: 0 })
    // The 17 references are reported as existing; none of them is scored.
    expect(report.quality.agreement.image_reviewed).toMatchObject({ reference_cases: 17, cases_with_output: 0 })
    expect(report.quality.agreement.image_reviewed.coverage).toMatchObject({ status: 'unavailable', value: null, reason: UNAVAILABLE_FIXTURE_OUTPUTS })
    expect(report.quality.agreement.image_reviewed.dimensions.occasion.exact_rate).toMatchObject({ status: 'unavailable', value: null, reason: UNAVAILABLE_FIXTURE_OUTPUTS })
  })

  it('marks every figure as indicative only when too few cases stand behind it', () => {
    const report = evaluate('image_review', 'model', undefined, ['q-single-01', 'q-single-02', 'q-single-03', 'q-single-04'])
    const { occasion } = report.quality.agreement.image_reviewed.dimensions
    expect(occasion.exact_rate).toMatchObject({ status: 'insufficient_sample', value: 1, n: 4 })
    expect(renderMarkdown(report)).toContain('too few to conclude')
    expect(report.next_steps.join('\n')).toMatch(/Only 4 image-reviewed case\(s\): add at least 6 more/)
  })
})

describe('explanation grounding (proxy)', () => {
  it('matches whole words, ignoring case and punctuation', () => {
    const text = normaliseText('The NAVY-blue blazer, with wide lapels.')
    expect(mentions(text, 'navy')).toBe(true)
    expect(mentions(text, 'Navy Blue')).toBe(true)
    expect(mentions(text, 'wide lapels')).toBe(true)
    expect(mentions(text, 'nav')).toBe(false)
    expect(mentions(text, 'blaze')).toBe(false)
    expect(mentions(text, 'black')).toBe(false)
  })

  it('finds supported claims when the explanation mentions the facts a reviewer listed', () => {
    const grounding = evaluate('image_review', 'model').quality.grounding.image_reviewed
    expect(grounding.kind).toBe('proxy')
    expect(grounding.cases_with_facts).toBe(17)
    expect(grounding.key_fact_mention_rate).toMatchObject({ status: 'measured', value: 1, n: 17 })
    expect(grounding.supporting_fact_mention_rate).toMatchObject({ value: 1, n: 17 })
    expect(grounding.mention_rate_by_attribute.colour).toMatchObject({ value: 1, n: 17 })
    expect(grounding.mention_rate_by_attribute.garment).toMatchObject({ value: 1, n: 17 })
    expect(grounding.mention_rate_by_attribute.pattern).toMatchObject({ status: 'unavailable', value: null })
    expect(grounding.contradiction_rate).toMatchObject({ value: 0, n: 17 })
    expect(grounding.unverifiable_claim_rate).toMatchObject({ value: 0, n: 17 })
    expect(grounding.cases_missing_key_facts).toEqual([])
  })

  it('finds missing facts, contradictions and unsupported claims in the degraded outputs', () => {
    const grounding = evaluate('image_review', 'model', degrade).quality.grounding.image_reviewed
    expect(grounding.key_fact_mention_rate).toMatchObject({ value: 0, n: 17 })
    expect(grounding.supporting_fact_mention_rate.value).toBe(0)
    expect(grounding.contradiction_rate).toMatchObject({ value: 1, n: 17 }) // "black" where the jacket is navy
    expect(grounding.unverifiable_claim_rate).toMatchObject({ value: 1, n: 17 }) // "lining" cannot be seen
    expect(grounding.cases_missing_key_facts).toHaveLength(17)
  })

  it('measures uncertainty handling where the reviewer could not judge a dimension', () => {
    // Seasonality cannot be judged in the 4 view cases. Clean outputs leave it unrated; degraded ones rate it with High confidence.
    expect(evaluate('image_review', 'model').quality.grounding.image_reviewed.uncertainty_handling_rate).toMatchObject({ status: 'insufficient_sample', value: 1, n: 4 })
    expect(evaluate('image_review', 'model', degrade).quality.grounding.image_reviewed.uncertainty_handling_rate).toMatchObject({ value: 0, n: 4 })
  })

  it('says in the report that these figures are proxies', () => {
    const markdown = renderMarkdown(evaluate('image_review', 'model'))
    expect(markdown).toContain('## 9. Explanation grounding (proxy)')
    expect(markdown).toContain('They do not establish that an explanation is true.')
  })
})

describe('confidence calibration', () => {
  it('reports agreement by stated confidence, with the sample behind each level', () => {
    const calibration = evaluate('image_review', 'model').quality.calibration.image_reviewed
    // A case counts once per level, however many of its ratings were stated at that level.
    // High: occasion, color, formality and style_preference_match of each of the 17 cases, all matching.
    expect(calibration.buckets.High.exact_rate).toMatchObject({ status: 'measured', value: 1, n: 17 })
    // Medium: seasonality of each case, all matching.
    expect(calibration.buckets.Medium.exact_rate).toMatchObject({ value: 1, n: 17 })
    // Low: style of each case; 8 of the 17 cases match.
    expect(calibration.buckets.Low.exact_rate).toMatchObject({ value: 0.4706, n: 17 })
    expect(calibration.buckets.Low.within_one_rate.value).toBe(1)
    expect(calibration.high_confidence_error_rate).toMatchObject({ value: 0, n: 17 })
    expect(calibration.high_confidence_severe_error_rate).toMatchObject({ value: 0, n: 17 })
    expect(calibration.confidence_gap).toMatchObject({ status: 'measured', value: 0.5294, n: 17 }) // 1 - 8/17
    expect(calibration.ordering).toBe('consistent')
  })

  it('detects high confidence that disagrees with the references', () => {
    const calibration = evaluate('image_review', 'model', degrade).quality.calibration.image_reviewed
    // High now covers five dimensions of each case. Per case, formality and preference are right and occasion and
    // color are wrong; seasonality is right in 13 cases (3 of 5) and wrong in the 4 view cases (2 of 5).
    expect(calibration.buckets.High.exact_rate).toMatchObject({ value: 0.5529, n: 17 }) // (13 x 0.6 + 4 x 0.4) / 17
    expect(calibration.high_confidence_error_rate).toMatchObject({ status: 'measured', value: 0.4471, n: 17 })
    // Severe: occasion is two bands off in every case (1 of 5); in the 4 view cases seasonality is rated where it cannot be judged (2 of 5).
    expect(calibration.high_confidence_severe_error_rate).toMatchObject({ value: 0.2471, n: 17 }) // (13 x 0.2 + 4 x 0.4) / 17
    // 9.4/17 - 8/17 = 0.08235, from the unrounded rates (the rounded ones would give 0.0823).
    expect(calibration.confidence_gap.value).toBe(0.0824)
  })

  it('reports an inverted ordering when low confidence agrees more often than high confidence', () => {
    const inverted = evaluate('image_review', 'model', (output) => ({
      ...output,
      dimensions: {
        ...output.dimensions,
        // High confidence, always wrong; Low confidence, always right.
        occasion: { ...output.dimensions.occasion, rating: 'Poor' },
        color: { ...output.dimensions.color, rating: 'Poor' },
        formality: { ...output.dimensions.formality, rating: 'Poor' },
        style_preference_match: { ...output.dimensions.style_preference_match, rating: 'Poor' },
        style: { ...output.dimensions.style, rating: 'Fair' },
      },
    })).quality.calibration.image_reviewed
    expect(inverted.buckets.High.exact_rate.value).toBe(0)
    expect(inverted.buckets.Low.exact_rate.value).toBe(1)
    expect(inverted.confidence_gap.value).toBe(-1)
    expect(inverted.ordering).toBe('inverted')
  })

  it('makes no claim about ordering or the gap on too few samples', () => {
    const calibration = evaluate('image_review', 'model', undefined, ['q-single-01', 'q-single-02']).quality.calibration.image_reviewed
    expect(calibration.buckets.High.exact_rate).toMatchObject({ status: 'insufficient_sample', n: 2 })
    expect(calibration.buckets.Low.exact_rate).toMatchObject({ status: 'insufficient_sample', n: 2 })
    expect(calibration.confidence_gap.status).toBe('insufficient_sample')
    expect(calibration.ordering).toBe('insufficient_sample')
  })

  it('is unavailable without scored references', () => {
    const cases = fixtureCases('synthetic')
    const calibration = evaluateRecording(fixtureRecording(cases, 'model'), cases, CURRENT, 'replay').quality.calibration.image_reviewed
    expect(calibration.ordering).toBe('unavailable')
    expect(calibration.confidence_gap).toMatchObject({ status: 'unavailable', value: null })
  })
})

describe('multi-image evaluation', () => {
  let report: EvaluationReport
  beforeEach(() => { report = evaluate('image_review', 'model') })

  it('groups cases by garment mode', () => {
    const { modes } = report.quality.multi_image
    expect([modes.single.cases, modes.same_garment_views.cases, modes.outfit_items.cases]).toEqual([8, 4, 5])
    expect([modes.single.scored_runs, modes.same_garment_views.scored_runs, modes.outfit_items.scored_runs]).toEqual([16, 8, 10])
    // Cases, not runs: 16 runs of 8 cases are 8 units, which is below the minimum of ten.
    expect(modes.single.valid_output_rate).toMatchObject({ status: 'insufficient_sample', value: 1, n: 8 })
    expect(modes.same_garment_views.valid_output_rate).toMatchObject({ status: 'insufficient_sample', value: 1, n: 4 })
    expect(modes.single.repeat_rating_stability).toMatchObject({ value: 1, n: 8 })
  })

  it('compares agreement between the modes, pooled over the six dimensions of each case', () => {
    const { modes } = report.quality.multi_image
    expect(modes.single.agreement.image_reviewed.exact_rate).toMatchObject({ value: 1, n: 8 })
    // style is one band off in every multi-image case: 5 of 6 dimensions agree.
    expect(modes.same_garment_views.agreement.image_reviewed.exact_rate).toMatchObject({ value: 0.8333, n: 4 })
    expect(modes.outfit_items.agreement.image_reviewed.exact_rate).toMatchObject({ value: 0.8333, n: 5 })
    expect(modes.outfit_items.agreement.synthetic.exact_rate.value).toBeNull()
  })

  it('checks that an outfit has one valid note per item', () => {
    // Five outfit cases: a figure, and too few to conclude from.
    expect(report.quality.multi_image.outfit_items.completeness_rate).toMatchObject({ status: 'insufficient_sample', value: 1, n: 5 })
    expect(report.quality.multi_image.outfit_items.unexpected_blocks_in_other_modes).toBe(0)

    const broken = evaluate('image_review', 'model', (output, caseId, run) => {
      if (caseId === 'q-outfit-01') return { ...output, outfit_components: undefined } // missing in both runs
      if (caseId === 'q-outfit-02' && run === 1) return { ...output, outfit_components: [(output.outfit_components as unknown[])[0], (output.outfit_components as unknown[])[0]] } // item 1 twice
      if (caseId === 'q-single-01') return { ...output, outfit_components: [{ item: 1, garment_type: 'top', assessment: 'Works', note: 'A note where none is expected.' }] }
      return output
    })
    expect(broken.quality.multi_image.outfit_items.completeness_rate).toMatchObject({ value: 0.7, n: 5 }) // per case: 0, 0.5, 1, 1, 1
    expect(broken.quality.multi_image.outfit_items.unexpected_blocks_in_other_modes).toBe(2)
    expect(broken.next_steps.join('\n')).toMatch(/Per-item outfit notes are missing or invalid/)
  })

  it('scores garment identification for outfit items only, against the reference garment types', () => {
    // One value per outfit case, not per item: five cases.
    expect(report.quality.garment_identification.image_reviewed).toMatchObject({ cases: 5, garment_type_accuracy: { status: 'insufficient_sample', value: 1, n: 5 } })
    const degraded = evaluate('image_review', 'model', degrade)
    // Item 1 is called outerwear instead of top in every run; item 2 stays right: half of each case's items.
    expect(degraded.quality.garment_identification.image_reviewed.garment_type_accuracy).toMatchObject({ value: 0.5, n: 5 })
    expect(Object.keys(report.quality.not_measurable).sort()).toEqual(['colour_identification', 'contradictions_between_views', 'pattern_identification', 'single_garment_identification'])
  })

  it('compares one photo with several photos of the same garment', () => {
    const groups = report.quality.multi_image.comparison_groups
    expect(groups.groups).toBe(4)
    // In each pair, seasonality (Good against unrated) and style (Fair against Good) differ: 4 of 6 dimensions agree.
    expect(groups.cross_mode_rating_consistency).toMatchObject({ status: 'insufficient_sample', value: 0.6667, n: 4 })
    // Of the five dimensions both cases rated, only style differs, by one band: 1 / 5.
    expect(groups.mean_band_shift).toMatchObject({ value: 0.2, n: 4 })
    // Several photos agree with the reviewer on 5 of 6 dimensions, one photo on 6 of 6.
    expect(groups.multi_minus_single_exact.image_reviewed).toMatchObject({ value: -0.1667, n: 4 })
    expect(groups.details[0]).toEqual({ group: 'grp-01', cases: [{ case_id: 'q-single-01', mode: 'single' }, { case_id: 'q-views-01', mode: 'same_garment_views' }], compared_dimensions: 6, identical_dimensions: 4 })
  })

  it('reports rating stability across repeated runs for each dimension', () => {
    expect(report.quality.stability_by_dimension.occasion).toMatchObject({ status: 'measured', value: 1, n: 17 })
    const unstable = evaluate('image_review', 'model', (output, caseId, run) => (caseId.startsWith('q-single') && run === 2
      ? { ...output, dimensions: { ...output.dimensions, color: { ...output.dimensions.color, rating: 'Fair' } } }
      : output))
    expect(unstable.quality.stability_by_dimension.color).toMatchObject({ value: 0.5294, n: 17 }) // 9 of 17 stable
    expect(unstable.quality.stability_by_dimension.occasion.value).toBe(1)
  })
})

describe('the report', () => {
  it('holds no model text, reviewer notes, file names or timestamps', () => {
    const text = serializeReport(evaluate('image_review', 'model', degrade))
    for (const fragment of ['navy blazer', 'black jacket', 'silk lining', 'Test fixture', '.jpg', 'The jacket is navy']) expect(text).not.toContain(fragment)
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
  })

  it('is reproducible byte for byte', () => {
    expect(serializeReport(evaluate('image_review', 'model'))).toBe(serializeReport(evaluate('image_review', 'model')))
  })

  it('answers what was evaluated, on what, and what is missing, without a composite score', () => {
    const markdown = renderMarkdown(evaluate('image_review', 'model'))
    for (const heading of ['## 1. What was evaluated', '## 2. Dataset and references', '## 3. Output validity', '## 5. Agreement with human-reviewed references', '## 7. Confidence', '## 8. Image modes', '## 9. Explanation grounding (proxy)', '## 11. What is unavailable', '## 12. What to do next']) {
      expect(markdown).toContain(heading)
    }
    expect(markdown).toContain('Image reviews by: test-reviewer (2026-11-01 to 2026-11-01)')
    expect(markdown).not.toMatch(/overall accuracy|composite|quality score/i)
  })

  it('indexes every comparable figure under a stable name with its direction', () => {
    const index = evaluate('image_review', 'model').metric_index
    expect(index['agreement.image_reviewed.occasion.exact_rate']).toMatchObject({ value: 1, n: 17, direction: 'higher_is_better', kind: 'rate', needs_references: true })
    expect(index['agreement.image_reviewed.style.mae']).toMatchObject({ value: 0.5294, direction: 'lower_is_better', kind: 'bands' })
    expect(index['grounding.image_reviewed.contradiction_rate'].direction).toBe('lower_is_better')
    expect(index['validity.valid_output_rate']).toMatchObject({ value: 1, n: 17, needs_references: false }) // 17 cases, 34 runs
    expect(index['agreement.synthetic.occasion.exact_rate']).toMatchObject({ status: 'unavailable', value: null })
  })
})
