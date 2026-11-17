import type { GarmentMode } from '@/lib/constants/garmentModes'
import { validateOutfitComponents } from '@/lib/services/openai/outfitComponentsSchema'
import type { OutfitComponents } from '@/types/schema'

/**
 * Converts untrusted model output into application-owned per-item notes.
 *
 * Only the `outfit_items` mode has components. For every other mode the block
 * is ignored even if the model returned one. A missing or malformed block makes
 * the notes unavailable and leaves the analysis, and the verdict computed from
 * its ratings, exactly as they are.
 */
export function buildOutfitComponents(rawComponents: unknown, garmentMode: GarmentMode, garmentCount: number): OutfitComponents {
  if (garmentMode !== 'outfit_items') return { availability: 'not_applicable', items: [] }

  try {
    return { availability: 'available', items: validateOutfitComponents(rawComponents, garmentCount) }
  } catch {
    return { availability: 'unavailable', items: [] }
  }
}
