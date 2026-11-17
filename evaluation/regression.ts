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
 *   caller states explicitly that the regressions are accepted.
 *
 * This module performs no network request.
 */

import { BLOCKING_CHECKS, checkStatus, type BlockingCheckId, type CheckStatus } from './checks'
import type { CaseReport, EvaluationReport } from './evaluate'

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
  const datasetChanged = current.dataset?.fingerprint !== candidate.dataset?.fingerprint
  if (regressions.has_regression && !options.acceptRegressions) {
    return {
      allowed: false,
      reasons: [
        'The new report is worse than the current baseline, so the baseline was not replaced.',
        ...describeRegressions(regressions).filter((line) => !/^(Fixed|Added|Consistency change: .* -> pass)/.test(line)),
        `To accept this on purpose, set EVAL_ACCEPT_REGRESSIONS=${ACCEPT_WORSE_BASELINE}.`,
      ],
    }
  }
  const notes: string[] = []
  if (datasetChanged) notes.push('The dataset changed since the previous baseline.')
  if (regressions.has_regression) notes.push('Regressions were accepted explicitly.', ...describeRegressions(regressions))
  else notes.push(...describeRegressions(regressions))
  return { allowed: true, notes }
}
