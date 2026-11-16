/**
 * @jest-environment jsdom
 *
 * UploadCard: camera and gallery inputs, preview, retake, remove, object URL
 * cleanup, and the guarantee that selecting a photo uploads and stores nothing.
 * Image preparation is mocked (jsdom has no canvas); it has its own unit tests.
 */

import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UploadCard from '@/components/fashion/UploadCard'
import { ImagePreparationError, prepareImageForUpload } from '@/lib/images/prepareImageForUpload'
import { deferred, installObjectUrlMocks, syntheticFile, type ObjectUrlMocks } from '../helpers/uploadTestUtils'

jest.mock('@/lib/images/prepareImageForUpload', () => ({
  ...jest.requireActual('@/lib/images/prepareImageForUpload'),
  prepareImageForUpload: jest.fn(),
}))

const prepareMock = prepareImageForUpload as jest.MockedFunction<typeof prepareImageForUpload>

function preparedResult(file: File) {
  return { file, width: 1536, height: 1152, quality: 0.86, sourceWidth: 4032, sourceHeight: 3024 }
}

interface HarnessProps {
  captureMode?: 'user' | 'environment'
  belowMinimum?: 'upscale' | 'reject'
  disabled?: boolean
  onSelect?: (file: File) => void
  onRemove?: () => void
}

/** Holds the file the way a real parent does, so preview and removal are exercised end to end. */
function Harness({ captureMode = 'user', belowMinimum, disabled, onSelect, onRemove }: HarnessProps) {
  const [file, setFile] = useState<File | null>(null)
  return (
    <UploadCard
      label="Current Photo"
      description="A clear, current photo of yourself"
      captureMode={captureMode}
      belowMinimum={belowMinimum}
      disabled={disabled}
      file={file}
      onFileSelect={(selected) => {
        onSelect?.(selected)
        setFile(selected)
      }}
      onRemove={() => {
        onRemove?.()
        setFile(null)
      }}
    />
  )
}

const cameraInput = () => screen.getByTestId('upload-camera-input') as HTMLInputElement
const galleryInput = () => screen.getByTestId('upload-gallery-input') as HTMLInputElement

let objectUrls: ObjectUrlMocks
let fetchMock: jest.Mock
let setItemSpy: jest.SpyInstance

beforeEach(() => {
  objectUrls = installObjectUrlMocks()
  fetchMock = jest.fn()
  ;(globalThis as { fetch?: unknown }).fetch = fetchMock
  setItemSpy = jest.spyOn(Storage.prototype, 'setItem')
  prepareMock.mockReset()
  prepareMock.mockImplementation(async (file) => preparedResult(syntheticFile(file.name.replace(/\.\w+$/, '.jpg'), 'image/jpeg', 900)))
})

