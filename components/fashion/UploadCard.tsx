'use client'

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type MouseEvent } from 'react'
import { AlertCircle, Camera, ImagePlus, LoaderCircle, RefreshCw, UploadCloud, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  imagePreparationMessage,
  prepareImageForUpload,
  type BelowMinimumPolicy,
} from '@/lib/images/prepareImageForUpload'

interface UploadCardProps {
  label: string
  description: string
  /** The prepared image held by the parent, or null. */
  file: File | null
  /** Which camera a phone should open: 'user' (front) for selfies, 'environment' (rear) for garments. */
  captureMode: 'user' | 'environment'
  /** What to do with a photo under 512 px on either side. Default: enlarge it just enough. */
  belowMinimum?: BelowMinimumPolicy
  /** Size to aim for when preparing the photo. Lower when several photos share one request. */
  targetBytes?: number
  /** A smaller card, for a row of several photos. */
  compact?: boolean
  /** Refuses a prepared photo with a message (for example a duplicate). Return null to accept it. */
  validatePrepared?: (file: File) => Promise<string | null> | string | null
  /** Extra controls shown under the preview, for example to reorder photos. */
  previewActions?: React.ReactNode
  /**
   * Keep the current photo until its replacement has been prepared and accepted. Used where the card is
   * one of several: removing first would shift the other photos, and a refused replacement would lose a photo.
   * Default (false): the current photo is removed as soon as another one is chosen.
   */
  keepPreviousOnReplace?: boolean
  /** Receives the prepared JPEG. The original file is never passed on. */
  onFileSelect: (file: File) => void
  onRemove: () => void
  disabled?: boolean
}

// The capture attribute only does something on phones and tablets; on a desktop
// it would open the same file dialog as the gallery button.
const TOUCH_ONLY = 'hidden [@media(pointer:coarse)]:inline-flex'
const POINTER_ONLY = 'hidden [@media(pointer:fine)]:block'

/**
 * Photo picker with a camera button and a separate gallery/file button.
 *
 * Uses native file inputs only. A chosen photo is prepared in the browser
 * (oriented, resized, re-encoded as JPEG) and held in memory; nothing is
 * uploaded or stored until the parent submits it.
 */
