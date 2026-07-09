import { Clock } from 'lucide-react'

export default function HistoryPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center justify-center rounded-2xl border border-border bg-card px-6 py-24 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary">
        <Clock className="h-6 w-6 text-muted-foreground" />
      </div>
      <h2 className="mt-6 text-xl font-medium text-foreground">History is coming soon</h2>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        Saved analysis history will let you revisit past decision reports. For Phase 1, each analysis is independent and not stored.
      </p>
    </div>
  )
}
