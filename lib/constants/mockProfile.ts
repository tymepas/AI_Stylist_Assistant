/**
 * Canned mock AI Style Profiles for ANALYSIS_MODE=mock.
 * Source: specs/phase3/06_API_SPECIFICATION.md § "Mock Mode"
 *
 * Two scenarios rotate randomly (same pattern as getMockAnalysis()):
 *   - MOCK_PROFILE_FULL: all fields populated — tests the fully-populated display state
 *   - MOCK_PROFILE_PARTIAL: several null fields — tests null handling in the UI
 *
 * These profiles contain no real person data.
 */

import type { AIStyleProfile } from '@/types/schema'

/** Mock profile A — all observable fields populated. */
export const MOCK_PROFILE_FULL: AIStyleProfile = {
  schema_version: '1.0',
  // generated_at_utc is set by the route handler after generation; placeholder used here
  generated_at_utc: '',
  status: 'complete',
  coloring: {
    skin_tone_depth: 'medium',
    skin_tone_undertone: 'warm',
    hair_color: 'dark brown',
    hair_color_family: 'dark',
    eye_color: 'brown',
    high_contrast: false,
    confidence: 'High',
  },
  proportions: {
    frame_width: 'medium',
    torso_length: 'average',
    shoulder_breadth: 'medium',
    visible_posture_notes: null,
    confidence: 'High',
  },
  aesthetic_signals: {
    current_outfit_formality: 'smart casual',
    current_outfit_style: ['minimalist', 'classic'],
    accessory_presence: 'minimal',
    pattern_preference_signal: 'solid',
    confidence: 'High',
  },
  style_keywords: [
    { keyword: 'Minimalist', confidence: 'High', source: 'observed' },
    { keyword: 'Classic', confidence: 'High', source: 'observed' },
  ],
  wardrobe_context: {
    visible_garment_notes: null,
    color_palette_notes: null,
  },
  analysis_notes: {
    photo_quality: 'good',
    visibility_limitations: [],
    confidence_summary:
      'High confidence on coloring and current outfit style. Upper body clearly visible with good lighting.',
  },
}

/**
 * Mock profile B — partial: proportions and several aesthetic fields are null.
 * Tests null-value display paths in the UI.
 */
export const MOCK_PROFILE_PARTIAL: AIStyleProfile = {
  schema_version: '1.0',
  generated_at_utc: '',
  status: 'complete',
  coloring: {
    skin_tone_depth: 'light',
    skin_tone_undertone: 'cool',
    hair_color: 'blonde',
    hair_color_family: 'light',
    eye_color: null,
    high_contrast: null,
    confidence: 'Medium',
  },
  proportions: {
    frame_width: null,
    torso_length: null,
    shoulder_breadth: null,
    visible_posture_notes: null,
    confidence: 'Low',
  },
  aesthetic_signals: {
    current_outfit_formality: 'casual',
    current_outfit_style: ['casual'],
    accessory_presence: null,
    pattern_preference_signal: null,
    confidence: 'Medium',
  },
  style_keywords: [
    { keyword: 'Casual', confidence: 'Medium', source: 'observed' },
  ],
  wardrobe_context: {
    visible_garment_notes: null,
    color_palette_notes: null,
  },
  analysis_notes: {
    photo_quality: 'acceptable',
    visibility_limitations: [
      'lower body not visible',
      'eye color obscured',
    ],
    confidence_summary:
      'Medium confidence on coloring. Proportions could not be assessed as only a waist-up photo was provided.',
  },
}

/**
 * Returns a mock AIStyleProfile after a realistic simulated delay.
 * Rotates between the two mock profiles.
 * Spec: specs/phase3/06_API_SPECIFICATION.md § "Mock Mode" — 1.5–2.5 second delay.
 */
export async function getMockProfile(): Promise<AIStyleProfile> {
  const delayMs = 1_500 + Math.random() * 1_000
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
  const profile = Math.random() < 0.5 ? MOCK_PROFILE_FULL : MOCK_PROFILE_PARTIAL

  // The route sets generated_at_utc on the returned profile. Always return an
  // independent object so that timestamping one request cannot mutate the
  // exported fixtures or affect a later request.
  return JSON.parse(JSON.stringify(profile)) as AIStyleProfile
}
