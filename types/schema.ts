// Types mirror AI_OUTPUT_SCHEMA.md exactly. Treat that document as the source of truth.

export type Rating = 'Excellent' | 'Good' | 'Fair' | 'Poor' | 'Unable to Evaluate'
export type Confidence = 'High' | 'Medium' | 'Low'
export type AnalysisStatus = 'complete' | 'unable_to_analyze'

export interface DimensionResult {
  rating: Rating
  reason: string
  confidence: Confidence
}

export interface Dimensions {
  occasion: DimensionResult
  color: DimensionResult
  formality: DimensionResult
  seasonality: DimensionResult
  style: DimensionResult
  style_preference_match: DimensionResult
}

export interface AnalysisBasedOn {
  considered: string[]
  not_considered: string[]
}

// Added by the application after computing the weighted formula from PRD.md.
// The model never produces these two fields directly.
export type OverallRecommendation =
  | 'Highly Recommended'
  | 'Recommended'
  | 'Consider Alternatives'
  | 'Not Recommended'

export interface CompleteAnalysisResult {
  status: 'complete'
  dimensions: Dimensions
  things_to_consider: string[]
  analysis_based_on: AnalysisBasedOn
  next_step: string
  overall_recommendation: OverallRecommendation
  verdict_score: number
}

export interface UnableToAnalyzeResult {
  status: 'unable_to_analyze'
  reason: string
  confidence: Confidence
  next_step: string
}

export type AnalysisResult = CompleteAnalysisResult | UnableToAnalyzeResult

export interface StyleProfile {
  preferredStyles: string[]
  favoriteColors: string[]
  occasionPreferences: string[]
}

export interface ImageMeta {
  name: string
  type: string
  size: number
}

export interface AnalyzeRequestPayload {
  occasion: string
  photo: ImageMeta
  garment: ImageMeta
  stylePreferences?: string[]
  styleProfile?: StyleProfile
}

export type AnalyzeErrorCode = 'missing_image' | 'invalid_upload' | 'server_error'

export interface AnalyzeErrorResponse {
  error: AnalyzeErrorCode
  message: string
}
