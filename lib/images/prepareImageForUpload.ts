/**
 * Browser-side image preparation for uploads.
 *
 * Every selected or captured photo is decoded, oriented, resized and re-encoded
 * as a JPEG before it can be submitted. The original file is never uploaded, so
 * EXIF data (including GPS position and device details) never leaves the device.
 *
 * Nothing here writes to localStorage, sessionStorage or IndexedDB, logs image
 * data, or makes a network request. Images exist only in memory.
 *
 * Server-side validation (lib/services/analysisService.ts) is unchanged and
 * still applies to whatever the client sends.
 */

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** Longest edge of a prepared image, in pixels. */
export const MAX_LONG_EDGE_PX = 1536
/** Smallest usable side. Matches MIN_IMAGE_DIMENSION in the server validation. */
export const MIN_DIMENSION_PX = 512
/** Preferred size of one prepared image. */
export const TARGET_IMAGE_BYTES = 1_000_000
/** A prepared image above this is rejected rather than uploaded. */
export const MAX_PREPARED_IMAGE_BYTES = 1_800_000
/** Target per garment photo when an analysis has several: a personal photo and three of these fit one request. */
export const MULTI_GARMENT_TARGET_BYTES = 700_000
/** A target below this would cost too much detail; lower requests are raised to it. */
export const MIN_TARGET_IMAGE_BYTES = 300_000
/**
 * Largest source file that is decoded. Phone cameras regularly exceed the 10 MB
 * server limit; the server only ever sees the much smaller prepared image.
 */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024

/** Vercel rejects function request bodies above 4.5 MB with HTTP 413. */
export const VERCEL_REQUEST_LIMIT_BYTES = 4_500_000
/** Budget for one whole multipart request, leaving headroom below the platform limit. */
export const REQUEST_BUDGET_BYTES = 4_000_000
/** Allowance for multipart boundaries and part headers. */
export const MULTIPART_OVERHEAD_BYTES = 4_096

/** Tried in order until the encoded image fits TARGET_IMAGE_BYTES. */
export const JPEG_QUALITY_STEPS: readonly number[] = [0.86, 0.78, 0.7, 0.62]
/** When no quality fits, dimensions shrink by this factor and the quality steps repeat. */
export const DOWNSCALE_STEP = 0.85
export const MAX_DOWNSCALE_ROUNDS = 3

const OUTPUT_TYPE = 'image/jpeg'

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ImagePreparationErrorCode =
  | 'empty_file'
  | 'source_too_large'
  | 'heic_unsupported'
  | 'unsupported_format'
  | 'decode_failed'
  | 'too_small'
  | 'encode_failed'
  | 'output_too_large'
  | 'aborted'

const ERROR_MESSAGES: Record<ImagePreparationErrorCode, string> = {
  empty_file: 'That file appears to be empty. Please choose a different photo.',
  source_too_large: 'That photo is too large to prepare on this device. Please choose one under 25MB.',
  heic_unsupported: 'HEIC and HEIF photos are not supported yet. Please choose a JPEG, PNG or WEBP photo, or take a new one with the camera button.',
  unsupported_format: 'Please choose a JPEG, PNG or WEBP photo.',
  decode_failed: 'This photo could not be read. It may be damaged or in an unsupported format. Please choose a different photo.',
  too_small: 'Image must be at least 512×512 pixels. Please choose a different photo.',
  encode_failed: 'This photo could not be prepared on this device. Please try a different photo.',
  output_too_large: 'This photo is too detailed to send. Please choose a different photo.',
  aborted: 'Photo preparation was cancelled.',
}

export class ImagePreparationError extends Error {
  readonly code: ImagePreparationErrorCode

  constructor(code: ImagePreparationErrorCode) {
    super(ERROR_MESSAGES[code])
    this.name = 'ImagePreparationError'
    this.code = code
  }
}

/** User-facing text for any failure thrown while preparing an image. */
export function imagePreparationMessage(error: unknown): string {
  return error instanceof ImagePreparationError ? error.message : ERROR_MESSAGES.decode_failed
}

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

