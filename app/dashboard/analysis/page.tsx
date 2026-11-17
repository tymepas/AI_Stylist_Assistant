'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, CheckCircle2, HelpCircle, ImageOff, LucideIcon, Pencil, Sparkles, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import UploadCard from '@/components/fashion/UploadCard'
import GarmentModeSelector from '@/components/fashion/GarmentModeSelector'
import GarmentUploader from '@/components/fashion/GarmentUploader'
import StylePreferencesPicker from '@/components/fashion/StylePreferencesPicker'
import LoadingAnalysis from '@/components/fashion/LoadingAnalysis'
import ErrorState from '@/components/fashion/ErrorState'
import DecisionReport from '@/components/fashion/DecisionReport'
import StepIndicator from '@/components/fashion/StepIndicator'
import StepTips from '@/components/fashion/StepTips'
import { GARMENT_MODE_LABELS, garmentCountProblem, type GarmentMode } from '@/lib/constants/garmentModes'
import { OCCASION_GROUPS } from '@/lib/constants/options'
import { validateImageMeta } from '@/lib/services/analysisService'
import { utf8ByteLength } from '@/lib/services/requestLimits'
import { postFormData, type UploadFailureKind } from '@/lib/services/uploadRequest'
import { isWithinRequestBudget } from '@/lib/images/prepareImageForUpload'
import { readStorage, writeStorage } from '@/lib/services/browserStorage'
import { emptyProfile, getProfile, saveProfile } from '@/lib/services/styleProfileService'
import { getProfile as getAIStyleProfile } from '@/lib/services/aiStyleProfileService'
import type { AIStyleProfile, StyleProfile } from '@/types/schema'
import { AnalysisResult, CompleteAnalysisResult, ImageMeta } from '@/types/schema'

type Stage = 'form' | 'loading' | 'result' | 'error'

interface ErrorInfo {
  title: string
  message: string
  icon?: LucideIcon
}

/** The journey, in order. The analysis itself and the verdict follow the last step. */
const STEPS = [
  { label: 'Your photo' },
  { label: 'Garment photos' },
  { label: 'Upload' },
  { label: 'Occasion' },
  { label: 'Preferences' },
  { label: 'Review' },
]
const STEP = { photo: 1, mode: 2, garments: 3, occasion: 4, preferences: 5, review: 6 } as const

const PHOTO_TIPS = ['Use natural, even lighting', 'Face the camera directly, torso visible', 'Avoid heavy filters or busy backgrounds']
const GARMENT_TIPS: Record<GarmentMode, string[]> = {
  single: ['Lay flat or hang the garment', 'Capture the full item in frame', 'Use a plain, uncluttered background'],
  same_garment_views: ['Show the same item in every photo', 'Front, back and side work best', 'Keep the lighting the same across photos'],
  outfit_items: ['One item per photo', 'Add the items you would wear together', 'Use a plain, uncluttered background'],
}

function formatStyleDNADate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'recently'
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
}

function toImageMeta(file: File): ImageMeta {
  return { name: file.name, type: file.type, size: file.size }
}

function iconForFailure(kind: UploadFailureKind): LucideIcon | undefined {
  if (kind === 'invalid_request' || kind === 'payload_too_large') return ImageOff
  if (kind === 'offline' || kind === 'network') return WifiOff
  return undefined
}

function isAnalysisResult(value: unknown): value is AnalysisResult {
  const status = (value as { status?: unknown } | null)?.status
  return status === 'complete' || status === 'unable_to_analyze'
}

function useObjectURL(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!file) {
      setUrl(null)
      return
    }
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])

  return url
}

/** A small in-memory preview. The object URL is revoked when the file changes or the thumbnail unmounts. */
function Thumbnail({ file, alt, className = 'h-24 w-20' }: { file: File; alt: string; className?: string }) {
  const url = useObjectURL(file)
  return (
    <div className={`group shrink-0 overflow-hidden rounded-lg border border-border bg-secondary/40 ${className}`}>
      {url ? <img src={url} alt={alt} className="image-zoom h-full w-full object-cover" /> : null}
    </div>
  )
}

