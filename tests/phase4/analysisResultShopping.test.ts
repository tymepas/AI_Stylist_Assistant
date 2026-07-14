import { describe, expect, it } from '@jest/globals'
import { buildCompleteAnalysisResult } from '@/lib/services/analysisResultService'
import { computeVerdict } from '@/lib/services/analysisService'
import type { RawOpenAIDimensions } from '@/types/openai'

const dimensions: RawOpenAIDimensions = {
  occasion: { rating: 'Good', reason: 'Appropriate for the occasion.', confidence: 'High' },
  color: { rating: 'Good', reason: 'Color direction is compatible.', confidence: 'High' },
  formality: { rating: 'Fair', reason: 'Slightly less formal than ideal.', confidence: 'Medium' },
  seasonality: { rating: 'Excellent', reason: 'Seasonally suitable.', confidence: 'High' },
  style: { rating: 'Good', reason: 'Style is consistent.', confidence: 'High' },
  style_preference_match: { rating: 'Good', reason: 'Matches preferences.', confidence: 'High' },
}

const advisor = {
  availability: 'available' as const,
  recommendations: [{
    title: 'Structured navy blazer',
    garment_type: 'suiting' as const,
    color_direction: 'Deep navy',
    style_direction: 'Clean classic tailoring',
    rationale: 'A polished alternative for professional settings.',
    addresses: ['occasion', 'formality'] as Array<keyof RawOpenAIDimensions>,
    match_level: 'Excellent Match' as const,
  }],
}

describe('Shopping Advisor verdict isolation', () => {
  it('passes advisory data through without changing the deterministic verdict', () => {
    const result = buildCompleteAnalysisResult(dimensions, advisor)
    expect({ overall_recommendation: result.overall_recommendation, verdict_score: result.verdict_score }).toEqual(computeVerdict(dimensions))
    expect(result.shopping_advisor).toEqual(advisor)
  })
})