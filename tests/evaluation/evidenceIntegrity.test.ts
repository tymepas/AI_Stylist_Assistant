/**
 * How much evidence a figure really rests on, and what counts as getting worse.
 *
 * These tests come from an independent review of the framework. Each one is a
 * concrete scenario in which the evaluation would have claimed more than it
 * knew, or let something worse pass:
 *
 * - a few cases looking like a measured sample because runs, dimensions or
 *   outfit items were counted instead of cases;
 * - a figure that disappears being treated as "nothing changed";
 * - a replay scoring a reference set that the validator would refuse;
 * - a reference set that was typed but never validated being scored.
 *
 * The data is the in-memory test fixture (tests/helpers/qualityFixture.ts): no
 * image, no reviewer and no model stands behind it. No network is used.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

jest.mock('server-only', () => ({}), { virtual: true })

import type { BenchmarkCase } from '@/benchmark/harness'
import { evaluateRecording, serializeReport, type EvaluationReport } from '@/evaluation/evaluate'
import { evaluateFiles, loadReferenceSet } from '@/evaluation/load'
import { resolveEvaluationPlan } from '@/evaluation/modes'
import { MIN_SAMPLE, UNAVAILABLE_NO_SCORED_OUTPUT } from '@/evaluation/quality'
import type { Recording } from '@/evaluation/recording'
import { ReferenceSetError, manifestProblems, type CaseReference, type ReferenceSet } from '@/evaluation/reference'
import { ACCEPT_WORSE_BASELINE, assessBaselineUpdate, classifyMetricChanges, describeMetricChanges } from '@/evaluation/regression'
import { degrade, fixtureCases, fixtureRecording, fixtureReferences, type FixtureOutput } from '../helpers/qualityFixture'

const CURRENT = { promptVersion: 'aaaaaaaaaaaa', schemaVersion: 'analysis-output/2' }
type Change = (output: FixtureOutput, caseId: string, run: number) => FixtureOutput

/** A dataset made of some of the fixture cases only. It is a whole dataset, not a partial run. */
function dataset(ids: string[], outfits = 5): { cases: BenchmarkCase[]; references: ReferenceSet } {
  const cases = fixtureCases('image_review', outfits).filter((benchmarkCase) => ids.includes(benchmarkCase.id))
  const all = fixtureReferences('image_review', outfits)
  return { cases, references: { ...all, references: all.references.filter((reference) => ids.includes(reference.case_id)).map((reference) => ({ ...reference, comparison_group: undefined })) } }
}

function evaluate(data: { cases: BenchmarkCase[]; references: ReferenceSet }, change?: Change, edit?: (recording: Recording) => void): EvaluationReport {
  const recording = fixtureRecording(data.cases, 'model', change)
  edit?.(recording)
  return evaluateRecording(recording, data.cases, CURRENT, 'replay', { references: data.references })
}

const classOf = (base: EvaluationReport, candidate: EvaluationReport, metric: string) => classifyMetricChanges(base, candidate).comparisons.find((comparison) => comparison.metric === metric)
const allWrong: Change = (output) => ({ ...output, dimensions: Object.fromEntries(Object.entries(output.dimensions).map(([key, value]) => [key, { ...value, rating: 'Poor', confidence: 'High' }])) })
const allHigh: Change = (output) => ({ ...output, dimensions: Object.fromEntries(Object.entries(output.dimensions).map(([key, value]) => [key, { ...value, confidence: 'High' }])) })

let fetchSpy: jest.SpiedFunction<typeof fetch>
beforeEach(() => {
  fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() => { throw new Error('Network access is not allowed in an evaluation.') })
})
afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled()
  jest.restoreAllMocks()
})

