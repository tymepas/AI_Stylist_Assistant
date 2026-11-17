/**
 * Regression classification between two evaluation reports, and the rules for
 * replacing a baseline.
 *
 * A baseline is a complete report that was committed on purpose. It is never
 * replaced as a side effect of running an evaluation:
 *
 * - a PARTIAL report (a run filtered by case, category or scenario) can never
 *   become a baseline;
 * - a report whose recording was made for a different dataset cannot either;
 * - a report that is WORSE than the current baseline is refused unless the
 *   caller states explicitly that the regressions are accepted. Worse means a
 *   case-level regression (a check that started failing) or a metric-level
 *   regression (a figure that moved the wrong way by more than the noise margin,
 *   or a figure that was measured and is gone).
 * - When the dataset or the reference set changed, the figures of the two reports
 *   are not comparable. The update is then judged at case level only, and its
 *   notes say how many figures were not compared.
 *
 * This module performs no network request.
 */

import { BLOCKING_CHECKS, checkStatus, type BlockingCheckId, type CheckStatus } from './checks'
import type { CaseReport, EvaluationReport } from './evaluate'
import { noiseMargin, type IndexedMetric, type MetricIndex } from './quality'

export interface CheckRegression {
  case_id: string
  check: BlockingCheckId
  reason: string
}

export interface RegressionReport {
  /** False when the two reports do not describe the same dataset or one of them has no per-case checks. */
  comparable: boolean
  not_comparable_reasons: string[]
  base_partial: boolean
  candidate_partial: boolean
  /** Cases that did not fail in the base and fail in the candidate. */
  newly_failing: Array<{ case_id: string; reasons: string[] }>
  /** Cases that failed in the base and pass in the candidate. */
  fixed: string[]
  still_failing: string[]
  /** Cases that were judged in the base and can no longer be judged. Losing a check is not an improvement. */
  no_longer_judged: string[]
  safety_regressions: CheckRegression[]
  unsupported_claim_regressions: CheckRegression[]
  schema_regressions: CheckRegression[]
  uncertainty_regressions: CheckRegression[]
  verdict_integrity_regressions: CheckRegression[]
  /** Cases whose consistency across repeated runs changed, in either direction. */
  consistency_changes: Array<{ case_id: string; base: CheckStatus; candidate: CheckStatus }>
  added_cases: string[]
  /** Cases of the base that are missing from a COMPLETE candidate. Empty for a partial candidate. */
  removed_cases: string[]
  has_regression: boolean
}

function hasChecks(report: EvaluationReport): boolean {
  return Array.isArray(report.cases) && report.cases.every((entry) => Array.isArray((entry as Partial<CaseReport>).checks))
}

function isPartial(report: EvaluationReport): boolean {
  return Boolean(report.selection?.partial)
}

function reasonFor(entry: CaseReport, check: BlockingCheckId): string {
  return entry.checks.find((result) => result.check === check)?.reason ?? 'failed'
}

