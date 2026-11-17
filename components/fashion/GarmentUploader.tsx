'use client'

import { ArrowLeft, ArrowRight, Info } from 'lucide-react'
import UploadCard from '@/components/fashion/UploadCard'
import { Button } from '@/components/ui/button'
import { MAX_GARMENT_IMAGES, garmentCountProblem, type GarmentMode } from '@/lib/constants/garmentModes'
import { MULTI_GARMENT_TARGET_BYTES } from '@/lib/images/prepareImageForUpload'

interface GarmentUploaderProps {
  mode: GarmentMode
  /** The prepared garment photos, in the order they will be sent. */
  garments: File[]
  onChange: (garments: File[]) => void
  disabled?: boolean
}

const fingerprints = new WeakMap<File, Promise<string>>()

function readBytes(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file)
  })
}

/** A cheap content fingerprint (size plus FNV-1a over the bytes), computed in memory and never stored. */
function fingerprint(file: File): Promise<string> {
  let pending = fingerprints.get(file)
  if (!pending) {
    pending = readBytes(file)
      .then((buffer) => {
        const bytes = new Uint8Array(buffer)
        let hash = 0x811c9dc5
        for (let i = 0; i < bytes.length; i += 1) hash = Math.imul(hash ^ bytes[i], 0x01000193) >>> 0
        return `${bytes.length}:${hash.toString(16)}`
      })
      // If the bytes cannot be read, treat the photo as unique: a missed duplicate is caught by the server.
      .catch(() => `unreadable:${Math.random()}`)
    fingerprints.set(file, pending)
  }
  return pending
}

function slotLabel(mode: GarmentMode, index: number): string {
  if (mode === 'single') return 'Clothing Image'
  return mode === 'same_garment_views' ? `Garment view ${index + 1}` : `Outfit item ${index + 1}`
}

function slotDescription(mode: GarmentMode, index: number): string {
  if (mode === 'single') return "The garment you're deciding on"
  if (mode === 'same_garment_views') return index === 0 ? 'One view of the garment, such as the front' : 'Another view of the same garment'
  return index === 0 ? 'One item of the outfit' : 'A different item of the same outfit'
}

/**
 * The garment photos of one analysis: one photo, or two to three in the mode
 * the user chose. Photos can be added, replaced, removed and reordered. Nothing
 * is uploaded here; the photos stay in memory until the analysis is submitted.
 *
 * A photo is never dropped or reassigned silently: the number of photos is
 * checked against the mode and the user is told what is missing or too many.
 */
export default function GarmentUploader({ mode, garments, onChange, disabled = false }: GarmentUploaderProps) {
  const multiple = mode !== 'single'
  const capacity = multiple ? MAX_GARMENT_IMAGES : 1
  const problem = garmentCountProblem(mode, garments.length)
  const targetBytes = multiple ? MULTI_GARMENT_TARGET_BYTES : undefined

  /** Refuses a photo that is already in another slot. */
  const refuseDuplicate = (slot: number) => async (candidate: File): Promise<string | null> => {
    const mine = await fingerprint(candidate)
    for (let index = 0; index < garments.length; index += 1) {
      if (index !== slot && (await fingerprint(garments[index])) === mine) {
        return `This is the same photo as ${slotLabel(mode, index).toLowerCase()}. Please choose a different photo.`
      }
    }
    return null
  }

  const setAt = (index: number, file: File) => onChange(index < garments.length ? garments.map((item, i) => (i === index ? file : item)) : [...garments, file])
  const removeAt = (index: number) => onChange(garments.filter((_, i) => i !== index))
  const move = (index: number, offset: -1 | 1) => {
    const target = index + offset
    if (target < 0 || target >= garments.length) return
    const next = [...garments]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }

  if (!multiple) {
    return (
      <UploadCard
        label={slotLabel(mode, 0)}
        description={slotDescription(mode, 0)}
        captureMode="environment"
        file={garments[0] ?? null}
        onFileSelect={(file) => onChange([file])}
        onRemove={() => onChange([])}
        disabled={disabled}
      />
    )
  }

  // Filled slots, then one empty slot while there is room for another photo.
  const slots = garments.length < capacity ? garments.length + 1 : garments.length

  return (
    <div data-testid="garment-uploader">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: slots }, (_, index) => {
          const file = garments[index] ?? null
          const label = slotLabel(mode, index)
          return (
            <div key={index} data-testid={`garment-slot-${index + 1}`}>
              <UploadCard
                compact
                label={label}
                description={slotDescription(mode, index)}
                captureMode="environment"
                file={file}
                targetBytes={targetBytes}
                validatePrepared={refuseDuplicate(index)}
                keepPreviousOnReplace
                onFileSelect={(selected) => setAt(index, selected)}
                onRemove={() => removeAt(index)}
                disabled={disabled}
                previewActions={
                  file && garments.length > 1 ? (
                    <>
                      <Button type="button" size="sm" variant="ghost" className="focus-ring" disabled={disabled || index === 0} onClick={() => move(index, -1)} aria-label={`Move ${label} earlier`}>
                        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Earlier
                      </Button>
                      <Button type="button" size="sm" variant="ghost" className="focus-ring" disabled={disabled || index === garments.length - 1} onClick={() => move(index, 1)} aria-label={`Move ${label} later`}>
                        Later <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </>
                  ) : undefined
                }
              />
            </div>
          )
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-x-6 gap-y-2 text-sm">
        <p className="text-muted-foreground" data-testid="garment-count">
          {garments.length} of {capacity} photos added
        </p>
        {problem ? (
          <p role="status" className="flex items-start gap-2 text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            {problem}
          </p>
        ) : null}
      </div>
    </div>
  )
}
