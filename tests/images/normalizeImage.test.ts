/**
 * Server-side image normalisation, exercised with synthetic images only.
 * Every image here is generated in the test; no photograph is used.
 */

import { afterEach, describe, expect, it, jest } from '@jest/globals'
import fs from 'node:fs'
import os from 'node:os'
import sharp, { type Sharp } from 'sharp'

jest.mock('server-only', () => ({}), { virtual: true })

import {
  ImageNormalizationError,
  MAX_IMAGE_PIXELS,
  MAX_IMAGE_SIDE_PX,
  NORMALIZED_LONG_EDGE_PX,
  normalizeImage,
} from '@/lib/images/normalizeImage'

type Format = 'jpeg' | 'png' | 'webp'
const TYPE: Record<Format, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

/** A solid-colour image with a darker left half, so that rotation is visible in the pixels. */
async function picture(width: number, height: number, format: Format, change: (image: Sharp) => Sharp = (image) => image): Promise<Buffer> {
  const left = await sharp({ create: { width: Math.floor(width / 2), height, channels: 3, background: { r: 20, g: 20, b: 20 } } }).png().toBuffer()
  const base = sharp({ create: { width, height, channels: 3, background: { r: 230, g: 230, b: 230 } } }).composite([{ input: left, left: 0, top: 0 }])
  return change(base).toFormat(format).toBuffer()
}

const asFile = (bytes: Buffer, type: string, name = 'upload') => new File([new Uint8Array(bytes)], name, { type })

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
    return 'no error'
  } catch (error) {
    return error instanceof ImageNormalizationError ? error.code : `unexpected: ${String(error)}`
  }
}

afterEach(() => { jest.restoreAllMocks() })

describe('supported formats', () => {
  it.each(['jpeg', 'png', 'webp'] as const)('re-encodes %s as JPEG and keeps its size', async (format) => {
    const result = await normalizeImage(asFile(await picture(800, 600, format), TYPE[format]))
    expect(result.file.type).toBe('image/jpeg')
    expect(result.file.name).toBe('image.jpg')
    expect([result.width, result.height, result.resized]).toEqual([800, 600, false])
    const metadata = await sharp(Buffer.from(await result.file.arrayBuffer())).metadata()
    expect([metadata.format, metadata.width, metadata.height]).toEqual(['jpeg', 800, 600])
  })

  it('never returns the bytes it was given, even for a JPEG that needs no change', async () => {
    const input = await picture(800, 600, 'jpeg')
    const result = await normalizeImage(asFile(input, 'image/jpeg'))
    expect(Buffer.from(await result.file.arrayBuffer()).equals(input)).toBe(false)
  })
})

describe('size', () => {
  it('scales a large image down to the long edge and keeps the aspect ratio', async () => {
    const result = await normalizeImage(asFile(await picture(3000, 2000, 'jpeg'), 'image/jpeg'))
    expect([result.width, result.height, result.resized]).toEqual([NORMALIZED_LONG_EDGE_PX, 1024, true])
  })

  it('never enlarges a small image', async () => {
    const result = await normalizeImage(asFile(await picture(600, 512, 'png'), 'image/png'))
    expect([result.width, result.height, result.resized]).toEqual([600, 512, false])
  })

  it('refuses an image with too many pixels before decoding it', async () => {
    // 5,000 x 4,000 = 20 megapixels. A solid colour compresses to a few kilobytes: a decompression bomb in miniature.
    const bomb = await sharp({ create: { width: 5000, height: 4000, channels: 3, background: '#808080' } }).png().toBuffer()
    expect(bomb.byteLength).toBeLessThan(200_000)
    expect(5000 * 4000).toBeGreaterThan(MAX_IMAGE_PIXELS)
    expect(await codeOf(normalizeImage(asFile(bomb, 'image/png')))).toBe('too_many_pixels')
  })

  it('refuses an image with one side above the limit', async () => {
    const strip = await sharp({ create: { width: MAX_IMAGE_SIDE_PX + 8, height: 600, channels: 3, background: '#808080' } }).png().toBuffer()
    expect(await codeOf(normalizeImage(asFile(strip, 'image/png')))).toBe('too_many_pixels')
  })

  it('accepts an image exactly at the side limit', async () => {
    const strip = await sharp({ create: { width: MAX_IMAGE_SIDE_PX, height: 600, channels: 3, background: '#808080' } }).png().toBuffer()
    const result = await normalizeImage(asFile(strip, 'image/png'))
    expect(result.width).toBe(NORMALIZED_LONG_EDGE_PX)
  })
})

