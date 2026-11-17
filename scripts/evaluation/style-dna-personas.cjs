/**
 * Invented Style DNA profiles for evaluation data.
 *
 * NONE OF THESE DESCRIBES A REAL PERSON. Each was written by hand as a test
 * input, in the exact format the application stores (profile-output/1.0). No
 * photo was analysed to produce any of them, and no user's profile was copied.
 * A benchmark manifest accepts only profiles marked `source: "synthetic"`, and
 * these are the profiles that marking refers to.
 *
 * Two kinds:
 *
 * - FULL personas state colouring and proportions as well as style. They are
 *   used only by the synthetic scenarios, where no image exists that the
 *   colouring could contradict.
 * - AESTHETIC-ONLY personas leave colouring and proportions empty (null, Low
 *   confidence) and state style signals only. They are the ones to attach to a
 *   case with a real photo: an invented colouring next to a real photo would
 *   contradict what the model sees, which never happens in the application,
 *   where the profile comes from the user's own photo. The price is that the
 *   colouring part of Style DNA is not exercised on real images.
 */

const GENERATED_AT = '2026-01-01T00:00:00.000Z'
const NOTE = 'Invented profile for evaluation. It does not describe any real person.'

function profile({ coloring, proportions, aesthetic, keywords, limitations = [] }) {
  return {
    schema_version: '1.0',
    generated_at_utc: GENERATED_AT,
    status: 'complete',
    coloring,
    proportions,
    aesthetic_signals: aesthetic,
    style_keywords: keywords,
    wardrobe_context: { visible_garment_notes: null, color_palette_notes: null },
    analysis_notes: { photo_quality: 'good', visibility_limitations: limitations, confidence_summary: NOTE },
  }
}

const NO_COLOURING = { skin_tone_depth: null, skin_tone_undertone: null, hair_color: null, hair_color_family: null, eye_color: null, high_contrast: null, confidence: 'Low' }
const NO_PROPORTIONS = { frame_width: null, torso_length: null, shoulder_breadth: null, visible_posture_notes: null, confidence: 'Low' }
const NOT_DETERMINED = ['Colouring was not determined.', 'Proportions were not determined.']

const PERSONAS = {
  // --- Full personas: synthetic scenarios only -------------------------------
  'persona-classic-tailored': profile({
    coloring: { skin_tone_depth: 'medium', skin_tone_undertone: 'neutral', hair_color: 'dark brown', hair_color_family: 'dark', eye_color: 'brown', high_contrast: false, confidence: 'High' },
    proportions: { frame_width: 'medium', torso_length: 'average', shoulder_breadth: 'medium', visible_posture_notes: null, confidence: 'Medium' },
    aesthetic: { current_outfit_formality: 'business casual', current_outfit_style: ['classic', 'minimalist'], accessory_presence: 'minimal', pattern_preference_signal: 'solid', confidence: 'High' },
    keywords: [{ keyword: 'Classic', confidence: 'High', source: 'observed' }, { keyword: 'Business', confidence: 'Medium', source: 'inferred' }],
  }),
  'persona-street-relaxed': profile({
    coloring: { skin_tone_depth: 'medium deep', skin_tone_undertone: 'warm', hair_color: 'black', hair_color_family: 'dark', eye_color: 'dark brown', high_contrast: false, confidence: 'High' },
    proportions: { frame_width: 'broad', torso_length: 'long', shoulder_breadth: 'broad', visible_posture_notes: null, confidence: 'Medium' },
    aesthetic: { current_outfit_formality: 'casual', current_outfit_style: ['streetwear', 'casual'], accessory_presence: 'moderate', pattern_preference_signal: 'bold_pattern', confidence: 'High' },
    keywords: [{ keyword: 'Streetwear', confidence: 'High', source: 'observed' }, { keyword: 'Casual', confidence: 'High', source: 'observed' }],
  }),
  'persona-romantic-soft': profile({
    coloring: { skin_tone_depth: 'light', skin_tone_undertone: 'cool', hair_color: 'light brown', hair_color_family: 'medium', eye_color: 'grey', high_contrast: false, confidence: 'Medium' },
    proportions: { frame_width: 'narrow', torso_length: 'average', shoulder_breadth: 'narrow', visible_posture_notes: null, confidence: 'Low' },
    aesthetic: { current_outfit_formality: 'smart casual', current_outfit_style: ['romantic', 'bohemian'], accessory_presence: 'statement', pattern_preference_signal: 'subtle_pattern', confidence: 'Medium' },
    keywords: [{ keyword: 'Romantic', confidence: 'High', source: 'observed' }, { keyword: 'Bohemian', confidence: 'Medium', source: 'inferred' }],
  }),

  // --- Aesthetic-only personas: safe next to a real photo -------------------------
  'persona-minimal-aesthetic': profile({
    coloring: NO_COLOURING,
    proportions: NO_PROPORTIONS,
    aesthetic: { current_outfit_formality: 'smart casual', current_outfit_style: ['minimalist'], accessory_presence: 'minimal', pattern_preference_signal: 'solid', confidence: 'High' },
    keywords: [{ keyword: 'Minimalist', confidence: 'High', source: 'observed' }, { keyword: 'Classic', confidence: 'Medium', source: 'inferred' }],
    limitations: NOT_DETERMINED,
  }),
  'persona-bold-aesthetic': profile({
    coloring: NO_COLOURING,
    proportions: NO_PROPORTIONS,
    aesthetic: { current_outfit_formality: 'casual', current_outfit_style: ['eclectic', 'edgy'], accessory_presence: 'statement', pattern_preference_signal: 'bold_pattern', confidence: 'High' },
    keywords: [{ keyword: 'Trendy', confidence: 'High', source: 'observed' }, { keyword: 'Eclectic', confidence: 'Medium', source: 'inferred' }],
    limitations: NOT_DETERMINED,
  }),
}

/** Personas that state no colouring and no proportions. Only these go with a real photo. */
const AESTHETIC_ONLY = ['persona-minimal-aesthetic', 'persona-bold-aesthetic']

/** The `style_dna` field of a manifest case for one persona. A copy, so a case can never alter the library. */
function styleDna(persona) {
  if (!Object.prototype.hasOwnProperty.call(PERSONAS, persona)) throw new Error(`Unknown Style DNA persona: ${persona}`)
  return { source: 'synthetic', persona, profile: JSON.parse(JSON.stringify(PERSONAS[persona])) }
}

module.exports = { PERSONAS, AESTHETIC_ONLY, styleDna }
