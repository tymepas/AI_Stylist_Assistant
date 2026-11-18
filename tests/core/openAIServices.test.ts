/**
 * Characterisation tests for the two OpenAI service modules with fetch mocked.
 * No network calls are made. Pins request construction (endpoint, credentials,
 * token caps, store:false) and the mapping of every failure to an error code.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'

jest.mock('server-only', () => ({}), { virtual: true })

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { analyzeWithOpenAI, OpenAIAnalysisError } from '@/lib/services/openai/openAIAnalysisService'
import { generateProfileWithOpenAI } from '@/lib/services/openai/openAIProfileService'
import { abortError, allRated, makePng, openAIResponse } from '../helpers/fixtures'
import { VALID_COMPLETE_PROFILE } from '../phase3/fixtures'

const FAKE_KEY = 'sk-test-fake-key-for-characterisation-0000'
const originalEnv = { ...process.env }

function analysisInput() {
  return {
    photo: makePng(800, 800, 'photo.png'),
    garment: makePng(800, 800, 'garment.png'),
    occasion: 'Client Presentation',
    styleProfile: { preferredStyles: ['Classic'], favoriteColors: [], occasionPreferences: [] },
  }
}

function lastRequest(fetchMock: ReturnType<typeof jest.spyOn>) {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  return { url, init, body: JSON.parse(String(init.body)) }
}

beforeEach(() => {
  process.env = { ...originalEnv, OPENAI_API_KEY: FAKE_KEY, OPENAI_MODEL: 'gpt-4.1' }
  // Keep test output readable; logging content is covered by dedicated logging tests.
  jest.spyOn(console, 'info').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  process.env = { ...originalEnv }
  jest.restoreAllMocks()
})

describe('analyzeWithOpenAI — request construction', () => {
  it('posts to the Responses API with the configured key and model, store:false and a 1,500 token cap', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(openAIResponse({ status: 'complete', dimensions: allRated('Good') }))

    await analyzeWithOpenAI(analysisInput())

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const { url, init, body } = lastRequest(fetchMock)
    expect(url).toBe('https://api.openai.com/v1/responses')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${FAKE_KEY}`)
    expect(body.model).toBe('gpt-4.1')
    expect(body.store).toBe(false)
    expect(body.max_output_tokens).toBe(1500)
    expect(body.text).toEqual({ format: { type: 'json_object' } })
    expect(body.instructions).toBe(readFileSync(path.join(process.cwd(), 'memory', 'SYSTEM_PROMPT.md'), 'utf8'))

    const content = body.input[0].content
    const images = content.filter((part: { type: string }) => part.type === 'input_image')
    expect(images).toHaveLength(2)
    for (const image of images) {
      expect(image.detail).toBe('high')
      expect(image.image_url).toMatch(/^data:image\/png;base64,/)
    }
    expect(content[0].text).toContain('Occasion: Client Presentation')
    expect(content[0].text).not.toContain('DNA coloring: ')
  })

  it('adds AI Style Profile context only when a profile is supplied', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(openAIResponse({ status: 'complete', dimensions: allRated('Good') }))

    await analyzeWithOpenAI({ ...analysisInput(), aiStyleProfile: VALID_COMPLETE_PROFILE })

    const text = lastRequest(fetchMock).body.input[0].content[0].text as string
    expect(text).toContain('DNA coloring: ')
    expect(text).toContain('DNA aesthetic: ')
  })

  it('reads output from the output[] array when output_text is absent', async () => {
    const modelJson = JSON.stringify({ status: 'complete', dimensions: allRated('Fair') })
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: modelJson }] }],
    }), { status: 200 }))

    await expect(analyzeWithOpenAI(analysisInput())).resolves.toEqual({ status: 'complete', dimensions: allRated('Fair') })
  })

  it('returns unable_to_analyze responses unchanged', async () => {
    const unable = { status: 'unable_to_analyze', reason: 'No garment is visible.', confidence: 'Low', next_step: 'Upload the full garment.' }
    jest.spyOn(global, 'fetch').mockResolvedValue(openAIResponse(unable))
    await expect(analyzeWithOpenAI(analysisInput())).resolves.toEqual(unable)
  })
})

describe('analyzeWithOpenAI — failure mapping', () => {
  it.each([
    ['OPENAI_API_KEY'],
    ['OPENAI_MODEL'],
  ])('throws configuration_error without calling OpenAI when %s is missing', async (name) => {
    delete process.env[name]
    const fetchMock = jest.spyOn(global, 'fetch')
    await expect(analyzeWithOpenAI(analysisInput())).rejects.toMatchObject({ name: 'OpenAIAnalysisError', code: 'configuration_error' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    [429, 'rate_limit'],
    [400, 'api_error'],
    [401, 'api_error'],
    [404, 'api_error'],
    [500, 'api_error'],
    [503, 'api_error'],
  ])('maps HTTP %d to %s and keeps the status', async (status, code) => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status }))
    await expect(analyzeWithOpenAI(analysisInput())).rejects.toMatchObject({ code, status })
  })

  it.each([
    ['a non-JSON body', () => new Response('<html>gateway</html>', { status: 200 })],
    ['a failed response', () => openAIResponse({ status: 'complete', dimensions: allRated('Good') }, { status: 'failed' })],
    ['no output text', () => new Response(JSON.stringify({ status: 'completed', output: [] }), { status: 200 })],
    ['output that is not JSON', () => openAIResponse('Sure! Here is my analysis.')],
    ['output that fails the schema', () => openAIResponse({ status: 'complete', dimensions: allRated('Good'), verdict_score: 5 })],
  ])('maps %s to invalid_response', async (_label, makeResponse) => {
    jest.spyOn(global, 'fetch').mockResolvedValue(makeResponse())
    await expect(analyzeWithOpenAI(analysisInput())).rejects.toMatchObject({ code: 'invalid_response' })
  })

  // Changed in the Terra readiness PR: an incomplete response has its own code so that
  // its (billed) usage can be settled and logged. The HTTP response to users is unchanged.
  it('maps an incomplete response to incomplete', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(openAIResponse({ status: 'complete', dimensions: allRated('Good') }, { status: 'incomplete' }))
    await expect(analyzeWithOpenAI(analysisInput())).rejects.toMatchObject({ code: 'incomplete' })
  })

  it('maps an aborted request to timeout', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(abortError())
    await expect(analyzeWithOpenAI(analysisInput())).rejects.toMatchObject({ code: 'timeout' })
  })

  it('maps a network failure to api_error', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('fetch failed'))
    const error = await analyzeWithOpenAI(analysisInput()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(OpenAIAnalysisError)
    expect(error).toMatchObject({ code: 'api_error' })
  })
})

describe('generateProfileWithOpenAI', () => {
  it('posts one high-detail image with store:false and a 2,000 token cap', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(openAIResponse({ ...VALID_COMPLETE_PROFILE, generated_at_utc: '' }))

    await generateProfileWithOpenAI({ photo: makePng() })

    const { url, init, body } = lastRequest(fetchMock)
    expect(url).toBe('https://api.openai.com/v1/responses')
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${FAKE_KEY}`)
    expect(body.model).toBe('gpt-4.1')
    expect(body.store).toBe(false)
    expect(body.max_output_tokens).toBe(2000)
    expect(body.instructions).toBe(readFileSync(path.join(process.cwd(), 'memory', 'STYLE_PROFILE_SYSTEM_PROMPT.md'), 'utf8'))
    const images = body.input[0].content.filter((part: { type: string }) => part.type === 'input_image')
    expect(images).toHaveLength(1)
    expect(images[0].detail).toBe('high')
  })

  it('returns a validated complete profile', async () => {
    const profile = { ...VALID_COMPLETE_PROFILE, generated_at_utc: '' }
    jest.spyOn(global, 'fetch').mockResolvedValue(openAIResponse(profile))
    await expect(generateProfileWithOpenAI({ photo: makePng() })).resolves.toEqual(profile)
  })

  it('returns unable_to_generate unchanged', async () => {
    const failure = { schema_version: '1.0', status: 'unable_to_generate', reason: 'No person is visible.', next_step: 'Upload a clear photo.', confidence: 'Low' }
    jest.spyOn(global, 'fetch').mockResolvedValue(openAIResponse(failure))
    await expect(generateProfileWithOpenAI({ photo: makePng() })).resolves.toEqual(failure)
  })

  it('rejects a profile containing a prohibited field as invalid_response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(openAIResponse({ ...VALID_COMPLETE_PROFILE, estimated_age: 30 }))
    await expect(generateProfileWithOpenAI({ photo: makePng() })).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it.each([
    ['missing configuration', () => { delete process.env.OPENAI_MODEL }, 'configuration_error'],
    ['HTTP 429', () => { jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 429 })) }, 'rate_limit'],
    ['HTTP 500', () => { jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 500 })) }, 'api_error'],
    ['an aborted request', () => { jest.spyOn(global, 'fetch').mockRejectedValue(abortError()) }, 'timeout'],
  ] as const)('maps %s to %s', async (_label, arrange, code) => {
    arrange()
    await expect(generateProfileWithOpenAI({ photo: makePng() })).rejects.toMatchObject({ code })
  })
})