export type SniffedFormat = 'jpeg' | 'png' | 'webp' | 'heic' | 'avif' | 'gif' | 'unknown'

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1', 'heif'])
const AVIF_BRANDS = new Set(['avif', 'avis'])
const SNIFF_BYTES = 16

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let text = ''
  for (let i = start; i < end && i < bytes.length; i += 1) text += String.fromCharCode(bytes[i])
  return text
}

/**
 * Identifies the container from its leading bytes. The declared MIME type and
 * the file extension are not trusted: camera and share-sheet files often carry
 * an empty or wrong type.
 */
export function sniffImageFormat(bytes: Uint8Array): SniffedFormat {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 4) === 'PNG' && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'png'
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'webp'
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === 'ftyp') {
    const brand = ascii(bytes, 8, 12).toLowerCase()
    if (HEIC_BRANDS.has(brand)) return 'heic'
    if (AVIF_BRANDS.has(brand)) return 'avif'
    return 'unknown'
  }
  if (bytes.length >= 4 && ascii(bytes, 0, 4) === 'GIF8') return 'gif'
  return 'unknown'
}

function looksLikeHeic(file: File): boolean {
  return /^image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name)
}

// ---------------------------------------------------------------------------
// Dimension maths
// ---------------------------------------------------------------------------

export type BelowMinimumPolicy = 'upscale' | 'reject'

export interface TargetDimensions {
  width: number
  height: number
  /** True when the output is larger than the source (only for sources under the minimum). */
  upscaled: boolean
}

/**
 * Output dimensions for a source image.
 *
 * - The long edge is reduced to `maxLongEdge`.
 * - Reduction stops early if it would take the short side under `minDimension`,
 *   so a very wide or tall image keeps a usable short side.
 * - A source that already fits is never enlarged.
 * - A source under `minDimension` on either side is enlarged just enough to
 *   reach it (`upscale`), or reported as null (`reject`).
 */
export function computeTargetDimensions(
  sourceWidth: number,
  sourceHeight: number,
  options: { maxLongEdge?: number; minDimension?: number; belowMinimum?: BelowMinimumPolicy } = {}
): TargetDimensions | null {
  const maxLongEdge = options.maxLongEdge ?? MAX_LONG_EDGE_PX
  const minDimension = options.minDimension ?? MIN_DIMENSION_PX
  const belowMinimum = options.belowMinimum ?? 'upscale'

  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth < 1 || sourceHeight < 1) return null

  const longEdge = Math.max(sourceWidth, sourceHeight)
  const shortEdge = Math.min(sourceWidth, sourceHeight)

  if (shortEdge < minDimension) {
    if (belowMinimum === 'reject') return null
    const scale = minDimension / shortEdge
    return {
      width: Math.max(minDimension, Math.ceil(sourceWidth * scale)),
      height: Math.max(minDimension, Math.ceil(sourceHeight * scale)),
      upscaled: true,
    }
  }

  if (longEdge <= maxLongEdge) return { width: Math.round(sourceWidth), height: Math.round(sourceHeight), upscaled: false }

  // Never above 1 here: shortEdge >= minDimension and longEdge > maxLongEdge.
  const scale = Math.max(maxLongEdge / longEdge, minDimension / shortEdge)
  return {
    width: Math.max(minDimension, Math.round(sourceWidth * scale)),
    height: Math.max(minDimension, Math.round(sourceHeight * scale)),
    upscaled: false,
  }
}

/**
 * The next smaller size to try when compression alone cannot reach the target,
 * or null when the image is already at the minimum usable size.
 */
export function shrinkDimensions(
  width: number,
  height: number,
  minDimension: number = MIN_DIMENSION_PX,
  step: number = DOWNSCALE_STEP
): { width: number; height: number } | null {
  const shortEdge = Math.min(width, height)
  if (shortEdge <= minDimension) return null
  const scale = Math.max(step, minDimension / shortEdge)
  const next = {
    width: Math.max(minDimension, Math.round(width * scale)),
    height: Math.max(minDimension, Math.round(height * scale)),
  }
  return next.width === width && next.height === height ? null : next
}

