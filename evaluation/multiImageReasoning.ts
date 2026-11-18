/**
 * Evaluation of multi-view and outfit reasoning (Phase 4 Milestone 3).
 *
 * Views of one garment: do outputs explain differences between views, and do
 * they lower confidence when views conflict? Outfit items: do items state how
 * they affect the outfit-level ratings, citing their own observations, without
 * confusing one item for another?
 *
 * Every figure is computed from outputs alone, with the production validators;
 * none needs a reference and none says whether a rating is right. For a
 * recording made before analysis-output/4 every figure is unavailable: those
 * outputs were never asked for view differences or item contributions.
 *
 * The unit is a case: one value per case, the mean over its complete runs.
 */

import type { RawOpenAIDimensions } from '@/types/openai'
import { inspectContributions, parseOutfitComponents } from '@/lib/services/openai/outfitComponentsSchema'
import { DIMENSION_KEYS, type BenchmarkCase } from '@/benchmark/harness'
import type { RunDetail } from './metrics'
import { rateMetric, type Metric } from './quality'
import { inspectRun, visualContextOf } from './visualEvidence'

export const UNAVAILABLE_BEFORE_PHASE4 = 'Unavailable: the recording was made with an output schema from before view differences and item contributions existed (analysis-output/4)'

type CompleteRun = RunDetail & { dimensions: RawOpenAIDimensions }

export interface MultiImageReasoningReport {
  applicable: boolean
  reason?: string
  /** Views cases: share of runs whose views differ in observed dominant colour that explain it (colour_lighting) or do not claim one garment. */
  view_colour_difference_explained_rate: Metric
  /** Views cases: share of runs saying the views are not (clearly) one garment that hold at least one rating below High confidence. */
  view_conflict_confidence_rate: Metric
  /** Outfit cases: share of items with a usable contribution. */
  contribution_coverage_rate: Metric
  /** Outfit cases: share of runs with at least one refused contribution. */
  contribution_problem_rate: Metric
  /** Outfit cases: share of runs where an item's stated type contradicts what its observation identified. */
  identity_mismatch_rate: Metric
  /** Outfit cases: share of runs whose colour evidence cites at least two different items (a colour judgement about the combination). */
  outfit_colour_evidence_breadth_rate: Metric
  /** Outfit cases: share of runs with two items observed as the same garment (same category, name and dominant colours): one item counted twice. */
  duplicate_identity_rate: Metric
}

const KEYS = [
  'view_colour_difference_explained_rate',
  'view_conflict_confidence_rate',
  'contribution_coverage_rate',
  'contribution_problem_rate',
  'identity_mismatch_rate',
  'outfit_colour_evidence_breadth_rate',
  'duplicate_identity_rate',
] as const

export const MULTI_IMAGE_LOWER_IS_BETTER = new Set<string>(['contribution_problem_rate', 'identity_mismatch_rate', 'duplicate_identity_rate'])

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function unavailable(reason: string): Metric {
  return { status: 'unavailable', reason, value: null, n: 0, se: null }
}

function perCase(cases: BenchmarkCase[], runsByCase: Map<string, CompleteRun[]>, mode: 'same_garment_views' | 'outfit_items', value: (benchmarkCase: BenchmarkCase, run: CompleteRun) => number | null, reason: string): Metric {
  const values: number[] = []
  for (const benchmarkCase of cases.filter((entry) => visualContextOf(entry).mode === mode)) {
    const runValues = (runsByCase.get(benchmarkCase.id) ?? []).map((run) => value(benchmarkCase, run)).filter((entry): entry is number => entry !== null)
    if (runValues.length > 0) values.push(mean(runValues))
  }
  return rateMetric(values, reason)
}

function components(benchmarkCase: BenchmarkCase, run: CompleteRun) {
  try {
    return parseOutfitComponents(run.outfit_components, visualContextOf(benchmarkCase).garmentCount)
  } catch {
    return null
  }
}

