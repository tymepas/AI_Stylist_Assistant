/**
 * Characterisation tests for the catch-all API route (app/api/[[...path]]/route.js).
 * Exercises real multipart requests against the exported handlers with OpenAI mocked.
 * No network calls are made.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'

jest.mock('server-only', () => ({}), { virtual: true })

import { GET, POST } from '@/app/api/[[...path]]/route'
import { abortError, allRated, makeDimensions, makePng, openAIResponse, VALID_RECOMMENDATION } from '../helpers/fixtures'
import { VALID_COMPLETE_PROFILE } from '../phase3/fixtures'

const originalEnv = { ...process.env }

function context(path: string) {
  return { params: Promise.resolve({ path: path.split('/').filter(Boolean) }) }
}

function analyzeForm(overrides: Record<string, string | File | null> = {}) {
  const fields: Record<string, string | File | null> = {
    occasion: 'Client Presentation',
    photo: makePng(800, 800, 'photo.png'),
    garment: makePng(800, 800, 'garment.png'),
    styleProfile: JSON.stringify({ preferredStyles: [], favoriteColors: [], occasionPreferences: [] }),
    ...overrides,
  }
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) if (value !== null) form.append(key, value)
  return form
}

function post(path: string, form: FormData) {
  return POST(new Request(`http://localhost/api/${path}`, { method: 'POST', body: form }), context(path))
}

function profileForm() {
  const form = new FormData()
  form.append('photo', makePng())
  return form
}

beforeEach(() => {
  process.env = { ...originalEnv, ANALYSIS_MODE: 'openai', OPENAI_API_KEY: 'sk-test-fake-key-route-0000', OPENAI_MODEL: 'test-model' }
  jest.spyOn(console, 'info').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  process.env = { ...originalEnv }
  jest.restoreAllMocks()
})

describe('POST /api/analyze — OpenAI mode', () => {
  it('returns an application-computed verdict from model ratings', async () => {
    const dimensions = makeDimensions({ occasion: 'Excellent', formality: 'Excellent', style_preference_match: 'Excellent', color: 'Fair', seasonality: 'Fair' })
    jest.spyOn(global, 'fetch').mockResolvedValue(openAIResponse({ status: 'complete', dimensions, shopping_advisor: { recommendations: [] } }))

    const response = await post('analyze', analyzeForm())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ status: 'complete', overall_recommendation: 'Highly Recommended', verdict_score: 4.5, dimensions })
  })

  it('rejects a model response that tries to set the verdict', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(openAIResponse({ status: 'complete', dimensions: allRated('Poor'), overall_recommendation: 'Highly Recommended', verdict_score: 5 }))

    const response = await post('analyze', analyzeForm())

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'server_error', message: 'The analysis could not be completed reliably. Please try again.' })
  })

  it('withholds model shopping recommendations when no Style DNA is sent', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(openAIResponse({ status: 'complete', dimensions: allRated('Fair'), shopping_advisor: { recommendations: [VALID_RECOMMENDATION] } }))

    const body = await (await post('analyze', analyzeForm())).json()

    expect(body.shopping_advisor).toEqual({ availability: 'requires_style_dna', recommendations: [] })
  })

  it('exposes validated shopping recommendations when valid Style DNA is sent, without changing the verdict', async () => {
    const modelOutput = { status: 'complete', dimensions: allRated('Fair'), shopping_advisor: { recommendations: [VALID_RECOMMENDATION] } }
    jest.spyOn(global, 'fetch').mockResolvedValue(openAIResponse(modelOutput))
    const withDna = await (await post('analyze', analyzeForm({ aiStyleProfile: JSON.stringify(VALID_COMPLETE_PROFILE) }))).json()

    jest.spyOn(global, 'fetch').mockResolvedValue(openAIResponse(modelOutput))
    const withoutDna = await (await post('analyze', analyzeForm())).json()

    expect(withDna.shopping_advisor).toEqual({ availability: 'available', recommendations: [VALID_RECOMMENDATION] })
    expect(withDna.overall_recommendation).toBe(withoutDna.overall_recommendation)
    expect(withDna.verdict_score).toBe(withoutDna.verdict_score)
  })

  it('treats an invalid aiStyleProfile field as absent instead of failing the analysis', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(openAIResponse({ status: 'complete', dimensions: allRated('Good') }))

    const response = await post('analyze', analyzeForm({ aiStyleProfile: '{"beauty_score": 9}' }))

    expect(response.status).toBe(200)
    expect((await response.json()).shopping_advisor.availability).toBe('requires_style_dna')
  })

  it('passes unable_to_analyze through with HTTP 200', async () => {
    const unable = { status: 'unable_to_analyze', reason: 'No person is visible.', confidence: 'Low', next_step: 'Upload a clearer photo.' }
    jest.spyOn(global, 'fetch').mockResolvedValue(openAIResponse(unable))

    const response = await post('analyze', analyzeForm())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(unable)
  })

  it.each([
    ['missing configuration', () => { delete process.env.OPENAI_API_KEY }, 500, 'The analysis service is not configured. Please try again later.'],
    ['an OpenAI timeout', () => { jest.spyOn(global, 'fetch').mockRejectedValue(abortError()) }, 504, 'The analysis took too long. Please try again.'],
    ['an OpenAI 429', () => { jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 429 })) }, 429, 'The analysis service is busy. Please wait a moment and try again.'],
    ['an OpenAI 500', () => { jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 500 })) }, 502, 'The analysis service is temporarily unavailable. Please try again.'],
  ] as const)('maps %s to HTTP %d with a generic message', async (_label, arrange, status, message) => {
    arrange()
    const response = await post('analyze', analyzeForm())
    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toEqual({ error: 'server_error', message })
  })
})

describe('POST /api/analyze — request validation happens before any OpenAI call', () => {
  it.each([
    ['no occasion', { occasion: null }],
    ['an empty occasion', { occasion: '' }],
    ['no photo', { photo: null }],
    ['no garment', { garment: null }],
    ['a photo sent as text', { photo: 'not-a-file' }],
  ])('rejects %s with missing_image', async (_label, overrides) => {
    const fetchMock = jest.spyOn(global, 'fetch')
    const response = await post('analyze', analyzeForm(overrides as Record<string, string | null>))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'missing_image' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('prefixes photo and garment validation messages', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
    const photoResponse = await post('analyze', analyzeForm({ photo: makePng(100, 100) }))
    const garmentResponse = await post('analyze', analyzeForm({ garment: makePng(100, 100) }))
    await expect(photoResponse.json()).resolves.toEqual({ error: 'invalid_upload', message: 'Personal photo: Image must be at least 512×512 pixels.' })
    await expect(garmentResponse.json()).resolves.toEqual({ error: 'invalid_upload', message: 'Garment photo: Image must be at least 512×512 pixels.' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a malformed style profile', async () => {
    const response = await post('analyze', analyzeForm({ styleProfile: '{oops' }))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_upload', message: 'Style profile data is invalid.' })
  })
})

describe('POST /api/generate-profile — OpenAI mode', () => {
  it('returns a complete profile with an application-set timestamp', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(openAIResponse({ ...VALID_COMPLETE_PROFILE, generated_at_utc: '' }))

    const response = await post('generate-profile', profileForm())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe('complete')
    expect(body.generated_at_utc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('passes unable_to_generate through with HTTP 200 and no timestamp', async () => {
    const failure = { schema_version: '1.0', status: 'unable_to_generate', reason: 'No person is visible.', next_step: 'Upload a clear photo.', confidence: 'Low' }
    jest.spyOn(global, 'fetch').mockResolvedValue(openAIResponse(failure))

    const response = await post('generate-profile', profileForm())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(failure)
  })

  it.each([
    ['a schema-invalid profile', () => { jest.spyOn(global, 'fetch').mockResolvedValue(openAIResponse({ ...VALID_COMPLETE_PROFILE, beauty_score: 9 })) }, 502, 'api_error'],
    ['an OpenAI timeout', () => { jest.spyOn(global, 'fetch').mockRejectedValue(abortError()) }, 504, 'timeout'],
    ['an OpenAI 500', () => { jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 500 })) }, 502, 'api_error'],
  ] as const)('maps %s to HTTP %d (%s)', async (_label, arrange, status, error) => {
    arrange()
    const response = await post('generate-profile', profileForm())
    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toMatchObject({ error })
  })

  it('rejects an undersized photo before calling OpenAI', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
    const form = new FormData()
    form.append('photo', makePng(200, 200))
    const response = await post('generate-profile', form)
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_upload', message: 'Image must be at least 512×512 pixels.' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('ANALYSIS_MODE handling', () => {
  it('normalises case and surrounding whitespace', async () => {
    process.env.ANALYSIS_MODE = '  OpenAI  '
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(openAIResponse({ status: 'complete', dimensions: allRated('Good') }))
    const response = await post('analyze', analyzeForm())
    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each(['analyze', 'generate-profile'])('returns 500 server_error for an unrecognised mode on /%s', async (path) => {
    process.env.ANALYSIS_MODE = 'production'
    const fetchMock = jest.spyOn(global, 'fetch')
    const form = path === 'analyze' ? analyzeForm() : profileForm()
    const response = await post(path, form)
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({ error: 'server_error' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // CURRENT BEHAVIOUR, intentionally pinned: an unset ANALYSIS_MODE silently serves mock data.
  // Planned change C1 (fail-closed production mode) will deliberately update this test.
  it('current behaviour: falls back to mock mode when ANALYSIS_MODE is unset', async () => {
    delete process.env.ANALYSIS_MODE
    jest.spyOn(global, 'setTimeout').mockImplementation((callback) => {
      if (typeof callback === 'function') callback()
      return 0 as unknown as ReturnType<typeof setTimeout>
    })
    jest.spyOn(Math, 'random').mockReturnValue(0)
    const fetchMock = jest.spyOn(global, 'fetch')

    const response = await post('analyze', analyzeForm())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.overall_recommendation).toBe('Highly Recommended')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('routing', () => {
  it('returns 404 for an unknown route', async () => {
    const response = await post('does-not-exist', new FormData())
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Route /does-not-exist not found' })
  })

  it('returns 404 for GET /api/analyze', async () => {
    const response = await GET(new Request('http://localhost/api/analyze'), context('analyze'))
    expect(response.status).toBe(404)
  })

  it('answers GET /api/root', async () => {
    const response = await GET(new Request('http://localhost/api/root'), context('root'))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ message: 'Hello World' })
  })
})
