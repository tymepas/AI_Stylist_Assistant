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
 *   no garment observation reported, while colours were observed. Skipped:
 *   sentences about skin, hair or eyes (the person's colouring, not the
 *   garment); sentences that suggest or compare (a "would", "could", "pair",
 *   shoes or accessories that were not photographed); dress codes and idioms
 *   such as "black tie", "red carpet" and "off-white"; the occasion names; and
 *   a colour word right next to an observed one ("navy blue" when navy was
 *   observed).
 * - `occasion_not_selected`: the occasion explanation names a different
 *   occasion from the catalogue and never the selected one. Dress codes such
 *   as "cocktail" or "black tie" describe formality, not an occasion, and are
 *   not counted; neither are closely related occasions (a beach and a
 *   vacation).
 * - `confident_on_partial_evidence`: an Excellent rating stated with High
 *   confidence while its own evidence says the support is only partial.
 *
 * Evidence that cites something unseen, or that contradicts its rating, is
 * already refused by validation (ratingEvidenceSchema.ts) and is not repeated here.
 */

const PERSON_WORDS = /\b(skin|undertone|complexion|hair|eyes?|colouring|coloring)\b/i
/** Sentences that suggest, compare or talk about things not in the photos. */
const SUGGESTION_WORDS = /\b(would|could|might|consider|try|instead|pair(s|ed|ing)?|add(s|ed|ing)?|swap\w*|shoes?|boots?|bags?|belts?|accessor\w*|jewel\w*)\b/i

/**
 * Distinctive occasion words, each with the occasions it belongs to or is
 * closely related to. Generic words such as "event" or "day" are left out, and
 * so are dress codes ("cocktail", "black tie"): they describe formality.
 */
const OCCASION_TERMS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['wedding', ['Wedding Guest', 'Wedding Reception']],
  ['interview', ['Corporate Interview', 'Startup Interview']],
  ['beach', ['Beach', 'Vacation']],
  ['conference', ['Conference', 'Networking Event']],
  ['award', ['Award Ceremony']],
  ['house party', ['House Party', 'Birthday Party']],
  ['birthday', ['Birthday Party', 'House Party']],
  ['networking', ['Networking Event', 'Conference']],
  ['vacation', ['Vacation', 'Beach', 'Travel']],
  ['college', ['College']],
]

/** Words of an occasion name that are also ordinary words ("it works", "any event"): they do not show the explanation is about that occasion. */
const GENERIC_OCCASION_WORDS = new Set(['work', 'event', 'party'])

function wordPattern(term: string): RegExp {
  return new RegExp(`\\b${term}(s|es)?\\b`)
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?;])\s+/)
}

/** Phrases that contain a colour word without naming a garment colour: dress codes, idioms and the occasions themselves (hyphens read as spaces). */
const NON_COLOUR_PHRASES = ['black tie', 'white tie', 'red carpet', 'off white', ...OCCASION_PROFILES.map((profile) => profile.label.toLowerCase())]
const FAMILY_SET = new Set<string>(COLOUR_FAMILIES)

function garmentColoursNamed(reason: string, seen: ReadonlySet<string>): string[] {
  const named = new Set<string>()
  for (const sentence of sentences(reason)) {
    if (PERSON_WORDS.test(sentence) || SUGGESTION_WORDS.test(sentence)) continue
    let lower = sentence.toLowerCase().replace(/-/g, ' ')
    for (const phrase of NON_COLOUR_PHRASES) lower = lower.split(phrase).join(' . ')
    const words = lower.match(/[a-z]+|[^a-z\s]+/g) ?? []
    words.forEach((word, index) => {
      if (!FAMILY_SET.has(word)) return
      // Part of a compound with an observed colour ("navy blue", "blue-grey" when grey was observed).
      if (seen.has(words[index - 1] ?? '') || seen.has(words[index + 1] ?? '')) return
      named.add(word)
    })
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
        const unseen = garmentColoursNamed(dimensions[key].reason, seen).filter((family) => !seen.has(family))
        if (unseen.length > 0) flags.push({ dimension: key, code: 'colour_not_observed', detail: unseen.join(', ') })
      }
    }
  }

  // An occasion explanation about a different occasion.
  if (occasion && occasionProfile(occasion)) {
    const reason = dimensions.occasion.reason.toLowerCase()
    const selected = occasion.toLowerCase()
    const others = OCCASION_TERMS.filter(([term, labels]) => !labels.includes(occasion) && !selected.includes(term) && wordPattern(term).test(reason))
    const mentionsSelected = selected.split(/\s+/).some((word) => word.length >= 4 && !GENERIC_OCCASION_WORDS.has(word) && wordPattern(word).test(reason))
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
