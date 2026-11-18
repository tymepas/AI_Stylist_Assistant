import { z } from 'zod'
import { MAX_GARMENT_IMAGES } from '@/lib/constants/garmentModes'
import { shoppingGarmentCategorySchema } from '@/lib/services/openai/shoppingRecommendationSchema'
import { CITE_PATTERN, IMAGE_LIMITS, resolveCite } from '@/lib/services/openai/observationsSchema'
import type { ComponentContribution, Observations, OutfitComponent } from '@/types/schema'

/**
 * Per-item notes for an outfit made of several garment images (garment mode
 * `outfit_items`). Advisory only: it is validated separately from the core
 * analysis, exactly like the shopping advisor, so a missing or malformed block
 * can never invalidate the ratings, and nothing in it can reach the verdict.
 *
 * The assessment is a qualitative label about how one item works within the
 * outfit. It is not a rating of a dimension, not a score and not a verdict.
 *
 * Since analysis-output/4 (Phase 4 Milestone 3) an item may also say which of
 * the six dimensions it SUPPORTS, which it creates TENSION with, and which it
 * cannot be judged against (UNCLEAR), citing its own visible observations. A
 * dimension it does not list is one it has little influence on. These
 * contributions explain the outfit-level ratings; they never replace them,
 * never produce a rating of their own, and never reach the verdict.
 */
export const OUTFIT_COMPONENT_ASSESSMENTS = ['Works well', 'Works', 'Needs attention', 'Unable to tell'] as const
export const CONTRIBUTION_DIMENSIONS = ['occasion', 'color', 'formality', 'seasonality', 'style', 'style_preference_match'] as const
export const MAX_CONTRIBUTION_CITES = 3
const LIMIT_CITE = new RegExp(`^g[1-3]\\.(${IMAGE_LIMITS.join('|')})$`)

/** The British spelling the prompt uses elsewhere (`colour_status`, `g1.colour`) is read as the dimension `color`. */
const dimensionName = z.preprocess((value) => (value === 'colour' ? 'color' : value), z.enum(CONTRIBUTION_DIMENSIONS))
const dimensionList = z.array(dimensionName).max(CONTRIBUTION_DIMENSIONS.length)

/**
 * The contribution fields are checked apart from the note. A malformed one
 * (an unknown dimension, a citation that is not a citation, too many
 * citations) drops that item's contribution only, never the item's note or
 * the rest of the block.
 */
const contributionSchema = z.object({
  supports: dimensionList.optional(),
  tension: dimensionList.optional(),
  unclear: dimensionList.optional(),
  cites: z.array(z.string().regex(CITE_PATTERN)).max(MAX_CONTRIBUTION_CITES).optional(),
})

const outfitComponentSchema = z.object({
  /** Number of the garment image this entry describes, starting at 1. */
  item: z.number().int().min(1).max(MAX_GARMENT_IMAGES),
  garment_type: shoppingGarmentCategorySchema,
  assessment: z.enum(OUTFIT_COMPONENT_ASSESSMENTS),
  note: z.string().trim().min(8).max(240),
  supports: z.unknown().optional(),
  tension: z.unknown().optional(),
  unclear: z.unknown().optional(),
  cites: z.unknown().optional(),
}).strict()

export const outfitComponentsPayloadSchema = z.array(outfitComponentSchema).min(2).max(MAX_GARMENT_IMAGES)

type ParsedContribution = z.infer<typeof contributionSchema>

export interface ParsedComponent extends ParsedContribution {
  item: number
  garment_type: OutfitComponent['garment_type']
  assessment: OutfitComponent['assessment']
  note: string
  /** True when the item stated contribution fields that do not have the required shape. */
  malformed_contribution?: true
}

/**
 * Validates the block against the number of garment images that were sent:
 * exactly one entry per image, each image described once. Returned in image
 * order; contributions are checked separately (inspectContributions), because
 * they depend on the observations.
 */
