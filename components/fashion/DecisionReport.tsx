'use client'

import { motion } from 'framer-motion'
import {
  CalendarCheck,
  Palette,
  Shirt,
  CloudSun,
  Sparkles,
  Heart,
  Lightbulb,
  CheckCircle2,
  XCircle,
  RotateCcw,
  LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RatingBadge, ConfidenceTag } from '@/components/fashion/RatingBadge'
import { CompleteAnalysisResult, Dimensions, DimensionResult, OverallRecommendation } from '@/types/schema'

interface DecisionReportProps {
  result: CompleteAnalysisResult
  onReset: () => void
}

const DIMENSION_META: Record<keyof Dimensions, { label: string; icon: LucideIcon }> = {
  occasion: { label: 'Occasion Fit', icon: CalendarCheck },
  color: { label: 'Color Harmony', icon: Palette },
  formality: { label: 'Formality', icon: Shirt },
  seasonality: { label: 'Seasonality', icon: CloudSun },
  style: { label: 'Style Consistency', icon: Sparkles },
  style_preference_match: { label: 'Style Preference Match', icon: Heart },
}

const VERDICT_STYLES: Record<OverallRecommendation, { text: string; bg: string; ring: string }> = {
  'Highly Recommended': { text: 'text-emerald-400', bg: 'bg-emerald-500/10', ring: 'ring-emerald-500/30' },
  Recommended: { text: 'text-blue-400', bg: 'bg-blue-500/10', ring: 'ring-blue-500/30' },
  'Consider Alternatives': { text: 'text-amber-400', bg: 'bg-amber-500/10', ring: 'ring-amber-500/30' },
  'Not Recommended': { text: 'text-red-400', bg: 'bg-red-500/10', ring: 'ring-red-500/30' },
}

function DimensionCard({ dimKey, dim }: { dimKey: keyof Dimensions; dim: DimensionResult }) {
  const meta = DIMENSION_META[dimKey]
  const Icon = meta.icon
  const isConflict = dimKey === 'style_preference_match' && (dim.rating === 'Poor' || dim.rating === 'Fair')
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-2xl border bg-card p-5 ${isConflict ? 'border-red-500/30' : 'border-border'}`}
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">{meta.label}</span>
        </div>
        <RatingBadge rating={dim.rating} />
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{dim.reason}</p>
      <div className="mt-3">
        <ConfidenceTag confidence={dim.confidence} />
      </div>
    </motion.div>
  )
}

export default function DecisionReport({ result, onReset }: DecisionReportProps) {
  const style = VERDICT_STYLES[result.overall_recommendation]
  const dimensionKeys = Object.keys(result.dimensions) as Array<keyof Dimensions>

  return (
    <div className="space-y-8">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className={`rounded-3xl border border-border bg-card p-8 ring-1 ${style.ring}`}
      >
        <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Decision Report</p>
            <h2 className={`mt-2 text-3xl font-semibold tracking-tight ${style.text}`}>{result.overall_recommendation}</h2>
            <p className="mt-3 max-w-md text-sm text-muted-foreground">{result.next_step}</p>
          </div>
          <div className={`flex h-28 w-28 shrink-0 flex-col items-center justify-center rounded-2xl ${style.bg}`}>
            <span className={`text-3xl font-semibold ${style.text}`}>{result.verdict_score.toFixed(1)}</span>
            <span className="text-xs text-muted-foreground">out of 5</span>
          </div>
        </div>
      </motion.div>

      <div>
        <h3 className="mb-4 text-sm font-medium uppercase tracking-wide text-muted-foreground">Evaluation Dimensions</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {dimensionKeys.map((key) => (
            <DimensionCard key={key} dimKey={key} dim={result.dimensions[key]} />
          ))}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-6">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-medium text-foreground">
            <Lightbulb className="h-4 w-4 text-primary" /> Things To Consider
          </h3>
          <ul className="space-y-3">
            {result.things_to_consider.map((item, i) => (
              <li key={i} className="flex gap-3 text-sm text-muted-foreground">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6">
          <h3 className="mb-4 text-sm font-medium text-foreground">Analysis Based On</h3>
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Considered</p>
              <div className="flex flex-wrap gap-2">
                {result.analysis_based_on.considered.map((item) => (
                  <span key={item} className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-400">
                    <CheckCircle2 className="h-3 w-3" /> {item.replace('_', ' ')}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Not Considered</p>
              <div className="flex flex-wrap gap-2">
                {result.analysis_based_on.not_considered.map((item) => (
                  <span key={item} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-3 py-1 text-xs text-muted-foreground">
                    <XCircle className="h-3 w-3" /> {item.replace('_', ' ')}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-center pt-2">
        <Button onClick={onReset} size="lg" variant="outline">
          <RotateCcw className="mr-2 h-4 w-4" /> Analyze Another Item
        </Button>
      </div>
    </div>
  )
}
