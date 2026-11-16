/**
 * Client upload helper: one request per call, a client-side timeout, and a clear
 * result for offline, network and HTTP 400, 413, 429, 503 failures.
 * `fetch` is always mocked; nothing leaves the test process.
 */

import { postFormData, UPLOAD_TIMEOUT_MS } from '@/lib/services/uploadRequest'

type FetchMock = jest.Mock<Promise<unknown>, [string, RequestInit]>

function fakeResponse(status: number, body: unknown, options: { invalidJson?: boolean } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (options.invalidJson) throw new SyntaxError('Unexpected token <')
      return body
    },
  }
}

function setOnline(value: boolean | undefined): void {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: value === undefined ? undefined : { onLine: value } })
}

/** A fetch that never answers until its signal aborts, like a stalled connection. */
function hangingFetch(): FetchMock {
  return jest.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })))
  }))
}

const originalFetch = globalThis.fetch
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
let fetchMock: FetchMock

beforeEach(() => {
  fetchMock = jest.fn()
  globalThis.fetch = fetchMock as unknown as typeof fetch
  setOnline(true)
})

afterEach(() => {
  jest.useRealTimers()
  globalThis.fetch = originalFetch
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator)
})

describe('postFormData', () => {
  it('returns the parsed body for a successful response and sends exactly one POST', async () => {
    fetchMock.mockResolvedValue(fakeResponse(200, { status: 'complete' }))
    const formData = new FormData()

    const result = await postFormData('/api/analyze', formData)

    expect(result).toEqual({ ok: true, data: { status: 'complete' } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/analyze')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(formData)
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('maps HTTP 400 to an invalid upload with the API message', async () => {
    fetchMock.mockResolvedValue(fakeResponse(400, { error: 'invalid_upload', message: 'Garment photo: Image must be at least 512×512 pixels.' }))
    const result = await postFormData('/api/analyze', new FormData())
    expect(result).toMatchObject({ ok: false, kind: 'invalid_request', status: 400, errorCode: 'invalid_upload', title: 'Invalid Upload', message: 'Garment photo: Image must be at least 512×512 pixels.' })
  })

  it('titles a missing-image 400 as missing information', async () => {
    fetchMock.mockResolvedValue(fakeResponse(400, { error: 'missing_image', message: 'Please upload a photo to generate your profile.' }))
    const result = await postFormData('/api/generate-profile', new FormData())
    expect(result).toMatchObject({ ok: false, kind: 'invalid_request', title: 'Missing Information' })
  })

  it('maps HTTP 413 to a photos-too-large error and ignores the platform body', async () => {
    fetchMock.mockResolvedValue(fakeResponse(413, { message: 'FUNCTION_PAYLOAD_TOO_LARGE internal detail' }))
    const result = await postFormData('/api/analyze', new FormData())
    expect(result).toMatchObject({ ok: false, kind: 'payload_too_large', status: 413, title: 'Photos Too Large' })
    expect((result as { message: string }).message).not.toMatch(/FUNCTION_PAYLOAD_TOO_LARGE/)
  })

  it('handles a 413 whose body is not JSON', async () => {
    fetchMock.mockResolvedValue(fakeResponse(413, null, { invalidJson: true }))
    const result = await postFormData('/api/analyze', new FormData())
    expect(result).toMatchObject({ ok: false, kind: 'payload_too_large' })
  })

  it('maps HTTP 429 to a wait message, preferring the API explanation', async () => {
    fetchMock.mockResolvedValue(fakeResponse(429, { error: 'rate_limit', message: 'Your previous analysis is still running. Please wait for it to finish.' }))
    const specific = await postFormData('/api/analyze', new FormData())
    expect(specific).toMatchObject({ ok: false, kind: 'rate_limited', status: 429, title: 'Please Wait', message: 'Your previous analysis is still running. Please wait for it to finish.' })

    fetchMock.mockResolvedValue(fakeResponse(429, {}))
    const generic = await postFormData('/api/analyze', new FormData())
    expect(generic).toMatchObject({ ok: false, kind: 'rate_limited', message: 'Too many requests right now. Please wait a moment and try again.' })
  })

  it('maps HTTP 503 to service unavailable, as returned when the spend guard fails closed', async () => {
    fetchMock.mockResolvedValue(fakeResponse(503, { error: 'service_unavailable', message: 'The analysis service is temporarily unavailable. Please try again later.' }))
    const result = await postFormData('/api/analyze', new FormData())
    expect(result).toMatchObject({ ok: false, kind: 'unavailable', status: 503, title: 'Service Unavailable', message: 'The analysis service is temporarily unavailable. Please try again later.' })
  })

  it('maps HTTP 504 to a timeout and other 5xx to a server error', async () => {
    fetchMock.mockResolvedValue(fakeResponse(504, { error: 'server_error', message: 'The analysis took too long. Please try again.' }))
    expect(await postFormData('/api/analyze', new FormData())).toMatchObject({ ok: false, kind: 'timeout', status: 504 })

    fetchMock.mockResolvedValue(fakeResponse(502, { error: 'server_error', message: 'The analysis could not be completed reliably. Please try again.' }))
    expect(await postFormData('/api/analyze', new FormData())).toMatchObject({ ok: false, kind: 'server_error', status: 502, message: 'The analysis could not be completed reliably. Please try again.' })
  })

  it('never shows a server message that is not short plain text', async () => {
    fetchMock.mockResolvedValue(fakeResponse(500, { message: 'x'.repeat(301) }))
    expect(await postFormData('/api/analyze', new FormData())).toMatchObject({ message: 'Something went wrong on our side. Please try again.' })

    fetchMock.mockResolvedValue(fakeResponse(500, { message: { nested: true } }))
    expect(await postFormData('/api/analyze', new FormData())).toMatchObject({ message: 'Something went wrong on our side. Please try again.' })
  })

  it('reports being offline without sending anything', async () => {
    setOnline(false)
    const result = await postFormData('/api/analyze', new FormData())
    expect(result).toMatchObject({ ok: false, kind: 'offline', title: 'You Are Offline' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports a dropped connection as offline when the device went offline mid-request', async () => {
    fetchMock.mockImplementation(async () => {
      setOnline(false)
      throw new TypeError('Failed to fetch')
    })
    const result = await postFormData('/api/analyze', new FormData())
    expect(result).toMatchObject({ ok: false, kind: 'offline' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports a network failure and does not retry', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const result = await postFormData('/api/analyze', new FormData())
    expect(result).toMatchObject({ ok: false, kind: 'network', title: 'Connection Problem' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not retry after any failed status', async () => {
    for (const status of [400, 413, 429, 500, 502, 503, 504]) {
      fetchMock.mockClear()
      fetchMock.mockResolvedValue(fakeResponse(status, {}))
      const result = await postFormData('/api/analyze', new FormData())
      expect(result.ok).toBe(false)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  })

  it('uses a timeout of about 70 seconds, above the 60 second route limit', () => {
    expect(UPLOAD_TIMEOUT_MS).toBe(70_000)
  })

  it('aborts the request and reports a timeout when no response arrives in time', async () => {
    jest.useFakeTimers()
    fetchMock = hangingFetch()
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const pending = postFormData('/api/analyze', new FormData())
    await jest.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS - 1)
    expect(fetchMock.mock.calls[0][1].signal?.aborted).toBe(false)

    await jest.advanceTimersByTimeAsync(1)
    const result = await pending

    expect(fetchMock.mock.calls[0][1].signal?.aborted).toBe(true)
    expect(result).toMatchObject({ ok: false, kind: 'timeout', title: 'Taking Too Long' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports a caller cancellation separately from a timeout', async () => {
    fetchMock = hangingFetch()
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const controller = new AbortController()

    const pending = postFormData('/api/analyze', new FormData(), { signal: controller.signal })
    controller.abort()

    expect(await pending).toMatchObject({ ok: false, kind: 'cancelled' })
  })

  it('reports an unreadable success body as an invalid response', async () => {
    fetchMock.mockResolvedValue(fakeResponse(200, null, { invalidJson: true }))
    expect(await postFormData('/api/analyze', new FormData())).toMatchObject({ ok: false, kind: 'invalid_response', status: 200 })
  })

  it('works where navigator is unavailable', async () => {
    setOnline(undefined)
    fetchMock.mockResolvedValue(fakeResponse(200, { ok: 1 }))
    expect(await postFormData('/api/analyze', new FormData())).toEqual({ ok: true, data: { ok: 1 } })
  })
})
