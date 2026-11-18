/**
 * Recording, replay, mode selection and report comparison.
 * No provider is called anywhere in this file; "analyze" is always a local fake.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

jest.mock('server-only', () => ({}), { virtual: true })

import { manifestSchema, runCases, type AnalyzeFn, type BenchmarkCase, type PreparedCase, type RunOptions } from '@/benchmark/harness'
import { compareReports, evaluateRecording, renderMarkdown, serializeReport } from '@/evaluation/evaluate'
import { loadCases, loadRecording, mockFixturePaths } from '@/evaluation/load'
import { resolveEvaluationPlan } from '@/evaluation/modes'
import { createRecorder, datasetFingerprint, RECORDABLE_SOURCES, RECORDING_FORMAT, recordingSchema, stableStringify, type Recording } from '@/evaluation/recording'
import { ANALYSIS_OUTPUT_SCHEMA_VERSION } from '@/lib/services/openai/openAIAnalysisSchema'
import { OpenAIAnalysisError } from '@/lib/services/openai/openAIErrors'
import { allRated, makePng } from '../helpers/fixtures'

const OPTIONS: RunOptions = { model: 'gpt-6.1-terra', reasoningEffort: 'low', maxOutputTokens: 4_000, runsPerCase: 2, maxUsd: 5 }
const CURRENT = { promptVersion: 'aaaaaaaaaaaa', schemaVersion: ANALYSIS_OUTPUT_SCHEMA_VERSION }
const USAGE = { input_tokens: 5000, output_tokens: 600, total_tokens: 5600, cached_tokens: 0, reasoning_tokens: 100 }

function makeCases(): BenchmarkCase[] {
  return manifestSchema.parse({
    version: 1,
    cases: [
      { id: 'synthetic-suit', category: 'clear', description: 'Synthetic.', source: 'synthetic', photo: 'p.jpg', garment: 'g.jpg', occasion: 'Client Presentation', expected: { acceptable_bands: ['Recommended', 'Highly Recommended'] } },
      { id: 'licensed-dress', category: 'clear', description: 'Licensed.', source: 'public_license', photo: 'p.jpg', garment: 'g.jpg', occasion: 'Dinner Date', expected: {} },
      { id: 'volunteer-photo', category: 'clear', description: 'A real person.', source: 'approved_volunteer', photo: 'p.jpg', garment: 'g.jpg', occasion: 'Office Work', expected: {} },
      { id: 'owned-photo', category: 'clear', description: 'A real person.', source: 'owned', photo: 'p.jpg', garment: 'g.jpg', occasion: 'Office Work', expected: {} },
    ],
  }).cases
}

function prepared(cases: BenchmarkCase[]): PreparedCase[] {
  return cases.map((benchmarkCase) => ({ benchmarkCase, photo: makePng(), garment: makePng() }))
}

const goodOutput = () => ({ status: 'complete' as const, dimensions: allRated('Good'), shopping_advisor: { recommendations: [] } })

let fetchSpy: jest.SpiedFunction<typeof fetch>

beforeEach(() => {
  fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() => {
    throw new Error('Network access is not allowed in an evaluation.')
  })
})

afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled()
  jest.restoreAllMocks()
})

describe('recorder', () => {
  it('captures outputs, usage and errors without changing what the wrapped function returns', async () => {
    const cases = makeCases()
    const recorder = createRecorder({ options: OPTIONS, promptVersion: 'bbbbbbbbbbbb', schemaVersion: 'analysis-output/1', cases, recordedAt: '2026-11-16T00:00:00.000Z' })
    let call = 0
    const analyze: AnalyzeFn = async (input) => {
      call += 1
      input.onUsage(USAGE)
      if (input.caseId === 'licensed-dress' && input.run === 2) throw new OpenAIAnalysisError('timeout', 'timed out')
      return goodOutput()
    }

    const outcome = await runCases(prepared(cases), OPTIONS, recorder.wrap(analyze))
    const recording = recorder.recording()

    expect(call).toBe(8)
    expect(outcome.records).toHaveLength(8)
    // Usage still reaches the benchmark's own accounting.
    expect(outcome.records[0].usage).toEqual(USAGE)
    expect(recording).toMatchObject({
      format: RECORDING_FORMAT,
      provenance: 'model',
      model: 'gpt-6.1-terra',
      reasoning_effort: 'low',
      max_output_tokens: 4_000,
      prompt_version: 'bbbbbbbbbbbb',
      schema_version: 'analysis-output/1',
      dataset_fingerprint: datasetFingerprint(cases),
    })
    expect(recording.entries.map((entry) => `${entry.case_id}#${entry.run}:${entry.outcome}`)).toEqual([
      'licensed-dress#1:returned',
      'licensed-dress#2:error',
      'owned-photo#1:withheld',
      'owned-photo#2:withheld',
      'synthetic-suit#1:returned',
      'synthetic-suit#2:returned',
      'volunteer-photo#1:withheld',
      'volunteer-photo#2:withheld',
    ])
    expect(recording.entries.find((entry) => entry.outcome === 'error')).toMatchObject({ error_code: 'timeout', usage: USAGE })
    expect(recording.entries.find((entry) => entry.case_id === 'synthetic-suit')?.output).toEqual(goodOutput())
  })

  it('never stores model text for photos of real people', async () => {
    const cases = makeCases()
    const recorder = createRecorder({ options: OPTIONS, promptVersion: 'bbbbbbbbbbbb', schemaVersion: 'analysis-output/1', cases })
    const analyze: AnalyzeFn = async (input) => ({
      status: 'complete',
      dimensions: { ...allRated('Good'), color: { rating: 'Good', reason: `PRIVATE-DESCRIPTION-${input.caseId}`, confidence: 'High' } },
    })

    await runCases(prepared(cases), OPTIONS, recorder.wrap(analyze))
    const text = JSON.stringify(recorder.recording())

    expect(RECORDABLE_SOURCES).toEqual(['synthetic', 'public_license'])
    expect(text).toContain('PRIVATE-DESCRIPTION-synthetic-suit')
    expect(text).toContain('PRIVATE-DESCRIPTION-licensed-dress')
    expect(text).not.toContain('PRIVATE-DESCRIPTION-volunteer-photo')
    expect(text).not.toContain('PRIVATE-DESCRIPTION-owned-photo')
  })

  it('stores no images, file names, occasions or profile data', async () => {
    const cases = makeCases()
    const recorder = createRecorder({ options: OPTIONS, promptVersion: 'bbbbbbbbbbbb', schemaVersion: 'analysis-output/1', cases })
    await runCases(prepared(cases), OPTIONS, recorder.wrap(async () => goodOutput()))
    const text = JSON.stringify(recorder.recording())
    for (const fragment of ['image.png', 'data:image', 'base64', 'Client Presentation', 'preferredStyles']) expect(text).not.toContain(fragment)
  })

  it('re-throws the original error so the benchmark accounts for it as before', async () => {
    const cases = makeCases().slice(0, 1)
    const recorder = createRecorder({ options: OPTIONS, promptVersion: 'bbbbbbbbbbbb', schemaVersion: 'analysis-output/1', cases })
    const failure = new OpenAIAnalysisError('api_error', 'boom', 500)
    const wrapped = recorder.wrap(async () => { throw failure })
    await expect(wrapped({ photo: makePng(), garment: makePng(), occasion: 'x', styleProfile: { preferredStyles: [], favoriteColors: [], occasionPreferences: [] }, options: OPTIONS, onUsage: () => undefined, requestId: 'r', caseId: 'synthetic-suit', run: 1 })).rejects.toBe(failure)
    expect(recorder.recording().entries).toEqual([expect.objectContaining({ outcome: 'error', error_code: 'api_error' })])
  })
})

describe('recording format', () => {
  const valid = (): Recording => loadRecording(mockFixturePaths(process.cwd()).recordingPath)

  it('accepts the committed fixture recording', () => {
    expect(valid().entries).toHaveLength(18)
  })

  it('rejects unknown fields, so nothing extra can be smuggled into a recording', () => {
    expect(() => recordingSchema.parse({ ...valid(), api_key: 'sk-x' })).toThrow()
    const withExtra = valid()
    ;(withExtra.entries[0] as Record<string, unknown>).photo = 'data:image/png;base64,AAAA'
    expect(() => recordingSchema.parse(withExtra)).toThrow()
  })

  it('rejects duplicate entries and inconsistent outcomes', () => {
    const duplicate = valid()
    duplicate.entries.push({ ...duplicate.entries[0] })
    expect(() => recordingSchema.parse(duplicate)).toThrow(/Duplicate entry/)

    const withheldWithOutput = valid()
    const withheld = withheldWithOutput.entries.find((entry) => entry.outcome === 'withheld')!
    withheld.output = { status: 'complete' }
    expect(() => recordingSchema.parse(withheldWithOutput)).toThrow(/must not carry an output/)

    const errorWithoutCode = valid()
    delete errorWithoutCode.entries.find((entry) => entry.outcome === 'error')!.error_code
    expect(() => recordingSchema.parse(errorWithoutCode)).toThrow(/no error_code/)
  })

  it('rejects an unsupported model or a malformed version', () => {
    expect(() => recordingSchema.parse({ ...valid(), model: 'gpt-unknown' })).toThrow()
    expect(() => recordingSchema.parse({ ...valid(), prompt_version: 'latest' })).toThrow()
    expect(() => recordingSchema.parse({ ...valid(), format: 'verdict-recording/2' })).toThrow()
  })
})

describe('dataset fingerprint and stable serialisation', () => {
  it('does not depend on case order or key order', () => {
    const cases = makeCases()
    expect(datasetFingerprint([...cases].reverse())).toBe(datasetFingerprint(cases))
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(stableStringify({ a: { c: 3, d: 2 }, b: 1 }))
  })

  it('changes when an expectation or an input changes', () => {
    const cases = makeCases()
    const changedBand = cases.map((entry, index) => (index === 0 ? { ...entry, expected: { ...entry.expected, acceptable_bands: ['Recommended' as const] } } : entry))
    const changedOccasion = cases.map((entry, index) => (index === 0 ? { ...entry, occasion: 'Wedding Guest' } : entry))
    expect(new Set([datasetFingerprint(cases), datasetFingerprint(changedBand), datasetFingerprint(changedOccasion)]).size).toBe(3)
  })
})

describe('replay', () => {
  const paths = mockFixturePaths(process.cwd())

  it('gives the same report every time and labels real model outputs differently from fixtures', () => {
    const cases = loadCases(paths.casesPath)
    const recording: Recording = { ...loadRecording(paths.recordingPath), provenance: 'model', prompt_version: 'aaaaaaaaaaaa' }

    const first = evaluateRecording(recording, cases, CURRENT, 'replay')
    const second = evaluateRecording(recording, cases, CURRENT, 'replay')

    expect(serializeReport(first)).toBe(serializeReport(second))
    expect(first.mode).toBe('replay')
    expect(first.provenance).toBe('model')
    expect(first.interpretation).toMatch(/not a measure of recognition accuracy/)
    // The self-test recording was written for analysis-output/2; the current code is /3, and the report says so.
    expect(first.evaluated_with).toMatchObject({ same_prompt_as_recording: true, same_schema_as_recording: false })
    expect(first.quality.visual_evidence).toMatchObject({ applicable: false, reason: expect.stringMatching(/before observations and evidence existed/) })
  })

  it('validates recorded outputs against the current schema, so a schema change is not hidden', () => {
    const cases = makeCases()
    const recording = recordingSchema.parse({
      format: RECORDING_FORMAT,
      provenance: 'model',
      model: 'gpt-4.1',
      reasoning_effort: null,
      max_output_tokens: 1500,
      prompt_version: 'cccccccccccc',
      schema_version: 'analysis-output/0',
      dataset_fingerprint: datasetFingerprint(cases),
      entries: [
        { case_id: 'synthetic-suit', run: 1, outcome: 'returned', latency_ms: 10, output: { status: 'complete', dimensions: allRated('Good'), verdict: 'Recommended' } },
        { case_id: 'synthetic-suit', run: 2, outcome: 'returned', latency_ms: 10, output: goodOutput() },
      ],
    })

    const report = evaluateRecording(recording, cases, CURRENT, 'replay')

    expect(report.evaluated_with.same_schema_as_recording).toBe(false)
    expect(report.metrics.structured_output).toEqual({ valid_rate: 0.5, invalid_runs: 1, error_codes: { invalid_response: 1 } })
    expect(report.subject).toMatchObject({ model: 'gpt-4.1', reasoning_effort: null, schema_version: 'analysis-output/0' })
  })

  it('flags a manifest that differs from the one the recording was made with', () => {
    const cases = loadCases(paths.casesPath)
    const edited = cases.map((entry) => (entry.id === 'fx-clear-suit' ? { ...entry, expected: { ...entry.expected, acceptable_bands: ['Not Recommended' as const] } } : entry))
    const report = evaluateRecording(loadRecording(paths.recordingPath), edited, CURRENT, 'replay')
    expect(report.dataset.matches_recording).toBe(false)
    expect(renderMarkdown(report)).toContain('DIFFERS from the dataset the recording was made with')
  })

  it('ignores recorded entries for cases that are not in the manifest', () => {
    const cases = loadCases(paths.casesPath).filter((entry) => entry.id === 'fx-clear-suit')
    const report = evaluateRecording(loadRecording(paths.recordingPath), cases, CURRENT, 'replay')
    expect(report.metrics.runs).toBe(2)
    expect(report.cases.map((entry) => entry.case_id)).toEqual(['fx-clear-suit'])
  })

  it('does not score labels that have not been verified', () => {
    const cases = loadCases(paths.casesPath).map((entry) => (entry.labels ? { ...entry, labels: { ...entry.labels, verified: false } } : entry))
    const report = evaluateRecording(loadRecording(paths.recordingPath), cases, CURRENT, 'replay')
    expect(report.dataset.cases_with_verified_labels).toBe(0)
    expect(report.metrics.confidence.accuracy_by_confidence).toEqual({
      High: { ratings: 0, correct_rate: null },
      Medium: { ratings: 0, correct_rate: null },
      Low: { ratings: 0, correct_rate: null },
    })
  })

  it('reports rates as null, not zero, when there is nothing to measure', () => {
    const cases = makeCases()
    const empty = recordingSchema.parse({ format: RECORDING_FORMAT, provenance: 'model', model: 'gpt-4.1', reasoning_effort: null, max_output_tokens: 1500, prompt_version: 'cccccccccccc', schema_version: 'analysis-output/1', dataset_fingerprint: datasetFingerprint(cases), entries: [] })
    const { metrics } = evaluateRecording(empty, cases, CURRENT, 'replay')
    expect(metrics.structured_output.valid_rate).toBeNull()
    expect(metrics.verdict_band.agreement_rate).toBeNull()
    expect(metrics.abstention).toMatchObject({ precision: null, recall: null, false_abstention_rate: null })
    expect(metrics.stability).toMatchObject({ same_outcome_case_rate: null, mean_score_range: null })
    expect(metrics.adversarial.twin_outcome_change_rate).toBeNull()
  })
})

describe('comparing reports', () => {
  const paths = mockFixturePaths(process.cwd())

  it('lists what changed between two prompt versions on the same dataset', () => {
    const cases = loadCases(paths.casesPath)
    const base: Recording = { ...loadRecording(paths.recordingPath), provenance: 'model', prompt_version: 'aaaaaaaaaaaa' }
    // The candidate prompt resists the injected text: the adversarial case now matches its clean twin.
    const candidate: Recording = {
      ...base,
      prompt_version: 'bbbbbbbbbbbb',
      entries: base.entries.map((entry) => (entry.case_id === 'fx-adversarial-shirt' ? { ...entry, output: base.entries.find((other) => other.case_id === 'fx-plain-shirt')!.output } : entry)),
    }

    const comparison = compareReports(evaluateRecording(base, cases, CURRENT, 'replay'), evaluateRecording(candidate, cases, CURRENT, 'replay'))

    expect(comparison.comparable).toBe(true)
    expect(comparison.subject_changes).toEqual([{ field: 'prompt_version', base: 'aaaaaaaaaaaa', candidate: 'bbbbbbbbbbbb' }])
    expect(comparison.case_changes).toEqual([{ case_id: 'fx-adversarial-shirt', base: 'Highly Recommended', candidate: 'Not Recommended' }])
    const changes = Object.fromEntries(comparison.metric_changes.map((change) => [change.metric, [change.base, change.candidate, change.delta]]))
    expect(changes['adversarial.runs_outside_acceptable_bands']).toEqual([2, 0, -2])
    expect(changes['adversarial.twin_outcome_change_rate']).toEqual([1, 0, -1])
    expect(changes['verdict_band.agreement_rate']).toEqual([0.7778, 1, 0.2222])
    expect(changes['screening.runs_with_forbidden_claims']).toEqual([1, 0, -1])
    // Metrics that did not move are not listed.
    expect(changes['structured_output.valid_rate']).toBeUndefined()
  })

  it('lists a model change', () => {
    const cases = loadCases(paths.casesPath)
    const base = loadRecording(paths.recordingPath)
    const comparison = compareReports(evaluateRecording(base, cases, CURRENT, 'replay'), evaluateRecording({ ...base, model: 'gpt-4.1', reasoning_effort: null }, cases, CURRENT, 'replay'))
    expect(comparison.subject_changes).toEqual([
      { field: 'model', base: 'gpt-6.1-terra', candidate: 'gpt-4.1' },
      { field: 'reasoning_effort', base: 'low', candidate: null },
    ])
    expect(comparison.metric_changes).toEqual([])
  })

  it('marks reports from different datasets as not comparable', () => {
    const cases = loadCases(paths.casesPath)
    const recording = loadRecording(paths.recordingPath)
    const comparison = compareReports(evaluateRecording(recording, cases, CURRENT, 'replay'), evaluateRecording(recording, cases.slice(0, 3), CURRENT, 'replay'))
    expect(comparison.comparable).toBe(false)
  })
})

describe('mode selection', () => {
  it('defaults to mock', () => {
    expect(resolveEvaluationPlan({})).toEqual({ mode: 'mock' })
    expect(resolveEvaluationPlan({ EVAL_MODE: ' MOCK ' })).toEqual({ mode: 'mock' })
  })

  it('refuses live mode instead of running it', () => {
    const plan = resolveEvaluationPlan({ EVAL_MODE: 'live', BENCHMARK_LIVE: 'I_ACCEPT_OPENAI_CHARGES', BENCHMARK_MAX_USD: '5' })
    expect(plan.mode).toBe('refused')
    expect((plan as { reason: string }).reason).toMatch(/never calls a model/)
  })

  it('refuses replay without a recording rather than falling back to anything', () => {
    expect(resolveEvaluationPlan({ EVAL_MODE: 'replay', EVAL_CASES: 'cases.json' })).toMatchObject({ mode: 'refused' })
    expect(resolveEvaluationPlan({ EVAL_MODE: 'replay', EVAL_RECORDING: 'recording.json' })).toMatchObject({ mode: 'refused' })
  })

  it('accepts replay with a recording and a manifest', () => {
    expect(resolveEvaluationPlan({ EVAL_MODE: 'replay', EVAL_RECORDING: 'r.json', EVAL_CASES: 'c.json', EVAL_BASELINE: 'b.json' })).toEqual({ mode: 'replay', recordingPath: 'r.json', casesPath: 'c.json', baselinePath: 'b.json' })
  })

  it('refuses an unknown mode', () => {
    expect(resolveEvaluationPlan({ EVAL_MODE: 'auto' })).toMatchObject({ mode: 'refused' })
  })
})

describe('the evaluation code cannot make billable calls', () => {
  const evaluationDir = path.join(process.cwd(), 'evaluation')
  const sources = readdirSync(evaluationDir).filter((name) => name.endsWith('.ts')).map((name) => [name, readFileSync(path.join(evaluationDir, name), 'utf8')] as const)

  it('never calls the analysis or profile services or the model client', () => {
    expect(sources.length).toBeGreaterThanOrEqual(5)
    for (const [name, source] of sources) {
      expect({ name, usesModel: /analyzeWithOpenAI\(|generateProfileWithOpenAI\(|callResponsesApi\(|OPENAI_API_KEY/.test(source) }).toEqual({ name, usesModel: false })
    }
  })

  it('never performs a network request of its own', () => {
    for (const [name, source] of sources) {
      // The runner replaces fetch with a function that throws; nothing may call it.
      const calls = source.match(/\bfetch\(/g) ?? []
      expect({ name, fetchCalls: calls.length }).toEqual({ name, fetchCalls: 0 })
    }
  })

  it('is not part of the default test run or the benchmark, and the CI workflow sets no opt-in', () => {
    const workflow = readFileSync(path.join(process.cwd(), '.github', 'workflows', 'ci.yml'), 'utf8')
    expect(workflow).not.toMatch(/BENCHMARK_LIVE|I_ACCEPT_OPENAI_CHARGES|OPENAI_API_KEY\s*:/)
    const evalConfig = readFileSync(path.join(process.cwd(), 'jest.evaluation.config.ts'), 'utf8')
    expect(evalConfig).toContain("testMatch: ['<rootDir>/evaluation/run.eval.ts']")
  })
})

describe('manifest labels', () => {
  const base = { id: 'a', category: 'clear', description: 'd', source: 'synthetic', photo: 'p.jpg', garment: 'g.jpg', occasion: 'Office Work', expected: {} }

  it('keeps existing manifests valid and leaves labels unverified by default', () => {
    const [parsed] = manifestSchema.parse({ version: 1, cases: [{ ...base, labels: { garment_category: 'suiting', colour_family: 'navy', pattern: 'solid', formality: 'business formal', expected_uncertainty: 'low' } }] }).cases
    expect(parsed.labels?.verified).toBe(false)
    expect(manifestSchema.parse({ version: 1, cases: [base] }).cases[0].labels).toBeUndefined()
  })

  it('requires a twin to be another case in the manifest', () => {
    expect(() => manifestSchema.parse({ version: 1, cases: [{ ...base, twin_of: 'missing' }] })).toThrow(/twin_of must name another case/)
    expect(() => manifestSchema.parse({ version: 1, cases: [{ ...base, twin_of: 'a' }] })).toThrow(/twin_of must name another case/)
    expect(manifestSchema.parse({ version: 1, cases: [base, { ...base, id: 'b', category: 'adversarial_text', twin_of: 'a' }] }).cases).toHaveLength(2)
  })

  it('rejects unknown label fields and invalid dimension names', () => {
    expect(() => manifestSchema.parse({ version: 1, cases: [{ ...base, labels: { brand: 'x' } }] })).toThrow()
    expect(() => manifestSchema.parse({ version: 1, cases: [{ ...base, expected: { dimension_ratings: { price: ['Good'] } } }] })).toThrow()
  })

  it('still accepts the example manifest shipped with the benchmark', () => {
    const example = JSON.parse(readFileSync(path.join(process.cwd(), 'benchmark', 'cases.example.json'), 'utf8'))
    expect(manifestSchema.parse(example).cases.length).toBeGreaterThanOrEqual(15)
  })
})
