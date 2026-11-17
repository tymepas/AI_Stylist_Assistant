/**
 * @jest-environment jsdom
 *
 * Outfit analysis flow with one garment photo: camera hints per step, no upload
 * before Analyze is pressed, one request for a double press, and loading and
 * error states. Several garment photos are covered in GarmentJourney.test.tsx.
 * `fetch` is a mock and image preparation is mocked; no model is ever called.
 */

import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AnalysisPage from '@/app/dashboard/analysis/page'
import { OCCASION_GROUPS } from '@/lib/constants/options'
import { prepareImageForUpload } from '@/lib/images/prepareImageForUpload'
import { deferred, fakeResponse, installObjectUrlMocks, setNavigatorOnline, syntheticFile, type ObjectUrlMocks } from '../helpers/uploadTestUtils'

jest.mock('@/lib/images/prepareImageForUpload', () => ({
  ...jest.requireActual('@/lib/images/prepareImageForUpload'),
  prepareImageForUpload: jest.fn(),
}))

// Animations are presentation only; without them step changes are immediate.
jest.mock('framer-motion', () => {
  const React = jest.requireActual('react')
  const Plain = React.forwardRef(function Plain(props: Record<string, unknown>, ref: unknown) {
    const { initial, animate, exit, transition, variants, whileHover, whileTap, whileInView, viewport, layout, ...rest } = props
    return React.createElement('div', { ...rest, ref })
  })
  return {
    AnimatePresence: (props: { children?: unknown }) => React.createElement(React.Fragment, null, props.children),
    motion: new Proxy({}, { get: () => Plain }),
  }
})

jest.mock('next/link', () => {
  const React = jest.requireActual('react')
  return {
    __esModule: true,
    default: (props: { href: string; children?: unknown; className?: string }) =>
      React.createElement('a', { href: props.href, className: props.className }, props.children),
  }
})

// The Radix select needs layout APIs jsdom lacks; a native select exercises the same page logic.
jest.mock('@/components/ui/select', () => {
  const React = jest.requireActual('react')
  const Fragment = (props: { children?: unknown }) => React.createElement(React.Fragment, null, props.children)
  return {
    Select: (props: { value: string; onValueChange: (value: string) => void; children?: unknown }) =>
      React.createElement(
        'select',
        { 'data-testid': 'occasion-select', value: props.value, onChange: (event: { target: { value: string } }) => props.onValueChange(event.target.value) },
        React.createElement('option', { value: '' }, 'Select an occasion'),
        props.children
      ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectLabel: () => null,
    SelectContent: Fragment,
    SelectGroup: Fragment,
    SelectItem: (props: { value: string; children?: unknown }) => React.createElement('option', { value: props.value }, props.children),
  }
})

jest.mock('@/components/fashion/DecisionReport', () => {
  const React = jest.requireActual('react')
  return {
    __esModule: true,
    default: (props: { result: { overall_recommendation: string } }) =>
      React.createElement('div', { 'data-testid': 'decision-report' }, props.result.overall_recommendation),
  }
})

const prepareMock = prepareImageForUpload as jest.MockedFunction<typeof prepareImageForUpload>
const OCCASION = OCCASION_GROUPS[0].options[0]
const PHOTO_BYTES = 1_111
const GARMENT_BYTES = 2_222

const COMPLETE_RESULT = {
  status: 'complete',
  overall_recommendation: 'Recommended',
  verdict_score: 4.1,
  dimensions: {},
  things_to_consider: [],
  analysis_based_on: { considered: [], not_considered: [] },
  next_step: '',
}

let fetchMock: jest.Mock
let setItemSpy: jest.SpyInstance
let objectUrls: ObjectUrlMocks

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  objectUrls = installObjectUrlMocks()
  setNavigatorOnline(true)
  fetchMock = jest.fn()
  ;(globalThis as { fetch?: unknown }).fetch = fetchMock
  setItemSpy = jest.spyOn(Storage.prototype, 'setItem')
  prepareMock.mockReset()
  prepareMock.mockImplementation(async (file) => ({
    file: syntheticFile(file.name.replace(/\.\w+$/, '.jpg'), 'image/jpeg', file.name.startsWith('garment') ? GARMENT_BYTES : PHOTO_BYTES),
    width: 1152,
    height: 1536,
    quality: 0.86,
    sourceWidth: 3024,
    sourceHeight: 4032,
  }))
})

/**
 * Walks the journey for one garment photo (photo, garment mode, garment, occasion,
 * optional preferences, review) and returns the Analyze button, without pressing it.
 */
