import { z } from 'zod'
import { MAX_GARMENT_IMAGES } from '@/lib/constants/garmentModes'
import { shoppingGarmentCategorySchema } from '@/lib/services/openai/shoppingRecommendationSchema'
import type { OutfitComponent } from '@/types/schema'

/**
 * Per-item notes for an outfit made of several garment images (garment mode
 * `outfit_items`). Advisory only: it is validated separately from the core
 * analysis, exactly like the shopping advisor, so a missing or malformed block
 * can never invalidate the ratings, and nothing in it can reach the verdict.
 *
 * The assessment is a qualitative label about how one item works within the
 * outfit. It is not a rating of a dimension, not a score and not a verdict.
 */
export const OUTFIT_COMPONENT_ASSESSMENTS = ['Works well', 'Works', 'Needs attention', 'Unable to tell'] as const

const outfitComponentSchema = z.object({
  /** Number of the garment image this entry describes, starting at 1. */
  item: z.number().int().min(1).max(MAX_GARMENT_IMAGES),
  garment_type: shoppingGarmentCategorySchema,
  assessment: z.enum(OUTFIT_COMPONENT_ASSESSMENTS),
  note: z.string().trim().min(8).max(240),
}).strict()

export const outfitComponentsPayloadSchema = z.array(outfitComponentSchema).min(2).max(MAX_GARMENT_IMAGES)

/**
 * Validates the block against the number of garment images that were sent:
 * exactly one entry per image, each image described once. Returned in image order.
 */
export function validateOutfitComponents(value: unknown, garmentCount: number): OutfitComponent[] {
  const items = outfitComponentsPayloadSchema.parse(value)
  const numbers = items.map((entry) => entry.item).sort((a, b) => a - b)
  const expected = Array.from({ length: garmentCount }, (_, index) => index + 1)
  if (numbers.length !== expected.length || numbers.some((number, index) => number !== expected[index])) {
    throw new Error('Outfit components must describe each garment image exactly once.')
  }
  return [...items].sort((a, b) => a.item - b.item)
}
