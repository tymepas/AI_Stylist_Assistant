/**
 * @jest-environment jsdom
 *
 * Replacing garment photos: what happens to the photos already added when a
 * replacement succeeds, is refused, fails to prepare or is cancelled, and what
 * is finally sent. Complements GarmentJourney.test.tsx, which covers adding,
 * reordering and the garment modes.
 *
 * The rule under test (from the QA fix in PR #15): where a card is one of
 * several, the photo in it stays until its replacement has been prepared and
 * accepted. A card that holds the only photo (the personal photo, or the single
 * garment photo) drops its photo as soon as another one is chosen. That
 * difference is deliberate and is pinned here, so a change to either behaviour
 * shows up as a failing test.
 *
 * `fetch` is a mock and image preparation is mocked; no model is ever called
 * and every file is synthetic.
 */

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AnalysisPage from '@/app/dashboard/analysis/page'
import { OCCASION_GROUPS } from '@/lib/constants/options'
import { ImagePreparationError, prepareImageForUpload } from '@/lib/images/prepareImageForUpload'
import { deferred, fakeResponse, installObjectUrlMocks, setNavigatorOnline, syntheticFile } from '../helpers/uploadTestUtils'

jest.mock('@/lib/images/prepareImageForUpload', () => ({
  ...jest.requireActual('@/lib/images/prepareImageForUpload'),
  prepareImageForUpload: jest.fn(),
}))

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
  return { __esModule: true, default: (props: { href: string; children?: unknown; className?: string }) => React.createElement('a', { href: props.href, className: props.className }, props.children) }
})

jest.mock('@/components/ui/select', () => {
  const React = jest.requireActual('react')
  const Fragment = (props: { children?: unknown }) => React.createElement(React.Fragment, null, props.children)
  return {
    Select: (props: { value: string; onValueChange: (value: string) => void; children?: unknown }) =>
      React.createElement('select', { 'data-testid': 'occasion-select', value: props.value, onChange: (event: { target: { value: string } }) => props.onValueChange(event.target.value) }, React.createElement('option', { value: '' }, 'Select an occasion'), props.children),
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
  return { __esModule: true, default: (props: { result: { overall_recommendation: string } }) => React.createElement('div', { 'data-testid': 'decision-report' }, props.result.overall_recommendation) }
})

const prepareMock = prepareImageForUpload as jest.MockedFunction<typeof prepareImageForUpload>
const OCCASION = OCCASION_GROUPS[0].options[0]
const COMPLETE_RESULT = { status: 'complete', overall_recommendation: 'Recommended', verdict_score: 4.1, dimensions: {}, things_to_consider: [], analysis_based_on: { considered: [], not_considered: [] }, next_step: '' }

let fetchMock: jest.Mock

/** A prepared file whose bytes depend on the name of the chosen file, so the same choice gives the same content. */
function preparedFrom(name: string): File {
  const base = name.replace(/\.\w+$/, '')
  return new File([`prepared:${base}`.padEnd(64, '.')], `${base}.jpg`, { type: 'image/jpeg' })
}

const prepared = (name: string) => ({ file: preparedFrom(name), width: 1152, height: 1536, quality: 0.86, sourceWidth: 3024, sourceHeight: 4032 })

beforeEach(() => {
  window.localStorage.clear()
  installObjectUrlMocks()
  setNavigatorOnline(true)
  fetchMock = jest.fn().mockResolvedValue(fakeResponse(200, COMPLETE_RESULT))
  ;(globalThis as { fetch?: unknown }).fetch = fetchMock
  prepareMock.mockReset()
  prepareMock.mockImplementation(async (file) => prepared(file.name))
})

/** jsdom files have no text(): read them with a FileReader. */
function readText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}

type User = ReturnType<typeof userEvent.setup>
const next = (user: User) => user.click(screen.getByRole('button', { name: /continue/i }))
const continueButton = () => screen.getByRole('button', { name: /continue/i }) as HTMLButtonElement
const slot = (number: number) => within(screen.getByTestId(`garment-slot-${number}`))

