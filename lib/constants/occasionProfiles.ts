import { OCCASION_GROUPS } from '@/lib/constants/options'

/**
 * Occasion profiles: what each occasion the app offers usually means, owned
 * and versioned by the application (Phase 4 Milestone 2).
 *
 * A profile GUIDES the model's judgement of occasion fit; it is not a rule.
 * It states a typical formality range, the setting, what usually suits, and
 * how far expectations vary. It names a season only where the occasion itself
 * states one. It never assumes a culture, religion, region or dress code the
 * user did not state; where those decide what is appropriate, `varies` says so.
 *
 * Every occasion in `OCCASION_GROUPS` (the list the user chooses from) has
 * exactly one profile, keyed by its exact label. A value that is not in the
 * list has no profile and is refused by the API; it is never matched to a
 * different occasion. tests/milestone2/occasionIntelligence.test.ts enforces this.
 *
 * Changing any profile changes the analysis prompt version, because the
 * catalogue is part of the prompt fingerprint.
 */

export const OCCASION_PROFILE_VERSION = 'occasion-profiles/1'

/** The formality scale, the same words the Style DNA profile uses. */
export const FORMALITY_LEVELS = ['casual', 'smart casual', 'business casual', 'business formal', 'formal'] as const
export type FormalityLevel = (typeof FORMALITY_LEVELS)[number]

export interface OccasionProfile {
  /** Stable identifier, derived from the label. */
  id: string
  label: string
  group: string
  /** The usual range, lowest first. One level when the range is narrow. */
  formality: readonly [FormalityLevel, FormalityLevel]
  /** Where and when, in a few words. */
  setting: string
  /** What usually suits, in a few words. Never a fabric, brand or price. */
  suits: string
  /** How and why expectations differ. Present where they genuinely vary. */
  varies?: string
  /** Only when the occasion itself states a season or weather. */
  season?: string
}

type Draft = Omit<OccasionProfile, 'id' | 'label' | 'group'>

const DRAFTS: Record<string, Draft> = {
  // --- Work ------------------------------------------------------------------------------------------
  'Office Work': { formality: ['business casual', 'business formal'], setting: 'office, working day', suits: 'neat, practical pieces', varies: 'workplace dress codes differ widely' },
  'Client Meeting': { formality: ['business casual', 'business formal'], setting: 'meeting with clients', suits: 'polished, put-together pieces', varies: 'industry norms differ' },
  'Client Presentation': { formality: ['business casual', 'business formal'], setting: 'presenting to an audience', suits: 'polished, composed pieces', varies: 'industry norms differ' },
  'Corporate Interview': { formality: ['business formal', 'business formal'], setting: 'job interview at a company', suits: 'conservative, tidy pieces', varies: 'some expect a suit, some less' },
  'Startup Interview': { formality: ['smart casual', 'business casual'], setting: 'interview, informal workplace', suits: 'neat, smart, not stiff pieces', varies: 'company cultures differ' },
  'Networking Event': { formality: ['smart casual', 'business casual'], setting: 'professional social event', suits: 'approachable, polished pieces', varies: 'venue and industry differ' },
  'Business Lunch': { formality: ['business casual', 'business casual'], setting: 'working meal at a restaurant', suits: 'tidy business-casual pieces' },
  'Business Casual': { formality: ['business casual', 'business casual'], setting: 'business casual dress code', suits: 'tailored or collared, no full suit' },
  Conference: { formality: ['smart casual', 'business casual'], setting: 'long day indoors, much walking', suits: 'neat, practical layers', varies: 'speakers dress up more' },
  // --- Social ----------------------------------------------------------------------------------------
  'Coffee Date': { formality: ['casual', 'smart casual'], setting: 'café, daytime', suits: 'relaxed but considered pieces' },
  'Dinner Date': { formality: ['smart casual', 'smart casual'], setting: 'restaurant, evening', suits: 'elevated casual pieces', varies: 'restaurants range widely' },
  'First Date': { formality: ['casual', 'smart casual'], setting: 'meeting someone new', suits: 'neat, considered pieces', varies: 'the venue is unknown' },
  'Birthday Party': { formality: ['casual', 'smart casual'], setting: 'celebration', suits: 'festive or expressive pieces', varies: 'party themes and venues differ' },
  'Night Out': { formality: ['smart casual', 'smart casual'], setting: 'evening venues', suits: 'evening-ready, expressive pieces', varies: 'venue dress codes differ' },
  'House Party': { formality: ['casual', 'casual'], setting: "someone's home", suits: 'relaxed pieces' },
  'Cocktail Party': { formality: ['business formal', 'formal'], setting: 'evening social event', suits: 'cocktail attire, polished and dressy pieces' },
  // --- Formal ----------------------------------------------------------------------------------------
  'Wedding Guest': { formality: ['business formal', 'formal'], setting: 'wedding ceremony', suits: 'celebratory, polished pieces', varies: 'dress codes, timing, traditions differ' },
  'Wedding Reception': { formality: ['business formal', 'formal'], setting: 'wedding celebration, often evening', suits: 'festive, polished pieces', varies: 'dress codes, traditions differ' },
  'Formal Dinner': { formality: ['business formal', 'formal'], setting: 'formal evening meal', suits: 'refined, tailored pieces' },
  'Black Tie Event': { formality: ['formal', 'formal'], setting: 'black tie dress code', suits: 'evening formalwear' },
  'Award Ceremony': { formality: ['business formal', 'formal'], setting: 'ceremony, often evening', suits: 'refined, polished pieces', varies: 'the invitation may state a dress code' },
  // --- Casual ----------------------------------------------------------------------------------------
  'Casual Outing': { formality: ['casual', 'casual'], setting: 'everyday, relaxed', suits: 'easy, relaxed pieces' },
  Shopping: { formality: ['casual', 'casual'], setting: 'stores, on foot', suits: 'practical, relaxed pieces' },
  College: { formality: ['casual', 'smart casual'], setting: 'campus', suits: 'practical everyday pieces' },
  Weekend: { formality: ['casual', 'casual'], setting: 'free time', suits: 'relaxed pieces', varies: 'plans are unknown' },
  Travel: { formality: ['casual', 'smart casual'], setting: 'long transit', suits: 'practical, easy-to-layer pieces' },
  Vacation: { formality: ['casual', 'smart casual'], setting: 'holiday', suits: 'relaxed pieces', varies: 'destination unknown' },
  // --- Outdoor / Seasonal ----------------------------------------------------------------------------
  'Outdoor Event': { formality: ['casual', 'smart casual'], setting: 'outdoors', suits: 'pieces practical for outside', varies: 'the weather is unknown' },
  'Summer Event': { formality: ['casual', 'smart casual'], setting: 'summer event', suits: 'lighter-weight, less layered pieces', season: 'summer' },
  'Winter Event': { formality: ['casual', 'business formal'], setting: 'winter event', suits: 'layered, warmer-looking pieces', varies: 'the event type is unknown', season: 'winter' },
  Beach: { formality: ['casual', 'casual'], setting: 'beach, sun and sand', suits: 'light, relaxed pieces', season: 'warm weather' },
  'Rainy Day': { formality: ['casual', 'smart casual'], setting: 'wet weather', suits: 'covered, practical pieces', season: 'rain' },
}

