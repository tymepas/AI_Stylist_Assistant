import Link from 'next/link'
import { ShoppingBag, Sparkles } from 'lucide-react'
import ShoppingRecommendationCard from '@/components/fashion/ShoppingRecommendationCard'
import type { ShoppingAdvisor as ShoppingAdvisorData } from '@/types/schema'

interface ShoppingAdvisorProps {
  advisor: ShoppingAdvisorData
  occasion: string
}

export default function ShoppingAdvisor({ advisor, occasion }: ShoppingAdvisorProps) {
  if (advisor.availability === 'unavailable') return null

  if (advisor.availability === 'requires_style_dna') {
    return (
      <section className="rounded-2xl border border-border bg-card p-6" aria-labelledby="shopping-advisor-heading">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h3 id="shopping-advisor-heading" className="font-semibold text-foreground">Shopping Advisor</h3>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">Build your Style DNA to unlock personalized alternatives that reflect your long-term color and style signals.</p>
            <Link href="/dashboard/profile" className="focus-ring mt-3 inline-flex rounded-md text-sm font-medium text-primary hover:underline">Build Style DNA</Link>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section aria-labelledby="shopping-advisor-heading">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ShoppingBag className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <h3 id="shopping-advisor-heading" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Shopping Advisor</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">Personalized alternatives to consider. These are advisory suggestions, not predicted verdicts for unanalysed garments.</p>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {advisor.recommendations.map((recommendation) => (
          <ShoppingRecommendationCard key={`${recommendation.garment_type}-${recommendation.title}`} recommendation={recommendation} occasion={occasion} />
        ))}
      </div>
    </section>
  )
}