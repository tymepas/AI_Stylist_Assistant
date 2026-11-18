import { z } from 'zod'
import { MAX_GARMENT_IMAGES } from '@/lib/constants/garmentModes'
import { shoppingGarmentCategorySchema } from '@/lib/services/openai/shoppingRecommendationSchema'
import { CITE_PATTERN, resolveCite } from '@/lib/services/openai/observationsSchema'
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

const dimensionList = z.array(z.enum(CONTRIBUTION_DIMENSIONS)).max(CONTRIBUTION_DIMENSIONS.length)

const outfitComponentSchema = z.object({
  /** Number of the garment image this entry describes, starting at 1. */
  item: z.number().int().min(1).max(MAX_GARMENT_IMAGES),
  garment_type: shoppingGarmentCategorySchema,
  assessment: z.enum(OUTFIT_COMPONENT_ASSESSMENTS),
  note: z.string().trim().min(8).max(240),
  supports: dimensionList.optional(),
  tension: dimensionList.optional(),
  unclear: dimensionList.optional(),
  cites: z.array(z.string().regex(CITE_PATTERN)).max(MAX_CONTRIBUTION_CITES).optional(),
}).strict()

export const outfitComponentsPayloadSchema = z.array(outfitComponentSchema).min(2).max(MAX_GARMENT_IMAGES)

type ParsedComponent = z.infer<typeof outfitComponentSchema>

/**
 * Validates the block against the number of garment images that were sent:
 * exactly one entry per image, each image described once. Returned in image
 * order, with the note fields only; contributions are checked separately
 * (inspectContributions), because they depend on the observations.
 */
export function parseOutfitComponents(value: unknown, garmentCount: number): ParsedComponent[] {
  const items = outfitComponentsPayloadSchema.parse(value)
  const numbers = items.map((entry) => entry.item).sort((a, b) => a - b)
  const expected = Array.from({ length: garmentCount }, (_, index) => index + 1)
  if (numbers.length !== expected.length || numbers.some((number, index) => number !== expected[index])) {
    throw new Error('Outfit components must describe each garment image exactly once.')
  }
  return [...items].sort((a, b) => a.item - b.item)
}

export function validateOutfitComponents(value: unknown, garmentCount: number): OutfitComponent[] {
  return parseOutfitComponents(value, garmentCount).map(({ item, garment_type, assessment, note }) => ({ item, garment_type, assessment, note }))
}

export const CONTRIBUTION_PROBLEMS = ['overlapping_dimension', 'uncited_effect', 'foreign_citation', 'invalid_citation', 'identity_mismatch'] as const
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
 * - a dimension appears in at most one list (`overlapping_dimension`);
 * - supporting or straining a dimension needs at least one citation (`uncited_effect`);
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
    if (supports.length + tension.length > 0 && cites.length === 0) found.add('uncited_effect')
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
