/**
 * Browser image preparation: dimension maths, format detection, the compression
 * strategy and resource cleanup. The decoder and canvas are injected fakes, so
 * no browser, network or real photograph is involved.
 */

import {
  computeTargetDimensions,
  estimateRequestBytes,
  ImagePreparationError,
  imagePreparationMessage,
  isWithinRequestBudget,
  JPEG_QUALITY_STEPS,
  MAX_DOWNSCALE_ROUNDS,
  MAX_LONG_EDGE_PX,
  MAX_PREPARED_IMAGE_BYTES,
  MAX_SOURCE_BYTES,
  MIN_DIMENSION_PX,
  MULTIPART_OVERHEAD_BYTES,
  prepareImageForUpload,
  REQUEST_BUDGET_BYTES,
  shrinkDimensions,
  sniffImageFormat,
  TARGET_IMAGE_BYTES,
  MIN_TARGET_IMAGE_BYTES,
  MULTI_GARMENT_TARGET_BYTES,
  resolveTargetBytes,
  VERCEL_REQUEST_LIMIT_BYTES,
  type DecodedImage,
  type ImagePreparationEnvironment,
} from '@/lib/images/prepareImageForUpload'
import { MAX_AI_STYLE_PROFILE_BYTES, MAX_OCCASION_LENGTH, MAX_STYLE_PROFILE_BYTES } from '@/lib/services/requestLimits'

const JPEG_HEADER = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]
const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]
const WEBP_HEADER = [0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]

function ftypHeader(brand: string): number[] {
  return [0x00, 0x00, 0x00, 0x18, ...Array.from('ftyp' + brand, (char) => char.charCodeAt(0)), 0x00, 0x00, 0x00, 0x00]
}

/** A synthetic file: real container header followed by filler bytes. Never a real photo. */
function makeFile(header: number[], options: { name?: string; type?: string; size?: number } = {}): File {
  const size = Math.max(options.size ?? 64, header.length)
  const bytes = new Uint8Array(size)
  bytes.set(header)
  return new File([bytes], options.name ?? 'IMG_0001.jpg', { type: options.type ?? 'image/jpeg' })
}

interface FakeEnvironment extends ImagePreparationEnvironment {
  log: string[]
  surfaces: Array<{ width: number; height: number; released: number; qualities: number[] }>
  decodedReleases: number
}

/**
 * `sizeOf` decides the encoded size for a surface and quality, which is how each
 * test steers the compression strategy.
 */
function fakeEnvironment(
  source: { width: number; height: number },
  sizeOf: (width: number, height: number, quality: number) => number,
  overrides: { decodeFails?: boolean; outputType?: string; nullBlob?: boolean; drawThrows?: boolean } = {}
): FakeEnvironment {
  const env: FakeEnvironment = {
    log: [],
    surfaces: [],
    decodedReleases: 0,
    decode: async () => {
      if (overrides.decodeFails) throw new Error('cannot decode')
      const decoded: DecodedImage = {
        width: source.width,
        height: source.height,
        source: {},
        release: () => {
          env.decodedReleases += 1
        },
      }
      return decoded
    },
    createSurface: (width, height) => {
      const record = { width, height, released: 0, qualities: [] as number[] }
      env.surfaces.push(record)
      return {
        draw: () => {
          if (overrides.drawThrows) throw new Error('canvas lost')
          env.log.push(`draw:${width}x${height}`)
        },
        encodeJpeg: async (quality) => {
          record.qualities.push(quality)
          env.log.push(`encode:${quality}`)
          if (overrides.nullBlob) return null
          return new Blob([new Uint8Array(sizeOf(width, height, quality))], { type: overrides.outputType ?? 'image/jpeg' })
        },
        release: () => {
          record.released += 1
        },
      }
    },
  }
  return env
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(ImagePreparationError)
  await expect(promise).rejects.toMatchObject({ code })
}

