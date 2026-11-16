/**
 * Guards the explicit output schema versions.
 *
 * Each version is paired with a fingerprint of the schema's structure. If a
 * schema changes, its fingerprint changes and this test fails until BOTH the
 * version constant and the fingerprint below are updated. That keeps the
 * version recorded in logs and evaluation records honest.
 */

import { z } from 'zod'
import { aiStyleProfileResultSchema, PROFILE_OUTPUT_SCHEMA_VERSION } from '@/lib/services/openai/aiStyleProfileSchema'
import { ANALYSIS_OUTPUT_SCHEMA_VERSION, rawOpenAIAnalysisSchema } from '@/lib/services/openai/openAIAnalysisSchema'
import { outfitComponentsPayloadSchema } from '@/lib/services/openai/outfitComponentsSchema'
import { shoppingAdvisorPayloadSchema } from '@/lib/services/openai/shoppingRecommendationSchema'
import { describeSchema, schemaFingerprint } from '../helpers/zodFingerprint'

/** version → fingerprint. Add a new line when a schema changes; never edit an old one. */
const ANALYSIS_FINGERPRINTS: Record<string, string> = {
  'analysis-output/1': '2e81c731e418',
  // Adds the optional outfit_components block (several outfit items) and its schema.
  'analysis-output/2': '2bf1446af120',
}

const PROFILE_FINGERPRINTS: Record<string, string> = {
  'profile-output/1.0': '92ade7f4ea84',
}

const HOW_TO_FIX = 'The schema changed. Bump the version constant next to the schema and record the new fingerprint in this file.'

describe('output schema versions', () => {
  it('the analysis output version matches the analysis, shopping and outfit component schemas', () => {
    const actual = schemaFingerprint(rawOpenAIAnalysisSchema, shoppingAdvisorPayloadSchema, outfitComponentsPayloadSchema)
    expect({ version: ANALYSIS_OUTPUT_SCHEMA_VERSION, fingerprint: actual, note: HOW_TO_FIX }).toEqual({
      version: ANALYSIS_OUTPUT_SCHEMA_VERSION,
      fingerprint: ANALYSIS_FINGERPRINTS[ANALYSIS_OUTPUT_SCHEMA_VERSION],
      note: HOW_TO_FIX,
    })
  })

  it('the profile output version matches the Style DNA schema', () => {
    const actual = schemaFingerprint(aiStyleProfileResultSchema)
    expect({ version: PROFILE_OUTPUT_SCHEMA_VERSION, fingerprint: actual, note: HOW_TO_FIX }).toEqual({
      version: PROFILE_OUTPUT_SCHEMA_VERSION,
      fingerprint: PROFILE_FINGERPRINTS[PROFILE_OUTPUT_SCHEMA_VERSION],
      note: HOW_TO_FIX,
    })
  })

  it('the profile version carries the schema_version literal the schema enforces', () => {
    const description = JSON.stringify(describeSchema(aiStyleProfileResultSchema))
    const literal = PROFILE_OUTPUT_SCHEMA_VERSION.split('/')[1]
    expect(description).toContain(`"schema_version":{"type":"ZodLiteral","value":"${literal}"}`)
  })

  it('versions are plain identifiers that are safe to log', () => {
    for (const version of [ANALYSIS_OUTPUT_SCHEMA_VERSION, PROFILE_OUTPUT_SCHEMA_VERSION]) {
      expect(version).toMatch(/^[a-z-]+\/[0-9.]+$/)
    }
  })
})

describe('schema fingerprinting', () => {
  const base = z.object({ rating: z.enum(['Good', 'Poor']), reason: z.string().min(1) }).strict()

  it('is stable for an unchanged schema and independent of key order', () => {
    const reordered = z.object({ reason: z.string().min(1), rating: z.enum(['Good', 'Poor']) }).strict()
    expect(schemaFingerprint(base)).toBe(schemaFingerprint(base))
    expect(schemaFingerprint(reordered)).toBe(schemaFingerprint(base))
  })

  it('changes when a field, an enum value, a bound, nullability or strictness changes', () => {
    const variants = [
      z.object({ rating: z.enum(['Good', 'Poor']), reason: z.string().min(1), extra: z.string() }).strict(),
      z.object({ rating: z.enum(['Good', 'Poor', 'Fair']), reason: z.string().min(1) }).strict(),
      z.object({ rating: z.enum(['Good', 'Poor']), reason: z.string().min(2) }).strict(),
      z.object({ rating: z.enum(['Good', 'Poor']), reason: z.string().min(1).nullable() }).strict(),
      z.object({ rating: z.enum(['Good', 'Poor']), reason: z.string().min(1) }),
    ]
    const fingerprints = new Set(variants.map((variant) => schemaFingerprint(variant)))
    expect(fingerprints.size).toBe(variants.length)
    expect(fingerprints.has(schemaFingerprint(base))).toBe(false)
  })

  it('refuses to fingerprint a schema type it does not understand', () => {
    expect(() => schemaFingerprint(z.object({ when: z.date() }))).toThrow(/unhandled schema type ZodDate/)
  })
})
