/**
 * Evaluates a recording without calling any provider.
 *
 * Each recorded output goes through the same steps as a live response: schema
 * validation, then the production verdict engine. The result is a report that
 * contains no model text and no timestamps, so two reports can be compared with
 * an ordinary diff.
 *
 * This module never performs a network request, and the evaluation runner disables fetch while it runs.
 */

import type { RawOpenAIAnalysisResult } from '@/types/openai'
import { buildCompleteAnalysisResult } from '@/lib/services/analysisResultService'
import { validateRawOpenAIAnalysis } from '@/lib/services/openai/openAIAnalysisSchema'
import { modelText, scanText, type Band, type BenchmarkCase } from '@/benchmark/harness'
import { BLOCKING_CHECKS, PROXY_CHECKS, checkStatus, evaluateCase, type BlockingCheckId, type CaseStatus, type CheckResult, type ProxyCheckId } from './checks'
import { computeMetrics, modalOutcome, outcomeSignature, type EvaluationMetrics, type RunDetail } from './metrics'
import { computePerformance, type PerformanceReport } from './performance'
import { datasetFingerprint, stableStringify, type Recording } from './recording'
import { describeSelection, selectCases, type CaseSelection, type SelectionReport } from './selection'

/** /2 adds per-case checks, the summary, the selection and performance. /1 reports have none of them. */
export const REPORT_FORMAT = 'verdict-evaluation-report/2'

export type EvaluationMode = 'mock' | 'replay'

export interface CurrentVersions {
  promptVersion: string
  schemaVersion: string
}

export interface CaseReport {
  case_id: string
  category: BenchmarkCase['category']
  acceptable_bands: Band[]
  should_abstain: boolean
  /** One entry per run, in run order: a band, `abstain`, `error` or `withheld`. */
  outcomes: string[]
  modal_outcome: string | null
  /** Whether the modal outcome is what the case expects; null when the case states no expectation. */
  meets_expectation: boolean | null
  /** What the scenario is about; null for cases that do not say. */
  scenario: BenchmarkCase['scenario'] | null
  /** `fail` when any blocking check failed, `not_applicable` when nothing could be judged. */
  status: CaseStatus
  checks: CheckResult[]
  /** One line per failed blocking check. Names dimensions, bands and categories only, never model text. */
  failure_reasons: string[]
  /** Proxy checks that did not hold. For human review; they never fail a case. */
  proxy_flags: string[]
}

export interface EvaluationSummary {
  total_cases: number
  passed: number
  failed: number
  not_applicable: number
  /** passed / (passed + failed); null when no case could be judged. */
  pass_rate: number | null
  /** Failed cases per blocking check. One case can fail several checks. */
  failures_by_check: Record<BlockingCheckId, number>
  failures_by_category: Record<string, number>
  failures_by_scenario: Record<string, number>
  safety_failures: number
  unsupported_claim_failures: number
  schema_failures: number
  uncertainty_failures: number
  verdict_integrity_failures: number
  /** Cases flagged by a proxy check. Proxies are rough textual signals for human review, not measurements of fashion quality. */
  proxy_flags: Record<ProxyCheckId, number>
}

export interface EvaluationReport {
  report_format: typeof REPORT_FORMAT
  mode: EvaluationMode
  provenance: Recording['provenance']
  /** What may and may not be concluded from this report. */
  interpretation: string
  subject: {
    model: string
    reasoning_effort: string | null
    max_output_tokens: number
    prompt_version: string
    schema_version: string
  }
  /** The prompt and schema versions of the code that produced this report. */
  evaluated_with: {
    prompt_version: string
    schema_version: string
    same_prompt_as_recording: boolean
    same_schema_as_recording: boolean
  }
  dataset: {
    fingerprint: string
    cases: number
    cases_with_verified_labels: number
    matches_recording: boolean
  }
  /** Which cases were evaluated. A partial report can never become a baseline. */
  selection: SelectionReport
  summary: EvaluationSummary
  /** Latency and cost, only when they were measured. Unavailable for synthetic fixtures. */
  performance: PerformanceReport
  metrics: EvaluationMetrics
  cases: CaseReport[]
}

