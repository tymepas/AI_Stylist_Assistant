/**
 * Image intake and multiple garment images, exercised through the real API route.
 *
 * Covers what the route refuses before any spend reservation or model call,
 * what it actually sends to the model provider, both multi-image garment modes,
 * and that a single-garment request is unchanged. OpenAI is mocked; no network
 * call is made. Every image is synthetic.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import sharp from 'sharp'

jest.mock('server-only', () => ({}), { virtual: true })

import { POST } from '@/app/api/[[...path]]/route'
import * as normalizer from '@/lib/images/normalizeImage'
import { MAX_REQUEST_BYTES } from '@/lib/images/normalizeImage'
import { estimateMaxCostMicroUsd, resolveModelConfig } from '@/lib/services/openai/modelConfig'
import { allRated, makeDimensions, makeHeaderOnlyPng, makePng, openAIResponse } from '../helpers/fixtures'
import { installMemorySpendStore } from '../helpers/memorySpendStore'
import { setSpendStoreForTesting } from '@/lib/spend/spendGuard'

const originalEnv = { ...process.env }
const STYLE_PROFILE = JSON.stringify({ preferredStyles: [], favoriteColors: [], occasionPreferences: [] })

type Field = string | File
function form(fields: Array<[string, Field]>): FormData {
  const data = new FormData()
  for (const [key, value] of fields) data.append(key, value)
  return data
}

/** An analysis form. `garments` are appended in order under the repeated field `garment`. */
function analyzeForm(options: { photo?: File; garments?: File[]; mode?: string | null; extra?: Array<[string, Field]> } = {}): FormData {
  const garments = options.garments ?? [makePng(800, 800, 'garment.png', 90)]
  return form([
    ['occasion', 'Client Presentation'],
    ['photo', options.photo ?? makePng(800, 800, 'photo.png', 200)],
    ...garments.map((garment): [string, Field] => ['garment', garment]),
    ['styleProfile', STYLE_PROFILE],
    ...(options.mode ? [['garmentMode', options.mode] as [string, Field]] : []),
    ...(options.extra ?? []),
  ])
}

function post(path: 'analyze' | 'generate-profile', body: FormData, headers: Record<string, string> = {}) {
  return POST(new Request(`http://localhost/api/${path}`, { method: 'POST', body, headers }), { params: Promise.resolve({ path: [path] }) })
}

const garment = (shade: number, name = `garment-${shade}.png`) => makePng(800, 800, name, shade)
const goodAnalysis = (extra: Record<string, unknown> = {}) => openAIResponse({ status: 'complete', dimensions: allRated('Good'), ...extra }, { usage: { input_tokens: 1, output_tokens: 1 } })

interface SentRequest { input: Array<{ content: Array<{ type: string; text?: string; image_url?: string }> }> }
function sentContent(fetchMock: jest.SpiedFunction<typeof fetch>) {
  const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as SentRequest
  return body.input[0].content
}

let fetchMock: jest.SpiedFunction<typeof fetch>

beforeEach(() => {
  process.env = { ...originalEnv, ANALYSIS_MODE: 'openai', OPENAI_API_KEY: 'sk-test-fake-key-intake-0000', OPENAI_MODEL: 'gpt-6.1-terra' }
  for (const method of ['info', 'warn', 'error'] as const) jest.spyOn(console, method).mockImplementation(() => undefined)
  fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async () => goodAnalysis())
})

afterEach(() => {
  process.env = { ...originalEnv }
  setSpendStoreForTesting(undefined)
  jest.restoreAllMocks()
})

