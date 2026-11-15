/**
 * Regression test: the API route's catch-all handler logs only the error type.
 * Error messages and stacks can carry request data or connection strings.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'

jest.mock('server-only', () => ({}), { virtual: true })
jest.mock('@/lib/services/openai/openAIAnalysisService', () => {
  const actual = jest.requireActual('@/lib/services/openai/openAIAnalysisService') as Record<string, unknown>
  return { ...actual, analyzeWithOpenAI: jest.fn() }
})

import { POST } from '@/app/api/[[...path]]/route'
import { analyzeWithOpenAI } from '@/lib/services/openai/openAIAnalysisService'
import { captureLogs, makePng } from './logTestUtils'

const originalEnv = { ...process.env }

beforeEach(() => {
  process.env = { ...originalEnv, NODE_ENV: 'production', ANALYSIS_MODE: 'openai' }
})

afterEach(() => {
  process.env = { ...originalEnv }
  jest.restoreAllMocks()
})

describe('API route unhandled errors', () => {
  it('returns a generic 500 and logs the error name only', async () => {
    const logs = captureLogs()
    const secretBearingError = new RangeError('MARKER connect mongodb://admin:hunter2@db.internal failed; body={"occasion":"MARKER skin tone"}')
    jest.mocked(analyzeWithOpenAI).mockRejectedValue(secretBearingError)

    const form = new FormData()
    form.append('occasion', 'Office Work')
    form.append('photo', makePng())
    form.append('garment', makePng())
    const response = await POST(new Request('http://localhost/api/analyze', { method: 'POST', body: form }), { params: Promise.resolve({ path: ['analyze'] }) })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' })

    const text = logs.text()
    for (const fragment of ['MARKER', 'hunter2', 'mongodb://', 'skin tone', 'at ']) expect(text).not.toContain(fragment)
    expect(logs.events()).toEqual([
      expect.objectContaining({ level: 'error', event: 'api_unhandled_error', endpoint: '/analyze', error_name: 'RangeError' }),
    ])
    expect(logs.events()[0].request_id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('handles a non-Error rejection', async () => {
    const logs = captureLogs()
    jest.mocked(analyzeWithOpenAI).mockRejectedValue('MARKER plain string rejection')

    const form = new FormData()
    form.append('occasion', 'Office Work')
    form.append('photo', makePng())
    form.append('garment', makePng())
    const response = await POST(new Request('http://localhost/api/analyze', { method: 'POST', body: form }), { params: Promise.resolve({ path: ['analyze'] }) })

    expect(response.status).toBe(500)
    expect(logs.text()).not.toContain('MARKER')
    expect(logs.events()[0]).toMatchObject({ event: 'api_unhandled_error', error_name: 'string' })
  })
})
