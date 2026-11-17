import { BAND_FLOORS, MAX_SCORE } from '@/lib/services/evidenceSummary'
import { BAND_TONE, RATING_STEPS, RATING_TONE } from '@/lib/constants/verdictTones'
import { cn } from '@/lib/utils'
import type { Confidence, OverallRecommendation, Rating } from '@/types/schema'

export function RatingBadge({ rating }: { rating: Rating }) {
  const tone = RATING_TONE[rating]
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium', tone.soft, tone.text, tone.border)}>
      {rating}
    </span>
  )
}

/**
 * A rating as four segments. The word next to it is the rating; the segments
 * only make a list of ratings quick to scan. "Unable to Evaluate" is shown as
 * four empty, dashed segments, never as a low rating.
 */
export function RatingMeter({ rating, delayClass = '' }: { rating: Rating; delayClass?: string }) {
  const filled = RATING_STEPS[rating]
  const tone = RATING_TONE[rating]
  return (
    <span className="flex items-center gap-1" aria-hidden="true">
      {[1, 2, 3, 4].map((step) => (
        <span key={step} className={cn('h-1.5 w-6 overflow-hidden rounded-full', filled === 0 ? 'border border-dashed border-border' : 'bg-secondary')}>
          {step <= filled ? <span className={cn('animate-meter block h-full w-full rounded-full', tone.fill, delayClass)} /> : null}
        </span>
      ))}
    </span>
  )
}

const CONFIDENCE_DOTS: Record<Confidence, number> = { High: 3, Medium: 2, Low: 1 }

/** How sure the analysis says it is about one rating. Low confidence is called out, not hidden. */
export function ConfidenceMeter({ confidence }: { confidence: Confidence }) {
  const active = CONFIDENCE_DOTS[confidence]
  const low = confidence === 'Low'
  return (
    <span className="inline-flex items-center gap-2" role="img" aria-label={`${confidence} confidence`}>
      <span className="flex items-center gap-1" aria-hidden="true">
        {[1, 2, 3].map((dot) => (
          <span key={dot} className={cn('h-1.5 w-1.5 rounded-full', dot <= active ? (low ? 'bg-verdict-caution' : 'bg-foreground/70') : 'bg-border')} />
        ))}
      </span>
      <span className={cn('text-[0.6875rem] font-medium uppercase tracking-[0.14em]', low ? 'text-verdict-caution' : 'text-muted-foreground')}>{confidence} confidence</span>
    </span>
  )
}

/**
 * Where the calculated score sits on the 0 to 5 scale, with the three band
 * boundaries marked. It shows the score the application calculated, exactly as
 * calculated, and which band that puts it in. It is a position on a scale, not
 * a gauge of certainty.
 */
export function ScoreScale({ score, band }: { score: number; band: OverallRecommendation }) {
  const tone = BAND_TONE[band]
  const percent = Math.max(0, Math.min(100, (score / MAX_SCORE) * 100))
  const boundaries = BAND_FLOORS.filter((entry) => entry.floor > 0)

  return (
    <div role="img" aria-label={`Calculated score ${score.toFixed(1)} out of ${MAX_SCORE}, in the ${band} band`}>
      <div className="flex items-baseline justify-between gap-4">
        <span className="eyebrow">Calculated score</span>
        <span className="text-sm text-muted-foreground">
          <span className={cn('font-display text-3xl', tone.text)}>{score.toFixed(1)}</span> of {MAX_SCORE}
        </span>
      </div>
      <div className="relative mt-3 h-2 rounded-full bg-secondary" aria-hidden="true">
        <div className="h-full overflow-hidden rounded-full" style={{ width: `${percent}%` }}>
          <div className={cn('animate-meter h-full w-full rounded-full', tone.fill)} />
        </div>
        {boundaries.map((entry) => (
          <span key={entry.band} className="absolute top-1/2 h-4 w-px -translate-y-1/2 bg-foreground/35" style={{ left: `${(entry.floor / MAX_SCORE) * 100}%` }} />
        ))}
      </div>
      <div className="relative mt-2 h-4 text-[0.625rem] text-muted-foreground" aria-hidden="true">
        {boundaries.map((entry) => (
          <span key={entry.band} className="absolute -translate-x-1/2" style={{ left: `${(entry.floor / MAX_SCORE) * 100}%` }}>{entry.floor}</span>
        ))}
      </div>
    </div>
  )
}
