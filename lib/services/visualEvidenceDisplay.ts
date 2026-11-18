import type { GarmentMode } from '@/lib/constants/garmentModes'
import type {
  ColourFamily,
  DimensionEvidence,
  EvidenceSource,
  EvidenceSupport,
  GarmentObservation,
  ImageLimitation,
  ObservedGarmentCategory,
  Observations,
  PatternObservation,
} from '@/types/schema'

/**
 * Plain-language wording for the observations and evidence in the report.
 *
 * Display only. Everything here formats values that were already validated on
 * the server; nothing is inferred, filled in or invented. A value that cannot
 * be shown honestly is shown as unknown, never guessed.
 */

export const CATEGORY_LABELS: Record<ObservedGarmentCategory, string> = {
  top: 'Top',
  bottom: 'Bottom',
  outerwear: 'Outerwear',
  dress: 'Dress',
  footwear: 'Footwear',
  accessory: 'Accessory',
  suiting: 'Suiting',
  traditional_wear: 'Traditional wear',
  unclear: 'Not identified',
}

export const PATTERN_LABELS: Record<PatternObservation, string> = {
  solid: 'Solid',
  striped: 'Striped',
  checked: 'Checked',
  printed: 'Printed',
  textured: 'Textured',
  other: 'Other pattern',
  unclear: 'Unclear',
}

export const LIMIT_LABELS: Record<ImageLimitation, string> = {
  lighting: 'Lighting may affect the colours',
  occlusion: 'Partly hidden',
  cropped: 'Partly out of frame',
  blur: 'Blurred',
  low_resolution: 'Low resolution',
  angle: 'Unusual angle',
  image_text: 'Text visible in the photo',
  several_items: 'Several items in one photo',
}

/** Reference swatches for broad colour families. Approximate by design: a family is not a shade. */
export const COLOUR_SWATCHES: Record<ColourFamily, string> = {
  black: '#1c1c1c',
  white: '#f7f7f5',
  cream: '#efe6cf',
  grey: '#8c8c8c',
  beige: '#cdb79a',
  brown: '#7a5233',
  red: '#b3261e',
  pink: '#e48aa6',
  orange: '#e07b2a',
  yellow: '#e8c547',
  green: '#3f7d4e',
  blue: '#3c6fb4',
  navy: '#1f2f56',
  purple: '#6b4a91',
  gold: '#c9a54a',
  silver: '#b9bcc2',
  multicolour: 'conic-gradient(#b3261e, #e8c547, #3f7d4e, #3c6fb4, #6b4a91, #b3261e)',
}

export const SOURCE_LABELS: Record<EvidenceSource, string> = {
  person_photo: 'Your photo',
  garment_images: 'Garment photos',
  occasion: 'Occasion',
  style_preferences: 'Your style preferences',
  style_dna: 'Your Style DNA',
}

export const SUPPORT_LABELS: Record<EvidenceSupport, string> = {
  sufficient: 'Enough visible evidence',
  partial: 'Partial evidence',
  insufficient: 'Not enough evidence',
}

export function capitalise(text: string): string {
  return text.length === 0 ? text : `${text[0].toUpperCase()}${text.slice(1)}`
}

/** What one garment image is called in the report, by image mode. */
export function imageLabel(mode: GarmentMode | undefined, image: number): string {
  if (mode === 'same_garment_views') return `View ${image}`
  if (mode === 'outfit_items') return `Item ${image}`
  return 'Your garment'
}

/** The garment's name, or its category, or a plain statement that it was not identified. */
export function garmentName(observation: GarmentObservation): string {
  if (observation.identification === 'not_visible') return 'Not identified'
  if (observation.garment) return capitalise(observation.garment)
  return CATEGORY_LABELS[observation.category]
}

export function colourList(families: ColourFamily[]): string {
  return families.join(', ')
}

/**
 * A citation in words, for example "Item 2: colour navy, white". Null when the
 * citation does not resolve, which validation already rules out; a citation
 * that cannot be shown is left out rather than guessed.
 */
export function describeCite(cite: string, observations: Observations | undefined, mode: GarmentMode | undefined): string | null {
  const match = /^g([1-3])\.(type|colour|pattern|d([1-3]))$/.exec(cite)
  if (!match || !observations || observations.availability !== 'available' || !Array.isArray(observations.images)) return null
  const observation = observations.images.find((entry) => entry.image === Number(match[1]))
  if (!observation) return null
  const prefix = mode === 'same_garment_views' || mode === 'outfit_items' ? `${imageLabel(mode, observation.image)}: ` : ''
  switch (match[2]) {
    case 'type':
      return `${prefix}${garmentName(observation).toLowerCase()}${observation.identification === 'uncertain' ? ' (uncertain)' : ''}`
    case 'colour': {
      const families = [...observation.colours.dominant, ...observation.colours.secondary]
      return families.length === 0 ? null : `${prefix}colour ${colourList(families)}${observation.colour_status === 'uncertain' ? ' (uncertain)' : ''}`
    }
    case 'pattern': {
      const label = PATTERN_LABELS[observation.pattern].toLowerCase()
      return `${prefix}${label.endsWith('pattern') ? label : `${label} pattern`}`
    }
    default: {
      const detail = observation.details[Number(match[3]) - 1]
      return detail ? `${prefix}${detail}` : null
    }
  }
}

/** The citations of one dimension in words, without any that cannot be shown. */
export function describeCites(evidence: DimensionEvidence, observations: Observations | undefined, mode: GarmentMode | undefined): string[] {
  return evidence.cites.map((cite) => describeCite(cite, observations, mode)).filter((label): label is string => label !== null)
}

export const VIEW_DIFFERENCE_LABELS: Record<'detail_hidden' | 'colour_lighting' | 'different_item', string> = {
  detail_hidden: 'Some details show in one view only.',
  colour_lighting: 'Colours differ between views, likely because of lighting.',
  different_item: 'One view may show a different garment.',
}

/** One sentence about whether views show one garment. */
export function describeViews(views: NonNullable<Observations['views']>): string {
  if (views.same_garment === 'yes') return 'These views appear to show the same garment.'
  if (views.same_garment === 'no') return 'These views may not show the same garment.'
  return 'It is unclear whether these views show the same garment.'
}