describe('computeTargetDimensions', () => {
  it('reduces the long edge of a landscape phone photo to 1,536 px', () => {
    expect(computeTargetDimensions(4032, 3024)).toEqual({ width: 1536, height: 1152, upscaled: false })
  })

  it('reduces the long edge of a portrait phone photo to 1,536 px', () => {
    expect(computeTargetDimensions(3024, 4032)).toEqual({ width: 1152, height: 1536, upscaled: false })
  })

  it('leaves an image that already fits at its original size', () => {
    expect(computeTargetDimensions(1200, 900)).toEqual({ width: 1200, height: 900, upscaled: false })
    expect(computeTargetDimensions(1536, 1536)).toEqual({ width: 1536, height: 1536, upscaled: false })
  })

  it('never enlarges an image that meets the 512 px minimum', () => {
    expect(computeTargetDimensions(512, 512)).toEqual({ width: 512, height: 512, upscaled: false })
    expect(computeTargetDimensions(600, 800)).toEqual({ width: 600, height: 800, upscaled: false })
  })

  it('stops reducing a very wide image before its short side drops under 512 px', () => {
    const target = computeTargetDimensions(6000, 800)
    expect(target).toEqual({ width: 3840, height: 512, upscaled: false })
  })

  it('keeps both sides at or above the minimum for every downscaled size', () => {
    for (const [width, height] of [[1537, 513], [5000, 513], [513, 9000], [2049, 2047], [8000, 6000], [1700, 512]] as const) {
      const target = computeTargetDimensions(width, height)
      expect(target).not.toBeNull()
      expect(Math.min(target!.width, target!.height)).toBeGreaterThanOrEqual(MIN_DIMENSION_PX)
      expect(target!.width).toBeLessThanOrEqual(width)
      expect(target!.height).toBeLessThanOrEqual(height)
      expect(target!.upscaled).toBe(false)
    }
  })

  it('enlarges an undersized image only as far as the minimum when asked to upscale', () => {
    expect(computeTargetDimensions(400, 300, { belowMinimum: 'upscale' })).toEqual({ width: 683, height: 512, upscaled: true })
    expect(computeTargetDimensions(300, 300)).toEqual({ width: 512, height: 512, upscaled: true })
  })

  it('reports an undersized image as unusable when asked to reject', () => {
    expect(computeTargetDimensions(400, 300, { belowMinimum: 'reject' })).toBeNull()
    expect(computeTargetDimensions(511, 2000, { belowMinimum: 'reject' })).toBeNull()
  })

  it('rejects impossible dimensions', () => {
    expect(computeTargetDimensions(0, 100)).toBeNull()
    expect(computeTargetDimensions(Number.NaN, 100)).toBeNull()
    expect(computeTargetDimensions(100, Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('shrinkDimensions', () => {
  it('shrinks by the step while keeping the aspect ratio', () => {
    expect(shrinkDimensions(1536, 1152)).toEqual({ width: 1306, height: 979 })
  })

  it('never goes below the minimum dimension', () => {
    expect(shrinkDimensions(1536, 560)).toEqual({ width: 1404, height: 512 })
  })

  it('returns null once the short side is at the minimum', () => {
    expect(shrinkDimensions(900, 512)).toBeNull()
    expect(shrinkDimensions(512, 512)).toBeNull()
  })
})

describe('sniffImageFormat', () => {
  it('recognises the supported formats from their leading bytes', () => {
    expect(sniffImageFormat(new Uint8Array(JPEG_HEADER))).toBe('jpeg')
    expect(sniffImageFormat(new Uint8Array(PNG_HEADER))).toBe('png')
    expect(sniffImageFormat(new Uint8Array(WEBP_HEADER))).toBe('webp')
  })

  it('recognises HEIC, AVIF and GIF as distinct unsupported formats', () => {
    expect(sniffImageFormat(new Uint8Array(ftypHeader('heic')))).toBe('heic')
    expect(sniffImageFormat(new Uint8Array(ftypHeader('mif1')))).toBe('heic')
    expect(sniffImageFormat(new Uint8Array(ftypHeader('avif')))).toBe('avif')
    expect(sniffImageFormat(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe('gif')
  })

  it('returns unknown for anything else, including an empty buffer', () => {
    expect(sniffImageFormat(new Uint8Array([]))).toBe('unknown')
    expect(sniffImageFormat(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe('unknown')
    expect(sniffImageFormat(new Uint8Array(ftypHeader('isom')))).toBe('unknown')
  })
})

describe('request budget', () => {
  it('keeps the whole-request budget below the Vercel 4.5 MB limit', () => {
    expect(REQUEST_BUDGET_BYTES).toBeLessThan(VERCEL_REQUEST_LIMIT_BYTES)
  })

  it('fits two worst-case prepared images plus the largest allowed text fields', () => {
    // Worst case in bytes: 4 bytes per occasion character, plus both profile caps.
    const textBytes = MAX_OCCASION_LENGTH * 4 + MAX_STYLE_PROFILE_BYTES + MAX_AI_STYLE_PROFILE_BYTES
    const worstCase = [MAX_PREPARED_IMAGE_BYTES, MAX_PREPARED_IMAGE_BYTES]
    expect(estimateRequestBytes(worstCase, textBytes)).toBe(2 * MAX_PREPARED_IMAGE_BYTES + textBytes + MULTIPART_OVERHEAD_BYTES)
    expect(isWithinRequestBudget(worstCase, textBytes)).toBe(true)
  })

  it('aims for about 1 MB per image, with a hard cap above the target', () => {
    expect(TARGET_IMAGE_BYTES).toBe(1_000_000)
    expect(MAX_PREPARED_IMAGE_BYTES).toBeGreaterThan(TARGET_IMAGE_BYTES)
  })

  it('refuses a request that would exceed the budget', () => {
    expect(isWithinRequestBudget([2_500_000, 2_500_000])).toBe(false)
    expect(isWithinRequestBudget([REQUEST_BUDGET_BYTES], 0)).toBe(false)
  })
})

describe('prepareImageForUpload', () => {
  it('re-encodes a phone photo as a resized JPEG at the first quality that fits', async () => {
    const env = fakeEnvironment({ width: 4032, height: 3024 }, () => 400_000)
    const source = makeFile(JPEG_HEADER, { name: 'IMG_4821.JPG', size: 5_000_000 })

    const prepared = await prepareImageForUpload(source, { environment: env })

    expect(prepared.file).not.toBe(source)
    expect(prepared.file.type).toBe('image/jpeg')
    expect(prepared.file.name).toBe('IMG_4821.jpg')
    expect(prepared.file.size).toBe(400_000)
    expect(prepared).toMatchObject({ width: 1536, height: 1152, quality: JPEG_QUALITY_STEPS[0], sourceWidth: 4032, sourceHeight: 3024 })
    expect(env.log).toEqual(['draw:1536x1152', `encode:${JPEG_QUALITY_STEPS[0]}`])
  })

  it('re-encodes even a small JPEG, so the original bytes and metadata are never passed through', async () => {
    const env = fakeEnvironment({ width: 800, height: 600 }, () => 90_000)
    const source = makeFile(JPEG_HEADER, { size: 120_000 })

    const prepared = await prepareImageForUpload(source, { environment: env })

    expect(prepared.file).not.toBe(source)
    expect(prepared.file.size).toBe(90_000)
    expect(prepared).toMatchObject({ width: 800, height: 600 })
    expect(env.surfaces).toHaveLength(1)
  })

  it('converts PNG and WEBP sources to JPEG with a .jpg name', async () => {
    for (const [header, name, type] of [[PNG_HEADER, 'cut-out.png', 'image/png'], [WEBP_HEADER, 'shirt.webp', 'image/webp']] as const) {
      const env = fakeEnvironment({ width: 1000, height: 1000 }, () => 200_000)
      const prepared = await prepareImageForUpload(makeFile([...header], { name, type }), { environment: env })
      expect(prepared.file.type).toBe('image/jpeg')
      expect(prepared.file.name).toBe(name.replace(/\.\w+$/, '.jpg'))
    }
  })

  it('trusts the file contents over a missing or wrong declared type', async () => {
    const env = fakeEnvironment({ width: 1000, height: 1000 }, () => 200_000)
    const prepared = await prepareImageForUpload(makeFile(JPEG_HEADER, { name: 'capture', type: '' }), { environment: env })
    expect(prepared.file.type).toBe('image/jpeg')
    expect(prepared.file.name).toBe('capture.jpg')
  })

  it('steps the quality down until the image reaches the 1 MB target', async () => {
    const sizes: Record<number, number> = { 0.86: 1_600_000, 0.78: 1_250_000, 0.7: 980_000, 0.62: 700_000 }
    const env = fakeEnvironment({ width: 4000, height: 3000 }, (_w, _h, quality) => sizes[quality])

    const prepared = await prepareImageForUpload(makeFile(JPEG_HEADER), { environment: env })

    expect(prepared.quality).toBe(0.7)
    expect(prepared.file.size).toBe(980_000)
    expect(env.surfaces).toHaveLength(1)
    expect(env.surfaces[0].qualities).toEqual([0.86, 0.78, 0.7])
  })

  it('aims lower when asked to, so several garment photos fit one request', async () => {
    const sizes: Record<number, number> = { 0.86: 980_000, 0.78: 860_000, 0.7: 690_000, 0.62: 600_000 }
    const usual = fakeEnvironment({ width: 4000, height: 3000 }, (_w, _h, quality) => sizes[quality])
    const shared = fakeEnvironment({ width: 4000, height: 3000 }, (_w, _h, quality) => sizes[quality])

    // The default target (1 MB) is met at the first quality; the lower target needs two more steps.
    expect((await prepareImageForUpload(makeFile(JPEG_HEADER), { environment: usual })).file.size).toBe(980_000)
    const prepared = await prepareImageForUpload(makeFile(JPEG_HEADER), { environment: shared, targetBytes: MULTI_GARMENT_TARGET_BYTES })
    expect(prepared.file.size).toBe(690_000)
    expect(shared.surfaces[0].qualities).toEqual([0.86, 0.78, 0.7])
  })

  it('never aims higher than the default or lower than the floor, whatever is requested', () => {
    expect(resolveTargetBytes(undefined)).toBe(TARGET_IMAGE_BYTES)
    expect(resolveTargetBytes(Number.NaN)).toBe(TARGET_IMAGE_BYTES)
    expect(resolveTargetBytes(TARGET_IMAGE_BYTES * 5)).toBe(TARGET_IMAGE_BYTES)
    expect(resolveTargetBytes(MULTI_GARMENT_TARGET_BYTES)).toBe(MULTI_GARMENT_TARGET_BYTES)
    expect(resolveTargetBytes(1)).toBe(MIN_TARGET_IMAGE_BYTES)
    expect(resolveTargetBytes(-50)).toBe(MIN_TARGET_IMAGE_BYTES)
  })

  it('lets a personal photo and three garment photos fit one request at their targets', () => {
    expect(isWithinRequestBudget([TARGET_IMAGE_BYTES, MULTI_GARMENT_TARGET_BYTES, MULTI_GARMENT_TARGET_BYTES, MULTI_GARMENT_TARGET_BYTES], 12_000)).toBe(true)
    expect(isWithinRequestBudget([TARGET_IMAGE_BYTES, TARGET_IMAGE_BYTES, TARGET_IMAGE_BYTES, TARGET_IMAGE_BYTES], 12_000)).toBe(false)
  })

  it('reduces dimensions when no quality reaches the target, then stops as soon as one fits', async () => {
    // Fits only once the image has been shrunk at least once.
    const env = fakeEnvironment({ width: 4000, height: 3000 }, (width) => (width >= 1536 ? 1_400_000 : 600_000))

    const prepared = await prepareImageForUpload(makeFile(JPEG_HEADER), { environment: env })

    expect(env.surfaces.map((surface) => `${surface.width}x${surface.height}`)).toEqual(['1536x1152', '1306x979'])
    expect(env.surfaces[0].qualities).toEqual([...JPEG_QUALITY_STEPS])
    expect(env.surfaces[1].qualities).toEqual([JPEG_QUALITY_STEPS[0]])
    expect(prepared).toMatchObject({ width: 1306, height: 979 })
    expect(prepared.file.size).toBeLessThanOrEqual(TARGET_IMAGE_BYTES)
  })

  it('accepts the smallest result when it is over the target but within the hard cap', async () => {
    const env = fakeEnvironment({ width: 4000, height: 3000 }, (width, _h, quality) => Math.round(1_200_000 + width * 100 + quality * 1000))

    const prepared = await prepareImageForUpload(makeFile(JPEG_HEADER), { environment: env })

    expect(env.surfaces).toHaveLength(MAX_DOWNSCALE_ROUNDS + 1)
    expect(prepared.file.size).toBeGreaterThan(TARGET_IMAGE_BYTES)
    expect(prepared.file.size).toBeLessThanOrEqual(MAX_PREPARED_IMAGE_BYTES)
    expect(prepared.quality).toBe(JPEG_QUALITY_STEPS[JPEG_QUALITY_STEPS.length - 1])
    expect(prepared.width).toBe(env.surfaces[env.surfaces.length - 1].width)
  })

  it('refuses an image that cannot be brought under the hard cap', async () => {
    const env = fakeEnvironment({ width: 4000, height: 3000 }, () => MAX_PREPARED_IMAGE_BYTES + 1)
    await expectCode(prepareImageForUpload(makeFile(JPEG_HEADER), { environment: env }), 'output_too_large')
    expect(env.surfaces.length).toBeLessThanOrEqual(MAX_DOWNSCALE_ROUNDS + 1)
  })

  it('upscales an undersized image by default and rejects it when asked to', async () => {
    const upscaleEnv = fakeEnvironment({ width: 400, height: 300 }, () => 80_000)
    const prepared = await prepareImageForUpload(makeFile(JPEG_HEADER), { environment: upscaleEnv })
    expect(prepared).toMatchObject({ width: 683, height: 512 })

    const rejectEnv = fakeEnvironment({ width: 400, height: 300 }, () => 80_000)
    await expectCode(prepareImageForUpload(makeFile(JPEG_HEADER), { environment: rejectEnv, belowMinimum: 'reject' }), 'too_small')
    expect(rejectEnv.surfaces).toHaveLength(0)
    expect(rejectEnv.decodedReleases).toBe(1)
  })

  it('reports HEIC clearly instead of attempting to decode it', async () => {
    const env = fakeEnvironment({ width: 4000, height: 3000 }, () => 100)
    await expectCode(prepareImageForUpload(makeFile(ftypHeader('heic'), { name: 'IMG_1.HEIC', type: 'image/heic' }), { environment: env }), 'heic_unsupported')
    // A HEIC file mislabelled as JPEG is still recognised from its bytes.
    await expectCode(prepareImageForUpload(makeFile(ftypHeader('heix'), { name: 'IMG_2.jpg', type: 'image/jpeg' }), { environment: env }), 'heic_unsupported')
    // Unknown bytes with a HEIC name or type get the same clear message.
    await expectCode(prepareImageForUpload(makeFile([1, 2, 3, 4], { name: 'IMG_3.heif', type: '' }), { environment: env }), 'heic_unsupported')
    expect(env.surfaces).toHaveLength(0)
    expect(imagePreparationMessage(new ImagePreparationError('heic_unsupported'))).toMatch(/HEIC and HEIF photos are not supported/)
  })

  it('rejects other unsupported formats without decoding', async () => {
    const env = fakeEnvironment({ width: 4000, height: 3000 }, () => 100)
    await expectCode(prepareImageForUpload(makeFile([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], { name: 'a.gif', type: 'image/gif' }), { environment: env }), 'unsupported_format')
    await expectCode(prepareImageForUpload(makeFile(ftypHeader('avif'), { name: 'a.avif', type: 'image/avif' }), { environment: env }), 'unsupported_format')
    await expectCode(prepareImageForUpload(makeFile([0x25, 0x50, 0x44, 0x46], { name: 'a.jpg', type: 'image/jpeg' }), { environment: env }), 'unsupported_format')
    expect(env.surfaces).toHaveLength(0)
  })

  it('rejects empty and oversized source files before decoding', async () => {
    const env = fakeEnvironment({ width: 4000, height: 3000 }, () => 100)
    await expectCode(prepareImageForUpload(new File([], 'empty.jpg', { type: 'image/jpeg' }), { environment: env }), 'empty_file')
    await expectCode(prepareImageForUpload(makeFile(JPEG_HEADER, { size: MAX_SOURCE_BYTES + 1 }), { environment: env }), 'source_too_large')
    expect(env.surfaces).toHaveLength(0)
  })

  it('reports a decode failure for a damaged image', async () => {
    const env = fakeEnvironment({ width: 0, height: 0 }, () => 100, { decodeFails: true })
    await expectCode(prepareImageForUpload(makeFile(JPEG_HEADER), { environment: env }), 'decode_failed')

    const zeroSized = fakeEnvironment({ width: 0, height: 0 }, () => 100)
    await expectCode(prepareImageForUpload(makeFile(JPEG_HEADER), { environment: zeroSized }), 'decode_failed')
    expect(zeroSized.decodedReleases).toBe(1)
  })

  it('fails rather than uploading a non-JPEG when the browser cannot encode JPEG', async () => {
    const pngFallback = fakeEnvironment({ width: 1000, height: 1000 }, () => 100_000, { outputType: 'image/png' })
    await expectCode(prepareImageForUpload(makeFile(JPEG_HEADER), { environment: pngFallback }), 'encode_failed')

    const noBlob = fakeEnvironment({ width: 1000, height: 1000 }, () => 100_000, { nullBlob: true })
    await expectCode(prepareImageForUpload(makeFile(JPEG_HEADER), { environment: noBlob }), 'encode_failed')
  })

  it('releases the decoded image and every canvas on success', async () => {
    const env = fakeEnvironment({ width: 4000, height: 3000 }, (width) => (width >= 1536 ? 1_400_000 : 600_000))
    await prepareImageForUpload(makeFile(JPEG_HEADER), { environment: env })
    expect(env.decodedReleases).toBe(1)
    expect(env.surfaces.every((surface) => surface.released >= 1)).toBe(true)
  })

  it('releases the decoded image and the canvas when drawing or encoding fails', async () => {
    const drawFails = fakeEnvironment({ width: 2000, height: 2000 }, () => 100, { drawThrows: true })
    await expectCode(prepareImageForUpload(makeFile(JPEG_HEADER), { environment: drawFails }), 'encode_failed')
    expect(drawFails.decodedReleases).toBe(1)
    expect(drawFails.surfaces[0].released).toBeGreaterThanOrEqual(1)

    const encodeFails = fakeEnvironment({ width: 2000, height: 2000 }, () => 100, { nullBlob: true })
    await expectCode(prepareImageForUpload(makeFile(JPEG_HEADER), { environment: encodeFails }), 'encode_failed')
    expect(encodeFails.decodedReleases).toBe(1)
    expect(encodeFails.surfaces[0].released).toBeGreaterThanOrEqual(1)
  })

  it('stops without encoding when cancelled before it starts', async () => {
    const env = fakeEnvironment({ width: 2000, height: 2000 }, () => 100)
    const controller = new AbortController()
    controller.abort()
    await expectCode(prepareImageForUpload(makeFile(JPEG_HEADER), { environment: env, signal: controller.signal }), 'aborted')
    expect(env.surfaces).toHaveLength(0)
  })

  it('stops and cleans up when cancelled during encoding', async () => {
    const controller = new AbortController()
    const env = fakeEnvironment({ width: 4000, height: 3000 }, () => {
      controller.abort()
      return 1_500_000
    })
    await expectCode(prepareImageForUpload(makeFile(JPEG_HEADER), { environment: env, signal: controller.signal }), 'aborted')
    expect(env.surfaces[0].qualities).toHaveLength(1)
    expect(env.decodedReleases).toBe(1)
    expect(env.surfaces[0].released).toBeGreaterThanOrEqual(1)
  })

  it('exposes limits consistent with the server validation', () => {
    expect(MAX_LONG_EDGE_PX).toBe(1536)
    expect(MIN_DIMENSION_PX).toBe(512)
    // The server accepts up to 10 MB per image; a prepared image is always far below that.
    expect(MAX_PREPARED_IMAGE_BYTES).toBeLessThan(10 * 1024 * 1024)
  })
})
