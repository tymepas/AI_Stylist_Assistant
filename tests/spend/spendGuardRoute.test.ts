/**
 * The spend guard around billable calls, exercised through the real API route.
 * Uses the in-memory store (same semantics as the Lua scripts). Fetch is mocked.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'

jest.mock('server-only', () => ({}), { virtual: true })

import { POST } from '@/app/api/[[...path]]/route'
import { reserveSpend, setSpendStoreForTesting, settlementAmount } from '@/lib/spend/spendGuard'
import { OpenAIAnalysisError } from '@/lib/services/openai/openAIErrors'
import { estimateMaxCostMicroUsd, resolveModelConfig } from '@/lib/services/openai/modelConfig'
import { DEFAULT_SPEND_CONFIG } from '@/lib/spend/spendConfig'
import { SpendStoreError, type SpendStore } from '@/lib/spend/spendStore'
import { abortError, allRated, makePng, openAIResponse } from '../helpers/fixtures'
import { installMemorySpendStore, MemorySpendStore } from '../helpers/memorySpendStore'

const originalEnv = { ...process.env }
const TERRA_ANALYSIS_RESERVATION = estimateMaxCostMicroUsd(resolveModelConfig('gpt-6.1-terra')!, 'analysis', 2)

function analyzeRequest(headers: Record<string, string> = {}) {
  const form = new FormData()
  form.append('occasion', 'Office Work')
  form.append('photo', makePng())
  form.append('garment', makePng())
  return new Request('http://localhost/api/analyze', { method: 'POST', body: form, headers })
}

const analyze = (headers?: Record<string, string>) => POST(analyzeRequest(headers), { params: Promise.resolve({ path: ['analyze'] }) })

function events(): Array<Record<string, unknown>> {
  return (['info', 'warn', 'error'] as const)
    .flatMap((m) => jest.mocked(console[m]).mock.calls)
    .map((call) => { try { return JSON.parse(String(call[0])) } catch { return {} } })
}

beforeEach(() => {
  process.env = { ...originalEnv, NODE_ENV: 'production', ANALYSIS_MODE: 'openai', OPENAI_API_KEY: 'sk-test-fake-spend-0000', OPENAI_MODEL: 'gpt-6.1-terra' }
  for (const method of ['info', 'warn', 'error'] as const) jest.spyOn(console, method).mockImplementation(() => undefined)
})

afterEach(() => {
  setSpendStoreForTesting(undefined)
  process.env = { ...originalEnv }
  jest.restoreAllMocks()
})

describe('fail closed', () => {
  it('returns 503 in production when no spend store is configured, without calling OpenAI', async () => {
    setSpendStoreForTesting(null)
    const fetchMock = jest.spyOn(global, 'fetch')
    const response = await analyze()
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ error: 'service_unavailable' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(events().find((e) => e.event === 'spend_guard_config_invalid')).toMatchObject({ config_issue: 'spend_store_not_configured' })
  })

  it('returns 503 when Upstash variables are present but invalid', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://attacker.example.com'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token'
    const fetchMock = jest.spyOn(global, 'fetch')
    expect((await analyze()).status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 503 when the store is unreachable', async () => {
    const failing: SpendStore = { reserve: async () => { throw new SpendStoreError('timeout') }, settle: async () => 'settled' }
    setSpendStoreForTesting({ store: failing, hashSecret: 's' })
    const fetchMock = jest.spyOn(global, 'fetch')
    expect((await analyze()).status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(events().find((e) => e.event === 'spend_store_unavailable')).toBeTruthy()
  })

  it('returns 503 when a SPEND_* override is invalid', async () => {
    await installMemorySpendStore()
    process.env.SPEND_DAILY_LIMIT_USD = 'lots'
    expect((await analyze()).status).toBe(503)
  })

  it('allows development without a store, with a warning, and never in production', async () => {
    setSpendStoreForTesting(null)
    process.env = { ...process.env, NODE_ENV: 'development' }
    jest.spyOn(global, 'fetch').mockResolvedValue(openAIResponse({ status: 'complete', dimensions: allRated('Good') }))
    expect((await analyze()).status).toBe(200)
    expect(events().find((e) => e.event === 'spend_guard_disabled')).toBeTruthy()
  })
})

describe('reservation and settlement', () => {
  let store: MemorySpendStore
  beforeEach(async () => { store = await installMemorySpendStore() })

  it('reserves the worst case before the call and settles to the actual cost', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(openAIResponse({ status: 'complete', dimensions: allRated('Good') }, {
      usage: { input_tokens: 6000, output_tokens: 1500, output_tokens_details: { reasoning_tokens: 900 } },
    }))

    expect((await analyze()).status).toBe(200)

    expect(store.reserveCalls[0].amountMicroUsd).toBe(TERRA_ANALYSIS_RESERVATION)
    expect(store.settleCalls).toEqual([{ leaseId: store.reserveCalls[0].leaseId, actual: 6000 + 1500 * 5 }])
    expect(store.spentTotal()).toBe(13_500)
    expect(store.leases.size).toBe(0)
  })

  it('keeps the full reservation when the outcome is unknown (timeout)', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(abortError())
    expect((await analyze()).status).toBe(504)
    expect(store.settleCalls[0].actual).toBeNull()
    expect(store.spentTotal()).toBe(TERRA_ANALYSIS_RESERVATION)
  })

  it('charges the billed usage of an incomplete response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(openAIResponse('', { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, usage: { input_tokens: 7000, output_tokens: 4000 } }))
    expect((await analyze()).status).toBe(502)
    expect(store.spentTotal()).toBe(7000 + 4000 * 5)
  })

  it('refunds a request OpenAI rejected (HTTP 4xx) and keeps one that failed with 5xx', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 429 }))
    expect((await analyze({ 'x-test': '1' })).status).toBe(429)
    expect(store.spentTotal()).toBe(0)

    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 500 }))
    expect((await analyze()).status).toBe(502)
    expect(store.spentTotal()).toBe(TERRA_ANALYSIS_RESERVATION)
  })

  it('never calls OpenAI in mock mode, so mock mode never reserves', async () => {
    process.env.ANALYSIS_MODE = 'mock'
    jest.spyOn(global, 'setTimeout').mockImplementation((callback) => { if (typeof callback === 'function') callback(); return 0 as unknown as ReturnType<typeof setTimeout> })
    const fetchMock = jest.spyOn(global, 'fetch')
    expect((await analyze()).status).toBe(200)
    expect(store.reserveCalls).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not reserve when the model is unsupported (the service refuses before any call)', async () => {
    process.env.OPENAI_MODEL = 'gpt-4o'
    const fetchMock = jest.spyOn(global, 'fetch')
    expect((await analyze()).status).toBe(500)
    expect(store.reserveCalls).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('limits', () => {
  it('rejects with 503 and Retry-After once the daily budget cannot cover another worst case', async () => {
    const store = await installMemorySpendStore({ ...DEFAULT_SPEND_CONFIG, dailyLimitMicroUsd: TERRA_ANALYSIS_RESERVATION * 2 - 1 })
    jest.spyOn(global, 'fetch').mockRejectedValue(abortError()) // unknown outcomes keep the full reservation

    expect((await analyze()).status).toBe(504)
    const fetchCalls = jest.mocked(global.fetch).mock.calls.length
    const rejected = await analyze()

    expect(rejected.status).toBe(503)
    expect(Number(rejected.headers.get('Retry-After'))).toBeGreaterThan(0)
    await expect(rejected.json()).resolves.toMatchObject({ error: 'service_unavailable' })
    expect(jest.mocked(global.fetch).mock.calls.length).toBe(fetchCalls)
    expect(store.spentToday()).toBeLessThanOrEqual(store.config.dailyLimitMicroUsd)
  })

  it('rejects once the cumulative budget is reached, with no Retry-After', async () => {
    const store = await installMemorySpendStore({ ...DEFAULT_SPEND_CONFIG, totalLimitMicroUsd: TERRA_ANALYSIS_RESERVATION, dailyLimitMicroUsd: TERRA_ANALYSIS_RESERVATION })
    jest.spyOn(global, 'fetch').mockRejectedValue(abortError())
    await analyze()
    const rejected = await analyze()
    expect(rejected.status).toBe(503)
    expect(rejected.headers.get('Retry-After')).toBeNull()
    expect(store.spentTotal()).toBeLessThanOrEqual(TERRA_ANALYSIS_RESERVATION)
  })

  it('rate limits per client with 429 and Retry-After', async () => {
    await installMemorySpendStore()
    jest.spyOn(global, 'fetch').mockImplementation(async () => openAIResponse({ status: 'complete', dimensions: allRated('Good') }, { usage: { input_tokens: 1, output_tokens: 1 } }))
    const statuses: number[] = []
    for (let i = 0; i < 7; i += 1) statuses.push((await analyze()).status)
    expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 429])
    const limited = await analyze()
    expect(limited.headers.get('Retry-After')).toMatch(/^\d+$/)
    await expect(limited.json()).resolves.toMatchObject({ error: 'rate_limit' })
  })

  it('caps concurrent billable calls globally', async () => {
    const store = await installMemorySpendStore({ ...DEFAULT_SPEND_CONFIG, maxConcurrent: 1 })
    process.env.VERCEL = '1'
    let release: () => void = () => undefined
    jest.spyOn(global, 'fetch').mockImplementation(() => new Promise<Response>((resolve) => {
      release = () => resolve(openAIResponse({ status: 'complete', dimensions: allRated('Good') }, { usage: { input_tokens: 1, output_tokens: 1 } }))
    }))

    const first = analyze({ 'x-vercel-forwarded-for': '203.0.113.1' })
    for (let i = 0; i < 100 && store.leases.size === 0; i += 1) await new Promise((r) => setImmediate(r))
    expect(store.leases.size).toBe(1)
    const second = await analyze({ 'x-vercel-forwarded-for': '203.0.113.2' })
    expect(second.status).toBe(429)

    release()
    expect((await first).status).toBe(200)
    expect(store.leases.size).toBe(0)
  })
})

describe('settlementAmount', () => {
  it.each([
    ['known usage', 1234, undefined, 1234],
    ['known usage beats any error', 50, new OpenAIAnalysisError('timeout', 'x'), 50],
    ['configuration error (nothing sent)', null, new OpenAIAnalysisError('configuration_error', 'x'), 0],
    ['HTTP 400', null, new OpenAIAnalysisError('api_error', 'x', 400), 0],
    ['HTTP 429', null, new OpenAIAnalysisError('rate_limit', 'x', 429), 0],
    ['HTTP 500', null, new OpenAIAnalysisError('api_error', 'x', 500), null],
    ['timeout', null, new OpenAIAnalysisError('timeout', 'x'), null],
    ['unexpected error', null, new Error('boom'), null],
    ['success without usage', null, undefined, null],
  ])('%s → %j', (_label, known, error, expected) => {
    expect(settlementAmount(known as number | null, error)).toBe(expected)
  })
})

describe('reserveSpend without a key', () => {
  it('does not touch the store when no API key is configured', async () => {
    const store = await installMemorySpendStore()
    delete process.env.OPENAI_API_KEY
    const decision = await reserveSpend({ operation: 'analysis', request: analyzeRequest(), imageCount: 2 })
    expect(decision.allowed).toBe(true)
    expect(store.reserveCalls).toHaveLength(0)
  })
})
