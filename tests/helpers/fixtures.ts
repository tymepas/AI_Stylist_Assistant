/**
 * Shared builders for characterisation tests.
 *
 * `makePng` returns a real, decodable picture: the API decodes and re-encodes
 * every upload, so a file with only a valid header is rejected by the route.
 * `makeHeaderOnlyPng`, `makeJpeg` and the WEBP builders are minimal byte
 * sequences that satisfy the header parsers in lib/services/analysisService.ts
 * and nothing more; they are for unit tests of those parsers and for proving
 * that the route refuses them.
 */

import type { RawOpenAIDimensions } from '@/types/openai'
import type { Rating } from '@/types/schema'
import { realPng } from './realImages'

/** A real PNG of one flat colour. `shade` changes the bytes, for tests that need two different pictures. */
export function makePng(width = 800, height = 800, name = 'image.png', shade = 128): File {
  return realPng(width, height, name, shade)
}

/** 33 bytes: a PNG signature and an IHDR chunk, with no image data. Passes the header check only. */
export function makeHeaderOnlyPng(width = 800, height = 800, name = 'image.png'): File {
  const buffer = new ArrayBuffer(33)
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  view.setUint32(8, 13)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return new File([buffer], name, { type: 'image/png' })
}

/** JPEG with an optional APP0 segment before a start-of-frame marker (SOF0 by default). */
export function makeJpeg(width: number, height: number, options: { sofMarker?: number; withApp0?: boolean } = {}): File {
  const { sofMarker = 0xc0, withApp0 = false } = options
  const parts: number[] = [0xff, 0xd8]
  if (withApp0) {
    // APP0 segment, length 16 (includes the two length bytes).
    parts.push(0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00)
  }
  parts.push(
    0xff, sofMarker,
    0x00, 0x11, // segment length 17
    0x08, // precision
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03,
    0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  )
  return new File([new Uint8Array(parts)], 'image.jpg', { type: 'image/jpeg' })
}

function webpHeader(chunk: string): Uint8Array {
  const bytes = new Uint8Array(32)
  bytes.set([0x52, 0x49, 0x46, 0x46], 0) // RIFF
  bytes.set([0x57, 0x45, 0x42, 0x50], 8) // WEBP
  bytes.set(Array.from(chunk).map((c) => c.charCodeAt(0)), 12)
  return bytes
}

export function makeWebpVP8X(width: number, height: number): File {
  const bytes = webpHeader('VP8X')
  const w = width - 1
  const h = height - 1
  bytes.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff], 24)
  bytes.set([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 27)
  return new File([bytes], 'image.webp', { type: 'image/webp' })
}

export function makeWebpVP8(width: number, height: number): File {
  const bytes = webpHeader('VP8 ')
  bytes.set([0x9d, 0x01, 0x2a], 23)
  bytes.set([width & 0xff, (width >> 8) & 0x3f], 26)
  bytes.set([height & 0xff, (height >> 8) & 0x3f], 28)
  return new File([bytes], 'image.webp', { type: 'image/webp' })
}

export function makeWebpVP8L(width: number, height: number): File {
  const bytes = webpHeader('VP8L')
  bytes[20] = 0x2f
  const packed = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14)
  bytes.set([packed & 0xff, (packed >>> 8) & 0xff, (packed >>> 16) & 0xff, (packed >>> 24) & 0xff], 21)
  return new File([bytes], 'image.webp', { type: 'image/webp' })
}

export function dimension(rating: Rating, reason = `Observed reasoning for a ${rating} rating.`) {
  return { rating, reason, confidence: 'High' as const }
}

export type WeightedRatings = {
  occasion: Rating
  formality: Rating
  style_preference_match: Rating
  color: Rating
  seasonality: Rating
  style?: Rating
}

export function makeDimensions(ratings: WeightedRatings): RawOpenAIDimensions {
  return {
    occasion: dimension(ratings.occasion),
    color: dimension(ratings.color),
    formality: dimension(ratings.formality),
    seasonality: dimension(ratings.seasonality),
    style: dimension(ratings.style ?? 'Good'),
    style_preference_match: dimension(ratings.style_preference_match),
  }
}

export function allRated(rating: Rating): RawOpenAIDimensions {
  return makeDimensions({ occasion: rating, formality: rating, style_preference_match: rating, color: rating, seasonality: rating, style: rating })
}

export const VALID_RECOMMENDATION = {
  title: 'Structured navy blazer',
  garment_type: 'suiting',
  color_direction: 'Deep navy',
  style_direction: 'Clean, classic tailoring',
  rationale: 'A polished alternative that better supports a professional setting.',
  addresses: ['occasion', 'formality'],
  match_level: 'Excellent Match',
}

/** A Responses API body whose output_text carries the given model JSON. */
export function openAIResponse(modelOutput: unknown, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({
    status: 'completed',
    output_text: typeof modelOutput === 'string' ? modelOutput : JSON.stringify(modelOutput),
    usage: { input_tokens: 1200, output_tokens: 300, total_tokens: 1500 },
    ...extra,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

export function abortError(): Error {
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}
