import { readStorage, removeStorage, writeStorage } from '@/lib/services/browserStorage'
import { StyleProfile, AIStyleProfile } from '@/types/schema'

export const STORAGE_KEY = 'verdict_style_profile'

export const emptyProfile: StyleProfile = {
  preferredStyles: [],
  favoriteColors: [],
  occasionPreferences: [],
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

/**
 * A stored value is used only when it is what this module writes: three lists
 * of strings. Anything else (an older shape, a value another script wrote, a
 * half-written entry) is treated as no saved profile, and only the three known
 * lists are carried over.
 */
export function toStyleProfile(value: unknown): StyleProfile | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (!isStringArray(candidate.preferredStyles) || !isStringArray(candidate.favoriteColors) || !isStringArray(candidate.occasionPreferences)) return null
  return { preferredStyles: candidate.preferredStyles, favoriteColors: candidate.favoriteColors, occasionPreferences: candidate.occasionPreferences }
}

/** The saved preferences, or null when there are none, they cannot be read or they are not in the expected shape. Never throws. */
export function getProfile(): StyleProfile | null {
  const raw = readStorage(STORAGE_KEY)
  if (!raw) return null
  try {
    return toStyleProfile(JSON.parse(raw))
  } catch {
    return null
  }
}

/** Saves the preferences on this device. False when the browser refused to store them. Never throws. */
export function saveProfile(profile: StyleProfile): boolean {
  return writeStorage(STORAGE_KEY, JSON.stringify(profile))
}

/** Removes the saved preferences. False when the browser refused. Never throws. */
export function clearProfile(): boolean {
  return removeStorage(STORAGE_KEY)
}

export function isProfileComplete(profile: StyleProfile | null): boolean {
  if (!profile) return false
  return (
    profile.preferredStyles.length > 0 ||
    profile.favoriteColors.length > 0 ||
    profile.occasionPreferences.length > 0
  )
}

export interface ProfileCompletion {
  completedSections: number
  totalSections: number
  percent: number
}

/**
 * Computes profile completion across up to 4 sections.
 *
 * Phase 3 extension: pass the optional `aiProfile` parameter to include
 * the AI Style Profile section in the completion meter.
 * If omitted, behaves identically to the Phase 1/2 behaviour (3 sections).
 */
export function getProfileCompletion(
  profile: StyleProfile | null,
  aiProfile?: AIStyleProfile | null
): ProfileCompletion {
  const sections = [
    // Section 1 (Phase 3): AI Style Profile generated
    ...(aiProfile !== undefined ? [aiProfile !== null && aiProfile.status === 'complete'] : []),
    // Section 2: Preferred styles (manual)
    (profile?.preferredStyles?.length ?? 0) > 0,
    // Section 3: Favorite colors (manual)
    (profile?.favoriteColors?.length ?? 0) > 0,
    // Section 4: Occasion preferences (manual)
    (profile?.occasionPreferences?.length ?? 0) > 0,
  ]
  const completedSections = sections.filter(Boolean).length
  const totalSections = sections.length
  return {
    completedSections,
    totalSections,
    percent: Math.round((completedSections / totalSections) * 100),
  }
}
