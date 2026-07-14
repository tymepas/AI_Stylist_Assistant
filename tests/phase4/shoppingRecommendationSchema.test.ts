import { describe, expect, it } from '@jest/globals'
import { validateShoppingRecommendations } from '@/lib/services/openai/shoppingRecommendationSchema'

const validAdvisor = { recommendations: [{ title: 'Structured navy blazer', garment_type: 'suiting', color_direction: 'Deep navy', style_direction: 'Clean, classic tailoring', rationale: 'A polished alternative that better supports a professional setting.', addresses: ['occasion', 'formality'], match_level: 'Excellent Match' }] }

describe('Shopping recommendation schema', () => {
  it('accepts a bounded, structured recommendation', () => expect(validateShoppingRecommendations(validAdvisor)).toEqual(validAdvisor.recommendations))
  it('rejects numeric confidence and unknown fields', () => expect(() => validateShoppingRecommendations({ recommendations: [{ ...validAdvisor.recommendations[0], confidence: 92 }] })).toThrow())
  it('rejects more than three recommendations', () => expect(() => validateShoppingRecommendations({ recommendations: Array.from({ length: 4 }, () => validAdvisor.recommendations[0]) })).toThrow())
  it('rejects values outside the qualitative match enum', () => expect(() => validateShoppingRecommendations({ recommendations: [{ ...validAdvisor.recommendations[0], match_level: 'Very Good' }] })).toThrow())
})