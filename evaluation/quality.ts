/**
 * Quality metrics: how model output compares with references, dimension by
 * dimension, and how far each figure can be trusted.
 *
 * Four different questions are answered here, and they are never merged into
 * one number:
 *
 * 1. AGREEMENT    — does a rating match the reference rating? Per dimension:
 *                   exact agreement, agreement within one band, and the mean
 *                   absolute error in bands.
 * 2. GROUNDING    — does the explanation mention the facts a reviewer listed,
 *                   contradict them, or state details that cannot be seen?
 *                   A PROXY: it matches words, it does not understand text.
 * 3. CALIBRATION  — is a rating more often right when the model says it is
 *                   confident?
 * 4. MULTI-IMAGE  — do the three garment modes behave differently, and are the
 *                   per-item notes of an outfit complete and correct?
 *
 * Two further sections say how far the figures above can be leaned on:
 *
 * 5. REVIEWERS    — where a case was rated by two people, how often do THEY
 *                   agree? A rating is a judgement, not a fact. Agreement
 *                   between a model and one reviewer cannot mean more than
 *                   agreement between two reviewers does.
 * 6. ADVISOR      — with a Style DNA profile, is the advisory block usable?
 *                   Without one, is it left empty as instructed?
 *
 * STYLE DNA IS A CONDITION ON A CASE, NOT A GARMENT MODE. A profile changes
 * what the model is told, so a figure that combines cases with and without one
 * mixes two conditions. Such figures are never mixed silently:
 * - every figure that combines both conditions is labelled as POOLED;
 * - next to it, the same figure is computed for each condition on its own,
 *   wherever that condition has at least MIN_SAMPLE cases behind the figure;
 * - where it has fewer, the separate figure is `unavailable`, with the reason.
 *   It is not shown as a value that "may not be concluded from": a number
 *   from four cases of one condition, next to a pooled number from twelve,
 *   invites exactly the comparison it cannot support.
 *
 * Every figure is reported once per reference TIER (see reference.ts). Only the
 * `image_reviewed` tier is evidence about accuracy on real images, and only
 * when the outputs came from a model. Without such references that tier reads
 * "Unavailable: insufficient human-reviewed ground truth". It never reads 0.
 *
 * THE UNIT IS ALWAYS A CASE (or, for the comparison-group figures, a group).
 * A case contributes one value to a figure, however many runs, dimensions or
 * outfit items stand behind it: the share of them that agree. Runs of one case,
 * the six dimensions of one case and the items of one outfit are not
 * independent observations, so counting them as samples would overstate the
 * evidence and let a handful of cases look like a measured result.
 *
 * A figure built from fewer than MIN_SAMPLE cases is marked
 * `insufficient_sample`: the value is shown, and nothing may be concluded from it.
 *
 * Nothing here computes a verdict, and nothing here calls a model or the network.
 */

import type { RawOpenAIConfidence, RawOpenAIDimensions, RawOpenAIRating } from '@/types/openai'
import { DIMENSION_KEYS, type Band, type BenchmarkCase, type DimensionKey } from '@/benchmark/harness'
import { GARMENT_MODES, type GarmentMode } from '@/lib/constants/garmentModes'
import { validateOutfitComponents } from '@/lib/services/openai/outfitComponentsSchema'
import { validateShoppingRecommendations } from '@/lib/services/openai/shoppingRecommendationSchema'
import { computeMetrics, type EvaluationMetrics, type RunDetail } from './metrics'
import { KEY_FACT_ATTRIBUTES, SCORED_TIERS, reviewerRatings, type CaseReference, type KeyFactAttribute, type ReferenceRating, type ResolvedReference, type ScoredTier } from './reference'
import { visualEvidenceMetrics, visualEvidenceOf, type VisualEvidenceReport } from './visualEvidence'

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/** Fewest cases (or comparison groups) a figure needs before anything is concluded from it. */
export const MIN_SAMPLE = 10
/** A rate must move by more than this, in absolute terms, to count as a change. */
export const NOISE_FLOOR_RATE = 0.05
/** A figure measured in rating bands (a mean absolute error) must move by more than this. */
export const NOISE_FLOOR_BANDS = 0.25
/** Width of the noise margin in standard errors of the difference (about 95%). */
export const NOISE_Z = 1.96

export const UNAVAILABLE_NO_GROUND_TRUTH = 'Unavailable: insufficient human-reviewed ground truth'
export const UNAVAILABLE_FIXTURE_OUTPUTS = 'Unavailable: the outputs are hand-written fixtures, not model outputs'
/** References of the tier exist, and none of their cases produced ratings that could be scored. */
export const UNAVAILABLE_NO_SCORED_OUTPUT = 'Unavailable: references exist, but no output with ratings could be scored for them (withheld, failed or abstained)'
/** The tier was scored, and its references hold nothing this particular figure could be built from. */
export const UNAVAILABLE_NOTHING_TO_MEASURE = 'Unavailable: the scored references hold nothing this figure can be built from'

const NO_REFERENCES: Record<ScoredTier, string> = {
  image_reviewed: UNAVAILABLE_NO_GROUND_TRUTH,
  brief_derived: 'Unavailable: no brief-derived references',
  synthetic: 'Unavailable: no synthetic references',
}

// ---------------------------------------------------------------------------
// Metric
// ---------------------------------------------------------------------------

export type MetricStatus = 'measured' | 'insufficient_sample' | 'unavailable'

