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

export default function StepIndicator({ steps, currentStep }: StepIndicatorProps) {
  return (
    <div className="flex items-center" role="list" aria-label="Analysis steps">
      {steps.map((step, index) => {
        const stepNumber = index + 1
        const isComplete = stepNumber < currentStep
        const isActive = stepNumber === currentStep
        return (
          <div key={step.label} role="listitem" className="flex flex-1 items-center last:flex-initial">
            <div className="flex flex-col items-center gap-2">
              <div
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-full border text-sm font-medium transition-all duration-300',
                  isComplete && 'border-primary bg-primary text-primary-foreground',
                  isActive && 'border-primary bg-primary/10 text-primary ring-4 ring-primary/10',
                  !isComplete && !isActive && 'border-border bg-card text-muted-foreground'
                )}
                aria-current={isActive ? 'step' : undefined}
              >
                {isComplete ? <Check className="h-4 w-4" aria-hidden="true" /> : stepNumber}
              </div>
              <span className={cn('whitespace-nowrap text-xs font-medium', isActive ? 'text-foreground' : 'text-muted-foreground')}>
                {step.label}
              </span>
            </div>
            {stepNumber !== steps.length && (
              <div className={cn('mx-2 h-px flex-1 -translate-y-3 transition-colors duration-300', isComplete ? 'bg-primary' : 'bg-border')} />
            )}
          </div>
        )
      })}
    </div>
  )
}
