/**
 * Characterisation tests for retailer search link construction.
 * Links are built only from validated recommendation fields and fixed templates.
 */

import { describe, expect, it } from '@jest/globals'
import { buildRetailSearchQuery, getRetailSearchLinks } from '@/lib/services/retailSearchService'
import type { ShoppingRecommendation } from '@/types/schema'
import { VALID_RECOMMENDATION } from '../helpers/fixtures'

const recommendation = VALID_RECOMMENDATION as ShoppingRecommendation

describe('buildRetailSearchQuery', () => {
  it('replaces control characters and collapses whitespace', () => {
    const query = buildRetailSearchQuery({ ...recommendation, title: 'Navy\u0000blazer\n\t  jacket', color_direction: '  Deep\u007fnavy ' }, 'Office  Work')
    expect(query).toBe('Deep navy Clean, classic tailoring Navy blazer jacket Office Work')
  })

  it('caps the query at 180 characters', () => {
    const long = 'x'.repeat(120)
    expect(buildRetailSearchQuery({ ...recommendation, color_direction: long, style_direction: long }, 'Wedding Guest')).toHaveLength(180)
  })
})

describe('getRetailSearchLinks', () => {
  it('links only to the three fixed retailer hosts with an encoded query', () => {
    const links = getRetailSearchLinks({ ...recommendation, title: 'Blazer & "trousers" <b>' }, 'Office Work')
    expect(links.map((link) => new URL(link.href).host)).toEqual(['www.myntra.com', 'www.amazon.in', 'www.ajio.com'])
    for (const link of links) {
      expect(link.href).not.toMatch(/[\s<>"]/)
      expect(link.href).toContain(encodeURIComponent('Blazer & "trousers" <b>'))
    }
  })

  it('cannot be redirected to another host through recommendation text', () => {
    const links = getRetailSearchLinks({ ...recommendation, title: '//evil.example.com/@x', style_direction: 'https://evil.example.com' }, 'x')
    expect(links.map((link) => new URL(link.href).host)).toEqual(['www.myntra.com', 'www.amazon.in', 'www.ajio.com'])
  })
})