// ---------------------------------------------------------------------------
// Request budget
// ---------------------------------------------------------------------------

/** Total bytes of one multipart request: images, text fields and multipart framing. */
export function estimateRequestBytes(imageBytes: readonly number[], textFieldBytes = 0): number {
  return imageBytes.reduce((sum, bytes) => sum + bytes, 0) + textFieldBytes + MULTIPART_OVERHEAD_BYTES
}

export function isWithinRequestBudget(imageBytes: readonly number[], textFieldBytes = 0): boolean {
  return estimateRequestBytes(imageBytes, textFieldBytes) <= REQUEST_BUDGET_BYTES
}

// ---------------------------------------------------------------------------
// Decoding and drawing (injectable so the pipeline can be tested without a browser)
// ---------------------------------------------------------------------------

export interface DecodedImage {
  width: number
  height: number
  /** Passed to the canvas as the drawing source. */
  source: unknown
  /** Releases decoder memory. Safe to call once. */
  release: () => void
}

export interface DrawingSurface {
  /** Fills white, then draws the image scaled to the surface. */
  draw: (image: DecodedImage) => void
  encodeJpeg: (quality: number) => Promise<Blob | null>
  /** Releases the backing store. */
  release: () => void
}

export interface ImagePreparationEnvironment {
  decode: (file: Blob) => Promise<DecodedImage>
  createSurface: (width: number, height: number) => DrawingSurface
}

async function decodeWithImageElement(file: Blob): Promise<DecodedImage> {
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('decode'))
      image.src = url
    })
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      source: image,
      release: () => {
        image.onload = null
        image.onerror = null
        image.src = ''
      },
    }
  } finally {
    // The decoded pixels are held by the element; the URL is no longer needed.
    URL.revokeObjectURL(url)
  }
}

/**
 * Uses the browser's own decoders. `imageOrientation: 'from-image'` applies the
 * EXIF orientation, so a portrait phone photo arrives upright and the reported
 * width and height are those of the upright image. The <img> fallback honours
 * EXIF orientation by default in current browsers.
 */
async function browserDecode(file: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { width: bitmap.width, height: bitmap.height, source: bitmap, release: () => bitmap.close() }
    } catch {
      // Some browsers reject formats here that an <img> can still decode.
    }
  }
  return decodeWithImageElement(file)
}

function browserCreateSurface(width: number, height: number): DrawingSurface {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return {
    draw: (image) => {
      // No alpha channel: JPEG has none, and an opaque canvas avoids black fringes.
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) throw new ImagePreparationError('encode_failed')
      // Transparent pixels would otherwise encode as black.
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, width, height)
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.drawImage(image.source as CanvasImageSource, 0, 0, width, height)
    },
    encodeJpeg: (quality) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, OUTPUT_TYPE, quality)),
    release: () => {
      // Zero-sizing frees the backing store immediately instead of waiting for GC.
      canvas.width = 0
      canvas.height = 0
    },
  }
}

