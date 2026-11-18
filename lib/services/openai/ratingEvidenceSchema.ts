import { z } from 'zod'
import { CITE_PATTERN, resolveCite } from '@/lib/services/openai/observationsSchema'
import { screenClaims } from '@/lib/services/openai/claimScreening'
import type { RawOpenAIDimensions } from '@/types/openai'
import type { DimensionEvidence, Dimensions, Observations, RatingEvidence } from '@/types/schema'

/**
 * Rating evidence: which inputs and which observations each of the six ratings
 * rests on (analysis-output/3).
 *
 * Observations say what is visible. Evidence says which of those observations,
 * and which other inputs, a rating used. It carries no explanation of its own:
 * the rating's `reason` is the explanation, and evidence only points at what it
 * rests on, plus a short note of what was missing.
 *
 * INFORMATIONAL ONLY. It is validated separately from the ratings and never
 * changes them. Each dimension is checked on its own, so one bad entry makes
 * that dimension's evidence unavailable and leaves the others usable.
 */

export const EVIDENCE_SOURCES = ['person_photo', 'garment_images', 'occasion', 'style_preferences', 'style_dna'] as const
export const EVIDENCE_SUPPORT = ['sufficient', 'partial', 'insufficient'] as const
export const MAX_CITES = 4
export const EVIDENCE_DIMENSIONS = ['occasion', 'color', 'formality', 'seasonality', 'style', 'style_preference_match'] as const
type DimensionKey = (typeof EVIDENCE_DIMENSIONS)[number]

export const dimensionEvidenceSchema = z.object({
  sources: z.array(z.enum(EVIDENCE_SOURCES)).min(1).max(EVIDENCE_SOURCES.length),
  cites: z.array(z.string().regex(CITE_PATTERN)).max(MAX_CITES),
  support: z.enum(EVIDENCE_SUPPORT),
  missing: z.string().trim().max(80).optional(),
}).strict()

/** Each dimension is parsed on its own (see inspectEvidence), so the block only fixes which keys may appear. */
export const evidencePayloadSchema = z.object({
  occasion: z.unknown().optional(),
  color: z.unknown().optional(),
  formality: z.unknown().optional(),
  seasonality: z.unknown().optional(),
  style: z.unknown().optional(),
  style_preference_match: z.unknown().optional(),
}).strict()

export const EVIDENCE_PROBLEMS = [
  'schema',
  'missing_dimension',
  'duplicate_entry',
  'invalid_citation',
  'source_mismatch',
  'unsupplied_source',
  'support_conflict',
  'missing_unexplained',
  'unsupported_text',
] as const
export type EvidenceProblem = (typeof EVIDENCE_PROBLEMS)[number]

/** What was actually sent with the request. Evidence may only name inputs that exist. */
export interface EvidenceContext {
  dimensions: RawOpenAIDimensions | Dimensions
  /** The validated observations, or null when they are unavailable. A citation can only point at a validated observation. */
  observations: Observations | null
  hasStyleDna: boolean
  /** False when the user has stated no style preference at all. */
  hasStylePreferences: boolean
}

export interface EvidenceInspection {
  value: RatingEvidence
  /** Problems per dimension. A dimension with problems has no evidence in `value`. */
  problems: Partial<Record<DimensionKey, EvidenceProblem[]>>
  /** Problems of the block as a whole (its shape). */
  blockProblems: EvidenceProblem[]
  schemaError?: unknown
}

function dimensionProblems(raw: unknown, key: DimensionKey, context: EvidenceContext): { value: DimensionEvidence | null; problems: EvidenceProblem[]; schemaError?: unknown } {
  if (raw === undefined) return { value: null, problems: ['missing_dimension'] }
  const parsed = dimensionEvidenceSchema.safeParse(raw)
  if (!parsed.success) return { value: null, problems: ['schema'], schemaError: parsed.error }
  const entry = parsed.data
  const problems = new Set<EvidenceProblem>()

  if (new Set(entry.sources).size !== entry.sources.length || new Set(entry.cites).size !== entry.cites.length) problems.add('duplicate_entry')
  // A rating can never be justified with an observation that does not exist or was not visible.
  if (entry.cites.some((cite) => resolveCite(cite, context.observations) === null)) problems.add('invalid_citation')
  if (entry.cites.length > 0 && !entry.sources.includes('garment_images')) problems.add('source_mismatch')
  if (entry.sources.includes('style_dna') && !context.hasStyleDna) problems.add('unsupplied_source')
  if (entry.sources.includes('style_preferences') && !context.hasStylePreferences) problems.add('unsupplied_source')

  // Evidence explains a rating; it may not contradict it.
  const unrated = context.dimensions[key].rating === 'Unable to Evaluate'
  if (unrated ? entry.support === 'sufficient' : entry.support === 'insufficient') problems.add('support_conflict')

  const missing = entry.missing?.trim() ?? ''
  if (entry.support !== 'sufficient' && missing.length === 0) problems.add('missing_unexplained')
  if (missing.length > 0 && screenClaims(missing).length > 0) problems.add('unsupported_text')

  const ordered = EVIDENCE_PROBLEMS.filter((problem) => problems.has(problem))
  if (ordered.length > 0) return { value: null, problems: ordered }
  return {
    value: { sources: [...entry.sources], cites: [...entry.cites], support: entry.support, ...(missing ? { missing } : {}) },
    problems: [],
  }
}

/**
 * Validates the evidence of each dimension against the ratings, the validated
 * observations and the inputs that were actually sent.
 */
export function inspectEvidence(raw: unknown, context: EvidenceContext): EvidenceInspection {
  const parsed = evidencePayloadSchema.safeParse(raw)
  if (!parsed.success) {
    return { value: { availability: 'unavailable', dimensions: {} }, problems: {}, blockProblems: ['schema'], schemaError: parsed.error }
  }
  const dimensions: RatingEvidence['dimensions'] = {}
  const problems: EvidenceInspection['problems'] = {}
  let schemaError: unknown
  for (const key of EVIDENCE_DIMENSIONS) {
    const result = dimensionProblems(parsed.data[key], key, context)
    if (result.value) dimensions[key] = result.value
    else problems[key] = result.problems
    if (result.schemaError && schemaError === undefined) schemaError = result.schemaError
  }
  const valid = Object.keys(dimensions).length
  return {
    value: { availability: valid === EVIDENCE_DIMENSIONS.length ? 'available' : valid === 0 ? 'unavailable' : 'partial', dimensions },
    problems,
    blockProblems: [],
    ...(schemaError !== undefined ? { schemaError } : {}),
  }
}
