'use client'

import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Step {
  label: string
}

interface StepIndicatorProps {
  steps: Step[]
  currentStep: number
}

/**
 * Where the user is in the analysis journey.
 *
 * Small screens get one line ("Step 2 of 6 · Garment photos") and a thin
 * progress bar, because six labelled circles do not fit a phone, or a tablet
 * once the sidebar is showing. From the `lg` breakpoint the full list is shown.
 * Both describe the same state.
 */
export default function StepIndicator({ steps, currentStep }: StepIndicatorProps) {
  const current = steps[Math.min(Math.max(currentStep, 1), steps.length) - 1]
  const progress = Math.round((Math.min(currentStep, steps.length) / steps.length) * 100)

  return (
    <div>
      <div className="lg:hidden">
        <div className="flex items-baseline justify-between gap-3">
          <p className="eyebrow">Step {currentStep} of {steps.length}</p>
          <p className="truncate text-sm font-medium text-foreground">{current.label}</p>
        </div>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label="Analysis progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
          <div className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <ol className="hidden items-start lg:flex" aria-label="Analysis steps">
        {steps.map((step, index) => {
          const stepNumber = index + 1
          const isComplete = stepNumber < currentStep
          const isActive = stepNumber === currentStep
          return (
            <li key={step.label} className="flex flex-1 items-start last:flex-initial">
              <div className="flex flex-col items-center gap-2">
                <span
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full border text-xs font-medium transition-all duration-300',
                    isComplete && 'border-primary bg-primary text-primary-foreground',
                    isActive && 'border-primary text-primary ring-4 ring-primary/10',
                    !isComplete && !isActive && 'border-border text-muted-foreground'
                  )}
                  aria-current={isActive ? 'step' : undefined}
                >
                  {isComplete ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : stepNumber}
                </span>
                <span className={cn('whitespace-nowrap text-xs', isActive ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                  {step.label}
                </span>
              </div>
              {stepNumber !== steps.length && (
                <span aria-hidden="true" className={cn('mx-2 mt-4 h-px flex-1 transition-colors duration-500', isComplete ? 'bg-primary/70' : 'bg-border')} />
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