export function parseOutfitComponents(value: unknown, garmentCount: number): ParsedComponent[] {
  const items = outfitComponentsPayloadSchema.parse(value)
  const numbers = items.map((entry) => entry.item).sort((a, b) => a - b)
  const expected = Array.from({ length: garmentCount }, (_, index) => index + 1)
  if (numbers.length !== expected.length || numbers.some((number, index) => number !== expected[index])) {
    throw new Error('Outfit components must describe each garment image exactly once.')
  }
  return [...items].sort((a, b) => a.item - b.item).map(({ item, garment_type, assessment, note, supports, tension, unclear, cites }) => {
    const core = { item, garment_type, assessment, note }
    const stated = { supports, tension, unclear, cites }
    if (Object.values(stated).every((field) => field === undefined)) return core
    const contribution = contributionSchema.safeParse(stated)
    return contribution.success ? { ...core, ...contribution.data } : { ...core, malformed_contribution: true as const }
  })
}

export function validateOutfitComponents(value: unknown, garmentCount: number): OutfitComponent[] {
  return parseOutfitComponents(value, garmentCount).map(({ item, garment_type, assessment, note }) => ({ item, garment_type, assessment, note }))
}

export const CONTRIBUTION_PROBLEMS = ['malformed_contribution', 'overlapping_dimension', 'uncited_effect', 'foreign_citation', 'invalid_citation', 'identity_mismatch'] as const
export type ContributionProblem = (typeof CONTRIBUTION_PROBLEMS)[number]

export interface ContributionInspection {
  /** Valid contributions, by item number. */
  contributions: Map<number, ComponentContribution>
  /** Problems, by item number, for items that stated a contribution that was refused. */
  problems: Map<number, ContributionProblem[]>
  /** Items that stated no contribution at all. */
  silent: number[]
}

/**
 * Checks what each item says about the six dimensions:
 * - the fields have the required shape (`malformed_contribution`);
 * - a dimension appears in at most one list, and a citation at most once (`overlapping_dimension`);
 * - supporting or straining a dimension needs at least one citation of something SEEN: a photo
 *   limit explains uncertainty, it never supports an effect on its own (`uncited_effect`);
 * - an item cites only its OWN image (`foreign_citation`): one item's effect is never argued from another's;
 * - every citation resolves to a visible observation (`invalid_citation`); with no valid observations, none does;
 * - the item's garment type matches what its observation identified with confidence (`identity_mismatch`):
 *   a jacket is never described as a shirt.
 * A refused contribution is dropped; the item's note and every rating stay as they are.
 */
export function inspectContributions(items: ParsedComponent[], observations: Observations | null): ContributionInspection {
  const contributions = new Map<number, ComponentContribution>()
  const problems = new Map<number, ContributionProblem[]>()
  const silent: number[] = []
  for (const entry of items) {
    if (entry.malformed_contribution) {
      problems.set(entry.item, ['malformed_contribution'])
      continue
    }
    const supports = entry.supports ?? []
    const tension = entry.tension ?? []
    const unclear = entry.unclear ?? []
    const cites = entry.cites ?? []
    if (supports.length + tension.length + unclear.length + cites.length === 0) {
      silent.push(entry.item)
      continue
    }
    const found = new Set<ContributionProblem>()
    const all = [...supports, ...tension, ...unclear]
    if (new Set(all).size !== all.length || new Set(cites).size !== cites.length) found.add('overlapping_dimension')
    const seenCites = cites.filter((cite) => !LIMIT_CITE.test(cite))
    if (supports.length + tension.length > 0 && seenCites.length === 0) found.add('uncited_effect')
    if (cites.some((cite) => Number(CITE_PATTERN.exec(cite)?.[1]) !== entry.item)) found.add('foreign_citation')
    if (cites.some((cite) => resolveCite(cite, observations) === null)) found.add('invalid_citation')
    const observed = observations?.availability === 'available' ? observations.images.find((image) => image.image === entry.item) : undefined
    if (observed && observed.identification === 'observed' && observed.category !== 'unclear' && observed.category !== entry.garment_type) found.add('identity_mismatch')

    const ordered = CONTRIBUTION_PROBLEMS.filter((problem) => found.has(problem))
    if (ordered.length > 0) problems.set(entry.item, ordered)
    else contributions.set(entry.item, { supports: [...supports], tension: [...tension], unclear: [...unclear], cites: [...cites] })
  }
  return { contributions, problems, silent }
}
