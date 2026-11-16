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
}).strict()

const unableToAnalyzeSchema = z.object({
  status: z.literal('unable_to_analyze'),
  reason: z.string().trim().min(1),
  confidence: z.literal('Low'),
  next_step: z.string().trim().min(1),
}).strict()

/**
 * Version of the analysis output contract (this schema together with the
 * shopping recommendation schema). Bump it whenever either schema changes;
 * tests/versioning/schemaVersions.test.ts fails until the version and its
 * recorded fingerprint are updated together.
 */
export const ANALYSIS_OUTPUT_SCHEMA_VERSION = 'analysis-output/1'

export const rawOpenAIAnalysisSchema = z.discriminatedUnion('status', [
  completeAnalysisSchema,
  unableToAnalyzeSchema,
])

export function validateRawOpenAIAnalysis(value: unknown): RawOpenAIAnalysisResult {
  return rawOpenAIAnalysisSchema.parse(value)
}
