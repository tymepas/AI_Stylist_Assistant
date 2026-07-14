// Types mirror AI_OUTPUT_SCHEMA.md and specs/phase3/05_STYLE_PROFILE_SCHEMA.md exactly.
// Treat those documents as the source of truth.

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
  /** Optional AI-generated style profile. Absent = existing behavior is preserved. */
  aiStyleProfile?: AIStyleProfile
}

export type AnalyzeErrorCode = 'missing_image' | 'invalid_upload' | 'server_error'

export interface AnalyzeErrorResponse {
  error: AnalyzeErrorCode
  message: string
}

// ---------------------------------------------------------------------------
// Phase 3 — AI Style Profile types
// Source of truth: specs/phase3/05_STYLE_PROFILE_SCHEMA.md
// ---------------------------------------------------------------------------

/** Discriminator for the AI profile generation result. */
export type AIStyleProfileStatus = 'complete' | 'unable_to_generate'

/** Confidence enum — shared with existing Confidence type but kept explicit for AI profile. */
export type AIProfileConfidence = 'High' | 'Medium' | 'Low'

/** Coloring section of the AI Style Profile. */
export interface ColoringSection {
  skin_tone_depth: 'very light' | 'light' | 'medium light' | 'medium' | 'medium deep' | 'deep' | null
  skin_tone_undertone: 'cool' | 'warm' | 'neutral' | null
  hair_color: string | null
  hair_color_family: 'light' | 'medium' | 'dark' | 'vivid' | null
  eye_color: string | null
  high_contrast: boolean | null
  confidence: AIProfileConfidence
}

/** Proportions section of the AI Style Profile. */
export interface ProportionsSection {
  frame_width: 'narrow' | 'medium' | 'broad' | null
  torso_length: 'short' | 'average' | 'long' | null
  shoulder_breadth: 'narrow' | 'medium' | 'broad' | null
  visible_posture_notes: string | null
  confidence: AIProfileConfidence
}

/** Aesthetic signals section of the AI Style Profile. */
export interface AestheticSignalsSection {
  current_outfit_formality:
    | 'casual'
    | 'smart casual'
    | 'business casual'
    | 'business formal'
    | 'formal'
    | null
  current_outfit_style: Array<
    | 'minimalist'
    | 'classic'
    | 'streetwear'
    | 'casual'
    | 'bohemian'
    | 'sporty'
    | 'romantic'
    | 'edgy'
    | 'preppy'
    | 'eclectic'
  >
  accessory_presence: 'none' | 'minimal' | 'moderate' | 'statement' | null
  pattern_preference_signal: 'solid' | 'subtle_pattern' | 'bold_pattern' | 'mixed' | null
  confidence: AIProfileConfidence
}

/** A single style keyword entry within the style_keywords array. */
export interface StyleKeywordItem {
  keyword:
    | 'Minimalist'
    | 'Classic'
    | 'Streetwear'
    | 'Casual'
    | 'Bohemian'
    | 'Sporty'
    | 'Romantic'
    | 'Edgy'
    | 'Preppy'
    | 'Eclectic'
    | 'Business'
    | 'Trendy'
  confidence: AIProfileConfidence
  source: 'observed' | 'inferred'
}

/**
 * Wardrobe context section — reserved for Phase 4.
 * Nullable/empty in Phase 3 to avoid breaking schema changes later.
 */
export interface WardrobeContext {
  visible_garment_notes: string | null
  color_palette_notes: string | null
}

/** Analysis notes section of the AI Style Profile. */
export interface AnalysisNotes {
  photo_quality: 'excellent' | 'good' | 'acceptable' | 'poor'
  visibility_limitations: string[]
  confidence_summary: string
}

/** Complete AI-generated Style Profile (status = "complete"). */
export interface AIStyleProfile {
  schema_version: '1.0'
  generated_at_utc: string
  status: 'complete'
  coloring: ColoringSection
  proportions: ProportionsSection
  aesthetic_signals: AestheticSignalsSection
  /** Minimum 1, maximum 5 items. */
  style_keywords: StyleKeywordItem[]
  wardrobe_context: WardrobeContext
  analysis_notes: AnalysisNotes
}

/** Returned by the AI when profile generation is not possible. */
export interface AIStyleProfileFailure {
  schema_version: '1.0'
  status: 'unable_to_generate'
  reason: string
  next_step: string
  confidence: 'Low'
}

/** Union of all possible AI profile generation results. */
export type AIStyleProfileResult = AIStyleProfile | AIStyleProfileFailure

// ---------------------------------------------------------------------------
// Phase 3 — parseAIStyleProfile result (request-parsing layer)
// ---------------------------------------------------------------------------

export interface ParseAIStyleProfileResult {
  /** Always true — malformed profile never blocks analysis (graceful degradation). */
  valid: true
  /** Validated profile, or null if absent / malformed. */
  profile: AIStyleProfile | null
}

// ---------------------------------------------------------------------------
// Phase 3 — Extend AnalyzeRequestPayload (backward-compatible)
// ---------------------------------------------------------------------------