export function multiImageReasoningOf(cases: BenchmarkCase[], runsByCase: Map<string, RunDetail[]>, applies: boolean): MultiImageReasoningReport {
  if (!applies) {
    return { applicable: false, reason: UNAVAILABLE_BEFORE_PHASE4, ...Object.fromEntries(KEYS.map((key) => [key, unavailable(UNAVAILABLE_BEFORE_PHASE4)])) } as MultiImageReasoningReport
  }
  const complete = new Map<string, CompleteRun[]>()
  for (const [caseId, runs] of runsByCase) complete.set(caseId, runs.filter((run): run is CompleteRun => run.outcome === 'complete' && run.dimensions !== undefined))

  return {
    applicable: true,
    view_colour_difference_explained_rate: perCase(cases, complete, 'same_garment_views', (benchmarkCase, run) => {
      const observations = inspectRun(benchmarkCase, run).validObservations
      if (!observations?.views) return null
      const seen = observations.images.filter((entry) => entry.colour_status === 'observed').map((entry) => [...entry.colours.dominant].sort().join('+'))
      if (new Set(seen).size < 2) return null
      return observations.views.same_garment !== 'yes' || (observations.views.differences ?? []).includes('colour_lighting') ? 1 : 0
    }, 'Unavailable: no views run whose views differ in observed colour'),
    view_conflict_confidence_rate: perCase(cases, complete, 'same_garment_views', (benchmarkCase, run) => {
      const views = inspectRun(benchmarkCase, run).validObservations?.views
      if (!views || views.same_garment === 'yes') return null
      return DIMENSION_KEYS.some((key) => run.dimensions[key].rating !== 'Unable to Evaluate' && run.dimensions[key].confidence !== 'High') ? 1 : 0
    }, 'Unavailable: no views run that reports views in conflict'),
    contribution_coverage_rate: perCase(cases, complete, 'outfit_items', (benchmarkCase, run) => {
      const parsed = components(benchmarkCase, run)
      if (!parsed) return null
      return inspectContributions(parsed, inspectRun(benchmarkCase, run).validObservations).contributions.size / parsed.length
    }, 'Unavailable: no outfit run with valid per-item notes'),
    contribution_problem_rate: perCase(cases, complete, 'outfit_items', (benchmarkCase, run) => {
      const parsed = components(benchmarkCase, run)
      if (!parsed) return null
      const inspection = inspectContributions(parsed, inspectRun(benchmarkCase, run).validObservations)
      if (inspection.silent.length === parsed.length) return null
      return inspection.problems.size > 0 ? 1 : 0
    }, 'Unavailable: no outfit run that states item contributions'),
    identity_mismatch_rate: perCase(cases, complete, 'outfit_items', (benchmarkCase, run) => {
      const parsed = components(benchmarkCase, run)
      const observations = inspectRun(benchmarkCase, run).validObservations
      if (!parsed || !observations) return null
      return parsed.some((item) => {
        const observed = observations.images.find((entry) => entry.image === item.item)
        return observed !== undefined && observed.identification === 'observed' && observed.category !== 'unclear' && observed.category !== item.garment_type
      }) ? 1 : 0
    }, 'Unavailable: no outfit run with valid notes and observations'),
    outfit_colour_evidence_breadth_rate: perCase(cases, complete, 'outfit_items', (benchmarkCase, run) => {
      if (run.dimensions.color.rating === 'Unable to Evaluate') return null
      const evidence = inspectRun(benchmarkCase, run).validEvidence.dimensions.color
      if (!evidence) return null
      return new Set(evidence.cites.map((cite) => cite.split('.')[0])).size >= 2 ? 1 : 0
    }, 'Unavailable: no rated outfit colour with valid evidence'),
    duplicate_identity_rate: perCase(cases, complete, 'outfit_items', (benchmarkCase, run) => {
      const observations = inspectRun(benchmarkCase, run).validObservations
      if (!observations) return null
      const keys = observations.images.filter((entry) => entry.identification === 'observed').map((entry) => `${entry.category}|${entry.garment ?? ''}|${[...entry.colours.dominant].sort().join('+')}`)
      return new Set(keys).size < keys.length ? 1 : 0
    }, 'Unavailable: no outfit run with valid observations'),
  }
}

export function multiImageReasoningMetrics(report: MultiImageReasoningReport): Array<{ name: string; metric: Metric; lowerIsBetter: boolean }> {
  return KEYS.map((key) => ({ name: `multi_image_reasoning.${key}`, metric: report[key], lowerIsBetter: MULTI_IMAGE_LOWER_IS_BETTER.has(key) }))
}
