/**
 * Metric-level regression: improvement, no meaningful change, regression,
 * inconclusive and unavailable, with a noise margin and a minimum sample.
 *
 * The centrepiece is a deliberately degraded fixture: the same cases and
 * references, with outputs made worse on purpose. It shows that a genuine
 * quality regression is detected, metric by metric, even though no per-case
 * check fails, and that the baseline safeguards refuse it.
 *
 * The fixture is test data (see tests/helpers/qualityFixture.ts). No network is used.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'

jest.mock('server-only', () => ({}), { virtual: true })

import { evaluateRecording, type EvaluationReport } from '@/evaluation/evaluate'
import type { IndexedMetric } from '@/evaluation/quality'
import { ACCEPT_WORSE_BASELINE, assessBaselineUpdate, classifyMetric, classifyMetricChanges, classifyRegressions, describeMetricChanges, type MetricClass, type MetricRegressionReport } from '@/evaluation/regression'
import { degrade, fixtureCases, fixtureRecording, fixtureReferences, type FixtureBasis, type FixtureOutput } from '../helpers/qualityFixture'

const CURRENT = { promptVersion: 'aaaaaaaaaaaa', schemaVersion: 'analysis-output/2' }
const SAME = { sameDataset: true, sameReferences: true, partial: false }

function evaluate(basis: FixtureBasis, provenance: 'model' | 'synthetic_fixture', change?: (output: FixtureOutput, caseId: string, run: number) => FixtureOutput, caseIds?: string[]): EvaluationReport {
  const cases = fixtureCases(basis)
  return evaluateRecording(fixtureRecording(cases, provenance, change), cases, CURRENT, 'replay', { references: fixtureReferences(basis), selection: caseIds ? { caseIds } : undefined })
}

function metric(value: number | null, n: number, overrides: Partial<IndexedMetric> = {}): IndexedMetric {
  const se = value === null || n === 0 ? null : Math.sqrt((value * (1 - value)) / n)
  return {
    status: value === null ? 'unavailable' : n < 10 ? 'insufficient_sample' : 'measured',
    value,
    n,
    se,
    direction: 'higher_is_better',
    kind: 'rate',
    needs_references: true,
    ...overrides,
  }
}

const classOf = (changes: MetricRegressionReport, name: string): MetricClass | undefined => changes.comparisons.find((comparison) => comparison.metric === name)?.classification

let fetchSpy: jest.SpiedFunction<typeof fetch>
beforeEach(() => {
  fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() => { throw new Error('Network access is not allowed in an evaluation.') })
})
afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled()
  jest.restoreAllMocks()
})

describe('classifying one metric', () => {
  it('calls a change beyond the noise margin an improvement or a regression, by the direction of the metric', () => {
    // 0.9 -> 0.6 on 50 samples each: margin = 1.96 * sqrt(0.0018 + 0.0048) = 0.1592
    const worse = classifyMetric('m', metric(0.9, 50), metric(0.6, 50), SAME)
    expect(worse).toMatchObject({ classification: 'regression', delta: -0.3, margin: 0.1592, base_n: 50, candidate_n: 50 })
    expect(classifyMetric('m', metric(0.6, 50), metric(0.9, 50), SAME).classification).toBe('improvement')
    // For an error rate, lower is better: the same move is the other way round.
    const lower = { direction: 'lower_is_better' as const }
    expect(classifyMetric('m', metric(0.9, 50, lower), metric(0.6, 50, lower), SAME).classification).toBe('improvement')
    expect(classifyMetric('m', metric(0.6, 50, lower), metric(0.9, 50, lower), SAME).classification).toBe('regression')
  })

  it('does not treat a small numerical difference as a change', () => {
    // 0.90 -> 0.86 on 200 samples: the statistical margin is 0.0636, and the 5-point floor applies too.
    expect(classifyMetric('m', metric(0.9, 200), metric(0.86, 200), SAME)).toMatchObject({ classification: 'no_meaningful_change', delta: -0.04, margin: 0.0636 })
    // 1.0 -> 0.96: both standard errors are near zero, so only the floor of 0.05 protects against noise.
    expect(classifyMetric('m', metric(1, 100), metric(0.96, 100), SAME)).toMatchObject({ classification: 'no_meaningful_change', margin: 0.05 })
    expect(classifyMetric('m', metric(1, 100), metric(0.94, 100), SAME).classification).toBe('regression')
  })

  it('uses a floor of a quarter band for figures measured in bands', () => {
    const bands = (value: number): IndexedMetric => ({ status: 'measured', value, n: 30, se: 0.02, direction: 'lower_is_better', kind: 'bands', needs_references: true })
    expect(classifyMetric('mae', bands(0.4), bands(0.6), SAME)).toMatchObject({ classification: 'no_meaningful_change', margin: 0.25 })
    expect(classifyMetric('mae', bands(0.4), bands(0.9), SAME).classification).toBe('regression')
    expect(classifyMetric('mae', bands(0.9), bands(0.4), SAME).classification).toBe('improvement')
  })

  it('is inconclusive below the minimum sample, however large the difference', () => {
    const result = classifyMetric('m', metric(1, 9), metric(0, 9), SAME)
    expect(result).toMatchObject({ classification: 'inconclusive', delta: -1 })
    expect(result.reason).toMatch(/Too few samples \(base 9, candidate 9\)/)
    expect(classifyMetric('m', metric(1, 50), metric(0, 9), SAME).classification).toBe('inconclusive')
  })

  it('is unavailable when either side has no figure, and says which', () => {
    expect(classifyMetric('m', metric(null, 0, { reason: 'Unavailable: insufficient human-reviewed ground truth' }), metric(0.8, 50), SAME)).toMatchObject({ classification: 'unavailable', delta: null, margin: null, reason: 'The base has no figure. Unavailable: insufficient human-reviewed ground truth' })
    expect(classifyMetric('m', metric(0.8, 50), metric(null, 0), SAME).reason).toMatch(/^The candidate has no figure/)
    expect(classifyMetric('m', undefined, metric(0.8, 50), SAME).reason).toBe('The base report does not carry this metric.')
    expect(classifyMetric('m', metric(0.8, 50), undefined, SAME).reason).toBe('The candidate report does not carry this metric.')
  })

  it('is inconclusive when the two reports are not comparable', () => {
    expect(classifyMetric('m', metric(0.9, 50), metric(0.1, 50), { ...SAME, sameDataset: false }).reason).toMatch(/different datasets/)
    expect(classifyMetric('m', metric(0.9, 50), metric(0.1, 50), { ...SAME, partial: true }).reason).toMatch(/only part of the dataset/)
    // A different reference set only affects the metrics that depend on references.
    expect(classifyMetric('m', metric(0.9, 50), metric(0.1, 50), { ...SAME, sameReferences: false }).classification).toBe('inconclusive')
    expect(classifyMetric('m', metric(0.9, 50, { needs_references: false }), metric(0.1, 50, { needs_references: false }), { ...SAME, sameReferences: false }).classification).toBe('regression')
  })
})

describe('a deliberately degraded fixture is detected as a regression', () => {
  let clean: EvaluationReport
  let degraded: EvaluationReport
  let changes: MetricRegressionReport

  beforeEach(() => {
    clean = evaluate('image_review', 'model')
    degraded = evaluate('image_review', 'model', degrade)
    changes = classifyMetricChanges(clean, degraded)
  })

  it('fails no per-case check, so the case-level comparison alone would wave it through', () => {
    expect(degraded.summary).toMatchObject({ total_cases: 17, failed: 0 })
    expect(classifyRegressions(clean, degraded).has_regression).toBe(false)
  })

  it('reports the regression metric by metric', () => {
    expect(changes.has_regression).toBe(true)
    for (const name of [
      'agreement.image_reviewed.occasion.exact_rate', // 1 -> 0
      'agreement.image_reviewed.occasion.within_one_rate', // 1 -> 0 (two bands off)
      'agreement.image_reviewed.occasion.mae', // 0 -> 2 bands
      'agreement.image_reviewed.color.exact_rate', // 1 -> 0
      'agreement.image_reviewed.color.mae', // 0 -> 1 band
      'agreement.image_reviewed.seasonality.exact_rate', // 1 -> 13/17
      'calibration.image_reviewed.high_confidence_error_rate', // 0 -> 0.4471
      'calibration.image_reviewed.high_confidence_severe_error_rate', // 0 -> 0.2471
      'calibration.image_reviewed.confidence_gap', // 0.5294 -> 0.0824
      'grounding.image_reviewed.key_fact_mention_rate', // 1 -> 0
      'grounding.image_reviewed.contradiction_rate', // 0 -> 1
      'grounding.image_reviewed.unverifiable_claim_rate', // 0 -> 1
    ]) {
      expect({ name, classification: classOf(changes, name) }).toEqual({ name, classification: 'regression' })
    }
    expect(changes.regressions).toContain('agreement.image_reviewed.occasion.exact_rate')
    expect(changes.improvements).toEqual([])
  })

  it('leaves alone what did not change', () => {
    for (const name of [
      'agreement.image_reviewed.color.within_one_rate', // one band off is still within one
      'agreement.image_reviewed.formality.exact_rate',
      'agreement.image_reviewed.style.exact_rate',
      'agreement.image_reviewed.coverage',
      'validity.valid_output_rate',
    ]) {
      expect({ name, classification: classOf(changes, name) }).toEqual({ name, classification: 'no_meaningful_change' })
    }
  })

  it('draws no conclusion from too few samples, even for a large drop', () => {
    // Uncertainty handling rests on the 4 cases where the reviewer could not judge seasonality: 1 -> 0.
    const comparison = changes.comparisons.find((entry) => entry.metric === 'grounding.image_reviewed.uncertainty_handling_rate')
    expect(comparison).toMatchObject({ classification: 'inconclusive', base: 1, candidate: 0, base_n: 4, candidate_n: 4 })
    // Per-mode agreement rests on 4, 5 and 8 cases, and the outfit figures on 5 outfit cases.
    expect(classOf(changes, 'multi_image.same_garment_views.agreement.image_reviewed.exact_rate')).toBe('inconclusive')
    expect(changes.comparisons.find((entry) => entry.metric === 'garment_identification.image_reviewed.garment_type_accuracy')).toMatchObject({ classification: 'inconclusive', base: 1, candidate: 0.5, base_n: 5 })
    expect(classOf(changes, 'multi_image.outfit_items.completeness_rate')).toBe('inconclusive')
  })

  it('marks the tiers that have no references as unavailable rather than unchanged', () => {
    expect(classOf(changes, 'agreement.brief_derived.occasion.exact_rate')).toBe('unavailable')
    expect(classOf(changes, 'agreement.synthetic.occasion.exact_rate')).toBe('unavailable')
    expect(changes.counts.unavailable).toBeGreaterThan(0)
    expect(Object.values(changes.counts).reduce((sum, count) => sum + count, 0)).toBe(changes.comparisons.length)
  })

  it('reports the way back as an improvement', () => {
    const back = classifyMetricChanges(degraded, clean)
    expect(back.has_regression).toBe(false)
    expect(back.improvements).toContain('agreement.image_reviewed.occasion.exact_rate')
    expect(back.improvements).toContain('grounding.image_reviewed.contradiction_rate')
  })

  it('does not report one changed run of one case as a regression', () => {
    const nudged = evaluate('image_review', 'model', (output, caseId, run) => (caseId === 'q-single-01' && run === 2
      ? { ...output, dimensions: { ...output.dimensions, color: { ...output.dimensions.color, rating: 'Fair' } } }
      : output))
    const small = classifyMetricChanges(clean, nudged)
    // color exact agreement: 1 -> 16.5/17 = 0.9706. Margin: 1.96 * sqrt(0.9706 * 0.0294 / 17) = 0.0804.
    expect(small.comparisons.find((entry) => entry.metric === 'agreement.image_reviewed.color.exact_rate')).toMatchObject({ classification: 'no_meaningful_change', delta: -0.0294, margin: 0.0804 })
    expect(small.has_regression).toBe(false)
  })

  it('describes every metric that moved or could not be judged, and counts the rest', () => {
    const lines = describeMetricChanges(changes)
    expect(lines.some((line) => line.startsWith('Metric regression: agreement.image_reviewed.occasion.exact_rate 1 -> 0'))).toBe(true)
    expect(lines.some((line) => line.startsWith('Metric inconclusive: grounding.image_reviewed.uncertainty_handling_rate'))).toBe(true)
    expect(lines[lines.length - 1]).toMatch(/^Metrics: 0 improvement, \d+ no meaningful change, \d+ regression, \d+ inconclusive, \d+ unavailable\.$/)
  })

  it('shows the same regression in the synthetic tier, and never in the human-reviewed one, for synthetic expectations', () => {
    const synthetic = classifyMetricChanges(evaluate('synthetic', 'synthetic_fixture'), evaluate('synthetic', 'synthetic_fixture', degrade))
    expect(classOf(synthetic, 'agreement.synthetic.occasion.exact_rate')).toBe('regression')
    expect(classOf(synthetic, 'agreement.image_reviewed.occasion.exact_rate')).toBe('unavailable')
  })
})

describe('reports that cannot be compared metric by metric', () => {
  it('treats a base without a metric index (report format /2) as unavailable, never as a regression', () => {
    const candidate = evaluate('image_review', 'model', degrade)
    const old = { ...evaluate('image_review', 'model') } as Partial<EvaluationReport>
    delete old.metric_index
    const changes = classifyMetricChanges(old as EvaluationReport, candidate)
    expect(changes.has_regression).toBe(false)
    expect(changes.counts.unavailable).toBe(changes.comparisons.length)
  })

  it('is inconclusive across a partial run', () => {
    const partial = evaluate('image_review', 'model', degrade, ['q-single-01', 'q-single-02', 'q-single-03', 'q-single-04', 'q-single-05', 'q-single-06', 'q-single-07', 'q-single-08', 'q-views-01', 'q-views-02', 'q-views-03'])
    const changes = classifyMetricChanges(evaluate('image_review', 'model'), partial)
    expect(classOf(changes, 'agreement.image_reviewed.occasion.exact_rate')).toBe('inconclusive')
    expect(changes.has_regression).toBe(false)
  })

  it('is inconclusive for reference-based metrics when the reference set changed', () => {
    const cases = fixtureCases('image_review')
    const references = fixtureReferences('image_review')
    // A first review was corrected: the figures of the two reports are no longer scored against the same thing.
    const edited = { ...references, dataset_version: '1.1.0', references: references.references.map((reference, index) => (index === 0 ? { ...reference, review_notes: 'Corrected after a second look.' } : reference)) }
    const base = evaluateRecording(fixtureRecording(cases, 'model'), cases, CURRENT, 'replay', { references })
    const candidate = evaluateRecording(fixtureRecording(cases, 'model', degrade), cases, CURRENT, 'replay', { references: edited })
    const changes = classifyMetricChanges(base, candidate)
    expect(base.references.fingerprint).not.toBe(candidate.references.fingerprint)
    expect(base.references.scoring_fingerprint).not.toBe(candidate.references.scoring_fingerprint)
    expect(classOf(changes, 'agreement.image_reviewed.occasion.exact_rate')).toBe('inconclusive')
    expect(classOf(changes, 'validity.valid_output_rate')).toBe('no_meaningful_change')
  })

  it('still compares when only the hand-kept version number changed: no review changed, so the figures mean the same', () => {
    // dataset_version is typed by hand. A bump with every first review unchanged cannot move a figure, so
    // it must not switch the comparison off: a comparison that is switched off hides a regression.
    const cases = fixtureCases('image_review')
    const references = fixtureReferences('image_review')
    const base = evaluateRecording(fixtureRecording(cases, 'model'), cases, CURRENT, 'replay', { references })
    const candidate = evaluateRecording(fixtureRecording(cases, 'model', degrade), cases, CURRENT, 'replay', { references: { ...references, dataset_version: '1.1.0' } })
    expect(base.references.fingerprint).not.toBe(candidate.references.fingerprint)
    expect(base.references.scoring_fingerprint).toBe(candidate.references.scoring_fingerprint)
    const changes = classifyMetricChanges(base, candidate)
    expect(classOf(changes, 'agreement.image_reviewed.occasion.exact_rate')).toBe('regression')
    expect(changes.has_regression).toBe(true)
  })

  it('falls back to the full fingerprint for a report written before the scoring fingerprint existed', () => {
    const cases = fixtureCases('image_review')
    const references = fixtureReferences('image_review')
    const older = evaluateRecording(fixtureRecording(cases, 'model'), cases, CURRENT, 'replay', { references })
    delete (older.references as { scoring_fingerprint?: unknown }).scoring_fingerprint
    const same = evaluateRecording(fixtureRecording(cases, 'model', degrade), cases, CURRENT, 'replay', { references })
    const reversioned = evaluateRecording(fixtureRecording(cases, 'model', degrade), cases, CURRENT, 'replay', { references: { ...references, dataset_version: '1.1.0' } })
    // Same full fingerprint: compared, as it always was. A different one: not compared, as it always was.
    expect(classOf(classifyMetricChanges(older, same), 'agreement.image_reviewed.occasion.exact_rate')).toBe('regression')
    expect(classOf(classifyMetricChanges(older, reversioned), 'agreement.image_reviewed.occasion.exact_rate')).toBe('inconclusive')
  })
})

describe('baseline protection covers metric-level regressions', () => {
  it('refuses a report that is worse metric by metric, although every case passes', () => {
    const decision = assessBaselineUpdate(evaluate('image_review', 'model'), evaluate('image_review', 'model', degrade))
    expect(decision.allowed).toBe(false)
    const reasons = (decision as { reasons: string[] }).reasons
    expect(reasons[0]).toMatch(/worse than the current baseline/)
    expect(reasons.some((line) => line.startsWith('Metric regression: agreement.image_reviewed.occasion.exact_rate'))).toBe(true)
    expect(reasons[reasons.length - 1]).toContain(ACCEPT_WORSE_BASELINE)
  })

  it('accepts it only with the explicit decision, and records that it was accepted', () => {
    const decision = assessBaselineUpdate(evaluate('image_review', 'model'), evaluate('image_review', 'model', degrade), { acceptRegressions: true })
    expect(decision.allowed).toBe(true)
    expect((decision as { notes: string[] }).notes).toContain('Regressions were accepted explicitly.')
  })

  it('allows an equal or better report without any phrase', () => {
    expect(assessBaselineUpdate(evaluate('image_review', 'model', degrade), evaluate('image_review', 'model')).allowed).toBe(true)
    expect(assessBaselineUpdate(evaluate('image_review', 'model'), evaluate('image_review', 'model')).allowed).toBe(true)
  })

  it('still never lets a partial run replace a baseline', () => {
    const partial = evaluate('image_review', 'model', undefined, ['q-single-01'])
    expect(assessBaselineUpdate(evaluate('image_review', 'model'), partial, { acceptRegressions: true }).allowed).toBe(false)
  })
})
