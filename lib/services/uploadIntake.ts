import 'server-only'
import { createHash } from 'node:crypto'
import { GARMENT_MODES, MAX_GARMENT_IMAGES, garmentCountProblem, isGarmentMode, type GarmentMode } from '@/lib/constants/garmentModes'
import { ImageNormalizationError, MAX_REQUEST_BYTES, normalizeImage } from '@/lib/images/normalizeImage'
import { validateImageFile } from '@/lib/services/analysisService'
import type { OutfitComponents } from '@/types/schema'

/**
 * Intake of uploaded images for the API routes: request size limits, the
 * garment mode and its image count, duplicate detection, and validation plus
 * normalisation of every image.
 *
 * Everything here runs BEFORE any spend reservation and before any model call,
 * so a rejected upload costs nothing. Nothing here logs: file names, sizes and
 * contents never reach a log.
 */

export interface UploadProblem {
  status: 400 | 413
  body: { error: 'invalid_upload' | 'missing_image' | 'payload_too_large'; message: string }
}

const TOO_LARGE: UploadProblem = {
  status: 413,
  body: { error: 'payload_too_large', message: 'Your photos are too large to send together. Please choose smaller photos and try again.' },
}

function invalid(message: string): UploadProblem {
  return { status: 400, body: { error: 'invalid_upload', message } }
}

export function isUploadedFile(value: unknown): value is File {
  return Boolean(value) && typeof value !== 'string' && typeof (value as File).arrayBuffer === 'function'
}

/**
 * Refuses a request whose declared body is above the limit, before the body is
 * read. A request without a usable Content-Length is checked after parsing
 * instead (see `aggregateSizeProblem`).
 */
export function declaredSizeProblem(headers: Headers): UploadProblem | null {
  const declared = headers.get('content-length')
  if (declared === null) return null
  const bytes = Number(declared)
  return Number.isFinite(bytes) && bytes > MAX_REQUEST_BYTES ? TOO_LARGE : null
}

/** Refuses uploads whose images together exceed the request limit, whatever Content-Length said. */
export function aggregateSizeProblem(files: readonly File[]): UploadProblem | null {
  const total = files.reduce((sum, file) => sum + file.size, 0)
  return total > MAX_REQUEST_BYTES ? TOO_LARGE : null
}

export type GarmentUploads =
  | { ok: true; mode: GarmentMode; garments: File[] }
  | { ok: false; problem: UploadProblem }

/**
 * Reads the garment images and the garment mode of an analysis request.
 *
 * The field `garment` may appear one to three times. `garmentMode` says how the
 * images relate; a request without it is a single-garment request, which is how
 * every client before multiple images existed keeps working. The mode is never
 * inferred from the number of images: a count that does not fit the mode is an error.
 */
export function readGarmentUploads(formData: FormData): GarmentUploads {
  const entries = formData.getAll('garment')
  if (entries.some((entry) => !isUploadedFile(entry))) {
    return { ok: false, problem: invalid('Garment photos must be image files.') }
  }
  const garments = entries as File[]

  const rawMode = formData.get('garmentMode')
  if (rawMode !== null && !isGarmentMode(rawMode)) {
    return { ok: false, problem: invalid(`Please choose how your garment photos relate to each other (${GARMENT_MODES.join(', ')}).`) }
  }
  const mode: GarmentMode = rawMode === null ? 'single' : rawMode

  if (garments.length > MAX_GARMENT_IMAGES) {
    return { ok: false, problem: invalid(`You can add up to ${MAX_GARMENT_IMAGES} garment photos.`) }
  }
  const countProblem = garmentCountProblem(mode, garments.length)
  if (countProblem) return { ok: false, problem: invalid(countProblem) }

  return { ok: true, mode, garments }
}

async function digest(file: File): Promise<string> {
  return createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex')
}

/** The position (starting at 1) of the first garment image that repeats an earlier one, or null. */
export async function findDuplicateGarment(garments: readonly File[]): Promise<number | null> {
  const seen = new Set<string>()
  for (let index = 0; index < garments.length; index += 1) {
    const hash = await digest(garments[index])
    if (seen.has(hash)) return index + 1
    seen.add(hash)
  }
  return null
}

export type IntakeResult =
  | { ok: true; file: File }
  | { ok: false; problem: UploadProblem }

/**
 * Validates one uploaded image and returns the normalised JPEG that may be used
 * from here on. `label` prefixes the message so the user knows which photo is
 * meant; pass an empty string for an endpoint with a single photo.
 */
export async function intakeImage(file: File, label: string, name: string): Promise<IntakeResult> {
  const prefix = label ? `${label}: ` : ''
  const check = await validateImageFile(file)
  if (!check.valid) return { ok: false, problem: invalid(`${prefix}${check.message}`) }
  try {
    return { ok: true, file: (await normalizeImage(file, name)).file }
  } catch (error) {
    // Anything unexpected is reported as an invalid image: a processing failure must never let the original bytes through.
    const message = error instanceof ImageNormalizationError ? error.message : 'The uploaded file could not be processed as an image.'
    return { ok: false, problem: invalid(`${prefix}${message}`) }
  }
}

/** Label for a garment image in a validation message. One garment keeps the wording it always had. */
export function garmentLabel(index: number, count: number): string {
  return count === 1 ? 'Garment photo' : `Garment photo ${index + 1}`
}

const MOCK_GARMENT_TYPES = ['top', 'bottom', 'outerwear'] as const

/** Per-item notes for mock mode. They say plainly that no image was analysed. */
export function mockOutfitComponents(garmentCount: number): OutfitComponents {
  return {
    availability: 'available',
    items: Array.from({ length: garmentCount }, (_, index) => ({
      item: index + 1,
      garment_type: MOCK_GARMENT_TYPES[index % MOCK_GARMENT_TYPES.length],
      assessment: 'Works' as const,
      note: 'Example note from mock mode: no image was analysed for this item.',
    })),
  }
}
