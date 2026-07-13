import { CheckCircle2, Circle } from 'lucide-react'

export default function HistoryPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Analysis History</h2>
        <p className="mt-1 text-muted-foreground">Saved analyses will appear here in a future release.</p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-8">
        <p className="text-sm font-medium text-foreground">No saved analyses yet.</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Phase 1 keeps every analysis private and temporary. Each report exists only for the duration of your session — nothing is stored, nothing is sent to a server.
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Current version</p>
            <ul className="space-y-2">
              {[
                'Local-only, no account required',
                'Privacy-first by design',
                'No data stored or transmitted',
                'Session-scoped reports',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-foreground">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Coming in a future release</p>
            <ul className="space-y-2">
              {[
                'Saved decision reports',
                'Search and filter by occasion',
                'Compare reports side by side',
                'Export to PDF',
                'Cloud sync with account',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Circle className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/40" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