export interface EvaluationOptions {
  /** Evaluate only some cases. The report is then marked partial. */
  selection?: CaseSelection
}

const INTERPRETATION: Record<Recording['provenance'], string> = {
  synthetic_fixture:
    'Hand-written fixture outputs. This report checks that the evaluation harness and the deterministic verdict code behave as intended. It says nothing about model quality.',
  model:
    'Recorded model outputs. Rates describe this model, prompt version and dataset only. Agreement with expected bands is an end-to-end result; it is not a measure of recognition accuracy.',
}

/** Turns recorded entries into run details, validating each output against the current schema. */
export function detailsFromRecording(recording: Recording, cases: BenchmarkCase[]): RunDetail[] {
  const byCase = new Map(cases.map((benchmarkCase) => [benchmarkCase.id, benchmarkCase]))
  const details: RunDetail[] = []

  for (const entry of recording.entries) {
    const benchmarkCase = byCase.get(entry.case_id)
    // An entry for a case that is not in the manifest cannot be judged.
    if (!benchmarkCase) continue
    const base = { case_id: entry.case_id, run: entry.run, prohibited_hits: [] as string[], forbidden_claim_hits: [] as string[] }

    if (entry.outcome === 'withheld') {
      details.push({ ...base, outcome: 'withheld' })
      continue
    }
    if (entry.outcome === 'error') {
      details.push({ ...base, outcome: 'error', error_code: entry.error_code })
      continue
    }

    let result: RawOpenAIAnalysisResult
    try {
      result = validateRawOpenAIAnalysis(entry.output)
    } catch {
      details.push({ ...base, outcome: 'error', error_code: 'invalid_response' })
      continue
    }

    const scan = scanText(modelText(result), benchmarkCase.expected.forbidden_claims)
    const screened = { ...base, prohibited_hits: scan.prohibited, forbidden_claim_hits: scan.forbidden }
    if (result.status === 'unable_to_analyze') {
      details.push({ ...screened, outcome: 'unable_to_analyze' })
      continue
    }
    const report = buildCompleteAnalysisResult(result.dimensions)
    details.push({ ...screened, outcome: 'complete', band: report.overall_recommendation, score: report.verdict_score, dimensions: result.dimensions })
  }

  return details.sort((a, b) => a.case_id.localeCompare(b.case_id) || a.run - b.run)
}

function meetsExpectation(benchmarkCase: BenchmarkCase, modalValue: string | undefined): boolean | null {
  if (modalValue === undefined) return null
  if (benchmarkCase.expected.should_abstain) return modalValue === 'abstain'
  if (benchmarkCase.expected.acceptable_bands.length === 0) return null
  return (benchmarkCase.expected.acceptable_bands as string[]).includes(modalValue)
}

function count<T extends string>(keys: readonly T[], of: (key: T) => number): Record<T, number> {
  return Object.fromEntries(keys.map((key) => [key, of(key)])) as Record<T, number>
}

function tally(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1
  return counts
}

export function summarizeCases(cases: CaseReport[]): EvaluationSummary {
  const failed = cases.filter((entry) => entry.status === 'fail')
  const passed = cases.filter((entry) => entry.status === 'pass').length
  const failuresByCheck = count(BLOCKING_CHECKS, (check) => cases.filter((entry) => checkStatus(entry, check) === 'fail').length)
  return {
    total_cases: cases.length,
    passed,
    failed: failed.length,
    not_applicable: cases.length - passed - failed.length,
    pass_rate: passed + failed.length === 0 ? null : Math.round((passed / (passed + failed.length)) * 10_000) / 10_000,
    failures_by_check: failuresByCheck,
    failures_by_category: tally(failed.map((entry) => entry.category)),
    failures_by_scenario: tally(failed.map((entry) => entry.scenario ?? 'unspecified')),
    safety_failures: failuresByCheck.safety,
    unsupported_claim_failures: failuresByCheck.unsupported_claims,
    schema_failures: failuresByCheck.schema_validity,
    uncertainty_failures: failuresByCheck.uncertainty,
    verdict_integrity_failures: failuresByCheck.verdict_integrity,
    proxy_flags: count(PROXY_CHECKS, (check) => cases.filter((entry) => checkStatus(entry, check) === 'fail').length),
  }
}