function garmentLabel(mode: GarmentMode, index: number): string {
  if (mode === 'single') return 'Garment'
  return mode === 'same_garment_views' ? `Garment view ${index + 1}` : `Outfit item ${index + 1}`
}

function describePreferences(profile: StyleProfile): string {
  const parts = [...profile.preferredStyles, ...profile.favoriteColors]
  return parts.length > 0 ? parts.join(', ') : 'None added. The style preference dimension will say so.'
}

const slideVariants = {
  enter: { opacity: 0, x: 24 },
  center: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -24 },
}

export default function AnalysisPage() {
  const [formStep, setFormStep] = useState<number>(STEP.photo)
  const [photo, setPhoto] = useState<File | null>(null)
  // Null until the user chooses. The mode is never inferred from the number of photos.
  const [garmentMode, setGarmentMode] = useState<GarmentMode | null>(null)
  const [garments, setGarments] = useState<File[]>([])
  // A mode the user asked for that would need photos to be removed first. Nothing is removed until they confirm.
  const [pendingMode, setPendingMode] = useState<GarmentMode | null>(null)
  const [occasion, setOccasion] = useState<string>('')
  const [preferences, setPreferences] = useState<StyleProfile>(emptyProfile)
  const [stage, setStage] = useState<Stage>('form')
  const [result, setResult] = useState<CompleteAnalysisResult | null>(null)
  const [errorInfo, setErrorInfo] = useState<ErrorInfo | null>(null)
  const [aiStyleProfile, setAIStyleProfile] = useState<AIStyleProfile | null>(null)
  const [profilePromptDismissed, setProfilePromptDismissed] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  // A ref as well as state: two submissions in the same tick both read the current value.
  const submittingRef = useRef(false)
  const requestRef = useRef<AbortController | null>(null)

  useEffect(() => {
    setAIStyleProfile(getAIStyleProfile())
    setPreferences(getProfile() ?? emptyProfile)
    setProfilePromptDismissed(readStorage('verdict_profile_prompt_dismissed') === 'true')
  }, [])

  // Leaving the page stops waiting for an in-flight analysis.
  useEffect(() => () => requestRef.current?.abort(), [])

  const garmentProblem = garmentMode ? garmentCountProblem(garmentMode, garments.length) : 'Choose how many garment photos you have.'

  function chooseMode(next: GarmentMode) {
    // Switching to one garment photo while several are added would discard photos: ask first.
    if (next === 'single' && garments.length > 1) {
      setPendingMode(next)
      return
    }
    setPendingMode(null)
    setGarmentMode(next)
  }

  function confirmPendingMode() {
    if (!pendingMode) return
    setGarments((current) => current.slice(0, 1))
    setGarmentMode(pendingMode)
    setPendingMode(null)
  }

  function updatePreferences(next: StyleProfile) {
    setPreferences(next)
    // Preferences are text only and are saved on this device, as on the Style Profile page.
    saveProfile(next)
  }

  async function handleAnalyze() {
    if (submittingRef.current) return

    if (!photo || !garmentMode || garments.length === 0 || !occasion) {
      setErrorInfo({
        title: 'Missing Information',
        message: 'Please upload a personal photo, a clothing image, and select an occasion before analyzing.',
      })
      setStage('error')
      return
    }

    const countProblem = garmentCountProblem(garmentMode, garments.length)
    if (countProblem) {
      setErrorInfo({ title: 'Garment Photos', message: countProblem, icon: ImageOff })
      setStage('error')
      return
    }

    // Every file was already prepared in the browser (resized, re-encoded as JPEG).
    const photoCheck = validateImageMeta(toImageMeta(photo))
    if (!photoCheck.valid) {
      setErrorInfo({ title: 'Invalid Upload', message: `Personal photo: ${photoCheck.message}`, icon: ImageOff })
      setStage('error')
      return
    }
    for (let index = 0; index < garments.length; index += 1) {
      const garmentCheck = validateImageMeta(toImageMeta(garments[index]))
      if (!garmentCheck.valid) {
        const label = garments.length === 1 ? 'Garment photo' : `Garment photo ${index + 1}`
        setErrorInfo({ title: 'Invalid Upload', message: `${label}: ${garmentCheck.message}`, icon: ImageOff })
        setStage('error')
        return
      }
    }

    const styleProfileJson = JSON.stringify(getProfile() ?? emptyProfile)
    const storedAIProfile = getAIStyleProfile()
    const aiStyleProfileJson = storedAIProfile ? JSON.stringify(storedAIProfile) : null
    const textBytes = utf8ByteLength(occasion) + utf8ByteLength(styleProfileJson) + (aiStyleProfileJson ? utf8ByteLength(aiStyleProfileJson) : 0)

    // The hosting platform rejects request bodies above 4.5 MB before our API runs.
    if (!isWithinRequestBudget([photo.size, ...garments.map((garment) => garment.size)], textBytes)) {
      setErrorInfo({
        title: 'Photos Too Large',
        message: 'Your photos are too large to send together. Please choose smaller photos and try again.',
        icon: ImageOff,
      })
      setStage('error')
      return
    }

    submittingRef.current = true
    setIsSubmitting(true)
    setStage('loading')
    const controller = new AbortController()
    requestRef.current = controller

    try {
      const formData = new FormData()
      formData.append('occasion', occasion)
      // Generic file names: the original name can be personal and the server does not need it.
      formData.append('photo', photo, 'photo.jpg')
      garments.forEach((garment, index) => {
        formData.append('garment', garment, garments.length === 1 ? 'garment.jpg' : `garment-${index + 1}.jpg`)
      })
      // The mode the user chose, sent explicitly. The server never guesses it from the number of photos.
      formData.append('garmentMode', garmentMode)
      formData.append('styleProfile', styleProfileJson)
      if (aiStyleProfileJson) formData.append('aiStyleProfile', aiStyleProfileJson)

      // One request, no automatic retry: every attempt is rate limited and may be billable.
      const outcome = await postFormData('/api/analyze', formData, { signal: controller.signal })
      if (controller.signal.aborted) return

      if (!outcome.ok) {
        setErrorInfo({ title: outcome.title, message: outcome.message, icon: iconForFailure(outcome.kind) })
        setStage('error')
        return
      }

      if (!isAnalysisResult(outcome.data)) {
        setErrorInfo({ title: 'Something Went Wrong', message: 'We received an unexpected response. Please try again.' })
        setStage('error')
        return
      }

      const data = outcome.data

      if (data.status === 'unable_to_analyze') {
        setErrorInfo({
          title: 'Unable to Analyze',
          message: `${data.reason} ${data.next_step}`,
          icon: HelpCircle,
        })
        setStage('error')
        return
      }

      setResult(data)
      setStage('result')
    } catch {
      setErrorInfo({
        title: 'Something Went Wrong',
        message: 'We could not send your photos. Please try again.',
      })
      setStage('error')
    } finally {
      submittingRef.current = false
      requestRef.current = null
      setIsSubmitting(false)
    }
  }

  function handleReset() {
    setPhoto(null)
    setGarmentMode(null)
    setGarments([])
    setPendingMode(null)
    setOccasion('')
    setFormStep(STEP.photo)
    setStage('form')
    setResult(null)
    setErrorInfo(null)
  }

  function handleCompare() {
    // Keep the photo and the mode, discard the garment photos, the occasion and the previous result.
    setGarments([])
    setOccasion('')
    setFormStep(garmentMode ? STEP.garments : STEP.mode)
    setStage('form')
    setResult(null)
    setErrorInfo(null)
  }

  function handleRetryFromError() {
    // Return to whichever step still needs attention instead of wiping the whole form.
    if (!photo) setFormStep(STEP.photo)
    else if (!garmentMode) setFormStep(STEP.mode)
    else if (garmentCountProblem(garmentMode, garments.length)) setFormStep(STEP.garments)
    else if (!occasion) setFormStep(STEP.occasion)
    else setFormStep(STEP.review)
    setStage('form')
    setErrorInfo(null)
  }

  if (stage === 'loading') return <LoadingAnalysis />
  if (stage === 'result' && result) return <DecisionReport result={result} onReset={handleReset} onCompare={handleCompare} occasion={occasion} />
  if (stage === 'error' && errorInfo) {
    return <ErrorState title={errorInfo.title} message={errorInfo.message} icon={errorInfo.icon} onRetry={handleRetryFromError} />
  }

  const back = (step: number) => (
    <Button size="lg" variant="ghost" className="focus-ring" onClick={() => setFormStep(step)}>
      <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
    </Button>
  )
  const next = (step: number, disabled: boolean, label = 'Continue') => (
    <Button size="lg" className="focus-ring" disabled={disabled} onClick={() => setFormStep(step)}>
      {label} <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </Button>
  )
  const stepMotion = { variants: slideVariants, initial: 'enter', animate: 'center', exit: 'exit', transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] } } as const

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <p className="eyebrow">New analysis</p>
        <h2 className="mt-2 font-display text-4xl text-foreground sm:text-5xl">Should you buy it?</h2>
        <p className="mt-3 max-w-2xl leading-relaxed text-muted-foreground">Add your photo, the garment and the occasion. Verdict rates six dimensions and calculates one clear recommendation from them.</p>
      </div>

      {aiStyleProfile ? (
        <section aria-label="Style DNA personalization is active" className="surface-quiet px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary/10">
                <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
              </div>
              <div>
                <p className="font-medium text-foreground">Personalization active</p>
                <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">Your current photo reflects how you look today. Your Style DNA adds long-term color and style signals. Together, they create a more personal outfit recommendation.</p>
                <p className="mt-2 text-xs text-muted-foreground/80">Style DNA generated {formatStyleDNADate(aiStyleProfile.generated_at_utc)}. It is saved profile context; your original profile photo is not retained.</p>
              </div>
            </div>
            <Link href="/dashboard/profile" className="focus-ring shrink-0 rounded-full px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/10">View Style DNA</Link>
          </div>
        </section>
      ) : !profilePromptDismissed ? (
        <div className="surface-quiet flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-muted-foreground">
          <span>Style DNA is optional. Adding it makes results more personal.</span>
          <div className="flex items-center gap-3"><Link href="/dashboard/profile" className="focus-ring font-medium text-primary hover:underline">Build Style DNA</Link><button type="button" className="focus-ring text-muted-foreground hover:text-foreground" onClick={() => { writeStorage('verdict_profile_prompt_dismissed', 'true'); setProfilePromptDismissed(true) }}>Dismiss</button></div>
        </div>
      ) : null}

      <StepIndicator steps={STEPS} currentStep={formStep} />

      <div className="surface min-h-[360px] overflow-hidden p-5 sm:p-8">
        <AnimatePresence mode="wait" initial={false}>
          {formStep === STEP.photo && (
            <motion.div key="photo" {...stepMotion}>
              <h3 className="font-display text-3xl text-foreground">Start with a photo of you</h3>
              <p className="mt-2 text-sm text-muted-foreground">It stays on your device until you start the analysis.</p>
              <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_240px]">
                <UploadCard
                  label="Current Photo"
                  description="A clear, current photo of yourself"
                  captureMode="user"
                  file={photo}
                  onFileSelect={setPhoto}
                  onRemove={() => setPhoto(null)}
                />
                <StepTips title="For best results" tips={PHOTO_TIPS} />
              </div>
              <div className="mt-8 flex justify-end">{next(STEP.mode, !photo)}</div>
            </motion.div>
          )}

          {formStep === STEP.mode && (
            <motion.div key="mode" {...stepMotion}>
              <h3 className="font-display text-3xl text-foreground">How many garment photos do you have?</h3>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">Choose one. Verdict treats the photos exactly as you say here and never guesses from how many you add.</p>
              <div className="mt-6">
                <GarmentModeSelector value={garmentMode} onChange={chooseMode} />
              </div>

              {pendingMode ? (
                <div role="alertdialog" aria-label="Remove garment photos" className="mt-5 rounded-2xl border border-primary/30 bg-primary/[0.06] p-4 text-sm">
                  <p className="text-foreground">You have {garments.length} garment photos. {GARMENT_MODE_LABELS[pendingMode].title} keeps only the first one and removes the other {garments.length - 1}.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" className="focus-ring" onClick={() => setPendingMode(null)}>Keep my photos</Button>
                    <Button size="sm" className="focus-ring" onClick={confirmPendingMode}>Switch and remove {garments.length - 1}</Button>
                  </div>
                </div>
              ) : null}

              <div className="mt-8 flex justify-between">
                {back(STEP.photo)}
                {next(STEP.garments, !garmentMode)}
              </div>
            </motion.div>
          )}

          {formStep === STEP.garments && garmentMode && (
            <motion.div key="garments" {...stepMotion}>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h3 className="font-display text-3xl text-foreground">{garmentMode === 'single' ? 'Add the garment' : garmentMode === 'same_garment_views' ? 'Add views of the garment' : 'Add the outfit items'}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{GARMENT_MODE_LABELS[garmentMode].description}</p>
                </div>
                <button type="button" className="focus-ring inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-primary hover:bg-primary/10" onClick={() => setFormStep(STEP.mode)}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Change
                </button>
              </div>
              <div className={garmentMode === 'single' ? 'mt-6 grid gap-6 lg:grid-cols-[1fr_240px]' : 'mt-6 space-y-6'}>
                <GarmentUploader mode={garmentMode} garments={garments} onChange={setGarments} />
                <StepTips title="For best results" tips={GARMENT_TIPS[garmentMode]} />
              </div>
              <div className="mt-8 flex justify-between">
                {back(STEP.mode)}
                {next(STEP.occasion, garmentProblem !== null)}
              </div>
            </motion.div>
          )}

          {formStep === STEP.occasion && (
            <motion.div key="occasion" {...stepMotion}>
              <h3 className="font-display text-3xl text-foreground">Where will you wear it?</h3>
              <p className="mt-2 text-sm text-muted-foreground">The occasion carries the most weight in the verdict.</p>
              <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_240px]">
                <div>
                  <label htmlFor="occasion-select" className="text-sm font-medium text-foreground">Choose the occasion</label>
                  <Select value={occasion} onValueChange={setOccasion}>
                    <SelectTrigger id="occasion-select" className="focus-ring mt-3 h-12 rounded-xl">
                      <SelectValue placeholder="Select an occasion" />
                    </SelectTrigger>
                    <SelectContent>
                      {OCCASION_GROUPS.map((group) => (
                        <SelectGroup key={group.label}>
                          <SelectLabel>{group.label}</SelectLabel>
                          {group.options.map((o) => (
                            <SelectItem key={o} value={o}>{o}</SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <StepTips
                  title="How the verdict is weighted"
                  tips={[
                    'Occasion carries the most weight (30%)',
                    'Formality is weighted second (25%)',
                    'Style preference match follows at 20%',
                  ]}
                />
              </div>
              <div className="mt-8 flex justify-between">
                {back(STEP.garments)}
                {next(STEP.preferences, !occasion)}
              </div>
            </motion.div>
          )}

          {formStep === STEP.preferences && (
            <motion.div key="preferences" {...stepMotion}>
              <h3 className="font-display text-3xl text-foreground">Your style preferences</h3>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">Optional. They are used for one dimension only, style preference match, and are saved on this device. Skip this step if you prefer.</p>
              <div className="mt-6">
                <StylePreferencesPicker value={preferences} onChange={updatePreferences} />
              </div>
              <div className="mt-8 flex justify-between">
                {back(STEP.occasion)}
                {next(STEP.review, false)}
              </div>
            </motion.div>
          )}

          {formStep === STEP.review && garmentMode && (
            <motion.div key="review" {...stepMotion}>
              <h3 className="font-display text-3xl text-foreground">Review and analyze</h3>
              <p className="mt-2 text-sm text-muted-foreground">Nothing has been sent yet. Your photos are sent once, when you press Analyze.</p>

              <dl className="mt-6 divide-y divide-border rounded-2xl border border-border">
                <div className="flex items-center gap-4 p-4">
                  {photo ? <Thumbnail file={photo} alt="Your photo, as it will be sent" /> : null}
                  <div className="min-w-0 flex-1">
                    <dt className="eyebrow">Your photo</dt>
                    <dd className="mt-1 text-sm text-foreground">{photo ? 'Ready' : 'Missing'}</dd>
                  </div>
                  <Button size="sm" variant="ghost" className="focus-ring" onClick={() => setFormStep(STEP.photo)} aria-label="Change your photo">Change</Button>
                </div>
                {/* Wraps on a phone: three thumbnails leave no room for the text beside them. */}
                <div className="flex flex-wrap items-center gap-4 p-4">
                  <div className="flex shrink-0 gap-2">
                    {garments.map((garment, index) => (
                      <Thumbnail key={index} file={garment} alt={`${garmentLabel(garmentMode, index)}, as it will be sent`} className="h-24 w-16 sm:w-20" />
                    ))}
                  </div>
                  <div className="min-w-[10rem] flex-1">
                    <dt className="eyebrow">Garment photos</dt>
                    <dd className="mt-1 text-sm text-foreground">{GARMENT_MODE_LABELS[garmentMode].title} · {garments.length} {garments.length === 1 ? 'photo' : 'photos'}</dd>
                    {garmentProblem ? <dd className="mt-1 text-sm text-destructive">{garmentProblem}</dd> : null}
                  </div>
                  <Button size="sm" variant="ghost" className="focus-ring" onClick={() => setFormStep(STEP.garments)} aria-label="Change the garment photos">Change</Button>
                </div>
                <div className="flex items-center gap-4 p-4">
                  <div className="min-w-0 flex-1">
                    <dt className="eyebrow">Occasion</dt>
                    <dd className="mt-1 text-sm text-foreground">{occasion || 'Not selected'}</dd>
                  </div>
                  <Button size="sm" variant="ghost" className="focus-ring" onClick={() => setFormStep(STEP.occasion)} aria-label="Change the occasion">Change</Button>
                </div>
                <div className="flex items-center gap-4 p-4">
                  <div className="min-w-0 flex-1">
                    <dt className="eyebrow">Style preferences</dt>
                    <dd className="mt-1 text-sm text-foreground">{describePreferences(preferences)}</dd>
                    <dd className="mt-1 text-xs text-muted-foreground">Style DNA: {aiStyleProfile ? 'active' : 'not added (optional)'}</dd>
                  </div>
                  <Button size="sm" variant="ghost" className="focus-ring" onClick={() => setFormStep(STEP.preferences)} aria-label="Change your style preferences">Change</Button>
                </div>
              </dl>

              <div className="mt-8 flex justify-between">
                {back(STEP.preferences)}
                <Button size="lg" className="focus-ring" disabled={!photo || !occasion || garmentProblem !== null || isSubmitting} onClick={handleAnalyze}>
                  <Sparkles className="h-4 w-4" aria-hidden="true" /> Analyze
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