describe('uploads the API refuses before any model call', () => {
  it('refuses a file that only has a valid image header', async () => {
    const response = await post('analyze', analyzeForm({ photo: makeHeaderOnlyPng(800, 800, 'photo.png') }))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_upload', message: 'Personal photo: The uploaded file is not a valid JPEG, PNG, or WEBP image.' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a file whose content does not match its declared type', async () => {
    const jpegBytes = await sharp({ create: { width: 800, height: 800, channels: 3, background: '#808080' } }).jpeg().toBuffer()
    const response = await post('analyze', analyzeForm({ garments: [new File([new Uint8Array(jpegBytes)], 'garment.webp', { type: 'image/webp' })] }))
    expect(response.status).toBe(400)
    expect((await response.json()).message).toMatch(/^Garment photo: /)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses an unsupported format even when it claims a supported type', async () => {
    const gif = await sharp({ create: { width: 800, height: 800, channels: 3, background: '#808080' } }).gif().toBuffer()
    const response = await post('analyze', analyzeForm({ garments: [new File([new Uint8Array(gif)], 'garment.png', { type: 'image/png' })] }))
    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a truncated image', async () => {
    const whole = await sharp({ create: { width: 800, height: 800, channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 128, sigma: 30 } } }).jpeg().toBuffer()
    const response = await post('analyze', analyzeForm({ photo: new File([new Uint8Array(whole.subarray(0, whole.byteLength / 2))], 'photo.jpg', { type: 'image/jpeg' }) }))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_upload', message: 'Personal photo: The uploaded file is not a valid JPEG, PNG, or WEBP image.' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a decompression bomb: few bytes, too many pixels', async () => {
    const bomb = await sharp({ create: { width: 5000, height: 4000, channels: 3, background: '#808080' } }).png().toBuffer()
    const response = await post('analyze', analyzeForm({ garments: [new File([new Uint8Array(bomb)], 'garment.png', { type: 'image/png' })] }))
    expect(response.status).toBe(400)
    expect((await response.json()).message).toMatch(/^Garment photo: Image is too large/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a request whose declared size is above the limit, without reading the body', async () => {
    const body = analyzeForm()
    const formDataSpy = jest.spyOn(Request.prototype, 'formData')
    const response = await post('analyze', body, { 'content-length': String(MAX_REQUEST_BYTES + 1) })
    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toMatchObject({ error: 'payload_too_large' })
    expect(formDataSpy).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses images that together exceed the limit, whatever the declared size', async () => {
    const big = (name: string) => new File([new Uint8Array(2_400_000)], name, { type: 'image/png' })
    const response = await post('analyze', analyzeForm({ photo: big('photo.png'), garments: [big('garment.png')] }))
    expect(response.status).toBe(413)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('applies the same intake to the Style DNA photo', async () => {
    const tooLarge = await post('generate-profile', form([['photo', makePng()]]), { 'content-length': String(MAX_REQUEST_BYTES + 1) })
    expect(tooLarge.status).toBe(413)
    const headerOnly = await post('generate-profile', form([['photo', makeHeaderOnlyPng()]]))
    expect(headerOnly.status).toBe(400)
    await expect(headerOnly.json()).resolves.toEqual({ error: 'invalid_upload', message: 'The uploaded file is not a valid JPEG, PNG, or WEBP image.' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails safely when image processing itself breaks: no model call and no original bytes', async () => {
    jest.spyOn(normalizer, 'normalizeImage').mockRejectedValue(new Error('simulated native failure'))
    const response = await post('analyze', analyzeForm())
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_upload', message: 'Personal photo: The uploaded file could not be processed as an image.' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reserves no budget for a refused upload', async () => {
    const store = await installMemorySpendStore()
    await post('analyze', analyzeForm({ photo: makeHeaderOnlyPng(800, 800, 'photo.png') }))
    expect(store.spentTotal()).toBe(0)
    expect(store.leases.size).toBe(0)
  })
})

describe('what is sent to the model provider', () => {
  it('sends re-encoded JPEGs, never the uploaded bytes', async () => {
    const response = await post('analyze', analyzeForm())
    expect(response.status).toBe(200)
    const images = sentContent(fetchMock).filter((part) => part.type === 'input_image').map((part) => part.image_url as string)
    expect(images).toHaveLength(2)
    for (const image of images) {
      expect(image.startsWith('data:image/jpeg;base64,/9j/')).toBe(true)
      expect(image).not.toContain('iVBORw0KGgo') // the PNG signature in base64
      const decoded = await sharp(Buffer.from(image.split(',')[1], 'base64')).metadata()
      expect([decoded.format, decoded.width, decoded.height]).toEqual(['jpeg', 800, 800])
    }
  })

  it('removes EXIF data, including text and location, before sending', async () => {
    const tagged = await sharp({ create: { width: 800, height: 800, channels: 3, background: '#a0a0a0' } })
      .withExif({ IFD0: { Copyright: 'PRIVATE-OWNER-NAME' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1' } })
      .jpeg()
      .toBuffer()
    expect(tagged.includes('PRIVATE-OWNER-NAME')).toBe(true)

    await post('analyze', analyzeForm({ photo: new File([new Uint8Array(tagged)], 'photo.jpg', { type: 'image/jpeg' }) }))
    const photo = sentContent(fetchMock).find((part) => part.type === 'input_image')!.image_url as string
    const bytes = Buffer.from(photo.split(',')[1], 'base64')
    expect(bytes.includes('PRIVATE-OWNER-NAME')).toBe(false)
    expect((await sharp(bytes).metadata()).exif).toBeUndefined()
  })

  it('applies the EXIF orientation, so the model sees the photo upright', async () => {
    const sideways = await sharp({ create: { width: 1000, height: 600, channels: 3, background: '#a0a0a0' } }).withMetadata({ orientation: 6 }).jpeg().toBuffer()
    await post('analyze', analyzeForm({ photo: new File([new Uint8Array(sideways)], 'photo.jpg', { type: 'image/jpeg' }) }))
    const photo = sentContent(fetchMock).find((part) => part.type === 'input_image')!.image_url as string
    const metadata = await sharp(Buffer.from(photo.split(',')[1], 'base64')).metadata()
    expect([metadata.width, metadata.height, metadata.orientation]).toEqual([600, 1000, undefined])
  })

  it('scales an oversized photo down before sending', async () => {
    const large = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#a0a0a0' } }).jpeg().toBuffer()
    await post('analyze', analyzeForm({ photo: new File([new Uint8Array(large)], 'photo.jpg', { type: 'image/jpeg' }) }))
    const photo = sentContent(fetchMock).find((part) => part.type === 'input_image')!.image_url as string
    const metadata = await sharp(Buffer.from(photo.split(',')[1], 'base64')).metadata()
    expect([metadata.width, metadata.height]).toEqual([1536, 1024])
  })
})

describe('a single garment image (the request every existing client sends)', () => {
  it('works without a garment mode and returns the response shape it always had, plus the two informational blocks', async () => {
    const response = await post('analyze', analyzeForm())
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ status: 'complete', overall_recommendation: 'Recommended', verdict_score: 4 })
    // analysis-output/3 adds `observations` and `evidence`. Both are informational and never part of the verdict.
    expect(Object.keys(body).sort()).toEqual(['analysis_based_on', 'dimensions', 'evidence', 'next_step', 'observations', 'overall_recommendation', 'shopping_advisor', 'status', 'things_to_consider', 'verdict_score'])
  })

  it('accepts the explicit mode "single" with the same result', async () => {
    const body = await (await post('analyze', analyzeForm({ mode: 'single' }))).json()
    expect(body.garment_mode).toBeUndefined()
    expect(body.outfit_components).toBeUndefined()
  })

  it('sends the same message structure, with the garment image numbered and the mode named', async () => {
    await post('analyze', analyzeForm())
    const content = sentContent(fetchMock)
    expect(content.map((part) => part.type)).toEqual(['input_text', 'input_text', 'input_image', 'input_text', 'input_image'])
    expect([content[1].text, content[3].text]).toEqual(['Person image:', 'Garment image 1:'])
    expect(content[0].text).toMatch(/^Image mode: single\. Garment image 1 shows one garment\./)
    expect(content[0].text).not.toMatch(/outfit_components|include views/)
  })
})

describe('garment mode and image count must agree', () => {
  it.each([
    ['two images without a mode', [garment(60), garment(70)], null, /One garment photo is expected/],
    ['two images in single mode', [garment(60), garment(70)], 'single', /One garment photo is expected/],
    ['one image as views of one garment', [garment(60)], 'same_garment_views', /at least two views/],
    ['one image as outfit items', [garment(60)], 'outfit_items', /at least two outfit items/],
    ['four images', [garment(60), garment(70), garment(80), garment(90)], 'outfit_items', /up to 3 garment photos/],
    ['an unknown mode', [garment(60), garment(70)], 'automatic', /Please choose how your garment photos relate/],
  ] as const)('refuses %s', async (_label, garments, mode, message) => {
    const response = await post('analyze', analyzeForm({ garments: [...garments], mode }))
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('invalid_upload')
    expect(body.message).toMatch(message)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never switches mode or drops an image to make a request fit', async () => {
    // Three images in a mode that takes one: an error, not a silent downgrade to the first image.
    const response = await post('analyze', analyzeForm({ garments: [garment(60), garment(70), garment(80)], mode: 'single' }))
    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a garment field that is not a file', async () => {
    const response = await post('analyze', analyzeForm({ garments: [garment(60)], mode: 'same_garment_views', extra: [['garment', 'not-a-file']] }))
    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses the same garment photo twice and says which one', async () => {
    const response = await post('analyze', analyzeForm({ garments: [garment(60, 'front.png'), garment(70, 'back.png'), garment(60, 'copy.png')], mode: 'same_garment_views' }))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_upload', message: 'Garment photo 3 is the same file as an earlier garment photo. Please remove it or choose a different photo.' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('names the garment photo that is invalid', async () => {
    const response = await post('analyze', analyzeForm({ garments: [garment(60), makeHeaderOnlyPng(800, 800, 'second.png')], mode: 'outfit_items' }))
    expect(response.status).toBe(400)
    expect((await response.json()).message).toMatch(/^Garment photo 2: /)
  })
})

describe('views of one garment', () => {
  it('sends every view, in order, labelled as views of the same garment', async () => {
    const response = await post('analyze', analyzeForm({ garments: [garment(60), garment(70), garment(80)], mode: 'same_garment_views' }))
    expect(response.status).toBe(200)
    const content = sentContent(fetchMock)
    expect(content.filter((part) => part.type === 'input_image')).toHaveLength(4)
    expect(content.filter((part) => part.type === 'input_text').map((part) => part.text).slice(1)).toEqual([
      'Person image:',
      'Garment image 1 of 3 (view):',
      'Garment image 2 of 3 (view):',
      'Garment image 3 of 3 (view):',
    ])
    expect(content[0].text).toMatch(/^Image mode: same_garment_views\. Garment images 1 to 3 are views of ONE garment; include views\./)
    expect(content[0].text).not.toMatch(/outfit_components/)
  })

  it('reports the mode in the result and has no per-item notes', async () => {
    const body = await (await post('analyze', analyzeForm({ garments: [garment(60), garment(70)], mode: 'same_garment_views' }))).json()
    expect(body.garment_mode).toBe('same_garment_views')
    expect(body.outfit_components).toBeUndefined()
  })

  it('ignores per-item notes if the model returns them anyway', async () => {
    fetchMock.mockImplementation(async () => goodAnalysis({ outfit_components: [{ item: 1, garment_type: 'top', assessment: 'Works', note: 'A note that does not belong here.' }, { item: 2, garment_type: 'bottom', assessment: 'Works', note: 'Another note that does not belong.' }] }))
    const body = await (await post('analyze', analyzeForm({ garments: [garment(60), garment(70)], mode: 'same_garment_views' }))).json()
    expect(body.outfit_components).toBeUndefined()
  })
})

describe('items of one outfit', () => {
  const components = [
    { item: 2, garment_type: 'bottom', assessment: 'Works', note: 'The trousers match the formality of the jacket.' },
    { item: 1, garment_type: 'top', assessment: 'Works well', note: 'The shirt anchors the outfit for this occasion.' },
    { item: 3, garment_type: 'outerwear', assessment: 'Needs attention', note: 'The jacket is more casual than the other items.' },
  ]
  const outfit = () => analyzeForm({ garments: [garment(60), garment(70), garment(80)], mode: 'outfit_items' })

  it('sends every item, in order, labelled as separate outfit items, and asks for per-item notes', async () => {
    await post('analyze', outfit())
    const content = sentContent(fetchMock)
    expect(content.filter((part) => part.type === 'input_text').map((part) => part.text).slice(1)).toEqual([
      'Person image:',
      'Garment image 1 of 3 (item):',
      'Garment image 2 of 3 (item):',
      'Garment image 3 of 3 (item):',
    ])
    expect(content[0].text).toMatch(/^Image mode: outfit_items\. Garment images 1 to 3 are 3 DIFFERENT items worn together; include outfit_components\./)
    expect((content[0].text as string).trim().endsWith('Return one JSON object only.')).toBe(true)
  })

  it('returns the per-item notes in image order, next to the verdict for the combined outfit', async () => {
    fetchMock.mockImplementation(async () => goodAnalysis({ outfit_components: components }))
    const body = await (await post('analyze', outfit())).json()
    expect(body).toMatchObject({ status: 'complete', garment_mode: 'outfit_items', overall_recommendation: 'Recommended', verdict_score: 4 })
    expect(body.outfit_components.availability).toBe('available')
    expect(body.outfit_components.items.map((entry: { item: number }) => entry.item)).toEqual([1, 2, 3])
  })

  it.each([
    ['missing', undefined],
    ['not a list', 'three items'],
    ['too few entries', components.slice(0, 2)],
    ['an item described twice', [components[0], components[0], components[2]]],
    ['an unknown assessment', [{ ...components[0], assessment: 'Perfect' }, components[1], components[2]]],
    ['an entry that carries a verdict', [{ ...components[0], verdict: 'Highly Recommended' }, components[1], components[2]]],
  ])('withholds the notes when they are %s, and leaves the analysis and the verdict untouched', async (_label, value) => {
    fetchMock.mockImplementation(async () => goodAnalysis(value === undefined ? {} : { outfit_components: value }))
    const body = await (await post('analyze', outfit())).json()
    expect(body).toMatchObject({ status: 'complete', overall_recommendation: 'Recommended', verdict_score: 4 })
    expect(body.outfit_components).toEqual({ availability: 'unavailable', items: [] })
  })

  it('computes the verdict from the ratings only, whatever the notes say', async () => {
    const dimensions = makeDimensions({ occasion: 'Poor', formality: 'Poor', style_preference_match: 'Poor', color: 'Poor', seasonality: 'Poor' })
    const glowing = components.map((entry) => ({ ...entry, assessment: 'Works well', note: 'Everything about this item is ideal for the occasion.' }))
    fetchMock.mockImplementation(async () => openAIResponse({ status: 'complete', dimensions, outfit_components: glowing }))
    const body = await (await post('analyze', outfit())).json()
    expect(body).toMatchObject({ overall_recommendation: 'Not Recommended', verdict_score: 2 })
  })

  it('still rejects a response that states its own verdict', async () => {
    fetchMock.mockImplementation(async () => goodAnalysis({ outfit_components: components, overall_recommendation: 'Highly Recommended' }))
    const response = await post('analyze', outfit())
    expect(response.status).toBe(502)
  })
})

describe('spend protection with several images', () => {
  const reservation = (images: number) => estimateMaxCostMicroUsd(resolveModelConfig('gpt-6.1-terra')!, 'analysis', images)

  it('reserves for every image that is sent', async () => {
    let reserved = 0
    const store = await installMemorySpendStore()
    fetchMock.mockImplementation(async () => {
      reserved = [...store.leases.values()][0].amount
      return goodAnalysis()
    })

    await post('analyze', analyzeForm())
    expect(reserved).toBe(reservation(2))

    await post('analyze', analyzeForm({ garments: [garment(60), garment(70), garment(80)], mode: 'outfit_items' }))
    expect(reserved).toBe(reservation(4))
    expect(reservation(4)).toBeGreaterThan(reservation(2))
  })

  it('still fails closed with 503 when the budget store is missing in production', async () => {
    process.env = { ...process.env, NODE_ENV: 'production' }
    const response = await post('analyze', analyzeForm({ garments: [garment(60), garment(70)], mode: 'outfit_items' }))
    expect(response.status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('mock mode (Preview)', () => {
  beforeEach(() => {
    process.env = { ...originalEnv, ANALYSIS_MODE: 'mock' }
    jest.spyOn(global, 'setTimeout').mockImplementation((callback) => { if (typeof callback === 'function') callback(); return 0 as unknown as ReturnType<typeof setTimeout> })
    jest.spyOn(Math, 'random').mockReturnValue(0)
  })

  it('needs no model, no key and no budget store, for one or several garment images', async () => {
    const single = await post('analyze', analyzeForm())
    expect(single.status).toBe(200)
    const outfit = await post('analyze', analyzeForm({ garments: [garment(60), garment(70), garment(80)], mode: 'outfit_items' }))
    expect(outfit.status).toBe(200)
    const body = await outfit.json()
    expect(body.garment_mode).toBe('outfit_items')
    expect(body.outfit_components.items).toHaveLength(3)
    expect(body.outfit_components.items[0].note).toMatch(/mock mode: no image was analysed/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('validates uploads exactly as in live mode', async () => {
    const headerOnly = await post('analyze', analyzeForm({ garments: [makeHeaderOnlyPng(800, 800, 'garment.png')] }))
    expect(headerOnly.status).toBe(400)
    const mismatch = await post('analyze', analyzeForm({ garments: [garment(60)], mode: 'outfit_items' }))
    expect(mismatch.status).toBe(400)
  })
})
