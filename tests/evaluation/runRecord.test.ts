/**
 * Run records: the id, the timestamps and the outcome of a run, kept apart
 * from the report so that the report stays reproducible byte for byte.
 *
 * No network is used.
 */

import { ANALYSIS_OUTPUT_SCHEMA_VERSION } from '@/lib/services/openai/openAIAnalysisSchema'
import { describe, expect, it, jest } from '@jest/globals'
import { readFileSync } from 'node:fs'
import path from 'node:path'

jest.mock('server-only', () => ({}), { virtual: true })

import { evaluateRecording, serializeReport, type EvaluationReport } from '@/evaluation/evaluate'
import { loadCases, loadRecording, loadReferenceSet, mockFixturePaths } from '@/evaluation/load'
import { classifyMetricChanges, classifyRegressions } from '@/evaluation/regression'
import { RUN_OUTCOMES, RUN_RECORD_FORMAT, buildRunRecord, serializeRunRecord, sha256 } from '@/evaluation/runRecord'
import { degrade, fixtureCases, fixtureRecording, fixtureReferences } from '../helpers/qualityFixture'

// The code under test: the same versions the self-test snapshot was produced with (tests/evaluation/mockEvaluation.test.ts).
const CURRENT = { promptVersion: 'aaaaaaaaaaaa', schemaVersion: ANALYSIS_OUTPUT_SCHEMA_VERSION }
const paths = mockFixturePaths(process.cwd())

function selftestReport(): EvaluationReport {
  const cases = loadCases(paths.casesPath)
  return evaluateRecording(loadRecording(paths.recordingPath), cases, CURRENT, 'mock', { references: loadReferenceSet(paths.referencesPath, cases) })
}

function record(report: EvaluationReport, overrides: Partial<Parameters<typeof buildRunRecord>[0]> = {}) {
  return buildRunRecord({
    runId: '11111111-2222-4333-8444-555555555555',
    startedAt: new Date('2026-11-17T10:00:00.000Z'),
    finishedAt: new Date('2026-11-17T10:00:02.500Z'),
    datasetId: 'selftest',
    codeVersion: '8afeb7b65c5679d1efb33bb9f12ac517eb4ceec6',
    report,
    reportText: serializeReport(report),
    reportFile: 'evaluation/reports/example.json',
    outcome: 'no_baseline',
    ...overrides,
  })
}

