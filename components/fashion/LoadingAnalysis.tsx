'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, Check } from 'lucide-react'

const STEPS = [
  'Reading your photo',
  'Evaluating occasion fit',
  'Checking color harmony',
  'Assessing formality and style',
  'Calculating your verdict',
]

export default function LoadingAnalysis() {
  const [stepIndex, setStepIndex] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setStepIndex((prev) => Math.min(prev + 1, STEPS.length - 1))
    }, 550)
    return () => clearInterval(interval)
  }, [])

  return (
    <div
      className="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-border bg-card/40 px-6 py-16 text-center"
      role="status"
      aria-live="polite"
    >
      <div className="relative flex h-24 w-24 items-center justify-center">
        <motion.div
          className="absolute inset-0 rounded-full border-2 border-primary/30 border-t-primary"
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1.4, ease: 'linear' }}
        />
        <motion.div
          className="absolute inset-3 rounded-full bg-primary/10"
          animate={{ scale: [1, 1.15, 1], opacity: [0.6, 1, 0.6] }}
          transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }}
        />
        <Sparkles className="relative h-7 w-7 text-primary" aria-hidden="true" />
      </div>
      <h3 className="mt-8 text-lg font-medium text-foreground">Analyzing your decision</h3>
      <p className="mt-1 text-sm text-muted-foreground">This usually takes a few seconds.</p>

      <div className="mt-8 w-full max-w-xs space-y-2.5 text-left">
        {STEPS.map((step, index) => {
          const isDone = index < stepIndex
          const isActive = index === stepIndex
          return (
            <div key={step} className="flex items-center gap-3">
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors duration-300 ${
                  isDone
                    ? 'border-primary bg-primary text-primary-foreground'
                    : isActive
                    ? 'border-primary text-primary'
                    : 'border-border text-transparent'
                }`}
              >
                {isDone ? (
                  <Check className="h-3 w-3" aria-hidden="true" />
                ) : (
                  <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'animate-pulse bg-primary' : 'bg-transparent'}`} />
                )}
              </span>
              <span className={`text-sm transition-colors duration-300 ${isActive ? 'text-foreground' : isDone ? 'text-muted-foreground' : 'text-muted-foreground/50'}`}>
                {step}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
