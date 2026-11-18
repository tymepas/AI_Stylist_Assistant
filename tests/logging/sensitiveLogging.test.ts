/**
 * Regression tests: production logs never contain API keys, images, prompts,
 * personal context, raw model output or validation details.
 *
 * Every test runs with NODE_ENV=production and captures all console output.
 * Distinctive MARKER strings are planted in every sensitive input; none may appear in logs.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'

jest.mock('server-only', () => ({}), { virtual: true })

import { POST } from '@/app/api/[[...path]]/route'
import { analyzeWithOpenAI } from '@/lib/services/openai/openAIAnalysisService'
import { generateProfileWithOpenAI } from '@/lib/services/openai/openAIProfileService'
import { VALID_COMPLETE_PROFILE } from '../phase3/fixtures'
import { captureLogs, dimensions, JPEG_BASE64_PREFIX, makePng, openAIResponse, PNG_BASE64_PREFIX, type LogCapture } from './logTestUtils'
import { setSpendStoreForTesting } from '@/lib/spend/spendGuard'
import { installMemorySpendStore } from '../helpers/memorySpendStore'

const FAKE_KEY = 'sk-test-a2-secret-key-must-never-be-logged-0000'
const originalEnv = { ...process.env }
let logs: LogCapture

const FORBIDDEN = [
  FAKE_KEY,
  'sk-test-a2', // any prefix of the key
  'MARKER', // planted in occasion, style profile, model output and errors
  PNG_BASE64_PREFIX, // image bytes as uploaded
  JPEG_BASE64_PREFIX, // image bytes as re-encoded and sent to the provider
  'data:image',
  'base64,',
  'SYSTEM PROMPT', // memory/SYSTEM_PROMPT.md heading
  'Style Profile System Prompt', // memory/STYLE_PROFILE_SYSTEM_PROMPT.md heading
  'Selected occasion', // user context sent to the model (before analysis-output/3)
  'Image mode:', // user context sent to the model (analysis-output/3)
  'Style preferences:',
  'skin tone', // appearance context
]

function expectNoSensitiveData() {
  const text = logs.text()
  for (const fragment of FORBIDDEN) expect(text).not.toContain(fragment)
}

function analysisInput() {
  return {
    photo: makePng(),
    garment: makePng(),
    occasion: 'MARKER_OCCASION Wedding Guest',
    styleProfile: { preferredStyles: ['MARKER_STYLE'], favoriteColors: ['MARKER_COLOR'], occasionPreferences: [] },
    aiStyleProfile: { ...VALID_COMPLETE_PROFILE, coloring: { ...VALID_COMPLETE_PROFILE.coloring, hair_color: 'MARKER_HAIR' } },
    requestId: 'req-test-0001',
  }
}

beforeEach(() => {
  process.env = { ...originalEnv, NODE_ENV: 'production', OPENAI_API_KEY: FAKE_KEY, OPENAI_MODEL: 'gpt-4.1', ANALYSIS_MODE: 'openai' }
  logs = captureLogs()
})

afterEach(() => {
  process.env = { ...originalEnv }
  jest.restoreAllMocks()
})

describe('profile generation logging', () => {
  it('does not log the raw model output when it fails the schema', async () => {
    const appearanceOutput = {
      ...VALID_COMPLETE_PROFILE,
      generated_at_utc: '',
      coloring: { ...VALID_COMPLETE_PROFILE.coloring, skin_tone_depth: 'MARKER_SKIN_olive' },
      analysis_notes: { ...VALID_COMPLETE_PROFILE.analysis_notes, confidence_summary: 'MARKER_SUMMARY describes the person' },
      estimated_age: 'MARKER_AGE_34',
    }
    jest.spyOn(global, 'fetch').mockResolvedValue(openAIResponse(appearanceOutput))

    await expect(generateProfileWithOpenAI({ photo: makePng(), requestId: 'req-profile-1' })).rejects.toMatchObject({ code: 'invalid_response' })

    expectNoSensitiveData()
    const schemaEvent = logs.events().find((e) => e.event === 'openai_output_schema_invalid')
    expect(schemaEvent).toMatchObject({ level: 'warn', request_id: 'req-profile-1', operation: 'profile', model: 'gpt-4.1' })
    expect(schemaEvent?.issue_paths).toEqual(expect.arrayContaining(['coloring.skin_tone_depth', '(root)']))
    expect(logs.events().find((e) => e.event === 'openai_request_failed')).toMatchObject({ error_code: 'invalid_response', input_tokens: 2100, output_tokens: 410 })
  })

  it('logs a completed event with usage but no profile content', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(openAIResponse({ ...VALID_COMPLETE_PROFILE, generated_at_utc: '', coloring: { ...VALID_COMPLETE_PROFILE.coloring, hair_color: 'MARKER_HAIR' } }))

    await generateProfileWithOpenAI({ photo: makePng(), requestId: 'req-profile-2' })

    expectNoSensitiveData()
    expect(logs.text()).not.toContain('dark brown')
    expect(logs.events()).toEqual([
      expect.objectContaining({ event: 'openai_request_completed', request_id: 'req-profile-2', outcome: 'complete', total_tokens: 2510 }),
    ])
  })

  it('logs the configuration problem by name without any value', async () => {
    delete process.env.OPENAI_MODEL
    await expect(generateProfileWithOpenAI({ photo: makePng() })).rejects.toMatchObject({ code: 'configuration_error' })
    expectNoSensitiveData()
    expect(logs.events()).toEqual([expect.objectContaining({ event: 'openai_config_invalid', operation: 'profile', config_issue: 'missing_model' })])
  })
})

describe('analysis logging', () => {
  it('does not log prompts, user context, images or model output on success', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(openAIResponse({ status: 'complete', dimensions: dimensions('MARKER_REASON the navy suits their skin tone') }))

    await analyzeWithOpenAI(analysisInput())

    expectNoSensitiveData()
    expect(logs.events()).toEqual([
      expect.objectContaining({ level: 'info', event: 'openai_request_completed', request_id: 'req-test-0001', operation: 'analysis', model: 'gpt-4.1', outcome: 'complete', input_tokens: 2100, output_tokens: 410, total_tokens: 2510 }),
    ])
  })

  it('does not log model output that fails the schema', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(openAIResponse({ status: 'complete', dimensions: dimensions('MARKER_REASON'), verdict_score: 'MARKER_SCORE' }))

    await expect(analyzeWithOpenAI(analysisInput())).rejects.toMatchObject({ code: 'invalid_response' })

    expectNoSensitiveData()
    expect(logs.events().find((e) => e.event === 'openai_output_schema_invalid')).toMatchObject({ operation: 'analysis', issue_paths: ['(root)'] })
  })

  it('does not log output text that is not JSON', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(openAIResponse('MARKER_PROSE The person has a warm skin tone.'))
    await expect(analyzeWithOpenAI(analysisInput())).rejects.toMatchObject({ code: 'invalid_response' })
    expectNoSensitiveData()
  })

  it('records why an incomplete response stopped, using OpenAI enum values only', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(openAIResponse('{"status":"complete","dimensions":{"occ', { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }))
    await expect(analyzeWithOpenAI(analysisInput())).rejects.toMatchObject({ code: 'incomplete' })
    expectNoSensitiveData()
    expect(logs.events().find((e) => e.event === 'openai_response_not_completed')).toMatchObject({ outcome: 'incomplete:max_output_tokens' })
  })

  it('does not log the OpenAI error body', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { message: `MARKER_PROVIDER_ERROR Incorrect API key provided: ${FAKE_KEY}` } }), { status: 401 }))
    await expect(analyzeWithOpenAI(analysisInput())).rejects.toMatchObject({ code: 'api_error', status: 401 })
    expectNoSensitiveData()
    expect(logs.events()).toEqual([expect.objectContaining({ event: 'openai_request_failed', error_code: 'api_error', http_status: 401 })])
  })

  it('does not log network error messages', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError(`MARKER_NETWORK fetch failed for key ${FAKE_KEY}`))
    await expect(analyzeWithOpenAI(analysisInput())).rejects.toMatchObject({ code: 'api_error' })
    expectNoSensitiveData()
  })

  // Changed in the Terra readiness PR: an unsupported model (including a misplaced key)
  // is now rejected by the allowlist before any request, and its value is never logged.
  it('rejects OPENAI_MODEL containing an API key before calling OpenAI, without logging it', async () => {
    const keyLikeModel = 'sk-proj-MisplacedKeyInModelVariable0123456789'
    process.env.OPENAI_MODEL = keyLikeModel
    const fetchMock = jest.spyOn(global, 'fetch')

    await expect(analyzeWithOpenAI(analysisInput())).rejects.toMatchObject({ code: 'configuration_error' })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(logs.text()).not.toContain('MisplacedKey')
    expect(logs.events()).toEqual([expect.objectContaining({ event: 'openai_config_invalid', config_issue: 'unsupported_model' })])
  })

  it.each([
    ['OPENAI_API_KEY', 'missing_api_key'],
    ['OPENAI_MODEL', 'missing_model'],
  ])('logs a missing %s by name only', async (name, configIssue) => {
    delete process.env[name]
    await expect(analyzeWithOpenAI(analysisInput())).rejects.toMatchObject({ code: 'configuration_error' })
    expectNoSensitiveData()
    expect(logs.events()).toEqual([expect.objectContaining({ event: 'openai_config_invalid', config_issue: configIssue, request_id: 'req-test-0001' })])
  })
})

describe('end-to-end through the API route (production)', () => {
  // Production fails closed without a spend store, so these tests install the in-memory one.
  beforeEach(async () => { await installMemorySpendStore() })
  afterEach(() => { setSpendStoreForTesting(undefined) })

  const openAIEvents = () => logs.events().filter((e) => String(e.event).startsWith('openai_'))

  function analyzeForm() {
    const form = new FormData()
    form.append('occasion', 'Office Work')
    form.append('photo', makePng())
    form.append('garment', makePng())
    form.append('styleProfile', JSON.stringify({ preferredStyles: ['MARKER_STYLE'], favoriteColors: [], occasionPreferences: [] }))
    form.append('aiStyleProfile', JSON.stringify(VALID_COMPLETE_PROFILE))
    return form
  }

  it('logs one correlated, content-free event per analysis', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(openAIResponse({ status: 'complete', dimensions: dimensions('MARKER_REASON') }))

    const response = await POST(new Request('http://localhost/api/analyze', { method: 'POST', body: analyzeForm() }), { params: Promise.resolve({ path: ['analyze'] }) })

    expect(response.status).toBe(200)
    expectNoSensitiveData()
    const events = openAIEvents()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ event: 'openai_request_completed', operation: 'analysis' })
    expect(events[0].request_id).toMatch(/^[0-9a-f-]{36}$/)
    // The spend settlement shares the request id and carries only amounts.
    expect(logs.events().find((e) => e.event === 'spend_settled')).toMatchObject({ request_id: events[0].request_id, outcome: 'settled' })
  })

  it('gives each request its own request id', async () => {
    const ids: unknown[] = []
    for (let i = 0; i < 2; i += 1) {
      jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 500 }))
      await POST(new Request('http://localhost/api/analyze', { method: 'POST', body: analyzeForm() }), { params: Promise.resolve({ path: ['analyze'] }) })
    }
    for (const event of logs.events()) ids.push(event.request_id)
    expect(new Set(ids).size).toBe(2)
  })

  it('keeps profile generation logs free of appearance data', async () => {
    const form = new FormData()
    form.append('photo', makePng())
    jest.spyOn(global, 'fetch').mockResolvedValue(openAIResponse({ ...VALID_COMPLETE_PROFILE, beauty_score: 'MARKER_BEAUTY 9/10' }))

    const response = await POST(new Request('http://localhost/api/generate-profile', { method: 'POST', body: form }), { params: Promise.resolve({ path: ['generate-profile'] }) })

    expect(response.status).toBe(502)
    expectNoSensitiveData()
    expect(new Set(logs.events().map((e) => e.request_id)).size).toBe(1)
    expect(openAIEvents().map((e) => e.event)).toEqual(['openai_output_schema_invalid', 'openai_request_failed'])
  })
})
