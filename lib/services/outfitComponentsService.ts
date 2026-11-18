import type { GarmentMode } from '@/lib/constants/garmentModes'
import { logEvent, summarizeValidationIssues } from '@/lib/observability/safeLogger'
import { inspectContributions, parseOutfitComponents } from '@/lib/services/openai/outfitComponentsSchema'
import type { Observations, OutfitComponents } from '@/types/schema'

/**
 * Converts untrusted model output into application-owned per-item notes.
 *
 * Only the `outfit_items` mode has components. For every other mode the block
 * is ignored even if the model returned one. A missing or malformed block makes
 * the notes unavailable and leaves the analysis, and the verdict computed from
 * its ratings, exactly as they are. The report then says the notes are
 * unavailable instead of leaving a gap, and the drop is logged with the schema
 * paths involved, never with the content.
 *
 * Item contributions (analysis-output/4) are then checked against the
 * validated observations, item by item. A refused contribution is dropped and
 * logged by problem code; the note it came with is kept.
 */
export function buildOutfitComponents(rawComponents: unknown, garmentMode: GarmentMode, garmentCount: number, requestId?: string, observations: Observations | null = null): OutfitComponents {
  if (garmentMode !== 'outfit_items') return { availability: 'not_applicable', items: [] }

  try {
    const parsed = parseOutfitComponents(rawComponents, garmentCount)
    const inspection = inspectContributions(parsed, observations?.availability === 'available' ? observations : null)
    const items = parsed.map(({ item, garment_type, assessment, note }) => {
      const contribution = inspection.contributions.get(item)
      return { item, garment_type, assessment, note, ...(contribution ? { contribution } : {}) }
    })
    const valid = inspection.contributions.size
    if (inspection.problems.size > 0) {
      logEvent('warn', 'outfit_contributions_unavailable', {
        request_id: requestId,
        operation: 'analysis',
        validation: valid > 0 ? 'partial' : 'failed',
        problem_codes: [...new Set([...inspection.problems.values()].flat())].sort(),
      })
    }
    return { availability: 'available', items, contributions: valid === items.length ? 'available' : valid === 0 ? 'unavailable' : 'partial' }
  } catch (error) {
    logEvent('warn', 'outfit_components_unavailable', { request_id: requestId, operation: 'analysis', validation: 'failed', ...summarizeValidationIssues(error) })
    return { availability: 'unavailable', items: [] }
  }
}
