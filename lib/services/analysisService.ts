// AnalysisService
// -----------------------------------------------------------------------------
// Phase 1 MOCK ONLY. No real AI model is called anywhere in this file.
// The shape of every returned object matches AI_OUTPUT_SCHEMA.md exactly.
// The weighted verdict formula matches PRD.md "Verdict Calculation (v1)".
// -----------------------------------------------------------------------------

import {
  Dimensions,
  DimensionResult,
  AnalysisResult,
  CompleteAnalysisResult,
  UnableToAnalyzeResult,
  OverallRecommendation,
  ImageMeta,
  StyleProfile,
} from '@/types/schema'

const RATING_SCORES: Record<string, number> = {
  Excellent: 5,
  Good: 4,
  Fair: 3,
  Poor: 2,
}

// Only 5 of the 6 dimensions are part of the weighted formula per PRD.md.
// "style" (Style Consistency) is displayed but excluded from the calculation,
// exactly as specified in the PRD's Verdict Calculation table.
const DIMENSION_WEIGHTS: Record<string, number> = {
  occasion: 0.3,
  formality: 0.25,
  style_preference_match: 0.2,
  color: 0.15,
  seasonality: 0.1,
}

export function computeVerdict(
  dimensions: Dimensions
): { overall_recommendation: OverallRecommendation; verdict_score: number } {
  let weightedSum = 0
  let weightTotal = 0

  Object.keys(DIMENSION_WEIGHTS).forEach((key) => {
    const dim = (dimensions as unknown as Record<string, DimensionResult>)[key]
    const weight = DIMENSION_WEIGHTS[key]
    if (dim && dim.rating !== 'Unable to Evaluate') {
      weightedSum += RATING_SCORES[dim.rating] * weight
      weightTotal += weight
    }
  })

  if (weightTotal === 0) {
    return { overall_recommendation: 'Consider Alternatives', verdict_score: 0 }
  }

  const rawScore = weightedSum / weightTotal
  const verdict_score = Math.round(rawScore * 10) / 10

  let overall_recommendation: OverallRecommendation
  if (verdict_score >= 4.5) overall_recommendation = 'Highly Recommended'
  else if (verdict_score >= 3.5) overall_recommendation = 'Recommended'
  else if (verdict_score >= 2.5) overall_recommendation = 'Consider Alternatives'
  else overall_recommendation = 'Not Recommended'

  return { overall_recommendation, verdict_score }
}

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_SIZE_BYTES = 10 * 1024 * 1024
const MIN_IMAGE_DIMENSION = 512

function createEmptyStyleProfile(): StyleProfile {
  return { preferredStyles: [], favoriteColors: [], occasionPreferences: [] }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

/** Safely parses the optional multipart style profile without blocking users who have not saved one. */
export function parseStyleProfile(value: unknown): { valid: boolean; profile: StyleProfile; message?: string } {
  if (value === null || value === undefined || value === '') {
    return { valid: true, profile: createEmptyStyleProfile() }
  }
  if (typeof value !== 'string') {
    return { valid: false, profile: createEmptyStyleProfile(), message: 'Style profile data is invalid.' }
  }

  try {
    const profile: unknown = JSON.parse(value)
    if (
      !profile ||
      typeof profile !== 'object' ||
      !isStringArray((profile as StyleProfile).preferredStyles) ||
      !isStringArray((profile as StyleProfile).favoriteColors) ||
      !isStringArray((profile as StyleProfile).occasionPreferences)
    ) {
      return { valid: false, profile: createEmptyStyleProfile(), message: 'Style profile data is invalid.' }
    }
    return { valid: true, profile: profile as StyleProfile }
  } catch {
    return { valid: false, profile: createEmptyStyleProfile(), message: 'Style profile data is invalid.' }
  }
}

type ImageDimensions = { width: number; height: number }

function bytesMatch(bytes: Uint8Array, offset: number, expected: number[]): boolean {
  return expected.every((value, index) => bytes[offset + index] === value)
}

function readUint24LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
}

function getPngDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (!bytesMatch(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) || !bytesMatch(bytes, 12, [0x49, 0x48, 0x44, 0x52]) || bytes.length < 24) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

function getJpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (!bytesMatch(bytes, 0, [0xff, 0xd8])) return null

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 2
  const startOfFrameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])

  while (offset + 9 <= bytes.length) {
    while (bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset]
    offset += 1

    // Standalone JPEG markers do not have a segment length.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > bytes.length) return null

    const segmentLength = view.getUint16(offset)
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null
    if (startOfFrameMarkers.has(marker)) {
      if (segmentLength < 8) return null
      return { height: view.getUint16(offset + 3), width: view.getUint16(offset + 5) }
    }
    offset += segmentLength
  }

  return null
}

function getWebpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (!bytesMatch(bytes, 0, [0x52, 0x49, 0x46, 0x46]) || !bytesMatch(bytes, 8, [0x57, 0x45, 0x42, 0x50]) || bytes.length < 30) return null

  if (bytesMatch(bytes, 12, [0x56, 0x50, 0x38, 0x58])) { // VP8X
    return {
      width: readUint24LittleEndian(bytes, 24) + 1,
      height: readUint24LittleEndian(bytes, 27) + 1,
    }
  }

  if (bytesMatch(bytes, 12, [0x56, 0x50, 0x38, 0x20])) { // VP8
    if (!bytesMatch(bytes, 23, [0x9d, 0x01, 0x2a])) return null
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff }
  }

  if (bytesMatch(bytes, 12, [0x56, 0x50, 0x38, 0x4c]) && bytes[20] === 0x2f) { // VP8L
    const packed = (bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24)) >>> 0
    return { width: (packed & 0x3fff) + 1, height: ((packed >>> 14) & 0x3fff) + 1 }
  }

  return null
}

function getImageDimensions(bytes: Uint8Array, type: string): ImageDimensions | null {
  if (type === 'image/jpeg') return getJpegDimensions(bytes)
  if (type === 'image/png') return getPngDimensions(bytes)
  if (type === 'image/webp') return getWebpDimensions(bytes)
  return null
}

export function validateImageMeta(meta: ImageMeta | undefined | null): { valid: boolean; message?: string } {
  if (!meta || !meta.type) return { valid: false, message: 'Image data is missing.' }
  if (!ALLOWED_TYPES.includes(meta.type)) {
    return { valid: false, message: 'Please upload a JPEG, PNG, or WEBP image.' }
  }
  if (!meta.size || meta.size <= 0) {
    return { valid: false, message: 'The uploaded file appears to be empty.' }
  }
  if (meta.size > MAX_SIZE_BYTES) {
    return { valid: false, message: 'Image must be smaller than 10MB.' }
  }
  return { valid: true }
}

/** Validates a multipart upload's MIME metadata, bytes, and decoded dimensions. */
export async function validateImageFile(file: File | undefined | null): Promise<{ valid: boolean; message?: string }> {
  if (!file) return { valid: false, message: 'Image data is missing.' }

  const metaCheck = validateImageMeta({ name: file.name, type: file.type, size: file.size })
  if (!metaCheck.valid) return metaCheck

  const bytes = new Uint8Array(await file.arrayBuffer())
  const dimensions = getImageDimensions(bytes, file.type)
  if (!dimensions) {
    return { valid: false, message: 'The uploaded file is not a valid JPEG, PNG, or WEBP image.' }
  }
  if (dimensions.width < MIN_IMAGE_DIMENSION || dimensions.height < MIN_IMAGE_DIMENSION) {
    return { valid: false, message: 'Image must be at least 512×512 pixels.' }
  }

  return { valid: true }
}

