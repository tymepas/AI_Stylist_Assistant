import type { OverallRecommendation, Rating } from '@/types/schema'

/**
 * The colour of a verdict band or a rating, as complete Tailwind class names
 * (Tailwind only generates classes it can see written out in full). Four muted
 * tones from the design tokens in app/globals.css, plus a neutral one for
 * "Unable to Evaluate".
 */
export interface Tone {
  text: string
  /** Solid fill, for meters and dots. */
  fill: string
  /** Faint background tint. */
  soft: string
  border: string
}

const TONES = {
  high: { text: 'text-verdict-high', fill: 'bg-verdict-high', soft: 'bg-verdict-high/10', border: 'border-verdict-high/30' },
  good: { text: 'text-verdict-good', fill: 'bg-verdict-good', soft: 'bg-verdict-good/10', border: 'border-verdict-good/30' },
  caution: { text: 'text-verdict-caution', fill: 'bg-verdict-caution', soft: 'bg-verdict-caution/10', border: 'border-verdict-caution/30' },
  low: { text: 'text-verdict-low', fill: 'bg-verdict-low', soft: 'bg-verdict-low/10', border: 'border-verdict-low/30' },
  none: { text: 'text-muted-foreground', fill: 'bg-muted-foreground/40', soft: 'bg-secondary', border: 'border-border' },
} satisfies Record<string, Tone>

export const BAND_TONE: Record<OverallRecommendation, Tone> = {
  'Highly Recommended': TONES.high,
  Recommended: TONES.good,
  'Consider Alternatives': TONES.caution,
  'Not Recommended': TONES.low,
}

export const RATING_TONE: Record<Rating, Tone> = {
  Excellent: TONES.high,
  Good: TONES.good,
  Fair: TONES.caution,
  Poor: TONES.low,
  'Unable to Evaluate': TONES.none,
}

/** How many of four meter segments a rating fills. */
export const RATING_STEPS: Record<Rating, number> = {
  Excellent: 4,
  Good: 3,
  Fair: 2,
  Poor: 1,
  'Unable to Evaluate': 0,
}
