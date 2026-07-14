import { describe, expect, it } from '@jest/globals'
import { buildRetailSearchQuery, getRetailSearchLinks } from '@/lib/services/retailSearchService'
import type { ShoppingRecommendation } from '@/types/schema'

const recommendation: ShoppingRecommendation = { title: 'Structured navy blazer', garment_type: 'suiting', color_direction: 'Deep navy', style_direction: 'Clean classic tailoring', rationale: 'A polished alternative for professional settings.', addresses: ['occasion', 'formality'], match_level: 'Excellent Match' }

describe('Retail search links', () => {
  it('constructs a retailer-neutral query from recommendation data', () => expect(buildRetailSearchQuery(recommendation, 'Client Presentation')).toBe('Deep navy Clean classic tailoring Structured navy blazer Client Presentation'))
  it('returns only approved retailers with encoded queries', () => { const links = getRetailSearchLinks(recommendation, 'Client Presentation'); expect(links.map((link) => link.label)).toEqual(['View on Myntra', 'View on Amazon', 'View on Ajio']); expect(links.every((link) => link.href.includes('Structured%20navy%20blazer'))).toBe(true); expect(links.some((link) => /affiliate|tag=|ref=/.test(link.href))).toBe(false) })
})