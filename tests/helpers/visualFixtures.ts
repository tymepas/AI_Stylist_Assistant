/**
 * Hand-written observation and evidence blocks in the raw model shape
 * (analysis-output/3), for tests. Nothing here came from a model.
 */

import type { RawOpenAIDimensions } from '@/types/openai'

type Raw = Record<string, unknown>

/** One garment-image observation; override any field. */
export function image(number: number, overrides: Raw = {}): Raw {
  return {
    image: number,
    garment: 'blazer',
    category: 'suiting',
    identification: 'observed',
    colours: { dominant: ['navy'], secondary: [] },
    colour_status: 'observed',
    pattern: 'solid',
    details: ['notched lapels'],
    limits: [],
    ...overrides,
  }
}

export const DIMENSION_KEYS = ['occasion', 'color', 'formality', 'seasonality', 'style', 'style_preference_match'] as const

/** Valid evidence for every dimension of `dimensions`, citing garment image 1 only. */
export function evidenceFor(dimensions: RawOpenAIDimensions, overrides: Partial<Record<(typeof DIMENSION_KEYS)[number], Raw>> = {}): Raw {
  const cites: Record<(typeof DIMENSION_KEYS)[number], string[]> = {
    occasion: ['g1.type'],
    color: ['g1.colour'],
    formality: ['g1.type', 'g1.d1'],
    seasonality: ['g1.type'],
    style: ['g1.type', 'g1.pattern'],
    style_preference_match: ['g1.type'],
  }
  return Object.fromEntries(DIMENSION_KEYS.map((key) => {
    const unrated = dimensions[key].rating === 'Unable to Evaluate'
    const entry = {
      sources: key === 'occasion' || key === 'formality' ? ['garment_images', 'occasion'] : key === 'color' ? ['person_photo', 'garment_images'] : ['garment_images'],
      cites: cites[key],
      support: unrated ? 'insufficient' : 'sufficient',
      ...(unrated ? { missing: 'Not enough is visible to judge this' } : {}),
    }
    return [key, { ...entry, ...(overrides[key] ?? {}) }]
  }))
}