describe('a figure counts cases, never runs, dimensions or items', () => {
  it('does not treat three cases as a measured sample because they have eighteen ratings', () => {
    // Three cases, every rating stated with High confidence: 18 High-confidence ratings in each run.
    const three = dataset(['q-single-01', 'q-single-02', 'q-single-03'])
    const base = evaluate(three, allHigh)
    const candidate = evaluate(three, allWrong)

    const error = candidate.quality.calibration.image_reviewed.high_confidence_error_rate
    expect(error).toMatchObject({ status: 'insufficient_sample', value: 1, n: 3 })
    expect(error.n).toBeLessThan(MIN_SAMPLE)
    // From 0 to 1 is the largest possible change, and it is still not a conclusion on three cases.
    expect(classOf(base, candidate, 'calibration.image_reviewed.high_confidence_error_rate')).toMatchObject({ classification: 'inconclusive', base: 0, candidate: 1, base_n: 3, candidate_n: 3 })
    expect(classOf(base, candidate, 'agreement.image_reviewed.occasion.exact_rate')).toMatchObject({ classification: 'inconclusive' })
    expect(classifyMetricChanges(base, candidate).has_regression).toBe(false)
  })

  it('does not treat four cases as a measured sample because they have eight runs', () => {
    const four = dataset(['q-single-01', 'q-single-02', 'q-single-03', 'q-single-04'])
    const base = evaluate(four)
    const candidate = evaluate(four, undefined, (recording) => {
      for (const entry of recording.entries.filter((item) => item.case_id === 'q-single-01')) {
        Object.assign(entry, { outcome: 'error', error_code: 'timeout' })
        delete entry.output
      }
    })
    // One of four cases fails in both runs: 0.75, from four cases.
    expect(candidate.metric_index['validity.valid_output_rate']).toMatchObject({ status: 'insufficient_sample', value: 0.75, n: 4 })
    expect(candidate.metrics.runs).toBe(8)
    expect(classOf(base, candidate, 'validity.valid_output_rate')).toMatchObject({ classification: 'inconclusive' })
  })

  it('reports every indexed figure with a case count that is at most the number of cases', () => {
    const report = evaluateRecording(fixtureRecording(fixtureCases('image_review'), 'model', degrade), fixtureCases('image_review'), CURRENT, 'replay', { references: fixtureReferences('image_review') })
    expect(report.metrics.runs).toBe(34)
    for (const [name, metric] of Object.entries(report.metric_index)) {
      expect({ name, withinCases: metric.n <= 17 }).toEqual({ name, withinCases: true })
    }
  })

  it('counts validity, band agreement and abstention per case in the index', () => {
    // 17 cases with two runs each; q-single-01 fails once: its share is 0.5.
    const cases = fixtureCases('image_review')
    const recording = fixtureRecording(cases, 'model')
    const first = recording.entries.find((entry) => entry.case_id === 'q-single-01' && entry.run === 1) as Recording['entries'][number]
    Object.assign(first, { outcome: 'error', error_code: 'timeout' })
    delete first.output
    const report = evaluateRecording(recording, cases, CURRENT, 'replay', { references: fixtureReferences('image_review') })
    expect(report.quality.by_case.valid_output_rate).toMatchObject({ status: 'measured', value: 0.9706, n: 17 }) // 16.5 / 17
    expect(report.quality.by_case.false_abstention_rate).toMatchObject({ value: 0, n: 17 })
    expect(report.quality.by_case.abstention_recall).toMatchObject({ status: 'unavailable', value: null })
  })
})

