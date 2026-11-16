/**
 * @jest-environment jsdom
 *
 * Style DNA upload flow: nothing is sent before the user presses Build Style DNA,
 * a double press sends one request, and loading and error states are shown.
 * `fetch` is a mock and image preparation is mocked; no model is ever called.
 */

import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AIStyleProfileSection from '@/components/fashion/AIStyleProfileSection'
import { prepareImageForUpload } from '@/lib/images/prepareImageForUpload'
import { STORAGE_KEY } from '@/lib/services/aiStyleProfileService'
import { VALID_COMPLETE_PROFILE, VALID_FAILURE_RESPONSE } from '../phase3/fixtures'
import { deferred, fakeResponse, installObjectUrlMocks, setNavigatorOnline, syntheticFile } from '../helpers/uploadTestUtils'

jest.mock('@/lib/images/prepareImageForUpload', () => ({
  ...jest.requireActual('@/lib/images/prepareImageForUpload'),
  prepareImageForUpload: jest.fn(),
}))

// Animations are presentation only; without them view changes are immediate.
jest.mock('framer-motion', () => {
  const React = jest.requireActual('react')
  const Plain = React.forwardRef(function Plain(props: Record<string, unknown>, ref: unknown) {
    const { initial, animate, exit, transition, variants, whileHover, whileTap, layout, ...rest } = props
    return React.createElement('div', { ...rest, ref })
  })
  return {
    AnimatePresence: (props: { children?: unknown }) => React.createElement(React.Fragment, null, props.children),
    motion: new Proxy({}, { get: () => Plain }),
  }
})

const prepareMock = prepareImageForUpload as jest.MockedFunction<typeof prepareImageForUpload>
const PREPARED_BYTES = 1_234

let fetchMock: jest.Mock
let setItemSpy: jest.SpyInstance

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  installObjectUrlMocks()
  setNavigatorOnline(true)
  fetchMock = jest.fn()
  ;(globalThis as { fetch?: unknown }).fetch = fetchMock
  setItemSpy = jest.spyOn(Storage.prototype, 'setItem')
  prepareMock.mockReset()
  prepareMock.mockImplementation(async () => ({
    file: syntheticFile('My Holiday Selfie.jpg', 'image/jpeg', PREPARED_BYTES),
    width: 1152,
    height: 1536,
    quality: 0.86,
    sourceWidth: 3024,
    sourceHeight: 4032,
  }))
})

/** Opens the upload step and selects a photo, stopping before submission. */
async function selectPhoto(user: ReturnType<typeof userEvent.setup>) {
  render(<AIStyleProfileSection />)
  await user.click(screen.getByRole('button', { name: 'Build Style DNA' }))
  await user.upload(screen.getByTestId('upload-gallery-input'), syntheticFile('My Holiday Selfie.png', 'image/png', 9_000))
  await screen.findByAltText('Style DNA photo preview')
  return screen.getByRole('button', { name: 'Build Style DNA' }) as HTMLButtonElement
}

