/**
 * How ready a human-reviewed dataset is to be measured against.
 *
 * It answers, before any model is called: how many CASES are there per garment
 * mode, how many of them have a finished image review, how many were rated by
 * a second person, and where those two people differ.
 *
 * Cases and images are counted apart. Every sample size in an evaluation counts
 * cases, so an outfit of three items adds one, not three.
 *
 * Pure: no file or network access.
 */

import { compositionLines, describeComposition, MIN_CASES_PER_MODE, type BenchmarkCase, type DatasetComposition } from '@/benchmark/harness'
import { GARMENT_MODES, type GarmentMode } from '@/lib/constants/garmentModes'
import { STYLE_DNA_CONDITIONS, reviewerDisagreement, type ReviewerDisagreement, type StyleDnaCondition } from './quality'
import { RECORDABLE_SOURCES } from './recording'
import { resolveReferences, type ReferenceSet } from './reference'

export interface DatasetReadiness {
  composition: DatasetComposition
  /** Cases with a complete image review, per garment mode. */
  image_reviewed_by_mode: Record<GarmentMode, number>
  /**
   * Of those, the cases that can contribute to an agreement figure: their model output may be recorded, and
   * they are expected to produce ratings (a case that should abstain produces none). Only these count.
   */
  scorable_by_mode: Record<GarmentMode, number>
  /** How many more such cases each mode needs before its figures count as measured. */
  scorable_short_by: Record<GarmentMode, number>
  /** Such cases in total. */
  image_reviewed_scorable: number
  /**
   * The same cases by Style DNA condition. Style DNA is a condition on a case, not a garment mode: a figure is
   * reported separately for a condition only where that condition has enough cases, and is unavailable otherwise.
   */
  scorable_by_style_dna: Record<StyleDnaCondition, { total: number; by_mode: Record<GarmentMode, number> }>
  second_reviews: {
    /** Image-reviewed cases that a second person rated as well. */
    cases: number
    reviewers: string[]
    /** Cases on which the reviewers gave different ratings for at least one dimension. */
    disagreements: ReviewerDisagreement[]
  }
  /** True when every garment mode has enough scorable image-reviewed cases for a measured figure. */
  ready_for_measured_figures: boolean
}

export function describeReadiness(set: ReferenceSet, cases: BenchmarkCase[]): DatasetReadiness {
  const resolved = resolveReferences(set, cases)
  const reviewed = cases.filter((benchmarkCase) => resolved.get(benchmarkCase.id)?.tier === 'image_reviewed')
  const perMode = (cases: BenchmarkCase[]) => Object.fromEntries(GARMENT_MODES.map((mode) => [mode, cases.filter((benchmarkCase) => (benchmarkCase.garment_mode ?? 'single') === mode).length])) as Record<GarmentMode, number>
  // The recorder withholds model text for photos that were not published under a licence, so those cases are never scored.
  const scorable = reviewed.filter((benchmarkCase) => RECORDABLE_SOURCES.includes(benchmarkCase.source) && !benchmarkCase.expected.should_abstain)
  const byMode = perMode(reviewed)
  const scorableByMode = perMode(scorable)
  const shortBy = Object.fromEntries(GARMENT_MODES.map((mode) => [mode, Math.max(0, MIN_CASES_PER_MODE - scorableByMode[mode])])) as Record<GarmentMode, number>
  const references = reviewed.map((benchmarkCase) => resolved.get(benchmarkCase.id)!.reference)
  const twice = references.filter((reference) => (reference.second_reviews ?? []).length > 0)

  return {
    composition: describeComposition(cases),
    image_reviewed_by_mode: byMode,
    scorable_by_mode: scorableByMode,
    scorable_short_by: shortBy,
    image_reviewed_scorable: scorable.length,
    scorable_by_style_dna: Object.fromEntries(STYLE_DNA_CONDITIONS.map((condition) => {
      const subset = scorable.filter((benchmarkCase) => (benchmarkCase.style_dna !== undefined) === (condition === 'with_style_dna'))
      return [condition, { total: subset.length, by_mode: perMode(subset) }]
    })) as DatasetReadiness['scorable_by_style_dna'],
    second_reviews: {
      cases: twice.length,
      reviewers: [...new Set(twice.flatMap((reference) => (reference.second_reviews ?? []).map((review) => review.reviewer.id)))].sort(),
      disagreements: twice
        .map((reference) => reviewerDisagreement(reference) as ReviewerDisagreement)
        .filter((entry) => entry.dimensions.length > 0)
        .sort((a, b) => a.case_id.localeCompare(b.case_id)),
    },
    ready_for_measured_figures: GARMENT_MODES.every((mode) => shortBy[mode] === 0),
  }
}

