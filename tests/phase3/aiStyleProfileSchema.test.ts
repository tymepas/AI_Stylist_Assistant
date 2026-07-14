/**
 * Schema validation unit tests — SV-01 through SV-17
 * Source: specs/phase3/12_TESTING_PLAN.md § "Schema Validation"
 */

import { describe, it, expect } from '@jest/globals'
import { ZodError } from 'zod'
import type { AIStyleProfile } from '@/types/schema'
import {
  validateAIStyleProfile,
  validateAIStyleProfileResult,
} from '@/lib/services/openai/aiStyleProfileSchema'
import {
  VALID_COMPLETE_PROFILE,
  VALID_FAILURE_RESPONSE,
  PROFILE_ALL_NULLS,
} from './fixtures'

// Helper — deeply clone and modify a nested path
function clone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T
}

// ---------------------------------------------------------------------------
// SV-01 Valid complete AIStyleProfile passes validation
// ---------------------------------------------------------------------------
describe('SV-01 — valid complete profile passes validation', () => {
  it('returns the parsed profile unchanged', () => {
    const result = validateAIStyleProfile(VALID_COMPLETE_PROFILE)
    expect(result.status).toBe('complete')
    expect(result.schema_version).toBe('1.0')
  })
})

// ---------------------------------------------------------------------------
// SV-02 Valid unable_to_generate response passes validation
// ---------------------------------------------------------------------------
describe('SV-02 — valid unable_to_generate response passes validation', () => {
  it('returns the parsed failure response', () => {
    const result = validateAIStyleProfileResult(VALID_FAILURE_RESPONSE)
    expect(result.status).toBe('unable_to_generate')
  })
})

// ---------------------------------------------------------------------------
// SV-03 Missing required field schema_version fails
// ---------------------------------------------------------------------------
describe('SV-03 — missing schema_version fails', () => {
  it('throws ZodError', () => {
    const bad = clone(VALID_COMPLETE_PROFILE)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (bad as any).schema_version
    expect(() => validateAIStyleProfile(bad)).toThrow(ZodError)
  })
})

// ---------------------------------------------------------------------------
// SV-04 Missing required field status fails
// ---------------------------------------------------------------------------
describe('SV-04 — missing status fails', () => {
  it('throws ZodError', () => {
    const bad = clone(VALID_COMPLETE_PROFILE)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (bad as any).status
    expect(() => validateAIStyleProfile(bad)).toThrow(ZodError)
  })
})

// ---------------------------------------------------------------------------
// SV-05 Invalid enum for skin_tone_undertone fails
// ---------------------------------------------------------------------------
describe('SV-05 — invalid skin_tone_undertone enum fails', () => {
  it('throws ZodError for "olive"', () => {
    const bad = clone(VALID_COMPLETE_PROFILE)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(bad as any).coloring.skin_tone_undertone = 'olive'
    expect(() => validateAIStyleProfile(bad)).toThrow(ZodError)
  })
})

// ---------------------------------------------------------------------------
// SV-06 Invalid enum for current_outfit_formality fails
// ---------------------------------------------------------------------------
describe('SV-06 — invalid current_outfit_formality enum fails', () => {
  it('throws ZodError for "semi-formal"', () => {
    const bad = clone(VALID_COMPLETE_PROFILE)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(bad as any).aesthetic_signals.current_outfit_formality = 'semi-formal'
    expect(() => validateAIStyleProfile(bad)).toThrow(ZodError)
  })
})

// ---------------------------------------------------------------------------
// SV-07 style_keywords with 0 items fails (min 1)
// ---------------------------------------------------------------------------
describe('SV-07 — style_keywords with 0 items fails', () => {
  it('throws ZodError', () => {
    const bad = clone(VALID_COMPLETE_PROFILE)
    bad.style_keywords = []
    expect(() => validateAIStyleProfile(bad)).toThrow(ZodError)
  })
})

// ---------------------------------------------------------------------------
// SV-08 style_keywords with 6 items fails (max 5)
// ---------------------------------------------------------------------------
describe('SV-08 — style_keywords with 6 items fails', () => {
  it('throws ZodError', () => {
    const bad = clone(VALID_COMPLETE_PROFILE)
    bad.style_keywords = [
      { keyword: 'Minimalist', confidence: 'High', source: 'observed' },
      { keyword: 'Classic', confidence: 'High', source: 'observed' },
      { keyword: 'Casual', confidence: 'Medium', source: 'inferred' },
      { keyword: 'Sporty', confidence: 'Low', source: 'inferred' },
      { keyword: 'Edgy', confidence: 'Low', source: 'inferred' },
      { keyword: 'Trendy', confidence: 'Low', source: 'inferred' },
    ] as AIStyleProfile['style_keywords']
    expect(() => validateAIStyleProfile(bad)).toThrow(ZodError)
  })
})

// ---------------------------------------------------------------------------
// SV-09 current_outfit_style with 4 items fails (max 3)
// ---------------------------------------------------------------------------
describe('SV-09 — current_outfit_style with 4 items fails', () => {
  it('throws ZodError', () => {
    const bad = clone(VALID_COMPLETE_PROFILE)
    bad.aesthetic_signals.current_outfit_style = [
      'minimalist',
      'classic',
      'casual',
      'sporty',
    ] as AIStyleProfile['aesthetic_signals']['current_outfit_style']
    expect(() => validateAIStyleProfile(bad)).toThrow(ZodError)
  })
})

