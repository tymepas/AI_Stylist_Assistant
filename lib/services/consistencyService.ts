import { COLOUR_FAMILIES } from '@/lib/services/openai/observationsSchema'
import { OCCASION_PROFILES, occasionProfile } from '@/lib/constants/occasionProfiles'
import type { ConsistencyFlag, Dimensions, Observations, RatingEvidence } from '@/types/schema'

/**
 * Consistency between each rating, its explanation, the observations and the
 * evidence (Phase 4 Milestone 4).
 *
 * These checks FLAG; they never change a rating, rewrite an explanation or
 * fill anything in. The verdict is computed from the six ratings before any of
 * this runs and is never touched by it. A flag is shown next to the rating it
 * concerns, so the reader can weigh the explanation; it is not an error in the
 * analysis as a whole.
 *
 * The checks are deliberately narrow, to avoid flagging sound explanations:
 * - `colour_not_observed`: the explanation names a broad colour family that
 *   no garment observation reported, while colours were observed. Sentences
 *   about skin, hair or eyes are skipped: they describe the person's colouring,
 *   not the garment. Dress codes such as "black tie" and the occasion names
 *   are not colours either.
 * - `occasion_not_selected`: the occasion explanation names a different
 *   occasion from the catalogue and never the selected one.
 * - `confident_on_partial_evidence`: an Excellent rating stated with High
 *   confidence while its own evidence says the support is only partial.
 *
 * Evidence that cites something unseen, or that contradicts its rating, is
 * already refused by validation (ratingEvidenceSchema.ts) and is not repeated here.
 */

const PERSON_WORDS = /\b(skin|undertone|complexion|hair|eyes?|colouring|coloring)\b/i

/** Distinctive occasion words, each with the occasions it belongs to. Generic words such as "event" or "day" are left out. */
const OCCASION_TERMS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['wedding', ['Wedding Guest', 'Wedding Reception']],
  ['interview', ['Corporate Interview', 'Startup Interview']],
  ['black tie', ['Black Tie Event']],
  ['cocktail', ['Cocktail Party']],
  ['beach', ['Beach']],
  ['conference', ['Conference']],
  ['award', ['Award Ceremony']],
  ['house party', ['House Party']],
  ['birthday', ['Birthday Party']],
  ['networking', ['Networking Event']],
  ['vacation', ['Vacation']],
  ['college', ['College']],
]

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?;])\s+/)
}

/** Phrases that contain a colour word without naming a garment colour: dress codes and the occasions themselves. */
const NON_COLOUR_PHRASES = ['black tie', 'white tie', ...OCCASION_PROFILES.map((profile) => profile.label.toLowerCase())]

function garmentColoursNamed(reason: string): string[] {
  const named = new Set<string>()
  for (const sentence of sentences(reason)) {
    if (PERSON_WORDS.test(sentence)) continue
    let lower = sentence.toLowerCase()
    for (const phrase of NON_COLOUR_PHRASES) lower = lower.split(phrase).join(' ')
    for (const family of COLOUR_FAMILIES) if (new RegExp(`\\b${family}\\b`).test(lower)) named.add(family)
  }
  return [...named].sort()
}

export interface ConsistencyInput {
  dimensions: Dimensions
  observations?: Observations
  evidence?: RatingEvidence
  occasion?: string
}

export function checkConsistency({ dimensions, observations, evidence, occasion }: ConsistencyInput): ConsistencyFlag[] {
  const flags: ConsistencyFlag[] = []
  const keys = Object.keys(dimensions) as Array<keyof Dimensions>

  // Colours named in an explanation but never observed on a garment.
  if (observations?.availability === 'available') {
    const seen = new Set<string>(observations.images.flatMap((entry) => (entry.colour_status === 'not_visible' ? [] : [...entry.colours.dominant, ...entry.colours.secondary])))
    if (seen.size > 0) {
      for (const key of keys) {
        const unseen = garmentColoursNamed(dimensions[key].reason).filter((family) => !seen.has(family))
        if (unseen.length > 0) flags.push({ dimension: key, code: 'colour_not_observed', detail: unseen.join(', ') })
      }
    }
  }

  // An occasion explanation about a different occasion.
  if (occasion && occasionProfile(occasion)) {
    const reason = dimensions.occasion.reason.toLowerCase()
    const selected = occasion.toLowerCase()
    const others = OCCASION_TERMS.filter(([term, labels]) => !labels.includes(occasion) && !selected.includes(term) && new RegExp(`\\b${term}\\b`).test(reason))
    const mentionsSelected = selected.split(/\s+/).some((word) => word.length >= 4 && reason.includes(word))
    if (others.length > 0 && !mentionsSelected) flags.push({ dimension: 'occasion', code: 'occasion_not_selected', detail: others.map(([term]) => term).join(', ') })
  }

  // High confidence on evidence that says it is partial.
  for (const key of keys) {
    const support = evidence?.dimensions[key]?.support
    if (dimensions[key].rating === 'Excellent' && dimensions[key].confidence === 'High' && support === 'partial') {
      flags.push({ dimension: key, code: 'confident_on_partial_evidence' })
    }
  }
  return flags
}

/** Occasion labels, exported so a test can confirm every distinctive term belongs to a real occasion. */
export const CONSISTENCY_OCCASION_TERMS = OCCASION_TERMS
export const CATALOGUE_LABELS = OCCASION_PROFILES.map((profile) => profile.label)
