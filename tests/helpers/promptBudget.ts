/**
 * The largest analysis prompt text the application can send, in bytes.
 *
 * A token covers at least one byte, so this byte count bounds the text tokens
 * that the spend reservation assumes (`maxTextInputTokens`). It is the worst
 * case over every garment mode and every occasion: each catalogue occasion
 * with its profile line, and an occasion of the maximum length that has no
 * profile (the API refuses one, but a benchmark manifest may carry it). Every
 * client-controlled field holds the most bytes its limit accepts: text limited
 * by characters is filled with 3-byte, single-unit characters, the style
 * profile reaches its byte limit exactly, and every Style DNA choice takes its
 * longest value.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { GARMENT_MODES, MAX_GARMENT_IMAGES, type GarmentMode } from '@/lib/constants/garmentModes'
import { OCCASION_PROFILES } from '@/lib/constants/occasionProfiles'
import { buildAnalysisContent, buildUserContext } from '@/lib/services/openai/openAIAnalysisService'
import { MAX_OCCASION_LENGTH, MAX_STYLE_PROFILE_BYTES, utf8ByteLength } from '@/lib/services/requestLimits'
import { VALID_COMPLETE_PROFILE } from '../phase3/fixtures'

/** Bytes kept free for message framing and anything not counted here. */
export const FRAMING_ALLOWANCE = 200

export function systemPrompt(): string {
  return readFileSync(path.join(process.cwd(), 'memory', 'SYSTEM_PROMPT.md'), 'utf8')
}

/** Three UTF-8 bytes but ONE UTF-16 unit: the most bytes a field limited by `.max(n)` characters can hold. */
const WIDE = '€'

/**
 * The largest style profile the API accepts (MAX_STYLE_PROFILE_BYTES of
 * serialized JSON), all of it in one preference: every further entry costs
 * more JSON bytes than prompt bytes, and an empty list prints "none".
 */
function largestStyleProfile() {
  const empty = { preferredStyles: [''], favoriteColors: [] as string[], occasionPreferences: [] as string[] }
  const room = MAX_STYLE_PROFILE_BYTES - utf8ByteLength(JSON.stringify(empty))
  const text = WIDE.repeat(Math.floor(room / 3)) + 'a'.repeat(room % 3)
  const profile = { ...empty, preferredStyles: [text] }
  if (utf8ByteLength(JSON.stringify(profile)) !== MAX_STYLE_PROFILE_BYTES) throw new Error('The style profile filler does not reach the limit exactly.')
  return profile
}

const styleProfile = largestStyleProfile()
/** The longest value of every Style DNA field that reaches the prompt; keywords may repeat. */
const aiProfile = {
  ...VALID_COMPLETE_PROFILE,
  coloring: { ...VALID_COMPLETE_PROFILE.coloring, hair_color: WIDE.repeat(40), skin_tone_depth: 'medium light' as const, skin_tone_undertone: 'neutral' as const, high_contrast: false },
  aesthetic_signals: { ...VALID_COMPLETE_PROFILE.aesthetic_signals, current_outfit_formality: 'business casual' as const },
  proportions: { ...VALID_COMPLETE_PROFILE.proportions, frame_width: 'narrow' as const, torso_length: 'average' as const, shoulder_breadth: 'narrow' as const },
  style_keywords: Array.from({ length: 5 }, () => ({ keyword: 'Minimalist' as const, confidence: 'High' as const, source: 'observed' as const })),
}

/** Every occasion value that can reach the prompt, with the largest one that has no profile. */
export function occasionsToCheck(): string[] {
  return [...OCCASION_PROFILES.map((profile) => profile.label), WIDE.repeat(MAX_OCCASION_LENGTH)]
}

export function promptTextBytes(mode: GarmentMode, occasion: string, prompt = systemPrompt()): number {
  const count = mode === 'single' ? 1 : MAX_GARMENT_IMAGES
  const context = buildUserContext(occasion, styleProfile, aiProfile, { mode, count })
  const labels = buildAnalysisContent('', 'p', Array.from({ length: count }, () => 'g'), mode)
    .filter((part) => part.type === 'input_text')
    .map((part) => (part as { text: string }).text)
    .join('')
  return utf8ByteLength(prompt) + utf8ByteLength(context) + utf8ByteLength(labels) + FRAMING_ALLOWANCE
}

/** The worst case over every mode and occasion, with where it occurs. */
export function worstCasePromptBytes(prompt = systemPrompt()): { bytes: number; mode: GarmentMode; occasion: string } {
  let worst = { bytes: 0, mode: 'single' as GarmentMode, occasion: '' }
  for (const mode of GARMENT_MODES) {
    for (const occasion of occasionsToCheck()) {
      const bytes = promptTextBytes(mode, occasion, prompt)
      if (bytes > worst.bytes) worst = { bytes, mode, occasion }
    }
  }
  return worst
}