// ---------------------------------------------------------------------------
// SV-10 Extra fields in strict mode are rejected
// ---------------------------------------------------------------------------
describe('SV-10 — extra fields in strict mode are rejected', () => {
  it('throws ZodError when an unknown top-level field is present', () => {
    const bad = { ...clone(VALID_COMPLETE_PROFILE), beauty_score: 9.5 }
    expect(() => validateAIStyleProfile(bad)).toThrow(ZodError)
  })

  it('throws ZodError when an unknown field is inside coloring', () => {
    const bad = clone(VALID_COMPLETE_PROFILE)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(bad.coloring as any).attractiveness = 'high'
    expect(() => validateAIStyleProfile(bad)).toThrow(ZodError)
  })
})

// ---------------------------------------------------------------------------
// SV-11 null values for nullable fields pass validation
// ---------------------------------------------------------------------------
describe('SV-11 — null values for nullable fields pass validation', () => {
  it('passes when every nullable field is null', () => {
    expect(() => validateAIStyleProfile(PROFILE_ALL_NULLS)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// SV-12 coloring.confidence accepts High, Medium, Low
// ---------------------------------------------------------------------------
describe('SV-12 — coloring.confidence accepts High, Medium, Low', () => {
  it.each(['High', 'Medium', 'Low'] as const)('accepts %s', (value) => {
    const profile = clone(VALID_COMPLETE_PROFILE)
    profile.coloring.confidence = value
    expect(() => validateAIStyleProfile(profile)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// SV-13 coloring.confidence "Unknown" fails
// ---------------------------------------------------------------------------
describe('SV-13 — coloring.confidence "Unknown" fails', () => {
  it('throws ZodError', () => {
    const bad = clone(VALID_COMPLETE_PROFILE)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(bad as any).coloring.confidence = 'Unknown'
    expect(() => validateAIStyleProfile(bad)).toThrow(ZodError)
  })
})

// ---------------------------------------------------------------------------
// SV-14 style_keywords[].source "observed" passes
// ---------------------------------------------------------------------------
describe('SV-14 — style_keywords[].source "observed" passes', () => {
  it('does not throw', () => {
    const profile = clone(VALID_COMPLETE_PROFILE)
    profile.style_keywords[0].source = 'observed'
    expect(() => validateAIStyleProfile(profile)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// SV-15 style_keywords[].source "inferred" passes
// ---------------------------------------------------------------------------
describe('SV-15 — style_keywords[].source "inferred" passes', () => {
  it('does not throw', () => {
    const profile = clone(VALID_COMPLETE_PROFILE)
    profile.style_keywords[0].source = 'inferred'
    expect(() => validateAIStyleProfile(profile)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// SV-16 style_keywords[].source "manual" fails
// ---------------------------------------------------------------------------
describe('SV-16 — style_keywords[].source "manual" fails', () => {
  it('throws ZodError', () => {
    const bad = clone(VALID_COMPLETE_PROFILE)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(bad as any).style_keywords[0].source = 'manual'
    expect(() => validateAIStyleProfile(bad)).toThrow(ZodError)
  })
})

// ---------------------------------------------------------------------------
// SV-17 String exceeding max length fails for constrained fields
// ---------------------------------------------------------------------------
describe('SV-17 — string max length validation', () => {
  it('rejects hair_color > 40 chars', () => {
    const bad = clone(VALID_COMPLETE_PROFILE)
    bad.coloring.hair_color = 'a'.repeat(41)
    expect(() => validateAIStyleProfile(bad)).toThrow(ZodError)
  })

  it('rejects eye_color > 30 chars', () => {
    const bad = clone(VALID_COMPLETE_PROFILE)
    bad.coloring.eye_color = 'a'.repeat(31)
    expect(() => validateAIStyleProfile(bad)).toThrow(ZodError)
  })

  it('rejects visible_posture_notes > 100 chars', () => {
    const bad = clone(VALID_COMPLETE_PROFILE)
    bad.proportions.visible_posture_notes = 'a'.repeat(101)
    expect(() => validateAIStyleProfile(bad)).toThrow(ZodError)
  })

  it('rejects confidence_summary > 300 chars', () => {
    const bad = clone(VALID_COMPLETE_PROFILE)
    bad.analysis_notes.confidence_summary = 'a'.repeat(301)
    expect(() => validateAIStyleProfile(bad)).toThrow(ZodError)
  })

  it('rejects wardrobe_context.visible_garment_notes > 200 chars', () => {
    const bad = clone(VALID_COMPLETE_PROFILE)
    bad.wardrobe_context.visible_garment_notes = 'a'.repeat(201)
    expect(() => validateAIStyleProfile(bad)).toThrow(ZodError)
  })
})

// ---------------------------------------------------------------------------
// SAFE-08 (schema level): schema must not define beauty/attractiveness/age fields
// ---------------------------------------------------------------------------
describe('SAFE-08 — schema does not define prohibited fields', () => {
  it('rejects a profile containing beauty_score', () => {
    const bad = { ...clone(VALID_COMPLETE_PROFILE), beauty_score: 8 }
    expect(() => validateAIStyleProfile(bad)).toThrow(ZodError)
  })

  it('rejects a profile containing attractiveness_rating', () => {
    const bad = { ...clone(VALID_COMPLETE_PROFILE), attractiveness_rating: 'high' }
    expect(() => validateAIStyleProfile(bad)).toThrow(ZodError)
  })

  it('rejects a profile containing estimated_age', () => {
    const bad = { ...clone(VALID_COMPLETE_PROFILE), estimated_age: 28 }
    expect(() => validateAIStyleProfile(bad)).toThrow(ZodError)
  })
})
