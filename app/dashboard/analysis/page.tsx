'use client'

import { useState } from 'react'
import { ImageOff, HelpCircle, LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import UploadCard from '@/components/fashion/UploadCard'
import LoadingAnalysis from '@/components/fashion/LoadingAnalysis'
import ErrorState from '@/components/fashion/ErrorState'
import DecisionReport from '@/components/fashion/DecisionReport'
import { OCCASION_OPTIONS } from '@/lib/constants/options'
import { validateImageMeta } from '@/lib/services/analysisService'
import { AnalysisResult, CompleteAnalysisResult, ImageMeta } from '@/types/schema'

type Stage = 'form' | 'loading' | 'result' | 'error'

interface ErrorInfo {
  title: string
  message: string
  icon?: LucideIcon
}

function toImageMeta(file: File): ImageMeta {
  return { name: file.name, type: file.type, size: file.size }
}

export default function AnalysisPage() {
  const [photo, setPhoto] = useState<File | null>(null)
  const [garment, setGarment] = useState<File | null>(null)
  const [occasion, setOccasion] = useState<string>('')
  const [stage, setStage] = useState<Stage>('form')
  const [result, setResult] = useState<CompleteAnalysisResult | null>(null)
  const [errorInfo, setErrorInfo] = useState<ErrorInfo | null>(null)

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
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ occasion, photo: photoMeta, garment: garmentMeta }),
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
    setStage('form')
    setResult(null)
    setErrorInfo(null)
  }

  if (stage === 'loading') return <LoadingAnalysis />
  if (stage === 'result' && result) return <DecisionReport result={result} onReset={handleReset} />
  if (stage === 'error' && errorInfo) {
    return <ErrorState title={errorInfo.title} message={errorInfo.message} icon={errorInfo.icon} onRetry={handleReset} />
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">New Analysis</h2>
        <p className="mt-1 text-muted-foreground">Upload your photo, the garment you're considering, and pick an occasion.</p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <UploadCard
          label="Personal Photo"
          description="A clear photo of yourself"
          file={photo}
          onFileSelect={setPhoto}
          onRemove={() => setPhoto(null)}
        />
        <UploadCard
          label="Clothing Image"
          description="The garment you're deciding on"
          file={garment}
          onFileSelect={setGarment}
          onRemove={() => setGarment(null)}
        />
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <label className="text-sm font-medium text-foreground">Occasion</label>
        <p className="mt-1 text-sm text-muted-foreground">What is this for?</p>
        <Select value={occasion} onValueChange={setOccasion}>
          <SelectTrigger className="mt-4">
            <SelectValue placeholder="Select an occasion" />
          </SelectTrigger>
          <SelectContent>
            {OCCASION_OPTIONS.map((o) => (
              <SelectItem key={o} value={o}>{o}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex justify-end">
        <Button size="lg" onClick={handleAnalyze}>Analyze</Button>
      </div>
    </div>
  )
}
