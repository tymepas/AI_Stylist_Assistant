/**
 * Evaluation runner. Invoke with `npm run eval` (see evaluation/README.md).
 *
 *   npm run eval                                  mock mode, the harness self-test fixtures
 *   npm run eval:scenarios                        mock mode, the scenario dataset, compared with its baseline
 *   npm run eval:baseline                         the same, and replace the baseline if the rules allow it
 *   npm run eval:references -- --manifest ... --references ...   validate a human-review reference set
 *   EVAL_MODE=replay EVAL_CASES=... EVAL_RECORDING=... [EVAL_REFERENCES=...] npm run eval
 *
 * Part of a dataset: EVAL_CASE_IDS, EVAL_CATEGORIES, EVAL_SCENARIOS (comma-separated).
 * A filtered run is marked partial and can never replace a baseline.
 *
 * This command cannot call a model provider: it has no live mode, and network
 * access is disabled for the whole run. Reports are written to
 * evaluation/reports/ and contain aggregates only, never model text. Each run
 * also writes a run record (id, timestamps, outcome) to evaluation/reports/runs/,
 * kept apart from the report so that the report stays byte-reproducible.
 */

import { describe, expect, it, jest } from '@jest/globals'

jest.mock('server-only', () => ({}), { virtual: true })

import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { getAnalysisPromptVersion } from '@/lib/services/openai/openAIAnalysisService'
import { ANALYSIS_OUTPUT_SCHEMA_VERSION } from '@/lib/services/openai/openAIAnalysisSchema'
import { REPORT_FORMAT, compareReports, renderMarkdown, serializeReport, type EvaluationReport } from './evaluate'
import { DATASETS, datasetPaths, evaluateFiles, loadCases, loadReferenceSet, loadReport, type DatasetId } from './load'
import { resolveDatasetOptions, resolveEvaluationPlan } from './modes'
import { datasetFingerprint } from './recording'
import { REFERENCE_TIERS, ReferenceSetError, referenceSetFingerprint, summarizeReferences } from './reference'
import { ACCEPT_WORSE_BASELINE, assessBaselineUpdate, classifyMetricChanges, classifyRegressions, describeMetricChanges, describeRegressions, type MetricRegressionReport, type RegressionReport } from './regression'
import { buildRunRecord, serializeRunRecord, type RunOutcome } from './runRecord'
import { selectionFromEnv } from './selection'

const ROOT = process.cwd()

function out(line = ''): void {
  process.stdout.write(`${line}\n`)
}

/** The commit this code runs on, or null. Read-only; a missing git is not an error. */
function codeVersion(): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null
  } catch {
    return null
  }
}

/** Validates a reference set and prints how ready it is. Evaluates nothing. */
function checkReferences(plan: { casesPath: string; referencesPath: string; imagesDir?: string }): void {
  const casesPath = path.resolve(ROOT, plan.casesPath)
  const referencesPath = path.resolve(ROOT, plan.referencesPath)
  for (const file of [casesPath, referencesPath]) {
    if (!existsSync(file)) throw new Error(`File not found: ${path.relative(ROOT, file)}.`)
  }
  const cases = loadCases(casesPath)
  let set
  try {
    // The same loader, with the same checks, that an evaluation uses: what is refused here is never scored there.
    set = loadReferenceSet(referencesPath, cases, { today: today(), imagesDir: plan.imagesDir ? path.resolve(ROOT, plan.imagesDir) : undefined })
  } catch (error) {
    if (error instanceof ReferenceSetError) {
      out('Reference set NOT valid:')
      for (const problem of error.problems) out(`  - ${problem}`)
    }
    throw error
  }

  const summary = summarizeReferences(set, cases)
  out(`Reference set: ${set.dataset} version ${set.dataset_version} (${referenceSetFingerprint(set)}) for manifest ${datasetFingerprint(cases)}`)
  for (const tier of REFERENCE_TIERS) out(`  ${tier}: ${summary.cases_by_tier[tier]}`)
  out(`  cases without a reference: ${summary.cases_without_reference}`)
  if (summary.image_reviewers.length > 0) out(`  image reviews by ${summary.image_reviewers.join(', ')} (${summary.image_reviews_from} to ${summary.image_reviews_to})`)
  out(plan.imagesDir ? '  images: every recorded SHA-256 was compared with the file on disk' : '  images: NOT checked (pass --images <directory> to compare each file with its recorded SHA-256)')
  if (summary.cases_by_tier.image_reviewed === 0) out('  Accuracy on real images will read: Unavailable: insufficient human-reviewed ground truth')
  out('Reference set is valid.')
}

