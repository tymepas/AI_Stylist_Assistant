'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'

const STEPS = [
  'Analyzing your photo…',
  'Evaluating occasion fit…',
  'Checking color harmony…',
  'Assessing formality and style…',
  'Calculating your verdict…',
]

export default function LoadingAnalysis() {
  const [stepIndex, setStepIndex] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setStepIndex((prev) => (prev + 1) % STEPS.length)
    }, 900)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-border bg-card/40 px-6 py-20 text-center">
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
        <Sparkles className="relative h-7 w-7 text-primary" />
      </div>
      <h3 className="mt-8 text-lg font-medium text-foreground">Analyzing your decision</h3>
      <motion.p
        key={stepIndex}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="mt-2 text-sm text-muted-foreground"
      >
        {STEPS[stepIndex]}
      </motion.p>
      <p className="mt-8 text-xs text-muted-foreground/60">This usually takes a few seconds.</p>
    </div>
  )
}
