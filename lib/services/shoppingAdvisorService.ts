import { validateShoppingRecommendations } from '@/lib/services/openai/shoppingRecommendationSchema'
import type { ShoppingAdvisor } from '@/types/schema'

/**
 * Converts untrusted model shopping output into an application-owned advisor.
 * Core analysis is intentionally unaffected if this optional extension fails.
 */
export function buildShoppingAdvisor(rawAdvisor: unknown, hasStyleDna: boolean): ShoppingAdvisor {
  if (!hasStyleDna) return { availability: 'requires_style_dna', recommendations: [] }

  try {
    return { availability: 'available', recommendations: validateShoppingRecommendations(rawAdvisor) }
  } catch {
    return { availability: 'unavailable', recommendations: [] }
  }
}