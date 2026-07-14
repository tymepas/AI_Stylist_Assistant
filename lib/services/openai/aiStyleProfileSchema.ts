/**
 * Zod runtime validation schema for the AI Style Profile.
 * Source of truth: specs/phase3/05_STYLE_PROFILE_SCHEMA.md
 *
 * Mirrors the structure of openAIAnalysisSchema.ts.
 * Strict mode (.strict()) is applied to every object — unknown fields are rejected.
 */

import { z } from 'zod'
import type { AIStyleProfile, AIStyleProfileFailure } from '@/types/schema'

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

const confidenceSchema = z.enum(['High', 'Medium', 'Low'])

// ---------------------------------------------------------------------------
// Coloring section
// ---------------------------------------------------------------------------

const coloringSchema = z
  .object({
    skin_tone_depth: z
      .enum(['very light', 'light', 'medium light', 'medium', 'medium deep', 'deep'])
      .nullable(),
    skin_tone_undertone: z.enum(['cool', 'warm', 'neutral']).nullable(),
    hair_color: z.string().max(40).nullable(),
    hair_color_family: z.enum(['light', 'medium', 'dark', 'vivid']).nullable(),
    eye_color: z.string().max(30).nullable(),
    high_contrast: z.boolean().nullable(),
    confidence: confidenceSchema,
  })
  .strict()

// ---------------------------------------------------------------------------
// Proportions section
// ---------------------------------------------------------------------------

const proportionsSchema = z
  .object({
    frame_width: z.enum(['narrow', 'medium', 'broad']).nullable(),
    torso_length: z.enum(['short', 'average', 'long']).nullable(),
    shoulder_breadth: z.enum(['narrow', 'medium', 'broad']).nullable(),
    visible_posture_notes: z.string().max(100).nullable(),
    confidence: confidenceSchema,
  })
  .strict()

// ---------------------------------------------------------------------------
// Aesthetic signals section
// ---------------------------------------------------------------------------

const outfitStyleValueSchema = z.enum([
  'minimalist',
  'classic',
  'streetwear',
  'casual',
  'bohemian',
  'sporty',
  'romantic',
  'edgy',
  'preppy',
  'eclectic',
])

const aestheticSignalsSchema = z
  .object({
    current_outfit_formality: z
      .enum(['casual', 'smart casual', 'business casual', 'business formal', 'formal'])
      .nullable(),
    current_outfit_style: z.array(outfitStyleValueSchema).max(3),
    accessory_presence: z.enum(['none', 'minimal', 'moderate', 'statement']).nullable(),
    pattern_preference_signal: z
      .enum(['solid', 'subtle_pattern', 'bold_pattern', 'mixed'])
      .nullable(),
    confidence: confidenceSchema,
  })
  .strict()

// ---------------------------------------------------------------------------
// Style keywords section
// ---------------------------------------------------------------------------

const styleKeywordItemSchema = z
  .object({
    keyword: z.enum([
      'Minimalist',
      'Classic',
      'Streetwear',
      'Casual',
      'Bohemian',
      'Sporty',
      'Romantic',
      'Edgy',
      'Preppy',
      'Eclectic',
      'Business',
      'Trendy',
    ]),
    confidence: confidenceSchema,
    source: z.enum(['observed', 'inferred']),
  })
  .strict()

// ---------------------------------------------------------------------------
// Wardrobe context section (reserved for Phase 4)
// ---------------------------------------------------------------------------

const wardrobeContextSchema = z
  .object({
    visible_garment_notes: z.string().max(200).nullable(),
    color_palette_notes: z.string().max(200).nullable(),
  })
  .strict()

// ---------------------------------------------------------------------------
// Analysis notes section
// ---------------------------------------------------------------------------

const analysisNotesSchema = z
  .object({
    photo_quality: z.enum(['excellent', 'good', 'acceptable', 'poor']),
    visibility_limitations: z.array(z.string()).max(5),
    confidence_summary: z.string().max(300),
  })
  .strict()

// ---------------------------------------------------------------------------
// Complete AI Style Profile
// ---------------------------------------------------------------------------

const completeAIStyleProfileSchema = z
  .object({
    schema_version: z.literal('1.0'),
    generated_at_utc: z.string(),
    status: z.literal('complete'),
    coloring: coloringSchema,
    proportions: proportionsSchema,
    aesthetic_signals: aestheticSignalsSchema,
    style_keywords: z.array(styleKeywordItemSchema).min(1).max(5),
    wardrobe_context: wardrobeContextSchema,
    analysis_notes: analysisNotesSchema,
  })
  .strict()

// ---------------------------------------------------------------------------
// Failure object
// ---------------------------------------------------------------------------

const aiStyleProfileFailureSchema = z
  .object({
    schema_version: z.literal('1.0'),
    status: z.literal('unable_to_generate'),
    reason: z.string().trim().min(1),
    next_step: z.string().trim().min(1),
    confidence: z.literal('Low'),
  })
  .strict()

// ---------------------------------------------------------------------------
// Discriminated union — the full AI response shape
// ---------------------------------------------------------------------------

const aiStyleProfileResultSchema = z.discriminatedUnion('status', [
  completeAIStyleProfileSchema,
  aiStyleProfileFailureSchema,
])

// ---------------------------------------------------------------------------
// Exported validators
// ---------------------------------------------------------------------------

/**
 * Validates a raw unknown value as a complete AIStyleProfile.
 * Throws ZodError on any validation failure.
 * Used by the storage service as a defensive read-back check.
 */
export function validateAIStyleProfile(value: unknown): AIStyleProfile {
  return completeAIStyleProfileSchema.parse(value)
}

/**
 * Validates a raw unknown value as the full AI profile result union
 * (complete | unable_to_generate).
 * Throws ZodError on any validation failure.
 * Used by the API route after receiving the AI's response.
 */
export function validateAIStyleProfileResult(
  value: unknown
): AIStyleProfile | AIStyleProfileFailure {
  return aiStyleProfileResultSchema.parse(value)
}
