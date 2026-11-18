/**
 * Evaluation of occasion intelligence (Phase 4 Milestone 2).
 *
 * The analysis prompt now carries an application-owned profile of the occasion
 * and rules about how to use it (lib/constants/occasionProfiles.ts,
 * memory/SYSTEM_PROMPT.md). These figures describe whether outputs follow those
 * rules. Every one is computed from the ratings, reasons and evidence of the
 * outputs and from the application's own catalogue; none needs a reference, so
 * none is a measure of whether a rating is RIGHT. Several are PROXIES (word
 * matching) and say so.
 *
 * A recording made with a schema from before these rules existed
 * (analysis-output/3 or earlier) was never given them, so every figure here is
 * unavailable for it rather than counting its outputs as rule breaks.
 *
 * The unit is a case (one value per case: the share of its complete runs), or a
 * group of cases for the sensitivity figure. Nothing here computes a verdict or
 * calls a model.
 */

import type { RawOpenAIDimensions } from '@/types/openai'
import { FORMALITY_LEVELS, occasionProfile, type OccasionProfile } from '@/lib/constants/occasionProfiles'
import { hasStylePreferences } from '@/lib/services/visualEvidenceService'
import type { BenchmarkCase } from '@/benchmark/harness'
import type { RunDetail } from './metrics'
import { normaliseText, rateMetric, type Metric } from './quality'
import { inspectRun } from './visualEvidence'

export const UNAVAILABLE_BEFORE_OCCASION_RULES = 'Unavailable: the recording was made with an output schema from before occasion profiles and their rules existed (analysis-output/4)'

type CompleteRun = RunDetail & { dimensions: RawOpenAIDimensions }

/**
 * Names of cultures, religions, places of worship and regions. An occasion
 * explanation that uses one assumes a convention the user did not state,
 * unless the occasion's own name contains it. A PROXY: a word list.
 */
export const ASSUMPTION_TERMS = [
  'church', 'temple', 'mosque', 'synagogue', 'gurdwara', 'chapel', 'cathedral',
  'hindu', 'muslim', 'islamic', 'christian', 'catholic', 'jewish', 'sikh', 'buddhist',
  'western', 'eastern', 'indian', 'asian', 'african', 'european', 'american', 'middle eastern', 'south asian',
] as const

const STOPWORDS = new Set(['with', 'from', 'that', 'this', 'pieces', 'often', 'event', 'usually', 'about', 'their', 'into', 'more', 'less'])