/** What changed, case by case, between a base report and a candidate report. */
export function classifyRegressions(base: EvaluationReport, candidate: EvaluationReport): RegressionReport {
  const notComparable: string[] = []
  if (!hasChecks(base)) notComparable.push('The base report has no per-case checks (an older report format).')
  if (!hasChecks(candidate)) notComparable.push('The candidate report has no per-case checks (an older report format).')
  if (base.dataset?.fingerprint !== candidate.dataset?.fingerprint) notComparable.push('The two reports were produced from different datasets.')

  const report: RegressionReport = {
    comparable: notComparable.length === 0,
    not_comparable_reasons: notComparable,
    base_partial: isPartial(base),
    candidate_partial: isPartial(candidate),
    newly_failing: [],
    fixed: [],
    still_failing: [],
    no_longer_judged: [],
    safety_regressions: [],
    unsupported_claim_regressions: [],
    schema_regressions: [],
    uncertainty_regressions: [],
    verdict_integrity_regressions: [],
    consistency_changes: [],
    added_cases: [],
    removed_cases: [],
    has_regression: false,
  }
  if (!hasChecks(base) || !hasChecks(candidate)) {
    // Without checks on both sides nothing can be classified; treat it as a regression so it is never waved through.
    report.has_regression = true
    return report
  }

  const baseCases = new Map(base.cases.map((entry) => [entry.case_id, entry]))
  const candidateCases = new Map(candidate.cases.map((entry) => [entry.case_id, entry]))
  const perCheck: Partial<Record<BlockingCheckId, CheckRegression[]>> = {
    safety: report.safety_regressions,
    unsupported_claims: report.unsupported_claim_regressions,
    schema_validity: report.schema_regressions,
    uncertainty: report.uncertainty_regressions,
    verdict_integrity: report.verdict_integrity_regressions,
  }

  for (const caseId of [...new Set([...baseCases.keys(), ...candidateCases.keys()])].sort()) {
    const before = baseCases.get(caseId)
    const after = candidateCases.get(caseId)
    if (!before) { report.added_cases.push(caseId); continue }
    if (!after) {
      // A partial candidate leaves cases out on purpose; a complete one must not lose any.
      if (!report.candidate_partial) report.removed_cases.push(caseId)
      continue
    }

    if (after.status === 'fail' && before.status !== 'fail') report.newly_failing.push({ case_id: caseId, reasons: after.failure_reasons })
    else if (after.status === 'fail') report.still_failing.push(caseId)
    else if (before.status === 'fail' && after.status === 'pass') report.fixed.push(caseId)
    if (after.status === 'not_applicable' && before.status !== 'not_applicable') report.no_longer_judged.push(caseId)

    for (const check of BLOCKING_CHECKS) {
      const was = checkStatus(before, check)
      const now = checkStatus(after, check)
      if (now === 'fail' && was !== 'fail') perCheck[check]?.push({ case_id: caseId, check, reason: reasonFor(after, check) })
      if (check === 'consistency' && was !== now) report.consistency_changes.push({ case_id: caseId, base: was, candidate: now })
    }
  }

  report.has_regression =
    report.newly_failing.length > 0 ||
    report.no_longer_judged.length > 0 ||
    report.removed_cases.length > 0 ||
    report.safety_regressions.length > 0 ||
    report.unsupported_claim_regressions.length > 0 ||
    report.schema_regressions.length > 0 ||
    report.uncertainty_regressions.length > 0 ||
    report.verdict_integrity_regressions.length > 0 ||
    report.consistency_changes.some((change) => change.candidate === 'fail')
  return report
}

/** One line per finding, for the console and for a refusal message. */
export function describeRegressions(regressions: RegressionReport): string[] {
  const lines: string[] = []
  for (const reason of regressions.not_comparable_reasons) lines.push(`Not comparable: ${reason}`)
  for (const entry of regressions.newly_failing) lines.push(`Newly failing: ${entry.case_id} (${entry.reasons.join(' | ')})`)
  for (const caseId of regressions.no_longer_judged) lines.push(`No longer judged: ${caseId}`)
  for (const caseId of regressions.removed_cases) lines.push(`Removed from the dataset: ${caseId}`)
  const groups: Array<[string, CheckRegression[]]> = [
    ['Safety regression', regressions.safety_regressions],
    ['Unsupported-claim regression', regressions.unsupported_claim_regressions],
    ['Schema regression', regressions.schema_regressions],
    ['Uncertainty regression', regressions.uncertainty_regressions],
    ['Verdict integrity regression', regressions.verdict_integrity_regressions],
  ]
  for (const [label, entries] of groups) for (const entry of entries) lines.push(`${label}: ${entry.case_id} (${entry.reason})`)
  for (const change of regressions.consistency_changes) lines.push(`Consistency change: ${change.case_id} (${change.base} -> ${change.candidate})`)
  for (const caseId of regressions.fixed) lines.push(`Fixed: ${caseId}`)
  for (const caseId of regressions.added_cases) lines.push(`Added: ${caseId}`)
  return lines
}

/** Exact phrase required to replace a baseline with a report that is worse than it. */
export const ACCEPT_WORSE_BASELINE = 'I_ACCEPT_A_WORSE_BASELINE'

export type BaselineDecision =
  | { allowed: true; notes: string[] }
  | { allowed: false; reasons: string[] }

/**
 * Decides whether `candidate` may replace `current` as the committed baseline.
 * `acceptRegressions` must be true (set from the exact ACCEPT_WORSE_BASELINE
 * phrase) for a worse report; it never unlocks a partial or mismatched report.
 */