export function evaluateRecording(recording: Recording, allCases: BenchmarkCase[], current: CurrentVersions, mode: EvaluationMode, options: EvaluationOptions = {}): EvaluationReport {
  // The fingerprint always describes the WHOLE dataset, so a partial report still says which dataset it came from.
  const fingerprint = datasetFingerprint(allCases)
  const cases = selectCases(allCases, options.selection)
  const selectedIds = new Set(cases.map((benchmarkCase) => benchmarkCase.id))
  const details = detailsFromRecording(recording, cases)

  const caseReports: CaseReport[] = [...cases]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((benchmarkCase) => {
      const runs = details.filter((detail) => detail.case_id === benchmarkCase.id)
      const modalValue = modalOutcome(runs)
      const evaluation = evaluateCase(benchmarkCase, runs)
      return {
        case_id: benchmarkCase.id,
        category: benchmarkCase.category,
        acceptable_bands: benchmarkCase.expected.acceptable_bands,
        should_abstain: benchmarkCase.expected.should_abstain,
        outcomes: runs.map((run) => (run.outcome === 'withheld' ? 'withheld' : outcomeSignature(run))),
        modal_outcome: modalValue ?? null,
        meets_expectation: meetsExpectation(benchmarkCase, modalValue),
        scenario: benchmarkCase.scenario ?? null,
        status: evaluation.status,
        checks: evaluation.checks,
        failure_reasons: evaluation.failure_reasons,
        proxy_flags: evaluation.proxy_flags,
      }
    })

  return {
    report_format: REPORT_FORMAT,
    mode,
    provenance: recording.provenance,
    interpretation: INTERPRETATION[recording.provenance],
    subject: {
      model: recording.model,
      reasoning_effort: recording.reasoning_effort,
      max_output_tokens: recording.max_output_tokens,
      prompt_version: recording.prompt_version,
      schema_version: recording.schema_version,
    },
    evaluated_with: {
      prompt_version: current.promptVersion,
      schema_version: current.schemaVersion,
      same_prompt_as_recording: current.promptVersion === recording.prompt_version,
      same_schema_as_recording: current.schemaVersion === recording.schema_version,
    },
    dataset: {
      fingerprint,
      cases: allCases.length,
      cases_with_verified_labels: allCases.filter((benchmarkCase) => benchmarkCase.labels?.verified).length,
      matches_recording: fingerprint === recording.dataset_fingerprint,
    },
    selection: describeSelection(options.selection, cases.length),
    summary: summarizeCases(caseReports),
    performance: computePerformance(recording, recording.entries.filter((entry) => selectedIds.has(entry.case_id))),
    metrics: computeMetrics(details, cases),
    cases: caseReports,
  }
}

/** The report as stable JSON: sorted keys, no timestamps, so reports diff cleanly. */
export function serializeReport(report: EvaluationReport): string {
  return stableStringify(report)
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

export interface MetricChange {
  metric: string
  base: number | boolean | null
  candidate: number | boolean | null
  /** candidate − base for numbers; null otherwise. */
  delta: number | null
}

export interface ReportComparison {
  /** False when the two reports were produced from different datasets: the numbers are then not comparable. */
  comparable: boolean
  subject_changes: Array<{ field: string; base: string | number | null; candidate: string | number | null }>
  metric_changes: MetricChange[]
  case_changes: Array<{ case_id: string; base: string | null; candidate: string | null }>
}

function flattenMetrics(value: unknown, prefix: string, out: Map<string, number | boolean | null>): void {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    out.set(prefix, value)
    return
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of Object.keys(value).sort()) flattenMetrics((value as Record<string, unknown>)[key], prefix ? `${prefix}.${key}` : key, out)
  }
  // Strings (for example a status or a reason) are not metrics.
}

