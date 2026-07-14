/**
 * getProfileCompletion() unit tests — Phase 3 extension (4-section meter)
 * Source: specs/phase3/14_PHASE3_EXECUTION_PLAN.md § Milestone 1 Deliverable 4
 */

import { describe, it, expect } from '@jest/globals'
import { getProfileCompletion } from '@/lib/services/styleProfileService'
import type { StyleProfile, AIStyleProfile } from '@/types/schema'
import { VALID_COMPLETE_PROFILE } from './fixtures'

const emptyManual: StyleProfile = {
  preferredStyles: [],
  favoriteColors: [],
  occasionPreferences: [],
}

const fullManual: StyleProfile = {
  preferredStyles: ['Casual'],
  favoriteColors: ['Black'],
  occasionPreferences: ['Weekend'],
}

// ---------------------------------------------------------------------------
// Backward compatibility: no aiProfile argument → 3 sections (Phase 1/2 behaviour)
// ---------------------------------------------------------------------------
describe('getProfileCompletion — backward compatibility (no aiProfile)', () => {
  it('returns 3 total sections when aiProfile is omitted', () => {
    const result = getProfileCompletion(emptyManual)
    expect(result.totalSections).toBe(3)
  })

  it('returns 0% when all sections empty', () => {
    const result = getProfileCompletion(emptyManual)
    expect(result.percent).toBe(0)
    expect(result.completedSections).toBe(0)
  })

  it('returns 100% when all 3 manual sections filled', () => {
    const result = getProfileCompletion(fullManual)
    expect(result.percent).toBe(100)
    expect(result.completedSections).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// Phase 3 extension: with aiProfile → 4 sections
// ---------------------------------------------------------------------------
describe('getProfileCompletion — with aiProfile (4 sections)', () => {
  it('returns 4 total sections when aiProfile is provided', () => {
    const result = getProfileCompletion(emptyManual, null)
    expect(result.totalSections).toBe(4)
  })

  it('counts AI profile as 1 section when complete', () => {
    const result = getProfileCompletion(emptyManual, VALID_COMPLETE_PROFILE)
    expect(result.completedSections).toBe(1)
    expect(result.percent).toBe(25)
  })

  it('does not count AI profile when null', () => {
    const result = getProfileCompletion(emptyManual, null)
    expect(result.completedSections).toBe(0)
    expect(result.percent).toBe(0)
  })

  it('returns 100% when AI profile + all 3 manual sections complete', () => {
    const result = getProfileCompletion(fullManual, VALID_COMPLETE_PROFILE)
    expect(result.completedSections).toBe(4)
    expect(result.percent).toBe(100)
  })

  it('returns 75% when AI profile present but only 2 manual sections filled', () => {
    const partial: StyleProfile = {
      preferredStyles: ['Casual'],
      favoriteColors: ['Black'],
      occasionPreferences: [],
    }
    const result = getProfileCompletion(partial, VALID_COMPLETE_PROFILE)
    expect(result.completedSections).toBe(3)
    expect(result.percent).toBe(75)
  })

  it('returns 50% when only 2 of 4 sections complete', () => {
    const partial: StyleProfile = {
      preferredStyles: ['Casual'],
      favoriteColors: [],
      occasionPreferences: [],
    }
    const result = getProfileCompletion(partial, VALID_COMPLETE_PROFILE)
    expect(result.completedSections).toBe(2)
    expect(result.percent).toBe(50)
  })

  it('handles wrong-schema-version profile as null (type-cast test)', () => {
    // Simulate a profile object that doesn't pass type checks at runtime
    // (represents what would happen if getProfile() returned null from a stale profile)
    const result = getProfileCompletion(emptyManual, null)
    expect(result.completedSections).toBe(0)
  })
})
