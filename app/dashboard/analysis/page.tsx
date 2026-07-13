'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ImageOff, HelpCircle, LucideIcon, ArrowLeft, ArrowRight, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import UploadCard from '@/components/fashion/UploadCard'
import LoadingAnalysis from '@/components/fashion/LoadingAnalysis'
import ErrorState from '@/components/fashion/ErrorState'
import DecisionReport from '@/components/fashion/DecisionReport'
import StepIndicator from '@/components/fashion/StepIndicator'
import StepTips from '@/components/fashion/StepTips'
import { OCCASION_GROUPS } from '@/lib/constants/options'
import { validateImageMeta } from '@/lib/services/analysisService'
import { emptyProfile, getProfile } from '@/lib/services/styleProfileService'
import { AnalysisResult, CompleteAnalysisResult, ImageMeta } from '@/types/schema'

type Stage = 'form' | 'loading' | 'result' | 'error'

interface ErrorInfo {
  title: string
  message: string
  icon?: LucideIcon
}

const STEPS = [{ label: 'Your Photo' }, { label: 'Garment' }, { label: 'Occasion' }]

const PHOTO_TIPS = ['Use natural, even lighting', 'Face the camera directly, torso visible', 'Avoid heavy filters or busy backgrounds']
const GARMENT_TIPS = ['Lay flat or hang the garment', 'Capture the full item in frame', 'Use a plain, uncluttered background']
const MIN_ANALYSIS_DIMENSION = 512

function toImageMeta(file: File): ImageMeta {
  return { name: file.name, type: file.type, size: file.size }
}

/** Returns the original File unless its shorter side needs upscaling for analysis. */
async function prepareImageForAnalysis(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file)

  try {
    if (bitmap.width >= MIN_ANALYSIS_DIMENSION && bitmap.height >= MIN_ANALYSIS_DIMENSION) {
      return file
    }

    const scale = Math.max(MIN_ANALYSIS_DIMENSION / bitmap.width, MIN_ANALYSIS_DIMENSION / bitmap.height)
    const width = Math.ceil(bitmap.width * scale)
    const height = Math.ceil(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d')
    if (!context) throw new Error('Unable to prepare image.')
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, 0, 0, width, height)

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, file.type, file.type === 'image/png' ? undefined : 0.92)
    })
    if (!blob) throw new Error('Unable to prepare image.')

    return new File([blob], file.name, { type: blob.type, lastModified: file.lastModified })
  } finally {
    bitmap.close()
  }
}

/** Generates a stable object URL for a file and revokes the previous one. */
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

