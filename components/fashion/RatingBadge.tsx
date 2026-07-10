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

const CONFIDENCE_LEVELS: Record<Confidence, number> = { High: 3, Medium: 2, Low: 1 }
const CONFIDENCE_COLORS: Record<Confidence, string> = {
  High: 'bg-emerald-400',
  Medium: 'bg-amber-400',
  Low: 'bg-red-400',
}

/** Small visual confidence meter (bars) + label. Replaces plain text-only confidence tag. */
export function ConfidenceMeter({ confidence }: { confidence: Confidence }) {
  const active = CONFIDENCE_LEVELS[confidence]
  return (
    <div className="flex items-center gap-2" role="img" aria-label={`${confidence} confidence`}>
      <div className="flex items-end gap-0.5" aria-hidden="true">
        {[1, 2, 3].map((bar) => (
          <span
            key={bar}
            className={cn(
              'w-1 rounded-full transition-colors',
              bar === 1 ? 'h-1.5' : bar === 2 ? 'h-2.5' : 'h-3.5',
              bar <= active ? CONFIDENCE_COLORS[confidence] : 'bg-border'
            )}
          />
        ))}
      </div>
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{confidence} confidence</span>
    </div>
  )
}

/** Circular gauge for the verdict_score (out of 5). Purely presentational, value is passed in unchanged. */
export function ScoreGauge({ score, colorClass }: { score: number; colorClass: string }) {
  const percent = Math.max(0, Math.min(1, score / 5))
  const radius = 42
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - percent)

  return (
    <div className="relative flex h-28 w-28 items-center justify-center" role="img" aria-label={`Score ${score.toFixed(1)} out of 5`}>
      <svg width="112" height="112" viewBox="0 0 112 112" className="-rotate-90" aria-hidden="true">
        <circle cx="56" cy="56" r={radius} fill="none" stroke="currentColor" strokeWidth="8" className="text-border/60" />
        <circle
          cx="56"
          cy="56"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={cn('transition-all duration-700 ease-out', colorClass)}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className={cn('text-2xl font-semibold', colorClass)}>{score.toFixed(1)}</span>
        <span className="text-[10px] text-muted-foreground">out of 5</span>
      </div>
    </div>
  )
}
