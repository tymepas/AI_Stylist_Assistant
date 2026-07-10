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
  Excellent: 'bg-emerald-400',
  Good: 'bg-blue-400',
  Fair: 'bg-amber-400',
  Poor: 'bg-red-400',
}

export default function ExampleReportPreview() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30, rotate: -1 }}
      whileInView={{ opacity: 1, y: 0, rotate: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      className="relative mx-auto w-full max-w-md overflow-hidden rounded-3xl border border-border bg-card p-6 shadow-2xl shadow-black/40 sm:p-8"
      aria-hidden="true"
    >
      <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-emerald-500/10 blur-3xl" />
      <div className="relative flex items-center justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Example Decision Report</p>
          <h3 className="mt-1.5 text-2xl font-semibold text-emerald-400">Highly Recommended</h3>
        </div>
        <div className="flex h-16 w-16 flex-col items-center justify-center rounded-2xl bg-emerald-500/10">
          <span className="text-xl font-semibold text-emerald-400">4.7</span>
          <span className="text-[10px] text-muted-foreground">/ 5</span>
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

      <div className="relative mt-5 flex items-center gap-2 rounded-xl bg-emerald-500/5 px-3 py-2.5 text-xs text-emerald-300/90">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        You can move forward with this purchase with confidence.
      </div>
    </motion.div>
  )
}
