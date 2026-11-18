import { CalendarDays } from 'lucide-react'
import { RATING_TONE } from '@/lib/constants/verdictTones'
import { cn } from '@/lib/utils'
import type { DimensionResult, OccasionContext as OccasionContextData } from '@/types/schema'

interface OccasionContextProps {
  context?: OccasionContextData
  occasionRating: DimensionResult
}

function sentence(text: string): string {
  const trimmed = text.trim()
  return trimmed.length === 0 ? trimmed : `${trimmed[0].toUpperCase()}${trimmed.slice(1)}${/[.!?]$/.test(trimmed) ? '' : '.'}`
}

/**
 * "Occasion context": what the selected occasion usually expects, in the same
 * words the analysis was given, next to the Occasion fit rating. It is the
 * application's general profile of the occasion, not a judgement of the
 * outfit, and it never changes a rating or the verdict.
 *
 * Results from before occasion profiles existed carry no context, and then the
 * section is left out; the verdict header still names the occasion.
 */
export default function OccasionContext({ context, occasionRating }: OccasionContextProps) {
  if (!context) return null
  const tone = RATING_TONE[occasionRating.rating]
  return (
    <section aria-labelledby="occasion-context-heading" data-testid="occasion-context" className="surface-quiet p-6 sm:p-8">
      <p className="eyebrow inline-flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" aria-hidden="true" /> Occasion context</p>
      <h3 id="occasion-context-heading" className="mt-1 font-display text-3xl text-foreground">{context.occasion}</h3>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        Usually <span className="text-foreground">{context.formality}</span>, {context.setting}; {context.suits} tend to suit it.
        {context.season ? <> Season stated by the occasion: <span className="text-foreground">{context.season}</span>.</> : null}
      </p>
      {context.varies ? <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">Expectations vary: {sentence(context.varies)}</p> : null}
      <p className="mt-3 text-sm">
        <span className="text-muted-foreground">Occasion fit: </span>
        <span className={cn('font-medium', tone.text)}>{occasionRating.rating}</span>
        <span className="text-muted-foreground"> · the reasoning is under the six ratings below.</span>
      </p>
      <p className="mt-2 text-xs text-muted-foreground">A general guide to the occasion, not a rule. Your own event may differ.</p>
    </section>
  )
}
