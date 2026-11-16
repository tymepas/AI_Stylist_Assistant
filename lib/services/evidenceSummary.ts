import type { Dimensions, OverallRecommendation } from '@/types/schema'

/**
 * How much evidence a verdict rests on, for display only.
 *
 * The verdict is computed by `computeVerdict` and by nothing else. This module
 * never changes a rating, the score or the band. It only describes them, so the
 * report can say plainly when a verdict rests on few or uncertain ratings
 * instead of presenting every verdict with the same apparent certainty.
 *
 * The weights and thresholds below are DISPLAY COPIES of the values inside
 * `computeVerdict`. tests/core/evidenceSummary.test.ts derives the real values
 * from `computeVerdict` and fails if a copy ever disagrees with it.
 */

export type DimensionKey = keyof Dimensions

/** The dimensions in the order the report shows them: by weight, then the one that is displayed but not weighted. */
export const DIMENSION_DISPLAY: ReadonlyArray<{ key: DimensionKey; label: string; weightPercent: number | null }> = [
  { key: 'occasion', label: 'Occasion fit', weightPercent: 30 },
  { key: 'formality', label: 'Formality', weightPercent: 25 },
  { key: 'style_preference_match', label: 'Style preference match', weightPercent: 20 },
  { key: 'color', label: 'Color harmony', weightPercent: 15 },
  { key: 'seasonality', label: 'Seasonality', weightPercent: 10 },
  { key: 'style', label: 'Style consistency', weightPercent: null },
]

/** The lowest score of each band, from the best band down. Scores run from 0 to 5. */
export const BAND_FLOORS: ReadonlyArray<{ band: OverallRecommendation; floor: number }> = [
  { band: 'Highly Recommended', floor: 4.5 },
  { band: 'Recommended', floor: 3.5 },
  { band: 'Consider Alternatives', floor: 2.5 },
  { band: 'Not Recommended', floor: 0 },
]

export const MAX_SCORE = 5

export type EvidenceLevel = 'full' | 'limited' | 'insufficient'

export interface EvidenceSummary {
  /** `full`: every weighted dimension was rated, none with Low confidence. `insufficient`: none could be rated. */
  level: EvidenceLevel
  weightedTotal: number
  weightedRated: number
  /** Weighted dimensions left "Unable to Evaluate". */
  unrated: DimensionKey[]
  /** Rated weighted dimensions whose stated confidence is Low. */
  lowConfidence: DimensionKey[]
  /** Share of the verdict's weight that was actually rated, 0 to 100. */
  coveragePercent: number
}

export function labelOf(key: DimensionKey): string {
  return DIMENSION_DISPLAY.find((entry) => entry.key === key)?.label ?? key
}

export function summarizeEvidence(dimensions: Dimensions): EvidenceSummary {
  const weighted = DIMENSION_DISPLAY.filter((entry) => entry.weightPercent !== null)
  const unrated = weighted.filter((entry) => dimensions[entry.key]?.rating === 'Unable to Evaluate').map((entry) => entry.key)
  const rated = weighted.filter((entry) => !unrated.includes(entry.key))
  const lowConfidence = rated.filter((entry) => dimensions[entry.key]?.confidence === 'Low').map((entry) => entry.key)
  const coveragePercent = rated.reduce((sum, entry) => sum + (entry.weightPercent as number), 0)

  const level: EvidenceLevel = rated.length === 0 ? 'insufficient' : unrated.length > 0 || lowConfidence.length > 0 ? 'limited' : 'full'
  return { level, weightedTotal: weighted.length, weightedRated: rated.length, unrated, lowConfidence, coveragePercent }
}

function list(keys: DimensionKey[]): string {
  const labels = keys.map((key) => labelOf(key).toLowerCase())
  if (labels.length <= 1) return labels.join('')
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}

/** One or two plain sentences for the report. Empty when the evidence is full. */
export function describeEvidence(summary: EvidenceSummary): string[] {
  if (summary.level === 'full') return []
  if (summary.level === 'insufficient') {
    return ['None of the dimensions that make up the verdict could be evaluated from these photos, so this result says very little. Clearer photos will give a real answer.']
  }
  const lines: string[] = []
  if (summary.unrated.length > 0) {
    lines.push(`This verdict rests on ${summary.weightedRated} of ${summary.weightedTotal} weighted dimensions (${summary.coveragePercent}% of the weight). Not evaluated: ${list(summary.unrated)}.`)
  }
  if (summary.lowConfidence.length > 0) {
    lines.push(`Low confidence on ${list(summary.lowConfidence)}: treat ${summary.lowConfidence.length === 1 ? 'that rating' : 'those ratings'} as tentative.`)
  }
  return lines
}