export interface OccasionReport {
  applicable: boolean
  reason?: string
  /** Cases whose occasion is not in the catalogue. The API refuses such an occasion; a manifest may still carry one. */
  cases_without_profile: string[]
  /** Per case: share of runs whose occasion evidence names the occasion as a source (needs valid evidence). */
  occasion_evidence_context_rate: Metric
  /** PROXY. Per case: share of runs whose occasion reason uses a word of the occasion name or its profile. */
  occasion_reason_relevance_rate: Metric
  /** Per case: share of runs rating formality Poor while rating occasion fit Excellent: the formality level contradicts the fit. */
  formality_occasion_conflict_rate: Metric
  /** PROXY. Per case: share of runs whose occasion explanation names a culture, religion or region the occasion does not. */
  unsupported_assumption_rate: Metric
  /** Per case with no season in its occasion profile: share of runs rating seasonality with High confidence, which the rules cap at Medium. */
  seasonality_overconfidence_rate: Metric
  /** Per case with neither style preferences nor Style DNA: share of runs that still rate style_preference_match instead of Unable to Evaluate. */
  preference_without_input_rate: Metric
  /** Per group of cases with the same garment brief and occasions whose formality ranges do not overlap: share of groups whose occasion ratings differ. */
  occasion_sensitivity_rate: Metric
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function words(text: string): string[] {
  return normaliseText(text).split(' ').filter((word) => word.length >= 4 && !STOPWORDS.has(word))
}

function profileTerms(benchmarkCase: BenchmarkCase, profile: OccasionProfile | null): Set<string> {
  return new Set([...words(benchmarkCase.occasion), ...(profile ? [...words(profile.setting), ...words(profile.suits), ...profile.formality.flatMap(words)] : [])])
}

function rank(level: string): number {
  return (FORMALITY_LEVELS as readonly string[]).indexOf(level)
}

/** True when two profiles' formality ranges share no level. */
export function contrasting(a: OccasionProfile, b: OccasionProfile): boolean {
  return rank(a.formality[1]) < rank(b.formality[0]) || rank(b.formality[1]) < rank(a.formality[0])
}

function perCase(cases: BenchmarkCase[], runsByCase: Map<string, CompleteRun[]>, value: (benchmarkCase: BenchmarkCase, run: CompleteRun) => number | null, reason: string): Metric {
  const values: number[] = []
  for (const benchmarkCase of cases) {
    const runValues = (runsByCase.get(benchmarkCase.id) ?? []).map((run) => value(benchmarkCase, run)).filter((entry): entry is number => entry !== null)
    if (runValues.length > 0) values.push(mean(runValues))
  }
  return rateMetric(values, reason)
}

function unavailable(reason: string): Metric {
  return { status: 'unavailable', reason, value: null, n: 0, se: null }
}

const METRIC_KEYS = [
  'occasion_evidence_context_rate',
  'occasion_reason_relevance_rate',
  'formality_occasion_conflict_rate',
  'unsupported_assumption_rate',
  'seasonality_overconfidence_rate',
  'preference_without_input_rate',
  'occasion_sensitivity_rate',
] as const

export const OCCASION_LOWER_IS_BETTER = new Set<string>(['formality_occasion_conflict_rate', 'unsupported_assumption_rate', 'seasonality_overconfidence_rate', 'preference_without_input_rate'])

export function occasionOf(cases: BenchmarkCase[], runsByCase: Map<string, RunDetail[]>, rulesApply: boolean): OccasionReport {
  const withoutProfile = cases.filter((benchmarkCase) => occasionProfile(benchmarkCase.occasion) === null).map((benchmarkCase) => benchmarkCase.id).sort()
  if (!rulesApply) {
    return {
      applicable: false,
      reason: UNAVAILABLE_BEFORE_OCCASION_RULES,
      cases_without_profile: withoutProfile,
      ...Object.fromEntries(METRIC_KEYS.map((key) => [key, unavailable(UNAVAILABLE_BEFORE_OCCASION_RULES)])),
    } as OccasionReport
  }

  const complete = new Map<string, CompleteRun[]>()
  for (const [caseId, runs] of runsByCase) complete.set(caseId, runs.filter((run): run is CompleteRun => run.outcome === 'complete' && run.dimensions !== undefined))
  const profiled = cases.filter((benchmarkCase) => occasionProfile(benchmarkCase.occasion) !== null)

  // --- sensitivity across contrasting occasions -----------------------------------------------------
  const groups = new Map<string, BenchmarkCase[]>()
  for (const benchmarkCase of profiled) if (benchmarkCase.occasion_group) groups.set(benchmarkCase.occasion_group, [...(groups.get(benchmarkCase.occasion_group) ?? []), benchmarkCase])
  const sensitivity: number[] = []
  for (const [, members] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const profiles = members.map((member) => occasionProfile(member.occasion) as OccasionProfile)
    const hasContrast = profiles.some((a, i) => profiles.slice(i + 1).some((b) => contrasting(a, b)))
    const ratings = members.map((member) => complete.get(member.id)?.[0]?.dimensions.occasion.rating).filter((rating): rating is NonNullable<typeof rating> => rating !== undefined)
    if (!hasContrast || ratings.length < 2) continue
    sensitivity.push(new Set(ratings).size > 1 ? 1 : 0)
  }

  return {
    applicable: true,
    cases_without_profile: withoutProfile,
    occasion_evidence_context_rate: perCase(profiled, complete, (benchmarkCase, run) => {
      if (run.dimensions.occasion.rating === 'Unable to Evaluate') return null
      const evidence = inspectRun(benchmarkCase, run).validEvidence.dimensions.occasion
      return evidence ? (evidence.sources.includes('occasion') ? 1 : 0) : null
    }, 'Unavailable: no rated occasion with valid evidence'),
    occasion_reason_relevance_rate: perCase(cases, complete, (benchmarkCase, run) => {
      if (run.dimensions.occasion.rating === 'Unable to Evaluate') return null
      const terms = profileTerms(benchmarkCase, occasionProfile(benchmarkCase.occasion))
      return words(run.dimensions.occasion.reason).some((word) => terms.has(word)) ? 1 : 0
    }, 'Unavailable: no rated occasion'),
    formality_occasion_conflict_rate: perCase(cases, complete, (_benchmarkCase, run) => (run.dimensions.formality.rating === 'Poor' && run.dimensions.occasion.rating === 'Excellent' ? 1 : 0), 'Unavailable: no complete run'),
    unsupported_assumption_rate: perCase(cases, complete, (benchmarkCase, run) => {
      const own = normaliseText(benchmarkCase.occasion)
      const evidence = run.evidence && typeof run.evidence === 'object' ? (run.evidence as Record<string, { missing?: unknown }>).occasion : undefined
      const text = normaliseText(`${run.dimensions.occasion.reason} ${typeof evidence?.missing === 'string' ? evidence.missing : ''}`)
      return ASSUMPTION_TERMS.some((term) => !own.includes(term) && new RegExp(`\\b${term}\\b`).test(text)) ? 1 : 0
    }, 'Unavailable: no complete run'),
    seasonality_overconfidence_rate: perCase(profiled.filter((benchmarkCase) => !occasionProfile(benchmarkCase.occasion)?.season), complete, (_benchmarkCase, run) => {
      if (run.dimensions.seasonality.rating === 'Unable to Evaluate') return null
      return run.dimensions.seasonality.confidence === 'High' ? 1 : 0
    }, 'Unavailable: no rated seasonality for an occasion without a stated season'),
    preference_without_input_rate: perCase(cases.filter((benchmarkCase) => !hasStylePreferences(benchmarkCase.style_profile) && benchmarkCase.style_dna === undefined), complete, (_benchmarkCase, run) => (run.dimensions.style_preference_match.rating === 'Unable to Evaluate' ? 0 : 1), 'Unavailable: no case without preferences and without Style DNA'),
    occasion_sensitivity_rate: rateMetric(sensitivity, 'Unavailable: no group of cases puts one garment brief in occasions with contrasting formality'),
  }
}

/** Every figure of the section under a stable name, for the metric index. */
export function occasionMetrics(report: OccasionReport): Array<{ name: string; metric: Metric; lowerIsBetter: boolean }> {
  return METRIC_KEYS.map((key) => ({ name: `occasion.${key}`, metric: report[key], lowerIsBetter: OCCASION_LOWER_IS_BETTER.has(key) }))
}
