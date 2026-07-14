import { RETAILERS, type Retailer } from '@/lib/constants/retailers'
import type { ShoppingRecommendation } from '@/types/schema'

const MAX_QUERY_LENGTH = 180

function normalizeQueryPart(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Builds a retailer-neutral query from validated recommendation data. */
export function buildRetailSearchQuery(recommendation: ShoppingRecommendation, occasion: string): string {
  return [recommendation.color_direction, recommendation.style_direction, recommendation.title, occasion]
    .map(normalizeQueryPart)
    .filter(Boolean)
    .join(' ')
    .slice(0, MAX_QUERY_LENGTH)
}

export function getRetailSearchLinks(recommendation: ShoppingRecommendation, occasion: string): Array<Retailer & { href: string }> {
  const encodedQuery = encodeURIComponent(buildRetailSearchQuery(recommendation, occasion))
  return RETAILERS.map((retailer) => ({ ...retailer, href: retailer.buildSearchUrl(encodedQuery) }))
}