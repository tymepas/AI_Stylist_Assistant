/**
 * Evaluation of the informational blocks of analysis-output/3: `observations`
 * (what is visible in each garment image) and `evidence` (what each rating
 * rests on).
 *
 * Two kinds of figure, kept apart:
 *
 * - STRUCTURAL figures need no reference. They describe the outputs
 *   themselves: is the block valid, does every citation point at an
 *   observation that exists, does evidence name only inputs that were sent,
 *   does it contradict its rating, are the images mapped correctly. On
 *   hand-written fixtures they test Verdict's own validation code; on a model
 *   recording they describe that model. The report's provenance says which.
 * - REFERENCE figures compare observations with what a reviewer recorded for
 *   the case (garment type, colour families, pattern, visible and absent
 *   details, whether views show one garment). They follow the rules of every
 *   other reference figure: one value per case, per tier, the image-reviewed
 *   tier only for model outputs, and "unavailable" rather than a number when
 *   there is nothing to measure.
 *
 * A recording made with an earlier schema (before observations and evidence
 * existed) is never scored as if its outputs had left the blocks out: every
 * figure here is then unavailable, with that reason.
 *
 * The blocks are validated with the production validators, so an evaluation
 * can never accept what the application would refuse, or the reverse.
 *
 * Nothing here computes a verdict, and nothing here calls a model or the network.
 */

import type { RawOpenAIDimensions } from '@/types/openai'
import type { Observations, RatingEvidence } from '@/types/schema'
import { GARMENT_MODES, type GarmentMode } from '@/lib/constants/garmentModes'
import { inspectObservations, type ObservationInspection } from '@/lib/services/openai/observationsSchema'
import { inspectEvidence, type EvidenceInspection, type EvidenceProblem } from '@/lib/services/openai/ratingEvidenceSchema'
import { validateOutfitComponents } from '@/lib/services/openai/outfitComponentsSchema'
import { hasStylePreferences } from '@/lib/services/visualEvidenceService'
import { DIMENSION_KEYS, type BenchmarkCase, type DimensionKey } from '@/benchmark/harness'
import type { RunDetail } from './metrics'
import { SCORED_TIERS, type CaseReference, type ScoredTier } from './reference'
import { mentions, normaliseText, rateMetric, type Metric } from './quality'

export const UNAVAILABLE_EARLIER_SCHEMA = 'Unavailable: the recording was made with an output schema from before observations and evidence existed (analysis-output/3)'
const NO_RUN = 'Unavailable: no complete run'

type CompleteRun = RunDetail & { dimensions: RawOpenAIDimensions }

export interface VisualContext {
  mode: GarmentMode
  garmentCount: number
  hasStyleDna: boolean
  hasStylePreferences: boolean
}

export function visualContextOf(benchmarkCase: BenchmarkCase): VisualContext {
  return {
    mode: benchmarkCase.garment_mode ?? 'single',
    garmentCount: 1 + (benchmarkCase.extra_garments?.length ?? 0),
    hasStyleDna: benchmarkCase.style_dna !== undefined,
    hasStylePreferences: hasStylePreferences(benchmarkCase.style_profile),
  }
}

export interface RunInspection {
  observations: ObservationInspection | null
  evidence: EvidenceInspection | null
  /** The validated observations, or null. */
  validObservations: Observations | null
  validEvidence: RatingEvidence
}

/** Inspects the two blocks of one complete run exactly as the application would. `null` means the block was absent. */
export function inspectRun(benchmarkCase: BenchmarkCase, run: CompleteRun): RunInspection {
  const context = visualContextOf(benchmarkCase)
  const observations = run.observations === undefined ? null : inspectObservations(run.observations, { mode: context.mode, garmentCount: context.garmentCount })
  const validObservations = observations?.value ?? null
  const evidence = run.evidence === undefined
    ? null
    : inspectEvidence(run.evidence, { dimensions: run.dimensions, observations: validObservations, hasStyleDna: context.hasStyleDna, hasStylePreferences: context.hasStylePreferences })
  return { observations, evidence, validObservations, validEvidence: evidence?.value ?? { availability: 'unavailable', dimensions: {} } }
}

