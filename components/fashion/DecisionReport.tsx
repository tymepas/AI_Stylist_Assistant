'use client'

import { AlertTriangle, CheckCircle2, Info, RefreshCw, RotateCcw, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfidenceMeter, RatingMeter, ScoreScale } from '@/components/fashion/RatingBadge'
import ShoppingAdvisor from '@/components/fashion/ShoppingAdvisor'
import { GARMENT_MODE_LABELS } from '@/lib/constants/garmentModes'
import { BAND_TONE, RATING_TONE } from '@/lib/constants/verdictTones'
import { DIMENSION_DISPLAY, describeEvidence, summarizeEvidence } from '@/lib/services/evidenceSummary'
import { cn } from '@/lib/utils'
import type { CompleteAnalysisResult, DimensionResult, OutfitComponent } from '@/types/schema'

interface DecisionReportProps {
  result: CompleteAnalysisResult
  onReset: () => void
  onCompare: () => void
  occasion: string
}

const DELAYS = ['', 'delay-1', 'delay-2', 'delay-3', 'delay-4', 'delay-5']

const GARMENT_TYPE_LABELS: Record<OutfitComponent['garment_type'], string> = {
  top: 'Top',
  bottom: 'Bottom',
  outerwear: 'Outerwear',
  dress: 'Dress',
  footwear: 'Footwear',
  accessory: 'Accessory',
  suiting: 'Suiting',
  traditional_wear: 'Traditional wear',
}

function humanize(value: string): string {
  return value.replace(/_/g, ' ')
}

function DimensionRow({ label, weightPercent, dim, delayClass, conflict }: { label: string; weightPercent: number | null; dim: DimensionResult; delayClass: string; conflict: boolean }) {
  const tone = RATING_TONE[dim.rating]
  return (
    <li className={cn('animate-rise py-5', delayClass)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h4 className="font-display text-2xl text-foreground">{label}</h4>
        <p className="text-xs text-muted-foreground">{weightPercent === null ? 'Shown for context, not part of the verdict' : `${weightPercent}% of the verdict`}</p>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className={cn('text-sm font-medium', tone.text)}>{dim.rating}</span>
        <RatingMeter rating={dim.rating} delayClass={delayClass} />
        <ConfidenceMeter confidence={dim.confidence} />
      </div>
      {conflict ? (
        <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.14em] text-verdict-low">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Conflicts with your stated preference
        </p>
      ) : null}
      <p className="mt-3 max-w-prose text-sm leading-relaxed text-muted-foreground">{dim.reason}</p>
    </li>
  )
}

/**
 * The decision report.
 *
 * The verdict is the strongest element on the page, followed by the six ratings
 * it was calculated from, then the supporting detail. Everything shown here was
 * computed by the application or validated by it; this component decides only
 * how it looks. When the verdict rests on few or uncertain ratings, the report
 * says so next to the verdict.
 */
