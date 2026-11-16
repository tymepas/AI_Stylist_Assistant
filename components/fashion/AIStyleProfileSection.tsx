'use client'

import { type ComponentType, useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, ImagePlus, LoaderCircle, RefreshCw, ShieldCheck, Sparkles, Trash2 } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import AIProfileCard from '@/components/fashion/AIProfileCard'
import UploadCard from '@/components/fashion/UploadCard'
import { postFormData } from '@/lib/services/uploadRequest'
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

export default function AIStyleProfileSection({ onProfileChange }: AIStyleProfileSectionProps) {
  const [profile, setProfile] = useState<AIStyleProfile | null>(null)
  const [view, setView] = useState<View>('empty')
  // The prepared (resized, re-encoded) photo. Held in memory only until submitted.
  const [photo, setPhoto] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [regenerateOpen, setRegenerateOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)
  // A ref as well as state: two submissions in the same tick both read the current value.
  const submittingRef = useRef(false)
  const requestRef = useRef<AbortController | null>(null)

  // Leaving the page stops waiting for an in-flight request.
  useEffect(() => () => requestRef.current?.abort(), [])

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

  function handlePhotoSelected(file: File) {
    setError(null)
    setPhoto(file)
    setView('confirm')
  }

  function handlePhotoRemoved() {
    setPhoto(null)
    setView('upload')
  }

  function beginUpload() {
    setError(null)
    setPhoto(null)
    setView('upload')
  }

  async function generate() {
    if (!photo || submittingRef.current) return
    submittingRef.current = true
    setIsSubmitting(true)
    setView('loading')
    setError(null)
    const controller = new AbortController()
    requestRef.current = controller

    try {
      const formData = new FormData()
      // Generic file name: the original name can be personal and the server does not need it.
      formData.append('photo', photo, 'photo.jpg')

      // One request, no automatic retry: every attempt is rate limited and may be billable.
      const outcome = await postFormData('/api/generate-profile', formData, { signal: controller.signal })
      if (controller.signal.aborted) return

      if (!outcome.ok) {
        setError(outcome.message)
        setView('error')
        return
      }

      const body = outcome.data as AIStyleProfile | AIStyleProfileFailure | null

      if ((body as AIStyleProfileFailure | null)?.status === 'unable_to_generate') {
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
      // The response was not a valid Style DNA, or it could not be saved on this device.
      setError('We could not generate your style profile. Please try again.')
      setView('error')
    } finally {
      submittingRef.current = false
      requestRef.current = null
      setIsSubmitting(false)
    }
  }

  function retry() {
    if (photo) void generate()
    else beginUpload()
  }

  function chooseDifferentPhoto() {
    setPhoto(null)
    setError(null)
    setView('upload')
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

            {(view === 'upload' || view === 'confirm') && (
              <div className="mt-6">
                {/* One card for both steps, so a retake keeps its state while the new photo is prepared. */}
                <UploadCard
                  label="Style DNA photo"
                  description="Show your face and upper body in good, even lighting."
                  captureMode="user"
                  belowMinimum="reject"
                  file={photo}
                  onFileSelect={handlePhotoSelected}
                  onRemove={handlePhotoRemoved}
                  disabled={isSubmitting}
                />

                {view === 'confirm' && photo ? (
                  <div className="mt-4">
                    <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />Your photo is sent to our AI for analysis only when you press Build Style DNA, and is not stored on our servers.</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button className="focus-ring" disabled={isSubmitting} onClick={() => void generate()}>Build Style DNA</Button>
                      <Button variant="ghost" className="focus-ring" disabled={isSubmitting} onClick={() => { setPhoto(null); setError(null); setView('empty') }}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="focus-ring mt-4 text-sm text-muted-foreground hover:text-foreground" onClick={() => { setError(null); setView('empty') }}>Cancel</button>
                )}
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