function evidenceHas(inspection: RunInspection, problem: EvidenceProblem): boolean {
  return inspection.evidence !== null && Object.values(inspection.evidence.problems).some((problems) => problems?.includes(problem))
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

// ---------------------------------------------------------------------------
// Which observations a dimension is expected to rest on (a proxy)
// ---------------------------------------------------------------------------

/**
 * A rated dimension's evidence is RELEVANT when it points at the kind of fact
 * that dimension is about: colour harmony at a colour, occasion fit at the
 * occasion, preference match at the stated preferences, and so on. A PROXY: it
 * checks what the evidence points at, not whether the reasoning is right.
 */
function relevant(key: DimensionKey, evidence: NonNullable<RatingEvidence['dimensions'][DimensionKey]>, context: VisualContext): boolean | null {
  const cites = (field: string) => evidence.cites.some((cite) => cite.split('.')[1]?.startsWith(field))
  switch (key) {
    case 'occasion':
      return evidence.sources.includes('occasion')
    case 'color':
      return cites('colour')
    case 'formality':
      return cites('type') || cites('d')
    case 'seasonality':
      return cites('type') || cites('d') || cites('colour')
    case 'style':
      return cites('type') || cites('pattern') || cites('d')
    case 'style_preference_match':
      if (!context.hasStylePreferences && !context.hasStyleDna) return null
      return evidence.sources.includes('style_preferences') || evidence.sources.includes('style_dna')
  }
}

// ---------------------------------------------------------------------------
// Structural figures
// ---------------------------------------------------------------------------

export interface StructuralBlock {
  /** Per case: share of its complete runs whose observations passed validation. */
  observations_valid_rate: Metric
  /** Per case: share of its complete runs with valid evidence for all six dimensions. */
  evidence_complete_rate: Metric
  /** Per case, over runs with usable observations and parsable evidence: share citing an observation that does not exist or was not visible. */
  invalid_citation_rate: Metric
  /** Per case: share of runs naming an input that was not sent (Style DNA or preferences). */
  unsupplied_source_rate: Metric
  /** Per case: share of runs whose evidence contradicts its rating (an unrated dimension with sufficient support, or the reverse). */
  support_conflict_rate: Metric
  /** Per case: share of runs whose observation or evidence text states a price, a material, a brand, quality, a link or an instruction. */
  unsupported_text_rate: Metric
  /** Per case: share of runs whose observations do not map one entry to each garment image, or misuse the views entry. */
  image_mapping_error_rate: Metric
  /** Views cases only. Per case: share of runs whose views are said to show one garment while being identified as different garments. */
  view_contradiction_rate: Metric
  /** Outfit cases only. Per case: share of items whose per-item note and observation name the same kind of garment. */
  outfit_identity_consistency_rate: Metric
  /** PROXY. Per case: share of rated dimensions whose evidence points at the kind of fact the dimension is about. */
  evidence_relevance_proxy_rate: Metric
}

export interface ReferenceVisualBlock {
  /** Cases of this tier whose reference records garment facts or a same-garment answer, and that have scored runs. */
  cases: number
  /** Per case: share of identifiable items whose observed category equals the reviewer's garment type. */
  garment_category_accuracy: Metric
  /** Per case: share of identifiable items identified with confidence (`observed`) as a different kind of garment. */
  confident_misidentification_rate: Metric
  /** Per case with an item a reviewer could not identify: share of those items where the model did not claim an identification. */
  identification_abstention_rate: Metric
  /** Per case: share of the reviewer's dominant colour families that the model reported (as dominant or secondary). */
  dominant_colour_recall: Metric
  /** Per case: share of the model's colour families that the reviewer did not list. */
  unsupported_colour_rate: Metric
  /** Per case: share of items with a clear pattern whose observed pattern equals the reviewer's. */
  pattern_accuracy: Metric
  /** Per case with a pattern a reviewer could not judge, or a colour not visible: share where the model did not state it as observed. */
  visual_abstention_rate: Metric
  /** Per case: share of model details that mention a detail the reviewer confirmed. */
  supported_detail_rate: Metric
  /** Per case: share of model details that mention a detail the reviewer confirmed absent, or a term the case marks unverifiable. */
  contradicted_detail_rate: Metric
  /** Views cases only: share of runs answering yes or no whose answer matches the reviewer's. An "unclear" answer is an abstention and is left out. */
  same_garment_agreement_rate: Metric
  /** Per case: share of the photo limits a reviewer listed that the model reported for that image. */
  limit_recall: Metric
}

export interface VisualEvidenceReport {
  /** False when the recording predates the blocks; every figure is then unavailable. */
  applicable: boolean
  reason?: string
  structural: StructuralBlock
  by_tier: Record<ScoredTier, ReferenceVisualBlock>
  /** Runs per garment mode whose observations were valid, for reading the structural figures. */
  valid_runs_by_mode: Record<GarmentMode, number>
}

function unavailableMetric(reason: string): Metric {
  return { status: 'unavailable', reason, value: null, n: 0, se: null }
}

/** One value per case: the mean over its complete runs of a per-run value. Runs that return null are left out. */
function perCase(cases: BenchmarkCase[], runsByCase: Map<string, CompleteRun[]>, value: (benchmarkCase: BenchmarkCase, run: CompleteRun, inspection: RunInspection) => number | null, reason: string, include: (benchmarkCase: BenchmarkCase) => boolean = () => true): Metric {
  const values: number[] = []
  for (const benchmarkCase of cases) {
    if (!include(benchmarkCase)) continue
    const runValues = (runsByCase.get(benchmarkCase.id) ?? [])
      .map((run) => value(benchmarkCase, run, inspectRun(benchmarkCase, run)))
      .filter((entry): entry is number => entry !== null)
    if (runValues.length > 0) values.push(mean(runValues))
  }
  return rateMetric(values, reason)
}

/** Observations that were present and had the right shape: only then can mapping, text or contradiction problems be seen. */
function observationsParsed(inspection: RunInspection): boolean {
  return inspection.observations !== null && !inspection.observations.problems.includes('schema')
}

/** Evidence that was present and had the right block shape. */
function evidenceParsed(inspection: RunInspection): boolean {
  return inspection.evidence !== null && inspection.evidence.blockProblems.length === 0
}

function structuralOf(cases: BenchmarkCase[], runsByCase: Map<string, CompleteRun[]>): StructuralBlock {
  const flag = (test: (inspection: RunInspection) => boolean) => (_: BenchmarkCase, __: CompleteRun, inspection: RunInspection) => (test(inspection) ? 1 : 0)
  /** A problem rate over the runs where the problem could have been seen. Other runs are left out, never counted as clean. */
  const problemRate = (judgeable: (inspection: RunInspection) => boolean, test: (inspection: RunInspection) => boolean) => (_: BenchmarkCase, __: CompleteRun, inspection: RunInspection) => (judgeable(inspection) ? (test(inspection) ? 1 : 0) : null)
  const mode = (wanted: GarmentMode) => (benchmarkCase: BenchmarkCase) => visualContextOf(benchmarkCase).mode === wanted
  return {
    observations_valid_rate: perCase(cases, runsByCase, flag((inspection) => inspection.validObservations !== null), NO_RUN),
    evidence_complete_rate: perCase(cases, runsByCase, flag((inspection) => inspection.validEvidence.availability === 'available'), NO_RUN),
    // Only runs whose observations were usable: there a failed citation is a real citation error, not a
    // knock-on effect of refused observations (that is counted under observations_valid_rate).
    invalid_citation_rate: perCase(cases, runsByCase, problemRate((inspection) => evidenceParsed(inspection) && inspection.validObservations !== null, (inspection) => evidenceHas(inspection, 'invalid_citation')), 'Unavailable: no run with usable observations and parsable evidence'),
    unsupplied_source_rate: perCase(cases, runsByCase, problemRate(evidenceParsed, (inspection) => evidenceHas(inspection, 'unsupplied_source')), 'Unavailable: no run with parsable evidence'),
    support_conflict_rate: perCase(cases, runsByCase, problemRate(evidenceParsed, (inspection) => evidenceHas(inspection, 'support_conflict')), 'Unavailable: no run with parsable evidence'),
    unsupported_text_rate: perCase(cases, runsByCase, problemRate((inspection) => observationsParsed(inspection) || evidenceParsed(inspection), (inspection) => Boolean(inspection.observations?.problems.includes('unsupported_text')) || evidenceHas(inspection, 'unsupported_text')), 'Unavailable: no run with a parsable block'),
    image_mapping_error_rate: perCase(cases, runsByCase, problemRate(observationsParsed, (inspection) => (inspection.observations?.problems ?? []).some((problem) => problem === 'image_mapping' || problem === 'views_missing' || problem === 'views_unexpected')), 'Unavailable: no run with parsable observations'),
    view_contradiction_rate: perCase(cases, runsByCase, problemRate(observationsParsed, (inspection) => Boolean(inspection.observations?.problems.includes('views_contradiction'))), 'Unavailable: no run of a views case with parsable observations', mode('same_garment_views')),
    outfit_identity_consistency_rate: perCase(cases, runsByCase, (benchmarkCase, run, inspection) => {
      if (!inspection.validObservations) return null
      let components: Array<{ item: number; garment_type: string }>
      try {
        components = validateOutfitComponents(run.outfit_components, visualContextOf(benchmarkCase).garmentCount)
      } catch {
        return null
      }
      const identified = inspection.validObservations.images.filter((entry) => entry.identification === 'observed')
      if (identified.length === 0) return null
      return identified.filter((entry) => components.find((component) => component.item === entry.image)?.garment_type === entry.category).length / identified.length
    }, 'Unavailable: no outfit run with valid observations and valid per-item notes', mode('outfit_items')),
    evidence_relevance_proxy_rate: perCase(cases, runsByCase, (benchmarkCase, run, inspection) => {
      const context = visualContextOf(benchmarkCase)
      const judged = DIMENSION_KEYS
        .filter((key) => run.dimensions[key].rating !== 'Unable to Evaluate')
        .map((key) => {
          const evidence = inspection.validEvidence.dimensions[key]
          return evidence ? relevant(key, evidence, context) : null
        })
        .filter((entry): entry is boolean => entry !== null)
      return judged.length === 0 ? null : judged.filter(Boolean).length / judged.length
    }, 'Unavailable: no run with valid evidence for a rated dimension'),
  }
}

// ---------------------------------------------------------------------------
// Figures against reviewer references
// ---------------------------------------------------------------------------

type GarmentFact = NonNullable<CaseReference['garment_facts']>['items'][number]

interface ScoredEntry {
  benchmarkCase: BenchmarkCase
  reference: CaseReference
  runs: CompleteRun[]
}

/** One value per case from its runs with valid observations. `perItem` returns null for an item it cannot judge. */
function itemMetric(scored: ScoredEntry[], reason: string, perItem: (fact: GarmentFact, observations: Observations, entry: ScoredEntry) => number | null): Metric {
  const values: number[] = []
  for (const entry of scored) {
    const facts = entry.reference.garment_facts?.items ?? []
    if (facts.length === 0) continue
    const runValues: number[] = []
    for (const run of entry.runs) {
      const observations = inspectRun(entry.benchmarkCase, run).validObservations
      if (!observations) continue
      const itemValues = facts.map((fact) => perItem(fact, observations, entry)).filter((value): value is number => value !== null)
      if (itemValues.length > 0) runValues.push(mean(itemValues))
    }
    if (runValues.length > 0) values.push(mean(runValues))
  }
  return rateMetric(values, reason)
}

function observationFor(observations: Observations, item: number) {
  return observations.images.find((entry) => entry.image === item)
}

/** A reviewer term matches a detail when a word of the detail starts with it, so "lapel" matches "notched lapels". */
function mentionsStem(detail: string, term: string): boolean {
  const text = ` ${normaliseText(detail)}`
  const stem = normaliseText(term)
  return stem.length > 0 && (text.includes(` ${stem}`) || mentions(normaliseText(detail), term))
}

function detailShare(fact: GarmentFact, observations: Observations, terms: string[] | undefined): number | null {
  const observation = observationFor(observations, fact.item)
  if (!observation || observation.details.length === 0 || !terms || terms.length === 0) return null
  return observation.details.filter((detail) => terms.some((term) => mentionsStem(detail, term))).length / observation.details.length
}

/** Photo limits such as `shadow` and `partial_view` exist only from analysis-output/4 on; an earlier recording is never scored against them. */
export const UNAVAILABLE_LIMITS_BEFORE_PHASE4 = 'Unavailable: the recording was made with an output schema from before the current photo limit codes (analysis-output/4)'

function referenceBlockOf(scored: ScoredEntry[], reason: string, phase4: boolean): ReferenceVisualBlock {
  const withFacts = scored.filter((entry) => (entry.reference.garment_facts?.items.length ?? 0) > 0)
  const withViews = scored.filter((entry) => entry.reference.views_same_garment !== undefined && visualContextOf(entry.benchmarkCase).mode === 'same_garment_views')
  const sameGarment: number[] = []
  for (const entry of scored) {
    const expected = entry.reference.views_same_garment
    if (expected === undefined || visualContextOf(entry.benchmarkCase).mode !== 'same_garment_views') continue
    // "unclear" is an abstention, not an answer: it is left out rather than scored as a disagreement.
    const answers = entry.runs.map((run) => inspectRun(entry.benchmarkCase, run).validObservations?.views?.same_garment).filter((answer): answer is 'yes' | 'no' => answer === 'yes' || answer === 'no')
    if (answers.length > 0) sameGarment.push(answers.filter((answer) => answer === expected).length / answers.length)
  }

  return {
    cases: new Set([...withFacts, ...withViews].map((entry) => entry.benchmarkCase.id)).size,
    garment_category_accuracy: itemMetric(withFacts, reason, (fact, observations) => {
      if (fact.identifiable === false || fact.garment_type === undefined) return null
      return observationFor(observations, fact.item)?.category === fact.garment_type ? 1 : 0
    }),
    confident_misidentification_rate: itemMetric(withFacts, reason, (fact, observations) => {
      if (fact.identifiable === false || fact.garment_type === undefined) return null
      const observation = observationFor(observations, fact.item)
      return observation?.identification === 'observed' && observation.category !== fact.garment_type ? 1 : 0
    }),
    identification_abstention_rate: itemMetric(withFacts, reason, (fact, observations) => {
      if (fact.identifiable !== false) return null
      const observation = observationFor(observations, fact.item)
      return observation && (observation.category === 'unclear' || observation.identification !== 'observed') ? 1 : 0
    }),
    dominant_colour_recall: itemMetric(withFacts, reason, (fact, observations) => {
      const observation = observationFor(observations, fact.item)
      if (!fact.colours || !observation) return null
      const reported = new Set<string>([...observation.colours.dominant, ...observation.colours.secondary])
      return fact.colours.dominant.filter((family) => reported.has(family)).length / fact.colours.dominant.length
    }),
    unsupported_colour_rate: itemMetric(withFacts, reason, (fact, observations) => {
      const observation = observationFor(observations, fact.item)
      if (!fact.colours || !observation) return null
      const reported = [...observation.colours.dominant, ...observation.colours.secondary]
      if (reported.length === 0) return null
      const listed = new Set<string>([...fact.colours.dominant, ...(fact.colours.secondary ?? [])])
      return reported.filter((family) => !listed.has(family)).length / reported.length
    }),
    pattern_accuracy: itemMetric(withFacts, reason, (fact, observations) => {
      if (fact.pattern_category === undefined || fact.pattern_category === 'unclear') return null
      return observationFor(observations, fact.item)?.pattern === fact.pattern_category ? 1 : 0
    }),
    visual_abstention_rate: itemMetric(withFacts, reason, (fact, observations) => {
      const observation = observationFor(observations, fact.item)
      if (!observation) return null
      const checks: number[] = []
      if (fact.pattern_category === 'unclear') checks.push(observation.pattern === 'unclear' ? 1 : 0)
      if (fact.colour_visible === false) checks.push(observation.colour_status !== 'observed' ? 1 : 0)
      return checks.length === 0 ? null : mean(checks)
    }),
    supported_detail_rate: itemMetric(withFacts, reason, (fact, observations) => detailShare(fact, observations, fact.visible_details)),
    contradicted_detail_rate: itemMetric(withFacts, reason, (fact, observations, entry) => {
      const terms = [...(fact.absent_details ?? []), ...(entry.reference.unverifiable_terms ?? [])]
      const observation = observationFor(observations, fact.item)
      if (!observation || observation.details.length === 0) return null
      return terms.length === 0 ? null : detailShare(fact, observations, terms)
    }),
    same_garment_agreement_rate: rateMetric(sameGarment, reason),
    limit_recall: !phase4 ? unavailableMetric(UNAVAILABLE_LIMITS_BEFORE_PHASE4) : itemMetric(withFacts, reason, (fact, observations) => {
      const observation = observationFor(observations, fact.item)
      if (!fact.limits || !observation) return null
      return fact.limits.filter((limit) => observation.limits.includes(limit)).length / fact.limits.length
    }),
  }
}

// ---------------------------------------------------------------------------
// Report section
// ---------------------------------------------------------------------------

const STRUCTURAL_KEYS: Array<keyof StructuralBlock> = [
  'observations_valid_rate', 'evidence_complete_rate', 'invalid_citation_rate', 'unsupplied_source_rate', 'support_conflict_rate',
  'unsupported_text_rate', 'image_mapping_error_rate', 'view_contradiction_rate', 'outfit_identity_consistency_rate', 'evidence_relevance_proxy_rate',
]
const REFERENCE_KEYS: Array<Exclude<keyof ReferenceVisualBlock, 'cases'>> = [
  'garment_category_accuracy', 'confident_misidentification_rate', 'identification_abstention_rate', 'dominant_colour_recall', 'unsupported_colour_rate',
  'pattern_accuracy', 'visual_abstention_rate', 'supported_detail_rate', 'contradicted_detail_rate', 'same_garment_agreement_rate',
  'limit_recall',
]

/** Lower is better for these; higher for every other figure. */
export const LOWER_IS_BETTER = new Set<string>([
  'invalid_citation_rate', 'unsupplied_source_rate', 'support_conflict_rate', 'unsupported_text_rate', 'image_mapping_error_rate',
  'view_contradiction_rate', 'confident_misidentification_rate', 'unsupported_colour_rate', 'contradicted_detail_rate',
])

export function visualEvidenceOf(
  cases: BenchmarkCase[],
  runsByCase: Map<string, RunDetail[]>,
  scoredByTier: Record<ScoredTier, Array<{ benchmarkCase: BenchmarkCase; reference: CaseReference; runs: CompleteRun[] }>>,
  reasonByTier: Record<ScoredTier, string>,
  carriesBlocks: boolean,
  phase4 = carriesBlocks,
): VisualEvidenceReport {
  const emptyModes = Object.fromEntries(GARMENT_MODES.map((mode) => [mode, 0])) as Record<GarmentMode, number>
  if (!carriesBlocks) {
    return {
      applicable: false,
      reason: UNAVAILABLE_EARLIER_SCHEMA,
      structural: Object.fromEntries(STRUCTURAL_KEYS.map((key) => [key, unavailableMetric(UNAVAILABLE_EARLIER_SCHEMA)])) as unknown as StructuralBlock,
      by_tier: Object.fromEntries(SCORED_TIERS.map((tier) => [tier, {
        cases: 0,
        ...Object.fromEntries(REFERENCE_KEYS.map((key) => [key, unavailableMetric(UNAVAILABLE_EARLIER_SCHEMA)])),
      }])) as unknown as Record<ScoredTier, ReferenceVisualBlock>,
      valid_runs_by_mode: emptyModes,
    }
  }

  const complete = new Map<string, CompleteRun[]>()
  for (const [caseId, runs] of runsByCase) complete.set(caseId, runs.filter((run): run is CompleteRun => run.outcome === 'complete' && run.dimensions !== undefined))
  const validByMode = { ...emptyModes }
  for (const benchmarkCase of cases) {
    for (const run of complete.get(benchmarkCase.id) ?? []) if (inspectRun(benchmarkCase, run).validObservations) validByMode[visualContextOf(benchmarkCase).mode] += 1
  }

  return {
    applicable: true,
    structural: structuralOf(cases, complete),
    by_tier: Object.fromEntries(SCORED_TIERS.map((tier) => [tier, referenceBlockOf(scoredByTier[tier], reasonByTier[tier], phase4)])) as Record<ScoredTier, ReferenceVisualBlock>,
    valid_runs_by_mode: validByMode,
  }
}

/** Every figure of the section under a stable name, for the metric index. */
export function visualEvidenceMetrics(report: VisualEvidenceReport): Array<{ name: string; metric: Metric; lowerIsBetter: boolean; needsReferences: boolean }> {
  const out: Array<{ name: string; metric: Metric; lowerIsBetter: boolean; needsReferences: boolean }> = []
  for (const key of STRUCTURAL_KEYS) out.push({ name: `visual_evidence.structural.${key}`, metric: report.structural[key], lowerIsBetter: LOWER_IS_BETTER.has(key), needsReferences: false })
  for (const tier of SCORED_TIERS) {
    for (const key of REFERENCE_KEYS) out.push({ name: `visual_evidence.${tier}.${key}`, metric: report.by_tier[tier][key], lowerIsBetter: LOWER_IS_BETTER.has(key), needsReferences: true })
  }
  return out
}