async function fillForm(user: ReturnType<typeof userEvent.setup>) {
  render(<AnalysisPage />)
  const next = () => user.click(screen.getByRole('button', { name: /continue/i }))

  expect(screen.getByTestId('upload-camera-input').getAttribute('capture')).toBe('user')
  await user.upload(screen.getByTestId('upload-gallery-input'), syntheticFile('selfie-original.png', 'image/png', 50_000))
  await screen.findByAltText('Current Photo preview')
  await next()

  // The garment mode is always chosen by the user; nothing is preselected.
  await user.click(screen.getByTestId('garment-mode-single'))
  await next()

  expect(screen.getByTestId('upload-camera-input').getAttribute('capture')).toBe('environment')
  await user.upload(screen.getByTestId('upload-gallery-input'), syntheticFile('garment-original.webp', 'image/webp', 60_000))
  await screen.findByAltText('Clothing Image preview')
  await next()

  await user.selectOptions(screen.getByTestId('occasion-select'), OCCASION)
  await next()

  // Style preferences are optional: continue without choosing any.
  await next()

  return screen.getByRole('button', { name: /analyze/i }) as HTMLButtonElement
}

describe('AnalysisPage capture', () => {
  it('uses the front camera for the personal photo and the rear camera for the garment', async () => {
    const user = userEvent.setup()
    await fillForm(user)
    expect(prepareMock).toHaveBeenCalledTimes(2)
  })

  it('keeps Continue disabled until a photo has been prepared', async () => {
    const user = userEvent.setup()
    render(<AnalysisPage />)
    const continueButton = screen.getByRole('button', { name: /continue/i }) as HTMLButtonElement
    expect(continueButton.disabled).toBe(true)

    await user.upload(screen.getByTestId('upload-gallery-input'), syntheticFile('selfie.jpg'))
    await screen.findByAltText('Current Photo preview')
    expect(continueButton.disabled).toBe(false)
  })

  it('still shows the chosen photo after going to the next step and back', async () => {
    const user = userEvent.setup()
    render(<AnalysisPage />)
    await user.upload(screen.getByTestId('upload-gallery-input'), syntheticFile('selfie.jpg'))
    await screen.findByAltText('Current Photo preview')

    await user.click(screen.getByRole('button', { name: /continue/i }))
    await user.click(screen.getByRole('button', { name: /back/i }))

    expect(await screen.findByAltText('Current Photo preview')).toBeTruthy()
  })
})

