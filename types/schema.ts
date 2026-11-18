import type { GarmentMode } from '@/lib/constants/garmentModes'

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
  shopping_advisor: ShoppingAdvisor
  /** How the garment images related to each other. Absent in results from before multiple garment images existed. */
  garment_mode?: GarmentMode
  /** Per-item notes for an outfit of several items. Advisory only; never part of the verdict. */
  outfit_components?: OutfitComponents
  /** What was visible in each garment image. Informational only; never part of the verdict. Absent in results from before analysis-output/3. */
  observations?: Observations
  /** What each rating rests on. Informational only; never part of the verdict. Absent in results from before analysis-output/3. */
  evidence?: RatingEvidence
  /** The occasion the analysis was for, with the application's profile of it (Phase 4 Milestone 2). Display only. */
  occasion_context?: OccasionContext
}

/** The application's profile of the selected occasion, as sent to the model. Never part of the verdict. */
export interface OccasionContext {
  occasion: string
  profile_version: string
  /** For example "business casual to business formal". */
  formality: string
  setting: string
  suits: string
  varies?: string
  season?: string
}

// ---------------------------------------------------------------------------
// Phase 4 Milestone 1 - Visual observations and rating evidence
// ---------------------------------------------------------------------------

/**
 * How far something could be seen. `observed`: clearly visible. `uncertain`:
 * visible, but lighting, angle or occlusion leaves doubt. `not_visible`: it
 * cannot be seen in the image. "Unable to Evaluate" stays a rating, not an
 * observation status.
 */
export type ObservationStatus = 'observed' | 'uncertain' | 'not_visible'

/** Broad colour families. Exact shade names are never claimed. */
export type ColourFamily =
  | 'black' | 'white' | 'cream' | 'grey' | 'beige' | 'brown' | 'red' | 'pink' | 'orange'
  | 'yellow' | 'green' | 'blue' | 'navy' | 'purple' | 'gold' | 'silver' | 'multicolour'

export type PatternObservation = 'solid' | 'striped' | 'checked' | 'printed' | 'textured' | 'other' | 'unclear'

/** What limited an image, in fixed categories, so the report can say it plainly. */
export type ImageLimitation = 'lighting' | 'occlusion' | 'cropped' | 'blur' | 'low_resolution' | 'angle' | 'image_text' | 'several_items'

export type ObservedGarmentCategory = ShoppingGarmentCategory | 'unclear'

/** What was visible in one garment image. One entry per image, never one for several items. */
export interface GarmentObservation {
  /** Number of the garment image, starting at 1. */
  image: number
  /** A short plain name such as "blazer". Null when the garment cannot be identified. */
  garment: string | null
  category: ObservedGarmentCategory
  identification: ObservationStatus
  colours: { dominant: ColourFamily[]; secondary: ColourFamily[] }
  colour_status: ObservationStatus
  pattern: PatternObservation
  /** Clearly visible features, at most three, each a few words. */
  details: string[]
  limits: ImageLimitation[]
}

export interface Observations {
  /** `unavailable` when the model output was missing or did not pass validation. Nothing is filled in on its behalf. */
  availability: 'available' | 'unavailable'
  images: GarmentObservation[]
  /** Only for views of one garment: whether the views appear to show the same garment. */
  views?: { same_garment: 'yes' | 'no' | 'unclear'; differences?: Array<'detail_hidden' | 'colour_lighting' | 'different_item'>; conflicts?: string }
}

export type EvidenceSource = 'person_photo' | 'garment_images' | 'occasion' | 'style_preferences' | 'style_dna'
export type EvidenceSupport = 'sufficient' | 'partial' | 'insufficient'

/** What one rating rests on. It explains the rating; it never changes it. */
export interface DimensionEvidence {
  sources: EvidenceSource[]
  /** References to observations, for example "g1.colour" or "g2.d1". Each one exists and was visible. */
  cites: string[]
  support: EvidenceSupport
  /** What was missing or unclear. Present whenever the support is not sufficient. */
  missing?: string
}

export interface RatingEvidence {
  /** `available`: all six dimensions. `partial`: some. `unavailable`: none passed validation. */
  availability: 'available' | 'partial' | 'unavailable'
  dimensions: Partial<Record<keyof Dimensions, DimensionEvidence>>
}

/** How one item works within a multi-item outfit. A qualitative label, not a rating, a score or a verdict. */
export type OutfitComponentAssessment = 'Works well' | 'Works' | 'Needs attention' | 'Unable to tell'

export interface OutfitComponent {
  /** Number of the garment image this entry describes, starting at 1. */
  item: number
  garment_type: ShoppingGarmentCategory
  assessment: OutfitComponentAssessment
  note: string
  /** How this item affects the six outfit-level ratings (analysis-output/4). Present only when it passed validation. */
  contribution?: ComponentContribution
}

/**
 * What one outfit item does to the outfit-level ratings: dimensions it
 * supports, creates tension with, or cannot be judged against. A dimension in
 * none of the lists is one it has little influence on. It explains the
 * ratings; it never is one and never reaches the verdict.
 */
export interface ComponentContribution {
  supports: Array<keyof Dimensions>
  tension: Array<keyof Dimensions>
  unclear: Array<keyof Dimensions>
  /** The item's own observations it rests on, for example "g2.colour". */
  cites: string[]
}

export interface OutfitComponents {
  /** `not_applicable` unless the garment mode is `outfit_items`; `unavailable` when the model output was missing or invalid. */
  availability: 'available' | 'unavailable' | 'not_applicable'
  items: OutfitComponent[]
  /** Whether item contributions came back usable: for every item, for some, or for none (analysis-output/4). */
  contributions?: 'available' | 'partial' | 'unavailable'
}

export interface UnableToAnalyzeResult {
  status: 'unable_to_analyze'
  reason: string
  confidence: Confidence
  next_step: string
}

export type AnalysisResult = CompleteAnalysisResult | UnableToAnalyzeResult


// ---------------------------------------------------------------------------
// Phase 4 - Shopping Advisor
// ---------------------------------------------------------------------------

/** Shopping guidance is advisory only. It never participates in verdict scoring. */
export type ShoppingAdvisorAvailability =
  | 'available'
  | 'requires_style_dna'
  | 'unavailable'

/** Qualitative fit label shown on Shopping Advisor cards. */
export type ShoppingMatchLevel =
  | 'Excellent Match'
  | 'Strong Match'
  | 'Good Match'
  | 'Possible Match'

export type ShoppingGarmentCategory =
  | 'top'
  | 'bottom'
  | 'outerwear'
  | 'dress'
  | 'footwear'
  | 'accessory'
  | 'suiting'
  | 'traditional_wear'

export interface ShoppingRecommendation {
  title: string
  garment_type: ShoppingGarmentCategory
  color_direction: string
  style_direction: string
  rationale: string
  addresses: Array<keyof Dimensions>
  match_level: ShoppingMatchLevel
}

export interface ShoppingAdvisor {
  availability: ShoppingAdvisorAvailability
  recommendations: ShoppingRecommendation[]
}
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
