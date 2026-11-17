import type { GarmentMode } from '@/lib/constants/garmentModes'
import type { RawOpenAIDimensions } from '@/types/openai'

/**
 * Observations and rating evidence for mock mode (Preview and local runs
 * without a model).
 *
 * No image is analysed in mock mode, and these blocks say so: every image is
 * reported as `uncertain`, its only detail reads "Mock example: no image was
 * analysed", and every rated dimension has `partial` support with the same
 * note as what was missing. They are returned in the raw model shape and go
 * through the same validation as a real model response, so mock mode exercises
 * the production path and can never show something the validator would refuse.
 */

const MOCK_CATEGORIES = ['outerwear', 'top', 'bottom'] as const
export const MOCK_NOTE = 'Mock example: no image was analysed'

const SOURCES: Record<keyof RawOpenAIDimensions, string[]> = {
  occasion: ['garment_images', 'occasion'],
  color: ['person_photo', 'garment_images'],
  formality: ['garment_images', 'occasion'],
  seasonality: ['garment_images'],
  style: ['garment_images'],
  style_preference_match: ['garment_images'],
}

const CITES: Record<keyof RawOpenAIDimensions, string[]> = {
  occasion: ['g1.type'],
  color: ['g1.colour'],
  formality: ['g1.type', 'g1.pattern'],
  seasonality: ['g1.type'],
  style: ['g1.type', 'g1.pattern'],
  style_preference_match: ['g1.type'],
}

export interface MockInputs {
  hasStyleDna: boolean
  hasStylePreferences: boolean
}

export function mockVisualEvidenceRaw(
  dimensions: RawOpenAIDimensions,
  garmentMode: GarmentMode,
  garmentCount: number,
  inputs: MockInputs,
): { rawObservations: unknown; rawEvidence: unknown } {
  const images = Array.from({ length: garmentCount }, (_, index) => ({
    image: index + 1,
    garment: null,
    category: garmentMode === 'outfit_items' ? MOCK_CATEGORIES[index % MOCK_CATEGORIES.length] : MOCK_CATEGORIES[0],
    identification: 'uncertain',
    colours: { dominant: ['navy'], secondary: [] },
    colour_status: 'uncertain',
    pattern: 'solid',
    details: [MOCK_NOTE],
    limits: [],
  }))
  const rawObservations = {
    images,
    ...(garmentMode === 'same_garment_views' ? { views: { same_garment: 'unclear', conflicts: MOCK_NOTE } } : {}),
  }

  const rawEvidence = Object.fromEntries((Object.keys(SOURCES) as Array<keyof RawOpenAIDimensions>).map((key) => {
    const sources = [...SOURCES[key]]
    if ((key === 'style' || key === 'style_preference_match') && inputs.hasStylePreferences) sources.push('style_preferences')
    if (key === 'style_preference_match' && inputs.hasStyleDna) sources.push('style_dna')
    const unrated = dimensions[key].rating === 'Unable to Evaluate'
    return [key, { sources, cites: CITES[key], support: unrated ? 'insufficient' : 'partial', missing: MOCK_NOTE }]
  }))

  return { rawObservations, rawEvidence }
}
