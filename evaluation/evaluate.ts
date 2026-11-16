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
import { computeMetrics, modalOutcome, outcomeSignature, type EvaluationMetrics, type RunDetail } from './metrics'
import { datasetFingerprint, stableStringify, type Recording } from './recording'

export const REPORT_FORMAT = 'verdict-evaluation-report/1'

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
  metrics: EvaluationMetrics
  cases: CaseReport[]
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

export function evaluateRecording(recording: Recording, cases: BenchmarkCase[], current: CurrentVersions, mode: EvaluationMode): EvaluationReport {
  const details = detailsFromRecording(recording, cases)
  const fingerprint = datasetFingerprint(cases)

  const caseReports: CaseReport[] = [...cases]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((benchmarkCase) => {
      const runs = details.filter((detail) => detail.case_id === benchmarkCase.id)
      const modalValue = modalOutcome(runs)
      return {
        case_id: benchmarkCase.id,
        category: benchmarkCase.category,
        acceptable_bands: benchmarkCase.expected.acceptable_bands,
        should_abstain: benchmarkCase.expected.should_abstain,
        outcomes: runs.map((run) => (run.outcome === 'withheld' ? 'withheld' : outcomeSignature(run))),
        modal_outcome: modalValue ?? null,
        meets_expectation: meetsExpectation(benchmarkCase, modalValue),
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
      cases: cases.length,
      cases_with_verified_labels: cases.filter((benchmarkCase) => benchmarkCase.labels?.verified).length,
      matches_recording: fingerprint === recording.dataset_fingerprint,
    },
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

/** A short Markdown summary of a report. Contains aggregates only, never model text. */
export function renderMarkdown(report: EvaluationReport): string {
  const { metrics, subject } = report
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
