import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import ShoppingRecommendationCard from '@/components/fashion/ShoppingRecommendationCard'
import type { ShoppingAdvisor as ShoppingAdvisorData } from '@/types/schema'

interface ShoppingAdvisorProps {
  advisor: ShoppingAdvisorData
  occasion: string
}

/**
 * Shopping Advisor: up to three alternative directions to look at.
 *
 * It is advice, shown apart from the verdict and after it. It carries no score
 * and no verdict of its own and does not change the verdict above. It needs
 * Style DNA, which is optional; without it this section invites the user to add
 * one and everything else in the report works as usual.
 */
export default function ShoppingAdvisor({ advisor, occasion }: ShoppingAdvisorProps) {
  if (advisor.availability === 'unavailable') return null

  if (advisor.availability === 'requires_style_dna') {
    return (
      <section className="surface-quiet p-6 sm:p-8" aria-labelledby="shopping-advisor-heading">
        <div className="flex items-start gap-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <p className="eyebrow">Optional</p>
            <h3 id="shopping-advisor-heading" className="mt-1 font-display text-3xl text-foreground">Shopping Advisor</h3>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">Build your Style DNA to unlock personalized alternatives that reflect your long-term style and coloring. Your verdict does not depend on it.</p>
            <Link href="/dashboard/profile" className="focus-ring mt-4 inline-flex rounded-full text-sm font-medium text-primary hover:underline">Build Style DNA</Link>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section aria-labelledby="shopping-advisor-heading" data-testid="shopping-advisor">
      <p className="eyebrow">Advice, separate from your verdict</p>
      <h3 id="shopping-advisor-heading" className="mt-2 font-display text-4xl text-foreground">Shopping Advisor</h3>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">Personalized alternatives to consider. These are advisory suggestions, not predicted verdicts: they do not change the verdict above, and no score is given for them.</p>
      <div className="mt-6 grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
        {advisor.recommendations.map((recommendation) => (
          <ShoppingRecommendationCard key={`${recommendation.garment_type}-${recommendation.title}`} recommendation={recommendation} occasion={occasion} />
        ))}
      </div>
      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">Retailer buttons open a search on that retailer&apos;s site. Verdict does not check price, stock or product details, and earns nothing from these links.</p>
    </section>
  )
}
