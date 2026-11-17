import Link from 'next/link'
import { ArrowRight, Check, Circle } from 'lucide-react'
import { Button } from '@/components/ui/button'

const TODAY = [
  'No account is needed',
  'Reports are shown once and are not saved anywhere',
  'Your photos are sent for analysis only when you press Analyze',
  'Verdict does not keep your photos after the analysis',
]

const PLANNED = ['Saved decision reports', 'Search and filter by occasion', 'Compare reports side by side']

export default function HistoryPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <div>
        <p className="eyebrow">History</p>
        <h2 className="mt-2 font-display text-5xl text-foreground">No saved analyses</h2>
        <p className="mt-3 max-w-xl leading-relaxed text-muted-foreground">
          Verdict does not store your reports yet. Each analysis is shown once, on the page where you ran it.
        </p>
        <Button asChild size="lg" className="focus-ring mt-6">
          <Link href="/dashboard/analysis">Start an analysis <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
        </Button>
      </div>

      <div className="grid gap-10 border-t border-border pt-10 sm:grid-cols-2">
        <section aria-labelledby="today-heading">
          <h3 id="today-heading" className="eyebrow">How it works today</h3>
          <ul className="mt-4 space-y-3">
            {TODAY.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm leading-relaxed text-foreground/90">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-verdict-high" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="planned-heading">
          <h3 id="planned-heading" className="eyebrow">Planned, not available yet</h3>
          <ul className="mt-4 space-y-3">
            {PLANNED.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm leading-relaxed text-muted-foreground">
                <Circle className="mt-1 h-3 w-3 shrink-0 text-muted-foreground/40" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
