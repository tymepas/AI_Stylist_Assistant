import 'server-only'
import sharp from 'sharp'
import { sniffImageFormat } from '@/lib/images/prepareImageForUpload'

/**
 * Server-side image normalisation.
 *
 * Every uploaded image is decoded and re-encoded here before it is used for
 * anything else. The bytes a client sent are never forwarded to the model
 * provider: only the JPEG produced by this module is.
 *
 * Why the server does this even though the browser already prepares photos
 * (lib/images/prepareImageForUpload.ts): a client that calls the API directly
 * bypasses the browser. Without this step such a client could send EXIF and GPS
 * metadata, a decompression bomb, or bytes that are not an image at all. For
 * photos that did come from the Verdict frontend this is cheap: they are already
 * small, upright JPEGs, so nothing is resized and one re-encode is the only work.
 *
 * What it guarantees about its output:
 * - it is a real, fully decoded JPEG, PNG or WEBP (first frame only), re-encoded as JPEG;
 * - EXIF orientation has been applied, then all metadata (EXIF, GPS, ICC, XMP) is dropped;
 * - transparency is flattened onto white;
 * - the long edge is at most NORMALIZED_LONG_EDGE_PX; small images are never enlarged.
 *
 * Everything happens in memory. No temporary file is written, nothing is cached
 * between requests, and neither the input nor the output is logged.
 */

/** Vercel rejects request bodies above 4.5 MB before the route runs. Enforced here too, so other hosts behave the same. */
export const MAX_REQUEST_BYTES = 4_500_000
/** Longest side accepted before decoding. */
export const MAX_IMAGE_SIDE_PX = 8_192
/** Most pixels accepted before decoding: the decompression-bomb limit. A 16 MP RGBA image is 64 MB decoded. */
export const MAX_IMAGE_PIXELS = 16_000_000
/** Same long edge as the browser preparation step, so a prepared photo is never resized again. */
export const NORMALIZED_LONG_EDGE_PX = 1_536
export const NORMALIZED_JPEG_QUALITY = 85
/** A decode that takes longer than this is abandoned. */
export const DECODE_TIMEOUT_SECONDS = 10
export const NORMALIZED_TYPE = 'image/jpeg'

const FORMAT_BY_TYPE: Record<string, 'jpeg' | 'png' | 'webp'> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export type ImageNormalizationErrorCode =
  | 'unsupported_format'
  | 'type_mismatch'
  | 'too_many_pixels'
  | 'decode_failed'
  | 'timeout'

/** Messages are written for the user and say nothing about the file's contents. */
const MESSAGES: Record<ImageNormalizationErrorCode, string> = {
  unsupported_format: 'Please upload a JPEG, PNG, or WEBP image.',
  type_mismatch: 'The file content does not match its type. Please upload a JPEG, PNG, or WEBP image.',
  too_many_pixels: `Image is too large. Each side can be at most ${MAX_IMAGE_SIDE_PX.toLocaleString('en-US')} pixels and the whole image at most ${MAX_IMAGE_PIXELS / 1_000_000} megapixels.`,
  decode_failed: 'The uploaded file is not a valid JPEG, PNG, or WEBP image.',
  timeout: 'The image took too long to process. Please try a smaller photo.',
}

export class ImageNormalizationError extends Error {
  readonly code: ImageNormalizationErrorCode

  constructor(code: ImageNormalizationErrorCode) {
    super(MESSAGES[code])
    this.name = 'ImageNormalizationError'
    this.code = code
  }
}

export interface NormalizedImage {
  /** The re-encoded JPEG. This, and never the upload, is what may be sent on. */
  file: File
  width: number
  height: number
  /** True when the image was scaled down to fit the long edge. */
  resized: boolean
}

let configured = false

/** One decode at a time per process, and no cache of earlier images. */
function configureSharp(): void {
  if (configured) return
  sharp.cache(false)
  sharp.concurrency(1)
  configured = true
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && /timeout/i.test(error.message)
}

function isPixelLimit(error: unknown): boolean {
  return error instanceof Error && /pixel limit|too large|exceeds/i.test(error.message)
}

/**
 * Decodes an upload and returns it as a metadata-free JPEG.
 * Throws ImageNormalizationError; never returns the original bytes.
 */
export async function normalizeImage(file: File, name = 'image.jpg'): Promise<NormalizedImage> {
  configureSharp()

  const declared = FORMAT_BY_TYPE[file.type]
  if (!declared) throw new ImageNormalizationError('unsupported_format')

  const input = Buffer.from(await file.arrayBuffer())
  // The leading bytes decide what the file is. The declared type and the name are only claims.
  const actual = sniffImageFormat(new Uint8Array(input.buffer, input.byteOffset, Math.min(input.byteLength, 64)))
  if (actual !== 'jpeg' && actual !== 'png' && actual !== 'webp') throw new ImageNormalizationError('unsupported_format')
  if (actual !== declared) throw new ImageNormalizationError('type_mismatch')

  // failOn 'error' refuses truncated or corrupt data instead of returning a partly decoded picture.
  const options = { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error' as const, sequentialRead: true, animated: false }

  let width: number
  let height: number
  try {
    // Reads the header only, so an oversized image is refused before any pixel is decoded.
    const metadata = await sharp(input, options).metadata()
    if (!metadata.width || !metadata.height || metadata.format !== actual) throw new ImageNormalizationError('decode_failed')
    width = metadata.width
    height = metadata.height
  } catch (error) {
    if (error instanceof ImageNormalizationError) throw error
    throw new ImageNormalizationError(isPixelLimit(error) ? 'too_many_pixels' : 'decode_failed')
  }
  if (width > MAX_IMAGE_SIDE_PX || height > MAX_IMAGE_SIDE_PX || width * height > MAX_IMAGE_PIXELS) {
    throw new ImageNormalizationError('too_many_pixels')
  }

  try {
    const { data, info } = await sharp(input, options)
      .rotate() // applies the EXIF orientation; the tag itself is then dropped with the rest of the metadata
      .resize({ width: NORMALIZED_LONG_EDGE_PX, height: NORMALIZED_LONG_EDGE_PX, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: NORMALIZED_JPEG_QUALITY })
      .timeout({ seconds: DECODE_TIMEOUT_SECONDS })
      // No withMetadata() or keepMetadata(): EXIF, GPS, ICC and XMP are not written.
      .toBuffer({ resolveWithObject: true })

    return {
      file: new File([new Uint8Array(data)], name, { type: NORMALIZED_TYPE }),
      width: info.width,
      height: info.height,
      resized: Math.max(info.width, info.height) < Math.max(width, height),
    }
  } catch (error) {
    if (isTimeout(error)) throw new ImageNormalizationError('timeout')
    throw new ImageNormalizationError(isPixelLimit(error) ? 'too_many_pixels' : 'decode_failed')
  }
}
