/**
 * Run records: who ran what, when, and how it ended.
 *
 * An evaluation REPORT is deterministic. The same inputs always give the same
 * bytes, which is what makes a committed baseline comparable with a diff. A run
 * id and a timestamp would break that, so they are never written into a report.
 *
 * They go here instead: one small JSON file per run, next to the report, tied to
 * it by the SHA-256 of the report's bytes. The record answers "which run produced
 * this report, on which code, against which baseline, and what was the outcome".
 *
 * This module performs no file or network access; the runner supplies the id,
 * the clock and the hashes.
 */

import { createHash } from 'node:crypto'
import type { EvaluationReport } from './evaluate'
import type { MetricRegressionReport, RegressionReport } from './regression'

export const RUN_RECORD_FORMAT = 'verdict-evaluation-run/1'

export const RUN_OUTCOMES = [
  /** Compared with a baseline; nothing got worse. */
  'no_regression',
  /** Compared with a baseline; a case or a metric got worse. */
  'regression',
  /** The baseline was replaced by this run's report. */
  'baseline_replaced',
  /** A baseline replacement was asked for and refused. */
  'baseline_refused',
  /** The evaluation ran and there was no baseline to compare with. */
  'no_baseline',
] as const
export type RunOutcome = (typeof RUN_OUTCOMES)[number]

export interface RunRecord {
  format: typeof RUN_RECORD_FORMAT
  run_id: string
  started_at: string
  finished_at: string
  duration_ms: number
  /** `mock` or `replay`. The evaluation command has no live mode. */
  execution_mode: EvaluationReport['mode']
  /** Whether the outputs were written by hand or recorded from a model. */
  outputs: EvaluationReport['provenance']
  /** The commit the evaluation code ran on; null when it could not be read. */
  code_version: string | null
  dataset: {
    /** The committed dataset id, or `file` for a replayed manifest. */
    id: string
    /** From the reference set; null when the run used none. */
    version: string | null
    fingerprint: string
    reference_fingerprint: string | null
    matches_recording: boolean
  }
  model: string
  reasoning_effort: string | null
  prompt_version: string
  schema_version: string
  /** Versions of the code that produced the report, which can differ from the recorded ones on replay. */
  evaluated_with: { prompt_version: string; schema_version: string }
  cases: {
    in_dataset: number
    evaluated: number
    /** Cases whose every scored run returned a valid output. */
    successful: number
    passed: number
    failed: number
    not_applicable: number
    partial: boolean
  }
  /** Measured figures only. Each is null when the recording holds no measurement. */
  latency: { p50_ms: number | null; p95_ms: number | null; max_ms: number | null }
  tokens: { input: number | null; output: number | null }
  cost_micro_usd: number | null
  /** The report this run wrote. The hash ties the record to those exact bytes. */
  report: { file: string; format: string; sha256: string }
  baseline: { file: string; sha256: string; dataset_fingerprint: string | null; report_format: string | null } | null
  outcome: RunOutcome
  /** Empty unless the run was compared with a baseline. */
  comparison: {
    newly_failing_cases: string[]
    metric_regressions: string[]
    metric_improvements: string[]
    metrics_inconclusive: number
    metrics_unavailable: number
  } | null
  notes: string[]
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export interface RunRecordInput {
  runId: string
  startedAt: Date
  finishedAt: Date
  datasetId: string
  codeVersion: string | null
  report: EvaluationReport
  /** The serialised report exactly as written to disk. */
  reportText: string
  reportFile: string
  baseline?: { file: string; text: string; report: EvaluationReport } | null
  regressions?: RegressionReport | null
  metricChanges?: MetricRegressionReport | null
  outcome: RunOutcome
  notes?: string[]
}

/** Cases whose every scored run returned a valid output: no `error` outcome among them. */
function successfulCases(report: EvaluationReport): number {
  return report.cases.filter((entry) => {
    const scored = entry.outcomes.filter((outcome) => outcome !== 'withheld')
    return scored.length > 0 && !scored.includes('error')
  }).length
}

export function buildRunRecord(input: RunRecordInput): RunRecord {
  const { report, baseline, regressions, metricChanges } = input
  return {
    format: RUN_RECORD_FORMAT,
    run_id: input.runId,
    started_at: input.startedAt.toISOString(),
    finished_at: input.finishedAt.toISOString(),
    duration_ms: Math.max(0, input.finishedAt.getTime() - input.startedAt.getTime()),
    execution_mode: report.mode,
    outputs: report.provenance,
    code_version: input.codeVersion,
    dataset: {
      id: input.datasetId,
      version: report.references.dataset_version,
      fingerprint: report.dataset.fingerprint,
      reference_fingerprint: report.references.fingerprint,
      matches_recording: report.dataset.matches_recording,
    },
    model: report.subject.model,
    reasoning_effort: report.subject.reasoning_effort,
    prompt_version: report.subject.prompt_version,
    schema_version: report.subject.schema_version,
    evaluated_with: { prompt_version: report.evaluated_with.prompt_version, schema_version: report.evaluated_with.schema_version },
    cases: {
      in_dataset: report.dataset.cases,
      evaluated: report.selection.cases_evaluated,
      successful: successfulCases(report),
      passed: report.summary.passed,
      failed: report.summary.failed,
      not_applicable: report.summary.not_applicable,
      partial: report.selection.partial,
    },
    latency: { p50_ms: report.performance.latency.p50_ms, p95_ms: report.performance.latency.p95_ms, max_ms: report.performance.latency.max_ms },
    tokens: { input: report.performance.cost.input_tokens, output: report.performance.cost.output_tokens },
    cost_micro_usd: report.performance.cost.total_micro_usd,
    report: { file: input.reportFile, format: report.report_format, sha256: sha256(input.reportText) },
    baseline: baseline
      ? { file: baseline.file, sha256: sha256(baseline.text), dataset_fingerprint: baseline.report.dataset?.fingerprint ?? null, report_format: baseline.report.report_format ?? null }
      : null,
    outcome: input.outcome,
    comparison: regressions && metricChanges
      ? {
          newly_failing_cases: regressions.newly_failing.map((entry) => entry.case_id),
          metric_regressions: metricChanges.regressions,
          metric_improvements: metricChanges.improvements,
          metrics_inconclusive: metricChanges.counts.inconclusive,
          metrics_unavailable: metricChanges.counts.unavailable,
        }
      : null,
    notes: input.notes ?? [],
  }
}

/** A run record as JSON. Unlike a report it is expected to differ between runs. */
export function serializeRunRecord(record: RunRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`
}