/** Today as YYYY-MM-DD. Used only to refuse a review dated in the future; it never reaches a report. */
function today(): string {
  return new Date().toISOString().slice(0, 10)
}

describe('Verdict evaluation', () => {
  it('runs', async () => {
    // Guarantee that no mode of this command can reach a network service.
    globalThis.fetch = (() => { throw new Error('Network access is disabled during an evaluation.') }) as typeof fetch

    const startedAt = new Date()
    const plan = resolveEvaluationPlan(process.env)
    if (plan.mode === 'refused') {
      out(`Evaluation refused: ${plan.reason}`)
      throw new Error(plan.reason)
    }
    if (plan.mode === 'check_references') {
      checkReferences(plan)
      return
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
    const referencesPath = plan.mode === 'mock' ? dataset.referencesPath : plan.referencesPath ? path.resolve(ROOT, plan.referencesPath) : null
    for (const file of [casesPath, recordingPath, ...(referencesPath ? [referencesPath] : [])]) {
      if (!existsSync(file)) throw new Error(`File not found: ${path.relative(ROOT, file)}. Nothing is fetched when a file is missing.`)
    }

    const selection = selectionFromEnv(process.env)
    // A replay may be given the image directory; every reviewed image is then compared with its recorded hash.
    const imagesDir = plan.mode === 'replay' && plan.imagesDir ? path.resolve(ROOT, plan.imagesDir) : undefined
    let report: EvaluationReport
    try {
      report = evaluateFiles({ casesPath, recordingPath, referencesPath, referenceChecks: { today: today(), imagesDir }, current, mode: plan.mode, options: { selection } })
    } catch (error) {
      if (error instanceof ReferenceSetError) {
        out('Evaluation refused: the reference set is not valid.')
        for (const problem of error.problems) out(`  - ${problem}`)
      }
      throw error
    }
    const datasetId = plan.mode === 'mock' ? datasetOptions.dataset : 'file'
    out(`Mode: ${plan.mode}   dataset: ${datasetId} (${datasetFingerprint(loadCases(casesPath))})   current prompt: ${current.promptVersion}   schema: ${current.schemaVersion}`)
    out(renderMarkdown(report))

    if (!report.dataset.matches_recording) out('WARNING: the manifest differs from the one this recording was made with.')
    if (report.selection.partial) out(`PARTIAL RUN: ${report.selection.cases_evaluated} of ${report.dataset.cases} cases. A partial report cannot replace a baseline.`)

    const reportsDir = path.join(ROOT, 'evaluation', 'reports')
    mkdirSync(reportsDir, { recursive: true })
    const name = `${plan.mode}-${report.subject.model}-${report.subject.prompt_version}-${report.dataset.fingerprint}${report.selection.partial ? '-partial' : ''}`
    const reportText = serializeReport(report)
    const reportFile = path.join('evaluation', 'reports', `${name}.json`)
    writeFileSync(path.join(ROOT, reportFile), reportText)
    out(`Report: ${path.join('evaluation', 'reports', name)}.json and .md`)

    // What happened, decided before anything is thrown, so that every run that produced a report leaves a
    // record. A run that was refused earlier (a bad mode, an invalid reference set) writes neither.
    // (`as` keeps the declared type: these are assigned inside compareWith, which narrowing cannot see.)
    let outcome = 'no_baseline' as RunOutcome
    let failure: string | null = null
    let regressions = null as RegressionReport | null
    let metricChanges = null as MetricRegressionReport | null
    let baselineUsed = null as { file: string; text: string; report: EvaluationReport } | null
    const notes: string[] = []
    const comparisonLines: string[] = []

    // Human-reviewed references are tied to image files by their hashes. Say so when that tie was not checked.
    if (report.references.cases_by_tier.image_reviewed > 0 && !imagesDir) {
      const warning = 'The reviewed images were NOT compared with their recorded SHA-256 in this run. Pass --images <directory> to check that each image is still the file that was reviewed.'
      out(`WARNING: ${warning}`)
      notes.push(warning)
    }

    const compareWith = (file: string): EvaluationReport => {
      const text = readFileSync(file, 'utf8')
      const baseline = loadReport(file)
      baselineUsed = { file: path.relative(ROOT, file), text, report: baseline }
      regressions = classifyRegressions(baseline, report)
      metricChanges = classifyMetricChanges(baseline, report)
      comparisonLines.push(...describeRegressions(regressions), ...describeMetricChanges(metricChanges))
      outcome = regressions.has_regression || metricChanges.has_regression ? 'regression' : 'no_regression'
      return baseline
    }

    // A replayed file may be compared with any earlier report. The comparison is printed; it never fails the run.
    if (plan.mode === 'replay' && plan.baselinePath) {
      const baseline = compareWith(path.resolve(ROOT, plan.baselinePath))
      const comparison = compareReports(baseline, report)
      out(comparison.comparable ? 'Comparison with baseline:' : 'Comparison with baseline (DIFFERENT DATASETS: numbers are not comparable):')
      out(JSON.stringify(comparison, null, 2))
      for (const line of comparisonLines) out(line)
    }

    // A committed dataset is compared with its committed baseline.
    if (plan.mode === 'mock' && dataset.baselinePath !== null) {
      const baselineName = path.relative(ROOT, dataset.baselinePath)
      const exists = existsSync(dataset.baselinePath)
      const baseline = exists ? compareWith(dataset.baselinePath) : null

      if (datasetOptions.updateBaseline) {
        const decision = assessBaselineUpdate(baseline, report, { acceptRegressions: datasetOptions.acceptRegressions })
        if (!decision.allowed) {
          out(`Baseline NOT replaced (${baselineName}):`)
          for (const reason of decision.reasons) out(`  - ${reason}`)
          outcome = 'baseline_refused'
          notes.push(...decision.reasons)
          failure = 'The baseline was not replaced. See the reasons above.'
        } else {
          mkdirSync(path.dirname(dataset.baselinePath), { recursive: true })
          writeFileSync(dataset.baselinePath, reportText)
          out(`Baseline replaced: ${baselineName}`)
          for (const note of decision.notes) out(`  - ${note}`)
          outcome = 'baseline_replaced'
          notes.push(...decision.notes)
        }
      } else if (baseline === null) {
        out(`No baseline yet (${baselineName}). Create one with "npm run eval:baseline".`)
      } else {
        const changed = comparisonLines.filter((line) => !line.startsWith('Metrics:'))
        out(changed.length === 0 ? `No change against the baseline (${baselineName}).` : `Compared with the baseline (${baselineName}):`)
        for (const line of comparisonLines) out(`  - ${line}`)
        if (outcome === 'regression') failure = 'Regression against the committed baseline. The baseline was left unchanged.'
      }
    }

    writeFileSync(path.join(reportsDir, `${name}.md`), [renderMarkdown(report), ...(comparisonLines.length > 0 ? ['## Compared with the baseline', '', ...comparisonLines.map((line) => `- ${line}`), ''] : [])].join('\n'))

    const runId = randomUUID()
    const record = buildRunRecord({
      runId,
      startedAt,
      finishedAt: new Date(),
      datasetId,
      codeVersion: codeVersion(),
      report,
      reportText,
      reportFile,
      baseline: baselineUsed,
      regressions,
      metricChanges,
      outcome,
      notes,
    })
    const runsDir = path.join(reportsDir, 'runs')
    mkdirSync(runsDir, { recursive: true })
    const runFile = path.join(runsDir, `${record.started_at.replace(/[:.]/g, '-')}-${runId}.json`)
    writeFileSync(runFile, serializeRunRecord(record))
    out(`Run record: ${path.relative(ROOT, runFile)} (outcome: ${outcome})`)

    if (failure !== null) throw new Error(failure)
    expect(report.report_format).toBe(REPORT_FORMAT)
  })
})
