'use client'

import { useRef, useState } from 'react'
import Image from 'next/image'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import { X, UploadCloud, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { validateImageMeta } from '@/lib/services/analysisService'

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
  const [justUploaded, setJustUploaded] = useState(false)

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const selected = files[0]

    const check = validateImageMeta({ name: selected.name, type: selected.type, size: selected.size })
    if (!check.valid) {
      toast.error(check.message ?? 'That file cannot be used.')
      if (inputRef.current) inputRef.current.value = ''
      return
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(URL.createObjectURL(selected))
    onFileSelect(selected)
    setJustUploaded(true)
    setTimeout(() => setJustUploaded(false), 1600)
  }

  function handleRemove(e: React.MouseEvent | React.KeyboardEvent) {
    e.stopPropagation()
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    onRemove()
    if (inputRef.current) inputRef.current.value = ''
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      inputRef.current?.click()
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={file ? `${label} uploaded. Press Enter to replace.` : `Upload ${label}`}
      onClick={() => inputRef.current?.click()}
      onKeyDown={handleKeyDown}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files) }}
      className={cn(
        'group focus-ring relative flex min-h-[240px] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed border-border bg-card/50 p-6 text-center transition-all duration-300',
        isDragging ? 'scale-[1.01] border-primary bg-primary/5 shadow-lg shadow-primary/10' : 'hover:border-primary/50 hover:bg-card'
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => handleFiles(e.target.files)}
      />
      <AnimatePresence mode="wait">
        {file && previewUrl ? (
          <motion.div
            key="preview"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.25 }}
            className="relative w-full"
          >
            <div className="relative h-44 w-full overflow-hidden rounded-xl">
              <Image src={previewUrl} alt={`${label} preview`} fill className="object-cover" unoptimized />
              <AnimatePresence>
                {justUploaded && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 flex items-center justify-center bg-background/60"
                  >
                    <motion.div
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 18 }}
                      className="flex items-center gap-1.5 rounded-full bg-emerald-500/90 px-3 py-1.5 text-xs font-medium text-white shadow-lg"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Uploaded
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <p className="mt-3 max-w-full truncate text-xs text-muted-foreground">{file.name}</p>
            <button
              onClick={handleRemove}
              onKeyDown={(e) => e.key === 'Enter' && handleRemove(e)}
              aria-label={`Remove ${label}`}
              className="focus-ring absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-background/90 text-foreground shadow-md transition-transform hover:scale-110"
              type="button"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col items-center"
          >
            <motion.div
              animate={isDragging ? { scale: 1.1 } : { scale: 1 }}
              className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-secondary transition-colors group-hover:bg-primary/10"
            >
              <UploadCloud className="h-6 w-6 text-primary" aria-hidden="true" />
            </motion.div>
            <p className="font-medium text-foreground">{label}</p>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            <p className="mt-1.5 text-xs text-muted-foreground/70">Drag and drop, or click to browse</p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
              {['JPEG', 'PNG', 'WEBP'].map((t) => (
                <span key={t} className="rounded-full border border-border bg-secondary/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {t}
                </span>
              ))}
              <span className="rounded-full border border-border bg-secondary/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                Up to 10MB
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