function buildMockA(): CompleteAnalysisResult {
  const dimensions: Dimensions = {
    occasion: {
      rating: 'Excellent',
      reason: 'The tailored blazer and trousers align closely with the professional formality this interview calls for.',
      confidence: 'High',
    },
    color: {
      rating: 'Excellent',
      reason: "The deep navy tone reads as polished and pairs well with a wide range of skin tones for this setting.",
      confidence: 'High',
    },
    formality: {
      rating: 'Excellent',
      reason: 'The structured silhouette and clean lines match the formality expected for this occasion.',
      confidence: 'High',
    },
    seasonality: {
      rating: 'Good',
      reason: 'The fabric weight works for most of the year, though it may run warm in peak summer heat.',
      confidence: 'Medium',
    },
    style: {
      rating: 'Excellent',
      reason: 'The tailored, clean cut is consistent with a classic, minimalist aesthetic.',
      confidence: 'High',
    },
    style_preference_match: {
      rating: 'Good',
      reason: 'This closely matches your stated preference for classic, minimalist pieces.',
      confidence: 'High',
    },
  }
  const verdict = computeVerdict(dimensions)
  return {
    status: 'complete',
    dimensions,
    things_to_consider: [
      'A lighter undershirt could help if this will be worn somewhere warm.',
      'Keep accessories minimal to stay aligned with your stated style preference.',
    ],
    analysis_based_on: {
      considered: ['photo', 'garment', 'occasion', 'style_preference'],
      not_considered: ['price', 'material_quality', 'brand', 'durability', 'comfort'],
    },
    next_step: 'You can move forward with this purchase with confidence.',
    ...verdict,
  }
}

function buildMockB(): CompleteAnalysisResult {
  const dimensions: Dimensions = {
    occasion: {
      rating: 'Poor',
      reason: 'A distressed denim jacket falls well short of the formality typically expected at a wedding.',
      confidence: 'High',
    },
    color: {
      rating: 'Fair',
      reason: 'The faded wash reads as casual and does not stand out appropriately for a formal event.',
      confidence: 'Medium',
    },
    formality: {
      rating: 'Poor',
      reason: 'This garment reads as casual streetwear, well below the formality this occasion calls for.',
      confidence: 'High',
    },
    seasonality: {
      rating: 'Fair',
      reason: 'The denim weight is reasonable for the season, though that is the only aspect that fits well.',
      confidence: 'Medium',
    },
    style: {
      rating: 'Poor',
      reason: 'The distressed, casual style clashes with the polished aesthetic this occasion calls for.',
      confidence: 'High',
    },
    style_preference_match: {
      rating: 'Poor',
      reason: "You stated a preference for classic, formal style. This distressed, casual jacket directly conflicts with that preference.",
      confidence: 'High',
    },
  }
  const verdict = computeVerdict(dimensions)
  return {
    status: 'complete',
    dimensions,
    things_to_consider: [
      'A tailored blazer or suit jacket would be a stronger fit for this occasion.',
      'Save this piece for casual, low-key outings where it fits your existing wardrobe better.',
    ],
    analysis_based_on: {
      considered: ['photo', 'garment', 'occasion', 'style_preference'],
      not_considered: ['price', 'material_quality', 'brand', 'durability', 'comfort'],
    },
    next_step: 'Consider a more formal alternative before purchasing.',
    ...verdict,
  }
}

function buildMockC(): UnableToAnalyzeResult {
  const variants = [
    'We could not clearly detect a person in the uploaded photo, so we are unable to evaluate fit and formality.',
    'The uploaded images are too low quality or too dark to reliably identify the garment details.',
  ]
  const reason = variants[Math.floor(Math.random() * variants.length)]
  return {
    status: 'unable_to_analyze',
    reason,
    confidence: 'Low',
    next_step: 'Please retake both photos in good lighting with the person and garment clearly visible, then try again.',
  }
}

// Rotates randomly across all three scenarios so every UI state is reachable.
export function getMockAnalysis(): AnalysisResult {
  const roll = Math.random()
  if (roll < 0.34) return buildMockA()
  if (roll < 0.68) return buildMockB()
  return buildMockC()
}
