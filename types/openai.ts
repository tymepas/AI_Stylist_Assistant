export type RawOpenAIRating =
  | 'Excellent'
  | 'Good'
  | 'Fair'
  | 'Poor'
  | 'Unable to Evaluate'

export type RawOpenAIConfidence = 'High' | 'Medium' | 'Low'

export interface RawOpenAIDimensionResult {
  rating: RawOpenAIRating
  reason: string
  confidence: RawOpenAIConfidence
}

export interface RawOpenAIDimensions {
  occasion: RawOpenAIDimensionResult
  color: RawOpenAIDimensionResult
  formality: RawOpenAIDimensionResult
  seasonality: RawOpenAIDimensionResult
  style: RawOpenAIDimensionResult
  style_preference_match: RawOpenAIDimensionResult
}

export interface RawOpenAICompleteAnalysis {
  status: 'complete'
  dimensions: RawOpenAIDimensions
}

export interface RawOpenAIUnableToAnalyze {
  status: 'unable_to_analyze'
  reason: string
  confidence: 'Low'
  next_step: string
}

export type RawOpenAIAnalysisResult =
  | RawOpenAICompleteAnalysis
  | RawOpenAIUnableToAnalyze
