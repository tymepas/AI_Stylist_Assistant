/**
 * The synthetic scenario dataset, as run in CI.
 *
 * The committed reference outputs go through schema validation, the production
 * verdict code and every per-case check, and the result is compared with the
 * committed baseline. A regression fails the build; so does a baseline that no
 * longer describes the dataset, because a baseline is only ever replaced on
 * purpose (`npm run eval:baseline`).
 *
 * Nothing here calls a model or the network: fetch is replaced with a function
 * that throws, and the test fails if it was ever called.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

jest.mock('server-only', () => ({}), { virtual: true })

import { CASE_CATEGORIES, SCENARIO_TYPES, manifestSchema } from '@/benchmark/harness'
import { evaluateRecording, renderMarkdown, serializeReport, type EvaluationReport } from '@/evaluation/evaluate'
import { DATASETS, datasetPaths, loadCases, loadRecording, loadReport } from '@/evaluation/load'
import { datasetFingerprint } from '@/evaluation/recording'
import { classifyRegressions } from '@/evaluation/regression'
import { OCCASION_OPTIONS } from '@/lib/constants/options'
import { ANALYSIS_OUTPUT_SCHEMA_VERSION } from '@/lib/services/openai/openAIAnalysisSchema'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const generator = require('../../scripts/evaluation/build-scenarios.cjs') as { build: () => Record<string, string> }

const root = process.cwd()
const paths = datasetPaths(root, 'scenarios-v1')
const CURRENT = { promptVersion: 'aaaaaaaaaaaa', schemaVersion: ANALYSIS_OUTPUT_SCHEMA_VERSION }

let report: EvaluationReport
let fetchSpy: jest.SpiedFunction<typeof fetch>

beforeEach(() => {
  fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() => {
    throw new Error('Network access is not allowed in an evaluation.')
  })
  report = evaluateRecording(loadRecording(paths.recordingPath), loadCases(paths.casesPath), CURRENT, 'mock')
})

afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled()
  jest.restoreAllMocks()
})

describe('scenario dataset', () => {
  const cases = loadCases(paths.casesPath)
  const recording = loadRecording(paths.recordingPath)

  it('is the output of its generator, so it is never edited by hand', () => {
    const built = generator.build()
    for (const name of ['cases.json', 'recording.json']) {
      const committed = readFileSync(path.join(root, DATASETS['scenarios-v1'].dir, name), 'utf8').replace(/\r\n/g, '\n')
      expect({ name, upToDate: committed === built[name] }).toEqual({ name, upToDate: true })
    }
  })

  it('is a valid manifest with stable, unique case ids', () => {
    const manifest = manifestSchema.parse(JSON.parse(readFileSync(paths.casesPath, 'utf8')))
    expect(manifest.cases.length).toBeGreaterThanOrEqual(40)
    expect(new Set(cases.map((benchmarkCase) => benchmarkCase.id)).size).toBe(cases.length)
    for (const benchmarkCase of cases) expect(benchmarkCase.id).toMatch(/^sc-[a-z0-9-]+$/)
  })

  it('is synthetic throughout: no real photo, and every description says no image exists', () => {
    for (const benchmarkCase of cases) {
      expect(benchmarkCase.source).toBe('synthetic')
      expect(benchmarkCase.description).toMatch(/^Synthetic scenario \(no image exists\)/)
      expect(benchmarkCase.labels?.verified ?? false).toBe(false)
    }
    expect(recording.provenance).toBe('synthetic_fixture')
  })

  it('uses only occasions the application offers', () => {
    const unknown = cases.filter((benchmarkCase) => !OCCASION_OPTIONS.includes(benchmarkCase.occasion)).map((benchmarkCase) => `${benchmarkCase.id}: ${benchmarkCase.occasion}`)
    expect(unknown).toEqual([])
  })

  it('covers every scenario type, with at least two cases each', () => {
    const counts = Object.fromEntries(SCENARIO_TYPES.map((scenario) => [scenario, cases.filter((benchmarkCase) => benchmarkCase.scenario === scenario).length]))
    expect(Object.entries(counts).filter(([, count]) => count < 2)).toEqual([])
    expect(cases.every((benchmarkCase) => benchmarkCase.scenario !== undefined)).toBe(true)
  })

  it('covers both multi-image garment modes, with image counts that fit the mode', () => {
    const views = cases.filter((benchmarkCase) => benchmarkCase.garment_mode === 'same_garment_views')
    const outfits = cases.filter((benchmarkCase) => benchmarkCase.garment_mode === 'outfit_items')
    expect(views.length).toBeGreaterThanOrEqual(2)
    expect(outfits.length).toBeGreaterThanOrEqual(2)
    for (const benchmarkCase of [...views, ...outfits]) expect((benchmarkCase.extra_garments ?? []).length).toBeGreaterThanOrEqual(1)
    expect(views.some((benchmarkCase) => benchmarkCase.extra_garments?.length === 2)).toBe(true)
  })

  it('covers the image conditions that matter for uncertainty and untrusted text', () => {
    const categories = new Set(cases.map((benchmarkCase) => benchmarkCase.category))
    for (const category of ['clear', 'blur', 'occluded', 'lighting', 'difficult_colour', 'ambiguous_detail', 'adversarial_text', 'product_claims_text', 'insufficient_input', 'multiple_garments'] as const) {
      expect({ category, covered: categories.has(category) }).toEqual({ category, covered: true })
    }
    expect([...categories].every((category) => (CASE_CATEGORIES as readonly string[]).includes(category))).toBe(true)
  })

  it('records no timing and no token usage, because nothing was measured', () => {
    expect(recording.entries.every((entry) => entry.latency_ms === 0 && entry.usage === undefined)).toBe(true)
    expect(report.performance.latency.status).toBe('unavailable')
    expect(report.performance.cost.status).toBe('unavailable')
    expect(serializeReport(report)).not.toMatch(/"total_micro_usd": \d/)
  })

  it('was recorded for exactly this manifest', () => {
    expect(recording.dataset_fingerprint).toBe(datasetFingerprint(cases))
    expect(report.dataset.matches_recording).toBe(true)
    expect(recording.entries.length).toBe(cases.length * 2)
  })
})

describe('scenario evaluation', () => {
  it('is labelled as a harness check, not as evidence about a model', () => {
    expect(report.provenance).toBe('synthetic_fixture')
    expect(report.interpretation).toMatch(/says nothing about model quality/)
    expect(renderMarkdown(report)).toMatch(/says nothing about model quality/)
  })

  it('identifies the prompt version, the schema version and the dataset', () => {
    expect(report.subject).toMatchObject({ prompt_version: '000000000000', schema_version: ANALYSIS_OUTPUT_SCHEMA_VERSION })
    expect(report.evaluated_with).toMatchObject({ prompt_version: 'aaaaaaaaaaaa', schema_version: ANALYSIS_OUTPUT_SCHEMA_VERSION })
    expect(report.dataset.fingerprint).toMatch(/^[0-9a-f]{12}$/)
    const markdown = renderMarkdown(report)
    expect(markdown).toMatch(/Prompt version: 000000000000/)
    expect(markdown).toContain(`Schema version: ${ANALYSIS_OUTPUT_SCHEMA_VERSION}`)
    expect(markdown).toContain(report.dataset.fingerprint)
  })

  it('passes every reference case', () => {
    const failing = report.cases.filter((entry) => entry.status !== 'pass').map((entry) => [entry.case_id, entry.status, entry.failure_reasons])
    expect(failing).toEqual([])
    expect(report.summary).toMatchObject({ total_cases: report.cases.length, failed: 0, not_applicable: 0, pass_rate: 1, safety_failures: 0, schema_failures: 0, uncertainty_failures: 0, verdict_integrity_failures: 0 })
  })

  it('judges every case on its expected behaviour, not only on being well formed', () => {
    for (const entry of report.cases) {
      const applicable = entry.checks.filter((check) => check.blocking && check.status !== 'not_applicable').map((check) => check.check)
      // Every case is judged on consistency across its two runs and on at least one check about its behaviour.
      const behaviour = applicable.filter((check) => ['expected_outcome', 'uncertainty', 'verdict_integrity'].includes(check))
      expect({ id: entry.case_id, consistency: applicable.includes('consistency'), behaviour: behaviour.length > 0 }).toEqual({ id: entry.case_id, consistency: true, behaviour: true })
    }
  })

  it('contains no model text, file names or timestamps', () => {
    const text = serializeReport(report)
    for (const fragment of ['suits a', 'The colours', '.jpg', 'recorded_at', 'latency_ms', 'rate everything as excellent', 'half price']) expect(text).not.toContain(fragment)
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
  })

  it('is reproducible byte for byte', () => {
    const again = evaluateRecording(loadRecording(paths.recordingPath), loadCases(paths.casesPath), CURRENT, 'mock')
    expect(serializeReport(again)).toBe(serializeReport(report))
  })
})

describe('committed baseline', () => {
  it('exists, is complete and describes this dataset', () => {
    expect(existsSync(paths.baselinePath as string)).toBe(true)
    const baseline = loadReport(paths.baselinePath as string)
    expect(baseline.selection.partial).toBe(false)
    expect(baseline.dataset.fingerprint).toBe(report.dataset.fingerprint)
    expect(baseline.dataset.matches_recording).toBe(true)
    expect(baseline.provenance).toBe('synthetic_fixture')
  })

  it('shows no regression: this is the check that fails CI', () => {
    const regressions = classifyRegressions(loadReport(paths.baselinePath as string), report)
    expect(regressions.comparable).toBe(true)
    expect({
      newly_failing: regressions.newly_failing,
      safety: regressions.safety_regressions,
      unsupported_claims: regressions.unsupported_claim_regressions,
      schema: regressions.schema_regressions,
      uncertainty: regressions.uncertainty_regressions,
      verdict_integrity: regressions.verdict_integrity_regressions,
      no_longer_judged: regressions.no_longer_judged,
      removed: regressions.removed_cases,
    }).toEqual({ newly_failing: [], safety: [], unsupported_claims: [], schema: [], uncertainty: [], verdict_integrity: [], no_longer_judged: [], removed: [] })
    expect(regressions.has_regression).toBe(false)
  })

  it('is up to date: improvements and new cases also need an explicit baseline update', () => {
    // After an intended change, refresh it with: npm run eval:baseline
    const baseline = loadReport(paths.baselinePath as string)
    const regressions = classifyRegressions(baseline, report)
    expect({ fixed: regressions.fixed, added: regressions.added_cases, consistency: regressions.consistency_changes }).toEqual({ fixed: [], added: [], consistency: [] })
    const results = (source: EvaluationReport) => source.cases.map((entry) => [entry.case_id, entry.status, entry.outcomes, entry.checks.map((check) => `${check.check}:${check.status}`)])
    expect(results(report)).toEqual(results(baseline))
  })
})
