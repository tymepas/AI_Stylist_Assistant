/**
 * parseAIStyleProfile() unit tests — PA-01 through PA-05
 * Source: specs/phase3/12_TESTING_PLAN.md § "parseAIStyleProfile() (request parsing)"
 *
 * These tests verify the graceful-degradation behaviour of the request-layer parser.
 * A malformed or absent AI profile must NEVER block outfit analysis.
 */

import { describe, it, expect } from '@jest/globals'
import { parseAIStyleProfile } from '@/lib/services/aiStyleProfileService'
import { VALID_COMPLETE_PROFILE } from './fixtures'

// ---------------------------------------------------------------------------
// PA-01 Empty string → proceed without profile
// ---------------------------------------------------------------------------
describe('PA-01 — empty string returns valid:true, profile:null', () => {
  it('returns { valid: true, profile: null }', () => {
    const result = parseAIStyleProfile('')
    expect(result.valid).toBe(true)
    expect(result.profile).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// PA-02 Absent (null / undefined) field → proceed without profile
// ---------------------------------------------------------------------------
describe('PA-02 — null and undefined return valid:true, profile:null', () => {
  it('handles null', () => {
    const result = parseAIStyleProfile(null)
    expect(result.valid).toBe(true)
    expect(result.profile).toBeNull()
  })

  it('handles undefined', () => {
    const result = parseAIStyleProfile(undefined)
    expect(result.valid).toBe(true)
    expect(result.profile).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// PA-03 Valid JSON → parsed and returned
// ---------------------------------------------------------------------------
describe('PA-03 — valid JSON string returns the parsed profile', () => {
  it('returns the validated AIStyleProfile', () => {
    const json = JSON.stringify(VALID_COMPLETE_PROFILE)
    const result = parseAIStyleProfile(json)
    expect(result.valid).toBe(true)
    expect(result.profile).not.toBeNull()
    expect(result.profile?.status).toBe('complete')
    expect(result.profile?.schema_version).toBe('1.0')
    expect(result.profile?.coloring.skin_tone_undertone).toBe('warm')
  })
})

// ---------------------------------------------------------------------------
// PA-04 Malformed JSON → log warning, proceed without profile
// ---------------------------------------------------------------------------
describe('PA-04 — malformed JSON returns valid:true, profile:null', () => {
  it('{this is not json} → null profile', () => {
    const result = parseAIStyleProfile('{this is not valid json')
    expect(result.valid).toBe(true)
    expect(result.profile).toBeNull()
  })

  it('truncated JSON object → null profile', () => {
    const result = parseAIStyleProfile('{"schema_version":"1.0","status":"complete"')
    expect(result.valid).toBe(true)
    expect(result.profile).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// PA-05 Schema-invalid JSON → log warning, proceed without profile
// ---------------------------------------------------------------------------
describe('PA-05 — schema-invalid JSON returns valid:true, profile:null', () => {
  it('profile with invalid enum → null profile', () => {
    const invalid = JSON.stringify({
      ...VALID_COMPLETE_PROFILE,
      coloring: { ...VALID_COMPLETE_PROFILE.coloring, skin_tone_undertone: 'olive' },
    })
    const result = parseAIStyleProfile(invalid)
    expect(result.valid).toBe(true)
    expect(result.profile).toBeNull()
  })

  it('profile with beauty_score (unexpected field) → null profile', () => {
    const invalid = JSON.stringify({ ...VALID_COMPLETE_PROFILE, beauty_score: 9 })
    const result = parseAIStyleProfile(invalid)
    expect(result.valid).toBe(true)
    expect(result.profile).toBeNull()
  })

  it('profile missing required sections → null profile', () => {
    const invalid = JSON.stringify({ schema_version: '1.0', status: 'complete' })
    const result = parseAIStyleProfile(invalid)
    expect(result.valid).toBe(true)
    expect(result.profile).toBeNull()
  })

  it('non-string non-null value (number) → null profile', () => {
    const result = parseAIStyleProfile(42)
    expect(result.valid).toBe(true)
    expect(result.profile).toBeNull()
  })
})
