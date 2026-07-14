/**
 * AI Style Profile storage service and request-parsing utilities.
 * Source of truth: specs/phase3/08_STORAGE_SPECIFICATION.md
 *
 * Mirrors the interface of styleProfileService.ts.
 * Only AIStyleProfile objects with status === 'complete' are ever written to storage.
 */

import type { AIStyleProfile, ParseAIStyleProfileResult } from '@/types/schema'
import { validateAIStyleProfile } from '@/lib/services/openai/aiStyleProfileSchema'

export const STORAGE_KEY = 'verdict_ai_style_profile'
export const CURRENT_SCHEMA_VERSION = '1.0'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Safely read a string from localStorage.
 * Returns null if window is undefined (SSR) or if the key is absent.
 */
function readRaw(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

/**
 * Safely remove the storage key.
 * No-op if window is undefined (SSR) or if removal throws.
 */
function removeRaw(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // localStorage unavailable — nothing to clean up
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read the stored AI Style Profile.
 *
 * Returns null and cleans up storage if any of the following are true:
 * - localStorage is unavailable (SSR or blocked storage)
 * - no profile has been stored
 * - the stored value is not valid JSON
 * - the stored profile has a schema_version that does not match CURRENT_SCHEMA_VERSION
 * - the stored value fails Zod schema validation
 */
export function getProfile(): AIStyleProfile | null {
  const raw = readRaw()
  if (raw === null) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Corrupt JSON — clear and treat as no profile
    console.warn('[aiStyleProfileService] stored profile is corrupt JSON; clearing')
    removeRaw()
    return null
  }

  // Version check before full schema validation
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as Record<string, unknown>)['schema_version'] !== CURRENT_SCHEMA_VERSION
  ) {
    console.warn(
      '[aiStyleProfileService] stored profile schema_version mismatch; clearing',
      { stored: (parsed as Record<string, unknown>)?.['schema_version'], current: CURRENT_SCHEMA_VERSION }
    )
    removeRaw()
    return null
  }

  try {
    return validateAIStyleProfile(parsed)
  } catch {
    // Schema validation failure — clear and treat as no profile
    console.warn('[aiStyleProfileService] stored profile failed schema validation; clearing')
    removeRaw()
    return null
  }
}

/**
 * Persist a validated AI Style Profile to localStorage.
 *
 * Only profiles with schema_version === CURRENT_SCHEMA_VERSION are accepted.
 * The caller is responsible for ensuring the profile passed validation before saving.
 * No-op if localStorage is unavailable.
 */
export function saveProfile(profile: AIStyleProfile): void {
  if (typeof window === 'undefined') return
  if (profile.schema_version !== CURRENT_SCHEMA_VERSION) {
    console.error('[aiStyleProfileService] attempted to save profile with wrong schema_version', {
      schema_version: profile.schema_version,
    })
    return
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile))
  } catch (error) {
    // localStorage may be full or blocked (private mode)
    console.error('[aiStyleProfileService] failed to save profile to localStorage', error)
  }
}

/**
 * Remove the AI Style Profile from localStorage.
 * Does not affect the manual StyleProfile stored under a different key.
 * No-op if localStorage is unavailable.
 */
export function clearProfile(): void {
  removeRaw()
}

/**
 * Returns true if a complete AI Style Profile exists.
 * Used to determine whether to show the "Generate Profile" CTA or the generated state.
 */
export function isProfileComplete(profile: AIStyleProfile | null): boolean {
  return profile !== null && profile.status === 'complete'
}

/**
 * Parses the optional `aiStyleProfile` field from a multipart analysis request.
 *
 * Graceful degradation: a missing, empty, or invalid field always results in
 * `{ valid: true, profile: null }` so that outfit analysis is never blocked by
 * a corrupt or absent AI profile. Errors are logged as warnings.
 *
 * Mirrors the pattern of `parseStyleProfile()` in analysisService.ts.
 */
export function parseAIStyleProfile(value: unknown): ParseAIStyleProfileResult {
  // Absent or empty — proceed without profile
  if (value === null || value === undefined || value === '') {
    return { valid: true, profile: null }
  }

  // Must be a string (multipart form field)
  if (typeof value !== 'string') {
    console.warn('[parseAIStyleProfile] aiStyleProfile field is not a string; ignoring')
    return { valid: true, profile: null }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    console.warn('[parseAIStyleProfile] aiStyleProfile field contains malformed JSON; ignoring')
    return { valid: true, profile: null }
  }

  try {
    const profile = validateAIStyleProfile(parsed)
    return { valid: true, profile }
  } catch {
    console.warn('[parseAIStyleProfile] aiStyleProfile field failed schema validation; ignoring')
    return { valid: true, profile: null }
  }
}
