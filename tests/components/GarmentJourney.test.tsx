/**
 * @jest-environment jsdom
 *
 * Several garment photos in the analysis journey: the explicit garment mode,
 * adding, replacing, removing and reordering photos, duplicate detection, and
 * what is finally sent. `fetch` is a mock and image preparation is mocked; no
 * model is ever called and every file is synthetic.
 */

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AnalysisPage from '@/app/dashboard/analysis/page'
import { OCCASION_GROUPS } from '@/lib/constants/options'
import { MULTI_GARMENT_TARGET_BYTES, prepareImageForUpload } from '@/lib/images/prepareImageForUpload'
import { fakeResponse, installObjectUrlMocks, setNavigatorOnline, syntheticFile } from '../helpers/uploadTestUtils'

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

beforeEach(() => {
  window.localStorage.clear()
  installObjectUrlMocks()
  setNavigatorOnline(true)
  fetchMock = jest.fn().mockResolvedValue(fakeResponse(200, COMPLETE_RESULT))
  ;(globalThis as { fetch?: unknown }).fetch = fetchMock
  prepareMock.mockReset()
  prepareMock.mockImplementation(async (file) => ({ file: preparedFrom(file.name), width: 1152, height: 1536, quality: 0.86, sourceWidth: 3024, sourceHeight: 4032 }))
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

/** Adds the personal photo and stops on the garment mode step. */
async function toModeStep(user: User) {
  render(<AnalysisPage />)
  await user.upload(screen.getByTestId('upload-gallery-input'), syntheticFile('selfie.jpg'))
  await screen.findByAltText('Current Photo preview')
  await next(user)
}

async function addGarment(user: User, slotNumber: number, name: string, previewLabel: string) {
  await user.upload(slot(slotNumber).getByTestId('upload-gallery-input'), syntheticFile(name))
  await screen.findByAltText(`${previewLabel} preview`)
}

async function finish(user: User) {
  await next(user)
  await user.selectOptions(screen.getByTestId('occasion-select'), OCCASION)
  await next(user)
  await next(user)
  await user.click(screen.getByRole('button', { name: /analyze/i }))
  await screen.findByTestId('decision-report')
  return (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as FormData
}

describe('choosing the garment mode', () => {
  it('offers three choices, preselects none and does not continue without one', async () => {
    const user = userEvent.setup()
    await toModeStep(user)

    const options = screen.getAllByRole('radio')
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining('One garment photo'),
      expect.stringContaining('Views of one garment'),
      expect.stringContaining('Items of one outfit'),
    ])
    expect(options.every((option) => option.getAttribute('aria-checked') === 'false')).toBe(true)
    expect(continueButton().disabled).toBe(true)

    await user.click(screen.getByTestId('garment-mode-outfit_items'))
    expect(screen.getByTestId('garment-mode-outfit_items').getAttribute('aria-checked')).toBe('true')
    expect(continueButton().disabled).toBe(false)
  })

  it('shows one upload area for one garment photo and never offers more', async () => {
    const user = userEvent.setup()
    await toModeStep(user)
    await user.click(screen.getByTestId('garment-mode-single'))
    await next(user)

    expect(screen.getAllByTestId('upload-gallery-input')).toHaveLength(1)
    expect(screen.queryByTestId('garment-uploader')).toBeNull()
  })
})

describe('views of one garment', () => {
  async function toUploader(user: User) {
    await toModeStep(user)
    await user.click(screen.getByTestId('garment-mode-same_garment_views'))
    await next(user)
  }

  it('needs at least two photos, says so, and allows at most three', async () => {
    const user = userEvent.setup()
    await toUploader(user)

    expect(screen.getByTestId('garment-count').textContent).toBe('0 of 3 photos added')
    expect(continueButton().disabled).toBe(true)

    await addGarment(user, 1, 'front.jpg', 'Garment view 1')
    expect(screen.getByRole('status').textContent).toMatch(/Add at least two views of the garment/)
    expect(continueButton().disabled).toBe(true)

    await addGarment(user, 2, 'back.jpg', 'Garment view 2')
    expect(screen.getByTestId('garment-count').textContent).toBe('2 of 3 photos added')
    expect(screen.queryByRole('status')).toBeNull()
    expect(continueButton().disabled).toBe(false)

    await addGarment(user, 3, 'side.jpg', 'Garment view 3')
    expect(screen.getByTestId('garment-count').textContent).toBe('3 of 3 photos added')
    // Three photos fill the three slots: there is no fourth slot to add to.
    expect(screen.queryByTestId('garment-slot-4')).toBeNull()
    expect(screen.getAllByTestId('upload-gallery-input')).toHaveLength(3)
  })

  it('uses the rear camera for every garment slot and prepares each photo for a shared request', async () => {
    const user = userEvent.setup()
    await toUploader(user)
    await addGarment(user, 1, 'front.jpg', 'Garment view 1')

    for (const input of screen.getAllByTestId('upload-camera-input')) expect(input.getAttribute('capture')).toBe('environment')
    const garmentCall = prepareMock.mock.calls.find(([file]) => file.name === 'front.jpg')!
    expect(garmentCall[1]).toMatchObject({ targetBytes: MULTI_GARMENT_TARGET_BYTES })
  })

  it('sends every view once, in order, under generic names, with the chosen mode', async () => {
    const user = userEvent.setup()
    await toUploader(user)
    await addGarment(user, 1, 'front.jpg', 'Garment view 1')
    await addGarment(user, 2, 'back.jpg', 'Garment view 2')

    const body = await finish(user)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(body.get('garmentMode')).toBe('same_garment_views')
    const garments = body.getAll('garment') as File[]
    expect(garments.map((file) => file.name)).toEqual(['garment-1.jpg', 'garment-2.jpg'])
    expect(await Promise.all(garments.map(readText))).toEqual([expect.stringContaining('prepared:front'), expect.stringContaining('prepared:back')])
    expect((body.get('photo') as File).name).toBe('photo.jpg')
  })

  it('refuses the same photo twice and keeps the photos already added', async () => {
    const user = userEvent.setup()
    await toUploader(user)
    await addGarment(user, 1, 'front.jpg', 'Garment view 1')

    await user.upload(slot(2).getByTestId('upload-gallery-input'), syntheticFile('front.jpg'))
    expect((await slot(2).findByRole('alert')).textContent).toMatch(/same photo as garment view 1/)
    expect(screen.getByTestId('garment-count').textContent).toBe('1 of 3 photos added')
    expect(screen.queryByAltText('Garment view 2 preview')).toBeNull()
  })
})

describe('replacing one of several photos', () => {
  async function withTwoViews(user: User) {
    await toModeStep(user)
    await user.click(screen.getByTestId('garment-mode-same_garment_views'))
    await next(user)
    await addGarment(user, 1, 'front.jpg', 'Garment view 1')
    await addGarment(user, 2, 'back.jpg', 'Garment view 2')
  }

  it('keeps every photo when the replacement is refused as a duplicate, and says so', async () => {
    const user = userEvent.setup()
    await withTwoViews(user)

    // Try to replace the second view with the photo that is already the first view.
    await user.upload(slot(2).getByTestId('upload-gallery-input'), syntheticFile('front.jpg'))
    const alert = await slot(2).findByRole('alert')
    expect(alert.textContent).toMatch(/same photo as garment view 1/)
    expect(alert.textContent).toContain('Your current photo was kept.')

    expect(screen.getByTestId('garment-count').textContent).toBe('2 of 3 photos added')
    const body = await finish(user)
    const texts = await Promise.all((body.getAll('garment') as File[]).map(readText))
    expect(texts.map((text) => text.replace(/\.+$/, ''))).toEqual(['prepared:front', 'prepared:back'])
  })

  it('keeps the current photo when the replacement cannot be prepared', async () => {
    const user = userEvent.setup()
    await withTwoViews(user)

    prepareMock.mockRejectedValueOnce(new Error('simulated decode failure'))
    await user.upload(slot(1).getByTestId('upload-gallery-input'), syntheticFile('broken.jpg'))
    expect((await slot(1).findByRole('alert')).textContent).toContain('Your current photo was kept.')
    expect(await screen.findByAltText('Garment view 1 preview')).toBeTruthy()
    expect(screen.getByTestId('garment-count').textContent).toBe('2 of 3 photos added')
  })

  it('does not leave a message about one photo under a different photo after reordering', async () => {
    const user = userEvent.setup()
    await withTwoViews(user)
    await user.upload(slot(2).getByTestId('upload-gallery-input'), syntheticFile('front.jpg'))
    await slot(2).findByRole('alert')

    await user.click(screen.getByRole('button', { name: 'Move Garment view 2 earlier' }))

    await waitFor(() => expect(slot(2).queryByRole('alert')).toBeNull())
    expect(slot(1).queryByRole('alert')).toBeNull()
  })
})

describe('items of one outfit', () => {
  async function toUploader(user: User) {
    await toModeStep(user)
    await user.click(screen.getByTestId('garment-mode-outfit_items'))
    await next(user)
  }

  it('lets photos be reordered, and sends them in the order shown', async () => {
    const user = userEvent.setup()
    await toUploader(user)
    await addGarment(user, 1, 'shirt.jpg', 'Outfit item 1')
    await addGarment(user, 2, 'trousers.jpg', 'Outfit item 2')
    await addGarment(user, 3, 'jacket.jpg', 'Outfit item 3')

    expect((screen.getByRole('button', { name: 'Move Outfit item 1 earlier' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Move Outfit item 3 later' }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Move Outfit item 3 earlier' }))
    await user.click(screen.getByRole('button', { name: 'Move Outfit item 2 earlier' }))

    const body = await finish(user)
    expect(body.get('garmentMode')).toBe('outfit_items')
    const texts = await Promise.all((body.getAll('garment') as File[]).map(readText))
    expect(texts.map((text) => text.replace(/\.+$/, ''))).toEqual(['prepared:jacket', 'prepared:shirt', 'prepared:trousers'])
  })

  it('removes one photo without touching the others, and replaces a photo in place', async () => {
    const user = userEvent.setup()
    await toUploader(user)
    await addGarment(user, 1, 'shirt.jpg', 'Outfit item 1')
    await addGarment(user, 2, 'trousers.jpg', 'Outfit item 2')
    await addGarment(user, 3, 'jacket.jpg', 'Outfit item 3')

    await user.click(screen.getByRole('button', { name: 'Remove Outfit item 2' }))
    await waitFor(() => expect(screen.getByTestId('garment-count').textContent).toBe('2 of 3 photos added'))

    // Replace the first photo by choosing another file in its slot.
    await user.upload(slot(1).getByTestId('upload-gallery-input'), syntheticFile('polo.jpg'))
    await waitFor(() => expect(prepareMock.mock.calls.some(([file]) => file.name === 'polo.jpg')).toBe(true))
    await screen.findByAltText('Outfit item 1 preview')

    const body = await finish(user)
    const texts = await Promise.all((body.getAll('garment') as File[]).map(readText))
    expect(texts.map((text) => text.replace(/\.+$/, ''))).toEqual(['prepared:polo', 'prepared:jacket'])
  })

  it('shows the mode and the number of photos on the review step before anything is sent', async () => {
    const user = userEvent.setup()
    await toUploader(user)
    await addGarment(user, 1, 'shirt.jpg', 'Outfit item 1')
    await addGarment(user, 2, 'trousers.jpg', 'Outfit item 2')
    await next(user)
    await user.selectOptions(screen.getByTestId('occasion-select'), OCCASION)
    await next(user)
    await next(user)

    expect(screen.getByText(/Items of one outfit · 2 photos/)).toBeTruthy()
    expect(screen.getByAltText('Outfit item 1, as it will be sent')).toBeTruthy()
    expect(screen.getByAltText('Outfit item 2, as it will be sent')).toBeTruthy()
    expect(screen.getByText(OCCASION)).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('changing the mode after adding photos', () => {
  it('never removes photos silently: it asks first, and keeping the photos keeps the mode', async () => {
    const user = userEvent.setup()
    await toModeStep(user)
    await user.click(screen.getByTestId('garment-mode-outfit_items'))
    await next(user)
    await addGarment(user, 1, 'shirt.jpg', 'Outfit item 1')
    await addGarment(user, 2, 'trousers.jpg', 'Outfit item 2')
    await user.click(screen.getByRole('button', { name: /back/i }))

    await user.click(screen.getByTestId('garment-mode-single'))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog.textContent).toMatch(/You have 2 garment photos/)
    expect(dialog.textContent).toMatch(/removes the other 1/)
    // Nothing changed yet.
    expect(screen.getByTestId('garment-mode-outfit_items').getAttribute('aria-checked')).toBe('true')

    await user.click(screen.getByRole('button', { name: 'Keep my photos' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByTestId('garment-mode-outfit_items').getAttribute('aria-checked')).toBe('true')
    await next(user)
    expect(screen.getByTestId('garment-count').textContent).toBe('2 of 3 photos added')
  })

  it('switches and removes the extra photos only after confirmation', async () => {
    const user = userEvent.setup()
    await toModeStep(user)
    await user.click(screen.getByTestId('garment-mode-same_garment_views'))
    await next(user)
    await addGarment(user, 1, 'front.jpg', 'Garment view 1')
    await addGarment(user, 2, 'back.jpg', 'Garment view 2')
    await user.click(screen.getByRole('button', { name: /back/i }))

    await user.click(screen.getByTestId('garment-mode-single'))
    await user.click(screen.getByRole('button', { name: 'Switch and remove 1' }))
    expect(screen.getByTestId('garment-mode-single').getAttribute('aria-checked')).toBe('true')
    await next(user)

    expect(await screen.findByAltText('Clothing Image preview')).toBeTruthy()
    const body = await finish(user)
    expect(body.get('garmentMode')).toBe('single')
    expect(body.getAll('garment')).toHaveLength(1)
    expect(await readText(body.get('garment') as File)).toContain('prepared:front')
  })

  it('keeps a single photo when switching to a mode that needs more, and asks for another', async () => {
    const user = userEvent.setup()
    await toModeStep(user)
    await user.click(screen.getByTestId('garment-mode-single'))
    await next(user)
    await user.upload(screen.getByTestId('upload-gallery-input'), syntheticFile('dress.jpg'))
    await screen.findByAltText('Clothing Image preview')
    await user.click(screen.getByRole('button', { name: /back/i }))

    await user.click(screen.getByTestId('garment-mode-same_garment_views'))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await next(user)

    expect(await screen.findByAltText('Garment view 1 preview')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toMatch(/Add at least two views/)
    expect(continueButton().disabled).toBe(true)
  })
})