export default function AnalysisPage() {
  const [formStep, setFormStep] = useState(1)
  const [photo, setPhoto] = useState<File | null>(null)
  const [garment, setGarment] = useState<File | null>(null)
  const [occasion, setOccasion] = useState<string>('')
  const [stage, setStage] = useState<Stage>('form')
  const [result, setResult] = useState<CompleteAnalysisResult | null>(null)
  const [errorInfo, setErrorInfo] = useState<ErrorInfo | null>(null)

  const photoThumbnailUrl = useObjectURL(photo)

  async function handleAnalyze() {
    if (!photo || !garment || !occasion) {
      setErrorInfo({
        title: 'Missing Information',
        message: 'Please upload a personal photo, a clothing image, and select an occasion before analyzing.',
      })
      setStage('error')
      return
    }

    const photoMeta = toImageMeta(photo)
    const garmentMeta = toImageMeta(garment)

    const photoCheck = validateImageMeta(photoMeta)
    if (!photoCheck.valid) {
      setErrorInfo({ title: 'Invalid Upload', message: `Personal photo: ${photoCheck.message}`, icon: ImageOff })
      setStage('error')
      return
    }
    const garmentCheck = validateImageMeta(garmentMeta)
    if (!garmentCheck.valid) {
      setErrorInfo({ title: 'Invalid Upload', message: `Garment photo: ${garmentCheck.message}`, icon: ImageOff })
      setStage('error')
      return
    }

    setStage('loading')

    try {

      const analysisPhoto = await prepareImageForAnalysis(photo)
      const analysisGarment = await prepareImageForAnalysis(garment)

      const analysisPhotoCheck = validateImageMeta(toImageMeta(analysisPhoto))
      if (!analysisPhotoCheck.valid) throw new Error(`Personal photo: ${analysisPhotoCheck.message}`)
      const analysisGarmentCheck = validateImageMeta(toImageMeta(analysisGarment))
      if (!analysisGarmentCheck.valid) throw new Error(`Garment photo: ${analysisGarmentCheck.message}`)

      const formData = new FormData()
      formData.append('occasion', occasion)
      formData.append('photo', analysisPhoto)
      formData.append('garment', analysisGarment)
      formData.append('styleProfile', JSON.stringify(getProfile() ?? emptyProfile))

      const response = await fetch('/api/analyze', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}))
        setErrorInfo({
          title: errBody.error === 'missing_image' ? 'Missing Information' : 'Invalid Upload',
          message: errBody.message ?? 'Something went wrong while validating your upload.',
          icon: ImageOff,
        })
        setStage('error')
        return
      }

      const data: AnalysisResult = await response.json()

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
    } catch (err) {
      setErrorInfo({
        title: 'Something Went Wrong',
        message: 'We could not reach the analysis service. Please check your connection and try again.',
      })
      setStage('error')
    }
  }

  function handleReset() {
    setPhoto(null)
    setGarment(null)
    setOccasion('')
    setFormStep(1)
    setStage('form')
    setResult(null)
    setErrorInfo(null)
  }

  function handleCompare() {
    // Keep photo, discard garment + occasion + previous result, return to step 2.
    setGarment(null)
    setOccasion('')
    setFormStep(2)
    setStage('form')
    setResult(null)
    setErrorInfo(null)
  }

  function handleRetryFromError() {
    // Return to whichever step still needs attention instead of wiping the whole form.
    if (!photo) setFormStep(1)
    else if (!garment) setFormStep(2)
    else setFormStep(3)
    setStage('form')
    setErrorInfo(null)
  }

  if (stage === 'loading') return <LoadingAnalysis />
  if (stage === 'result' && result) return <DecisionReport result={result} onReset={handleReset} onCompare={handleCompare} />
  if (stage === 'error' && errorInfo) {
    return <ErrorState title={errorInfo.title} message={errorInfo.message} icon={errorInfo.icon} onRetry={handleRetryFromError} />
  }

  const slideVariants = {
    enter: { opacity: 0, x: 24 },
    center: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -24 },
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">New Analysis</h2>
        <p className="mt-1 text-muted-foreground">A guided, three-step workflow — your photo, the garment, and the occasion.</p>
      </div>

      <StepIndicator steps={STEPS} currentStep={formStep} />

      <div className="min-h-[340px] overflow-hidden rounded-2xl border border-border bg-card p-6 sm:p-8">
        <AnimatePresence mode="wait" initial={false}>
          {formStep === 1 && (
            <motion.div key="step1" variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.25 }}>
              <p className="mb-4 text-sm font-medium uppercase tracking-wide text-muted-foreground">Step 1 of 3</p>
              <div className="grid gap-6 md:grid-cols-[1fr_240px]">
                <UploadCard
                  label="Personal Photo"
                  description="A clear, well-lit photo of yourself"
                  file={photo}
                  onFileSelect={setPhoto}
                  onRemove={() => setPhoto(null)}
                />
                <StepTips title="For best results" tips={PHOTO_TIPS} />
              </div>
              <div className="mt-6 flex justify-end">
                <Button size="lg" className="focus-ring" disabled={!photo} onClick={() => setFormStep(2)}>
                  Continue <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </motion.div>
          )}

          {formStep === 2 && (
            <motion.div key="step2" variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.25 }}>
              <p className="mb-4 text-sm font-medium uppercase tracking-wide text-muted-foreground">Step 2 of 3</p>
              <div className="grid gap-6 md:grid-cols-[1fr_240px]">
                <UploadCard
                  label="Clothing Image"
                  description="The garment you're deciding on"
                  file={garment}
                  onFileSelect={setGarment}
                  onRemove={() => setGarment(null)}
                />
                <div className="flex flex-col gap-4">
                  {photoThumbnailUrl && photo && (
                    <div className="rounded-xl border border-border bg-secondary/40 p-3">
                      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Your Photo</p>
                      <img
                        src={photoThumbnailUrl}
                        alt="Your uploaded photo"
                        className="h-28 w-full rounded-lg object-cover"
                      />
                      <p className="mt-1.5 truncate text-[11px] text-muted-foreground/70">{photo.name}</p>
                    </div>
                  )}
                  <StepTips title="For best results" tips={GARMENT_TIPS} />
                </div>
              </div>
              <div className="mt-6 flex justify-between">
                <Button size="lg" variant="ghost" className="focus-ring" onClick={() => setFormStep(1)}>
                  <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" /> Back
                </Button>
                <Button size="lg" className="focus-ring" disabled={!garment} onClick={() => setFormStep(3)}>
                  Continue <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </motion.div>
          )}

          {formStep === 3 && (
            <motion.div key="step3" variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.25 }}>
              <p className="mb-4 text-sm font-medium uppercase tracking-wide text-muted-foreground">Step 3 of 3</p>

              <div className="grid gap-6 md:grid-cols-[1fr_240px]">
                <div>
                  <div className="mb-6 flex flex-wrap gap-2">
                    {garment && (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-3 py-1 text-xs text-muted-foreground">
                        Garment: {garment.name}
                      </span>
                    )}
                  </div>

                  <label htmlFor="occasion-select" className="text-sm font-medium text-foreground">Choose the occasion</label>
                  <p className="mt-1 text-sm text-muted-foreground">Where will you wear this outfit?</p>
                  <Select value={occasion} onValueChange={setOccasion}>
                    <SelectTrigger id="occasion-select" className="focus-ring mt-4">
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
                <div className="flex flex-col gap-4">
                  {photoThumbnailUrl && photo && (
                    <div className="rounded-xl border border-border bg-secondary/40 p-3">
                      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Your Photo</p>
                      <img
                        src={photoThumbnailUrl}
                        alt="Your uploaded photo"
                        className="h-28 w-full rounded-lg object-cover"
                      />
                      <p className="mt-1.5 truncate text-[11px] text-muted-foreground/70">{photo.name}</p>
                    </div>
                  )}
                  <StepTips
                    title="Why occasion matters"
                    tips={[
                      'Occasion carries the most weight in your verdict (30%)',
                      'Formality is weighted second (25%)',
                      'Style preference match follows at 20%',
                    ]}
                  />
                </div>
              </div>

              <div className="mt-8 flex justify-between">
                <Button size="lg" variant="ghost" className="focus-ring" onClick={() => setFormStep(2)}>
                  <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" /> Back
                </Button>
                <Button size="lg" className="focus-ring" disabled={!occasion} onClick={handleAnalyze}>
                  <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" /> Analyze
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
