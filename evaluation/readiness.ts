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
import { reviewerDisagreement, type ReviewerDisagreement } from './quality'
import { resolveReferences, type ReferenceSet } from './reference'

export interface DatasetReadiness {
  composition: DatasetComposition
  /** Cases with a complete image review, per garment mode. These are what per-mode figures are built from. */
  image_reviewed_by_mode: Record<GarmentMode, number>
  /** How many more image-reviewed cases each mode needs before its figures count as measured. */
  image_reviewed_short_by: Record<GarmentMode, number>
  /** Image-reviewed cases whose model output a recording may store, and so can be scored. */
  image_reviewed_scorable: number
  second_reviews: {
    /** Image-reviewed cases that a second person rated as well. */
    cases: number
    reviewers: string[]
    /** Cases on which the reviewers gave different ratings for at least one dimension. */
    disagreements: ReviewerDisagreement[]
  }
  /** True when every garment mode has enough image-reviewed cases for a measured figure. */
  ready_for_measured_figures: boolean
}

export function describeReadiness(set: ReferenceSet, cases: BenchmarkCase[]): DatasetReadiness {
  const resolved = resolveReferences(set, cases)
  const reviewed = cases.filter((benchmarkCase) => resolved.get(benchmarkCase.id)?.tier === 'image_reviewed')
  const byMode = Object.fromEntries(GARMENT_MODES.map((mode) => [mode, reviewed.filter((benchmarkCase) => (benchmarkCase.garment_mode ?? 'single') === mode).length])) as Record<GarmentMode, number>
  const shortBy = Object.fromEntries(GARMENT_MODES.map((mode) => [mode, Math.max(0, MIN_CASES_PER_MODE - byMode[mode])])) as Record<GarmentMode, number>
  const references = reviewed.map((benchmarkCase) => resolved.get(benchmarkCase.id)!.reference)
  const twice = references.filter((reference) => (reference.second_reviews ?? []).length > 0)

  return {
    composition: describeComposition(cases),
    image_reviewed_by_mode: byMode,
    image_reviewed_short_by: shortBy,
    // The recorder withholds model text for photos of people who did not publish them under a licence.
    image_reviewed_scorable: reviewed.filter((benchmarkCase) => benchmarkCase.source === 'public_license').length,
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

/** The readiness in plain lines, for the validator. Identifiers and counts only. */
export function readinessLines(readiness: DatasetReadiness): string[] {
  const { image_reviewed_by_mode: byMode, image_reviewed_short_by: shortBy, second_reviews: second } = readiness
  const reviewedTotal = GARMENT_MODES.reduce((sum, mode) => sum + byMode[mode], 0)
  const short = GARMENT_MODES.filter((mode) => shortBy[mode] > 0).map((mode) => `${mode} needs ${shortBy[mode]} more`)
  const lines = [
    ...compositionLines(readiness.composition),
    `Image-reviewed cases by mode: single ${byMode.single}, same_garment_views ${byMode.same_garment_views}, outfit_items ${byMode.outfit_items} (${readiness.image_reviewed_scorable} of ${reviewedTotal} can be scored: only public_license outputs are recorded)`,
    readiness.ready_for_measured_figures
      ? `Reviews per mode: every garment mode has at least ${MIN_CASES_PER_MODE} image-reviewed cases.`
      : `Reviews per mode: NOT enough for measured figures (${MIN_CASES_PER_MODE} image-reviewed cases per mode): ${short.join(', ')}.`,
    second.cases === 0
      ? 'Second reviews: none. Every rating is one person\'s judgement and has not been checked against another\'s.'
      : `Second reviews: ${second.cases} case(s) rated by a second person (${second.reviewers.join(', ')}); reviewers differ on ${second.disagreements.length} of them.`,
  ]
  for (const entry of second.disagreements) {
    lines.push(`  reviewers differ on ${entry.case_id}: ${entry.dimensions.join(', ')}${entry.severe.length > 0 ? ` (two bands or more apart: ${entry.severe.join(', ')})` : ''}`)
  }
  return lines
}