export interface Metric {
  status: MetricStatus
  /** Why the figure is missing or only indicative. Absent when it was measured. */
  reason?: string
  /** Null when unavailable. Never 0 in place of "not measured". */
  value: number | null
  /** How many cases (or comparison groups) the figure is built from. Never runs, dimensions or items. */
  n: number
  /** Standard error of the value; null when it cannot be estimated. */
  se: number | null
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function share<T>(items: T[], of: (item: T) => boolean): number {
  return items.filter(of).length / items.length
}

function unavailable(reason: string): Metric {
  return { status: 'unavailable', reason, value: null, n: 0, se: null }
}

function sampled(value: number, n: number, se: number | null): Metric {
  if (n < MIN_SAMPLE) {
    return { status: 'insufficient_sample', reason: `Built from ${n} case(s); at least ${MIN_SAMPLE} are needed before anything is concluded.`, value: round(value), n, se: se === null ? null : round(se) }
  }
  return { status: 'measured', value: round(value), n, se: se === null ? null : round(se) }
}

/** Standard error of a rate from one value in [0, 1] per case, before rounding. */
function rateStandardError(values: number[]): number {
  const p = mean(values)
  return Math.sqrt((p * (1 - p)) / values.length)
}

/**
 * A rate from one value in [0, 1] per case. The standard error uses the
 * binomial formula, which is exact for 0/1 values and conservative (too wide,
 * never too narrow) for values that are themselves averages within a case.
 */
export function rateMetric(values: number[], reason: string): Metric {
  if (values.length === 0) return unavailable(reason)
  return sampled(mean(values), values.length, rateStandardError(values))
}

/** A mean of one value per case (for example a mean absolute error), with the standard error of that mean. */
export function meanMetric(values: number[], reason: string): Metric {
  if (values.length === 0) return unavailable(reason)
  const m = mean(values)
  const se = values.length < 2 ? null : Math.sqrt(values.reduce((sum, value) => sum + (value - m) ** 2, 0) / (values.length - 1) / values.length)
  return sampled(m, values.length, se)
}

/** A rate given as a proportion of `n` cases, for figures that are already counted per case elsewhere. */
export function rateFromProportion(p: number | null, n: number, reason: string): Metric {
  if (p === null || n === 0) return unavailable(reason)
  return sampled(p, n, Math.sqrt((p * (1 - p)) / n))
}

/**
 * How far two figures must be apart before the difference means anything: the
 * larger of a fixed floor and NOISE_Z standard errors of the difference.
 */
export function noiseMargin(kind: 'rate' | 'bands', seA: number | null, seB: number | null): number {
  const floor = kind === 'rate' ? NOISE_FLOOR_RATE : NOISE_FLOOR_BANDS
  return round(Math.max(floor, NOISE_Z * Math.sqrt((seA ?? 0) ** 2 + (seB ?? 0) ** 2)))
}

// ---------------------------------------------------------------------------
// Comparing one rating with its reference
// ---------------------------------------------------------------------------

const UNRATED = 'Unable to Evaluate'
const BAND: Record<string, number> = { Excellent: 4, Good: 3, Fair: 2, Poor: 1 }

export interface RatingComparison {
  exact: boolean
  /** The same rating, or the neighbouring band. */
  within_one: boolean
  /** Distance in bands; null when either side did not rate. */
  distance: number | null
  /** Two or more bands apart, or one side rated what the other said cannot be judged. */
  severe: boolean
}

/**
 * Excellent, Good, Fair and Poor are four bands, one step apart. "Unable to
 * Evaluate" is not on that scale: it agrees only with itself, and against a
 * rating it is a severe disagreement with no distance.
 */
export function compareRating(model: RawOpenAIRating, reference: ReferenceRating): RatingComparison {
  const modelUnrated = model === UNRATED
  const referenceUnrated = reference === UNRATED
  if (modelUnrated && referenceUnrated) return { exact: true, within_one: true, distance: null, severe: false }
  if (modelUnrated !== referenceUnrated) return { exact: false, within_one: false, distance: null, severe: true }
  const distance = Math.abs(BAND[model] - BAND[reference])
  return { exact: distance === 0, within_one: distance <= 1, distance, severe: distance >= 2 }
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

type CompleteRun = RunDetail & { dimensions: RawOpenAIDimensions }

interface ScoredCase {
  benchmarkCase: BenchmarkCase
  reference: CaseReference
  /** Complete runs only: the ones that carry ratings. Never empty. */
  runs: CompleteRun[]
}

function completeRuns(runs: RunDetail[]): CompleteRun[] {
  return runs.filter((run): run is CompleteRun => run.outcome === 'complete' && run.dimensions !== undefined)
}

function modeOf(benchmarkCase: BenchmarkCase): GarmentMode {
  return benchmarkCase.garment_mode ?? 'single'
}

function garmentCount(benchmarkCase: BenchmarkCase): number {
  return 1 + (benchmarkCase.extra_garments?.length ?? 0)
}

/** Every comparison of one case: each complete run, each dimension the reference rates. */
function comparisonsOf({ reference, runs }: ScoredCase): Array<RatingComparison & { key: DimensionKey; confidence: RawOpenAIConfidence }> {
  return runs.flatMap((run) => DIMENSION_KEYS.flatMap((key) => {
    const expected = reference.dimension_ratings?.[key]?.rating
    return expected === undefined ? [] : [{ ...compareRating(run.dimensions[key].rating, expected), key, confidence: run.dimensions[key].confidence }]
  }))
}

// ---------------------------------------------------------------------------
// Figures that need no reference, counted per case
// ---------------------------------------------------------------------------

export interface CaseRates {
  /** Per case: the share of its scored runs that returned an output matching the schema. */
  valid_output_rate: Metric
  /** Per case that states acceptable bands: the share of its complete runs whose band is one of them. */
  verdict_band_agreement_rate: Metric
  /** Per case that should abstain: the share of its scored runs that abstained. */
  abstention_recall: Metric
  /** Per case that should not abstain: the share of its scored runs that abstained. */
  false_abstention_rate: Metric
}

function caseRatesOf(cases: BenchmarkCase[], runsByCase: Map<string, RunDetail[]>): CaseRates {
  const valid: number[] = []
  const band: number[] = []
  const recall: number[] = []
  const falseAbstention: number[] = []
  for (const benchmarkCase of cases) {
    const runs = runsByCase.get(benchmarkCase.id) ?? []
    if (runs.length === 0) continue
    valid.push(share(runs, (run) => run.outcome !== 'error'))
    const abstained = share(runs, (run) => run.outcome === 'unable_to_analyze')
    if (benchmarkCase.expected.should_abstain) recall.push(abstained)
    else falseAbstention.push(abstained)
    const complete = runs.filter((run) => run.outcome === 'complete')
    const acceptable = benchmarkCase.expected.acceptable_bands
    if (acceptable.length > 0 && complete.length > 0) band.push(share(complete, (run) => acceptable.includes(run.band as Band)))
  }
  return {
    valid_output_rate: rateMetric(valid, 'Unavailable: no scored run'),
    verdict_band_agreement_rate: rateMetric(band, 'Unavailable: no case states acceptable bands'),
    abstention_recall: rateMetric(recall, 'Unavailable: no case expects an abstention'),
    false_abstention_rate: rateMetric(falseAbstention, 'Unavailable: no scored run'),
  }
}

// ---------------------------------------------------------------------------
// 1. Agreement
// ---------------------------------------------------------------------------

export interface DimensionAgreement {
  /** Share of cases whose rating equals the reference rating. */
  exact_rate: Metric
  /** Share of cases whose rating is the reference rating or the neighbouring band. */
  within_one_rate: Metric
  /** Mean absolute error in bands, over cases where both sides gave a rating. */
  mae: Metric
}

export interface AgreementBlock {
  /** Cases that have a reference of this tier. */
  reference_cases: number
  /** Of those, cases with at least one complete run that was scored. */
  cases_with_output: number
  /** cases_with_output / reference_cases. Low coverage means the agreement figures describe only part of the references. */
  coverage: Metric
  dimensions: Record<DimensionKey, DimensionAgreement>
}

function agreementOf(scored: ScoredCase[], referenceCases: number, scorable: boolean, reason: string): AgreementBlock {
  const dimensions = Object.fromEntries(DIMENSION_KEYS.map((key) => {
    const exact: number[] = []
    const withinOne: number[] = []
    const errors: number[] = []
    for (const { reference, runs } of scored) {
      const expected = reference.dimension_ratings?.[key]?.rating
      if (expected === undefined) continue
      const comparisons = runs.map((run) => compareRating(run.dimensions[key].rating, expected))
      // One value per case: the share of its runs that agree. Repeated runs never count as extra cases.
      exact.push(share(comparisons, (comparison) => comparison.exact))
      withinOne.push(share(comparisons, (comparison) => comparison.within_one))
      const distances = comparisons.map((comparison) => comparison.distance).filter((distance): distance is number => distance !== null)
      if (distances.length > 0) errors.push(mean(distances))
    }
    return [key, { exact_rate: rateMetric(exact, reason), within_one_rate: rateMetric(withinOne, reason), mae: meanMetric(errors, reason) }]
  })) as Record<DimensionKey, DimensionAgreement>

  return {
    reference_cases: referenceCases,
    cases_with_output: scored.length,
    coverage: scorable ? rateFromProportion(referenceCases === 0 ? null : scored.length / referenceCases, referenceCases, reason) : unavailable(reason),
    dimensions,
  }
}

/** Agreement pooled over the six dimensions of each case. Used only to compare image modes, never as a headline figure. */
interface PooledAgreement {
  exact_rate: Metric
  within_one_rate: Metric
  mae: Metric
}

function pooledPerCase(scored: ScoredCase[]): Array<{ exact: number; within_one: number; mae: number | null }> {
  return scored
    .map(comparisonsOf)
    // A complete reference rates all six dimensions, so a scored case always has comparisons; one without is left out.
    .filter((comparisons) => comparisons.length > 0)
    .map((comparisons) => {
      const distances = comparisons.map((comparison) => comparison.distance).filter((distance): distance is number => distance !== null)
      return {
        exact: share(comparisons, (comparison) => comparison.exact),
        within_one: share(comparisons, (comparison) => comparison.within_one),
        mae: distances.length === 0 ? null : mean(distances),
      }
    })
}

function pooledAgreement(scored: ScoredCase[], reason: string): PooledAgreement {
  const perCase = pooledPerCase(scored)
  return {
    exact_rate: rateMetric(perCase.map((entry) => entry.exact), reason),
    within_one_rate: rateMetric(perCase.map((entry) => entry.within_one), reason),
    mae: meanMetric(perCase.map((entry) => entry.mae).filter((value): value is number => value !== null), reason),
  }
}

// ---------------------------------------------------------------------------
// 5. Reviewers: how far two people agree with each other
// ---------------------------------------------------------------------------

export interface ReviewerDisagreement {
  case_id: string
  /** Dimensions on which two reviewers of the case gave different ratings. */
  dimensions: DimensionKey[]
  /** Of those, the ones that are FAR APART: two or more bands apart, or one reviewer rated what another could not judge. */
  severe: DimensionKey[]
}

export interface ReviewerAgreementBlock {
  /** Cases of this tier that were rated by a second person as well. */
  cases: number
  /**
   * Per dimension, over those cases: how often two reviewers gave the same
   * rating, a rating within one band, and how far apart they were. A case
   * contributes one value: the share of its reviewer pairs that agree.
   *
   * The distance covers only pairs in which both reviewers gave a rating. A
   * pair in which one could not judge has no distance; it shows in the two
   * rates and in the list of disagreements instead.
   */
  dimensions: Record<DimensionKey, { exact_rate: Metric; within_one_rate: Metric; mean_distance: Metric }>
  /** Every case on which reviewers differ. For people to read: none of these is an error in a review. */
  disagreements: ReviewerDisagreement[]
  /**
   * Per dimension, over cases with a second review and a scored output: how
   * often the model's rating is one that a reviewer gave, or lies between two
   * reviewers' ratings. Where reviewers differ, a rating inside their range
   * cannot be called wrong.
   */
  model_within_reviewer_range: Record<DimensionKey, Metric>
}

const NO_SECOND_REVIEW = 'Unavailable: no case of this tier was rated by a second reviewer'

/** Where two or more people rated one case: the dimensions they differ on. Null when the case has no second review. */
export function reviewerDisagreement(reference: CaseReference): ReviewerDisagreement | null {
  if ((reference.second_reviews ?? []).length === 0) return null
  const dimensions: DimensionKey[] = []
  const severe: DimensionKey[] = []
  for (const key of DIMENSION_KEYS) {
    const pairs = pairsOf(reviewerRatings(reference, key))
    if (pairs.some((pair) => !pair.exact)) dimensions.push(key)
    if (pairs.some((pair) => pair.severe)) severe.push(key)
  }
  return { case_id: reference.case_id, dimensions, severe }
}

/** Every pair of ratings given to one dimension of one case, compared. */
function pairsOf(ratings: ReferenceRating[]): RatingComparison[] {
  const pairs: RatingComparison[] = []
  for (let a = 0; a < ratings.length; a += 1) for (let b = a + 1; b < ratings.length; b += 1) pairs.push(compareRating(ratings[a], ratings[b]))
  return pairs
}

/** True when the rating is one a reviewer gave, or lies between the lowest and the highest band reviewers gave. */
function withinReviewerRange(rating: RawOpenAIRating, given: ReferenceRating[]): boolean {
  if ((given as string[]).includes(rating)) return true
  if (rating === UNRATED) return false
  const bands = given.filter((entry) => entry !== UNRATED).map((entry) => BAND[entry])
  return bands.length > 0 && BAND[rating] >= Math.min(...bands) && BAND[rating] <= Math.max(...bands)
}

/**
 * Reviewer agreement needs no model output: it describes the reviews. Only the
 * last figure, the model against the range of the reviewers, uses the outputs.
 */
function reviewerAgreementOf(references: CaseReference[], scored: ScoredCase[], outputReason: string): ReviewerAgreementBlock {
  const reviewedTwice = references.filter((reference) => (reference.second_reviews ?? []).length > 0)
  const scoredTwice = scored.filter((entry) => (entry.reference.second_reviews ?? []).length > 0)
  const rangeReason = reviewedTwice.length === 0 ? NO_SECOND_REVIEW : outputReason

  const dimensions = Object.fromEntries(DIMENSION_KEYS.map((key) => {
    const exact: number[] = []
    const withinOne: number[] = []
    const distances: number[] = []
    for (const reference of reviewedTwice) {
      const pairs = pairsOf(reviewerRatings(reference, key))
      if (pairs.length === 0) continue
      exact.push(share(pairs, (pair) => pair.exact))
      withinOne.push(share(pairs, (pair) => pair.within_one))
      const rated = pairs.map((pair) => pair.distance).filter((distance): distance is number => distance !== null)
      if (rated.length > 0) distances.push(mean(rated))
    }
    // With second reviews present, an empty distance means that no pair has two ratings (for example both said "Unable to Evaluate").
    return [key, { exact_rate: rateMetric(exact, NO_SECOND_REVIEW), within_one_rate: rateMetric(withinOne, NO_SECOND_REVIEW), mean_distance: meanMetric(distances, reviewedTwice.length === 0 ? NO_SECOND_REVIEW : 'Unavailable: in no twice-reviewed case did two reviewers both give a rating for this dimension') }]
  })) as ReviewerAgreementBlock['dimensions']

  const modelWithinRange = Object.fromEntries(DIMENSION_KEYS.map((key) => {
    const values: number[] = []
    for (const { reference, runs } of scoredTwice) {
      const given = reviewerRatings(reference, key)
      if (given.length > 0) values.push(share(runs, (run) => withinReviewerRange(run.dimensions[key].rating, given)))
    }
    return [key, rateMetric(values, rangeReason)]
  })) as Record<DimensionKey, Metric>

  return {
    cases: reviewedTwice.length,
    dimensions,
    disagreements: reviewedTwice
      .map((reference) => reviewerDisagreement(reference) as ReviewerDisagreement)
      .filter((entry) => entry.dimensions.length > 0)
      .sort((a, b) => a.case_id.localeCompare(b.case_id)),
    model_within_reviewer_range: modelWithinRange,
  }
}

// ---------------------------------------------------------------------------
// 6. Shopping Advisor (advisory only; nothing here reaches the verdict)
// ---------------------------------------------------------------------------

export interface ShoppingAdvisorBlock {
  /** Cases that send a Style DNA profile and have at least one complete run. */
  cases_with_style_dna: number
  /** Cases without Style DNA that have at least one complete run. */
  cases_without_style_dna: number
  /**
   * Per case with Style DNA: the share of its complete runs whose advisor block
   * passes the production validation, which is when the application shows it.
   */
  availability_rate: Metric
  /**
   * Per case with Style DNA and a valid block: the share of its recommendations
   * that address only dimensions the same run rated Excellent. The prompt asks
   * for alternatives that address weak dimensions. A run that rated all six
   * dimensions Excellent is left out: it has no weak dimension to address, and
   * the prompt still asks it for at least one alternative.
   */
  mistargeted_recommendation_rate: Metric
  /**
   * Per case without Style DNA: the share of its complete runs that returned
   * recommendations anyway. The prompt asks for an empty list, and the
   * application discards whatever arrives.
   */
  unrequested_recommendation_rate: Metric
}

function validAdvisor(run: CompleteRun): Array<{ addresses: string[] }> | null {
  try {
    return validateShoppingRecommendations(run.shopping_advisor)
  } catch {
    return null
  }
}

function shoppingAdvisorOf(cases: BenchmarkCase[], runsByCase: Map<string, RunDetail[]>): ShoppingAdvisorBlock {
  const availability: number[] = []
  const mistargeted: number[] = []
  const unrequested: number[] = []
  for (const benchmarkCase of cases) {
    const runs = completeRuns(runsByCase.get(benchmarkCase.id) ?? [])
    if (runs.length === 0) continue
    if (benchmarkCase.style_dna) {
      const blocks = runs.map((run) => ({ run, recommendations: validAdvisor(run) }))
      availability.push(share(blocks, (block) => block.recommendations !== null))
      const targets = blocks
        .filter(({ run }) => DIMENSION_KEYS.some((key) => run.dimensions[key].rating !== 'Excellent'))
        .flatMap(({ run, recommendations }) => (recommendations ?? []).map((recommendation) => recommendation.addresses.every((key) => run.dimensions[key as DimensionKey]?.rating === 'Excellent')))
      if (targets.length > 0) mistargeted.push(share(targets, (missed) => missed))
    } else {
      unrequested.push(share(runs, (run) => {
        const list = (run.shopping_advisor as { recommendations?: unknown } | null | undefined)?.recommendations
        return Array.isArray(list) && list.length > 0
      }))
    }
  }
  const noStyleDna = 'Unavailable: no case with a Style DNA profile produced ratings'
  return {
    cases_with_style_dna: availability.length,
    cases_without_style_dna: unrequested.length,
    availability_rate: rateMetric(availability, noStyleDna),
    mistargeted_recommendation_rate: rateMetric(mistargeted, availability.length === 0 ? noStyleDna : 'Unavailable: no run with Style DNA returned a valid advisor block next to a dimension rated below Excellent'),
    unrequested_recommendation_rate: rateMetric(unrequested, 'Unavailable: no case without Style DNA produced ratings'),
  }
}

// ---------------------------------------------------------------------------
// 2. Grounding (proxy)
// ---------------------------------------------------------------------------

/** Lower case, with every run of other characters turned into one space, and a space at each end. */
export function normaliseText(text: string): string {
  return ` ${text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim()} `
}

/** True when `term` appears in `normalised` as whole words. `normalised` must come from normaliseText. */
export function mentions(normalised: string, term: string): boolean {
  const wanted = normaliseText(term)
  return wanted.trim().length > 0 && normalised.includes(wanted)
}

/** Everything the model wrote about a complete run: the six reasons and any per-item notes. */
function explanationText(run: CompleteRun): string {
  const parts = DIMENSION_KEYS.map((key) => run.dimensions[key].reason)
  if (Array.isArray(run.outfit_components)) {
    for (const entry of run.outfit_components) {
      const note = (entry as { note?: unknown } | null)?.note
      if (typeof note === 'string') parts.push(note)
    }
  }
  return normaliseText(parts.join('\n'))
}

export interface GroundingBlock {
  /** Always `proxy`: these figures match words. They do not establish that an explanation is true. */
  kind: 'proxy'
  /** Cases of this tier that list key facts and have at least one complete run. */
  cases_with_facts: number
  /** Share of `key` facts whose terms appear in the explanation. */
  key_fact_mention_rate: Metric
  supporting_fact_mention_rate: Metric
  /** The same, split by what the fact is about. `colour` and `pattern` stand in for attribute recognition, which the output has no field for. */
  mention_rate_by_attribute: Record<KeyFactAttribute, Metric>
  /** Share of cases whose explanation uses a word that contradicts a listed fact. */
  contradiction_rate: Metric
  /** Share of cases whose explanation states a detail the reviewer marked as not visible. */
  unverifiable_claim_rate: Metric
  /** Per case where the reviewer could not judge a dimension: how often the model left it unrated or stated Low confidence. */
  uncertainty_handling_rate: Metric
  /** Cases where a `key` fact is mentioned in no run. For a person to read. */
  cases_missing_key_facts: string[]
}

function groundingOf(scored: ScoredCase[], reason: string): GroundingBlock {
  const key: number[] = []
  const supporting: number[] = []
  const byAttribute = Object.fromEntries(KEY_FACT_ATTRIBUTES.map((attribute) => [attribute, [] as number[]])) as Record<KeyFactAttribute, number[]>
  const contradictions: number[] = []
  const unverifiable: number[] = []
  const uncertainty: number[] = []
  const missing: string[] = []
  let withFacts = 0

  for (const { benchmarkCase, reference, runs } of scored) {
    const texts = runs.map(explanationText)
    const facts = reference.key_facts ?? []
    const mentionShare = (subset: typeof facts) => mean(texts.map((text) => subset.filter((fact) => fact.terms.some((term) => mentions(text, term))).length / subset.length))

    if (facts.length > 0) withFacts += 1
    const keyFacts = facts.filter((fact) => fact.importance === 'key')
    const supportingFacts = facts.filter((fact) => fact.importance === 'supporting')
    if (keyFacts.length > 0) {
      key.push(mentionShare(keyFacts))
      if (keyFacts.some((fact) => !texts.some((text) => fact.terms.some((term) => mentions(text, term))))) missing.push(benchmarkCase.id)
    }
    if (supportingFacts.length > 0) supporting.push(mentionShare(supportingFacts))
    for (const attribute of KEY_FACT_ATTRIBUTES) {
      const subset = facts.filter((fact) => fact.attribute === attribute)
      if (subset.length > 0) byAttribute[attribute].push(mentionShare(subset))
    }

    const contradicting = facts.flatMap((fact) => fact.contradicted_by ?? [])
    if (contradicting.length > 0) contradictions.push(share(texts, (text) => contradicting.some((term) => mentions(text, term))))
    const hidden = reference.unverifiable_terms ?? []
    if (hidden.length > 0) unverifiable.push(share(texts, (text) => hidden.some((term) => mentions(text, term))))

    // One value per case: over every run and every dimension the reviewer could not judge.
    const unjudged = DIMENSION_KEYS.filter((dimension) => reference.dimension_ratings?.[dimension]?.rating === UNRATED)
    if (unjudged.length > 0) {
      const handled = runs.flatMap((run) => unjudged.map((dimension) => run.dimensions[dimension].rating === UNRATED || run.dimensions[dimension].confidence === 'Low'))
      uncertainty.push(share(handled, (ok) => ok))
    }
  }

  return {
    kind: 'proxy',
    cases_with_facts: withFacts,
    key_fact_mention_rate: rateMetric(key, reason),
    supporting_fact_mention_rate: rateMetric(supporting, reason),
    mention_rate_by_attribute: Object.fromEntries(KEY_FACT_ATTRIBUTES.map((attribute) => [attribute, rateMetric(byAttribute[attribute], reason)])) as Record<KeyFactAttribute, Metric>,
    contradiction_rate: rateMetric(contradictions, reason),
    unverifiable_claim_rate: rateMetric(unverifiable, reason),
    uncertainty_handling_rate: rateMetric(uncertainty, reason),
    cases_missing_key_facts: missing.sort(),
  }
}

// ---------------------------------------------------------------------------
// 3. Calibration
// ---------------------------------------------------------------------------

const CONFIDENCE_LEVELS: readonly RawOpenAIConfidence[] = ['High', 'Medium', 'Low']

export type ConfidenceOrdering = 'consistent' | 'inverted' | 'insufficient_sample' | 'unavailable'

export interface CalibrationBlock {
  /**
   * Agreement with the reference among the ratings a case stated at each confidence.
   * A case that stated a level at least once contributes one value to that level:
   * the share of those ratings that agree.
   */
  buckets: Record<RawOpenAIConfidence, { exact_rate: Metric; within_one_rate: Metric }>
  /** Share of High-confidence ratings that differ from the reference. */
  high_confidence_error_rate: Metric
  /** Share of High-confidence ratings that are two or more bands off, or rate what the reviewer said cannot be judged. */
  high_confidence_severe_error_rate: Metric
  /** Exact agreement at High confidence minus exact agreement at Low confidence. Positive when confidence carries information. */
  confidence_gap: Metric
  /**
   * `consistent`: no lower confidence level agrees with the references clearly more often than a higher one.
   * `inverted`: one does, by more than the noise margin. Needs two sufficiently sampled levels.
   */
  ordering: ConfidenceOrdering
}

function calibrationOf(scored: ScoredCase[], reason: string): CalibrationBlock {
  const perCase = Object.fromEntries(CONFIDENCE_LEVELS.map((level) => [level, { exact: [] as number[], withinOne: [] as number[], severe: [] as number[] }])) as Record<RawOpenAIConfidence, { exact: number[]; withinOne: number[]; severe: number[] }>

  for (const entry of scored) {
    const comparisons = comparisonsOf(entry)
    for (const level of CONFIDENCE_LEVELS) {
      const stated = comparisons.filter((comparison) => comparison.confidence === level)
      if (stated.length === 0) continue
      perCase[level].exact.push(share(stated, (comparison) => comparison.exact))
      perCase[level].withinOne.push(share(stated, (comparison) => comparison.within_one))
      perCase[level].severe.push(share(stated, (comparison) => comparison.severe))
    }
  }

  const buckets = Object.fromEntries(CONFIDENCE_LEVELS.map((level) => [level, {
    exact_rate: rateMetric(perCase[level].exact, reason),
    within_one_rate: rateMetric(perCase[level].withinOne, reason),
  }])) as CalibrationBlock['buckets']

  const high = buckets.High.exact_rate
  const low = buckets.Low.exact_rate
  let gap: Metric
  if (perCase.High.exact.length === 0 || perCase.Low.exact.length === 0) {
    gap = unavailable(scored.length === 0 ? reason : 'Unavailable: needs ratings stated at both High and Low confidence')
  } else {
    // From the unrounded rates, so that the gap is not off by a rounding step.
    const value = round(mean(perCase.High.exact) - mean(perCase.Low.exact))
    const se = round(Math.sqrt(rateStandardError(perCase.High.exact) ** 2 + rateStandardError(perCase.Low.exact) ** 2))
    const n = Math.min(high.n, low.n)
    gap = high.status === 'measured' && low.status === 'measured'
      ? { status: 'measured', value, n, se }
      : { status: 'insufficient_sample', reason: `One confidence level was stated by fewer than ${MIN_SAMPLE} cases.`, value, n, se }
  }

  const measured = CONFIDENCE_LEVELS.map((level) => buckets[level].exact_rate).filter((metric) => metric.status === 'measured')
  let ordering: ConfidenceOrdering
  if (CONFIDENCE_LEVELS.every((level) => buckets[level].exact_rate.n === 0)) ordering = 'unavailable'
  else if (measured.length < 2) ordering = 'insufficient_sample'
  else {
    // `measured` keeps the High, Medium, Low order, so every later entry is a lower confidence level.
    const inverted = measured.some((higher, index) => measured.slice(index + 1).some((lower) => (lower.value as number) - (higher.value as number) > noiseMargin('rate', higher.se, lower.se)))
    ordering = inverted ? 'inverted' : 'consistent'
  }

  return {
    buckets,
    high_confidence_error_rate: rateMetric(perCase.High.exact.map((value) => 1 - value), reason),
    high_confidence_severe_error_rate: rateMetric(perCase.High.severe, reason),
    confidence_gap: gap,
    ordering,
  }
}

// ---------------------------------------------------------------------------
// Garment identification (outfit items only)
// ---------------------------------------------------------------------------

export interface GarmentIdentificationBlock {
  /** Outfit cases of this tier whose reference names the garment type of each item. */
  cases: number
  /** Per outfit case: the share of its items whose `garment_type` in the per-item notes equals the reference. */
  garment_type_accuracy: Metric
}

function validComponents(run: CompleteRun, count: number): Array<{ item: number; garment_type: string }> | null {
  try {
    return validateOutfitComponents(run.outfit_components, count)
  } catch {
    return null
  }
}

function garmentIdentificationOf(scored: ScoredCase[], reason: string): GarmentIdentificationBlock {
  const perCase: number[] = []
  let cases = 0
  for (const { benchmarkCase, reference, runs } of scored) {
    // Items a reviewer could not identify carry no garment type; they are scored under visual_evidence instead.
    const expected = (reference.garment_facts?.items ?? []).filter((entry) => entry.garment_type !== undefined)
    if (modeOf(benchmarkCase) !== 'outfit_items' || expected.length === 0) continue
    cases += 1
    // A run without a valid block says nothing about identification; it is counted under completeness instead.
    const blocks = runs.map((run) => validComponents(run, garmentCount(benchmarkCase))).filter((block): block is NonNullable<typeof block> => block !== null)
    if (blocks.length === 0) continue
    perCase.push(mean(blocks.map((block) => share(expected, (entry) => block.find((component) => component.item === entry.item)?.garment_type === entry.garment_type))))
  }
  return { cases, garment_type_accuracy: rateMetric(perCase, reason) }
}

// ---------------------------------------------------------------------------
// 4. Multi-image
// ---------------------------------------------------------------------------

export interface ModeBlock {
  cases: number
  scored_runs: number
  /** Per case of this mode: the share of its scored runs that returned an output matching the schema. */
  valid_output_rate: Metric
  /** Per case with repeats: the share of dimensions that got the same rating on every run. */
  repeat_rating_stability: Metric
  /** Runs whose text matched the price, label or material screening, or a claim the case forbids. */
  runs_with_unsupported_claims: number
  /** Agreement with references, pooled over the six dimensions of each case, per tier. For comparing modes only. */
  agreement: Record<ScoredTier, PooledAgreement>
}

export interface ComparisonGroupDetail {
  group: string
  cases: Array<{ case_id: string; mode: GarmentMode }>
  compared_dimensions: number
  identical_dimensions: number
}

export interface MultiImageBlock {
  modes: Record<GarmentMode, ModeBlock>
  outfit_items: {
    /** Per outfit case: the share of its complete runs with exactly one valid per-item note for each garment image. */
    completeness_rate: Metric
    /** Complete runs of the other modes that returned per-item notes, where none are expected. */
    unexpected_blocks_in_other_modes: number
  }
  comparison_groups: {
    /** Groups that hold cases of at least two different garment modes, each with ratings. */
    groups: number
    /** Share of dimensions rated the same by every case of a group. A unit is one group. */
    cross_mode_rating_consistency: Metric
    /** Mean spread in bands between the cases of a group. A unit is one group. */
    mean_band_shift: Metric
    /** Exact agreement of the multi-image cases minus that of the single-image cases of the same group, per tier. A unit is one group. */
    multi_minus_single_exact: Record<ScoredTier, Metric>
    details: ComparisonGroupDetail[]
  }
}

const UNSUPPORTED_CLAIM_LABELS = ['price', 'brand', 'material_claim']

/** The rating a case gave a dimension most often; ties go to the earliest run. */
function modalRating(runs: CompleteRun[], key: DimensionKey): RawOpenAIRating {
  const counts = new Map<RawOpenAIRating, number>()
  for (const run of runs) counts.set(run.dimensions[key].rating, (counts.get(run.dimensions[key].rating) ?? 0) + 1)
  let best = runs[0].dimensions[key].rating
  for (const [rating, count] of counts) if (count > (counts.get(best) ?? 0)) best = rating
  return best
}

function multiImageOf(
  cases: BenchmarkCase[],
  runsByCase: Map<string, RunDetail[]>,
  references: Map<string, ResolvedReference>,
  scoredByTier: Record<ScoredTier, ScoredCase[]>,
  reasonByTier: Record<ScoredTier, string>,
): MultiImageBlock {
  const modes = Object.fromEntries(GARMENT_MODES.map((mode) => {
    const members = cases.filter((benchmarkCase) => modeOf(benchmarkCase) === mode)
    const runs = members.flatMap((benchmarkCase) => runsByCase.get(benchmarkCase.id) ?? [])
    const valid: number[] = []
    const stability: number[] = []
    for (const benchmarkCase of members) {
      const own = runsByCase.get(benchmarkCase.id) ?? []
      if (own.length > 0) valid.push(share(own, (run) => run.outcome !== 'error'))
      const complete = completeRuns(own)
      if (complete.length >= 2) stability.push(share([...DIMENSION_KEYS], (key) => new Set(complete.map((run) => run.dimensions[key].rating)).size === 1))
    }
    const block: ModeBlock = {
      cases: members.length,
      scored_runs: runs.length,
      valid_output_rate: rateMetric(valid, 'Unavailable: no run in this mode'),
      repeat_rating_stability: rateMetric(stability, 'Unavailable: no case in this mode was run more than once'),
      runs_with_unsupported_claims: runs.filter((run) => run.forbidden_claim_hits.length > 0 || run.prohibited_hits.some((label) => UNSUPPORTED_CLAIM_LABELS.includes(label))).length,
      agreement: Object.fromEntries(SCORED_TIERS.map((tier) => [tier, pooledAgreement(scoredByTier[tier].filter((entry) => modeOf(entry.benchmarkCase) === mode), reasonByTier[tier])])) as Record<ScoredTier, PooledAgreement>,
    }
    return [mode, block]
  })) as Record<GarmentMode, ModeBlock>

  // --- outfit completeness -------------------------------------------------
  const outfitCases: number[] = []
  let unexpected = 0
  for (const benchmarkCase of cases) {
    const complete = completeRuns(runsByCase.get(benchmarkCase.id) ?? [])
    if (modeOf(benchmarkCase) === 'outfit_items') {
      if (complete.length > 0) outfitCases.push(share(complete, (run) => validComponents(run, garmentCount(benchmarkCase)) !== null))
    } else {
      unexpected += complete.filter((run) => run.outfit_components !== undefined).length
    }
  }

  // --- comparison groups ---------------------------------------------------
  const byId = new Map(cases.map((benchmarkCase) => [benchmarkCase.id, benchmarkCase]))
  const groups = new Map<string, Array<{ benchmarkCase: BenchmarkCase; runs: CompleteRun[] }>>()
  for (const [caseId, { reference, tier }] of references) {
    const benchmarkCase = byId.get(caseId)
    const runs = completeRuns(runsByCase.get(caseId) ?? [])
    // An unfinished review does not shape any figure, not even by saying which cases belong together.
    if (tier === 'unreviewed' || !reference.comparison_group || !benchmarkCase || runs.length === 0) continue
    groups.set(reference.comparison_group, [...(groups.get(reference.comparison_group) ?? []), { benchmarkCase, runs }])
  }

  const consistency: number[] = []
  const shifts: number[] = []
  const details: ComparisonGroupDetail[] = []
  const deltas = Object.fromEntries(SCORED_TIERS.map((tier) => [tier, [] as number[]])) as Record<ScoredTier, number[]>
  for (const group of [...groups.keys()].sort()) {
    const members = (groups.get(group) ?? []).sort((a, b) => (a.benchmarkCase.id < b.benchmarkCase.id ? -1 : 1))
    // A comparison between image modes needs cases of at least two different modes.
    if (new Set(members.map((member) => modeOf(member.benchmarkCase))).size < 2) continue
    let identical = 0
    const spreads: number[] = []
    for (const key of DIMENSION_KEYS) {
      const ratings = members.map((member) => modalRating(member.runs, key))
      if (new Set(ratings).size === 1) identical += 1
      const bands = ratings.filter((rating) => rating !== UNRATED).map((rating) => BAND[rating])
      if (bands.length >= 2) spreads.push(Math.max(...bands) - Math.min(...bands))
    }
    consistency.push(identical / DIMENSION_KEYS.length)
    if (spreads.length > 0) shifts.push(mean(spreads))
    details.push({ group, cases: members.map((member) => ({ case_id: member.benchmarkCase.id, mode: modeOf(member.benchmarkCase) })), compared_dimensions: DIMENSION_KEYS.length, identical_dimensions: identical })

    const ids = new Set(members.map((member) => member.benchmarkCase.id))
    for (const tier of SCORED_TIERS) {
      const scored = scoredByTier[tier].filter((entry) => ids.has(entry.benchmarkCase.id))
      const single = pooledPerCase(scored.filter((entry) => modeOf(entry.benchmarkCase) === 'single')).map((entry) => entry.exact)
      const multi = pooledPerCase(scored.filter((entry) => modeOf(entry.benchmarkCase) !== 'single')).map((entry) => entry.exact)
      if (single.length > 0 && multi.length > 0) deltas[tier].push(mean(multi) - mean(single))
    }
  }

  const noGroups = 'Unavailable: no comparison group holds cases of two image modes with ratings'
  return {
    modes,
    outfit_items: {
      completeness_rate: rateMetric(outfitCases, 'Unavailable: no complete run of an outfit case'),
      unexpected_blocks_in_other_modes: unexpected,
    },
    comparison_groups: {
      groups: details.length,
      cross_mode_rating_consistency: rateMetric(consistency, noGroups),
      mean_band_shift: meanMetric(shifts, noGroups),
      multi_minus_single_exact: Object.fromEntries(SCORED_TIERS.map((tier) => [tier, meanMetric(deltas[tier], details.length === 0 ? noGroups : reasonByTier[tier])])) as Record<ScoredTier, Metric>,
      details,
    },
  }
}

// ---------------------------------------------------------------------------
// Report section
// ---------------------------------------------------------------------------

export interface QualityReport {
  /** The thresholds every status and every regression class below was decided with. */
  thresholds: { min_sample: number; noise_floor_rate: number; noise_floor_bands: number; noise_z: number }
  /** Whether this report holds any evidence about accuracy on real images. */
  image_grounded_accuracy: { status: 'available' | 'unavailable'; reason?: string; cases: number }
  /** Validity, band agreement and abstention, counted per case so that they can be compared between reports. */
  by_case: CaseRates
  agreement: Record<ScoredTier, AgreementBlock>
  grounding: Record<ScoredTier, GroundingBlock>
  calibration: Record<ScoredTier, CalibrationBlock>
  garment_identification: Record<ScoredTier, GarmentIdentificationBlock>
  multi_image: MultiImageBlock
  /** How far two reviewers of the same case agree with each other. The context every agreement figure above is read in. */
  reviewer_agreement: Record<ScoredTier, ReviewerAgreementBlock>
  /** The advisory block, with and without Style DNA. It never reaches the verdict. */
  shopping_advisor: ShoppingAdvisorBlock
  /** Observations and rating evidence (analysis-output/3): structural figures, and figures against reviewer references. Informational; never part of the verdict. */
  visual_evidence: VisualEvidenceReport
  /** Whether the evaluated cases mix both Style DNA conditions, and how the figures of this report relate to that. */
  style_dna: StyleDnaSummary
  /** Per dimension: share of repeated cases that got the same rating on every run. */
  stability_by_dimension: Record<DimensionKey, Metric>
  /** What the current output cannot support, so that a missing figure is never read as a measured one. */
  not_measurable: Record<string, string>
  /** Cases whose manifest lists `expected.key_facts` as plain text. Those are for a reviewer; only the facts of a reference are scored. */
  cases_with_unscored_manifest_facts: number
}

// ---------------------------------------------------------------------------
// Style DNA as a condition
// ---------------------------------------------------------------------------

export const STYLE_DNA_CONDITIONS = ['with_style_dna', 'without_style_dna'] as const
export type StyleDnaCondition = (typeof STYLE_DNA_CONDITIONS)[number]

const CONDITION_WORDS: Record<StyleDnaCondition, string> = { with_style_dna: 'with Style DNA', without_style_dna: 'without Style DNA' }

export interface StyleDnaSummary {
  /** True when the evaluated cases include cases that send a Style DNA profile and cases that do not. */
  mixed: boolean
  cases_with_style_dna: number
  cases_without_style_dna: number
  /** How to read the figures of this report with respect to the condition. A fixed sentence, never model text. */
  reading: string
}

export const STYLE_DNA_READING = {
  mixed: 'This report mixes cases with and without a Style DNA profile. Every figure that combines them is marked as pooled. Separate figures for each condition are in the metric index under "style_dna.with_style_dna." and "style_dna.without_style_dna."; one built from fewer than the minimum sample is unavailable, not shown as a value.',
  without: 'No evaluated case sends a Style DNA profile. Every figure describes cases without one; nothing is pooled.',
  with: 'Every evaluated case sends a Style DNA profile. Every figure describes cases with one; nothing is pooled.',
  none: 'No case was evaluated.',
} as const

function styleDnaSummaryOf(cases: BenchmarkCase[]): StyleDnaSummary {
  const withProfile = cases.filter((benchmarkCase) => benchmarkCase.style_dna !== undefined).length
  const without = cases.length - withProfile
  const mixed = withProfile > 0 && without > 0
  return {
    mixed,
    cases_with_style_dna: withProfile,
    cases_without_style_dna: without,
    reading: mixed ? STYLE_DNA_READING.mixed : cases.length === 0 ? STYLE_DNA_READING.none : withProfile > 0 ? STYLE_DNA_READING.with : STYLE_DNA_READING.without,
  }
}

/** What an output from before analysis-output/3 cannot support. With observations, these become figures under `visual_evidence`. */
export const NOT_MEASURABLE: Record<string, string> = {
  colour_identification: 'The output has no colour field. Colour is covered only by the grounding proxy (key facts with attribute "colour").',
  pattern_identification: 'The output has no pattern field. Pattern is covered only by the grounding proxy (key facts with attribute "pattern").',
  single_garment_identification: 'The output names a garment type only for the items of an outfit. A single garment, and views of one garment, carry none.',
  contradictions_between_views: 'One output is returned for all views, so views cannot be compared with each other. Only the ratings of cases in one comparison group can.',
}

/** What an output with observations and evidence still cannot support. */
export const NOT_MEASURABLE_WITH_OBSERVATIONS: Record<string, string> = {
  exact_colour_shades: 'Observations use broad colour families on purpose. Exact shades are never claimed, so they are never scored.',
  material_and_quality: 'Material, fibre, brand, price, durability and comfort cannot be seen in a photo. Observations that state them are refused, so there is nothing to score.',
  reasoning_quality: 'Evidence shows what a rating rests on, not whether the reasoning is right. The relevance figure is a proxy.',
}

export function computeQuality(
  details: RunDetail[],
  cases: BenchmarkCase[],
  references: Map<string, ResolvedReference>,
  outputs: 'model' | 'synthetic_fixture',
  carriesVisualEvidence = false,
): QualityReport {
  const scoredRuns = details.filter((detail) => detail.outcome !== 'withheld')
  const runsByCase = new Map<string, RunDetail[]>()
  for (const detail of scoredRuns) runsByCase.set(detail.case_id, [...(runsByCase.get(detail.case_id) ?? []), detail])

  // Hand-written outputs agreeing with a human review would say nothing about a model, so that tier is not scored for them.
  const scorable = (tier: ScoredTier) => !(tier === 'image_reviewed' && outputs !== 'model')
  const perTier = <T>(make: (tier: ScoredTier) => T) => Object.fromEntries(SCORED_TIERS.map((tier) => [tier, make(tier)])) as Record<ScoredTier, T>

  const referenceCases = perTier((tier) => cases.filter((benchmarkCase) => references.get(benchmarkCase.id)?.tier === tier))
  const scoredByTier = perTier((tier) => (!scorable(tier) ? [] : referenceCases[tier]
    .map((benchmarkCase) => ({ benchmarkCase, reference: (references.get(benchmarkCase.id) as ResolvedReference).reference, runs: completeRuns(runsByCase.get(benchmarkCase.id) ?? []) }))
    .filter((entry) => entry.runs.length > 0)))

  // Why the tier as a whole has no figure. Each reason names the actual cause.
  const tierReason = perTier((tier) => {
    if (referenceCases[tier].length === 0) return NO_REFERENCES[tier]
    if (!scorable(tier)) return UNAVAILABLE_FIXTURE_OUTPUTS
    if (scoredByTier[tier].length === 0) return UNAVAILABLE_NO_SCORED_OUTPUT
    return null
  })
  // The reason attached to one figure of the tier that turns out empty.
  const reasonByTier = perTier((tier) => tierReason[tier] ?? UNAVAILABLE_NOTHING_TO_MEASURE)

  const stability = Object.fromEntries(DIMENSION_KEYS.map((key) => {
    const values: number[] = []
    for (const runs of runsByCase.values()) {
      const complete = completeRuns(runs)
      if (complete.length >= 2) values.push(new Set(complete.map((run) => run.dimensions[key].rating)).size === 1 ? 1 : 0)
    }
    return [key, rateMetric(values, 'Unavailable: no case was run more than once')]
  })) as Record<DimensionKey, Metric>

  const imageCases = scoredByTier.image_reviewed.length
  return {
    thresholds: { min_sample: MIN_SAMPLE, noise_floor_rate: NOISE_FLOOR_RATE, noise_floor_bands: NOISE_FLOOR_BANDS, noise_z: NOISE_Z },
    image_grounded_accuracy: imageCases > 0
      ? { status: 'available', cases: imageCases }
      : { status: 'unavailable', reason: reasonByTier.image_reviewed, cases: 0 },
    by_case: caseRatesOf(cases, runsByCase),
    agreement: perTier((tier) => agreementOf(scoredByTier[tier], referenceCases[tier].length, scorable(tier), reasonByTier[tier])),
    grounding: perTier((tier) => groundingOf(scoredByTier[tier], reasonByTier[tier])),
    calibration: perTier((tier) => calibrationOf(scoredByTier[tier], reasonByTier[tier])),
    garment_identification: perTier((tier) => garmentIdentificationOf(scoredByTier[tier], reasonByTier[tier])),
    multi_image: multiImageOf(cases, runsByCase, references, scoredByTier, reasonByTier),
    reviewer_agreement: perTier((tier) => reviewerAgreementOf(referenceCases[tier].map((benchmarkCase) => (references.get(benchmarkCase.id) as ResolvedReference).reference), scoredByTier[tier], reasonByTier[tier])),
    shopping_advisor: shoppingAdvisorOf(cases, runsByCase),
    visual_evidence: visualEvidenceOf(cases, runsByCase, scoredByTier, reasonByTier, carriesVisualEvidence),
    stability_by_dimension: stability,
    style_dna: styleDnaSummaryOf(cases),
    not_measurable: carriesVisualEvidence ? NOT_MEASURABLE_WITH_OBSERVATIONS : NOT_MEASURABLE,
    cases_with_unscored_manifest_facts: cases.filter((benchmarkCase) => benchmarkCase.expected.key_facts.length > 0).length,
  }
}

// ---------------------------------------------------------------------------
// Metric index: every comparable figure under one stable name
// ---------------------------------------------------------------------------

export interface IndexedMetric extends Metric {
  direction: 'higher_is_better' | 'lower_is_better'
  /** `rate`: a share between 0 and 1, or a difference of two. `bands`: a distance in rating bands. */
  kind: 'rate' | 'bands'
  /** True when the figure depends on the reference set, so it is comparable only between reports that used the same one. */
  needs_references: boolean
  /** Present, and true, only for a figure that uses second reviews: it is comparable only when those are the same as well. */
  needs_second_reviews?: true
  /** Present, and true, when the figure combines cases with and without a Style DNA profile. Absent when the report holds one condition only. */
  pooled_over_style_dna?: true
  /** Present when the figure describes one Style DNA condition only. */
  style_dna_condition?: StyleDnaCondition
}

export type MetricIndex = Record<string, IndexedMetric>

/**
 * Flattens a report's figures into `name -> metric`, so two reports can be
 * compared metric by metric (see classifyMetricChanges in regression.ts).
 * Names are stable; adding a metric never renames an existing one. Every
 * figure here counts cases or comparison groups.
 */
export function buildMetricIndex(metrics: EvaluationMetrics, quality: QualityReport): MetricIndex {
  const index: MetricIndex = {}
  // The advisor figures are condition-specific by definition: two exist only with a profile, one only without.
  const ADVISOR_CONDITION: Record<string, StyleDnaCondition> = {
    'shopping_advisor.availability_rate': 'with_style_dna',
    'shopping_advisor.mistargeted_recommendation_rate': 'with_style_dna',
    'shopping_advisor.unrequested_recommendation_rate': 'without_style_dna',
  }
  const add = (name: string, metric: Metric, direction: IndexedMetric['direction'], kind: IndexedMetric['kind'], needsReferences: boolean, needsSecondReviews = false) => {
    const condition = ADVISOR_CONDITION[name]
    index[name] = {
      ...metric,
      direction,
      kind,
      needs_references: needsReferences,
      ...(needsSecondReviews ? { needs_second_reviews: true as const } : {}),
      // Never pooled silently: in a report that mixes both conditions, every combined figure says so.
      ...(condition ? { style_dna_condition: condition } : quality.style_dna.mixed ? { pooled_over_style_dna: true as const } : {}),
    }
  }

  add('validity.valid_output_rate', quality.by_case.valid_output_rate, 'higher_is_better', 'rate', false)
  add('end_to_end.verdict_band_agreement_rate', quality.by_case.verdict_band_agreement_rate, 'higher_is_better', 'rate', false)
  add('abstention.recall', quality.by_case.abstention_recall, 'higher_is_better', 'rate', false)
  add('abstention.false_abstention_rate', quality.by_case.false_abstention_rate, 'lower_is_better', 'rate', false)
  // Already one yes-or-no value per repeated case.
  add('stability.same_outcome_case_rate', rateFromProportion(metrics.stability.same_outcome_case_rate, metrics.stability.cases_with_repeats, 'Unavailable: no case was run more than once'), 'higher_is_better', 'rate', false)
  for (const key of DIMENSION_KEYS) add(`stability.rating.${key}`, quality.stability_by_dimension[key], 'higher_is_better', 'rate', false)

  for (const tier of SCORED_TIERS) {
    const agreement = quality.agreement[tier]
    add(`agreement.${tier}.coverage`, agreement.coverage, 'higher_is_better', 'rate', true)
    for (const key of DIMENSION_KEYS) {
      add(`agreement.${tier}.${key}.exact_rate`, agreement.dimensions[key].exact_rate, 'higher_is_better', 'rate', true)
      add(`agreement.${tier}.${key}.within_one_rate`, agreement.dimensions[key].within_one_rate, 'higher_is_better', 'rate', true)
      add(`agreement.${tier}.${key}.mae`, agreement.dimensions[key].mae, 'lower_is_better', 'bands', true)
      // Reviewer-to-reviewer agreement is not indexed: it describes the reviews, not the outputs, so it cannot regress.
      add(`agreement.${tier}.${key}.within_reviewer_range_rate`, quality.reviewer_agreement[tier].model_within_reviewer_range[key], 'higher_is_better', 'rate', true, true)
    }

    const grounding = quality.grounding[tier]
    add(`grounding.${tier}.key_fact_mention_rate`, grounding.key_fact_mention_rate, 'higher_is_better', 'rate', true)
    add(`grounding.${tier}.supporting_fact_mention_rate`, grounding.supporting_fact_mention_rate, 'higher_is_better', 'rate', true)
    add(`grounding.${tier}.contradiction_rate`, grounding.contradiction_rate, 'lower_is_better', 'rate', true)
    add(`grounding.${tier}.unverifiable_claim_rate`, grounding.unverifiable_claim_rate, 'lower_is_better', 'rate', true)
    add(`grounding.${tier}.uncertainty_handling_rate`, grounding.uncertainty_handling_rate, 'higher_is_better', 'rate', true)

    const calibration = quality.calibration[tier]
    add(`calibration.${tier}.high_confidence_error_rate`, calibration.high_confidence_error_rate, 'lower_is_better', 'rate', true)
    add(`calibration.${tier}.high_confidence_severe_error_rate`, calibration.high_confidence_severe_error_rate, 'lower_is_better', 'rate', true)
    add(`calibration.${tier}.confidence_gap`, calibration.confidence_gap, 'higher_is_better', 'rate', true)

    add(`garment_identification.${tier}.garment_type_accuracy`, quality.garment_identification[tier].garment_type_accuracy, 'higher_is_better', 'rate', true)

    for (const mode of GARMENT_MODES) {
      add(`multi_image.${mode}.agreement.${tier}.exact_rate`, quality.multi_image.modes[mode].agreement[tier].exact_rate, 'higher_is_better', 'rate', true)
      add(`multi_image.${mode}.agreement.${tier}.mae`, quality.multi_image.modes[mode].agreement[tier].mae, 'lower_is_better', 'bands', true)
    }
  }

  for (const mode of GARMENT_MODES) {
    add(`multi_image.${mode}.valid_output_rate`, quality.multi_image.modes[mode].valid_output_rate, 'higher_is_better', 'rate', false)
    add(`multi_image.${mode}.repeat_rating_stability`, quality.multi_image.modes[mode].repeat_rating_stability, 'higher_is_better', 'rate', false)
  }
  add('multi_image.outfit_items.completeness_rate', quality.multi_image.outfit_items.completeness_rate, 'higher_is_better', 'rate', false)
  add('shopping_advisor.availability_rate', quality.shopping_advisor.availability_rate, 'higher_is_better', 'rate', false)
  add('shopping_advisor.mistargeted_recommendation_rate', quality.shopping_advisor.mistargeted_recommendation_rate, 'lower_is_better', 'rate', false)
  add('shopping_advisor.unrequested_recommendation_rate', quality.shopping_advisor.unrequested_recommendation_rate, 'lower_is_better', 'rate', false)
  add('multi_image.comparison_groups.cross_mode_rating_consistency', quality.multi_image.comparison_groups.cross_mode_rating_consistency, 'higher_is_better', 'rate', true)
  add('multi_image.comparison_groups.mean_band_shift', quality.multi_image.comparison_groups.mean_band_shift, 'lower_is_better', 'bands', true)
  for (const entry of visualEvidenceMetrics(quality.visual_evidence)) add(entry.name, entry.metric, entry.lowerIsBetter ? 'lower_is_better' : 'higher_is_better', 'rate', entry.needsReferences)

  return index
}

// ---------------------------------------------------------------------------
// Separate figures for each Style DNA condition
// ---------------------------------------------------------------------------

/** The name of a figure computed for one Style DNA condition only. */
export function styleDnaMetricName(condition: StyleDnaCondition, name: string): string {
  return `style_dna.${condition}.${name}`
}

/**
 * Every figure of the metric index, computed again for the cases with a Style
 * DNA profile only and for the cases without one only. Empty when the evaluated
 * cases hold one condition, because then nothing is pooled and the ordinary
 * figures already describe that condition.
 *
 * The figures are produced by the same code as the pooled ones, run on the
 * cases of one condition: there is no second definition of any metric that
 * could drift from the first. Everything that holds for a pooled figure holds
 * here too: the unit is a case, tiers are never merged, and hand-written
 * outputs are never scored against human reviews.
 *
 * One rule is stricter. A pooled figure built from fewer than MIN_SAMPLE cases
 * is shown and marked `insufficient_sample`. A separate figure built from
 * fewer is `unavailable`: it has no value at all.
 */
export function buildStyleDnaIndex(
  details: RunDetail[],
  cases: BenchmarkCase[],
  references: Map<string, ResolvedReference>,
  outputs: 'model' | 'synthetic_fixture',
  carriesVisualEvidence = false,
): MetricIndex {
  const groups: Record<StyleDnaCondition, BenchmarkCase[]> = {
    with_style_dna: cases.filter((benchmarkCase) => benchmarkCase.style_dna !== undefined),
    without_style_dna: cases.filter((benchmarkCase) => benchmarkCase.style_dna === undefined),
  }
  if (groups.with_style_dna.length === 0 || groups.without_style_dna.length === 0) return {}

  const index: MetricIndex = {}
  for (const condition of STYLE_DNA_CONDITIONS) {
    const subset = groups[condition]
    const ids = new Set(subset.map((benchmarkCase) => benchmarkCase.id))
    const subsetDetails = details.filter((detail) => ids.has(detail.case_id))
    const subsetIndex = buildMetricIndex(computeMetrics(subsetDetails, subset), computeQuality(subsetDetails, subset, references, outputs, carriesVisualEvidence))
    for (const name of Object.keys(subsetIndex).sort()) {
      // The advisor figures are already specific to one condition in the main index.
      if (name.startsWith('shopping_advisor.')) continue
      const metric = subsetIndex[name]
      const separate: IndexedMetric = metric.status === 'insufficient_sample'
        ? { ...metric, status: 'unavailable', reason: `Unavailable: only ${metric.n} unit(s) ${CONDITION_WORDS[condition]} stand behind this figure; a separate figure needs at least ${MIN_SAMPLE}. See the pooled figure "${name}".`, value: null, n: 0, se: null }
        : metric
      index[styleDnaMetricName(condition, name)] = { ...separate, style_dna_condition: condition }
    }
  }
  return index
}
