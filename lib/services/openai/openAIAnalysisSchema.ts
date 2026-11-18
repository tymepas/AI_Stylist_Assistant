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
  // `views` belongs inside `observations`. A model that puts it at the top level must not lose the six
  // ratings for it: it is accepted here and ignored, so the observations are then refused (views_missing).
  views: z.unknown().optional(),
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
 * - analysis-output/4 (Phase 4 Milestones 2 to 4, one unreleased contract): the
 *   prompt carries an occasion profile and rules for using it
 *   (style_preference_match is Unable to Evaluate without preferences or Style
 *   DNA; seasonality confidence is capped when the occasion states no season),
 *   outfit items may state which dimensions they support or strain, and visual
 *   limits gain codes and may be tied to a dimension. Every /3 output is still
 *   a valid /4 output.
 */
export const ANALYSIS_OUTPUT_SCHEMA_VERSION = 'analysis-output/4'

function schemaMajor(version: string): number {
  const match = /^analysis-output\/(\d+)(\.\d+)*$/.exec(version)
  return match === null ? 0 : Number(match[1])
}

/** Schema versions whose outputs are expected to carry `observations` and `evidence`. */
export function schemaHasVisualEvidence(version: string): boolean {
  return schemaMajor(version) >= 3
}

/**
 * What an output of a given schema version was asked to do, so that an
 * evaluation never judges an older recording by rules it was never given.
 * `phase4`: occasion profiles and their rules, outfit contributions and
 * dimension-linked visual limits (analysis-output/4).
 */
export interface SchemaCapabilities {
  visualEvidence: boolean
  phase4: boolean
}

export function schemaCapabilities(version: string): SchemaCapabilities {
  const major = schemaMajor(version)
  return { visualEvidence: major >= 3, phase4: major >= 4 }
}

export const NO_SCHEMA_CAPABILITIES: SchemaCapabilities = { visualEvidence: false, phase4: false }

export const rawOpenAIAnalysisSchema = z.discriminatedUnion('status', [
  completeAnalysisSchema,
  unableToAnalyzeSchema,
])

export function validateRawOpenAIAnalysis(value: unknown): RawOpenAIAnalysisResult {
  return rawOpenAIAnalysisSchema.parse(value)
}