export function assessBaselineUpdate(current: EvaluationReport | null, candidate: EvaluationReport, options: { acceptRegressions?: boolean } = {}): BaselineDecision {
  const reasons: string[] = []
  if (isPartial(candidate)) reasons.push('A partial run cannot become a baseline. Run the whole dataset.')
  if (!hasChecks(candidate)) reasons.push('The report has no per-case checks.')
  if (candidate.dataset && !candidate.dataset.matches_recording) reasons.push('The recording was made for a different dataset than the manifest.')
  if (reasons.length > 0) return { allowed: false, reasons }

  if (current === null) {
    return { allowed: true, notes: candidate.summary.failed > 0 ? [`First baseline. It records ${candidate.summary.failed} failing case(s) as the accepted state.`] : ['First baseline.'] }
  }

  const regressions = classifyRegressions(current, candidate)
  const metricChanges = classifyMetricChanges(current, candidate)
  const metricLines = describeMetricChanges(metricChanges)
  const worse = regressions.has_regression || metricChanges.has_regression
  const datasetChanged = current.dataset?.fingerprint !== candidate.dataset?.fingerprint
  if (worse && !options.acceptRegressions) {
    return {
      allowed: false,
      reasons: [
        'The new report is worse than the current baseline, so the baseline was not replaced.',
        ...describeRegressions(regressions).filter((line) => !/^(Fixed|Added|Consistency change: .* -> pass)/.test(line)),
        ...metricLines.filter((line) => line.startsWith('Metric regression') || line.startsWith('Metric lost')),
        `To accept this on purpose, set EVAL_ACCEPT_REGRESSIONS=${ACCEPT_WORSE_BASELINE}.`,
      ],
    }
  }
  const notes: string[] = []
  if (datasetChanged) notes.push('The dataset changed since the previous baseline.')
  if (worse) notes.push('Regressions were accepted explicitly.')
  notes.push(...describeRegressions(regressions), ...metricLines)
  return { allowed: true, notes }
}

// ---------------------------------------------------------------------------
// Metric-level regression
// ---------------------------------------------------------------------------

/**
 * How one metric changed between two reports.
 *
 * - `improvement` / `regression`: the figure moved in the good or the bad
 *   direction by more than the noise margin, on enough samples on both sides.
 * - `no_meaningful_change`: it moved by no more than the noise margin.
 * - `inconclusive`: there is a figure on both sides, but it cannot support a
 *   conclusion: too few samples, a partial run, or the two reports do not
 *   describe the same dataset or the same references.
 * - `unavailable`: one side has no figure at all.
 *
 * Losing a figure is not neutral. A metric that was measured in the base and
 * has no measured figure in the candidate, on the same dataset and references,
 * is listed under `lost` and counts as worse, exactly as a case that can no
 * longer be judged does at case level. Otherwise an output that stops
 * producing something (for example the per-item notes of an outfit) would make
 * its own metric disappear and pass.
 *
 * The noise margin is the larger of a fixed floor (5 percentage points for a
 * rate, a quarter of a band for a mean absolute error) and 1.96 standard errors
 * of the difference. The thresholds live in quality.ts.
 */
export const METRIC_CLASSES = ['improvement', 'no_meaningful_change', 'regression', 'inconclusive', 'unavailable'] as const
export type MetricClass = (typeof METRIC_CLASSES)[number]

export interface MetricComparison {
  metric: string
  classification: MetricClass
  base: number | null
  candidate: number | null
  /** candidate − base; null unless both sides have a figure. */
  delta: number | null
  /** The noise margin the delta was judged against; null unless both sides have a figure. */
  margin: number | null
  base_n: number
  candidate_n: number
  reason: string
}

export interface MetricRegressionReport {
  comparisons: MetricComparison[]
  counts: Record<MetricClass, number>
  regressions: string[]
  improvements: string[]
  /** Measured in the base, not measured in the candidate, although the two are comparable. Counts as worse. */
  lost: string[]
  /** Metrics that could not be compared because the dataset or the reference set differs. */
  not_compared: number
  /** True when a metric regressed or was lost. */
  has_regression: boolean
}

export interface MetricComparisonContext {
  /** False when the two reports were produced from different manifests. */
  sameDataset: boolean
  /** False when the two reports used different reference sets. Only metrics that depend on references are affected. */
  sameReferences: boolean
  /** True when either report covers only part of its dataset. */
  partial: boolean
}

