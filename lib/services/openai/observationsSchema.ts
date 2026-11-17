import { z } from 'zod'
import { MAX_GARMENT_IMAGES, type GarmentMode } from '@/lib/constants/garmentModes'
import { shoppingGarmentCategorySchema } from '@/lib/services/openai/shoppingRecommendationSchema'
import { screenClaims } from '@/lib/services/openai/claimScreening'
import type { GarmentObservation, Observations } from '@/types/schema'

/**
 * Visual observations: what is visible in each garment image (analysis-output/3).
 *
 * INFORMATIONAL ONLY. The block is validated separately from the six ratings,
 * exactly like the shopping advisor and the outfit notes: a missing or invalid
 * block makes the observations unavailable and changes nothing else. Nothing
 * here is read by `computeVerdict`.
 *
 * The block describes the garment images only. It never describes the person.
 * Every field is bounded, every category is a fixed list, and a field that
 * cannot be seen is reported as such (`not_visible`, `unclear`, empty lists)
 * instead of being filled in.
 */

export const OBSERVATION_STATUSES = ['observed', 'uncertain', 'not_visible'] as const
export const COLOUR_FAMILIES = [
  'black', 'white', 'cream', 'grey', 'beige', 'brown', 'red', 'pink', 'orange',
  'yellow', 'green', 'blue', 'navy', 'purple', 'gold', 'silver', 'multicolour',
] as const
export const PATTERNS = ['solid', 'striped', 'checked', 'printed', 'textured', 'other', 'unclear'] as const
export const IMAGE_LIMITS = ['lighting', 'occlusion', 'cropped', 'blur', 'low_resolution', 'angle', 'image_text', 'several_items'] as const
export const OBSERVED_CATEGORIES = [...shoppingGarmentCategorySchema.options, 'unclear'] as const
export const VIEW_AGREEMENT = ['yes', 'no', 'unclear'] as const

export const MAX_DETAILS = 3
export const MAX_COLOURS = 3

const statusSchema = z.enum(OBSERVATION_STATUSES)
const colourSchema = z.enum(COLOUR_FAMILIES)

const imageObservationSchema = z.object({
  /** Number of the garment image this entry describes, starting at 1. */
  image: z.number().int().min(1).max(MAX_GARMENT_IMAGES),
  garment: z.string().trim().min(2).max(32).nullable(),
  category: z.enum(OBSERVED_CATEGORIES),
  identification: statusSchema,
  colours: z.object({
    dominant: z.array(colourSchema).max(2),
    secondary: z.array(colourSchema).max(2),
  }).strict(),
  colour_status: statusSchema,
  pattern: z.enum(PATTERNS),
  details: z.array(z.string().trim().min(3).max(48)).max(MAX_DETAILS),
  limits: z.array(z.enum(IMAGE_LIMITS)).max(4),
}).strict()

const viewsSchema = z.object({
  same_garment: z.enum(VIEW_AGREEMENT),
  conflicts: z.string().trim().max(100).optional(),
}).strict()

export const observationsPayloadSchema = z.object({
  images: z.array(imageObservationSchema).min(1).max(MAX_GARMENT_IMAGES),
  views: viewsSchema.optional(),
}).strict()

/**
 * Why a block was refused, as fixed codes. Safe to log and to count: a code
 * never carries model text.
 */
export const OBSERVATION_PROBLEMS = [
  'schema',
  'image_mapping',
  'views_missing',
  'views_unexpected',
  'views_unexplained',
  'views_contradiction',
  'identification_inconsistent',
  'colour_inconsistent',
  'duplicate_detail',
  'unsupported_text',
] as const
export type ObservationProblem = (typeof OBSERVATION_PROBLEMS)[number]

export interface ObservationContext {
  mode: GarmentMode
  /** How many garment images were sent. */
  garmentCount: number
}

export interface ObservationInspection {
  /** The validated block, or null when it was refused. */
  value: Observations | null
  problems: ObservationProblem[]
  /** Zod issues when the shape itself was wrong; for safe logging of paths only. */
  schemaError?: unknown
}

function imageProblems(entry: z.infer<typeof imageObservationSchema>): ObservationProblem[] {
  const problems: ObservationProblem[] = []
  const unidentified = entry.identification === 'not_visible'
  if (unidentified && (entry.garment !== null || entry.category !== 'unclear')) problems.push('identification_inconsistent')
  if (entry.category === 'unclear' && entry.identification === 'observed') problems.push('identification_inconsistent')

  const colours = [...entry.colours.dominant, ...entry.colours.secondary]
  if (colours.length > MAX_COLOURS || new Set(colours).size !== colours.length) problems.push('colour_inconsistent')
  if (entry.colour_status === 'not_visible' ? colours.length > 0 : entry.colours.dominant.length === 0) problems.push('colour_inconsistent')

  if (new Set(entry.details.map((detail) => detail.toLowerCase())).size !== entry.details.length) problems.push('duplicate_detail')
  const texts = [entry.garment ?? '', ...entry.details]
  if (texts.some((text) => screenClaims(text).length > 0)) problems.push('unsupported_text')
  return problems
}