/** Which figures can be reported separately for each Style DNA condition, and which exist only pooled. */
function styleDnaLines(readiness: DatasetReadiness): string[] {
  const { with_style_dna: withProfile, without_style_dna: without } = readiness.scorable_by_style_dna
  const counts = (entry: { total: number; by_mode: Record<GarmentMode, number> }) => `single ${entry.by_mode.single}, same_garment_views ${entry.by_mode.same_garment_views}, outfit_items ${entry.by_mode.outfit_items} (${entry.total} in all)`
  // Before any case is reviewed there is nothing to report in either condition: say that, not that nothing is pooled.
  if (withProfile.total === 0 && without.total === 0) return ['Style DNA condition: no reviewed case can give ratings yet. The case matrix shows what the plan would report with and without Style DNA.']
  if (withProfile.total === 0 || without.total === 0) {
    return [`Style DNA condition: every case that can give ratings is ${withProfile.total > 0 ? 'with' : 'without'} Style DNA, so no figure is pooled.`]
  }
  const separate: string[] = []
  const pooledOnly: string[] = []
  const judge = (label: string, n: number) => (n >= MIN_CASES_PER_MODE ? separate : pooledOnly).push(`${label} (${n})`)
  judge('all cases without Style DNA', without.total)
  judge('all cases with Style DNA', withProfile.total)
  for (const mode of GARMENT_MODES) {
    judge(`${mode} without`, without.by_mode[mode])
    judge(`${mode} with`, withProfile.by_mode[mode])
  }
  return [
    `Cases that can give ratings, without Style DNA: ${counts(without)}`,
    `Cases that can give ratings, with Style DNA: ${counts(withProfile)}`,
    `Style DNA is a condition, not a garment mode. Separate figures (at least ${MIN_CASES_PER_MODE} cases): ${separate.length > 0 ? separate.join('; ') : 'none'}.`,
    `Unavailable as separate figures, reported only as figures labelled pooled: ${pooledOnly.length > 0 ? pooledOnly.join('; ') : 'none'}.`,
  ]
}

/** The readiness in plain lines, for the validator. Identifiers and counts only. */
export function readinessLines(readiness: DatasetReadiness): string[] {
  const { image_reviewed_by_mode: byMode, scorable_by_mode: scorable, scorable_short_by: shortBy, second_reviews: second } = readiness
  const reviewedTotal = GARMENT_MODES.reduce((sum, mode) => sum + byMode[mode], 0)
  const short = GARMENT_MODES.filter((mode) => shortBy[mode] > 0).map((mode) => `${mode} needs ${shortBy[mode]} more`)
  const lines = [
    ...compositionLines(readiness.composition),
    `Image-reviewed cases by mode: single ${byMode.single}, same_garment_views ${byMode.same_garment_views}, outfit_items ${byMode.outfit_items}`,
    `Of those, cases that can give ratings to score (output recorded for public_license images only; a case that should abstain gives none): single ${scorable.single}, same_garment_views ${scorable.same_garment_views}, outfit_items ${scorable.outfit_items} (${readiness.image_reviewed_scorable} of ${reviewedTotal})`,
    readiness.ready_for_measured_figures
      ? `Reviews per mode: every garment mode has at least ${MIN_CASES_PER_MODE} such cases. A mode with exactly ${MIN_CASES_PER_MODE} has no margin: one case without a complete output puts its figures back to "too few to conclude".`
      : `Reviews per mode: NOT enough for measured figures (${MIN_CASES_PER_MODE} such cases per mode): ${short.join(', ')}.`,
    ...styleDnaLines(readiness),
    second.cases === 0
      ? 'Second reviews: none. Every rating is one person\'s judgement and has not been checked against another\'s.'
      : `Second reviews: ${second.cases} case(s) rated by a second person (${second.reviewers.join(', ')}); reviewers differ on ${second.disagreements.length} of them.`,
  ]
  for (const entry of second.disagreements) {
    lines.push(`  reviewers differ on ${entry.case_id}: ${entry.dimensions.join(', ')}${entry.severe.length > 0 ? ` (far apart: ${entry.severe.join(', ')})` : ''}`)
  }
  return lines
}
