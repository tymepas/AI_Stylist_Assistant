/**
 * Characterisation tests for upload and request-field validation.
 * Covers the JPEG and WebP header parsers (previously untested) and the
 * style-profile parser. Pins only behaviour that is expected to remain.
 */

import { describe, expect, it } from '@jest/globals'
import { parseStyleProfile, validateImageFile, validateImageMeta } from '@/lib/services/analysisService'
import { makeJpeg, makePng, makeWebpVP8, makeWebpVP8L, makeWebpVP8X } from '../helpers/fixtures'

describe('validateImageFile — JPEG', () => {
  it('accepts a baseline JPEG at the 512×512 minimum', async () => {
    await expect(validateImageFile(makeJpeg(512, 512))).resolves.toEqual({ valid: true })
  })

  it('accepts a progressive JPEG (SOF2) after an APP0 segment', async () => {
    await expect(validateImageFile(makeJpeg(1024, 768, { sofMarker: 0xc2, withApp0: true }))).resolves.toEqual({ valid: true })
  })

  it('rejects a JPEG smaller than 512 px on either side', async () => {
    await expect(validateImageFile(makeJpeg(511, 900))).resolves.toEqual({ valid: false, message: 'Image must be at least 512×512 pixels.' })
    await expect(validateImageFile(makeJpeg(900, 511))).resolves.toMatchObject({ valid: false })
  })

  it('rejects bytes with no start-of-frame marker', async () => {
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9, 0, 0, 0, 0, 0, 0, 0, 0])], 'x.jpg', { type: 'image/jpeg' })
    await expect(validateImageFile(file)).resolves.toEqual({ valid: false, message: 'The uploaded file is not a valid JPEG, PNG, or WEBP image.' })
  })
})

describe('validateImageFile — WebP', () => {
  it.each([
    ['VP8X', makeWebpVP8X],
    ['VP8 (lossy)', makeWebpVP8],
    ['VP8L (lossless)', makeWebpVP8L],
  ] as const)('accepts %s at 800×600', async (_label, make) => {
    await expect(validateImageFile(make(800, 600))).resolves.toEqual({ valid: true })
  })

  it.each([
    ['VP8X', makeWebpVP8X],
    ['VP8 (lossy)', makeWebpVP8],
    ['VP8L (lossless)', makeWebpVP8L],
  ] as const)('rejects %s below the minimum size', async (_label, make) => {
    await expect(validateImageFile(make(400, 800))).resolves.toMatchObject({ valid: false, message: 'Image must be at least 512×512 pixels.' })
  })
})

describe('validateImageFile — type and content consistency', () => {
  it('rejects PNG bytes declared as JPEG', async () => {
    const png = makePng(800, 800)
    const mislabelled = new File([await png.arrayBuffer()], 'x.jpg', { type: 'image/jpeg' })
    await expect(validateImageFile(mislabelled)).resolves.toMatchObject({ valid: false })
  })

  it('rejects a GIF content type before reading bytes', async () => {
    const gif = new File([new Uint8Array([0x47, 0x49, 0x46])], 'x.gif', { type: 'image/gif' })
    await expect(validateImageFile(gif)).resolves.toEqual({ valid: false, message: 'Please upload a JPEG, PNG, or WEBP image.' })
  })
})

describe('validateImageMeta — size limits', () => {
  it('accepts exactly 10 MB and rejects one byte more', () => {
    const tenMb = 10 * 1024 * 1024
    expect(validateImageMeta({ name: 'a.jpg', type: 'image/jpeg', size: tenMb })).toEqual({ valid: true })
    expect(validateImageMeta({ name: 'a.jpg', type: 'image/jpeg', size: tenMb + 1 })).toEqual({ valid: false, message: 'Image must be smaller than 10MB.' })
  })
})

describe('parseStyleProfile', () => {
  it.each([null, undefined, ''])('treats %j as an empty profile', (value) => {
    expect(parseStyleProfile(value)).toEqual({ valid: true, profile: { preferredStyles: [], favoriteColors: [], occasionPreferences: [] } })
  })

  it('accepts a well-formed profile', () => {
    const profile = { preferredStyles: ['Classic'], favoriteColors: ['Navy'], occasionPreferences: ['Office Work'] }
    expect(parseStyleProfile(JSON.stringify(profile))).toEqual({ valid: true, profile })
  })

  it.each([
    ['malformed JSON', '{not json'],
    ['a JSON array', '[]'],
    ['missing favoriteColors', JSON.stringify({ preferredStyles: [], occasionPreferences: [] })],
    ['non-string array items', JSON.stringify({ preferredStyles: [1], favoriteColors: [], occasionPreferences: [] })],
  ])('rejects %s', (_label, value) => {
    expect(parseStyleProfile(value)).toEqual({ valid: false, profile: { preferredStyles: [], favoriteColors: [], occasionPreferences: [] }, message: 'Style profile data is invalid.' })
  })

  it('rejects a non-string value such as an uploaded file', () => {
    expect(parseStyleProfile(makePng())).toMatchObject({ valid: false })
  })
})
