import { ArrowUpRight, CheckCircle2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getRetailSearchLinks } from '@/lib/services/retailSearchService'
import type { Dimensions, ShoppingRecommendation } from '@/types/schema'

interface ShoppingRecommendationCardProps {
  recommendation: ShoppingRecommendation
  occasion: string
}

const OUTCOME_LABELS: Record<keyof Dimensions, string> = {
  occasion: 'Better Occasion Fit',
  color: 'Improved Color Harmony',
  formality: 'More Appropriate Formality',
  seasonality: 'Better Seasonal Alignment',
  style: 'Better Style Consistency',
  style_preference_match: 'Closer Style Preference Match',
}

const MATCH_STYLES: Record<ShoppingRecommendation['match_level'], string> = {
  'Excellent Match': 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  'Strong Match': 'border-blue-500/30 bg-blue-500/10 text-blue-400',
  'Good Match': 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  'Possible Match': 'border-slate-500/30 bg-slate-500/10 text-slate-300',
}

export default function ShoppingRecommendationCard({ recommendation, occasion }: ShoppingRecommendationCardProps) {
  const retailerLinks = getRetailSearchLinks(recommendation, occasion)

  return (
    <article className="rounded-2xl border border-border bg-card p-5 shadow-sm shadow-black/5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-base font-semibold text-foreground">{recommendation.title}</h4>
          <p className="mt-1 text-sm text-muted-foreground">{recommendation.color_direction} · {recommendation.style_direction}</p>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${MATCH_STYLES[recommendation.match_level]}`}>
          {recommendation.match_level}
        </span>
      </div>

      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{recommendation.rationale}</p>

      <div className="mt-5 rounded-xl border border-primary/15 bg-primary/[0.04] p-3.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Expected Outcome</p>
        <ul className="mt-2 space-y-1.5">
          {recommendation.addresses.map((dimension) => (
            <li key={dimension} className="flex items-center gap-2 text-sm text-foreground/90">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
              {OUTCOME_LABELS[dimension]}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-5 flex flex-wrap gap-2" aria-label={`Retail search options for ${recommendation.title}`}>
        {retailerLinks.map((retailer) => (
          <Button key={retailer.id} asChild size="sm" variant="outline" className="focus-ring">
            <a href={retailer.href} target="_blank" rel="noopener noreferrer" aria-label={`${retailer.label} for ${recommendation.title}`}>
              <Search className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {retailer.label}<ArrowUpRight className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </Button>
        ))}
      </div>
    </article>
  )
}