/** Differences between two reports, for comparing prompt versions or models on the same dataset. */
export function compareReports(base: EvaluationReport, candidate: EvaluationReport): ReportComparison {
  const subjectChanges: ReportComparison['subject_changes'] = []
  for (const field of Object.keys(base.subject).sort() as Array<keyof EvaluationReport['subject']>) {
    if (base.subject[field] !== candidate.subject[field]) subjectChanges.push({ field, base: base.subject[field], candidate: candidate.subject[field] })
  }

  const baseMetrics = new Map<string, number | boolean | null>()
  const candidateMetrics = new Map<string, number | boolean | null>()
  flattenMetrics(base.metrics, '', baseMetrics)
  flattenMetrics(candidate.metrics, '', candidateMetrics)
  const metricChanges: MetricChange[] = []
  for (const metric of [...new Set([...baseMetrics.keys(), ...candidateMetrics.keys()])].sort()) {
    const before = baseMetrics.get(metric) ?? null
    const after = candidateMetrics.get(metric) ?? null
    if (before === after) continue
    const delta = typeof before === 'number' && typeof after === 'number' ? Math.round((after - before) * 10_000) / 10_000 : null
    metricChanges.push({ metric, base: before, candidate: after, delta })
  }

  const baseCases = new Map(base.cases.map((entry) => [entry.case_id, entry.modal_outcome]))
  const candidateCases = new Map(candidate.cases.map((entry) => [entry.case_id, entry.modal_outcome]))
  const caseChanges: ReportComparison['case_changes'] = []
  for (const caseId of [...new Set([...baseCases.keys(), ...candidateCases.keys()])].sort()) {
    const before = baseCases.get(caseId) ?? null
    const after = candidateCases.get(caseId) ?? null
    if (before !== after) caseChanges.push({ case_id: caseId, base: before, candidate: after })
  }

  return {
    comparable: base.dataset.fingerprint === candidate.dataset.fingerprint,
    subject_changes: subjectChanges,
    metric_changes: metricChanges,
    case_changes: caseChanges,
  }
}

// ---------------------------------------------------------------------------
// Human-readable summary
// ---------------------------------------------------------------------------

function show(value: number | null): string {
  return value === null ? 'n/a' : String(value)
}

function showMicroUsd(value: number | null): string {
  return value === null ? 'n/a' : `$${(value / 1_000_000).toFixed(6)}`
}