describe('run record', () => {
  it('records the run id, the timestamps and everything that identifies what was evaluated', () => {
    const report = selftestReport()
    expect(record(report)).toMatchObject({
      format: RUN_RECORD_FORMAT,
      run_id: '11111111-2222-4333-8444-555555555555',
      started_at: '2026-11-17T10:00:00.000Z',
      finished_at: '2026-11-17T10:00:02.500Z',
      duration_ms: 2500,
      execution_mode: 'mock',
      outputs: 'synthetic_fixture',
      code_version: '8afeb7b65c5679d1efb33bb9f12ac517eb4ceec6',
      dataset: { id: 'selftest', version: '1.0.0', fingerprint: report.dataset.fingerprint, reference_fingerprint: report.references.fingerprint, matches_recording: true },
      model: 'gpt-6.1-terra',
      prompt_version: '000000000000',
      schema_version: ANALYSIS_SCHEMA,
      evaluated_with: { prompt_version: 'aaaaaaaaaaaa', schema_version: ANALYSIS_OUTPUT_SCHEMA_VERSION },
      baseline: null,
      comparison: null,
      outcome: 'no_baseline',
    })
  })

  it('counts cases, and as successful only those whose every scored run returned a valid output', () => {
    // 9 cases. fx-invalid-output had a schema failure and a timeout; fx-withheld has no scored run. The other 7 succeeded.
    expect(record(selftestReport()).cases).toEqual({ in_dataset: 9, evaluated: 9, successful: 7, passed: 2, failed: 6, not_applicable: 1, partial: false })
  })

  it('reports latency, tokens and cost as null when nothing was measured, never zero', () => {
    const run = record(selftestReport())
    expect(run.latency).toEqual({ p50_ms: null, p95_ms: null, max_ms: null })
    expect(run.tokens).toEqual({ input: null, output: null })
    expect(run.cost_micro_usd).toBeNull()
  })

  it('carries measured latency, tokens and cost from a recording of model outputs', () => {
    const cases = fixtureCases('synthetic')
    const recording = fixtureRecording(cases, 'model')
    recording.entries.forEach((entry, index) => {
      entry.latency_ms = 1000 + index * 10
      entry.usage = { input_tokens: 2000, output_tokens: 500, total_tokens: 2500, cached_tokens: 0, reasoning_tokens: 0 }
    })
    const run = record(evaluateRecording(recording, cases, CURRENT, 'replay'), { datasetId: 'file' })
    expect(run.execution_mode).toBe('replay')
    expect(run.outputs).toBe('model')
    expect(run.latency.p50_ms).toBe(1160) // the 17th of 34 timings
    expect(run.latency.max_ms).toBe(1330)
    expect(run.tokens).toEqual({ input: 68_000, output: 17_000 })
    expect(run.cost_micro_usd).toBeGreaterThan(0)
    expect(run.dataset).toMatchObject({ id: 'file', version: null, reference_fingerprint: null })
  })

  it('ties the record to the exact bytes of its report', () => {
    const report = selftestReport()
    const text = serializeReport(report)
    expect(record(report).report).toEqual({ file: 'evaluation/reports/example.json', format: 'verdict-evaluation-report/6', sha256: sha256(text) })
    expect(sha256(text)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('identifies the baseline it was compared with and summarises the comparison', () => {
    const cases = fixtureCases('image_review')
    const references = fixtureReferences('image_review')
    const base = evaluateRecording(fixtureRecording(cases, 'model'), cases, CURRENT, 'replay', { references })
    const candidate = evaluateRecording(fixtureRecording(cases, 'model', degrade), cases, CURRENT, 'replay', { references })
    const baselineText = serializeReport(base)
    const run = record(candidate, {
      baseline: { file: 'evaluation/baselines/example.json', text: baselineText, report: base },
      regressions: classifyRegressions(base, candidate),
      metricChanges: classifyMetricChanges(base, candidate),
      outcome: 'regression',
    })
    expect(run.outcome).toBe('regression')
    expect(run.baseline).toEqual({ file: 'evaluation/baselines/example.json', sha256: sha256(baselineText), dataset_fingerprint: base.dataset.fingerprint, report_format: 'verdict-evaluation-report/6' })
    expect(run.comparison?.newly_failing_cases).toEqual([])
    expect(run.comparison?.metric_regressions).toContain('agreement.image_reviewed.occasion.exact_rate')
    expect(run.comparison?.metric_improvements).toEqual([])
    expect(run.comparison?.metrics_inconclusive).toBeGreaterThan(0)
  })

  it('names every outcome a run can end with', () => {
    expect([...RUN_OUTCOMES]).toEqual(['no_regression', 'regression', 'baseline_replaced', 'baseline_refused', 'no_baseline'])
  })
})

// The schema the self-test recording was written for. The code under test is newer (ANALYSIS_OUTPUT_SCHEMA_VERSION).
const ANALYSIS_SCHEMA = 'analysis-output/2'

describe('the report stays deterministic', () => {
  it('carries no run id, timestamp or commit, so the same inputs give the same bytes', () => {
    const report = selftestReport()
    const text = serializeReport(report)
    for (const key of ['run_id', 'started_at', 'finished_at', 'duration_ms', 'code_version']) expect(text).not.toContain(`"${key}"`)
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)
  })

  it('gives two runs of the same inputs different records and identical reports', () => {
    const first = selftestReport()
    const second = selftestReport()
    expect(serializeReport(first)).toBe(serializeReport(second))
    const a = record(first, { runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', startedAt: new Date('2026-11-17T10:00:00.000Z') })
    const b = record(second, { runId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', startedAt: new Date('2026-11-17T11:00:00.000Z'), finishedAt: new Date('2026-11-17T11:00:01.000Z') })
    expect(serializeRunRecord(a)).not.toBe(serializeRunRecord(b))
    expect(a.report.sha256).toBe(b.report.sha256)
  })

  it('still matches the committed self-test snapshot, which a run id or timestamp would break', () => {
    const expected = readFileSync(paths.expectedReportPath, 'utf8').replace(/\r\n/g, '\n')
    expect(serializeReport(selftestReport())).toBe(expected)
  })

  it('writes run records only where git ignores them', () => {
    const ignore = readFileSync(path.join(process.cwd(), '.gitignore'), 'utf8')
    expect(ignore).toMatch(/^evaluation\/reports\/$/m)
    const runner = readFileSync(path.join(process.cwd(), 'evaluation', 'run.eval.ts'), 'utf8')
    expect(runner).toContain("path.join(reportsDir, 'runs')")
  })
})
