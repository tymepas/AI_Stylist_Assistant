/**
 * Evaluation runner. Invoke with `npm run eval` (see evaluation/README.md).
 *
 *   npm run eval                                  mock mode: committed fixtures
 *   EVAL_MODE=replay EVAL_CASES=... EVAL_RECORDING=... npm run eval
 *
 * This command cannot call a model provider: it has no live mode, and network
 * access is disabled for the whole run. Reports are written to
 * evaluation/reports/ and contain aggregates only, never model text.
 */

import { describe, expect, it, jest } from '@jest/globals'

jest.mock('server-only', () => ({}), { virtual: true })

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { getAnalysisPromptVersion } from '@/lib/services/openai/openAIAnalysisService'
import { ANALYSIS_OUTPUT_SCHEMA_VERSION } from '@/lib/services/openai/openAIAnalysisSchema'
import { compareReports, renderMarkdown, serializeReport, type EvaluationReport } from './evaluate'
import { evaluateFiles, loadCases, mockFixturePaths } from './load'
import { resolveEvaluationPlan } from './modes'
import { datasetFingerprint } from './recording'

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

    const current = { promptVersion: await getAnalysisPromptVersion(), schemaVersion: ANALYSIS_OUTPUT_SCHEMA_VERSION }
    const fixtures = mockFixturePaths(ROOT)
    const casesPath = plan.mode === 'mock' ? fixtures.casesPath : path.resolve(ROOT, plan.casesPath)
    const recordingPath = plan.mode === 'mock' ? fixtures.recordingPath : path.resolve(ROOT, plan.recordingPath)
    for (const file of [casesPath, recordingPath]) {
      if (!existsSync(file)) throw new Error(`File not found: ${path.relative(ROOT, file)}. Nothing is fetched when a file is missing.`)
    }

    const report = evaluateFiles({ casesPath, recordingPath, current, mode: plan.mode })
    out(`Mode: ${plan.mode}   dataset: ${datasetFingerprint(loadCases(casesPath))}   current prompt: ${current.promptVersion}   schema: ${current.schemaVersion}`)
    out(renderMarkdown(report))

    if (!report.dataset.matches_recording) out('WARNING: the manifest differs from the one this recording was made with.')

    const reportsDir = path.join(ROOT, 'evaluation', 'reports')
    mkdirSync(reportsDir, { recursive: true })
    const name = `${plan.mode}-${report.subject.model}-${report.subject.prompt_version}-${report.dataset.fingerprint}`
    writeFileSync(path.join(reportsDir, `${name}.json`), serializeReport(report))
    writeFileSync(path.join(reportsDir, `${name}.md`), renderMarkdown(report))
    out(`Report: ${path.join('evaluation', 'reports', name)}.json and .md`)

    if (plan.mode === 'replay' && plan.baselinePath) {
      const baseline = JSON.parse(readFileSync(path.resolve(ROOT, plan.baselinePath), 'utf8')) as EvaluationReport
      const comparison = compareReports(baseline, report)
      out(comparison.comparable ? 'Comparison with baseline:' : 'Comparison with baseline (DIFFERENT DATASETS: numbers are not comparable):')
      out(JSON.stringify(comparison, null, 2))
    }

    expect(report.report_format).toBe('verdict-evaluation-report/1')
  })
})
