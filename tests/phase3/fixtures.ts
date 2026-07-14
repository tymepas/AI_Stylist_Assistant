/**
 * Shared test fixtures for Phase 3 unit tests.
 * These match the complete example from specs/phase3/05_STYLE_PROFILE_SCHEMA.md.
 */

import type { AIStyleProfile, AIStyleProfileFailure } from '@/types/schema'

export const VALID_COMPLETE_PROFILE: AIStyleProfile = {
  schema_version: '1.0',
  generated_at_utc: '2025-01-15T14:32:00Z',
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
    confidence: 'Medium',
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
      'High confidence on coloring and current outfit style. Medium confidence on proportions as only upper body is visible.',
  },
}

/** Profile where every nullable field is explicitly null. */
export const PROFILE_ALL_NULLS: AIStyleProfile = {
  schema_version: '1.0',
  generated_at_utc: '2025-01-15T14:32:00Z',
  status: 'complete',
  coloring: {
    skin_tone_depth: null,
    skin_tone_undertone: null,
    hair_color: null,
    hair_color_family: null,
    eye_color: null,
    high_contrast: null,
    confidence: 'Low',
  },
  proportions: {
    frame_width: null,
    torso_length: null,
    shoulder_breadth: null,
    visible_posture_notes: null,
    confidence: 'Low',
  },
  aesthetic_signals: {
    current_outfit_formality: null,
    current_outfit_style: [],
    accessory_presence: null,
    pattern_preference_signal: null,
    confidence: 'Low',
  },
  style_keywords: [{ keyword: 'Casual', confidence: 'Low', source: 'inferred' }],
  wardrobe_context: {
    visible_garment_notes: null,
    color_palette_notes: null,
  },
  analysis_notes: {
    photo_quality: 'poor',
    visibility_limitations: ['lower body not visible', 'low lighting'],
    confidence_summary: 'Low confidence across all sections due to poor photo quality.',
  },
}

export const VALID_FAILURE_RESPONSE: AIStyleProfileFailure = {
  schema_version: '1.0',
  status: 'unable_to_generate',
  reason: 'No person detected in the uploaded photo.',
  next_step: 'Upload a clear photo showing your face and upper body.',
  confidence: 'Low',
}
