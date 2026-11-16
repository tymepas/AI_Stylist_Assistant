/**
 * Evaluation metrics over the runs of a recording.
 *
 * The metrics are grouped by what they can tell you:
 * - `structured_output`, `stability`, `confidence`, `abstention`, `screening`:
 *   properties of the MODEL's output.
 * - `application`: properties of Verdict's own deterministic code.
 * - `verdict_band`, `adversarial`: END-TO-END results (model ratings turned into a
 *   band by the application), judged against human expectations.
 *
 * Every rate is null when there is nothing to measure, never 0.
 */

import type { RawOpenAIConfidence, RawOpenAIRating } from '@/types/openai'
import { buildCompleteAnalysisResult } from '@/lib/services/analysisResultService'
import { DIMENSION_KEYS, type Band, type BenchmarkCase, type DimensionKey } from '@/benchmark/harness'
import type { RawOpenAIDimensions } from '@/types/openai'

export interface RunDetail {
  case_id: string
  run: number
  outcome: 'complete' | 'unable_to_analyze' | 'error' | 'withheld'
  error_code?: string
  band?: Band
  score?: number
  dimensions?: RawOpenAIDimensions
  prohibited_hits: string[]
  forbidden_claim_hits: string[]
}

const CONFIDENCE_LEVELS: readonly RawOpenAIConfidence[] = ['High', 'Medium', 'Low']
type PerConfidence<T> = Record<RawOpenAIConfidence, T>