export default function UploadCard({
  label,
  description,
  file,
  captureMode,
  belowMinimum,
  targetBytes,
  compact = false,
  validatePrepared,
  previewActions,
  keepPreviousOnReplace = false,
  onFileSelect,
  onRemove,
  disabled = false,
}: UploadCardProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const preparationRef = useRef<AbortController | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isPreparing, setIsPreparing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  // One object URL per file, revoked when the file changes or the card unmounts.
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  // A message about an earlier attempt does not belong to a different photo: when the photo shown in this
  // card changes (replaced, or moved here by reordering), the message is cleared.
  useEffect(() => {
    if (file) setError(null)
  }, [file])

  // Stop any preparation still running when the card goes away.
  useEffect(() => () => preparationRef.current?.abort(), [])

  async function handleSelected(selected: File | undefined) {
    if (!selected || disabled) return

    preparationRef.current?.abort()
    const controller = new AbortController()
    preparationRef.current = controller

    setError(null)
    // The previous photo is replaced, never silently kept while a new one is prepared. Where the card is one of
    // several, the previous photo stays until the new one is accepted, and a failure says that it was kept.
    if (file && !keepPreviousOnReplace) onRemove()
    setIsPreparing(true)

    try {
      const prepared = await prepareImageForUpload(selected, { belowMinimum, targetBytes, signal: controller.signal })
      if (controller.signal.aborted) return
      const refusal = validatePrepared ? await validatePrepared(prepared.file) : null
      if (controller.signal.aborted) return
      if (refusal) setError(withKeptNote(refusal))
      else onFileSelect(prepared.file)
    } catch (preparationError) {
      if (!controller.signal.aborted) setError(withKeptNote(imagePreparationMessage(preparationError)))
    } finally {
      if (preparationRef.current === controller) {
        preparationRef.current = null
        setIsPreparing(false)
      }
    }
  }

  /** Tells the user that the photo already in this slot is still there after a failed replacement. */
  function withKeptNote(message: string): string {
    return file && keepPreviousOnReplace ? `${message} Your current photo was kept.` : message
  }

  /** Stops a preparation in progress. With `keepPreviousOnReplace` the current photo is untouched. */
  function handleCancel(event: MouseEvent) {
    if (!keepPreviousOnReplace) {
      handleRemove(event)
      return
    }
    event.stopPropagation()
    preparationRef.current?.abort()
    preparationRef.current = null
    setIsPreparing(false)
    setError(null)
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0]
    // Reset so choosing or retaking the same photo fires another change event.
    event.target.value = ''
    void handleSelected(selected)
  }

  function openCamera(event: MouseEvent) {
    event.stopPropagation()
    cameraInputRef.current?.click()
  }

  function openGallery(event?: MouseEvent) {
    event?.stopPropagation()
    galleryInputRef.current?.click()
  }

  function handleRemove(event: MouseEvent) {
    event.stopPropagation()
    preparationRef.current?.abort()
    preparationRef.current = null
    setIsPreparing(false)
    setError(null)
    onRemove()
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setIsDragging(false)
    void handleSelected(event.dataTransfer.files?.[0])
  }

  const hasPreview = Boolean(file && previewUrl) && !isPreparing
  const isEmpty = !hasPreview && !isPreparing
  const controlsDisabled = disabled || isPreparing

  return (
    <div>
      <div
        data-testid="upload-card"
        aria-busy={isPreparing}
        onClick={isEmpty && !disabled ? () => openGallery() : undefined}
        onDragOver={(event) => { event.preventDefault(); if (!disabled) setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={cn(
          'group relative flex flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed border-border bg-card/40 text-center transition-all duration-300',
          compact ? 'min-h-[200px] p-4' : 'min-h-[260px] p-6 sm:p-8',
          isEmpty && !disabled && 'cursor-pointer hover:border-primary/50 hover:bg-card',
          isDragging && 'scale-[1.01] border-primary bg-primary/5 shadow-lg shadow-primary/10'
        )}
      >
        {/* Camera: `capture` asks a phone to open its camera directly. */}
        <input
          ref={cameraInputRef}
          data-testid="upload-camera-input"
          type="file"
          accept="image/*"
          capture={captureMode}
          className="sr-only"
          aria-label={`Take a photo for ${label}`}
          tabIndex={-1}
          disabled={disabled}
          onClick={(event) => event.stopPropagation()}
          onChange={handleInputChange}
        />
        {/* Gallery or files: no `capture`, so the device's picker opens. */}
        <input
          ref={galleryInputRef}
          data-testid="upload-gallery-input"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          aria-label={`Choose a photo for ${label}`}
          tabIndex={-1}
          disabled={disabled}
          onClick={(event) => event.stopPropagation()}
          onChange={handleInputChange}
        />

        {isPreparing && (
          <div role="status" aria-live="polite" className="flex flex-col items-center">
            <LoaderCircle className="h-7 w-7 animate-spin text-primary" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium text-foreground">Preparing your photo…</p>
            <p className="mt-1 text-xs text-muted-foreground">This happens on your device. Nothing is uploaded yet.</p>
            <Button type="button" size="sm" variant="ghost" className="focus-ring mt-3" onClick={handleCancel}>
              Cancel
            </Button>
          </div>
        )}

        {hasPreview && file && previewUrl && (
          <div className="w-full">
            <div className={cn('relative w-full overflow-hidden rounded-xl bg-secondary/40', compact ? 'h-36' : 'h-52 sm:h-60')}>
              {/* A plain <img>: the source is an in-memory blob URL, not a remote image. */}
              <img src={previewUrl} alt={`${label} preview`} className="image-zoom h-full w-full object-cover" />
            </div>
            <p className="mt-3 max-w-full truncate text-xs text-muted-foreground">{file.name}</p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <Button type="button" size="sm" variant="outline" className={cn('focus-ring', TOUCH_ONLY)} disabled={controlsDisabled} onClick={openCamera}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Retake
              </Button>
              <Button type="button" size="sm" variant="outline" className="focus-ring" disabled={controlsDisabled} onClick={openGallery}>
                <ImagePlus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Choose another
              </Button>
              <Button type="button" size="sm" variant="ghost" className="focus-ring" disabled={disabled} onClick={handleRemove} aria-label={`Remove ${label}`}>
                <X className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Remove
              </Button>
            </div>
            {previewActions ? <div className="mt-3 flex flex-wrap items-center justify-center gap-2">{previewActions}</div> : null}
          </div>
        )}

        {isEmpty && (
          <div className="flex flex-col items-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-secondary transition-colors group-hover:bg-primary/10">
              <UploadCloud className="h-6 w-6 text-primary" aria-hidden="true" />
            </div>
            <p className={cn('font-display text-foreground', compact ? 'text-xl' : 'text-2xl')}>{label}</p>
            <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-muted-foreground">{description}</p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <Button type="button" size="sm" className={cn('focus-ring', TOUCH_ONLY)} disabled={controlsDisabled} onClick={openCamera}>
                <Camera className="mr-1.5 h-4 w-4" aria-hidden="true" /> Take photo
              </Button>
              <Button type="button" size="sm" variant="outline" className="focus-ring" disabled={controlsDisabled} onClick={openGallery}>
                <ImagePlus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Choose from gallery
              </Button>
            </div>
            <p className={cn('mt-2 text-xs text-muted-foreground/70', POINTER_ONLY)}>or drag and drop a photo here</p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
              {['JPEG', 'PNG', 'WEBP', 'Up to 25MB'].map((chip) => (
                <span key={chip} className="rounded-full border border-border bg-secondary/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {chip}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 flex items-start gap-2 text-left text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  )
}
