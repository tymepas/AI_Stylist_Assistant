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
 * Every figure is reported once per reference TIER (see reference.ts). Only the
 * `image_reviewed` tier is evidence about accuracy on real images, and only
 * when the outputs came from a model. Without such references that tier reads
 * "Unavailable: insufficient human-reviewed ground truth". It never reads 0.
 *
 * A figure built from fewer than MIN_SAMPLE units is marked
 * `insufficient_sample`: the value is shown, and nothing may be concluded from it.
 *
 * Nothing here computes a verdict, and nothing here calls a model or the network.
 */

import type { RawOpenAIConfidence, RawOpenAIDimensions, RawOpenAIRating } from '@/types/openai'
import { DIMENSION_KEYS, type BenchmarkCase, type DimensionKey } from '@/benchmark/harness'
import { GARMENT_MODES, type GarmentMode } from '@/lib/constants/garmentModes'
import { validateOutfitComponents } from '@/lib/services/openai/outfitComponentsSchema'
import type { EvaluationMetrics, RunDetail } from './metrics'
import { KEY_FACT_ATTRIBUTES, SCORED_TIERS, type CaseReference, type KeyFactAttribute, type ReferenceRating, type ResolvedReference, type ScoredTier } from './reference'

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/** Fewest units (cases, items or runs, depending on the metric) a figure needs before anything is concluded from it. */
export const MIN_SAMPLE = 10
/** A rate must move by more than this, in absolute terms, to count as a change. */
export const NOISE_FLOOR_RATE = 0.05
/** A figure measured in rating bands (a mean absolute error) must move by more than this. */
export const NOISE_FLOOR_BANDS = 0.25
/** Width of the noise margin in standard errors of the difference (about 95%). */
export const NOISE_Z = 1.96

export const UNAVAILABLE_NO_GROUND_TRUTH = 'Unavailable: insufficient human-reviewed ground truth'
export const UNAVAILABLE_FIXTURE_OUTPUTS = 'Unavailable: the outputs are hand-written fixtures, not model outputs'

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
  /** How many units the figure is built from. What a unit is depends on the metric (see METRIC_DEFINITIONS). */
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

function unavailable(reason: string): Metric {
  return { status: 'unavailable', reason, value: null, n: 0, se: null }
}

function sampled(value: number, n: number, se: number | null): Metric {
  if (n < MIN_SAMPLE) {
    return { status: 'insufficient_sample', reason: `Built from ${n} unit(s); at least ${MIN_SAMPLE} are needed before anything is concluded.`, value: round(value), n, se: se === null ? null : round(se) }
  }
  return { status: 'measured', value: round(value), n, se: se === null ? null : round(se) }
}

/**
 * A rate from one value in [0, 1] per unit. The standard error uses the
 * binomial formula, which is exact for 0/1 units and conservative (too wide,
 * never too narrow) for units that are themselves averages over repeated runs.
 */
export function rateMetric(values: number[], reason: string): Metric {
  if (values.length === 0) return unavailable(reason)
  const p = mean(values)
  return sampled(p, values.length, Math.sqrt((p * (1 - p)) / values.length))
}

/** A mean of one value per unit (for example a mean absolute error), with the standard error of that mean. */
export function meanMetric(values: number[], reason: string): Metric {
  if (values.length === 0) return unavailable(reason)
  const m = mean(values)
  const se = values.length < 2 ? null : Math.sqrt(values.reduce((sum, value) => sum + (value - m) ** 2, 0) / (values.length - 1) / values.length)
  return sampled(m, values.length, se)
}

/** A rate given as a proportion and a count, for figures computed elsewhere. */
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
  /** Complete runs only: the ones that carry ratings. */
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

function fractions(runs: CompleteRun[], of: (run: CompleteRun) => boolean): number {
  return runs.filter(of).length / runs.length
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
  /** Of those, cases with at least one complete run. */
  cases_with_output: number
  /** cases_with_output / reference_cases. Low coverage means the agreement figures describe only part of the references. */
  coverage: Metric
  dimensions: Record<DimensionKey, DimensionAgreement>
}