export default function DecisionReport({ result, onReset, onCompare, occasion }: DecisionReportProps) {
  const tone = BAND_TONE[result.overall_recommendation]
  const evidence = summarizeEvidence(result.dimensions)
  const evidenceNotes = describeEvidence(evidence)
  const outfitItems = result.outfit_components?.availability === 'available' ? result.outfit_components.items : []
  const modeLabel = result.garment_mode && result.garment_mode !== 'single' ? GARMENT_MODE_LABELS[result.garment_mode].title : null

  return (
    <article className="mx-auto max-w-5xl space-y-12" aria-label="Decision report">
      <header className="surface animate-reveal relative overflow-hidden p-6 sm:p-10">
        <div className={cn('pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full blur-3xl', tone.soft)} aria-hidden="true" />
        <div className="relative">
          <p className="eyebrow">
            Your verdict{occasion ? ` for ${occasion}` : ''}
            {modeLabel ? ` · ${modeLabel}` : ''}
          </p>
          <h2 className={cn('mt-4 font-display text-5xl sm:text-7xl', tone.text)} data-testid="verdict-band">
            {result.overall_recommendation}
          </h2>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-foreground/85">{result.next_step}</p>

          <div className="mt-8 max-w-xl">
            {evidence.level === 'insufficient' ? (
              <p className="eyebrow">No score: nothing that counts towards the verdict could be evaluated</p>
            ) : (
              <ScoreScale score={result.verdict_score} band={result.overall_recommendation} />
            )}
          </div>

          {evidenceNotes.length > 0 ? (
            <div role="note" data-testid="evidence-note" className="mt-6 flex max-w-xl items-start gap-3 rounded-xl border border-verdict-caution/30 bg-verdict-caution/[0.07] p-4 text-sm leading-relaxed text-foreground/90">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-verdict-caution" aria-hidden="true" />
              <div className="space-y-1.5">
                <p className="font-medium text-foreground">{evidence.level === 'insufficient' ? 'Not enough to go on' : 'Limited evidence'}</p>
                {evidenceNotes.map((note) => <p key={note}>{note}</p>)}
              </div>
            </div>
          ) : null}

          <p className="mt-6 text-xs text-muted-foreground">Calculated by Verdict from the six ratings below. The AI rates each dimension; it never sets the verdict.</p>
        </div>
      </header>

      <section aria-labelledby="ratings-heading">
        <p className="eyebrow">How it was calculated</p>
        <h3 id="ratings-heading" className="mt-2 font-display text-4xl text-foreground">The six ratings</h3>
        <ul className="mt-4 divide-y divide-border border-y border-border lg:grid lg:grid-cols-2 lg:gap-x-12 lg:divide-y-0 lg:[&>li]:border-b lg:[&>li]:border-border">
          {DIMENSION_DISPLAY.map((entry, index) => (
            <DimensionRow
              key={entry.key}
              label={entry.label}
              weightPercent={entry.weightPercent}
              dim={result.dimensions[entry.key]}
              delayClass={DELAYS[index] ?? ''}
              conflict={entry.key === 'style_preference_match' && (result.dimensions[entry.key].rating === 'Poor' || result.dimensions[entry.key].rating === 'Fair')}
            />
          ))}
        </ul>
      </section>

      {outfitItems.length > 0 ? (
        <section aria-labelledby="outfit-items-heading" data-testid="outfit-components">
          <p className="eyebrow">Item by item</p>
          <h3 id="outfit-items-heading" className="mt-2 font-display text-4xl text-foreground">The pieces of the outfit</h3>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">Notes on each item you added. They are advisory: the verdict above is for the outfit as a whole and is not changed by them.</p>
          <ol className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {outfitItems.map((item) => (
              <li key={item.item} className="surface-quiet p-5">
                <p className="eyebrow">Item {item.item} · {GARMENT_TYPE_LABELS[item.garment_type]}</p>
                <p className={cn('mt-2 font-display text-2xl', item.assessment === 'Needs attention' ? 'text-verdict-caution' : item.assessment === 'Unable to tell' ? 'text-muted-foreground' : 'text-foreground')}>{item.assessment}</p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.note}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <div className="grid gap-10 md:grid-cols-2">
        <section aria-labelledby="consider-heading">
          <h3 id="consider-heading" className="font-display text-3xl text-foreground">Things to consider</h3>
          <ul className="mt-4 space-y-3">
            {result.things_to_consider.map((item, index) => (
              <li key={index} className="flex gap-3 text-sm leading-relaxed text-muted-foreground">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="basis-heading">
          <h3 id="basis-heading" className="font-display text-3xl text-foreground">What this is based on</h3>
          <div className="mt-4 space-y-4">
            <div>
              <p className="eyebrow">Considered</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {result.analysis_based_on.considered.map((item) => (
                  <li key={item} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-foreground/90">
                    <CheckCircle2 className="h-3 w-3 text-verdict-high" aria-hidden="true" /> {humanize(item)}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="eyebrow">Not considered</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {result.analysis_based_on.not_considered.map((item) => (
                  <li key={item} className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-3 py-1 text-xs text-muted-foreground">
                    <XCircle className="h-3 w-3" aria-hidden="true" /> {humanize(item)}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Verdict cannot see price, material quality, brand, durability or comfort in a photo, so it does not judge them.</p>
            </div>
          </div>
        </section>
      </div>

      <ShoppingAdvisor advisor={result.shopping_advisor} occasion={occasion} />

      <div className="flex flex-col items-center gap-3 border-t border-border pt-8 sm:flex-row sm:justify-center">
        <Button onClick={onCompare} size="lg" className="focus-ring w-full sm:w-auto">
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Compare Another Outfit
        </Button>
        <Button onClick={onReset} size="lg" variant="outline" className="focus-ring w-full sm:w-auto">
          <RotateCcw className="h-4 w-4" aria-hidden="true" /> Start New Analysis
        </Button>
      </div>
    </article>
  )
}
