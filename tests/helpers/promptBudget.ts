/**
 * The largest analysis prompt text the application can send, in bytes.
 *
 * A token covers at least one byte, so this byte count bounds the text tokens
 * that the spend reservation assumes (`maxTextInputTokens`). It is the worst
 * case over every garment mode and every occasion: each catalogue occasion
 * with its profile line, and an occasion of the maximum length that has no
 * profile (the API refuses one, but a benchmark manifest may carry it). Every
 * client-controlled text field is filled with 4-byte characters up to its limit.
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

const WIDE = '\u{1F600}'
const styleProfile = { preferredStyles: [WIDE.repeat(Math.floor((MAX_STYLE_PROFILE_BYTES - 80) / 4))], favoriteColors: [], occasionPreferences: [] }
const aiProfile = {
  ...VALID_COMPLETE_PROFILE,
  coloring: { ...VALID_COMPLETE_PROFILE.coloring, hair_color: WIDE.repeat(20), skin_tone_depth: 'medium light' as const },
  style_keywords: (['Minimalist', 'Streetwear', 'Bohemian', 'Romantic', 'Eclectic'] as const).map((keyword) => ({ keyword, confidence: 'High' as const, source: 'observed' as const })),
}

/** Every occasion value that can reach the prompt, with the largest one that has no profile. */
export function occasionsToCheck(): string[] {
  return [...OCCASION_PROFILES.map((profile) => profile.label), WIDE.repeat(MAX_OCCASION_LENGTH / 2)]
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
