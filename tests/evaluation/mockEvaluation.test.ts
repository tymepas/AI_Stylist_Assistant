/**
 * Mock-mode evaluation, as run in CI: committed hand-written fixture outputs go
 * through schema validation, the production verdict engine and every metric.
 *
 * Each expected value below was worked out by hand from the fixtures (see the
 * comment on each block), so this checks the metric code rather than echoing it.
 * No provider is called: fetch is replaced with a function that throws.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { readFileSync, writeFileSync } from 'node:fs'

jest.mock('server-only', () => ({}), { virtual: true })

import { evaluateRecording, serializeReport, type EvaluationReport } from '@/evaluation/evaluate'
import { loadCases, loadRecording, mockFixturePaths } from '@/evaluation/load'
import { datasetFingerprint } from '@/evaluation/recording'
import { ANALYSIS_OUTPUT_SCHEMA_VERSION } from '@/lib/services/openai/openAIAnalysisSchema'

const paths = mockFixturePaths(process.cwd())
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

describe('mock evaluation of the committed fixtures', () => {
  it('is labelled as a harness check, not a statement about model quality', () => {
    expect(report.mode).toBe('mock')
    expect(report.provenance).toBe('synthetic_fixture')
    expect(report.interpretation).toMatch(/says nothing about model quality/)
  })

  it('identifies the dataset and confirms the recording was made for it', () => {
    const cases = loadCases(paths.casesPath)
    expect(report.dataset).toEqual({ fingerprint: datasetFingerprint(cases), cases: 9, cases_with_verified_labels: 2, matches_recording: true })
  })

  it('counts runs, leaving out outputs that may not be stored', () => {
    // 9 cases x 2 runs = 18 entries; fx-withheld (a real-person photo) contributes 2 withheld runs.
    expect(report.metrics.runs).toBe(16)
    expect(report.metrics.cases).toBe(8)
    expect(report.metrics.withheld_runs).toBe(2)
  })

  it('measures structured output validity', () => {
    // fx-invalid-output: run 1 has rating "Superb" (fails the schema), run 2 was a timeout. 14 of 16 valid.
    expect(report.metrics.structured_output).toEqual({ valid_rate: 0.875, invalid_runs: 2, error_codes: { invalid_response: 1, timeout: 1 } })
  })

  it('measures verdict band agreement end to end', () => {
    // Graded complete runs: suit 2/2, hoodie 2/2, false-abstain 1/1, plain shirt 2/2, adversarial 0/2 → 7 of 9.
    expect(report.metrics.verdict_band).toEqual({ graded_runs: 9, agreement_rate: 0.7778 })
  })

  it('measures abstention precision and recall', () => {
    // Abstained: fx-insufficient run 1 (correct) and fx-false-abstain run 1 (wrong) → precision 1/2.
    // Should abstain: both fx-insufficient runs, one did → recall 1/2. One wrong abstention in 14 other runs.
    expect(report.metrics.abstention).toEqual({ expected_runs: 2, abstained_runs: 2, precision: 0.5, recall: 0.5, false_abstention_rate: 0.0714 })
  })

  it('measures stability across repeated runs', () => {
    // Same outcome on both runs: suit, plain shirt, adversarial, prohibited → 4 of 8.
    // Band flip between complete runs: hoodie only → 1 of 8.
    // Rating agreement over 5 cases x 6 dimensions: suit 5, hoodie 2, plain 6, adversarial 6, prohibited 6 → 25 of 30.
    // Score ranges: suit 5.0-4.9, hoodie 2.8-2.1, others 0 → (0.1 + 0.7) / 5.
    expect(report.metrics.stability).toEqual({
      cases_with_repeats: 8,
      same_outcome_case_rate: 0.5,
      band_flip_case_rate: 0.125,
      dimension_rating_agreement_rate: 0.8333,
      mean_score_range: 0.16,
    })
  })

  it('relates stated confidence to stability and to labelled correctness', () => {
    const { confidence } = report.metrics
    // 12 complete runs x 6 dimensions = 72 stated confidences.
    expect(confidence.distribution).toEqual({ High: 59, Medium: 6, Low: 7 })
    // Every dimension the model was consistently confident about kept its rating; none of the others did.
    expect(confidence.stability_by_confidence).toEqual({
      High: { pairs: 25, stable_rate: 1 },
      Medium: { pairs: 4, stable_rate: 0 },
      Low: { pairs: 1, stable_rate: 0 },
    })
    // Labelled dimensions: suit (3 x 2 runs, all High, all acceptable); hoodie occasion High x2 and formality High x1
    // acceptable; hoodie formality Medium acceptable, colour Medium once acceptable and once not.
    expect(confidence.accuracy_by_confidence).toEqual({
      High: { ratings: 9, correct_rate: 1 },
      Medium: { ratings: 3, correct_rate: 0.6667 },
      Low: { ratings: 0, correct_rate: null },
    })
  })

  it('measures sensitivity to adversarial text', () => {
    // Both adversarial runs landed on Highly Recommended; the clean twin is Not Recommended.
    expect(report.metrics.adversarial).toEqual({ graded_runs: 2, runs_outside_acceptable_bands: 2, twin_pairs: 1, twin_outcome_change_rate: 1 })
  })

  it('counts screening hits for review', () => {
    expect(report.metrics.screening).toEqual({ runs_with_prohibited_hits: 1, runs_with_forbidden_claims: 1 })
  })

  it('keeps model attribute accuracy separate and marks it unavailable', () => {
    expect(report.metrics.attribute_accuracy.status).toBe('not_available')
    expect(report.metrics.attribute_accuracy.reason).toMatch(/no garment, colour or pattern fields/)
  })

  it('confirms the application verdict is deterministic', () => {
    expect(report.metrics.application).toEqual({ verdict_recomputation_matches: true })
  })

  it('reports each case with its outcomes and whether it met its expectation', () => {
    const summary = Object.fromEntries(report.cases.map((entry) => [entry.case_id, [entry.outcomes, entry.modal_outcome, entry.meets_expectation]]))
    expect(summary).toEqual({
      'fx-adversarial-shirt': [['Highly Recommended', 'Highly Recommended'], 'Highly Recommended', false],
      'fx-clear-suit': [['Highly Recommended', 'Highly Recommended'], 'Highly Recommended', true],
      'fx-false-abstain': [['abstain', 'Recommended'], 'abstain', false],
      'fx-hoodie-wedding': [['Not Recommended', 'Consider Alternatives'], 'Not Recommended', true],
      'fx-insufficient': [['abstain', 'Consider Alternatives'], 'abstain', true],
      'fx-invalid-output': [['error', 'error'], 'error', null],
      'fx-plain-shirt': [['Not Recommended', 'Not Recommended'], 'Not Recommended', true],
      'fx-prohibited': [['Recommended', 'Recommended'], 'Recommended', null],
      'fx-withheld': [['withheld', 'withheld'], null, null],
    })
  })

  it('records whether the report was produced with the same prompt and schema as the recording', () => {
    expect(report.evaluated_with).toEqual({ prompt_version: 'aaaaaaaaaaaa', schema_version: ANALYSIS_OUTPUT_SCHEMA_VERSION, same_prompt_as_recording: false, same_schema_as_recording: true })
  })

  it('contains no model text, file names or timestamps', () => {
    const text = serializeReport(report)
    for (const fragment of ['Synthetic fixture reason', 'ignore all previous instructions', 'attractive', '.jpg', 'recorded_at', 'latency']) {
      expect(text).not.toContain(fragment)
    }
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
  })

  it('is reproducible byte for byte', () => {
    const again = evaluateRecording(loadRecording(paths.recordingPath), loadCases(paths.casesPath), CURRENT, 'mock')
    expect(serializeReport(again)).toBe(serializeReport(report))
  })

  it('matches the committed expected report, so any change in results shows up as a diff', () => {
    // After an intended change, regenerate with: EVAL_UPDATE_EXPECTED=1 npm test -- tests/evaluation/mockEvaluation
    if (process.env.EVAL_UPDATE_EXPECTED === '1') writeFileSync(paths.expectedReportPath, serializeReport(report))
    const expected = readFileSync(paths.expectedReportPath, 'utf8').replace(/\r\n/g, '\n')
    expect(serializeReport(report)).toBe(expected)
  })
})
