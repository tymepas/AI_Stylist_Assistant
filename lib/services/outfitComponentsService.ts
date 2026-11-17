import type { GarmentMode } from '@/lib/constants/garmentModes'
import { logEvent, summarizeValidationIssues } from '@/lib/observability/safeLogger'
import { validateOutfitComponents } from '@/lib/services/openai/outfitComponentsSchema'
import type { OutfitComponents } from '@/types/schema'

/**
 * Converts untrusted model output into application-owned per-item notes.
 *
 * Only the `outfit_items` mode has components. For every other mode the block
 * is ignored even if the model returned one. A missing or malformed block makes
 * the notes unavailable and leaves the analysis, and the verdict computed from
 * its ratings, exactly as they are. The report then says the notes are
 * unavailable instead of leaving a gap, and the drop is logged with the schema
 * paths involved, never with the content.
 */
export function buildOutfitComponents(rawComponents: unknown, garmentMode: GarmentMode, garmentCount: number, requestId?: string): OutfitComponents {
  if (garmentMode !== 'outfit_items') return { availability: 'not_applicable', items: [] }

  try {
    return { availability: 'available', items: validateOutfitComponents(rawComponents, garmentCount) }
  } catch (error) {
    logEvent('warn', 'outfit_components_unavailable', { request_id: requestId, operation: 'analysis', validation: 'failed', ...summarizeValidationIssues(error) })
    return { availability: 'unavailable', items: [] }
  }
}
