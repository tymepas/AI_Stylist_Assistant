import { computeVerdict } from '@/lib/services/analysisService'
import type { RawOpenAIDimensions } from '@/types/openai'
import type { GarmentMode } from '@/lib/constants/garmentModes'
import type { CompleteAnalysisResult, OutfitComponents, OverallRecommendation, ShoppingAdvisor } from '@/types/schema'

const DIMENSION_LABELS: Record<keyof RawOpenAIDimensions, string> = {
  occasion: 'Occasion compatibility',
  color: 'Color harmony',
  formality: 'Formality',
  seasonality: 'Seasonality',
  style: 'Style consistency',
  style_preference_match: 'Style preference match',
}

const NEXT_STEPS: Record<OverallRecommendation, string> = {
  'Highly Recommended': 'You can move forward with this purchase with confidence.',
  Recommended: 'This is a strong option; review the considerations before making your decision.',
  'Consider Alternatives': 'Compare this with a few alternatives before purchasing.',
  'Not Recommended': 'Consider choosing a different garment for this occasion.',
}

function buildThingsToConsider(dimensions: RawOpenAIDimensions): string[] {
  const considerations = (Object.keys(dimensions) as Array<keyof RawOpenAIDimensions>)
    .filter((key) => ['Fair', 'Poor', 'Unable to Evaluate'].includes(dimensions[key].rating))
    .map((key) => `${DIMENSION_LABELS[key]}: ${dimensions[key].reason}`)

  return considerations.length > 0
    ? considerations
    : ['No major conflicts were identified across the evaluated dimensions.']
}

/** Advisory extras attached to a result. None of them is read by the verdict calculation. */
export interface AnalysisResultExtras {
  garmentMode?: GarmentMode
  outfitComponents?: OutfitComponents
}

export function buildCompleteAnalysisResult(
  dimensions: RawOpenAIDimensions,
  shopping_advisor: ShoppingAdvisor = { availability: 'unavailable', recommendations: [] },
  extras: AnalysisResultExtras = {}
): CompleteAnalysisResult {
  // The verdict is computed from the six ratings and from nothing else.
  const verdict = computeVerdict(dimensions)

  return {
    ...(extras.garmentMode ? { garment_mode: extras.garmentMode } : {}),
    ...(extras.outfitComponents && extras.outfitComponents.availability !== 'not_applicable' ? { outfit_components: extras.outfitComponents } : {}),
    status: 'complete',
    dimensions,
    things_to_consider: buildThingsToConsider(dimensions),
    analysis_based_on: {
      considered: ['photo', 'garment', 'occasion', 'style_preference'],
      not_considered: ['price', 'material_quality', 'brand', 'durability', 'comfort'],
    },
    next_step: NEXT_STEPS[verdict.overall_recommendation],
    shopping_advisor,
    ...verdict,
  }
}
