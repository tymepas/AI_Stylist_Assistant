'use client'

import { ChangeEvent, DragEvent, type ComponentType, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { AlertCircle, CheckCircle2, ImagePlus, LoaderCircle, RefreshCw, ShieldCheck, Sparkles, Trash2, UploadCloud, X } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import AIProfileCard from '@/components/fashion/AIProfileCard'
import { validateImageMeta } from '@/lib/services/analysisService'
import { clearProfile, getProfile, saveProfile } from '@/lib/services/aiStyleProfileService'
import { validateAIStyleProfile } from '@/lib/services/openai/aiStyleProfileSchema'
import type { AIStyleProfile, AIStyleProfileFailure } from '@/types/schema'

interface AIStyleProfileSectionProps {
  onProfileChange?: (profile: AIStyleProfile | null) => void
}

type View = 'empty' | 'upload' | 'confirm' | 'loading' | 'error' | 'generated'

const ProfileDialog = Dialog as ComponentType<any>
const ProfileDialogContent = DialogContent as ComponentType<any>
const ProfileDialogDescription = DialogDescription as ComponentType<any>
const ProfileDialogFooter = DialogFooter as ComponentType<any>
const ProfileDialogHeader = DialogHeader as ComponentType<any>
const ProfileDialogTitle = DialogTitle as ComponentType<any>

const MIN_DIMENSION = 512
const STYLE_DNA_LOADING_MESSAGES = [
  'Understanding your style...',
  'Identifying your coloring...',
  'Recognizing style signals...',
  'Building your Style DNA...',
  'Almost ready...',
]

function formatGeneratedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Recently'
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
}

function getFriendlyError(status: number, body: { error?: string; message?: string }): string {
  if (body.message) return body.message
  if (status === 504) return 'The analysis took too long. Please try again.'
  if (status === 429) return 'The analysis service is busy right now. Please wait a moment and try again.'
  return 'We could not generate your style profile. Please try again.'
}

async function validatePhoto(file: File): Promise<string | null> {
  const meta = validateImageMeta({ name: file.name, type: file.type, size: file.size })
  if (!meta.valid) return meta.message ?? 'Please choose a valid image.'

  try {
    const image = await createImageBitmap(file)
    try {
      if (image.width < MIN_DIMENSION || image.height < MIN_DIMENSION) {
        return 'Image must be at least 512×512 pixels. Please choose a different photo.'
      }
    } finally {
      image.close()
    }
  } catch {
    return 'The uploaded file does not appear to be a valid image. Please choose a different photo.'
  }

  return null
}

