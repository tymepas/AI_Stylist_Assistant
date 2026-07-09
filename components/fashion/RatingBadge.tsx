import { Rating, Confidence } from '@/types/schema'
import { cn } from '@/lib/utils'

const RATING_STYLES: Record<Rating, string> = {
  Excellent: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  Good: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  Fair: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  Poor: 'bg-red-500/10 text-red-400 border-red-500/30',
  'Unable to Evaluate': 'bg-slate-500/10 text-slate-400 border-slate-500/30',
}

export function RatingBadge({ rating }: { rating: Rating }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium', RATING_STYLES[rating])}>
      {rating}
    </span>
  )
}

const CONFIDENCE_STYLES: Record<Confidence, string> = {
  High: 'text-emerald-400',
  Medium: 'text-amber-400',
  Low: 'text-red-400',
}

export function ConfidenceTag({ confidence }: { confidence: Confidence }) {
  return (
    <span className={cn('inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide', CONFIDENCE_STYLES[confidence])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {confidence} confidence
    </span>
  )
}