describe('a figure that was measured and is gone counts as worse', () => {
  // Ten outfit cases, so that the outfit figures are measured in the base.
  const ids = fixtureCases('image_review', 10).map((benchmarkCase) => benchmarkCase.id)
  const withoutNotes: Change = (output) => ({ ...output, outfit_components: undefined })

  it('measures the outfit figures once ten outfit cases stand behind them', () => {
    const base = evaluate(dataset(ids, 10))
    expect(base.quality.garment_identification.image_reviewed.garment_type_accuracy).toMatchObject({ status: 'measured', value: 1, n: 10 })
    expect(base.quality.multi_image.outfit_items.completeness_rate).toMatchObject({ status: 'measured', value: 1, n: 10 })
  })

  it('detects wrong garment types as a regression on a measured sample', () => {
    const data = dataset(ids, 10)
    const changes = classifyMetricChanges(evaluate(data), evaluate(data, degrade))
    // 1 -> 0.5 on ten cases: margin 1.96 * sqrt(0.25 / 10) = 0.3099.
    expect(changes.comparisons.find((entry) => entry.metric === 'garment_identification.image_reviewed.garment_type_accuracy')).toMatchObject({ classification: 'regression', base: 1, candidate: 0.5, margin: 0.3099 })
  })

  it('lists a metric as lost when the output stops producing what it was measured from', () => {
    const data = dataset(ids, 10)
    const base = evaluate(data)
    const candidate = evaluate(data, withoutNotes)
    const changes = classifyMetricChanges(base, candidate)

    // With no per-item notes at all, garment type accuracy has nothing to be built from.
    expect(candidate.quality.garment_identification.image_reviewed.garment_type_accuracy).toMatchObject({ status: 'unavailable', value: null })
    expect(changes.comparisons.find((entry) => entry.metric === 'garment_identification.image_reviewed.garment_type_accuracy')?.classification).toBe('unavailable')
    expect(changes.lost).toEqual(['garment_identification.image_reviewed.garment_type_accuracy'])
    expect(changes.has_regression).toBe(true)
    expect(describeMetricChanges(changes).some((line) => line.startsWith('Metric lost: garment_identification.image_reviewed.garment_type_accuracy was measured in the baseline (1, 10 cases) and has no measured figure now (no figure)'))).toBe(true)
  })

  it('refuses such a report as a baseline, and accepts it only with the explicit decision', () => {
    const data = dataset(ids, 10)
    const refused = assessBaselineUpdate(evaluate(data), evaluate(data, withoutNotes))
    expect(refused.allowed).toBe(false)
    expect((refused as { reasons: string[] }).reasons.some((line) => line.startsWith('Metric lost:'))).toBe(true)
    expect((refused as { reasons: string[] }).reasons.some((line) => line.includes(ACCEPT_WORSE_BASELINE))).toBe(true)
    expect(assessBaselineUpdate(evaluate(data), evaluate(data, withoutNotes), { acceptRegressions: true }).allowed).toBe(true)
  })

  it('also counts a sample that shrank below the minimum as lost', () => {
    const data = dataset(ids, 10)
    const candidate = evaluate(data, undefined, (recording) => {
      // Two outfit cases fail completely: eight outfit cases are left.
      for (const entry of recording.entries.filter((item) => ['q-outfit-01', 'q-outfit-02'].includes(item.case_id))) {
        Object.assign(entry, { outcome: 'error', error_code: 'timeout' })
        delete entry.output
      }
    })
    expect(candidate.quality.multi_image.outfit_items.completeness_rate).toMatchObject({ status: 'insufficient_sample', n: 8 })
    expect(classifyMetricChanges(evaluate(data), candidate).lost).toContain('multi_image.outfit_items.completeness_rate')
  })

  it('does not call a metric lost when the two reports are not comparable', () => {
    const data = dataset(ids, 10)
    const base = evaluate(data)
    const lost = 'garment_identification.image_reviewed.garment_type_accuracy'
    // A partial candidate.
    const partial = evaluateRecording(fixtureRecording(data.cases, 'model', withoutNotes), data.cases, CURRENT, 'replay', { references: data.references, selection: { caseIds: ['q-outfit-01'] } })
    expect(classifyMetricChanges(base, partial).lost).toEqual([])
    // Another reference set.
    const reversioned = evaluateRecording(fixtureRecording(data.cases, 'model', withoutNotes), data.cases, CURRENT, 'replay', { references: { ...data.references, dataset_version: '2.0.0' } })
    const changes = classifyMetricChanges(base, reversioned)
    expect(changes.lost).not.toContain(lost)
    // A figure that does not depend on references is still comparable, and still lost.
    expect(changes.lost).toEqual([])
    expect(changes.not_compared).toBeGreaterThan(0)
    expect(describeMetricChanges(changes).some((line) => line.startsWith('Metrics not compared:'))).toBe(true)
  })

  it('says how many figures were not compared when a baseline is replaced after the references changed', () => {
    const data = dataset(ids, 10)
    const decision = assessBaselineUpdate(evaluate(data), evaluateRecording(fixtureRecording(data.cases, 'model', degrade), data.cases, CURRENT, 'replay', { references: { ...data.references, dataset_version: '2.0.0' } }))
    // Nothing can be concluded at metric level, so the update is judged at case level only, and says so.
    expect(decision.allowed).toBe(true)
    expect((decision as { notes: string[] }).notes.some((line) => /^Metrics not compared: \d+ figure\(s\)/.test(line))).toBe(true)
  })
})