export function occasionId(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** Every profile, in the order the user sees the occasions. */
export const OCCASION_PROFILES: readonly OccasionProfile[] = OCCASION_GROUPS.flatMap((group) =>
  group.options.map((label) => {
    const draft = DRAFTS[label]
    if (!draft) throw new Error(`Occasion "${label}" has no profile`)
    return { id: occasionId(label), label, group: group.label, ...draft }
  }),
)

const BY_LABEL = new Map(OCCASION_PROFILES.map((profile) => [profile.label, profile]))

/** The profile of an occasion, by its exact label. Null for any value that is not an offered occasion. */
export function occasionProfile(label: string): OccasionProfile | null {
  return BY_LABEL.get(label) ?? null
}

export function isKnownOccasion(label: unknown): label is string {
  return typeof label === 'string' && BY_LABEL.has(label)
}

/** The formality range in words, for example "business casual to business formal". */
export function formalityRange(profile: OccasionProfile): string {
  const [low, high] = profile.formality
  return low === high ? low : `${low} to ${high}`
}

/** The profile as it is shown in the report: the same values the model was given. Null for an unknown occasion. */
export function occasionContextOf(label: string): import('@/types/schema').OccasionContext | null {
  const profile = occasionProfile(label)
  if (!profile) return null
  return {
    occasion: profile.label,
    profile_version: OCCASION_PROFILE_VERSION,
    formality: formalityRange(profile),
    setting: profile.setting,
    suits: profile.suits,
    ...(profile.varies ? { varies: profile.varies } : {}),
    ...(profile.season ? { season: profile.season } : {}),
  }
}

/**
 * The profile as one compact prompt line. It is guidance for the model, so it
 * says so; the model is told elsewhere that it is not a rule.
 */
export function occasionProfileLine(profile: OccasionProfile | null): string {
  if (!profile) return 'Profile: none.'
  const parts = [`formality ${formalityRange(profile)}`, `setting ${profile.setting}`, `suits ${profile.suits}`]
  if (profile.varies) parts.push(`varies: ${profile.varies}`)
  if (profile.season) parts.push(`season ${profile.season}`)
  return `Profile: ${parts.join('; ')}.`
}
