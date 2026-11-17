/**
 * Evaluation runner. Invoke with `npm run eval` (see evaluation/README.md).
 *
 *   npm run eval                                  mock mode, the harness self-test fixtures
 *   npm run eval:scenarios                        mock mode, the scenario dataset, compared with its baseline
 *   npm run eval:baseline                         the same, and replace the baseline if the rules allow it
 *   EVAL_MODE=replay EVAL_CASES=... EVAL_RECORDING=... npm run eval
 *
 * Part of a dataset: EVAL_CASE_IDS, EVAL_CATEGORIES, EVAL_SCENARIOS (comma-separated).
 * A filtered run is marked partial and can never replace a baseline.
 *
 * This command cannot call a model provider: it has no live mode, and network
 * access is disabled for the whole run. Reports are written to
 * evaluation/reports/ and contain aggregates only, never model text.
 */

import { describe, expect, it, jest } from '@jest/globals'

jest.mock('server-only', () => ({}), { virtual: true })

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { getAnalysisPromptVersion } from '@/lib/services/openai/openAIAnalysisService'
import { ANALYSIS_OUTPUT_SCHEMA_VERSION } from '@/lib/services/openai/openAIAnalysisSchema'
import { REPORT_FORMAT, compareReports, renderMarkdown, serializeReport } from './evaluate'
import { DATASETS, datasetPaths, evaluateFiles, loadCases, loadReport, type DatasetId } from './load'
import { resolveDatasetOptions, resolveEvaluationPlan } from './modes'
import { datasetFingerprint } from './recording'
import { ACCEPT_WORSE_BASELINE, assessBaselineUpdate, classifyRegressions, describeRegressions } from './regression'
import { selectionFromEnv } from './selection'

const ROOT = process.cwd()

function out(line = ''): void {
  process.stdout.write(`${line}\n`)
}

describe('Verdict evaluation', () => {
  it('runs', async () => {
    // Guarantee that no mode of this command can reach a network service.
    globalThis.fetch = (() => { throw new Error('Network access is disabled during an evaluation.') }) as typeof fetch

    const plan = resolveEvaluationPlan(process.env)
    if (plan.mode === 'refused') {
      out(`Evaluation refused: ${plan.reason}`)
      throw new Error(plan.reason)
    }
    const datasetOptions = resolveDatasetOptions(process.env, Object.keys(DATASETS), ACCEPT_WORSE_BASELINE)
    if (!datasetOptions.ok) {
      out(`Evaluation refused: ${datasetOptions.reason}`)
      throw new Error(datasetOptions.reason)
    }
    if (plan.mode === 'replay' && datasetOptions.updateBaseline) {
      throw new Error('A committed baseline is replaced only from a committed dataset (mock mode), never from a replayed file.')
    }

    const current = { promptVersion: await getAnalysisPromptVersion(), schemaVersion: ANALYSIS_OUTPUT_SCHEMA_VERSION }
    const dataset = datasetPaths(ROOT, datasetOptions.dataset as DatasetId)
    const casesPath = plan.mode === 'mock' ? dataset.casesPath : path.resolve(ROOT, plan.casesPath)
    const recordingPath = plan.mode === 'mock' ? dataset.recordingPath : path.resolve(ROOT, plan.recordingPath)
    for (const file of [casesPath, recordingPath]) {
      if (!existsSync(file)) throw new Error(`File not found: ${path.relative(ROOT, file)}. Nothing is fetched when a file is missing.`)
    }

    const selection = selectionFromEnv(process.env)
    const report = evaluateFiles({ casesPath, recordingPath, current, mode: plan.mode, options: { selection } })
    out(`Mode: ${plan.mode}   dataset: ${plan.mode === 'mock' ? datasetOptions.dataset : 'file'} (${datasetFingerprint(loadCases(casesPath))})   current prompt: ${current.promptVersion}   schema: ${current.schemaVersion}`)
    out(renderMarkdown(report))

    if (!report.dataset.matches_recording) out('WARNING: the manifest differs from the one this recording was made with.')
    if (report.selection.partial) out(`PARTIAL RUN: ${report.selection.cases_evaluated} of ${report.dataset.cases} cases. A partial report cannot replace a baseline.`)

    const reportsDir = path.join(ROOT, 'evaluation', 'reports')
    mkdirSync(reportsDir, { recursive: true })
    const name = `${plan.mode}-${report.subject.model}-${report.subject.prompt_version}-${report.dataset.fingerprint}${report.selection.partial ? '-partial' : ''}`
    writeFileSync(path.join(reportsDir, `${name}.json`), serializeReport(report))
    writeFileSync(path.join(reportsDir, `${name}.md`), renderMarkdown(report))
    out(`Report: ${path.join('evaluation', 'reports', name)}.json and .md`)

    // A replayed file may be compared with any earlier report.
    if (plan.mode === 'replay' && plan.baselinePath) {
      const baseline = loadReport(path.resolve(ROOT, plan.baselinePath))
      const comparison = compareReports(baseline, report)
      out(comparison.comparable ? 'Comparison with baseline:' : 'Comparison with baseline (DIFFERENT DATASETS: numbers are not comparable):')
      out(JSON.stringify(comparison, null, 2))
      for (const line of describeRegressions(classifyRegressions(baseline, report))) out(line)
    }

    // A committed dataset is compared with its committed baseline.
    if (plan.mode === 'mock' && dataset.baselinePath !== null) {
      const baseline = existsSync(dataset.baselinePath) ? loadReport(dataset.baselinePath) : null
      const baselineName = path.relative(ROOT, dataset.baselinePath)

      if (datasetOptions.updateBaseline) {
        const decision = assessBaselineUpdate(baseline, report, { acceptRegressions: datasetOptions.acceptRegressions })
        if (!decision.allowed) {
          out(`Baseline NOT replaced (${baselineName}):`)
          for (const reason of decision.reasons) out(`  - ${reason}`)
          throw new Error('The baseline was not replaced. See the reasons above.')
        }
        mkdirSync(path.dirname(dataset.baselinePath), { recursive: true })
        writeFileSync(dataset.baselinePath, serializeReport(report))
        out(`Baseline replaced: ${baselineName}`)
        for (const note of decision.notes) out(`  - ${note}`)
      } else if (baseline === null) {
        out(`No baseline yet (${baselineName}). Create one with "npm run eval:baseline".`)
      } else {
        const regressions = classifyRegressions(baseline, report)
        const lines = describeRegressions(regressions)
        out(lines.length === 0 ? `No change against the baseline (${baselineName}).` : `Compared with the baseline (${baselineName}):`)
        for (const line of lines) out(`  - ${line}`)
        if (regressions.has_regression) throw new Error('Regression against the committed baseline. The baseline was left unchanged.')
      }
    }

    expect(report.report_format).toBe(REPORT_FORMAT)
  })
})