describe('a replay applies the checks of the validator', () => {
  let dir: string
  const sha = (content: string) => createHash('sha256').update(content).digest('hex')

  /** Writes a manifest, a recording and a reference set for two fixture cases, with real files behind the image hashes. */
  function writeDataset(edit: (references: CaseReference[]) => void = () => undefined): { casesPath: string; recordingPath: string; referencesPath: string; imagesDir: string } {
    const data = dataset(['q-single-01', 'q-single-02'])
    const imagesDir = path.join(dir, 'images')
    for (const reference of data.references.references) {
      for (const image of reference.images) {
        mkdirSync(path.dirname(path.join(imagesDir, image.path)), { recursive: true })
        writeFileSync(path.join(imagesDir, image.path), `bytes of ${image.path}`)
        image.sha256 = sha(`bytes of ${image.path}`)
      }
    }
    edit(data.references.references)
    const files = { casesPath: path.join(dir, 'cases.json'), recordingPath: path.join(dir, 'recording.json'), referencesPath: path.join(dir, 'references.json'), imagesDir }
    writeFileSync(files.casesPath, JSON.stringify({ version: 1, cases: data.cases }))
    writeFileSync(files.recordingPath, JSON.stringify(fixtureRecording(data.cases, 'model')))
    writeFileSync(files.referencesPath, JSON.stringify(data.references))
    return files
  }
  const replay = (files: ReturnType<typeof writeDataset>, checks: { today?: string; imagesDir?: string }) =>
    evaluateFiles({ casesPath: files.casesPath, recordingPath: files.recordingPath, referencesPath: files.referencesPath, referenceChecks: checks, current: CURRENT, mode: 'replay' })
  const problemsOf = (run: () => unknown): string[] => {
    try {
      run()
    } catch (error) {
      if (error instanceof ReferenceSetError) return error.problems
      throw error
    }
    return []
  }

  beforeEach(() => { dir = mkdtempSync(path.join(os.tmpdir(), 'verdict-replay-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('scores a valid set whose images are the files that were reviewed', () => {
    const files = writeDataset()
    const report = replay(files, { today: '2026-11-17', imagesDir: files.imagesDir })
    expect(report.quality.image_grounded_accuracy).toEqual({ status: 'available', cases: 2 })
  })

  it('refuses a review dated in the future instead of scoring it as human-reviewed', () => {
    const files = writeDataset((references) => { references[0].reviewed_on = '2099-01-01' })
    expect(problemsOf(() => replay(files, { today: '2026-11-17' }))).toEqual(['Reference q-single-01: reviewed_on is in the future'])
    expect(problemsOf(() => loadReferenceSet(files.referencesPath, dataset(['q-single-01', 'q-single-02']).cases, { today: '2026-11-17' }))).toEqual(['Reference q-single-01: reviewed_on is in the future'])
  })

  it('refuses a set whose image changed after it was reviewed', () => {
    const files = writeDataset()
    writeFileSync(path.join(files.imagesDir, 'q-single-02', 'garment-1.jpg'), 'cropped after the review')
    expect(problemsOf(() => replay(files, { today: '2026-11-17', imagesDir: files.imagesDir }))).toEqual(['Reference q-single-02: image "garment-1" is not the file that was reviewed (its SHA-256 differs)'])
  })

  it('refuses a set whose reviewed image is missing', () => {
    const files = writeDataset()
    rmSync(path.join(files.imagesDir, 'q-single-01', 'photo.jpg'))
    expect(problemsOf(() => replay(files, { today: '2026-11-17', imagesDir: files.imagesDir }))).toEqual(['Reference q-single-01: image "photo" is not in the image directory'])
  })

  it('takes the image directory for a replay from the command line', () => {
    expect(resolveEvaluationPlan({ EVAL_MODE: 'replay', EVAL_RECORDING: 'r.json', EVAL_CASES: 'c.json', EVAL_REFERENCES: 'refs.json', EVAL_IMAGES: 'benchmark/data/golden-v1' })).toMatchObject({ mode: 'replay', imagesDir: 'benchmark/data/golden-v1' })
  })
})

describe('a reference set is validated wherever it comes from', () => {
  it('refuses a set that is typed as valid but was never parsed', () => {
    const cases = fixtureCases('image_review')
    // Only a basis and a status: enough to be scored as human-reviewed if nothing checked it.
    const unchecked = { format: 'verdict-reference-set/1', dataset: 'x', dataset_version: '1.0.0', references: [{ case_id: 'q-single-01', basis: 'image_review', status: 'complete' }] } as unknown as ReferenceSet
    expect(() => evaluateRecording(fixtureRecording(cases, 'model'), cases, CURRENT, 'replay', { references: unchecked })).toThrow(ReferenceSetError)
  })

  it('refuses a set that disagrees with the manifest it is evaluated with', () => {
    const cases = fixtureCases('image_review')
    const references = fixtureReferences('image_review')
    references.references[0].occasion = 'Wedding Guest'
    expect(() => evaluateRecording(fixtureRecording(cases, 'model'), cases, CURRENT, 'replay', { references })).toThrow(/the occasion differs from the manifest/)
  })
})

describe('reasons name the actual cause', () => {
  it('says that references exist and nothing could be scored, when every referenced case failed', () => {
    const data = dataset(['q-single-01', 'q-single-02'])
    const report = evaluate(data, undefined, (recording) => {
      for (const entry of recording.entries) {
        Object.assign(entry, { outcome: 'error', error_code: 'timeout' })
        delete entry.output
      }
    })
    // Not "insufficient human-reviewed ground truth": the reviews are there.
    expect(report.references.cases_by_tier.image_reviewed).toBe(2)
    expect(report.quality.image_grounded_accuracy).toEqual({ status: 'unavailable', reason: UNAVAILABLE_NO_SCORED_OUTPUT, cases: 0 })
    expect(report.quality.agreement.image_reviewed).toMatchObject({ reference_cases: 2, cases_with_output: 0 })
    expect(report.quality.agreement.image_reviewed.coverage).toMatchObject({ value: 0, n: 2 })
  })
})

describe('comparison groups', () => {
  it('must hold the same occasion in every case', () => {
    const references = fixtureReferences('image_review')
    const cases = fixtureCases('image_review').map((benchmarkCase) => (benchmarkCase.id === 'q-views-01' ? { ...benchmarkCase, occasion: 'Wedding Guest' } : benchmarkCase))
    references.references.find((reference) => reference.case_id === 'q-views-01')!.occasion = 'Wedding Guest'
    expect(manifestProblems(references, cases)).toEqual(['Comparison group grp-01: its cases have different occasions. A group holds the same garment for the same occasion'])
  })

  it('count only when they hold cases of two different image modes', () => {
    const cases = fixtureCases('image_review')
    const references = fixtureReferences('image_review')
    // Two single-photo cases in one group are not a comparison between image modes.
    for (const id of ['q-single-05', 'q-single-06']) references.references.find((reference) => reference.case_id === id)!.comparison_group = 'grp-same-mode'
    const report = evaluateRecording(fixtureRecording(cases, 'model'), cases, CURRENT, 'replay', { references })
    expect(report.quality.multi_image.comparison_groups.groups).toBe(4)
    expect(report.quality.multi_image.comparison_groups.details.map((detail) => detail.group)).toEqual(['grp-01', 'grp-02', 'grp-03', 'grp-04'])
  })

  it('are not shaped by an unfinished review', () => {
    const cases = fixtureCases('image_review')
    const references = fixtureReferences('image_review')
    references.references.find((reference) => reference.case_id === 'q-views-01')!.status = 'in_progress'
    const report = evaluateRecording(fixtureRecording(cases, 'model'), cases, CURRENT, 'replay', { references })
    expect(report.quality.multi_image.comparison_groups.details.map((detail) => detail.group)).toEqual(['grp-02', 'grp-03', 'grp-04'])
  })
})

describe('the report does not depend on the order of its inputs', () => {
  it('gives the same bytes when cases, recorded entries and references arrive in another order', () => {
    const cases = fixtureCases('image_review')
    const references = fixtureReferences('image_review')
    const recording = fixtureRecording(cases, 'model', degrade)
    const ordered = evaluateRecording(recording, cases, CURRENT, 'replay', { references })

    const reversed = evaluateRecording(
      { ...recording, entries: [...recording.entries].reverse() },
      [...cases].reverse(),
      CURRENT,
      'replay',
      { references: { ...references, references: [...references.references].reverse() } },
    )
    expect(serializeReport(reversed)).toBe(serializeReport(ordered))
  })
})