export const browserEnvironment: ImagePreparationEnvironment = {
  decode: browserDecode,
  createSurface: browserCreateSurface,
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export interface PrepareImageOptions {
  /** What to do with a source under 512 px on either side. Default: 'upscale'. */
  belowMinimum?: BelowMinimumPolicy
  /**
   * Size to aim for, in bytes. Only ever lowers the default (TARGET_IMAGE_BYTES): several garment
   * photos must share one request, so each of them aims lower. Never below MIN_TARGET_IMAGE_BYTES.
   */
  targetBytes?: number
  /** Cancels preparation, for example when the user picks another photo. */
  signal?: AbortSignal
  environment?: ImagePreparationEnvironment
}

export interface PreparedImage {
  /** Always a newly encoded JPEG; never the original bytes. */
  file: File
  width: number
  height: number
  quality: number
  sourceWidth: number
  sourceHeight: number
}

/** The size to aim for: the default, or a lower value within the allowed range. */
export function resolveTargetBytes(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return TARGET_IMAGE_BYTES
  return Math.min(TARGET_IMAGE_BYTES, Math.max(MIN_TARGET_IMAGE_BYTES, Math.floor(requested)))
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new ImagePreparationError('aborted')
}

function preparedFileName(originalName: string): string {
  const base = originalName.replace(/\.[^./\\]*$/, '').trim()
  return `${base || 'photo'}.jpg`
}

/**
 * Turns a selected or captured photo into an upload-ready JPEG.
 * Throws ImagePreparationError for every failure; never returns the original file.
 */
export async function prepareImageForUpload(file: File, options: PrepareImageOptions = {}): Promise<PreparedImage> {
  const { signal } = options
  const environment = options.environment ?? browserEnvironment
  const targetBytes = resolveTargetBytes(options.targetBytes)
  throwIfAborted(signal)

  if (!file || file.size <= 0) throw new ImagePreparationError('empty_file')
  if (file.size > MAX_SOURCE_BYTES) throw new ImagePreparationError('source_too_large')

  let header: Uint8Array
  try {
    header = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer())
  } catch {
    throw new ImagePreparationError('decode_failed')
  }
  const format = sniffImageFormat(header)
  if (format === 'heic' || (format === 'unknown' && looksLikeHeic(file))) throw new ImagePreparationError('heic_unsupported')
  if (format !== 'jpeg' && format !== 'png' && format !== 'webp') throw new ImagePreparationError('unsupported_format')
  throwIfAborted(signal)

  let decoded: DecodedImage
  try {
    decoded = await environment.decode(file)
  } catch {
    throw new ImagePreparationError('decode_failed')
  }

  let surface: DrawingSurface | null = null
  try {
    throwIfAborted(signal)
    if (!(decoded.width > 0) || !(decoded.height > 0)) throw new ImagePreparationError('decode_failed')

    let size: { width: number; height: number } | null = computeTargetDimensions(decoded.width, decoded.height, {
      belowMinimum: options.belowMinimum,
    })
    if (!size) throw new ImagePreparationError('too_small')

    let smallest: { blob: Blob; width: number; height: number; quality: number } | null = null

    for (let round = 0; size && round <= MAX_DOWNSCALE_ROUNDS; round += 1) {
      surface = environment.createSurface(size.width, size.height)
      surface.draw(decoded)

      for (const quality of JPEG_QUALITY_STEPS) {
        throwIfAborted(signal)
        const blob = await surface.encodeJpeg(quality)
        if (!blob || blob.size <= 0) throw new ImagePreparationError('encode_failed')
        // A browser that cannot encode JPEG silently falls back to PNG.
        if (blob.type !== OUTPUT_TYPE) throw new ImagePreparationError('encode_failed')
        if (!smallest || blob.size < smallest.blob.size) smallest = { blob, width: size.width, height: size.height, quality }
        if (blob.size <= targetBytes) break
      }

      surface.release()
      surface = null
      if (smallest && smallest.blob.size <= targetBytes) break
      size = shrinkDimensions(size.width, size.height)
    }

    throwIfAborted(signal)
    if (!smallest) throw new ImagePreparationError('encode_failed')
    if (smallest.blob.size > MAX_PREPARED_IMAGE_BYTES) throw new ImagePreparationError('output_too_large')

    return {
      file: new File([smallest.blob], preparedFileName(file.name), { type: OUTPUT_TYPE }),
      width: smallest.width,
      height: smallest.height,
      quality: smallest.quality,
      sourceWidth: decoded.width,
      sourceHeight: decoded.height,
    }
  } catch (error) {
    if (error instanceof ImagePreparationError) throw error
    throw new ImagePreparationError('encode_failed')
  } finally {
    surface?.release()
    decoded.release()
  }
}
