'use client'

import { toast } from 'sonner'
import { Trash2, Sparkles, CheckCircle2, Circle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { clearProfile } from '@/lib/services/styleProfileService'

export default function SettingsPage() {
  function handleClear() {
    clearProfile()
    toast.success('Style profile cleared')
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h2>
        <p className="mt-1 text-muted-foreground">Manage your Verdict data and preferences.</p>
      </div>

      <section className="rounded-2xl border border-border bg-card p-6">
        <h3 className="font-medium text-foreground">Data</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Your style profile is stored only in this browser. No account or server is required.
        </p>
        <Button variant="outline" className="mt-4" onClick={handleClear}>
          <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" /> Clear Style Profile
        </Button>
      </section>

      <section className="rounded-2xl border border-border bg-card p-6">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <Sparkles className="h-4 w-4 text-primary-foreground" aria-hidden="true" />
          </div>
          <div>
            <h3 className="font-medium text-foreground">Verdict</h3>
            <p className="text-xs text-muted-foreground">v0.1 · Phase 1 MVP</p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Current Features</p>
            <ul className="space-y-1.5">
              {[
                'Style Profile',
                'Outfit Analysis',
                'Outfit Comparison',
                'Decision Reports',
              ].map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden="true" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Roadmap</p>
            <ul className="space-y-1.5">
              {[
                'Saved Reports',
                'Analysis History',
                'AI Vision (direct camera)',
                'Cloud Sync',
                'User Accounts',
              ].map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Circle className="h-3 w-3 shrink-0 text-muted-foreground/40" aria-hidden="true" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="mt-5 text-xs text-muted-foreground/60">
          Phase 1 keeps every analysis private and local. No account needed. No data leaves your device.
        </p>
      </section>
    </div>
  )
}
