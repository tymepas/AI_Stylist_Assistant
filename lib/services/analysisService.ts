// AnalysisService
// -----------------------------------------------------------------------------
// Phase 1 MOCK ONLY. No real AI model is called anywhere in this file.
// The shape of every returned object matches AI_OUTPUT_SCHEMA.md exactly.
// The weighted verdict formula matches PRD.md "Verdict Calculation (v1)".
// -----------------------------------------------------------------------------

import {
  Dimensions,
  DimensionResult,
  AnalysisResult,
  CompleteAnalysisResult,
  UnableToAnalyzeResult,
  OverallRecommendation,
  ImageMeta,
} from '@/types/schema'

const RATING_SCORES: Record<string, number> = {
  Excellent: 5,
  Good: 4,
  Fair: 3,
  Poor: 2,
}

// Only 5 of the 6 dimensions are part of the weighted formula per PRD.md.
// "style" (Style Consistency) is displayed but excluded from the calculation,
// exactly as specified in the PRD's Verdict Calculation table.
const DIMENSION_WEIGHTS: Record<string, number> = {
  occasion: 0.3,
  formality: 0.25,
  style_preference_match: 0.2,
  color: 0.15,
  seasonality: 0.1,
}

export function computeVerdict(
  dimensions: Dimensions
): { overall_recommendation: OverallRecommendation; verdict_score: number } {
  let weightedSum = 0
  let weightTotal = 0

  Object.keys(DIMENSION_WEIGHTS).forEach((key) => {
    const dim = (dimensions as unknown as Record<string, DimensionResult>)[key]
    const weight = DIMENSION_WEIGHTS[key]
    if (dim && dim.rating !== 'Unable to Evaluate') {
      weightedSum += RATING_SCORES[dim.rating] * weight
      weightTotal += weight
    }
  })

  if (weightTotal === 0) {
    return { overall_recommendation: 'Consider Alternatives', verdict_score: 0 }
  }

  const rawScore = weightedSum / weightTotal
  const verdict_score = Math.round(rawScore * 10) / 10

  let overall_recommendation: OverallRecommendation
  if (verdict_score >= 4.5) overall_recommendation = 'Highly Recommended'
  else if (verdict_score >= 3.5) overall_recommendation = 'Recommended'
  else if (verdict_score >= 2.5) overall_recommendation = 'Consider Alternatives'
  else overall_recommendation = 'Not Recommended'

  return { overall_recommendation, verdict_score }
}

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_SIZE_BYTES = 10 * 1024 * 1024

export function validateImageMeta(meta: ImageMeta | undefined | null): { valid: boolean; message?: string } {
  if (!meta || !meta.type) return { valid: false, message: 'Image data is missing.' }
  if (!ALLOWED_TYPES.includes(meta.type)) {
    return { valid: false, message: 'Please upload a JPEG, PNG, or WEBP image.' }
  }
  if (!meta.size || meta.size <= 0) {
    return { valid: false, message: 'The uploaded file appears to be empty.' }
  }
  if (meta.size > MAX_SIZE_BYTES) {
    return { valid: false, message: 'Image must be smaller than 10MB.' }
  }
  return { valid: true }
}

function buildMockA(): CompleteAnalysisResult {
  const dimensions: Dimensions = {
    occasion: {
      rating: 'Excellent',
      reason: 'The tailored blazer and trousers align closely with the professional formality this interview calls for.',
      confidence: 'High',
    },
    color: {
      rating: 'Excellent',
      reason: "The deep navy tone reads as polished and pairs well with a wide range of skin tones for this setting.",
      confidence: 'High',
    },
    formality: {
      rating: 'Excellent',
      reason: 'The structured silhouette and clean lines match the formality expected for this occasion.',
      confidence: 'High',
    },
    seasonality: {
      rating: 'Good',
      reason: 'The fabric weight works for most of the year, though it may run warm in peak summer heat.',
      confidence: 'Medium',
    },
    style: {
      rating: 'Excellent',
      reason: 'The tailored, clean cut is consistent with a classic, minimalist aesthetic.',
      confidence: 'High',
    },
    style_preference_match: {
      rating: 'Good',
      reason: 'This closely matches your stated preference for classic, minimalist pieces.',
      confidence: 'High',
    },
  }
  const verdict = computeVerdict(dimensions)
  return {
    status: 'complete',
    dimensions,
    things_to_consider: [
      'A lighter undershirt could help if this will be worn somewhere warm.',
      'Keep accessories minimal to stay aligned with your stated style preference.',
    ],
    analysis_based_on: {
      considered: ['photo', 'garment', 'occasion', 'style_preference'],
      not_considered: ['price', 'material_quality', 'brand', 'durability', 'comfort'],
    },
    next_step: 'You can move forward with this purchase with confidence.',
    ...verdict,
  }
}

function buildMockB(): CompleteAnalysisResult {
  const dimensions: Dimensions = {
    occasion: {
      rating: 'Poor',
      reason: 'A distressed denim jacket falls well short of the formality typically expected at a wedding.',
      confidence: 'High',
    },
    color: {
      rating: 'Fair',
      reason: 'The faded wash reads as casual and does not stand out appropriately for a formal event.',
      confidence: 'Medium',
    },
    formality: {
      rating: 'Poor',
      reason: 'This garment reads as casual streetwear, well below the formality this occasion calls for.',
      confidence: 'High',
    },
    seasonality: {
      rating: 'Fair',
      reason: 'The denim weight is reasonable for the season, though that is the only aspect that fits well.',
      confidence: 'Medium',
    },
    style: {
      rating: 'Poor',
      reason: 'The distressed, casual style clashes with the polished aesthetic this occasion calls for.',
      confidence: 'High',
    },
    style_preference_match: {
      rating: 'Poor',
      reason: "You stated a preference for classic, formal style. This distressed, casual jacket directly conflicts with that preference.",
      confidence: 'High',
    },
  }
  const verdict = computeVerdict(dimensions)
  return {
    status: 'complete',
    dimensions,
    things_to_consider: [
      'A tailored blazer or suit jacket would be a stronger fit for this occasion.',
      'Save this piece for casual, low-key outings where it fits your existing wardrobe better.',
    ],
    analysis_based_on: {
      considered: ['photo', 'garment', 'occasion', 'style_preference'],
      not_considered: ['price', 'material_quality', 'brand', 'durability', 'comfort'],
    },
    next_step: 'Consider a more formal alternative before purchasing.',
    ...verdict,
  }
}

function buildMockC(): UnableToAnalyzeResult {
  const variants = [
    'We could not clearly detect a person in the uploaded photo, so we are unable to evaluate fit and formality.',
    'The uploaded images are too low quality or too dark to reliably identify the garment details.',
  ]
  const reason = variants[Math.floor(Math.random() * variants.length)]
  return {
    status: 'unable_to_analyze',
    reason,
    confidence: 'Low',
    next_step: 'Please retake both photos in good lighting with the person and garment clearly visible, then try again.',
  }
}

// Rotates randomly across all three scenarios so every UI state is reachable.
export function getMockAnalysis(): AnalysisResult {
  const roll = Math.random()
  if (roll < 0.34) return buildMockA()
  if (roll < 0.68) return buildMockB()
  return buildMockC()
}