describe('orientation', () => {
  it('applies the EXIF orientation and then drops the tag', async () => {
    // Orientation 6: the stored pixels must be turned 90 degrees clockwise to be upright.
    const stored = await picture(800, 600, 'jpeg', (image) => image.withMetadata({ orientation: 6 }))
    expect((await sharp(stored).metadata()).orientation).toBe(6)

    const result = await normalizeImage(asFile(stored, 'image/jpeg'))
    expect([result.width, result.height]).toEqual([600, 800])
    const output = Buffer.from(await result.file.arrayBuffer())
    expect((await sharp(output).metadata()).orientation).toBeUndefined()

    // The dark half was on the left of the stored image; turned clockwise it is now at the top.
    const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true })
    const pixel = (x: number, y: number) => data[(y * info.width + x) * info.channels]
    expect(pixel(300, 100)).toBeLessThan(60)
    expect(pixel(300, 700)).toBeGreaterThan(200)
  })

  it('leaves an image without an orientation tag as it is', async () => {
    const result = await normalizeImage(asFile(await picture(800, 600, 'jpeg'), 'image/jpeg'))
    expect([result.width, result.height]).toEqual([800, 600])
  })
})

describe('metadata', () => {
  it('strips EXIF, including text fields and GPS data, and the colour profile', async () => {
    const tagged = await picture(800, 600, 'jpeg', (image) => image
      .withExif({ IFD0: { Copyright: 'PRIVATE-OWNER-NAME', ImageDescription: 'PRIVATE-DESCRIPTION' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1' } })
      .withIccProfile('p3'))
    const before = await sharp(tagged).metadata()
    expect(before.exif).toBeDefined()
    expect(before.icc).toBeDefined()
    expect(tagged.includes('PRIVATE-OWNER-NAME')).toBe(true)

    const output = Buffer.from(await (await normalizeImage(asFile(tagged, 'image/jpeg'))).file.arrayBuffer())
    const after = await sharp(output).metadata()
    expect([after.exif, after.icc, after.xmp, after.iptc]).toEqual([undefined, undefined, undefined, undefined])
    expect(output.includes('PRIVATE-OWNER-NAME')).toBe(false)
    expect(output.includes('PRIVATE-DESCRIPTION')).toBe(false)
    expect(output.includes('Exif')).toBe(false)
  })

  it('strips text chunks from a PNG', async () => {
    const tagged = await picture(600, 600, 'png', (image) => image.withExif({ IFD0: { Copyright: 'PRIVATE-OWNER-NAME' } }))
    const output = Buffer.from(await (await normalizeImage(asFile(tagged, 'image/png'))).file.arrayBuffer())
    expect(output.includes('PRIVATE-OWNER-NAME')).toBe(false)
  })

  it('flattens transparency onto white', async () => {
    const transparent = await sharp({ create: { width: 600, height: 600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer()
    const output = Buffer.from(await (await normalizeImage(asFile(transparent, 'image/png'))).file.arrayBuffer())
    const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true })
    expect(info.channels).toBe(3)
    expect([data[0], data[1], data[2]].every((value) => value > 245)).toBe(true)
  })
})

describe('content validation', () => {
  it('refuses a file whose content does not match its declared type', async () => {
    const png = await picture(600, 600, 'png')
    expect(await codeOf(normalizeImage(asFile(png, 'image/jpeg', 'photo.jpg')))).toBe('type_mismatch')
    const jpeg = await picture(600, 600, 'jpeg')
    expect(await codeOf(normalizeImage(asFile(jpeg, 'image/webp')))).toBe('type_mismatch')
  })

  it('refuses unsupported formats, whatever type or name they claim', async () => {
    const gif = await sharp({ create: { width: 600, height: 600, channels: 3, background: '#808080' } }).gif().toBuffer()
    expect(await codeOf(normalizeImage(asFile(gif, 'image/gif')))).toBe('unsupported_format')
    expect(await codeOf(normalizeImage(asFile(gif, 'image/png', 'photo.png')))).toBe('unsupported_format')
    expect(await codeOf(normalizeImage(asFile(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml')))).toBe('unsupported_format')
    expect(await codeOf(normalizeImage(asFile(Buffer.from('%PDF-1.7 not an image'), 'image/jpeg')))).toBe('unsupported_format')
    expect(await codeOf(normalizeImage(asFile(Buffer.alloc(0), 'image/png')))).toBe('unsupported_format')
  })

  it('refuses a file that only has a valid header', async () => {
    // The 33-byte "PNG" the header check used to accept: a signature and an IHDR, and no image data.
    const header = Buffer.alloc(33)
    header.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    header.writeUInt32BE(13, 8)
    header.set([0x49, 0x48, 0x44, 0x52], 12)
    header.writeUInt32BE(800, 16)
    header.writeUInt32BE(800, 20)
    expect(await codeOf(normalizeImage(asFile(header, 'image/png')))).toBe('decode_failed')
  })

  it.each(['jpeg', 'png', 'webp'] as const)('refuses a truncated %s', async (format) => {
    const whole = await picture(800, 600, format, (image) => image.blur(3))
    const truncated = whole.subarray(0, Math.floor(whole.byteLength / 2))
    expect(await codeOf(normalizeImage(asFile(truncated, TYPE[format])))).toBe('decode_failed')
  })

  it('refuses a corrupted image body', async () => {
    const corrupted = Buffer.from(await picture(800, 600, 'png'))
    corrupted.fill(0xff, 60, corrupted.byteLength - 20)
    expect(await codeOf(normalizeImage(asFile(corrupted, 'image/png')))).toBe('decode_failed')
  })

  it('gives messages that are safe to show and reveal nothing about the file', async () => {
    try {
      await normalizeImage(asFile(Buffer.from('%PDF-1.7 SECRET-CONTENT'), 'image/jpeg', 'SECRET-NAME.jpg'))
      throw new Error('expected a rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(ImageNormalizationError)
      expect((error as Error).message).toBe('Please upload a JPEG, PNG, or WEBP image.')
      expect((error as Error).message).not.toMatch(/SECRET/)
    }
  })
})

describe('no retention', () => {
  it('writes no file while processing, including when it fails', async () => {
    const writers = [
      jest.spyOn(fs, 'writeFileSync'),
      jest.spyOn(fs, 'writeFile'),
      jest.spyOn(fs, 'mkdtempSync'),
      jest.spyOn(fs, 'createWriteStream'),
      jest.spyOn(fs.promises, 'writeFile'),
      jest.spyOn(fs.promises, 'mkdtemp'),
    ]
    const temporary = () => fs.readdirSync(os.tmpdir()).filter((name) => /^(vips|sharp)/i.test(name)).sort()
    const before = temporary()

    await normalizeImage(asFile(await picture(3000, 2000, 'jpeg'), 'image/jpeg'))
    await codeOf(normalizeImage(asFile(Buffer.from('not an image'), 'image/png')))

    for (const writer of writers) expect(writer).not.toHaveBeenCalled()
    expect(temporary()).toEqual(before)
  })

  it('gives each call its own result and keeps no state between calls', async () => {
    const first = await normalizeImage(asFile(await picture(800, 600, 'jpeg'), 'image/jpeg'), 'photo.jpg')
    const second = await normalizeImage(asFile(await picture(600, 800, 'png'), 'image/png'), 'garment.jpg')
    expect([first.file.name, first.width, first.height]).toEqual(['photo.jpg', 800, 600])
    expect([second.file.name, second.width, second.height]).toEqual(['garment.jpg', 600, 800])
    expect(sharp.cache().memory.max).toBe(0)
  })
})