export interface EvaluationMetrics {
  runs: number
  cases: number
  withheld_runs: number
  structured_output: {
    valid_rate: number | null
    invalid_runs: number
    error_codes: Record<string, number>
  }
  verdict_band: {
    graded_runs: number
    agreement_rate: number | null
  }
  abstention: {
    expected_runs: number
    abstained_runs: number
    precision: number | null
    recall: number | null
    false_abstention_rate: number | null
  }
  stability: {
    cases_with_repeats: number
    same_outcome_case_rate: number | null
    band_flip_case_rate: number | null
    dimension_rating_agreement_rate: number | null
    mean_score_range: number | null
  }
  confidence: {
    distribution: PerConfidence<number>
    /** Label-free: how often a dimension gets the same rating on every run, by the confidence the model stated. */
    stability_by_confidence: PerConfidence<{ pairs: number; stable_rate: number | null }>
    /** Needs verified `expected.dimension_ratings`: how often a rating is acceptable, by stated confidence. */
    accuracy_by_confidence: PerConfidence<{ ratings: number; correct_rate: number | null }>
  }
  adversarial: {
    graded_runs: number
    runs_outside_acceptable_bands: number
    twin_pairs: number
    twin_outcome_change_rate: number | null
  }
  screening: {
    runs_with_prohibited_hits: number
    runs_with_forbidden_claims: number
  }
  attribute_accuracy: {
    status: 'not_available'
    reason: string
  }
  application: {
    /** The verdict recomputed from the same ratings always equals the first computation. */
    verdict_recomputation_matches: boolean
  }
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

function rate(part: number, whole: number): number | null {
  return whole === 0 ? null : round(part / whole)
}

/** One word for what a run produced: a band, `abstain` or `error`. */
export function outcomeSignature(detail: RunDetail): string {
  if (detail.outcome === 'complete') return detail.band ?? 'error'
  if (detail.outcome === 'unable_to_analyze') return 'abstain'
  return 'error'
}

/** The most frequent value; ties go to the value seen first. */
function modal<T>(values: T[]): T | undefined {
  const counts = new Map<T, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  let best: T | undefined
  let bestCount = 0
  for (const [value, count] of counts) if (count > bestCount) { best = value; bestCount = count }
  return best
}

export function modalOutcome(details: RunDetail[]): string | undefined {
  return modal(details.filter((detail) => detail.outcome !== 'withheld').map(outcomeSignature))
}

function perConfidence<T>(make: () => T): PerConfidence<T> {
  return { High: make(), Medium: make(), Low: make() }
}

/** With several runs, the confidence a dimension is filed under: the modal one, and the lowest on a tie. */
function representativeConfidence(levels: RawOpenAIConfidence[]): RawOpenAIConfidence {
  const counts = perConfidence(() => 0)
  for (const level of levels) counts[level] += 1
  const top = Math.max(...CONFIDENCE_LEVELS.map((level) => counts[level]))
  return [...CONFIDENCE_LEVELS].reverse().find((level) => counts[level] === top) as RawOpenAIConfidence
}

export function computeMetrics(details: RunDetail[], cases: BenchmarkCase[]): EvaluationMetrics {
  const byCase = new Map(cases.map((benchmarkCase) => [benchmarkCase.id, benchmarkCase]))
  const scored = details.filter((detail) => detail.outcome !== 'withheld')
  const complete = scored.filter((detail) => detail.outcome === 'complete')
  const abstained = scored.filter((detail) => detail.outcome === 'unable_to_analyze')
  const errors = scored.filter((detail) => detail.outcome === 'error')

  const runsByCase = new Map<string, RunDetail[]>()
  for (const detail of scored) runsByCase.set(detail.case_id, [...(runsByCase.get(detail.case_id) ?? []), detail])

  // --- structured output ---------------------------------------------------
  const errorCodes: Record<string, number> = {}
  for (const detail of errors) {
    const code = detail.error_code ?? 'unknown'
    errorCodes[code] = (errorCodes[code] ?? 0) + 1
  }

  // --- verdict band (end to end) ------------------------------------------
  const graded = complete.filter((detail) => (byCase.get(detail.case_id)?.expected.acceptable_bands.length ?? 0) > 0)
  const agreeing = graded.filter((detail) => byCase.get(detail.case_id)!.expected.acceptable_bands.includes(detail.band as Band))

  // --- abstention ----------------------------------------------------------
  const shouldAbstain = scored.filter((detail) => byCase.get(detail.case_id)?.expected.should_abstain)
  const shouldNotAbstain = scored.filter((detail) => !byCase.get(detail.case_id)?.expected.should_abstain)
  const truePositives = abstained.filter((detail) => byCase.get(detail.case_id)?.expected.should_abstain)

  // --- stability across repeated runs -------------------------------------
  const repeated = [...runsByCase.values()].filter((runs) => runs.length >= 2)
  const sameOutcome = repeated.filter((runs) => runs.every((run) => run.outcome !== 'error') && new Set(runs.map(outcomeSignature)).size === 1)
  const bandFlips = repeated.filter((runs) => new Set(runs.filter((run) => run.outcome === 'complete').map((run) => run.band)).size > 1)

  let dimensionPairs = 0
  let stablePairs = 0
  const scoreRanges: number[] = []
  const stability = perConfidence(() => ({ pairs: 0, stable: 0 }))
  for (const runs of repeated) {
    const completeRuns = runs.filter((run) => run.outcome === 'complete' && run.dimensions)
    if (completeRuns.length < 2) continue
    const scores = completeRuns.map((run) => run.score ?? 0)
    scoreRanges.push(Math.max(...scores) - Math.min(...scores))
    for (const key of DIMENSION_KEYS) {
      const ratings = completeRuns.map((run) => run.dimensions![key].rating)
      const stable = new Set(ratings).size === 1
      dimensionPairs += 1
      if (stable) stablePairs += 1
      const level = representativeConfidence(completeRuns.map((run) => run.dimensions![key].confidence))
      stability[level].pairs += 1
      if (stable) stability[level].stable += 1
    }
  }

  // --- confidence ----------------------------------------------------------
  const distribution = perConfidence(() => 0)
  const accuracy = perConfidence(() => ({ ratings: 0, correct: 0 }))
  for (const detail of complete) {
    if (!detail.dimensions) continue
    const benchmarkCase = byCase.get(detail.case_id)
    const acceptable = benchmarkCase?.labels?.verified ? benchmarkCase.expected.dimension_ratings : undefined
    for (const key of DIMENSION_KEYS) {
      const { rating, confidence } = detail.dimensions[key]
      distribution[confidence] += 1
      const allowed = acceptable?.[key as DimensionKey] as RawOpenAIRating[] | undefined
      if (!allowed) continue
      accuracy[confidence].ratings += 1
      if (allowed.includes(rating)) accuracy[confidence].correct += 1
    }
  }

  // --- adversarial ---------------------------------------------------------
  const adversarialGraded = graded.filter((detail) => byCase.get(detail.case_id)?.category === 'adversarial_text')
  const outside = adversarialGraded.filter((detail) => !byCase.get(detail.case_id)!.expected.acceptable_bands.includes(detail.band as Band))
  let twinPairs = 0
  let twinChanges = 0
  for (const benchmarkCase of cases) {
    if (!benchmarkCase.twin_of) continue
    const own = modalOutcome(runsByCase.get(benchmarkCase.id) ?? [])
    const twin = modalOutcome(runsByCase.get(benchmarkCase.twin_of) ?? [])
    if (own === undefined || twin === undefined) continue
    twinPairs += 1
    if (own !== twin) twinChanges += 1
  }

  // --- application determinism --------------------------------------------
  const recomputationMatches = complete.every((detail) => {
    if (!detail.dimensions) return true
    const again = buildCompleteAnalysisResult(detail.dimensions)
    return again.overall_recommendation === detail.band && again.verdict_score === detail.score
  })

  return {
    runs: scored.length,
    cases: runsByCase.size,
    withheld_runs: details.length - scored.length,
    structured_output: {
      valid_rate: rate(scored.length - errors.length, scored.length),
      invalid_runs: errors.length,
      error_codes: errorCodes,
    },
    verdict_band: {
      graded_runs: graded.length,
      agreement_rate: rate(agreeing.length, graded.length),
    },
    abstention: {
      expected_runs: shouldAbstain.length,
      abstained_runs: abstained.length,
      precision: rate(truePositives.length, abstained.length),
      recall: rate(truePositives.length, shouldAbstain.length),
      false_abstention_rate: rate(abstained.length - truePositives.length, shouldNotAbstain.length),
    },
    stability: {
      cases_with_repeats: repeated.length,
      same_outcome_case_rate: rate(sameOutcome.length, repeated.length),
      band_flip_case_rate: rate(bandFlips.length, repeated.length),
      dimension_rating_agreement_rate: rate(stablePairs, dimensionPairs),
      mean_score_range: scoreRanges.length === 0 ? null : round(scoreRanges.reduce((sum, value) => sum + value, 0) / scoreRanges.length),
    },
    confidence: {
      distribution,
      stability_by_confidence: {
        High: { pairs: stability.High.pairs, stable_rate: rate(stability.High.stable, stability.High.pairs) },
        Medium: { pairs: stability.Medium.pairs, stable_rate: rate(stability.Medium.stable, stability.Medium.pairs) },
        Low: { pairs: stability.Low.pairs, stable_rate: rate(stability.Low.stable, stability.Low.pairs) },
      },
      accuracy_by_confidence: {
        High: { ratings: accuracy.High.ratings, correct_rate: rate(accuracy.High.correct, accuracy.High.ratings) },
        Medium: { ratings: accuracy.Medium.ratings, correct_rate: rate(accuracy.Medium.correct, accuracy.Medium.ratings) },
        Low: { ratings: accuracy.Low.ratings, correct_rate: rate(accuracy.Low.correct, accuracy.Low.ratings) },
      },
    },
    adversarial: {
      graded_runs: adversarialGraded.length,
      runs_outside_acceptable_bands: outside.length,
      twin_pairs: twinPairs,
      twin_outcome_change_rate: rate(twinChanges, twinPairs),
    },
    screening: {
      runs_with_prohibited_hits: scored.filter((detail) => detail.prohibited_hits.length > 0).length,
      runs_with_forbidden_claims: scored.filter((detail) => detail.forbidden_claim_hits.length > 0).length,
    },
    attribute_accuracy: {
      status: 'not_available',
      reason: 'The model output has no garment, colour or pattern fields, so recognition cannot be scored against labels yet.',
    },
    application: {
      verdict_recomputation_matches: recomputationMatches,
    },
  }
}
