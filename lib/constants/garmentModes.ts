/**
 * How the garment images of one analysis relate to each other. The user picks
 * the mode explicitly; it is never inferred from the number of images.
 *
 * - `single`: one garment image (the original behaviour).
 * - `same_garment_views`: two or three views of ONE garment (front, back, side).
 *   Together they are evidence about a single item.
 * - `outfit_items`: two or three DIFFERENT items that form one outfit
 *   (for example a shirt, trousers and a jacket).
 */
export const GARMENT_MODES = ['single', 'same_garment_views', 'outfit_items'] as const
export type GarmentMode = (typeof GARMENT_MODES)[number]

/** Most garment images one analysis accepts. */
export const MAX_GARMENT_IMAGES = 3

export function isGarmentMode(value: unknown): value is GarmentMode {
  return typeof value === 'string' && (GARMENT_MODES as readonly string[]).includes(value)
}

/** How many garment images a mode needs: exactly one for `single`, two or three otherwise. */
export function garmentCountRange(mode: GarmentMode): { min: number; max: number } {
  return mode === 'single' ? { min: 1, max: 1 } : { min: 2, max: MAX_GARMENT_IMAGES }
}

/** Null when the count fits the mode, otherwise a message that can be shown to the user. */
export function garmentCountProblem(mode: GarmentMode, count: number): string | null {
  const { min, max } = garmentCountRange(mode)
  if (count >= min && count <= max) return null
  if (mode === 'single') {
    return count === 0
      ? 'Please add a photo of the garment.'
      : 'One garment photo is expected here. To add more, choose "Views of one garment" or "Items of one outfit".'
  }
  if (count < min) {
    return mode === 'same_garment_views'
      ? 'Add at least two views of the garment, or switch to a single garment photo.'
      : 'Add at least two outfit items, or switch to a single garment photo.'
  }
  return `You can add up to ${MAX_GARMENT_IMAGES} garment photos.`
}

export const GARMENT_MODE_LABELS: Record<GarmentMode, { title: string; description: string }> = {
  single: { title: 'One garment photo', description: 'A single photo of the item you are considering.' },
  same_garment_views: { title: 'Views of one garment', description: 'Two or three photos of the same item, such as front, back and side.' },
  outfit_items: { title: 'Items of one outfit', description: 'Two or three different items worn together, such as a shirt, trousers and a jacket.' },
}
