/**
 * The API route's cross-origin behaviour: disallowed origins are refused before
 * any validation, spend reservation or model call; CORS headers are sent only to
 * allowlisted origins; and the removed template endpoints stay removed.
 * OpenAI is mocked. No network calls are made.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { readFileSync } from 'node:fs'
import path from 'node:path'

jest.mock('server-only', () => ({}), { virtual: true })

import * as route from '@/app/api/[[...path]]/route'
import { allRated, makePng, openAIResponse } from '../helpers/fixtures'
import { captureLogs } from '../logging/logTestUtils'

const { GET, POST, OPTIONS } = route
const originalEnv = { ...process.env }
const HOST = 'verdict.example.com'

function context(routePath: string) {
  return { params: Promise.resolve({ path: routePath.split('/').filter(Boolean) }) }
}

function analyzeForm(): FormData {
  const form = new FormData()
  form.append('occasion', 'Client Presentation')
  form.append('photo', makePng(800, 800, 'photo.png'))
  form.append('garment', makePng(800, 800, 'garment.png'))
  form.append('styleProfile', JSON.stringify({ preferredStyles: [], favoriteColors: [], occasionPreferences: [] }))
  return form
}

function post(routePath: string, form: FormData, origin?: string) {
  const headers: Record<string, string> = { host: HOST }
  if (origin !== undefined) headers.origin = origin
  return POST(new Request(`https://${HOST}/api/${routePath}`, { method: 'POST', body: form, headers }), context(routePath))
}

function options(routePath: string, origin?: string) {
  const headers: Record<string, string> = { host: HOST, 'access-control-request-method': 'POST' }
  if (origin !== undefined) headers.origin = origin
  return OPTIONS(new Request(`https://${HOST}/api/${routePath}`, { method: 'OPTIONS', headers }))
}

function corsHeaderNames(response: Response): string[] {
  return [...response.headers.keys()].filter((key) => key.startsWith('access-control'))
}

let fetchSpy: jest.SpiedFunction<typeof fetch>

beforeEach(() => {
  process.env = { ...originalEnv, ANALYSIS_MODE: 'openai', OPENAI_API_KEY: 'sk-test-fake-key-origin-0000', OPENAI_MODEL: 'gpt-4.1' }
  delete process.env.CORS_ORIGINS
  fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async () =>
    openAIResponse({ status: 'complete', dimensions: allRated('Good'), shopping_advisor: { recommendations: [] } })
  )
  jest.spyOn(console, 'info').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  process.env = { ...originalEnv }
  jest.restoreAllMocks()
})

describe('POST from a disallowed origin', () => {
  it('is refused with 403 before any model call', async () => {
    const response = await post('analyze', analyzeForm(), 'https://evil.example')

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'forbidden_origin', message: 'This request is not allowed from this origin.' })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(corsHeaderNames(response)).toEqual([])
  })

  it('is refused for profile generation too', async () => {
    const form = new FormData()
    form.append('photo', makePng())
    const response = await post('generate-profile', form, 'https://evil.example')

    expect(response.status).toBe(403)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('is refused even when the request itself would be invalid, so nothing about validation is revealed', async () => {
    const response = await post('analyze', new FormData(), 'https://evil.example')
    expect(response.status).toBe(403)
  })

  it('is refused for the opaque "null" origin', async () => {
    const response = await post('analyze', analyzeForm(), 'null')
    expect(response.status).toBe(403)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('is still refused when CORS_ORIGINS is a wildcard', async () => {
    process.env.CORS_ORIGINS = '*'
    const response = await post('analyze', analyzeForm(), 'https://evil.example')
    expect(response.status).toBe(403)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('logs the rejection without the origin value', async () => {
    const logs = captureLogs()
    await post('analyze', analyzeForm(), 'https://evil.example')

    expect(logs.events()).toEqual([
      expect.objectContaining({ level: 'warn', event: 'api_origin_rejected', endpoint: '/analyze', http_status: 403 }),
    ])
    expect(logs.text()).not.toContain('evil.example')
  })
})

describe('POST from an allowed origin', () => {
  it('accepts the same origin and sends no CORS headers', async () => {
    const response = await post('analyze', analyzeForm(), `https://${HOST}`)

    expect(response.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(corsHeaderNames(response)).toEqual([])
    expect(response.headers.get('vary')).toContain('Origin')
  })

  it('accepts a request with no Origin header, as sent by non-browser clients', async () => {
    const response = await post('analyze', analyzeForm())
    expect(response.status).toBe(200)
    expect(corsHeaderNames(response)).toEqual([])
  })

  it('accepts an allowlisted origin and echoes exactly that origin', async () => {
    process.env.CORS_ORIGINS = 'https://partner.example.com'
    const response = await post('analyze', analyzeForm(), 'https://partner.example.com')

    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://partner.example.com')
    expect(response.headers.has('access-control-allow-credentials')).toBe(false)
  })

  it('sends CORS headers on error responses to an allowlisted origin, so the caller can read them', async () => {
    process.env.CORS_ORIGINS = 'https://partner.example.com'
    const response = await post('analyze', new FormData(), 'https://partner.example.com')

    expect(response.status).toBe(400)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://partner.example.com')
  })
})

describe('OPTIONS preflight', () => {
  it('answers an allowlisted origin with the minimum methods and headers', async () => {
    process.env.CORS_ORIGINS = 'https://partner.example.com'
    const response = await options('analyze', 'https://partner.example.com')

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://partner.example.com')
    expect(response.headers.get('access-control-allow-methods')).toBe('GET, POST, OPTIONS')
    expect(response.headers.get('access-control-allow-headers')).toBe('Content-Type')
    expect(response.headers.has('access-control-allow-credentials')).toBe(false)
    expect(response.headers.get('vary')).toContain('Origin')
  })

  it('refuses a disallowed origin with no CORS headers', async () => {
    const response = await options('analyze', 'https://evil.example')
    expect(response.status).toBe(403)
    expect(corsHeaderNames(response)).toEqual([])
  })

  it('answers a same-origin or origin-less OPTIONS without CORS headers', async () => {
    for (const origin of [`https://${HOST}`, undefined]) {
      const response = await options('analyze', origin)
      expect(response.status).toBe(204)
      expect(response.headers.get('allow')).toBe('GET, POST, OPTIONS')
      expect(corsHeaderNames(response)).toEqual([])
    }
  })
})

describe('GET requests', () => {
  it('answers a cross-origin GET but does not share the response', async () => {
    const response = await GET(new Request(`https://${HOST}/api/root`, { headers: { host: HOST, origin: 'https://evil.example' } }), context('root'))
    expect(response.status).toBe(200)
    expect(corsHeaderNames(response)).toEqual([])
  })
})

describe('no wildcard or credentialed CORS anywhere', () => {
  it('never emits "*" or Access-Control-Allow-Credentials for any origin', async () => {
    process.env.CORS_ORIGINS = '*, https://partner.example.com'
    const responses = [
      await post('analyze', new FormData(), 'https://partner.example.com'),
      await post('analyze', new FormData(), 'https://evil.example'),
      await post('analyze', new FormData(), `https://${HOST}`),
      await options('analyze', 'https://partner.example.com'),
      await options('analyze', 'https://evil.example'),
    ]
    for (const response of responses) {
      expect(response.headers.get('access-control-allow-origin')).not.toBe('*')
      expect(response.headers.has('access-control-allow-credentials')).toBe(false)
    }
  })
})

describe('removed template endpoints', () => {
  it('returns 404 for the former MongoDB status endpoints', async () => {
    const read = await GET(new Request(`https://${HOST}/api/status`, { headers: { host: HOST } }), context('status'))
    expect(read.status).toBe(404)

    const write = await POST(
      new Request(`https://${HOST}/api/status`, { method: 'POST', body: JSON.stringify({ client_name: 'x' }), headers: { host: HOST, 'content-type': 'application/json' } }),
      context('status')
    )
    expect(write.status).toBe(404)
  })

  it('no longer loads a database driver in the API route', () => {
    const source = readFileSync(path.join(process.cwd(), 'app/api/[[...path]]/route.js'), 'utf8')
    expect(source).not.toMatch(/mongodb|MongoClient|MONGO_URL|DB_NAME/)
  })

  it('exports only the methods the API implements', () => {
    expect(Object.keys(route).filter((name) => /^[A-Z]+$/.test(name)).sort()).toEqual(['GET', 'OPTIONS', 'POST'])
  })
})
