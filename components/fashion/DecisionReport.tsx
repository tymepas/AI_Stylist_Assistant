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
  ArrowUpRight,
  ShieldCheck,
  ThumbsUp,
  AlertTriangle,
  ThumbsDown,
  LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RatingBadge, ConfidenceMeter, ScoreGauge } from '@/components/fashion/RatingBadge'
import { fadeUp, staggerContainer, viewportOnce } from '@/lib/motion'
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

const VERDICT_STYLES: Record<
  OverallRecommendation,
  { text: string; bg: string; ring: string; icon: LucideIcon; gauge: string }
> = {
  'Highly Recommended': { text: 'text-emerald-400', bg: 'bg-emerald-500/10', ring: 'ring-emerald-500/20', icon: ThumbsUp, gauge: 'text-emerald-400' },
  Recommended: { text: 'text-blue-400', bg: 'bg-blue-500/10', ring: 'ring-blue-500/20', icon: CheckCircle2, gauge: 'text-blue-400' },
  'Consider Alternatives': { text: 'text-amber-400', bg: 'bg-amber-500/10', ring: 'ring-amber-500/20', icon: AlertTriangle, gauge: 'text-amber-400' },
  'Not Recommended': { text: 'text-red-400', bg: 'bg-red-500/10', ring: 'ring-red-500/20', icon: ThumbsDown, gauge: 'text-red-400' },
}

function DimensionCard({ dimKey, dim }: { dimKey: keyof Dimensions; dim: DimensionResult }) {
  const meta = DIMENSION_META[dimKey]
  const Icon = meta.icon
  const isConflict = dimKey === 'style_preference_match' && (dim.rating === 'Poor' || dim.rating === 'Fair')
  const accent =
    dim.rating === 'Excellent' ? 'before:bg-emerald-400' :
    dim.rating === 'Good' ? 'before:bg-blue-400' :
    dim.rating === 'Fair' ? 'before:bg-amber-400' :
    dim.rating === 'Poor' ? 'before:bg-red-400' : 'before:bg-slate-500'

  return (
    <motion.div
      variants={fadeUp}
      className={`card-hover relative overflow-hidden rounded-2xl border bg-card p-5 pl-6 before:absolute before:inset-y-0 before:left-0 before:w-1 ${accent} ${isConflict ? 'border-red-500/30' : 'border-border'}`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-foreground">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary">
            <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </span>
          <span className="text-sm font-medium">{meta.label}</span>
        </div>
        <RatingBadge rating={dim.rating} />
      </div>
      {isConflict && (
        <p className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-red-400">
          <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Preference conflict
        </p>
      )}
      <p className="text-sm leading-relaxed text-muted-foreground">{dim.reason}</p>
      <div className="mt-4">
        <ConfidenceMeter confidence={dim.confidence} />
      </div>
    </motion.div>
  )
}

function SectionHeading({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
      <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
      {children}
    </h3>
  )
}

export default function DecisionReport({ result, onReset }: DecisionReportProps) {
  const style = VERDICT_STYLES[result.overall_recommendation]
  const VerdictIcon = style.icon
  const dimensionKeys = Object.keys(result.dimensions) as Array<keyof Dimensions>

  return (
    <div className="space-y-8">
      {/* Verdict hero */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className={`relative overflow-hidden rounded-3xl border border-border bg-card p-8 ring-2 ${style.ring}`}
      >
        <div className={`absolute -right-16 -top-16 h-56 w-56 rounded-full ${style.bg} blur-3xl`} aria-hidden="true" />
        <div className="relative flex flex-col items-start justify-between gap-8 sm:flex-row sm:items-center">
          <div>
            <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Decision Report · Calculated Verdict
            </p>
            <h2 className={`mt-3 flex items-center gap-2.5 text-3xl font-bold tracking-tight sm:text-4xl ${style.text}`}>
              <VerdictIcon className="h-9 w-9" aria-hidden="true" />
              {result.overall_recommendation}
            </h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">{result.next_step}</p>
          </div>
          <ScoreGauge score={result.verdict_score} colorClass={style.gauge} />
        </div>
      </motion.div>

      {/* Dimensions */}
      <div>
        <SectionHeading icon={Sparkles}>Evaluation Dimensions</SectionHeading>
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={viewportOnce}
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {dimensionKeys.map((key) => (
            <DimensionCard key={key} dimKey={key} dim={result.dimensions[key]} />
          ))}
        </motion.div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Things to consider */}
        <motion.div variants={fadeUp} initial="hidden" whileInView="visible" viewport={viewportOnce} className="rounded-2xl border border-border bg-card p-6">
          <SectionHeading icon={Lightbulb}>Things To Consider</SectionHeading>
          <ul className="space-y-3">
            {result.things_to_consider.map((item, i) => (
              <li key={i} className="flex gap-3 text-sm leading-relaxed text-muted-foreground">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </motion.div>

        {/* Analysis based on */}
        <motion.div variants={fadeUp} initial="hidden" whileInView="visible" viewport={viewportOnce} className="rounded-2xl border border-border bg-card p-6">
          <SectionHeading icon={ShieldCheck}>Analysis Based On</SectionHeading>
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Considered</p>
              <div className="flex flex-wrap gap-2">
                {result.analysis_based_on.considered.map((item) => (
                  <span key={item} className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-400">
                    <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> {item.replace('_', ' ')}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Not Considered</p>
              <div className="flex flex-wrap gap-2">
                {result.analysis_based_on.not_considered.map((item) => (
                  <span key={item} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-3 py-1 text-xs text-muted-foreground">
                    <XCircle className="h-3 w-3" aria-hidden="true" /> {item.replace('_', ' ')}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Next step callout */}
      <motion.div
        variants={fadeUp}
        initial="hidden"
        whileInView="visible"
        viewport={viewportOnce}
        className={`flex items-start gap-3 rounded-2xl border border-border bg-card p-5 ${style.bg}`}
      >
        <ArrowUpRight className={`mt-0.5 h-4 w-4 shrink-0 ${style.text}`} aria-hidden="true" />
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Recommended Next Step</p>
          <p className="mt-1 text-sm text-foreground">{result.next_step}</p>
        </div>
      </motion.div>

      <div className="flex justify-center pt-2">
        <Button onClick={onReset} size="lg" variant="outline" className="focus-ring">
          <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" /> Analyze Another Item
        </Button>
      </div>
    </div>
  )
}
