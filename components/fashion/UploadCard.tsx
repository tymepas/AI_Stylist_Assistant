'use client'

import { useRef, useState } from 'react'
import Image from 'next/image'
import { X, UploadCloud } from 'lucide-react'
import { cn } from '@/lib/utils'

interface UploadCardProps {
  label: string
  description: string
  file: File | null
  onFileSelect: (file: File) => void
  onRemove: () => void
}

export default function UploadCard({ label, description, file, onFileSelect, onRemove }: UploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const selected = files[0]
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(URL.createObjectURL(selected))
    onFileSelect(selected)
  }

  function handleRemove(e: React.MouseEvent) {
    e.stopPropagation()
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    onRemove()
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files) }}
      className={cn(
        'group relative flex min-h-[220px] cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 p-6 text-center transition-colors',
        isDragging ? 'border-primary bg-primary/5' : 'hover:border-primary/50 hover:bg-card'
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      {file && previewUrl ? (
        <>
          <div className="relative h-40 w-full overflow-hidden rounded-xl">
            <Image src={previewUrl} alt={label} fill className="object-cover" unoptimized />
          </div>
          <p className="mt-3 max-w-full truncate text-xs text-muted-foreground">{file.name}</p>
          <button
            onClick={handleRemove}
            className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-background/90 text-foreground shadow-md transition-transform hover:scale-105"
            type="button"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      ) : (
        <>
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-secondary transition-colors group-hover:bg-primary/10">
            <UploadCloud className="h-5 w-5 text-primary" />
          </div>
          <p className="font-medium text-foreground">{label}</p>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          <p className="mt-3 text-xs text-muted-foreground/70">JPEG, PNG or WEBP · up to 10MB</p>
        </>
      )}
    </div>
  )
}
