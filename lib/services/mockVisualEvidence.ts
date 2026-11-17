import type { GarmentMode } from '@/lib/constants/garmentModes'
import type { RawOpenAIDimensions } from '@/types/openai'

/**
 * Observations and rating evidence for mock mode (Preview and local runs
 * without a model).
 *
 * No image is analysed in mock mode, and these blocks say so: nothing is
 * reported as observed (garment, colour and pattern are not visible or
 * unclear), each image's only detail reads "Mock example: no image was
 * analysed", and every rated dimension has `partial` support with the same
 * note as what was missing. Evidence cites only that note. They are returned in the raw model shape and go
 * through the same validation as a real model response, so mock mode exercises
 * the production path and can never show something the validator would refuse.
 */

export const MOCK_NOTE = 'Mock example: no image was analysed'

const SOURCES: Record<keyof RawOpenAIDimensions, string[]> = {
  occasion: ['garment_images', 'occasion'],
  color: ['person_photo', 'garment_images'],
  formality: ['garment_images', 'occasion'],
  seasonality: ['garment_images'],
  style: ['garment_images'],
  style_preference_match: ['garment_images'],
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
    category: 'unclear',
    identification: 'not_visible',
    colours: { dominant: [], secondary: [] },
    colour_status: 'not_visible',
    pattern: 'unclear',
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
    return [key, { sources, cites: ['g1.d1'], support: unrated ? 'insufficient' : 'partial', missing: MOCK_NOTE }]
  }))

  return { rawObservations, rawEvidence }
}