export default function AIStyleProfileSection({ onProfileChange }: AIStyleProfileSectionProps) {
  const [profile, setProfile] = useState<AIStyleProfile | null>(null)
  const [view, setView] = useState<View>('empty')
  const [photo, setPhoto] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [regenerateOpen, setRegenerateOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const stored = getProfile()
    setProfile(stored)
    onProfileChange?.(stored)
    setView(stored ? 'generated' : 'empty')
  }, [onProfileChange])

  useEffect(() => {
    if (view !== 'loading') {
      setLoadingMessageIndex(0)
      return
    }
    const interval = window.setInterval(() => {
      setLoadingMessageIndex((current) => (current + 1) % STYLE_DNA_LOADING_MESSAGES.length)
    }, 1800)
    return () => window.clearInterval(interval)
  }, [view])

  useEffect(() => {
    if (!photo) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(photo)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [photo])

  async function selectPhoto(file: File | undefined) {
    if (!file) return
    setError(null)
    const validationMessage = await validatePhoto(file)
    if (validationMessage) {
      setPhoto(null)
      setView('upload')
      setError(validationMessage)
      if (inputRef.current) inputRef.current.value = ''
      return
    }
    setPhoto(file)
    setView('confirm')
  }

  function beginUpload() {
    setError(null)
    setPhoto(null)
    setView('upload')
  }

  async function generate() {
    if (!photo || view === 'loading') return
    setView('loading')
    setError(null)

    try {
      const formData = new FormData()
      formData.append('photo', photo)
      const response = await fetch('/api/generate-profile', { method: 'POST', body: formData })
      const body = await response.json().catch(() => ({})) as AIStyleProfile | AIStyleProfileFailure | { error?: string; message?: string }

      if (!response.ok) {
        setError(getFriendlyError(response.status, body as { error?: string; message?: string }))
        setView('error')
        return
      }

      if ((body as AIStyleProfileFailure).status === 'unable_to_generate') {
        const failure = body as AIStyleProfileFailure
        setError(`${failure.reason} ${failure.next_step}`)
        setView('error')
        return
      }

      const generated = validateAIStyleProfile(body)
      saveProfile(generated)
      if (!getProfile()) {
        throw new Error('Profile storage is unavailable.')
      }
      setProfile(generated)
      onProfileChange?.(generated)
      setView('generated')
      setPhoto(null)
    } catch {
      setError('We could not reach the analysis service. Please check your connection and try again.')
      setView('error')
    }
  }

  function retry() {
    if (photo) generate()
    else beginUpload()
  }

  function chooseDifferentPhoto() {
    setPhoto(null)
    setError(null)
    setView('upload')
    if (inputRef.current) inputRef.current.value = ''
  }

  function confirmDelete() {
    clearProfile()
    setProfile(null)
    onProfileChange?.(null)
    setDeleteOpen(false)
    setPhoto(null)
    setView('empty')
  }

  const hasPreviousProfile = profile !== null

  return (
    <section aria-labelledby="ai-style-profile-heading" className="rounded-2xl border border-border bg-card p-6">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(event: ChangeEvent<HTMLInputElement>) => void selectPhoto(event.target.files?.[0])}
      />

      <AnimatePresence mode="wait" initial={false}>
        {(view === 'empty' || view === 'upload' || view === 'confirm') && (
          <motion.div key="setup" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Sparkles className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h3 id="ai-style-profile-heading" className="font-medium text-foreground">Your Style DNA</h3>
                <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">Generate your Style DNA once. Every future outfit analysis becomes more personal and more precise — with just one clear photo.</p>
              </div>
            </div>

            {view === 'empty' && <Button className="focus-ring mt-6" onClick={beginUpload}><Sparkles className="h-4 w-4" aria-hidden="true" /> Build Style DNA</Button>}

            {view === 'upload' && (
              <div className="mt-6">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => inputRef.current?.click()}
                  onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); inputRef.current?.click() } }}
                  onDragOver={(event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setIsDragging(true) }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setIsDragging(false); void selectPhoto(event.dataTransfer.files[0]) }}
                  aria-label="Upload a photo to build your Style DNA"
                  className={`focus-ring flex min-h-52 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed p-6 text-center transition-colors ${isDragging ? 'border-primary bg-primary/5' : 'border-border bg-secondary/20 hover:border-primary/50'}`}
                >
                  <UploadCloud className="h-7 w-7 text-primary" aria-hidden="true" />
                  <p className="mt-3 font-medium text-foreground">Start with one clear photo</p>
                  <p className="mt-1 text-sm text-muted-foreground">Show your face and upper body in good, even lighting.</p>
                  <p className="mt-3 text-xs text-muted-foreground">JPEG, PNG, WEBP · Max 10MB</p>
                </div>
                {error && <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{error}</p>}
                <button type="button" className="focus-ring mt-4 text-sm text-muted-foreground hover:text-foreground" onClick={() => { setError(null); setView('empty') }}>Cancel</button>
              </div>
            )}

            {view === 'confirm' && photo && previewUrl && (
              <div className="mt-6 rounded-xl border border-border bg-secondary/20 p-4 sm:flex sm:items-center sm:gap-5">
                <Image src={previewUrl} alt="Selected profile photo" width={112} height={112} unoptimized className="h-28 w-28 rounded-lg object-cover" />
                <div className="mt-4 min-w-0 sm:mt-0">
                  <p className="truncate text-sm font-medium text-foreground">{photo.name}</p>
                  <p className="mt-2 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />Your photo is sent to our AI for analysis and is not stored on our servers.</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button className="focus-ring" onClick={() => void generate()}>Build Style DNA</Button>
                    <Button variant="ghost" className="focus-ring" onClick={chooseDifferentPhoto}>Choose a different photo</Button>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        )}

        {view === 'loading' && (
          <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex min-h-56 flex-col items-center justify-center text-center" role="status" aria-live="polite">
            <LoaderCircle className="h-9 w-9 animate-spin text-primary" aria-hidden="true" />
            <h3 className="mt-4 font-medium text-foreground">{STYLE_DNA_LOADING_MESSAGES[loadingMessageIndex]}</h3>
            <p className="mt-1 text-sm text-muted-foreground">Understanding your coloring, style signals, and the details that make your recommendations feel personal.</p>
          </motion.div>
        )}

        {view === 'error' && (
          <motion.div key="error" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-destructive/30 bg-destructive/5 p-5" role="alert">
            <div className="flex gap-3"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" /><div><h3 className="font-medium text-foreground">We couldn’t build your Style DNA</h3><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{error}</p></div></div>
            <div className="mt-5 flex flex-wrap gap-2"><Button className="focus-ring" onClick={() => void retry()}><RefreshCw className="h-4 w-4" aria-hidden="true" />Try Again</Button><Button variant="outline" className="focus-ring" onClick={chooseDifferentPhoto}><ImagePlus className="h-4 w-4" aria-hidden="true" />Upload a Different Photo</Button></div>
            {hasPreviousProfile && <p className="mt-4 text-xs text-muted-foreground">Your previous Style DNA is still active.</p>}
          </motion.div>
        )}

        {view === 'generated' && profile && (
          <motion.div key="generated" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div><h3 id="ai-style-profile-heading" className="text-lg font-semibold tracking-tight text-foreground">Style DNA</h3><p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden="true" /><span>Built from a photo you chose</span><span aria-hidden="true">•</span><span>Generated {formatGeneratedAt(profile.generated_at_utc)}</span><span aria-hidden="true">•</span><span>Version {profile.schema_version}</span></p><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Your saved Style DNA carries long-term color and style signals into future analyses. You will always add a current photo for each outfit decision.</p></div>
              <div className="flex items-center gap-1"><Button size="sm" variant="outline" className="focus-ring" onClick={() => setRegenerateOpen(true)}><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Regenerate Style DNA</Button><Button size="sm" variant="ghost" className="focus-ring text-destructive hover:text-destructive" onClick={() => setDeleteOpen(true)}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" />Delete</Button></div>
            </div>
            <div className="mt-5"><AIProfileCard profile={profile} /></div>
          </motion.div>
        )}
      </AnimatePresence>

      <ProfileDialog open={regenerateOpen} onOpenChange={setRegenerateOpen}><ProfileDialogContent><ProfileDialogHeader><ProfileDialogTitle>Regenerate Style DNA?</ProfileDialogTitle><ProfileDialogDescription>Generating a new Style DNA replaces your current one. Your manually saved preferences and previous outfit analyses remain unchanged.</ProfileDialogDescription></ProfileDialogHeader><ProfileDialogFooter><Button variant="outline" onClick={() => setRegenerateOpen(false)}>Keep Current</Button><Button onClick={() => { setRegenerateOpen(false); beginUpload() }}>Regenerate Style DNA</Button></ProfileDialogFooter></ProfileDialogContent></ProfileDialog>
      <ProfileDialog open={deleteOpen} onOpenChange={setDeleteOpen}><ProfileDialogContent><ProfileDialogHeader><ProfileDialogTitle>Delete Style DNA?</ProfileDialogTitle><ProfileDialogDescription>Future outfit analyses will still work, but they will no longer use your saved Style DNA for personalization. Your manually saved preferences will not be affected.</ProfileDialogDescription></ProfileDialogHeader><ProfileDialogFooter><Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button><Button variant="destructive" onClick={confirmDelete}>Delete Profile</Button></ProfileDialogFooter></ProfileDialogContent></ProfileDialog>
    </section>
  )
}
