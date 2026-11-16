/**
 * Reads evaluation inputs from disk and runs an evaluation. File access only;
 * no network.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { manifestSchema, type BenchmarkCase } from '@/benchmark/harness'
import { evaluateRecording, type CurrentVersions, type EvaluationMode, type EvaluationReport } from './evaluate'
import { recordingSchema, type Recording } from './recording'

export const MOCK_FIXTURE_DIR = path.join('evaluation', 'fixtures', 'mock')

export function loadCases(file: string): BenchmarkCase[] {
  return manifestSchema.parse(JSON.parse(readFileSync(file, 'utf8'))).cases
}

export function loadRecording(file: string): Recording {
  return recordingSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
}

export function evaluateFiles(input: { casesPath: string; recordingPath: string; current: CurrentVersions; mode: EvaluationMode }): EvaluationReport {
  return evaluateRecording(loadRecording(input.recordingPath), loadCases(input.casesPath), input.current, input.mode)
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
