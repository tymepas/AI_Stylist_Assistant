import { StyleProfile } from '@/types/schema'

const STORAGE_KEY = 'verdict_style_profile'

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
