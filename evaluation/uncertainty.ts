/**
 * Evaluation of limitations and uncertainty (Phase 4 Milestone 4).
 *
 * Whether outputs tie what limited the photos to the ratings it weakened,
 * whether they hold back confidence where the observations themselves are
 * uncertain, and how often an explanation does not match the observations or
 * the evidence (the application's consistency flags). Computed from the outputs
 * alone with the production code; none of these figures says whether a rating
 * is right. For a recording made before analysis-output/4 every figure is
 * unavailable: those outputs were never asked to cite limits.
 *
 * The unit is a case: one value per case, the mean over its complete runs.
 */

import type { RawOpenAIDimensions } from '@/types/openai'
import { checkConsistency } from '@/lib/services/consistencyService'
import { IMAGE_LIMITS } from '@/lib/services/openai/observationsSchema'
import { occasionProfile } from '@/lib/constants/occasionProfiles'
import type { BenchmarkCase } from '@/benchmark/harness'
import type { RunDetail } from './metrics'
import { rateMetric, type Metric } from './quality'
import { inspectRun } from './visualEvidence'
import { UNAVAILABLE_BEFORE_PHASE4 } from './multiImageReasoning'

type CompleteRun = RunDetail & { dimensions: RawOpenAIDimensions }

export interface UncertaintyReport {
  applicable: boolean
  reason?: string
  /** Runs whose observations report a limit: share where some rating's evidence cites a limit (ties it to the rating it weakened). */
  limit_linked_rate: Metric
  /** Runs with a colour reported uncertain or not visible: share whose colour rating is below High confidence or Unable to Evaluate. */
  uncertain_colour_restraint_rate: Metric
  /** Runs where no garment could be identified: share that rate neither occasion fit nor formality with High confidence. */
  unidentified_garment_restraint_rate: Metric
  /** Share of runs with at least one consistency flag (an explanation that does not match observations or evidence). */
  consistency_flag_rate: Metric
}

const KEYS = ['limit_linked_rate', 'uncertain_colour_restraint_rate', 'unidentified_garment_restraint_rate', 'consistency_flag_rate'] as const
export const UNCERTAINTY_LOWER_IS_BETTER = new Set<string>(['consistency_flag_rate'])

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function unavailable(reason: string): Metric {
  return { status: 'unavailable', reason, value: null, n: 0, se: null }
}

function perCase(cases: BenchmarkCase[], runsByCase: Map<string, CompleteRun[]>, value: (benchmarkCase: BenchmarkCase, run: CompleteRun) => number | null, reason: string): Metric {
  const values: number[] = []
  for (const benchmarkCase of cases) {
    const runValues = (runsByCase.get(benchmarkCase.id) ?? []).map((run) => value(benchmarkCase, run)).filter((entry): entry is number => entry !== null)
    if (runValues.length > 0) values.push(mean(runValues))
  }
  return rateMetric(values, reason)
}

const LIMIT_CITE = new RegExp(`^g[1-3]\\.(${IMAGE_LIMITS.join('|')})$`)

/** The consistency flags the application would raise for one run, from its validated blocks. */
export function runConsistencyFlags(benchmarkCase: BenchmarkCase, run: CompleteRun): string[] {
  const inspection = inspectRun(benchmarkCase, run)
  return checkConsistency({
    dimensions: run.dimensions,
    observations: inspection.validObservations ?? undefined,
    evidence: inspection.validEvidence,
    occasion: occasionProfile(benchmarkCase.occasion) ? benchmarkCase.occasion : undefined,
  }).map((flag) => flag.code)
}

export function uncertaintyOf(cases: BenchmarkCase[], runsByCase: Map<string, RunDetail[]>, applies: boolean): UncertaintyReport {
  if (!applies) return { applicable: false, reason: UNAVAILABLE_BEFORE_PHASE4, ...Object.fromEntries(KEYS.map((key) => [key, unavailable(UNAVAILABLE_BEFORE_PHASE4)])) } as UncertaintyReport
  const complete = new Map<string, CompleteRun[]>()
  for (const [caseId, runs] of runsByCase) complete.set(caseId, runs.filter((run): run is CompleteRun => run.outcome === 'complete' && run.dimensions !== undefined))

  return {
    applicable: true,
    limit_linked_rate: perCase(cases, complete, (benchmarkCase, run) => {
      const inspection = inspectRun(benchmarkCase, run)
      if (!inspection.validObservations || !inspection.validObservations.images.some((entry) => entry.limits.length > 0 && !entry.limits.every((limit) => limit === 'image_text'))) return null
      return Object.values(inspection.validEvidence.dimensions).some((evidence) => evidence?.cites.some((cite) => LIMIT_CITE.test(cite))) ? 1 : 0
    }, 'Unavailable: no run with valid observations that report a limit'),
    uncertain_colour_restraint_rate: perCase(cases, complete, (benchmarkCase, run) => {
      const observations = inspectRun(benchmarkCase, run).validObservations
      if (!observations || !observations.images.some((entry) => entry.colour_status !== 'observed')) return null
      const color = run.dimensions.color
      return color.rating === 'Unable to Evaluate' || color.confidence !== 'High' ? 1 : 0
    }, 'Unavailable: no run with an uncertain or hidden colour'),
    unidentified_garment_restraint_rate: perCase(cases, complete, (benchmarkCase, run) => {
      const observations = inspectRun(benchmarkCase, run).validObservations
      if (!observations || !observations.images.every((entry) => entry.identification === 'not_visible')) return null
      const confident = (['occasion', 'formality'] as const).some((key) => run.dimensions[key].rating !== 'Unable to Evaluate' && run.dimensions[key].confidence === 'High')
      return confident ? 0 : 1
    }, 'Unavailable: no run in which no garment could be identified'),
    // A run with neither valid observations nor valid evidence gets no consistency check in the application either; it is left out, never counted as clean.
    consistency_flag_rate: perCase(cases, complete, (benchmarkCase, run) => {
      const inspection = inspectRun(benchmarkCase, run)
      if (!inspection.validObservations && inspection.validEvidence.availability === 'unavailable') return null
      return runConsistencyFlags(benchmarkCase, run).length > 0 ? 1 : 0
    }, 'Unavailable: no complete run with observations or evidence'),
  }
}

export function uncertaintyMetrics(report: UncertaintyReport): Array<{ name: string; metric: Metric; lowerIsBetter: boolean }> {
  return KEYS.map((key) => ({ name: `uncertainty.${key}`, metric: report[key], lowerIsBetter: UNCERTAINTY_LOWER_IS_BETTER.has(key) }))
}
