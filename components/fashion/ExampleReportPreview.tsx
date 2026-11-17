'use client'

import { motion } from 'framer-motion'
import { CalendarCheck, Palette, Shirt, CloudSun, Sparkles, Heart, CheckCircle2 } from 'lucide-react'

const EXAMPLE_DIMENSIONS = [
  { label: 'Occasion Fit', icon: CalendarCheck, rating: 'Excellent' },
  { label: 'Color Harmony', icon: Palette, rating: 'Excellent' },
  { label: 'Formality', icon: Shirt, rating: 'Good' },
  { label: 'Seasonality', icon: CloudSun, rating: 'Good' },
  { label: 'Style Consistency', icon: Sparkles, rating: 'Excellent' },
  { label: 'Style Preference Match', icon: Heart, rating: 'Good' },
]

const RATING_DOT: Record<string, string> = {
  Excellent: 'bg-verdict-high',
  Good: 'bg-verdict-good',
  Fair: 'bg-verdict-caution',
  Poor: 'bg-verdict-low',
}

export default function ExampleReportPreview() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30, rotate: -1 }}
      whileInView={{ opacity: 1, y: 0, rotate: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      className="surface relative mx-auto w-full max-w-md overflow-hidden p-6 sm:p-8"
      aria-hidden="true"
    >
      <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-verdict-high/10 blur-3xl" />
      <div className="relative flex items-center justify-between">
        <div>
          <p className="eyebrow">Example decision report</p>
          <h3 className="mt-2 font-display text-4xl text-verdict-high">Highly Recommended</h3>
        </div>
        <div className="flex flex-col items-end">
          <span className="font-display text-3xl text-verdict-high">4.7</span>
          <span className="text-[10px] text-muted-foreground">of 5, calculated</span>
        </div>
      </div>

      <div className="relative mt-6 space-y-2.5">
        {EXAMPLE_DIMENSIONS.map((dim) => (
          <div key={dim.label} className="flex items-center justify-between rounded-xl border border-border/60 bg-background/40 px-3 py-2.5">
            <span className="flex items-center gap-2 text-sm text-foreground">
              <dim.icon className="h-3.5 w-3.5 text-muted-foreground" />
              {dim.label}
            </span>
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <span className={`h-1.5 w-1.5 rounded-full ${RATING_DOT[dim.rating]}`} />
              {dim.rating}
            </span>
          </div>
        ))}
      </div>

      <div className="relative mt-5 flex items-center gap-2 rounded-xl bg-verdict-high/[0.07] px-3 py-2.5 text-xs text-foreground/85">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        You can move forward with this purchase with confidence.
      </div>
    </motion.div>
  )
}
