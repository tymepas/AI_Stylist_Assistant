/**
 * Reads evaluation inputs from disk and runs an evaluation. File access only;
 * no network.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { manifestSchema, type BenchmarkCase } from '@/benchmark/harness'
import { evaluateRecording, type CurrentVersions, type EvaluationMode, type EvaluationOptions, type EvaluationReport } from './evaluate'
import { recordingSchema, type Recording } from './recording'

export const MOCK_FIXTURE_DIR = path.join('evaluation', 'fixtures', 'mock')

export function loadCases(file: string): BenchmarkCase[] {
  return manifestSchema.parse(JSON.parse(readFileSync(file, 'utf8'))).cases
}

export function loadRecording(file: string): Recording {
  return recordingSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
}

export function evaluateFiles(input: { casesPath: string; recordingPath: string; current: CurrentVersions; mode: EvaluationMode; options?: EvaluationOptions }): EvaluationReport {
  return evaluateRecording(loadRecording(input.recordingPath), loadCases(input.casesPath), input.current, input.mode, input.options)
}

/** The committed mock fixtures, relative to the repository root. */
export function mockFixturePaths(root: string): { casesPath: string; recordingPath: string; expectedReportPath: string } {
  const dir = path.join(root, MOCK_FIXTURE_DIR)
  return {
    casesPath: path.join(dir, 'cases.json'),
    recordingPath: path.join(dir, 'recording.json'),
    expectedReportPath: path.join(dir, 'report.expected.json'),
  }
}

/**
 * The committed datasets the evaluation command can run without any input file.
 *
 * - `selftest`: nine hand-written fixtures, several of them wrong on purpose.
 *   They exercise the harness; their expected report is a snapshot, not a baseline.
 * - `scenarios-v1`: synthetic fashion scenarios with reference outputs. Its
 *   committed baseline is what regressions are measured against.
 */
export const DATASETS = {
  selftest: { dir: MOCK_FIXTURE_DIR, baseline: null },
  'scenarios-v1': { dir: path.join('evaluation', 'datasets', 'scenarios-v1'), baseline: path.join('evaluation', 'baselines', 'scenarios-v1.json') },
} as const

export type DatasetId = keyof typeof DATASETS

export function isDatasetId(value: string): value is DatasetId {
  return Object.prototype.hasOwnProperty.call(DATASETS, value)
}

export function datasetPaths(root: string, id: DatasetId): { casesPath: string; recordingPath: string; baselinePath: string | null } {
  const dataset = DATASETS[id]
  return {
    casesPath: path.join(root, dataset.dir, 'cases.json'),
    recordingPath: path.join(root, dataset.dir, 'recording.json'),
    baselinePath: dataset.baseline === null ? null : path.join(root, dataset.baseline),
  }
}

/** A report written earlier (a baseline, or a report to compare against). No validation beyond JSON. */
export function loadReport(file: string): EvaluationReport {
  return JSON.parse(readFileSync(file, 'utf8')) as EvaluationReport
}
