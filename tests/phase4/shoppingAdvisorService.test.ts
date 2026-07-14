import { describe, expect, it } from '@jest/globals'
import { buildShoppingAdvisor } from '@/lib/services/shoppingAdvisorService'

const validAdvisor = { recommendations: [{ title: 'Structured navy blazer', garment_type: 'suiting', color_direction: 'Deep navy', style_direction: 'Clean, classic tailoring', rationale: 'A polished alternative that better supports a professional setting.', addresses: ['occasion', 'formality'], match_level: 'Excellent Match' }] }

describe('Shopping Advisor result isolation', () => {
  it('requires Style DNA before exposing personalized alternatives', () => expect(buildShoppingAdvisor(validAdvisor, false)).toEqual({ availability: 'requires_style_dna', recommendations: [] }))
  it('exposes validated recommendations when Style DNA is available', () => expect(buildShoppingAdvisor(validAdvisor, true)).toEqual({ availability: 'available', recommendations: validAdvisor.recommendations }))
  it('degrades an invalid advisor without invalidating core analysis', () => expect(buildShoppingAdvisor({ recommendations: [{ title: 'Missing required fields' }] }, true)).toEqual({ availability: 'unavailable', recommendations: [] }))
})