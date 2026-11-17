import { z } from 'zod'
import type { RawOpenAIAnalysisResult } from '@/types/openai'

const ratingSchema = z.enum([
  'Excellent',
  'Good',
  'Fair',
  'Poor',
  'Unable to Evaluate',
])

const confidenceSchema = z.enum(['High', 'Medium', 'Low'])

const dimensionSchema = z.object({
  rating: ratingSchema,
  reason: z.string().trim().min(1),
  confidence: confidenceSchema,
}).strict()

const dimensionsSchema = z.object({
  occasion: dimensionSchema,
  color: dimensionSchema,
  formality: dimensionSchema,
  seasonality: dimensionSchema,
  style: dimensionSchema,
  style_preference_match: dimensionSchema,
}).strict()

const completeAnalysisSchema = z.object({
  status: z.literal('complete'),
  dimensions: dimensionsSchema,
  // Advisory output is validated separately so it cannot invalidate core analysis.
  shopping_advisor: z.unknown().optional(),
  // Per-item notes for an outfit of several garment images. Advisory, validated
  // separately for the same reason (lib/services/openai/outfitComponentsSchema.ts).
  outfit_components: z.unknown().optional(),
  // What is visible in each garment image, and what each rating rests on. Informational, validated
  // separately for the same reason (observationsSchema.ts, ratingEvidenceSchema.ts).
  observations: z.unknown().optional(),
  evidence: z.unknown().optional(),
}).strict()

const unableToAnalyzeSchema = z.object({
  status: z.literal('unable_to_analyze'),
  reason: z.string().trim().min(1),
  confidence: z.literal('Low'),
  next_step: z.string().trim().min(1),
}).strict()

/**
 * Version of the analysis output contract (this schema together with the
 * shopping recommendation and outfit component schemas). Bump it whenever one
 * of them changes; tests/versioning/schemaVersions.test.ts fails until the
 * version and its recorded fingerprint are updated together.
 *
 * - analysis-output/1: ratings plus the optional shopping advisor.
 * - analysis-output/2: adds the optional `outfit_components` block for outfits
 *   made of several garment images. Every /1 output is still a valid /2 output.
 * - analysis-output/3: adds the optional `observations` block (what is visible in
 *   each garment image) and the optional `evidence` block (what each rating rests
 *   on). Both are informational and validated separately. Every /2 output is still
 *   a valid /3 output; it simply has neither block.
 */
export const ANALYSIS_OUTPUT_SCHEMA_VERSION = 'analysis-output/3'

/** Schema versions whose outputs are expected to carry `observations` and `evidence`. */
export function schemaHasVisualEvidence(version: string): boolean {
  const match = /^analysis-output\/(\d+)$/.exec(version)
  return match !== null && Number(match[1]) >= 3
}

export const rawOpenAIAnalysisSchema = z.discriminatedUnion('status', [
  completeAnalysisSchema,
  unableToAnalyzeSchema,
])

export function validateRawOpenAIAnalysis(value: unknown): RawOpenAIAnalysisResult {
  return rawOpenAIAnalysisSchema.parse(value)
}
