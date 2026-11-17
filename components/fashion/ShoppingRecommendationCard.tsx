import { ArrowUpRight, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getRetailSearchLinks } from '@/lib/services/retailSearchService'
import { cn } from '@/lib/utils'
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

/** The four qualitative match levels. A label, never a number: the advisor does not score. */
const MATCH_LABELS: Record<ShoppingRecommendation['match_level'], { label: string; className: string }> = {
  'Excellent Match': { label: 'Excellent match', className: 'border-primary/40 bg-primary/10 text-primary' },
  'Strong Match': { label: 'Strong match', className: 'border-primary/25 text-primary/90' },
  'Good Match': { label: 'Good match', className: 'border-border text-foreground/80' },
  'Possible Match': { label: 'Possible match', className: 'border-border/70 text-muted-foreground' },
}

const GARMENT_TYPE_LABELS: Record<ShoppingRecommendation['garment_type'], string> = {
  top: 'Top',
  bottom: 'Bottom',
  outerwear: 'Outerwear',
  dress: 'Dress',
  footwear: 'Footwear',
  accessory: 'Accessory',
  suiting: 'Suiting',
  traditional_wear: 'Traditional wear',
}

export default function ShoppingRecommendationCard({ recommendation, occasion }: ShoppingRecommendationCardProps) {
  const retailerLinks = getRetailSearchLinks(recommendation, occasion)
  const match = MATCH_LABELS[recommendation.match_level]

  return (
    <article className="surface card-hover flex h-full flex-col p-6">
      <div className="flex items-start justify-between gap-3">
        <p className="eyebrow">{GARMENT_TYPE_LABELS[recommendation.garment_type]}</p>
        <span className={cn('shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium', match.className)} aria-label={`Match level: ${match.label}`}>
          {match.label}
        </span>
      </div>
      <h4 className="mt-3 font-display text-2xl text-foreground">{recommendation.title}</h4>
      <p className="mt-1.5 text-sm text-muted-foreground">{recommendation.color_direction} · {recommendation.style_direction}</p>

      <div className="mt-5">
        <p className="eyebrow">Why it is suggested</p>
        <p className="mt-1.5 text-sm leading-relaxed text-foreground/85">{recommendation.rationale}</p>
      </div>

      <div className="mt-5">
        <p className="eyebrow">Expected Outcome</p>
        <ul className="mt-2 space-y-1.5">
          {recommendation.addresses.map((dimension) => (
            <li key={dimension} className="flex items-center gap-2 text-sm text-foreground/90">
              <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
              {OUTCOME_LABELS[dimension]}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">A direction to explore, not a guaranteed result.</p>
      </div>

      <div className="mt-auto flex flex-wrap gap-2 pt-6" aria-label={`Retail search options for ${recommendation.title}`}>
        {retailerLinks.map((retailer) => (
          <Button key={retailer.id} asChild size="sm" variant="outline" className="focus-ring">
            <a href={retailer.href} target="_blank" rel="noopener noreferrer" aria-label={`${retailer.label} for ${recommendation.title}`}>
              {retailer.label}<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </Button>
        ))}
      </div>
    </article>
  )
}