describe('AnalysisPage submission', () => {
  it('uploads nothing and stores no image before Analyze is pressed', async () => {
    const user = userEvent.setup()
    const analyze = await fillForm(user)

    expect(analyze.disabled).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(window.sessionStorage.length).toBe(0)
  })

  it('sends both prepared images once, under generic file names, with the occasion', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(fakeResponse(200, COMPLETE_RESULT))
    const analyze = await fillForm(user)

    await user.click(analyze)

    await screen.findByTestId('decision-report')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/analyze')
    expect(init.method).toBe('POST')
    const body = init.body as FormData
    expect(body.get('occasion')).toBe(OCCASION)
    const photo = body.get('photo') as File
    const garment = body.get('garment') as File
    expect([photo.name, photo.type, photo.size]).toEqual(['photo.jpg', 'image/jpeg', PHOTO_BYTES])
    expect([garment.name, garment.type, garment.size]).toEqual(['garment.jpg', 'image/jpeg', GARMENT_BYTES])
    // Exactly one garment file, and the mode the user chose is sent explicitly.
    expect(body.getAll('garment')).toHaveLength(1)
    expect(body.get('garmentMode')).toBe('single')
    expect(JSON.parse(String(body.get('styleProfile')))).toEqual({ preferredStyles: [], favoriteColors: [], occasionPreferences: [] })
    expect(body.has('aiStyleProfile')).toBe(false)
  })

  it('sends one request when Analyze is pressed twice before the page updates', async () => {
    const user = userEvent.setup()
    const pending = deferred<ReturnType<typeof fakeResponse>>()
    fetchMock.mockReturnValue(pending.promise)
    const analyze = await fillForm(user)

    // Both presses land before React re-renders, so only the in-flight guard can stop the second.
    act(() => {
      analyze.click()
      analyze.click()
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => pending.resolve(fakeResponse(200, COMPLETE_RESULT)))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('shows the loading state, with no Analyze button, while the request is in flight', async () => {
    const user = userEvent.setup()
    const pending = deferred<ReturnType<typeof fakeResponse>>()
    fetchMock.mockReturnValue(pending.promise)
    const analyze = await fillForm(user)

    await user.click(analyze)

    expect(screen.getByRole('status').textContent).toMatch(/Analyzing your decision/)
    expect(screen.queryByRole('button', { name: /analyze/i })).toBeNull()

    await act(async () => pending.resolve(fakeResponse(200, COMPLETE_RESULT)))
    expect(await screen.findByTestId('decision-report')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('never writes an image to browser storage during a full analysis', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(fakeResponse(200, COMPLETE_RESULT))
    const analyze = await fillForm(user)

    await user.click(analyze)
    await screen.findByTestId('decision-report')

    expect(setItemSpy).not.toHaveBeenCalled()
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
  })

  it('releases every preview URL when the page unmounts', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<AnalysisPage />)
    await user.upload(screen.getByTestId('upload-gallery-input'), syntheticFile('selfie.jpg'))
    await screen.findByAltText('Current Photo preview')
    expect(objectUrls.live().length).toBeGreaterThan(0)

    unmount()

    expect(objectUrls.live()).toEqual([])
  })
})

describe('AnalysisPage error states', () => {
  const cases: Array<[string, number, unknown, string, RegExp]> = [
    ['400 invalid upload', 400, { error: 'invalid_upload', message: 'Garment photo: Image must be at least 512×512 pixels.' }, 'Invalid Upload', /Garment photo: Image must be at least 512×512 pixels/],
    ['400 missing image', 400, { error: 'missing_image', message: 'Please upload a personal photo, a garment image, and select an occasion before analyzing.' }, 'Missing Information', /select an occasion/],
    ['413 payload too large', 413, 'not json', 'Photos Too Large', /too large to send/],
    ['429 rate limited', 429, { error: 'rate_limit', message: 'You have reached the analysis limit for now. Please try again later.' }, 'Please Wait', /reached the analysis limit/],
    ['503 unavailable (spend guard fails closed)', 503, { error: 'service_unavailable', message: 'The analysis service is temporarily unavailable. Please try again later.' }, 'Service Unavailable', /temporarily unavailable/],
    ['504 timeout', 504, { error: 'server_error', message: 'The analysis took too long. Please try again.' }, 'Taking Too Long', /took too long/],
    ['502 unreliable output', 502, { error: 'server_error', message: 'The analysis could not be completed reliably. Please try again.' }, 'Something Went Wrong', /could not be completed reliably/],
  ]

  it.each(cases)('shows the right title and message for HTTP %s', async (_label, status, body, title, message) => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(fakeResponse(status, body))
    const analyze = await fillForm(user)

    await user.click(analyze)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(title)
    expect(alert.textContent).toMatch(message)
    // No automatic retry.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports being offline without sending the photos', async () => {
    const user = userEvent.setup()
    const analyze = await fillForm(user)
    setNavigatorOnline(false)

    await user.click(analyze)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('You Are Offline')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports a network failure without retrying', async () => {
    const user = userEvent.setup()
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const analyze = await fillForm(user)

    await user.click(analyze)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Connection Problem')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('shows the unable-to-analyze reason returned by the API', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(fakeResponse(200, { status: 'unable_to_analyze', reason: 'No person is visible.', confidence: 'Low', next_step: 'Retake the photo.' }))
    const analyze = await fillForm(user)

    await user.click(analyze)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Unable to Analyze')
    expect(alert.textContent).toContain('No person is visible. Retake the photo.')
  })

  it('rejects a success response with an unexpected shape', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(fakeResponse(200, { hello: 'world' }))
    const analyze = await fillForm(user)

    await user.click(analyze)

    expect((await screen.findByRole('alert')).textContent).toMatch(/unexpected response/)
    expect(screen.queryByTestId('decision-report')).toBeNull()
  })

  it('returns to the form with both photos kept after an error, and allows a new attempt', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(fakeResponse(503, { error: 'service_unavailable', message: 'The analysis service is temporarily unavailable. Please try again later.' }))
    fetchMock.mockResolvedValueOnce(fakeResponse(200, COMPLETE_RESULT))
    const analyze = await fillForm(user)

    await user.click(analyze)
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: /try again/i }))

    const retryAnalyze = screen.getByRole('button', { name: /analyze/i }) as HTMLButtonElement
    expect(retryAnalyze.disabled).toBe(false)
    await user.click(retryAnalyze)

    await screen.findByTestId('decision-report')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })
})
