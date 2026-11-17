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
import { MIN_SAMPLE, buildMetricIndex, computeQuality, type MetricIndex, type QualityReport } from './quality'
import { datasetFingerprint, stableStringify, type Recording } from './recording'
import { parseReferenceSet, resolveReferences, summarizeReferences, type ReferenceSet, type ReferenceSummary } from './reference'
import { describeSelection, selectCases, type CaseSelection, type SelectionReport } from './selection'

/**
 * /2 adds per-case checks, the summary, the selection and performance. /1 reports have none of them.
 * /3 adds the reference summary, the quality section (agreement, grounding, calibration, multi-image),
 * the metric index and the next steps. Every /2 field is unchanged, so a /2 report still compares case by case.
 */
export const REPORT_FORMAT = 'verdict-evaluation-report/3'

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
  /** Which references were used and how far each can be trusted. */
  references: ReferenceSummary
  /** Agreement with references, grounding, calibration and multi-image results, per reference tier. */
  quality: QualityReport
  /** Every comparable figure under one stable name, for metric-level regression. */
  metric_index: MetricIndex
  /** What to do next, derived from the figures above by fixed rules. Never model text. */
  next_steps: string[]
  cases: CaseReport[]
}

export interface EvaluationOptions {
  /** Evaluate only some cases. The report is then marked partial. */
  selection?: CaseSelection
  /** References for the cases. They are validated against the manifest here again, so an unchecked set is never scored. */
  references?: ReferenceSet
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
    details.push({
      ...screened,
      outcome: 'complete',
      band: report.overall_recommendation,
      score: report.verdict_score,
      dimensions: result.dimensions,
      ...(result.outfit_components !== undefined ? { outfit_components: result.outfit_components } : {}),
    })
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

  const metrics = computeMetrics(details, cases)
  // Validated here whatever the caller did: a set that was only typed, not parsed, must not reach the scoring.
  const referenceSet = options.references ? parseReferenceSet(options.references, allCases) : undefined
  const references = summarizeReferences(referenceSet, cases)
  const quality = computeQuality(details, cases, resolveReferences(referenceSet, cases), recording.provenance === 'model' ? 'model' : 'synthetic_fixture')
  const summary = summarizeCases(caseReports)

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
    summary,
    performance: computePerformance(recording, recording.entries.filter((entry) => selectedIds.has(entry.case_id))),
    metrics,
    references,
    quality,
    metric_index: buildMetricIndex(metrics, quality),
    next_steps: nextSteps({ provenance: recording.provenance, summary, references, quality }),
    cases: caseReports,
  }
}

/**
 * What to do next. Each line is produced by a fixed rule from the figures of
 * the report, in a fixed order, so the list is as reproducible as the rest.
 */
export function nextSteps(input: Pick<EvaluationReport, 'provenance' | 'summary' | 'references' | 'quality'>): string[] {
  const { provenance, summary, references, quality } = input
  const steps: string[] = []

  if (summary.failed > 0) steps.push(`Fix or explain the ${summary.failed} failing case(s) listed under "Cases" before reading any other figure.`)
  if (provenance !== 'model') steps.push('These are hand-written fixture outputs. To learn anything about a model, replay a recording from an approved live benchmark run.')

  const reviewed = references.cases_by_tier.image_reviewed
  if (reviewed === 0) {
    steps.push('Add human-reviewed cases with real images (evaluation/HUMAN_REVIEW.md). Until then accuracy on real images is unavailable.')
  } else if (reviewed < MIN_SAMPLE) {
    steps.push(`Only ${reviewed} image-reviewed case(s): add at least ${MIN_SAMPLE - reviewed} more before drawing conclusions about any dimension.`)
  }
  if (references.cases_by_tier.unreviewed > 0) steps.push(`Finish the ${references.cases_by_tier.unreviewed} unreviewed reference(s); they are not scored.`)

  if (quality.image_grounded_accuracy.status === 'available') {
    const weakest = Object.entries(quality.agreement.image_reviewed.dimensions)
      .filter(([, dimension]) => dimension.exact_rate.status === 'measured')
      .sort(([a, x], [b, y]) => (x.exact_rate.value as number) - (y.exact_rate.value as number) || a.localeCompare(b))[0]
    if (weakest) steps.push(`Lowest exact agreement with reviewers: ${weakest[0]} (${weakest[1].exact_rate.value}). Read the cases that disagree before changing anything.`)
    const calibration = quality.calibration.image_reviewed
    if (calibration.ordering === 'inverted') steps.push('Stated confidence is inverted against reviewer agreement: a lower confidence level agrees more often than a higher one.')
    if (calibration.high_confidence_severe_error_rate.status === 'measured' && (calibration.high_confidence_severe_error_rate.value as number) > 0) {
      steps.push(`A share of ${calibration.high_confidence_severe_error_rate.value} of High-confidence ratings is far from the reviewer's rating. Read those cases.`)
    }
    const missing = quality.grounding.image_reviewed.cases_missing_key_facts
    if (missing.length > 0) steps.push(`${missing.length} case(s) never mention a key fact the reviewer listed (proxy): ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ' and others' : ''}.`)
  }

  const outfit = quality.multi_image.outfit_items.completeness_rate
  if (outfit.value !== null && outfit.value < 1) steps.push(`Per-item outfit notes are missing or invalid in part of the outfit runs (completeness ${outfit.value}).`)
  if (quality.multi_image.outfit_items.unexpected_blocks_in_other_modes > 0) steps.push('Some single-garment or multi-view runs returned per-item outfit notes, where none are expected.')
  if (quality.multi_image.comparison_groups.groups === 0 && reviewed > 0) steps.push('No comparison group links a single photo to several photos of the same garment, so the two cannot be compared yet.')

  return steps
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

export { renderMarkdown } from './markdown'
