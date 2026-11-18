/**
 * Reads evaluation inputs from disk and runs an evaluation. File access only;
 * no network.
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { manifestSchema, type BenchmarkCase } from '@/benchmark/harness'
import { evaluateRecording, type CurrentVersions, type EvaluationMode, type EvaluationOptions, type EvaluationReport } from './evaluate'
import { recordingSchema, type Recording } from './recording'
import { ReferenceSetError, futureDatedProblems, parseReferenceSet, type ReferenceSet } from './reference'

export const MOCK_FIXTURE_DIR = path.join('evaluation', 'fixtures', 'mock')

export function loadCases(file: string): BenchmarkCase[] {
  return manifestSchema.parse(JSON.parse(readFileSync(file, 'utf8'))).cases
}

export function loadRecording(file: string): Recording {
  return recordingSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
}

/** Checks that need something from outside the reference file. Each is applied when its input is given. */
export interface ReferenceChecks {
  /** Today as YYYY-MM-DD. A review dated later than this is refused. */
  today?: string
  /** Where the reviewed images are. Each image is compared with its recorded SHA-256. */
  imagesDir?: string
}

/**
 * Reads a reference set and checks it against the manifest it belongs to, and
 * against the clock and the image files when those are supplied. Throws a
 * ReferenceSetError that lists every problem: an invalid reference is never
 * skipped quietly, because a skipped reference would look like a missing one.
 *
 * The validator command and an evaluation use this same function, so a set
 * that the validator refuses is never scored.
 */
export function loadReferenceSet(file: string, cases: BenchmarkCase[], checks: ReferenceChecks = {}): ReferenceSet {
  const set = parseReferenceSet(JSON.parse(readFileSync(file, 'utf8')), cases)
  const problems = [
    ...(checks.today ? futureDatedProblems(set, checks.today) : []),
    ...(checks.imagesDir ? referenceImageProblems(set, checks.imagesDir) : []),
  ]
  if (problems.length > 0) throw new ReferenceSetError(problems)
  return set
}

/**
 * Compares the recorded SHA-256 of every referenced image with the file in
 * `imageDir`. Returns one line per image that is missing or has changed since
 * it was reviewed. Images are read only to be hashed; nothing is sent anywhere.
 */
export function referenceImageProblems(set: ReferenceSet, imageDir: string): string[] {
  const problems: string[] = []
  for (const reference of set.references) {
    for (const image of reference.images) {
      if (image.sha256 === undefined) continue
      const file = path.join(imageDir, image.path)
      if (!existsSync(file)) {
        problems.push(`Reference ${reference.case_id}: image "${image.id}" is not in the image directory`)
        continue
      }
      const actual = createHash('sha256').update(readFileSync(file)).digest('hex')
      if (actual !== image.sha256) problems.push(`Reference ${reference.case_id}: image "${image.id}" is not the file that was reviewed (its SHA-256 differs)`)
    }
  }
  return problems
}

export function evaluateFiles(input: { casesPath: string; recordingPath: string; referencesPath?: string | null; referenceChecks?: ReferenceChecks; current: CurrentVersions; mode: EvaluationMode; options?: EvaluationOptions }): EvaluationReport {
  const cases = loadCases(input.casesPath)
  const references = input.referencesPath ? loadReferenceSet(input.referencesPath, cases, input.referenceChecks) : undefined
  return evaluateRecording(loadRecording(input.recordingPath), cases, input.current, input.mode, { ...input.options, references })
}

/** The committed mock fixtures, relative to the repository root. */
export function mockFixturePaths(root: string): { casesPath: string; recordingPath: string; referencesPath: string; expectedReportPath: string } {
  const dir = path.join(root, MOCK_FIXTURE_DIR)
  return {
    casesPath: path.join(dir, 'cases.json'),
    recordingPath: path.join(dir, 'recording.json'),
    referencesPath: path.join(dir, 'references.json'),
    expectedReportPath: path.join(dir, 'report.expected.json'),
  }
}

/**
 * The committed datasets the evaluation command can run without any input file.
 *
 * - `selftest`: nine hand-written fixtures, several of them wrong on purpose,
 *   with a few synthetic references. They exercise the harness; their expected
 *   report is a snapshot, not a baseline.
 * - `scenarios-v1`: synthetic fashion scenarios with reference outputs. Its
 *   committed baseline is what regressions are measured against. It has no
 *   reference set: its outputs ARE the expectations, so scoring them against
 *   themselves would measure nothing.
 *
 * - `scenarios-v2`: every case of `scenarios-v1`, unchanged, plus cases that
 *   bring each garment mode to at least ten and add synthetic Style DNA. It has
 *   its own baseline; `scenarios-v1` and its baseline are kept as they were.
 *
 * - `scenarios-v3`: synthetic cases for observations and rating evidence
 *   (analysis-output/3), with a SYNTHETIC reference set for their garment facts
 *   (never a human review). Its own baseline; v1 and v2 are unchanged.
 *
 * - `scenarios-v4`: synthetic cases for Phase 4 Milestones 2 to 4 (analysis-output/4): every
 *   occasion of the catalogue, contrasting occasions, multi-view and outfit reasoning, limitations.
 *   Its own baseline; v1 to v3 are unchanged.
 *
 * The golden dataset (`evaluation/datasets/golden-v1/`) is not listed here. It
 * holds real images and real model outputs, so it is always evaluated by
 * replaying a recording (see evaluation/HUMAN_REVIEW.md).
 */
export const DATASETS = {
  selftest: { dir: MOCK_FIXTURE_DIR, baseline: null, references: true },
  'scenarios-v1': { dir: path.join('evaluation', 'datasets', 'scenarios-v1'), baseline: path.join('evaluation', 'baselines', 'scenarios-v1.json'), references: false },
  'scenarios-v2': { dir: path.join('evaluation', 'datasets', 'scenarios-v2'), baseline: path.join('evaluation', 'baselines', 'scenarios-v2.json'), references: false },
  'scenarios-v3': { dir: path.join('evaluation', 'datasets', 'scenarios-v3'), baseline: path.join('evaluation', 'baselines', 'scenarios-v3.json'), references: true },
  'scenarios-v4': { dir: path.join('evaluation', 'datasets', 'scenarios-v4'), baseline: path.join('evaluation', 'baselines', 'scenarios-v4.json'), references: true },
} as const

export type DatasetId = keyof typeof DATASETS

export function isDatasetId(value: string): value is DatasetId {
  return Object.prototype.hasOwnProperty.call(DATASETS, value)
}

export function datasetPaths(root: string, id: DatasetId): { casesPath: string; recordingPath: string; referencesPath: string | null; baselinePath: string | null } {
  const dataset = DATASETS[id]
  return {
    casesPath: path.join(root, dataset.dir, 'cases.json'),
    recordingPath: path.join(root, dataset.dir, 'recording.json'),
    referencesPath: dataset.references ? path.join(root, dataset.dir, 'references.json') : null,
    baselinePath: dataset.baseline === null ? null : path.join(root, dataset.baseline),
  }
}

/** A report written earlier (a baseline, or a report to compare against). No validation beyond JSON. */
export function loadReport(file: string): EvaluationReport {
  return JSON.parse(readFileSync(file, 'utf8')) as EvaluationReport
}
