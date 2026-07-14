/**
 * Storage service unit tests — ST-01 through ST-10, LS-01 through LS-06
 * Source: specs/phase3/12_TESTING_PLAN.md § "Storage Service" and "Storage Tests"
 *
 * Uses jsdom environment for localStorage access.
 * @jest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import {
  getProfile,
  saveProfile,
  clearProfile,
  isProfileComplete,
  STORAGE_KEY,
  CURRENT_SCHEMA_VERSION,
} from '@/lib/services/aiStyleProfileService'
// Manual profile storage key — imported to verify non-interference
import { STORAGE_KEY as MANUAL_STORAGE_KEY } from '@/lib/services/styleProfileService'
import { VALID_COMPLETE_PROFILE, PROFILE_ALL_NULLS } from './fixtures'
import type { AIStyleProfile } from '@/types/schema'

// ---------------------------------------------------------------------------
// Reset localStorage before each test so tests are fully isolated
// ---------------------------------------------------------------------------
beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
  jest.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// ST-01 getProfile() returns null when localStorage is empty
// ---------------------------------------------------------------------------
describe('ST-01 — getProfile returns null when localStorage is empty', () => {
  it('returns null', () => {
    expect(getProfile()).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// ST-02 getProfile() returns parsed profile after saveProfile()
// ---------------------------------------------------------------------------
describe('ST-02 — getProfile returns parsed profile after saveProfile', () => {
  it('round-trips a valid complete profile', () => {
    saveProfile(VALID_COMPLETE_PROFILE)
    const result = getProfile()
    expect(result).not.toBeNull()
    expect(result?.status).toBe('complete')
    expect(result?.schema_version).toBe('1.0')
    expect(result?.coloring.skin_tone_undertone).toBe('warm')
  })
})

// ---------------------------------------------------------------------------
// ST-03 getProfile() returns null when stored JSON is corrupt
// ---------------------------------------------------------------------------
describe('ST-03 — getProfile returns null for corrupt JSON', () => {
  it('returns null', () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json{{')
    expect(getProfile()).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// ST-04 getProfile() returns null when stored schema_version is unknown
// ---------------------------------------------------------------------------
describe('ST-04 — getProfile returns null for unknown schema_version', () => {
  it('returns null', () => {
    const stale = { ...VALID_COMPLETE_PROFILE, schema_version: '0.9' }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stale))
    expect(getProfile()).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// ST-05 getProfile() clears the corrupt value from localStorage
// ---------------------------------------------------------------------------
describe('ST-05 — getProfile clears corrupt JSON from localStorage', () => {
  it('removes the key after corrupt JSON is detected', () => {
    localStorage.setItem(STORAGE_KEY, '{this is not json')
    getProfile() // triggers cleanup
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})

describe('ST-05b — getProfile clears schema_version-mismatched entry from localStorage', () => {
  it('removes the key after version mismatch', () => {
    const stale = { ...VALID_COMPLETE_PROFILE, schema_version: '0.1' }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stale))
    getProfile()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// ST-06 saveProfile() writes serialized JSON to the correct key
// ---------------------------------------------------------------------------
describe('ST-06 — saveProfile writes to the correct localStorage key', () => {
  it('stores JSON at the expected key', () => {
    saveProfile(VALID_COMPLETE_PROFILE)
    const raw = localStorage.getItem(STORAGE_KEY)
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!) as AIStyleProfile
    expect(parsed.schema_version).toBe('1.0')
    expect(parsed.status).toBe('complete')
  })
})

// ---------------------------------------------------------------------------
// ST-07 clearProfile() removes the key from localStorage
// ---------------------------------------------------------------------------
describe('ST-07 — clearProfile removes the localStorage key', () => {
  it('removes the AI profile key', () => {
    saveProfile(VALID_COMPLETE_PROFILE)
    clearProfile()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// ST-08 isProfileComplete() returns true for a complete profile
// ---------------------------------------------------------------------------
describe('ST-08 — isProfileComplete returns true for complete profile', () => {
  it('returns true', () => {
    expect(isProfileComplete(VALID_COMPLETE_PROFILE)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// ST-09 isProfileComplete() returns false for null
// ---------------------------------------------------------------------------
describe('ST-09 — isProfileComplete returns false for null', () => {
  it('returns false', () => {
    expect(isProfileComplete(null)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// ST-10 All service functions handle window === undefined gracefully
// ---------------------------------------------------------------------------
describe('ST-10 — service functions are SSR-safe (window undefined)', () => {
  it('getProfile does not throw when window is undefined', () => {
    // Simulate SSR by temporarily removing window
    const win = global.window
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (global as any).window
    expect(() => getProfile()).not.toThrow()
    expect(getProfile()).toBeNull()
    global.window = win
  })

  it('saveProfile does not throw when window is undefined', () => {
    const win = global.window
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (global as any).window
    expect(() => saveProfile(VALID_COMPLETE_PROFILE)).not.toThrow()
    global.window = win
  })

  it('clearProfile does not throw when window is undefined', () => {
    const win = global.window
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (global as any).window
    expect(() => clearProfile()).not.toThrow()
    global.window = win
  })

  it('isProfileComplete does not throw for null', () => {
    expect(() => isProfileComplete(null)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// LS-01 Writing and reading a full profile round-trips without data loss
// ---------------------------------------------------------------------------
describe('LS-01 — full profile round-trips without data loss', () => {
  it('preserves all fields including nested nulls', () => {
    saveProfile(VALID_COMPLETE_PROFILE)
    const result = getProfile()
    expect(result).not.toBeNull()
    expect(result?.coloring.high_contrast).toBe(false)
    expect(result?.proportions.visible_posture_notes).toBeNull()
    expect(result?.style_keywords).toHaveLength(2)
    expect(result?.analysis_notes.visibility_limitations).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// LS-02 Writing null values round-trips as null
// ---------------------------------------------------------------------------
describe('LS-02 — null values round-trip as null', () => {
  it('all nullable fields remain null after save/read', () => {
    saveProfile(PROFILE_ALL_NULLS)
    const result = getProfile()
    expect(result).not.toBeNull()
    expect(result?.coloring.skin_tone_depth).toBeNull()
    expect(result?.coloring.skin_tone_undertone).toBeNull()
    expect(result?.coloring.hair_color).toBeNull()
    expect(result?.proportions.frame_width).toBeNull()
    expect(result?.aesthetic_signals.current_outfit_formality).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// LS-03 Version mismatch causes getProfile to return null and remove the key
// ---------------------------------------------------------------------------
describe('LS-03 — version mismatch: getProfile returns null and removes key', () => {
  it('clears key and returns null', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...VALID_COMPLETE_PROFILE, schema_version: '2.0' })
    )
    expect(getProfile()).toBeNull()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// LS-04 Corrupt JSON causes getProfile to return null and remove the key
// ---------------------------------------------------------------------------
describe('LS-04 — corrupt JSON: getProfile returns null and removes key', () => {
  it('clears key and returns null', () => {
    localStorage.setItem(STORAGE_KEY, '{"schema_version":"1.0","status":"complete"')
    expect(getProfile()).toBeNull()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// LS-05 Two profiles (AI and manual) do not interfere with each other's keys
// ---------------------------------------------------------------------------
describe('LS-05 — AI and manual profiles do not interfere', () => {
  it('saving AI profile does not touch manual profile key', () => {
    const manualData = JSON.stringify({ preferredStyles: ['Casual'], favoriteColors: [], occasionPreferences: [] })
    localStorage.setItem(MANUAL_STORAGE_KEY, manualData)

    saveProfile(VALID_COMPLETE_PROFILE)

    expect(localStorage.getItem(MANUAL_STORAGE_KEY)).toBe(manualData)
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull()
  })

  it('clearing AI profile does not touch manual profile key', () => {
    const manualData = JSON.stringify({ preferredStyles: ['Casual'], favoriteColors: [], occasionPreferences: [] })
    localStorage.setItem(MANUAL_STORAGE_KEY, manualData)
    saveProfile(VALID_COMPLETE_PROFILE)

    clearProfile()

    expect(localStorage.getItem(MANUAL_STORAGE_KEY)).toBe(manualData)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// LS-06 clearProfile() removes only the AI profile key, not the manual profile key
// (covered by LS-05 above; dedicated focused assertion below)
// ---------------------------------------------------------------------------
describe('LS-06 — clearProfile removes only the AI profile key', () => {
  it('manual profile key is untouched', () => {
    localStorage.setItem(MANUAL_STORAGE_KEY, 'manual-data')
    localStorage.setItem(STORAGE_KEY, JSON.stringify(VALID_COMPLETE_PROFILE))

    clearProfile()

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(MANUAL_STORAGE_KEY)).toBe('manual-data')
  })
})

// ---------------------------------------------------------------------------
// Additional: getProfile handles Zod validation failure on stored data
// ---------------------------------------------------------------------------
describe('getProfile — Zod validation failure clears storage', () => {
  it('returns null and removes key when stored profile has an invalid enum', () => {
    const invalid = {
      ...VALID_COMPLETE_PROFILE,
      coloring: { ...VALID_COMPLETE_PROFILE.coloring, skin_tone_undertone: 'olive' },
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(invalid))
    expect(getProfile()).toBeNull()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Additional: saveProfile rejects wrong schema_version
// ---------------------------------------------------------------------------
describe('saveProfile — rejects wrong schema_version', () => {
  it('does not write to localStorage if schema_version is wrong', () => {
    // Cast to bypass TypeScript literal check for test purposes
    const wrongVersion = { ...VALID_COMPLETE_PROFILE, schema_version: '9.9' } as unknown as AIStyleProfile
    saveProfile(wrongVersion)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Phase 3 — CURRENT_SCHEMA_VERSION constant
// ---------------------------------------------------------------------------
describe('CURRENT_SCHEMA_VERSION constant', () => {
  it('is "1.0"', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe('1.0')
  })
})
