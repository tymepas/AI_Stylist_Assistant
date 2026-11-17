'use client'

import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

const STEPS = [
  'Reading your photos',
  'Rating occasion and formality',
  'Rating color and season',
  'Checking your style preferences',
  'Calculating your verdict',
]

/**
 * Shown while one analysis request is in flight.
 *
 * The steps are a reassurance, not a progress report: the request is a single
 * call and the app cannot see how far along it is, so the bar is indeterminate
 * and the list simply advances on a timer. A skeleton of the report sits
 * underneath so the page does not jump when the verdict arrives.
 */
export default function LoadingAnalysis() {
  const [stepIndex, setStepIndex] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setStepIndex((prev) => Math.min(prev + 1, STEPS.length - 1))
    }, 900)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <div className="surface animate-fade-in p-6 sm:p-10" role="status" aria-live="polite">
        <p className="eyebrow">One moment</p>
        <h3 className="mt-3 font-display text-4xl text-foreground sm:text-5xl">Analyzing your decision</h3>
        <p className="mt-3 text-sm text-muted-foreground">This usually takes a few seconds. Your photos were sent once.</p>

        <div className="mt-6 h-1 max-w-md overflow-hidden rounded-full bg-secondary" aria-hidden="true">
          <div className="animate-progress h-full w-2/5 rounded-full bg-primary" />
        </div>

        <ol className="mt-8 max-w-md space-y-3">
          {STEPS.map((step, index) => {
            const isDone = index < stepIndex
            const isActive = index === stepIndex
            return (
              <li key={step} className="flex items-center gap-3">
                <span
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors duration-300',
                    isDone ? 'border-primary bg-primary text-primary-foreground' : isActive ? 'border-primary' : 'border-border'
                  )}
                  aria-hidden="true"
                >
                  {isDone ? <Check className="h-3 w-3" /> : <span className={cn('h-1.5 w-1.5 rounded-full', isActive ? 'bg-primary' : 'bg-transparent')} />}
                </span>
                <span className={cn('text-sm transition-colors duration-300', isActive ? 'text-foreground' : isDone ? 'text-muted-foreground' : 'text-muted-foreground/50')}>{step}</span>
              </li>
            )
          })}
        </ol>
      </div>

      {/* The shape of the report to come. */}
      <div className="space-y-4" aria-hidden="true">
        <div className="skeleton h-4 w-32" />
        <div className="skeleton h-10 w-64" />
        <div className="grid gap-x-12 gap-y-6 pt-2 lg:grid-cols-2">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="space-y-3 border-b border-border pb-6">
              <div className="skeleton h-6 w-40" />
              <div className="skeleton h-2 w-48" />
              <div className="skeleton h-3 w-full" />
              <div className="skeleton h-3 w-4/5" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