async function toGarmentStep(user: User, mode: 'single' | 'same_garment_views' | 'outfit_items') {
  render(<AnalysisPage />)
  await user.upload(screen.getByTestId('upload-gallery-input'), syntheticFile('selfie.jpg'))
  await screen.findByAltText('Current Photo preview')
  await next(user)
  await user.click(screen.getByTestId(`garment-mode-${mode}`))
  await next(user)
}

async function addGarment(user: User, slotNumber: number, name: string, previewLabel: string) {
  await user.upload(slot(slotNumber).getByTestId('upload-gallery-input'), syntheticFile(name))
  await screen.findByAltText(`${previewLabel} preview`)
}

async function withThreeItems(user: User) {
  await toGarmentStep(user, 'outfit_items')
  await addGarment(user, 1, 'shirt.jpg', 'Outfit item 1')
  await addGarment(user, 2, 'trousers.jpg', 'Outfit item 2')
  await addGarment(user, 3, 'jacket.jpg', 'Outfit item 3')
}

/** Completes the journey and returns what was sent: the garment contents in order, their names and the mode. */
async function submit(user: User) {
  await next(user)
  await user.selectOptions(screen.getByTestId('occasion-select'), OCCASION)
  await next(user)
  await next(user)
  await user.click(screen.getByRole('button', { name: /analyze/i }))
  await screen.findByTestId('decision-report')
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const body = (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as FormData
  const garments = body.getAll('garment') as File[]
  return {
    garments: (await Promise.all(garments.map(readText))).map((text) => text.replace(/\.+$/, '')),
    names: garments.map((file) => file.name),
    mode: body.get('garmentMode'),
    photos: body.getAll('photo').length,
  }
}

describe('a successful replacement', () => {
  it('replaces only that photo, in place, and sends the new photo in the same position', async () => {
    const user = userEvent.setup()
    await withThreeItems(user)

    await user.upload(slot(2).getByTestId('upload-gallery-input'), syntheticFile('chinos.jpg'))
    await waitFor(() => expect(prepareMock).toHaveBeenCalledTimes(5)) // the selfie, three items, the replacement
    await screen.findByAltText('Outfit item 2 preview')

    expect(screen.getByTestId('garment-count').textContent).toBe('3 of 3 photos added')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(await submit(user)).toEqual({
      garments: ['prepared:shirt', 'prepared:chinos', 'prepared:jacket'],
      names: ['garment-1.jpg', 'garment-2.jpg', 'garment-3.jpg'],
      mode: 'outfit_items',
      photos: 1,
    })
  })

  it('accepts the photo that is already in the slot: a photo is never a duplicate of itself', async () => {
    const user = userEvent.setup()
    await withThreeItems(user)

    await user.upload(slot(2).getByTestId('upload-gallery-input'), syntheticFile('trousers.jpg'))
    await waitFor(() => expect(prepareMock).toHaveBeenCalledTimes(5))

    expect(slot(2).queryByRole('alert')).toBeNull()
    expect((await submit(user)).garments).toEqual(['prepared:shirt', 'prepared:trousers', 'prepared:jacket'])
  })

  it('clears the message of an earlier failed attempt once a replacement is accepted', async () => {
    const user = userEvent.setup()
    await withThreeItems(user)

    prepareMock.mockRejectedValueOnce(new Error('simulated decode failure'))
    await user.upload(slot(3).getByTestId('upload-gallery-input'), syntheticFile('broken.jpg'))
    await slot(3).findByRole('alert')

    await user.upload(slot(3).getByTestId('upload-gallery-input'), syntheticFile('coat.jpg'))
    await waitFor(() => expect(slot(3).queryByRole('alert')).toBeNull())
    expect((await submit(user)).garments).toEqual(['prepared:shirt', 'prepared:trousers', 'prepared:coat'])
  })
})

describe('a replacement that is not accepted keeps every photo (one of several)', () => {
  it.each([
    ['an unsupported HEIC photo', new ImagePreparationError('heic_unsupported'), /HEIC and HEIF photos are not supported yet/],
    ['an empty file', new ImagePreparationError('empty_file'), /appears to be empty/],
    ['a photo that is too large to prepare', new ImagePreparationError('source_too_large'), /too large to prepare on this device/],
    ['a file that cannot be decoded', new Error('simulated decode failure'), /./],
  ])('keeps the photo, its position and the others for %s, and says the current photo was kept', async (_name, failure, message) => {
    const user = userEvent.setup()
    await withThreeItems(user)

    prepareMock.mockRejectedValueOnce(failure)
    await user.upload(slot(2).getByTestId('upload-gallery-input'), syntheticFile('replacement.jpg'))

    const alert = await slot(2).findByRole('alert')
    expect(alert.textContent).toMatch(message)
    expect(alert.textContent).toContain('Your current photo was kept.')
    // The message is under the photo it is about, and nowhere else.
    expect(slot(1).queryByRole('alert')).toBeNull()
    expect(slot(3).queryByRole('alert')).toBeNull()
    expect(screen.getByTestId('garment-count').textContent).toBe('3 of 3 photos added')
    expect(continueButton().disabled).toBe(false)

    expect(await submit(user)).toMatchObject({ garments: ['prepared:shirt', 'prepared:trousers', 'prepared:jacket'], mode: 'outfit_items', photos: 1 })
  })

  it('refuses a duplicate of another slot as a replacement, in every slot, and keeps the order', async () => {
    const user = userEvent.setup()
    await withThreeItems(user)

    await user.upload(slot(3).getByTestId('upload-gallery-input'), syntheticFile('shirt.jpg'))
    expect((await slot(3).findByRole('alert')).textContent).toMatch(/same photo as outfit item 1.*Your current photo was kept\./)
    await user.upload(slot(1).getByTestId('upload-gallery-input'), syntheticFile('jacket.jpg'))
    expect((await slot(1).findByRole('alert')).textContent).toMatch(/same photo as outfit item 3.*Your current photo was kept\./)

    expect((await submit(user)).garments).toEqual(['prepared:shirt', 'prepared:trousers', 'prepared:jacket'])
  })

  it('keeps the photo when a replacement is cancelled while it is being prepared', async () => {
    const user = userEvent.setup()
    await withThreeItems(user)

    const pending = deferred<Awaited<ReturnType<typeof prepareImageForUpload>>>()
    prepareMock.mockReturnValueOnce(pending.promise)
    await user.upload(slot(2).getByTestId('upload-gallery-input'), syntheticFile('slow.jpg'))
    await user.click(await slot(2).findByRole('button', { name: 'Cancel' }))

    expect(await screen.findByAltText('Outfit item 2 preview')).toBeTruthy()
    expect(screen.getByTestId('garment-count').textContent).toBe('3 of 3 photos added')

    // A preparation that finishes after it was cancelled changes nothing.
    pending.resolve(prepared('slow.jpg'))
    await waitFor(() => expect(slot(2).queryByRole('button', { name: 'Cancel' })).toBeNull())
    expect((await submit(user)).garments).toEqual(['prepared:shirt', 'prepared:trousers', 'prepared:jacket'])
  })

  it('refuses a duplicate in an empty slot without touching the photos already added', async () => {
    const user = userEvent.setup()
    await toGarmentStep(user, 'same_garment_views')
    await addGarment(user, 1, 'front.jpg', 'Garment view 1')
    await addGarment(user, 2, 'back.jpg', 'Garment view 2')

    await user.upload(slot(3).getByTestId('upload-gallery-input'), syntheticFile('back.jpg'))
    const alert = await slot(3).findByRole('alert')
    expect(alert.textContent).toMatch(/same photo as garment view 2/)
    // Nothing was in this slot, so nothing was "kept".
    expect(alert.textContent).not.toContain('Your current photo was kept.')
    expect(screen.getByTestId('garment-count').textContent).toBe('2 of 3 photos added')
    expect(await submit(user)).toMatchObject({ garments: ['prepared:front', 'prepared:back'], names: ['garment-1.jpg', 'garment-2.jpg'], mode: 'same_garment_views' })
  })
})

describe('removing a photo after a failed replacement', () => {
  it('leaves a consistent state: the count, the mode rule and what is sent all agree', async () => {
    const user = userEvent.setup()
    await withThreeItems(user)

    prepareMock.mockRejectedValueOnce(new Error('simulated decode failure'))
    await user.upload(slot(1).getByTestId('upload-gallery-input'), syntheticFile('broken.jpg'))
    await slot(1).findByRole('alert')

    await user.click(screen.getByRole('button', { name: 'Remove Outfit item 1' }))
    await waitFor(() => expect(screen.getByTestId('garment-count').textContent).toBe('2 of 3 photos added'))
    // The remaining photos moved up; the message about the removed photo did not stay behind.
    expect(slot(1).queryByRole('alert')).toBeNull()
    expect(continueButton().disabled).toBe(false)
    expect(await submit(user)).toMatchObject({ garments: ['prepared:trousers', 'prepared:jacket'], names: ['garment-1.jpg', 'garment-2.jpg'], mode: 'outfit_items' })
  })

  it('does not let the journey continue with fewer photos than the mode needs', async () => {
    const user = userEvent.setup()
    await toGarmentStep(user, 'outfit_items')
    await addGarment(user, 1, 'shirt.jpg', 'Outfit item 1')
    await addGarment(user, 2, 'trousers.jpg', 'Outfit item 2')

    await user.click(screen.getByRole('button', { name: 'Remove Outfit item 2' }))
    await waitFor(() => expect(screen.getByTestId('garment-count').textContent).toBe('1 of 3 photos added'))
    expect(continueButton().disabled).toBe(true)
    expect(screen.getByRole('status').textContent).toMatch(/Add at least two outfit items/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('a card that holds the only photo (current behaviour, pinned)', () => {
  it('drops the single garment photo as soon as another one is chosen, so a failed replacement leaves the card empty', async () => {
    const user = userEvent.setup()
    await toGarmentStep(user, 'single')
    await user.upload(screen.getByTestId('upload-gallery-input'), syntheticFile('dress.jpg'))
    await screen.findByAltText('Clothing Image preview')
    expect(continueButton().disabled).toBe(false)

    prepareMock.mockRejectedValueOnce(new ImagePreparationError('heic_unsupported'))
    await user.upload(screen.getByTestId('upload-gallery-input'), syntheticFile('other.jpg'))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/HEIC and HEIF photos are not supported yet/)
    // Unlike a card that is one of several, this card does not keep its photo, and it does not claim to.
    expect(alert.textContent).not.toContain('Your current photo was kept.')
    expect(screen.queryByAltText('Clothing Image preview')).toBeNull()
    // The state stays consistent: with no garment photo the journey cannot continue and nothing is sent.
    expect(continueButton().disabled).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('replaces the single garment photo when the new one is accepted, and sends only the new one', async () => {
    const user = userEvent.setup()
    await toGarmentStep(user, 'single')
    await user.upload(screen.getByTestId('upload-gallery-input'), syntheticFile('dress.jpg'))
    await screen.findByAltText('Clothing Image preview')
    await user.upload(screen.getByTestId('upload-gallery-input'), syntheticFile('skirt.jpg'))
    await waitFor(() => expect(prepareMock).toHaveBeenCalledTimes(3))
    await screen.findByAltText('Clothing Image preview')

    expect(await submit(user)).toEqual({ garments: ['prepared:skirt'], names: ['garment.jpg'], mode: 'single', photos: 1 })
  })
})
