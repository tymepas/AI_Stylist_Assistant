/**
 * The request trace: every analysis leaves log events that share one request_id
 * and record the model, prompt version, schema version, mode, outcome, latency,
 * usage, cost and validation result, with no user data.
 *
 * Also pins the behaviour of a client disconnect: the provider call is not
 * aborted and the spend reservation is settled with the actual cost.
 *
 * OpenAI is mocked and the spend store is in memory. No network calls are made.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'

jest.mock('server-only', () => ({}), { virtual: true })

import { POST } from '@/app/api/[[...path]]/route'
import { ANALYSIS_OUTPUT_SCHEMA_VERSION } from '@/lib/services/openai/openAIAnalysisSchema'
import { PROFILE_OUTPUT_SCHEMA_VERSION } from '@/lib/services/openai/aiStyleProfileSchema'
import { getAnalysisPromptVersion } from '@/lib/services/openai/openAIAnalysisService'
import { setSpendStoreForTesting } from '@/lib/spend/spendGuard'
import { abortError, allRated, dimension, makePng, openAIResponse } from '../helpers/fixtures'
import { installMemorySpendStore } from '../helpers/memorySpendStore'
import { captureLogs, JPEG_BASE64_PREFIX, PNG_BASE64_PREFIX } from '../logging/logTestUtils'
import { VALID_COMPLETE_PROFILE } from '../phase3/fixtures'

const originalEnv = { ...process.env }
const USAGE = { input_tokens: 5200, output_tokens: 640, total_tokens: 5840, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } }
const OCCASION = 'PRIVATE-OCCASION-MARKER'

function analyzeRequest(signal?: AbortSignal): Request {
  const form = new FormData()
  form.append('occasion', OCCASION)
  form.append('photo', makePng())
  form.append('garment', makePng())
  form.append('styleProfile', JSON.stringify({ preferredStyles: ['PRIVATE-STYLE-MARKER'], favoriteColors: [], occasionPreferences: [] }))
  return new Request('http://localhost/api/analyze', { method: 'POST', body: form, signal })
}

function profileRequest(): Request {
  const form = new FormData()
  form.append('photo', makePng())
  return new Request('http://localhost/api/generate-profile', { method: 'POST', body: form })
}

const analyze = (signal?: AbortSignal) => POST(analyzeRequest(signal), { params: Promise.resolve({ path: ['analyze'] }) })
const generateProfile = () => POST(profileRequest(), { params: Promise.resolve({ path: ['generate-profile'] }) })

const completeAnalysis = () => openAIResponse({ status: 'complete', dimensions: allRated('Good'), shopping_advisor: { recommendations: [] } }, { usage: USAGE })

beforeEach(() => {
  process.env = { ...originalEnv, ANALYSIS_MODE: 'openai', OPENAI_API_KEY: 'sk-test-fake-key-trace-0000', OPENAI_MODEL: 'gpt-6.1-terra' }
})

afterEach(() => {
  setSpendStoreForTesting(undefined)
  process.env = { ...originalEnv }
  jest.restoreAllMocks()
})

describe('request trace in OpenAI mode', () => {
  it('records every trace field on a successful analysis', async () => {
    const logs = captureLogs()
    jest.spyOn(global, 'fetch').mockImplementation(async () => completeAnalysis())

    const response = await analyze()

    expect(response.status).toBe(200)
    const completed = logs.events().find((event) => event.event === 'openai_request_completed')
    expect(completed).toMatchObject({
      operation: 'analysis',
      model: 'gpt-6.1-terra',
      reasoning_effort: 'low',
      prompt_version: await getAnalysisPromptVersion(),
      schema_version: ANALYSIS_OUTPUT_SCHEMA_VERSION,
      analysis_mode: 'openai',
      outcome: 'complete',
      validation: 'passed',
      input_tokens: 5200,
      output_tokens: 640,
      total_tokens: 5840,
    })
    expect(typeof completed?.duration_ms).toBe('number')
    // Terra: $1 per 1M input tokens, $5 per 1M output tokens.
    expect(completed?.cost_micro_usd).toBe(5200 * 1 + 640 * 5)
    expect(completed?.request_id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('returns the request id in a response header that matches the trace', async () => {
    const logs = captureLogs()
    jest.spyOn(global, 'fetch').mockImplementation(async () => completeAnalysis())

    const response = await analyze()

    const requestId = response.headers.get('x-request-id')
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/)
    const ids = new Set(logs.events().map((event) => event.request_id))
    expect([...ids]).toEqual([requestId])
  })

  it('gives every request a different id', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async () => completeAnalysis())
    captureLogs()
    const first = (await analyze()).headers.get('x-request-id')
    const second = (await analyze()).headers.get('x-request-id')
    expect(first).not.toBe(second)
  })

  it('records the profile operation with its own prompt and schema versions', async () => {
    const logs = captureLogs()
    jest.spyOn(global, 'fetch').mockImplementation(async () => openAIResponse(VALID_COMPLETE_PROFILE, { usage: USAGE }))

    expect((await generateProfile()).status).toBe(200)

    const completed = logs.events().find((event) => event.event === 'openai_request_completed')
    expect(completed).toMatchObject({ operation: 'profile', schema_version: PROFILE_OUTPUT_SCHEMA_VERSION, analysis_mode: 'openai', validation: 'passed', outcome: 'complete' })
    expect(completed?.prompt_version).toMatch(/^[0-9a-f]{12}$/)
    expect(completed?.prompt_version).not.toBe(await getAnalysisPromptVersion())
  })

  it('records a failed validation, with usage and cost, when the model output breaks the schema', async () => {
    const logs = captureLogs()
    jest.spyOn(global, 'fetch').mockImplementation(async () => openAIResponse({ status: 'complete', dimensions: { occasion: { rating: 'Superb' } } }, { usage: USAGE }))

    expect((await analyze()).status).toBe(502)

    const invalid = logs.events().find((event) => event.event === 'openai_output_schema_invalid')
    const failed = logs.events().find((event) => event.event === 'openai_request_failed')
    expect(invalid).toMatchObject({ validation: 'failed', schema_version: ANALYSIS_OUTPUT_SCHEMA_VERSION })
    expect(failed).toMatchObject({ validation: 'failed', error_code: 'invalid_response', input_tokens: 5200, schema_version: ANALYSIS_OUTPUT_SCHEMA_VERSION })
    expect(failed?.prompt_version).toBe(await getAnalysisPromptVersion())
    expect(typeof failed?.cost_micro_usd).toBe('number')
  })

  it('records validation as not run when the provider fails before returning output', async () => {
    const logs = captureLogs()
    jest.spyOn(global, 'fetch').mockImplementation(async () => new Response('{}', { status: 500 }))
    expect((await analyze()).status).toBe(502)
    expect(logs.events().find((event) => event.event === 'openai_request_failed')).toMatchObject({ validation: 'not_run', error_code: 'api_error', http_status: 500 })

    jest.spyOn(global, 'fetch').mockRejectedValue(abortError())
    expect((await analyze()).status).toBe(504)
    expect(logs.events().filter((event) => event.event === 'openai_request_failed').pop()).toMatchObject({ validation: 'not_run', error_code: 'timeout' })
  })

  it('never puts user data, images, prompts or model text in the trace', async () => {
    const logs = captureLogs()
    jest.spyOn(global, 'fetch').mockImplementation(async () =>
      openAIResponse(
        { status: 'complete', dimensions: { ...allRated('Good'), color: dimension('Good', 'MODEL-REASON-MARKER about the person') }, shopping_advisor: { recommendations: [] } },
        { usage: USAGE }
      )
    )

    await analyze()

    const text = logs.text()
    for (const fragment of [OCCASION, 'PRIVATE-STYLE-MARKER', 'MODEL-REASON-MARKER', PNG_BASE64_PREFIX, JPEG_BASE64_PREFIX, 'sk-test-fake-key', 'Rate each dimension']) {
      expect(text).not.toContain(fragment)
    }
  })
})

describe('request trace in mock mode', () => {
  it('records the mode, outcome and latency without model fields', async () => {
    process.env.ANALYSIS_MODE = 'mock'
    const logs = captureLogs()
    const fetchSpy = jest.spyOn(global, 'fetch')

    // Mock mode keeps its simulated latency of a few seconds.
    const response = await analyze()

    expect(response.status).toBe(200)
    expect(fetchSpy).not.toHaveBeenCalled()
    const body = (await response.json()) as { status: string }
    expect(logs.events()).toEqual([
      expect.objectContaining({ level: 'info', event: 'api_request_completed', endpoint: '/analyze', operation: 'analysis', analysis_mode: 'mock', outcome: body.status, http_status: 200 }),
    ])
    const [event] = logs.events()
    expect(event.request_id).toBe(response.headers.get('x-request-id'))
    expect(typeof event.duration_ms).toBe('number')
    for (const field of ['model', 'prompt_version', 'schema_version', 'input_tokens', 'cost_micro_usd']) expect(event).not.toHaveProperty(field)
    expect(logs.text()).not.toContain(OCCASION)
  }, 15_000)

  it('records mock profile generation too', async () => {
    process.env.ANALYSIS_MODE = 'mock'
    const logs = captureLogs()

    expect((await generateProfile()).status).toBe(200)

    expect(logs.events()).toEqual([
      expect.objectContaining({ event: 'api_request_completed', endpoint: '/generate-profile', operation: 'profile', analysis_mode: 'mock', outcome: 'complete' }),
    ])
  }, 15_000)
})

describe('client disconnect during a billable call', () => {
  it('does not abort the provider request, and settles the reservation with the actual cost', async () => {
    const store = await installMemorySpendStore()
    captureLogs()
    const client = new AbortController()
    let providerSignal: AbortSignal | undefined

    jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      providerSignal = (init as RequestInit).signal ?? undefined
      // The user closes the tab while the model is still working.
      client.abort()
      return completeAnalysis()
    })

    const response = await analyze(client.signal)

    // The provider call ran to completion: aborting it would leave the cost unknown.
    expect(providerSignal?.aborted).toBe(false)
    expect(response.status).toBe(200)
    // Reserved once, settled once with the real cost, and no lease is left behind.
    expect(store.reserveCalls).toHaveLength(1)
    expect(store.settleCalls).toEqual([{ leaseId: store.reserveCalls[0].leaseId, actual: 5200 * 1 + 640 * 5 }])
    expect(store.leases.size).toBe(0)
    expect(store.spentTotal()).toBe(5200 * 1 + 640 * 5)
  })
})
