/**
 * Spend configuration, client identity, Upstash transport and the bounds that make
 * reservations safe upper limits.
 */

import { afterEach, describe, expect, it, jest } from '@jest/globals'
import { readFileSync } from 'node:fs'
import path from 'node:path'

jest.mock('server-only', () => ({}), { virtual: true })

import { DEFAULT_SPEND_CONFIG, LEASE_TTL_MS, parseSpendConfig, ROUTE_MAX_DURATION_S } from '@/lib/spend/spendConfig'
import { clientAddressFromHeaders, clientKey, normalizeClientAddress } from '@/lib/spend/clientIdentity'
import { createUpstashEval, upstashConfigFromEnv } from '@/lib/spend/upstashRest'
import { retryAfterFor, SpendStoreError } from '@/lib/spend/spendStore'
import { buildUserContext } from '@/lib/services/openai/openAIAnalysisService'
import { resolveModelConfig, SUPPORTED_MODEL_IDS } from '@/lib/services/openai/modelConfig'
import { MAX_AI_STYLE_PROFILE_BYTES, MAX_OCCASION_LENGTH, MAX_STYLE_PROFILE_BYTES, utf8ByteLength } from '@/lib/services/requestLimits'
import { worstCasePromptBytes } from '../helpers/promptBudget'
import { VALID_COMPLETE_PROFILE } from '../phase3/fixtures'

afterEach(() => { jest.restoreAllMocks() })

describe('parseSpendConfig', () => {
  it('defaults to $1/day, $0.75 warning, $25 cumulative and 2 concurrent calls', () => {
    expect(parseSpendConfig({})).toEqual(DEFAULT_SPEND_CONFIG)
    expect(DEFAULT_SPEND_CONFIG).toEqual({ dailyLimitMicroUsd: 1_000_000, dailyWarnMicroUsd: 750_000, totalLimitMicroUsd: 25_000_000, maxConcurrent: 2 })
  })

  it('accepts overrides in US dollars', () => {
    expect(parseSpendConfig({ SPEND_DAILY_LIMIT_USD: '2.5', SPEND_DAILY_WARN_USD: '2', SPEND_TOTAL_LIMIT_USD: '20', SPEND_MAX_CONCURRENT: '3' }))
      .toEqual({ dailyLimitMicroUsd: 2_500_000, dailyWarnMicroUsd: 2_000_000, totalLimitMicroUsd: 20_000_000, maxConcurrent: 3 })
  })

  it.each([
    [{ SPEND_DAILY_LIMIT_USD: 'abc' }],
    [{ SPEND_DAILY_LIMIT_USD: '0' }],
    [{ SPEND_DAILY_LIMIT_USD: '-1' }],
    [{ SPEND_TOTAL_LIMIT_USD: '5000' }],
    [{ SPEND_MAX_CONCURRENT: '0' }],
    [{ SPEND_MAX_CONCURRENT: '1.5' }],
    [{ SPEND_DAILY_WARN_USD: '2' }], // above the $1 daily limit
    [{ SPEND_DAILY_LIMIT_USD: '30' }], // above the $25 total
  ])('fails closed on %j', (env) => {
    expect(() => parseSpendConfig(env)).toThrow()
  })
})

describe('client identity', () => {
  const headers = (values: Record<string, string>) => new Headers(values)

  it('ignores forwarding headers when not running on Vercel', () => {
    expect(clientAddressFromHeaders(headers({ 'x-forwarded-for': '203.0.113.9', 'x-vercel-forwarded-for': '203.0.113.9' }), {})).toBe('local')
  })

  it('uses the Vercel-set header on Vercel, first entry only', () => {
    expect(clientAddressFromHeaders(headers({ 'x-vercel-forwarded-for': '203.0.113.9, 10.0.0.1' }), { VERCEL: '1' })).toBe('203.0.113.9')
    expect(clientAddressFromHeaders(headers({ 'x-forwarded-for': '198.51.100.7' }), { VERCEL: '1' })).toBe('198.51.100.7')
  })

  it('puts missing or malformed addresses in one shared bucket', () => {
    expect(clientAddressFromHeaders(headers({}), { VERCEL: '1' })).toBe('unknown')
    expect(clientAddressFromHeaders(headers({ 'x-vercel-forwarded-for': 'not-an-ip' }), { VERCEL: '1' })).toBe('unknown')
  })

  it('reduces IPv6 to its /64 and unwraps IPv4-mapped addresses', () => {
    expect(normalizeClientAddress('2001:db8:abcd:12:1:2:3:4')).toBe('2001:0db8:abcd:0012::/64')
    expect(normalizeClientAddress('2001:db8:abcd:12::99')).toBe('2001:0db8:abcd:0012::/64')
    expect(normalizeClientAddress('[2001:db8::1]')).toBe('2001:0db8:0000:0000::/64')
    expect(normalizeClientAddress('::ffff:192.0.2.1')).toBe('192.0.2.1')
  })

  it('stores an HMAC, never the address', () => {
    const key = clientKey('203.0.113.9', 'secret')
    expect(key).toMatch(/^[0-9a-f]{32}$/)
    expect(key).not.toContain('203')
    expect(clientKey('203.0.113.9', 'secret')).toBe(key)
    expect(clientKey('203.0.113.9', 'other')).not.toBe(key)
  })
})