export function classifyMetric(metric: string, base: IndexedMetric | undefined, candidate: IndexedMetric | undefined, context: MetricComparisonContext): MetricComparison {
  const result = (classification: MetricClass, reason: string, delta: number | null = null, margin: number | null = null): MetricComparison => ({
    metric,
    classification,
    base: base?.value ?? null,
    candidate: candidate?.value ?? null,
    delta,
    margin,
    base_n: base?.n ?? 0,
    candidate_n: candidate?.n ?? 0,
    reason,
  })

  if (!base || base.value === null) return result('unavailable', base ? `The base has no figure. ${base.reason ?? ''}`.trim() : 'The base report does not carry this metric.')
  if (!candidate || candidate.value === null) return result('unavailable', candidate ? `The candidate has no figure. ${candidate.reason ?? ''}`.trim() : 'The candidate report does not carry this metric.')

  const delta = Math.round((candidate.value - base.value) * 10_000) / 10_000
  const margin = noiseMargin(candidate.kind, base.se, candidate.se)
  if (!context.sameDataset) return result('inconclusive', 'The two reports were produced from different datasets.', delta, margin)
  if (context.partial) return result('inconclusive', 'At least one report covers only part of the dataset.', delta, margin)
  if (candidate.needs_references && !context.sameReferences) return result('inconclusive', 'The two reports used different reference sets.', delta, margin)
  if (base.status !== 'measured' || candidate.status !== 'measured') {
    return result('inconclusive', `Too few samples (base ${base.n}, candidate ${candidate.n}).`, delta, margin)
  }
  if (Math.abs(delta) <= margin) return result('no_meaningful_change', `A change of ${delta} is within the noise margin of ${margin}.`, delta, margin)

  const better = candidate.direction === 'higher_is_better' ? delta > 0 : delta < 0
  return result(better ? 'improvement' : 'regression', `A change of ${delta} exceeds the noise margin of ${margin}.`, delta, margin)
}

/** Every metric of two reports, classified. A report without a metric index (format /2 and older) makes every metric `unavailable`. */
export function classifyMetricChanges(base: EvaluationReport, candidate: EvaluationReport): MetricRegressionReport {
  const baseIndex: MetricIndex = base.metric_index ?? {}
  const candidateIndex: MetricIndex = candidate.metric_index ?? {}
  const context: MetricComparisonContext = {
    sameDataset: base.dataset?.fingerprint === candidate.dataset?.fingerprint,
    sameReferences: (base.references?.fingerprint ?? null) === (candidate.references?.fingerprint ?? null),
    partial: isPartial(base) || isPartial(candidate),
  }
  const comparisons = [...new Set([...Object.keys(baseIndex), ...Object.keys(candidateIndex)])]
    .sort()
    .map((metric) => classifyMetric(metric, baseIndex[metric], candidateIndex[metric], context))

  const counts = Object.fromEntries(METRIC_CLASSES.map((entry) => [entry, 0])) as Record<MetricClass, number>
  for (const comparison of comparisons) counts[comparison.classification] += 1
  const named = (wanted: MetricClass) => comparisons.filter((comparison) => comparison.classification === wanted).map((comparison) => comparison.metric)

  // Whether a difference between the two reports can be read as a change in this metric at all.
  const comparable = (metric: string) => context.sameDataset && !context.partial && (context.sameReferences || !baseIndex[metric]?.needs_references)
  const lost = Object.keys(baseIndex).sort().filter((metric) => baseIndex[metric].status === 'measured' && candidateIndex[metric]?.status !== 'measured' && comparable(metric))
  const notCompared = comparisons.filter((comparison) => comparison.base !== null && comparison.candidate !== null && !comparable(comparison.metric) && !context.partial).length

  return { comparisons, counts, regressions: named('regression'), improvements: named('improvement'), lost, not_compared: notCompared, has_regression: counts.regression > 0 || lost.length > 0 }
}

/** One line per metric that moved or could not be judged, then a line of counts. Unavailable metrics are counted, not listed. */
export function describeMetricChanges(changes: MetricRegressionReport): string[] {
  const lines: string[] = []
  const labels: Partial<Record<MetricClass, string>> = { regression: 'Metric regression', improvement: 'Metric improvement', inconclusive: 'Metric inconclusive' }
  for (const wanted of ['regression', 'improvement', 'inconclusive'] as const) {
    for (const comparison of changes.comparisons.filter((entry) => entry.classification === wanted)) {
      lines.push(`${labels[wanted]}: ${comparison.metric} ${comparison.base} -> ${comparison.candidate} (${comparison.reason})`)
    }
  }
  for (const metric of changes.lost) {
    const comparison = changes.comparisons.find((entry) => entry.metric === metric) as MetricComparison
    lines.push(`Metric lost: ${metric} was measured in the baseline (${comparison.base}, ${comparison.base_n} cases) and has no measured figure now (${comparison.candidate === null ? 'no figure' : `${comparison.candidate}, ${comparison.candidate_n} cases`})`)
  }
  if (changes.not_compared > 0) lines.push(`Metrics not compared: ${changes.not_compared} figure(s) exist on both sides but the dataset or the reference set differs, so nothing is concluded from them.`)
  lines.push(`Metrics: ${METRIC_CLASSES.map((entry) => `${changes.counts[entry]} ${entry.replace(/_/g, ' ')}`).join(', ')}.`)
  return lines
}