describe('UploadCard camera and gallery inputs', () => {
  it('asks for the front camera for a selfie', () => {
    render(<Harness captureMode="user" />)
    expect(cameraInput().getAttribute('type')).toBe('file')
    expect(cameraInput().getAttribute('capture')).toBe('user')
    expect(cameraInput().getAttribute('accept')).toBe('image/*')
  })

  it('asks for the rear camera for a garment', () => {
    render(<Harness captureMode="environment" />)
    expect(cameraInput().getAttribute('capture')).toBe('environment')
  })

  it('offers a separate gallery input with no capture hint and the supported formats', () => {
    render(<Harness />)
    expect(galleryInput()).not.toBe(cameraInput())
    expect(galleryInput().getAttribute('type')).toBe('file')
    expect(galleryInput().hasAttribute('capture')).toBe(false)
    expect(galleryInput().getAttribute('accept')).toBe('image/jpeg,image/png,image/webp')
  })

  it('opens the camera input from Take photo and the gallery input from Choose from gallery', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const cameraClick = jest.fn()
    const galleryClick = jest.fn()
    cameraInput().addEventListener('click', cameraClick)
    galleryInput().addEventListener('click', galleryClick)

    await user.click(screen.getByRole('button', { name: /take photo/i }))
    expect(cameraClick).toHaveBeenCalledTimes(1)
    expect(galleryClick).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /choose from gallery/i }))
    expect(galleryClick).toHaveBeenCalledTimes(1)
    expect(cameraClick).toHaveBeenCalledTimes(1)
  })

  it('keeps desktop behaviour: clicking the empty card opens the file picker', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const galleryClick = jest.fn()
    galleryInput().addEventListener('click', galleryClick)

    await user.click(screen.getByText('A clear, current photo of yourself'))
    expect(galleryClick).toHaveBeenCalledTimes(1)
  })

  it('disables both inputs and both buttons when disabled', () => {
    render(<Harness disabled />)
    expect(cameraInput().disabled).toBe(true)
    expect(galleryInput().disabled).toBe(true)
    expect((screen.getByRole('button', { name: /take photo/i }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /choose from gallery/i }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('UploadCard selection and preview', () => {
  it('prepares a gallery photo and hands the prepared file, not the original, to the parent', async () => {
    const user = userEvent.setup()
    const onSelect = jest.fn()
    render(<Harness onSelect={onSelect} belowMinimum="reject" />)
    const original = syntheticFile('IMG_4821.png', 'image/png', 4_096)

    await user.upload(galleryInput(), original)

    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1))
    expect(prepareMock).toHaveBeenCalledTimes(1)
    expect(prepareMock.mock.calls[0][0]).toBe(original)
    expect(prepareMock.mock.calls[0][1]).toMatchObject({ belowMinimum: 'reject' })
    const delivered = onSelect.mock.calls[0][0] as File
    expect(delivered).not.toBe(original)
    expect(delivered.type).toBe('image/jpeg')
    expect(delivered.name).toBe('IMG_4821.jpg')
  })

  it('shows a preview of the prepared photo', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.upload(galleryInput(), syntheticFile('selfie.jpg'))

    const preview = (await screen.findByAltText('Current Photo preview')) as HTMLImageElement
    expect(preview.getAttribute('src')).toBe('blob:verdict-test/1')
    expect(objectUrls.create).toHaveBeenCalledTimes(1)
    // The preview is built from the prepared file, the one that would be uploaded.
    expect((objectUrls.create.mock.calls[0][0] as File).size).toBe(900)
    expect(screen.queryByRole('button', { name: /take photo/i })).toBeNull()
  })

  it('accepts a photo taken with the camera input', async () => {
    const user = userEvent.setup()
    const onSelect = jest.fn()
    render(<Harness onSelect={onSelect} />)

    await user.upload(cameraInput(), syntheticFile('image.jpg'))

    await screen.findByAltText('Current Photo preview')
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('accepts a photo dropped onto the card', async () => {
    const onSelect = jest.fn()
    render(<Harness onSelect={onSelect} />)
    const dropped = syntheticFile('dropped.webp', 'image/webp')

    fireEvent.drop(screen.getByTestId('upload-card'), { dataTransfer: { files: [dropped] } })

    await screen.findByAltText('Current Photo preview')
    expect(prepareMock.mock.calls[0][0]).toBe(dropped)
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('shows a preparing state until the photo is ready', async () => {
    const user = userEvent.setup()
    const pending = deferred<ReturnType<typeof preparedResult>>()
    prepareMock.mockReturnValue(pending.promise)
    render(<Harness />)

    await user.upload(galleryInput(), syntheticFile('selfie.jpg'))

    expect(screen.getByRole('status').textContent).toMatch(/Preparing your photo/)
    expect(screen.getByTestId('upload-card').getAttribute('aria-busy')).toBe('true')
    expect(screen.queryByAltText('Current Photo preview')).toBeNull()

    await act(async () => pending.resolve(preparedResult(syntheticFile('selfie.jpg'))))

    expect(await screen.findByAltText('Current Photo preview')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByTestId('upload-card').getAttribute('aria-busy')).toBe('false')
  })

  it('shows a clear message for an unsupported photo and keeps the card empty', async () => {
    const user = userEvent.setup()
    const onSelect = jest.fn()
    prepareMock.mockRejectedValue(new ImagePreparationError('heic_unsupported'))
    render(<Harness onSelect={onSelect} />)

    await user.upload(galleryInput(), syntheticFile('IMG_0001.jpg'))

    expect((await screen.findByRole('alert')).textContent).toMatch(/HEIC and HEIF photos are not supported yet/)
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.queryByAltText('Current Photo preview')).toBeNull()
    expect(objectUrls.create).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /choose from gallery/i })).toBeTruthy()
  })

  it('shows a clear message when a photo cannot be decoded, and clears it on the next attempt', async () => {
    const user = userEvent.setup()
    prepareMock.mockRejectedValueOnce(new ImagePreparationError('decode_failed'))
    render(<Harness />)

    await user.upload(galleryInput(), syntheticFile('broken.jpg'))
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not be read/)

    await user.upload(galleryInput(), syntheticFile('good.jpg'))
    await screen.findByAltText('Current Photo preview')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('UploadCard retake and remove', () => {
  it('retakes: reopens the camera, replaces the photo and revokes the old preview URL', async () => {
    const user = userEvent.setup()
    const onSelect = jest.fn()
    const onRemove = jest.fn()
    render(<Harness onSelect={onSelect} onRemove={onRemove} />)
    await user.upload(cameraInput(), syntheticFile('first.jpg'))
    await screen.findByAltText('Current Photo preview')

    const cameraClick = jest.fn()
    cameraInput().addEventListener('click', cameraClick)
    await user.click(screen.getByRole('button', { name: /retake/i }))
    expect(cameraClick).toHaveBeenCalledTimes(1)

    await user.upload(cameraInput(), syntheticFile('second.jpg'))

    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(2))
    // The first photo is dropped as soon as a replacement is chosen.
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(objectUrls.revoke).toHaveBeenCalledWith('blob:verdict-test/1')
    const preview = (await screen.findByAltText('Current Photo preview')) as HTMLImageElement
    expect(preview.getAttribute('src')).toBe('blob:verdict-test/2')
    expect(objectUrls.live()).toEqual(['blob:verdict-test/2'])
  })

  it('lets the same photo be chosen again after a retake', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const same = syntheticFile('same.jpg')

    await user.upload(galleryInput(), same)
    await screen.findByAltText('Current Photo preview')
    expect(galleryInput().value).toBe('')

    await user.upload(galleryInput(), same)
    await waitFor(() => expect(prepareMock).toHaveBeenCalledTimes(2))
  })

  it('removes the photo, revokes its preview URL and returns to the empty state', async () => {
    const user = userEvent.setup()
    const onRemove = jest.fn()
    render(<Harness onRemove={onRemove} />)
    await user.upload(galleryInput(), syntheticFile('selfie.jpg'))
    await screen.findByAltText('Current Photo preview')

    await user.click(screen.getByRole('button', { name: 'Remove Current Photo' }))

    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(screen.queryByAltText('Current Photo preview')).toBeNull()
    expect(objectUrls.revoke).toHaveBeenCalledWith('blob:verdict-test/1')
    expect(objectUrls.live()).toEqual([])
    expect(screen.getByRole('button', { name: /choose from gallery/i })).toBeTruthy()
  })

  it('revokes the preview URL when the card unmounts', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Harness />)
    await user.upload(galleryInput(), syntheticFile('selfie.jpg'))
    await screen.findByAltText('Current Photo preview')
    expect(objectUrls.live()).toEqual(['blob:verdict-test/1'])

    unmount()

    expect(objectUrls.revoke).toHaveBeenCalledWith('blob:verdict-test/1')
    expect(objectUrls.live()).toEqual([])
  })

  it('cancels preparation that is still running when the card unmounts', async () => {
    const user = userEvent.setup()
    const onSelect = jest.fn()
    const pending = deferred<ReturnType<typeof preparedResult>>()
    prepareMock.mockReturnValue(pending.promise)
    const { unmount } = render(<Harness onSelect={onSelect} />)
    await user.upload(galleryInput(), syntheticFile('selfie.jpg'))
    const signal = prepareMock.mock.calls[0][1]?.signal as AbortSignal
    expect(signal.aborted).toBe(false)

    unmount()
    expect(signal.aborted).toBe(true)

    await act(async () => pending.resolve(preparedResult(syntheticFile('selfie.jpg'))))
    expect(onSelect).not.toHaveBeenCalled()
    expect(objectUrls.create).not.toHaveBeenCalled()
  })

  it('ignores a slow earlier selection once a newer photo has been chosen', async () => {
    const user = userEvent.setup()
    const onSelect = jest.fn()
    const first = deferred<ReturnType<typeof preparedResult>>()
    const second = deferred<ReturnType<typeof preparedResult>>()
    prepareMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    render(<Harness onSelect={onSelect} />)

    await user.upload(galleryInput(), syntheticFile('first.jpg'))
    await user.upload(galleryInput(), syntheticFile('second.jpg'))
    expect((prepareMock.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true)

    await act(async () => second.resolve(preparedResult(syntheticFile('second.jpg'))))
    await act(async () => first.resolve(preparedResult(syntheticFile('first.jpg'))))

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect((onSelect.mock.calls[0][0] as File).name).toBe('second.jpg')
  })

  it('cancels preparation from the preparing state', async () => {
    const user = userEvent.setup()
    const onSelect = jest.fn()
    const pending = deferred<ReturnType<typeof preparedResult>>()
    prepareMock.mockReturnValue(pending.promise)
    render(<Harness onSelect={onSelect} />)
    await user.upload(galleryInput(), syntheticFile('selfie.jpg'))

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('status')).toBeNull()

    await act(async () => pending.resolve(preparedResult(syntheticFile('selfie.jpg'))))
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('UploadCard privacy', () => {
  it('never uploads or stores anything when a photo is selected, previewed, retaken or removed', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.upload(galleryInput(), syntheticFile('selfie.jpg'))
    await screen.findByAltText('Current Photo preview')
    await user.upload(cameraInput(), syntheticFile('retake.jpg'))
    await screen.findByAltText('Current Photo preview')
    await user.click(screen.getByRole('button', { name: 'Remove Current Photo' }))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
  })
})