function showCounts(counts: Record<string, number>): string {
  return Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key} ${value}`).join(', ') || 'none'
}

/** A short Markdown summary of a report. Contains aggregates only, never model text. */
export function renderMarkdown(report: EvaluationReport): string {
  const { metrics, subject, summary, performance } = report
  const failing = report.cases.filter((entry) => entry.status === 'fail')
  const flagged = report.cases.filter((entry) => entry.proxy_flags.length > 0)
  const caseLines = [
    '## Cases',
    '',
    `- Total: ${summary.total_cases} (passed ${summary.passed}, failed ${summary.failed}, not applicable ${summary.not_applicable})`,
    `- Pass rate: ${show(summary.pass_rate)}${report.selection.partial ? ' — PARTIAL RUN: only the selected cases were evaluated; this report cannot become a baseline' : ''}`,
    `- Safety failures: ${summary.safety_failures}; unsupported-claim failures: ${summary.unsupported_claim_failures}; schema failures: ${summary.schema_failures}`,
    `- Uncertainty failures: ${summary.uncertainty_failures}; verdict integrity failures: ${summary.verdict_integrity_failures}`,
    `- Failures by category: ${showCounts(summary.failures_by_category)}`,
    `- Failures by scenario: ${showCounts(summary.failures_by_scenario)}`,
    `- Latency: ${performance.latency.status === 'recorded' ? `p50 ${performance.latency.p50_ms} ms, p95 ${performance.latency.p95_ms} ms over ${performance.latency.runs} runs` : `unavailable (${performance.latency.reason})`}`,
    `- Cost: ${performance.cost.status === 'recorded' ? `${showMicroUsd(performance.cost.total_micro_usd)} total, ${showMicroUsd(performance.cost.median_micro_usd_per_run)} median per run over ${performance.cost.runs_with_usage} runs` : `unavailable (${performance.cost.reason})`}`,
    `- Proxy flags for human review (not failures, not a measure of fashion quality): occasion ${summary.proxy_flags.proxy_occasion}, explanation ${summary.proxy_flags.proxy_explanation}`,
    '',
    ...(failing.length > 0 ? ['| Failing case | Reason |', '|---|---|', ...failing.flatMap((entry) => entry.failure_reasons.map((reason) => `| ${entry.case_id} | ${reason} |`)), ''] : []),
    ...(flagged.length > 0 ? ['| Case flagged for review | Proxy |', '|---|---|', ...flagged.flatMap((entry) => entry.proxy_flags.map((flag) => `| ${entry.case_id} | ${flag} |`)), ''] : []),
    '## Metrics',
    '',
  ]
  const lines = [
    `# Evaluation report (${report.mode})`,
    '',
    `> ${report.interpretation}`,
    '',
    `- Model: ${subject.model} (reasoning ${subject.reasoning_effort ?? 'n/a'}, max output ${subject.max_output_tokens})`,
    `- Prompt version: ${subject.prompt_version}${report.evaluated_with.same_prompt_as_recording ? '' : ` (current code: ${report.evaluated_with.prompt_version})`}`,
    `- Schema version: ${subject.schema_version}${report.evaluated_with.same_schema_as_recording ? '' : ` (current code: ${report.evaluated_with.schema_version})`}`,
    `- Dataset: ${report.dataset.fingerprint}, ${report.dataset.cases} cases, ${report.dataset.cases_with_verified_labels} with verified labels${report.dataset.matches_recording ? '' : ' — DIFFERS from the dataset the recording was made with'}`,
    `- Runs scored: ${metrics.runs} (${metrics.withheld_runs} withheld)`,
    '',
    ...caseLines,
    '| Group | Metric | Value |',
    '|---|---|---|',
    `| Model | Valid structured output rate | ${show(metrics.structured_output.valid_rate)} |`,
    `| Model | Abstention precision / recall | ${show(metrics.abstention.precision)} / ${show(metrics.abstention.recall)} |`,
    `| Model | False abstention rate | ${show(metrics.abstention.false_abstention_rate)} |`,
    `| Model | Cases with the same outcome on every run | ${show(metrics.stability.same_outcome_case_rate)} |`,
    `| Model | Dimension rating agreement across runs | ${show(metrics.stability.dimension_rating_agreement_rate)} |`,
    `| Model | Stable ratings at High / Medium / Low confidence | ${show(metrics.confidence.stability_by_confidence.High.stable_rate)} / ${show(metrics.confidence.stability_by_confidence.Medium.stable_rate)} / ${show(metrics.confidence.stability_by_confidence.Low.stable_rate)} |`,
    `| Model | Acceptable ratings at High / Medium / Low confidence | ${show(metrics.confidence.accuracy_by_confidence.High.correct_rate)} / ${show(metrics.confidence.accuracy_by_confidence.Medium.correct_rate)} / ${show(metrics.confidence.accuracy_by_confidence.Low.correct_rate)} |`,
    `| Model | Runs with screening hits (prohibited / forbidden claim) | ${metrics.screening.runs_with_prohibited_hits} / ${metrics.screening.runs_with_forbidden_claims} |`,
    `| Model | Attribute accuracy | not available |`,
    `| End to end | Verdict band agreement | ${show(metrics.verdict_band.agreement_rate)} (${metrics.verdict_band.graded_runs} graded runs) |`,
    `| End to end | Adversarial runs outside acceptable bands | ${metrics.adversarial.runs_outside_acceptable_bands} of ${metrics.adversarial.graded_runs} |`,
    `| End to end | Adversarial cases whose outcome differs from the clean twin | ${show(metrics.adversarial.twin_outcome_change_rate)} (${metrics.adversarial.twin_pairs} pairs) |`,
    `| Application | Verdict recomputation matches | ${metrics.application.verdict_recomputation_matches} |`,
    '',
  ]
  return lines.join('\n')
}
