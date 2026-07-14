/**
 * Milestone 2 route integration tests for POST /api/generate-profile.
 * These exercise the catch-all Next route with real multipart requests.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'

jest.mock('server-only', () => ({}), { virtual: true })

import { POST } from '@/app/api/[[...path]]/route'

const originalEnv = { ...process.env }

function makeValidPng(): File {
  const buffer = new ArrayBuffer(33)
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  view.setUint32(8, 13)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  view.setUint32(16, 800)
  view.setUint32(20, 800)
  return new File([buffer], 'profile.png', { type: 'image/png' })
}

async function postProfile(formData = new FormData()) {
  formData.append('photo', makeValidPng())
  const request = new Request('http://localhost/api/generate-profile', {
    method: 'POST',
    body: formData,
  })
  return POST(request, { params: Promise.resolve({ path: ['generate-profile'] }) })
}

beforeEach(() => {
  process.env = { ...originalEnv }
})

afterEach(() => {
  process.env = { ...originalEnv }
  jest.restoreAllMocks()
})

describe('POST /api/generate-profile', () => {
  it('returns missing_image when no photo is sent', async () => {
    const request = new Request('http://localhost/api/generate-profile', {
      method: 'POST',
      body: new FormData(),
    })

    const response = await POST(request, { params: Promise.resolve({ path: ['generate-profile'] }) })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'missing_image' })
  })

  it('returns a timestamped, schema-valid mock profile', async () => {
    process.env.ANALYSIS_MODE = 'mock'
    jest.spyOn(global, 'setTimeout').mockImplementation((callback) => {
      if (typeof callback === 'function') callback()
      return 0 as unknown as ReturnType<typeof setTimeout>
    })

    const response = await postProfile()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe('complete')
    expect(body.generated_at_utc).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('returns server_error for missing OpenAI configuration', async () => {
    process.env.ANALYSIS_MODE = 'openai'
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_MODEL

    const response = await postProfile()

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({ error: 'server_error' })
  })

  it('returns rate_limit when OpenAI rate-limits a valid request', async () => {
    process.env.ANALYSIS_MODE = 'openai'
    process.env.OPENAI_API_KEY = 'test-key'
    process.env.OPENAI_MODEL = 'test-model'
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 429 }))

    const response = await postProfile()

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toMatchObject({ error: 'rate_limit' })
  })
})
