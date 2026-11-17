import { logEvent, summarizeValidationIssues } from '@/lib/observability/safeLogger'
import { validateShoppingRecommendations } from '@/lib/services/openai/shoppingRecommendationSchema'
import type { ShoppingAdvisor } from '@/types/schema'

/**
 * Converts untrusted model shopping output into an application-owned advisor.
 * Core analysis is intentionally unaffected if this optional extension fails.
 *
 * `rawAdvisor` is the block as a model returns it: `{ recommendations: [...] }`
 * and nothing else. A block that does not validate makes the advisor
 * `unavailable`; the report then says so instead of leaving a gap. The drop is
 * logged with the schema paths involved and never with the content, so a
 * section that goes missing can be traced.
 */
export function buildShoppingAdvisor(rawAdvisor: unknown, hasStyleDna: boolean, requestId?: string): ShoppingAdvisor {
  if (!hasStyleDna) return { availability: 'requires_style_dna', recommendations: [] }

  try {
    return { availability: 'available', recommendations: validateShoppingRecommendations(rawAdvisor) }
  } catch (error) {
    logEvent('warn', 'shopping_advisor_unavailable', { request_id: requestId, operation: 'analysis', validation: 'failed', ...summarizeValidationIssues(error) })
    return { availability: 'unavailable', recommendations: [] }
  }
}
