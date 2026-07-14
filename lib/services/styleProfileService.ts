import { StyleProfile, AIStyleProfile } from '@/types/schema'

export const STORAGE_KEY = 'verdict_style_profile'

export const emptyProfile: StyleProfile = {
  preferredStyles: [],
  favoriteColors: [],
  occasionPreferences: [],
}

export function getProfile(): StyleProfile | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as StyleProfile
  } catch {
    return null
  }
}

export function saveProfile(profile: StyleProfile): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile))
}

export function clearProfile(): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(STORAGE_KEY)
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