function agreementOf(scored: ScoredCase[], referenceCases: number, reason: string): AgreementBlock {
  const dimensions = Object.fromEntries(DIMENSION_KEYS.map((key) => {
    const exact: number[] = []
    const withinOne: number[] = []
    const errors: number[] = []
    for (const { reference, runs } of scored) {
      const expected = reference.dimension_ratings?.[key]?.rating
      if (expected === undefined) continue
      const comparisons = runs.map((run) => compareRating(run.dimensions[key].rating, expected))
      // One value per case: the share of its runs that agree. Repeated runs never count as extra cases.
      exact.push(comparisons.filter((comparison) => comparison.exact).length / comparisons.length)
      withinOne.push(comparisons.filter((comparison) => comparison.within_one).length / comparisons.length)
      const distances = comparisons.map((comparison) => comparison.distance).filter((distance): distance is number => distance !== null)
      if (distances.length > 0) errors.push(mean(distances))
    }
    return [key, { exact_rate: rateMetric(exact, reason), within_one_rate: rateMetric(withinOne, reason), mae: meanMetric(errors, reason) }]
  })) as Record<DimensionKey, DimensionAgreement>

  return {
    reference_cases: referenceCases,
    cases_with_output: scored.length,
    coverage: rateFromProportion(referenceCases === 0 ? null : scored.length / referenceCases, referenceCases, reason),
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
  return scored.map(({ reference, runs }) => {
    const comparisons = runs.flatMap((run) => DIMENSION_KEYS.flatMap((key) => {
      const expected = reference.dimension_ratings?.[key]?.rating
      return expected === undefined ? [] : [compareRating(run.dimensions[key].rating, expected)]
    }))
    const distances = comparisons.map((comparison) => comparison.distance).filter((distance): distance is number => distance !== null)
    return {
      exact: comparisons.length === 0 ? 0 : comparisons.filter((comparison) => comparison.exact).length / comparisons.length,
      within_one: comparisons.length === 0 ? 0 : comparisons.filter((comparison) => comparison.within_one).length / comparisons.length,
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
  /** Where the reviewer said a dimension cannot be judged: how often the model left it unrated or stated Low confidence. */
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
    if (contradicting.length > 0) contradictions.push(texts.filter((text) => contradicting.some((term) => mentions(text, term))).length / texts.length)
    const hidden = reference.unverifiable_terms ?? []
    if (hidden.length > 0) unverifiable.push(texts.filter((text) => hidden.some((term) => mentions(text, term))).length / texts.length)

    for (const dimension of DIMENSION_KEYS) {
      if (reference.dimension_ratings?.[dimension]?.rating !== UNRATED) continue
      uncertainty.push(fractions(runs, (run) => run.dimensions[dimension].rating === UNRATED || run.dimensions[dimension].confidence === 'Low'))
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
  /** Agreement with the reference among ratings stated at each confidence. A unit is one dimension of one case. */
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
  const units = Object.fromEntries(CONFIDENCE_LEVELS.map((level) => [level, { exact: [] as number[], withinOne: [] as number[], severe: [] as number[] }])) as Record<RawOpenAIConfidence, { exact: number[]; withinOne: number[]; severe: number[] }>

  for (const { reference, runs } of scored) {
    for (const key of DIMENSION_KEYS) {
      const expected = reference.dimension_ratings?.[key]?.rating
      if (expected === undefined) continue
      for (const level of CONFIDENCE_LEVELS) {
        const comparisons = runs.filter((run) => run.dimensions[key].confidence === level).map((run) => compareRating(run.dimensions[key].rating, expected))
        if (comparisons.length === 0) continue
        units[level].exact.push(comparisons.filter((comparison) => comparison.exact).length / comparisons.length)
        units[level].withinOne.push(comparisons.filter((comparison) => comparison.within_one).length / comparisons.length)
        units[level].severe.push(comparisons.filter((comparison) => comparison.severe).length / comparisons.length)
      }
    }
  }

  const buckets = Object.fromEntries(CONFIDENCE_LEVELS.map((level) => [level, {
    exact_rate: rateMetric(units[level].exact, reason),
    within_one_rate: rateMetric(units[level].withinOne, reason),
  }])) as CalibrationBlock['buckets']

  const high = buckets.High.exact_rate
  const low = buckets.Low.exact_rate
  let gap: Metric
  if (high.value === null || low.value === null) {
    gap = unavailable(scored.length === 0 ? reason : 'Unavailable: needs ratings stated at both High and Low confidence')
  } else {
    const value = round(high.value - low.value)
    const se = round(Math.sqrt((high.se ?? 0) ** 2 + (low.se ?? 0) ** 2))
    const n = Math.min(high.n, low.n)
    gap = high.status === 'measured' && low.status === 'measured'
      ? { status: 'measured', value, n, se }
      : { status: 'insufficient_sample', reason: `One confidence level has fewer than ${MIN_SAMPLE} rated dimensions.`, value, n, se }
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
    high_confidence_error_rate: rateMetric(units.High.exact.map((value) => 1 - value), reason),
    high_confidence_severe_error_rate: rateMetric(units.High.severe, reason),
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
  /** Share of outfit items whose `garment_type` in the per-item notes equals the reference. A unit is one item. */
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
  const items: number[] = []
  let cases = 0
  for (const { benchmarkCase, reference, runs } of scored) {
    const expected = reference.garment_facts?.items ?? []
    if (modeOf(benchmarkCase) !== 'outfit_items' || expected.length === 0) continue
    cases += 1
    // A run without a valid block says nothing about identification; it is counted under completeness instead.
    const blocks = runs.map((run) => validComponents(run, garmentCount(benchmarkCase))).filter((block): block is NonNullable<typeof block> => block !== null)
    if (blocks.length === 0) continue
    for (const entry of expected) {
      items.push(blocks.filter((block) => block.find((component) => component.item === entry.item)?.garment_type === entry.garment_type).length / blocks.length)
    }
  }
  return { cases, garment_type_accuracy: rateMetric(items, reason) }
}

// ---------------------------------------------------------------------------
// 4. Multi-image
// ---------------------------------------------------------------------------

export interface ModeBlock {
  cases: number
  scored_runs: number
  /** Share of runs that returned an output matching the schema. A unit is one run. */
  valid_output_rate: Metric
  /** Share of dimensions that got the same rating on every repeated run. A unit is one case with repeats. */
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
    /** Share of complete outfit runs with exactly one valid per-item note for each garment image. A unit is one run. */
    completeness_rate: Metric
    /** Complete runs of the other modes that returned per-item notes, where none are expected. */
    unexpected_blocks_in_other_modes: number
  }
  comparison_groups: {
    /** Groups with at least two cases that produced ratings. */
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
    const stability: number[] = []
    for (const benchmarkCase of members) {
      const complete = completeRuns(runsByCase.get(benchmarkCase.id) ?? [])
      if (complete.length < 2) continue
      stability.push(DIMENSION_KEYS.filter((key) => new Set(complete.map((run) => run.dimensions[key].rating)).size === 1).length / DIMENSION_KEYS.length)
    }
    const block: ModeBlock = {
      cases: members.length,
      scored_runs: runs.length,
      valid_output_rate: rateFromProportion(runs.length === 0 ? null : runs.filter((run) => run.outcome !== 'error').length / runs.length, runs.length, 'Unavailable: no run in this mode'),
      repeat_rating_stability: rateMetric(stability, 'Unavailable: no case in this mode was run more than once'),
      runs_with_unsupported_claims: runs.filter((run) => run.forbidden_claim_hits.length > 0 || run.prohibited_hits.some((label) => UNSUPPORTED_CLAIM_LABELS.includes(label))).length,
      agreement: Object.fromEntries(SCORED_TIERS.map((tier) => [tier, pooledAgreement(scoredByTier[tier].filter((entry) => modeOf(entry.benchmarkCase) === mode), reasonByTier[tier])])) as Record<ScoredTier, PooledAgreement>,
    }
    return [mode, block]
  })) as Record<GarmentMode, ModeBlock>

  // --- outfit completeness -------------------------------------------------
  const outfitRuns: boolean[] = []
  let unexpected = 0
  for (const benchmarkCase of cases) {
    for (const run of completeRuns(runsByCase.get(benchmarkCase.id) ?? [])) {
      if (modeOf(benchmarkCase) === 'outfit_items') outfitRuns.push(validComponents(run, garmentCount(benchmarkCase)) !== null)
      else if (run.outfit_components !== undefined) unexpected += 1
    }
  }

  // --- comparison groups ---------------------------------------------------
  const byId = new Map(cases.map((benchmarkCase) => [benchmarkCase.id, benchmarkCase]))
  const groups = new Map<string, Array<{ benchmarkCase: BenchmarkCase; runs: CompleteRun[] }>>()
  for (const [caseId, { reference }] of references) {
    const benchmarkCase = byId.get(caseId)
    const runs = completeRuns(runsByCase.get(caseId) ?? [])
    if (!reference.comparison_group || !benchmarkCase || runs.length === 0) continue
    groups.set(reference.comparison_group, [...(groups.get(reference.comparison_group) ?? []), { benchmarkCase, runs }])
  }

  const consistency: number[] = []
  const shifts: number[] = []
  const details: ComparisonGroupDetail[] = []
  const deltas = Object.fromEntries(SCORED_TIERS.map((tier) => [tier, [] as number[]])) as Record<ScoredTier, number[]>
  for (const group of [...groups.keys()].sort()) {
    const members = (groups.get(group) ?? []).sort((a, b) => a.benchmarkCase.id.localeCompare(b.benchmarkCase.id))
    if (members.length < 2) continue
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

  const noGroups = 'Unavailable: no comparison group has two cases with ratings'
  return {
    modes,
    outfit_items: {
      completeness_rate: rateMetric(outfitRuns.map((valid) => (valid ? 1 : 0)), 'Unavailable: no complete run of an outfit case'),
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
  agreement: Record<ScoredTier, AgreementBlock>
  grounding: Record<ScoredTier, GroundingBlock>
  calibration: Record<ScoredTier, CalibrationBlock>
  garment_identification: Record<ScoredTier, GarmentIdentificationBlock>
  multi_image: MultiImageBlock
  /** Per dimension: share of repeated cases that got the same rating on every run. A unit is one case with repeats. */
  stability_by_dimension: Record<DimensionKey, Metric>
  /** What the current output cannot support, so that a missing figure is never read as a measured one. */
  not_measurable: Record<string, string>
  /** Cases whose manifest lists `expected.key_facts` as plain text. Those are for a reviewer; only the facts of a reference are scored. */
  cases_with_unscored_manifest_facts: number
}

export const NOT_MEASURABLE: Record<string, string> = {
  colour_identification: 'The output has no colour field. Colour is covered only by the grounding proxy (key facts with attribute "colour").',
  pattern_identification: 'The output has no pattern field. Pattern is covered only by the grounding proxy (key facts with attribute "pattern").',
  single_garment_identification: 'The output names a garment type only for the items of an outfit. A single garment, and views of one garment, carry none.',
  contradictions_between_views: 'One output is returned for all views, so views cannot be compared with each other. Only the ratings of cases in one comparison group can.',
}

export function computeQuality(
  details: RunDetail[],
  cases: BenchmarkCase[],
  references: Map<string, ResolvedReference>,
  outputs: 'model' | 'synthetic_fixture',
): QualityReport {
  const scoredRuns = details.filter((detail) => detail.outcome !== 'withheld')
  const runsByCase = new Map<string, RunDetail[]>()
  for (const detail of scoredRuns) runsByCase.set(detail.case_id, [...(runsByCase.get(detail.case_id) ?? []), detail])

  // Hand-written outputs agreeing with a human review would say nothing about a model, so that tier stays empty for them.
  const eligible = (tier: ScoredTier) => !(tier === 'image_reviewed' && outputs !== 'model')
  const referenceCases = Object.fromEntries(SCORED_TIERS.map((tier) => [tier, cases.filter((benchmarkCase) => references.get(benchmarkCase.id)?.tier === tier)])) as Record<ScoredTier, BenchmarkCase[]>
  const reasonByTier = Object.fromEntries(SCORED_TIERS.map((tier) => [tier, !eligible(tier) && referenceCases[tier].length > 0 ? UNAVAILABLE_FIXTURE_OUTPUTS : NO_REFERENCES[tier]])) as Record<ScoredTier, string>
  const scoredByTier = Object.fromEntries(SCORED_TIERS.map((tier) => [tier, !eligible(tier) ? [] : referenceCases[tier]
    .map((benchmarkCase) => ({ benchmarkCase, reference: (references.get(benchmarkCase.id) as ResolvedReference).reference, runs: completeRuns(runsByCase.get(benchmarkCase.id) ?? []) }))
    .filter((entry) => entry.runs.length > 0)])) as Record<ScoredTier, ScoredCase[]>

  const perTier = <T>(make: (tier: ScoredTier) => T) => Object.fromEntries(SCORED_TIERS.map((tier) => [tier, make(tier)])) as Record<ScoredTier, T>

  const stability = Object.fromEntries(DIMENSION_KEYS.map((key) => {
    const values: number[] = []
    for (const runs of runsByCase.values()) {
      const complete = completeRuns(runs)
      if (complete.length >= 2) values.push(new Set(complete.map((run) => run.dimensions[key].rating)).size === 1 ? 1 : 0)
    }
    return [key, rateMetric(values, 'Unavailable: no case was run more than once')]
  })) as Record<DimensionKey, Metric>

  const imageCases = eligible('image_reviewed') ? scoredByTier.image_reviewed.length : 0
  return {
    thresholds: { min_sample: MIN_SAMPLE, noise_floor_rate: NOISE_FLOOR_RATE, noise_floor_bands: NOISE_FLOOR_BANDS, noise_z: NOISE_Z },
    image_grounded_accuracy: imageCases > 0
      ? { status: 'available', cases: imageCases }
      : { status: 'unavailable', reason: reasonByTier.image_reviewed, cases: 0 },
    agreement: perTier((tier) => agreementOf(scoredByTier[tier], eligible(tier) ? referenceCases[tier].length : 0, reasonByTier[tier])),
    grounding: perTier((tier) => groundingOf(scoredByTier[tier], reasonByTier[tier])),
    calibration: perTier((tier) => calibrationOf(scoredByTier[tier], reasonByTier[tier])),
    garment_identification: perTier((tier) => garmentIdentificationOf(scoredByTier[tier], reasonByTier[tier])),
    multi_image: multiImageOf(cases, runsByCase, references, scoredByTier, reasonByTier),
    stability_by_dimension: stability,
    not_measurable: NOT_MEASURABLE,
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
}

export type MetricIndex = Record<string, IndexedMetric>

/**
 * Flattens a report's figures into `name -> metric`, so two reports can be
 * compared metric by metric (see classifyMetricChanges in regression.ts).
 * Names are stable; adding a metric never renames an existing one.
 */
export function buildMetricIndex(metrics: EvaluationMetrics, quality: QualityReport): MetricIndex {
  const index: MetricIndex = {}
  const add = (name: string, metric: Metric, direction: IndexedMetric['direction'], kind: IndexedMetric['kind'], needsReferences: boolean) => {
    index[name] = { ...metric, direction, kind, needs_references: needsReferences }
  }
  const nothing = 'Unavailable: nothing to measure'

  add('validity.valid_output_rate', rateFromProportion(metrics.structured_output.valid_rate, metrics.runs, nothing), 'higher_is_better', 'rate', false)
  add('end_to_end.verdict_band_agreement_rate', rateFromProportion(metrics.verdict_band.agreement_rate, metrics.verdict_band.graded_runs, 'Unavailable: no case states acceptable bands'), 'higher_is_better', 'rate', false)
  add('abstention.recall', rateFromProportion(metrics.abstention.recall, metrics.abstention.expected_runs, 'Unavailable: no case expects an abstention'), 'higher_is_better', 'rate', false)
  add('abstention.false_abstention_rate', rateFromProportion(metrics.abstention.false_abstention_rate, metrics.runs - metrics.abstention.expected_runs, nothing), 'lower_is_better', 'rate', false)
  add('stability.same_outcome_case_rate', rateFromProportion(metrics.stability.same_outcome_case_rate, metrics.stability.cases_with_repeats, 'Unavailable: no case was run more than once'), 'higher_is_better', 'rate', false)
  for (const key of DIMENSION_KEYS) add(`stability.rating.${key}`, quality.stability_by_dimension[key], 'higher_is_better', 'rate', false)

  for (const tier of SCORED_TIERS) {
    const agreement = quality.agreement[tier]
    add(`agreement.${tier}.coverage`, agreement.coverage, 'higher_is_better', 'rate', true)
    for (const key of DIMENSION_KEYS) {
      add(`agreement.${tier}.${key}.exact_rate`, agreement.dimensions[key].exact_rate, 'higher_is_better', 'rate', true)
      add(`agreement.${tier}.${key}.within_one_rate`, agreement.dimensions[key].within_one_rate, 'higher_is_better', 'rate', true)
      add(`agreement.${tier}.${key}.mae`, agreement.dimensions[key].mae, 'lower_is_better', 'bands', true)
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
  add('multi_image.comparison_groups.cross_mode_rating_consistency', quality.multi_image.comparison_groups.cross_mode_rating_consistency, 'higher_is_better', 'rate', true)
  add('multi_image.comparison_groups.mean_band_shift', quality.multi_image.comparison_groups.mean_band_shift, 'lower_is_better', 'bands', true)

  return index
}