describe('Upstash configuration and transport', () => {
  it.each([
    [{}, 'missing'],
    [{ UPSTASH_REDIS_REST_URL: 'https://eu1-x.upstash.io' }, 'invalid'],
    [{ UPSTASH_REDIS_REST_URL: 'http://eu1-x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't' }, 'invalid'],
    [{ UPSTASH_REDIS_REST_URL: 'https://evil.example.com', UPSTASH_REDIS_REST_TOKEN: 't' }, 'invalid'],
    [{ UPSTASH_REDIS_REST_URL: 'https://upstash.io.evil.com', UPSTASH_REDIS_REST_TOKEN: 't' }, 'invalid'],
    [{ UPSTASH_REDIS_REST_URL: 'https://eu1-x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't' }, 'configured'],
    [{ KV_REST_API_URL: 'https://eu1-x.upstash.io', KV_REST_API_TOKEN: 't' }, 'configured'],
  ])('%j → %s', (env, status) => {
    expect(upstashConfigFromEnv(env).status).toBe(status)
  })

  it('sends EVAL as a JSON command array with a bearer token', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ result: [1, 'reserved', 0] }), { status: 200 }))
    const evalScript = createUpstashEval({ url: 'https://eu1-x.upstash.io', token: 'tok' })

    await expect(evalScript('return 1', ['k1', 'k2'], ['a'])).resolves.toEqual([1, 'reserved', 0])

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://eu1-x.upstash.io')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
    expect(JSON.parse(String(init.body))).toEqual(['EVAL', 'return 1', '2', 'k1', 'k2', 'a'])
  })

  it.each([
    ['HTTP 401', () => new Response('{"error":"unauthorized"}', { status: 401 })],
    ['a script error', () => new Response(JSON.stringify({ error: 'ERR script' }), { status: 200 })],
    ['a non-JSON body', () => new Response('oops', { status: 200 })],
  ])('throws SpendStoreError on %s', async (_label, make) => {
    jest.spyOn(global, 'fetch').mockResolvedValue(make())
    await expect(createUpstashEval({ url: 'https://eu1-x.upstash.io', token: 't' })('x', [], [])).rejects.toBeInstanceOf(SpendStoreError)
  })

  it('throws SpendStoreError on network failure and timeout', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new TypeError('fetch failed'))
    await expect(createUpstashEval({ url: 'https://eu1-x.upstash.io', token: 't' })('x', [], [])).rejects.toMatchObject({ category: 'network' })
    jest.spyOn(global, 'fetch').mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      (init as RequestInit).signal?.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e) })
    }))
    await expect(createUpstashEval({ url: 'https://eu1-x.upstash.io', token: 't' }, 20)('x', [], [])).rejects.toMatchObject({ category: 'timeout' })
  })
})

describe('Retry-After values', () => {
  const now = Date.UTC(2026, 10, 16, 23, 59, 30)
  it('points to the end of the window, the next UTC day, or a short pause', () => {
    expect(retryAfterFor('rate_limited', 'analysis', Date.UTC(2026, 10, 16, 10, 5, 0))).toBe(300)
    expect(retryAfterFor('daily_budget_exhausted', 'analysis', now)).toBe(30)
    expect(retryAfterFor('daily_rate_limited', 'profile', now)).toBe(30)
    expect(retryAfterFor('busy', 'analysis', now)).toBe(15)
    expect(retryAfterFor('total_budget_exhausted', 'analysis', now)).toBeNull()
  })
})

describe('reservation bounds hold for the worst-case request', () => {
  it('the route maxDuration matches the guard and outlives every OpenAI timeout', () => {
    const route = readFileSync(path.join(process.cwd(), 'app/api/[[...path]]/route.js'), 'utf8')
    expect(route).toMatch(new RegExp(`export const maxDuration = ${ROUTE_MAX_DURATION_S}\\b`))
    expect(LEASE_TTL_MS).toBeGreaterThan(ROUTE_MAX_DURATION_S * 1000)
  })

  it('caps every client-controlled text field that reaches the prompt', () => {
    expect(MAX_OCCASION_LENGTH).toBeLessThanOrEqual(64)
    expect(MAX_STYLE_PROFILE_BYTES).toBeLessThanOrEqual(2_048)
    expect(MAX_AI_STYLE_PROFILE_BYTES).toBeLessThanOrEqual(8_192)
  })

  it('analysis text input (in bytes, an upper bound on tokens) fits maxTextInputTokens', () => {
    // Worst case over every garment mode and every occasion profile, with 4-byte characters everywhere the client
    // controls text (tests/helpers/promptBudget.ts). The style profile filler must itself be within its byte limit.
    const filler = '\u{1F600}'.repeat(Math.floor((MAX_STYLE_PROFILE_BYTES - 80) / 4))
    expect(utf8ByteLength(JSON.stringify({ preferredStyles: [filler], favoriteColors: [], occasionPreferences: [] }))).toBeLessThanOrEqual(MAX_STYLE_PROFILE_BYTES)
    const worst = worstCasePromptBytes()
    for (const model of SUPPORTED_MODEL_IDS) {
      expect(worst.bytes).toBeLessThanOrEqual(resolveModelConfig(model)!.operations.analysis.maxTextInputTokens)
    }
  })

  it('profile text input fits maxTextInputTokens', () => {
    const prompt = readFileSync(path.join(process.cwd(), 'memory', 'STYLE_PROFILE_SYSTEM_PROMPT.md'), 'utf8')
    const textBytes = utf8ByteLength(prompt) + 200 + 200
    for (const model of SUPPORTED_MODEL_IDS) {
      expect(textBytes).toBeLessThanOrEqual(resolveModelConfig(model)!.operations.profile.maxTextInputTokens)
    }
  })
})