/**
 * An empty garment name means "no name", the same as null. Only that one
 * equivalence is applied; nothing else in the block is rewritten.
 */
function normaliseEmptyNames(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { images?: unknown }).images)) return raw
  const block = raw as { images: unknown[] }
  return {
    ...block,
    images: block.images.map((entry) => (entry && typeof entry === 'object' && (entry as { garment?: unknown }).garment === '' ? { ...entry, garment: null } : entry)),
  }
}

/**
 * Validates the block against what was actually sent: one entry for each
 * garment image, numbered 1 to the number of images, and a `views` entry
 * exactly when the images are views of one garment. Returns every problem
 * found, so an evaluation can count them; the block is usable only when there
 * are none.
 */
export function inspectObservations(raw: unknown, context: ObservationContext): ObservationInspection {
  const parsed = observationsPayloadSchema.safeParse(normaliseEmptyNames(raw))
  if (!parsed.success) return { value: null, problems: ['schema'], schemaError: parsed.error }
  const block = parsed.data
  const problems = new Set<ObservationProblem>()

  const numbers = block.images.map((entry) => entry.image).sort((a, b) => a - b)
  if (numbers.length !== context.garmentCount || numbers.some((number, index) => number !== index + 1)) problems.add('image_mapping')

  if (context.mode === 'same_garment_views') {
    if (!block.views) problems.add('views_missing')
    else {
      const conflicts = block.views.conflicts?.trim() ?? ''
      if (block.views.same_garment !== 'yes' && conflicts.length === 0) problems.add('views_unexplained')
      if (conflicts.length > 0 && screenClaims(conflicts).length > 0) problems.add('unsupported_text')
      // Views that are said to show one garment cannot be identified as two different kinds of garment.
      const identified = new Set(block.images.filter((entry) => entry.identification === 'observed').map((entry) => entry.category))
      if (block.views.same_garment === 'yes' && identified.size > 1) problems.add('views_contradiction')
    }
  } else if (block.views) {
    problems.add('views_unexpected')
  }

  for (const entry of block.images) for (const problem of imageProblems(entry)) problems.add(problem)

  const ordered = OBSERVATION_PROBLEMS.filter((problem) => problems.has(problem))
  if (ordered.length > 0) return { value: null, problems: ordered }

  const images: GarmentObservation[] = [...block.images].sort((a, b) => a.image - b.image).map((entry) => ({ ...entry }))
  const conflicts = block.views?.conflicts?.trim()
  return {
    value: {
      availability: 'available',
      images,
      ...(block.views ? { views: { same_garment: block.views.same_garment, ...(conflicts ? { conflicts } : {}) } } : {}),
    },
    problems: [],
  }
}

// ---------------------------------------------------------------------------
// References to observations
// ---------------------------------------------------------------------------

/** `g<image>.type`, `g<image>.colour`, `g<image>.pattern` or `g<image>.d<detail>`. */
export const CITE_PATTERN = /^g([1-3])\.(type|colour|pattern|d([1-3]))$/

export type CiteField = 'type' | 'colour' | 'pattern' | 'detail'

export interface ResolvedCite {
  image: number
  field: CiteField
  /** For a detail: its position in the list, starting at 1. */
  detail?: number
  observation: GarmentObservation
}

/**
 * Resolves a reference to the observation it names. Null when that
 * observation does not exist or was reported as not visible: a rating can
 * never rest on something that was not seen.
 */
export function resolveCite(cite: string, observations: Observations | null): ResolvedCite | null {
  const match = CITE_PATTERN.exec(cite)
  if (!match || !observations || observations.availability !== 'available') return null
  const image = Number(match[1])
  const observation = observations.images.find((entry) => entry.image === image)
  if (!observation) return null
  const kind = match[2]
  if (kind === 'type') return observation.identification === 'not_visible' || observation.category === 'unclear' ? null : { image, field: 'type', observation }
  if (kind === 'colour') return observation.colour_status === 'not_visible' ? null : { image, field: 'colour', observation }
  if (kind === 'pattern') return observation.pattern === 'unclear' ? null : { image, field: 'pattern', observation }
  const detail = Number(match[3])
  return detail <= observation.details.length ? { image, field: 'detail', detail, observation } : null
}