describe('AIStyleProfileSection capture', () => {
  it('uses the front camera for the Style DNA photo and rejects undersized photos', async () => {
    const user = userEvent.setup()
    render(<AIStyleProfileSection />)
    await user.click(screen.getByRole('button', { name: 'Build Style DNA' }))

    expect(screen.getByTestId('upload-camera-input').getAttribute('capture')).toBe('user')
    expect(screen.getByTestId('upload-gallery-input').hasAttribute('capture')).toBe(false)

    await user.upload(screen.getByTestId('upload-gallery-input'), syntheticFile('selfie.jpg'))
    await screen.findByAltText('Style DNA photo preview')
    expect(prepareMock.mock.calls[0][1]).toMatchObject({ belowMinimum: 'reject' })
  })

  it('returns to the photo step when the photo is removed', async () => {
    const user = userEvent.setup()
    await selectPhoto(user)

    await user.click(screen.getByRole('button', { name: 'Remove Style DNA photo' }))

    expect(screen.queryByAltText('Style DNA photo preview')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Build Style DNA' })).toBeNull()
    expect(screen.getByRole('button', { name: /choose from gallery/i })).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('AIStyleProfileSection submission', () => {
  it('uploads nothing and stores nothing until Build Style DNA is pressed', async () => {
    const user = userEvent.setup()
    await selectPhoto(user)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
  })

  it('sends the prepared photo once, under a generic file name', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(fakeResponse(200, VALID_FAILURE_RESPONSE))
    const submit = await selectPhoto(user)

    await user.click(submit)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/generate-profile')
    expect(init.method).toBe('POST')
    const sent = (init.body as FormData).get('photo') as File
    expect(sent.name).toBe('photo.jpg')
    expect(sent.type).toBe('image/jpeg')
    expect(sent.size).toBe(PREPARED_BYTES)
    expect([...(init.body as FormData).keys()]).toEqual(['photo'])
  })

  it('sends one request when the submit button is pressed twice before the page updates', async () => {
    const user = userEvent.setup()
    const pending = deferred<ReturnType<typeof fakeResponse>>()
    fetchMock.mockReturnValue(pending.promise)
    const submit = await selectPhoto(user)

    // Both presses land before React re-renders, so only the in-flight guard can stop the second.
    act(() => {
      submit.click()
      submit.click()
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => pending.resolve(fakeResponse(200, VALID_FAILURE_RESPONSE)))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('shows a loading state with no submit button while the request is in flight', async () => {
    const user = userEvent.setup()
    const pending = deferred<ReturnType<typeof fakeResponse>>()
    fetchMock.mockReturnValue(pending.promise)
    const submit = await selectPhoto(user)

    await user.click(submit)

    expect(screen.getByRole('status').textContent).toMatch(/Understanding your style/)
    expect(screen.queryByRole('button', { name: 'Build Style DNA' })).toBeNull()
    expect(screen.queryByTestId('upload-gallery-input')).toBeNull()

    await act(async () => pending.resolve(fakeResponse(200, VALID_FAILURE_RESPONSE)))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('saves only the generated profile, never the photo, on success', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(fakeResponse(200, VALID_COMPLETE_PROFILE))
    const submit = await selectPhoto(user)

    await user.click(submit)

    await screen.findByRole('button', { name: /regenerate style dna/i })
    expect(setItemSpy.mock.calls.map(([key]) => key)).toEqual([STORAGE_KEY])
    const stored = String(setItemSpy.mock.calls[0][1])
    expect(JSON.parse(stored).status).toBe('complete')
    expect(stored).not.toMatch(/data:image|blob:|base64/i)
    expect(window.sessionStorage.length).toBe(0)
  })

  it('allows a new submission after a failed one, without retrying on its own', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(fakeResponse(503, { error: 'service_unavailable', message: 'The analysis service is temporarily unavailable. Please try again later.' }))
    fetchMock.mockResolvedValueOnce(fakeResponse(200, VALID_FAILURE_RESPONSE))
    const submit = await selectPhoto(user)

    await user.click(submit)
    await screen.findByRole('alert')
    // No automatic retry: still exactly one request after the failure.
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: /try again/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })
})

describe('AIStyleProfileSection error states', () => {
  const cases: Array<[string, number, unknown, RegExp]> = [
    ['400 invalid upload', 400, { error: 'invalid_upload', message: 'Image must be at least 512×512 pixels.' }, /at least 512×512 pixels/],
    ['413 payload too large', 413, 'not json', /too large to send/],
    ['429 rate limited', 429, { error: 'rate_limit', message: 'You have reached the analysis limit for now. Please try again later.' }, /reached the analysis limit/],
    ['503 unavailable (spend guard fails closed)', 503, { error: 'service_unavailable', message: 'The analysis service is temporarily unavailable. Please try again later.' }, /temporarily unavailable/],
    ['504 timeout', 504, { error: 'timeout', message: 'The analysis took too long. Please try again.' }, /took too long/],
  ]

  it.each(cases)('shows a clear message for HTTP %s', async (_label, status, body, expected) => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(fakeResponse(status, body))
    const submit = await selectPhoto(user)

    await user.click(submit)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(expected)
    expect(alert.textContent).toMatch(/We couldn’t build your Style DNA/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports being offline without sending the photo', async () => {
    const user = userEvent.setup()
    const submit = await selectPhoto(user)
    setNavigatorOnline(false)

    await user.click(submit)

    expect((await screen.findByRole('alert')).textContent).toMatch(/appear to be offline/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports a network failure', async () => {
    const user = userEvent.setup()
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const submit = await selectPhoto(user)

    await user.click(submit)

    expect((await screen.findByRole('alert')).textContent).toMatch(/could not reach the analysis service/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('shows the model-reported reason when a profile cannot be generated', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(fakeResponse(200, VALID_FAILURE_RESPONSE))
    const submit = await selectPhoto(user)

    await user.click(submit)

    expect((await screen.findByRole('alert')).textContent).toContain(VALID_FAILURE_RESPONSE.reason)
    expect(setItemSpy).not.toHaveBeenCalled()
  })

  it('rejects a success response that is not a valid Style DNA', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(fakeResponse(200, { status: 'complete', unexpected: true }))
    const submit = await selectPhoto(user)

    await user.click(submit)

    expect((await screen.findByRole('alert')).textContent).toMatch(/could not generate your style profile/)
    expect(setItemSpy).not.toHaveBeenCalled()
  })
})
