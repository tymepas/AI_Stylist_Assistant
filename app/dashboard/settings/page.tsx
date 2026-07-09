'use client'

import { toast } from 'sonner'
import { Trash2, Moon, Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { clearProfile } from '@/lib/services/styleProfileService'

export default function SettingsPage() {
  function handleClear() {
    clearProfile()
    toast.success('Style profile data cleared')
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h2>
        <p className="mt-1 text-muted-foreground">Manage your preferences for Verdict.</p>
      </div>

      <section className="rounded-2xl border border-border bg-card p-6">
        <h3 className="font-medium text-foreground">Preferences</h3>
        <div className="mt-4 flex items-center justify-between py-2">
          <div className="flex items-center gap-3">
            <Moon className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-foreground">Dark theme</span>
          </div>
          <Switch checked disabled />
        </div>
        <div className="flex items-center justify-between py-2">
          <div className="flex items-center gap-3">
            <Bell className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-foreground">Analysis reminders</span>
          </div>
          <Switch />
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-6">
        <h3 className="font-medium text-foreground">Data</h3>
        <p className="mt-1 text-sm text-muted-foreground">Your style profile is stored only in this browser.</p>
        <Button variant="outline" className="mt-4" onClick={handleClear}>
          <Trash2 className="mr-2 h-4 w-4" /> Clear Style Profile
        </Button>
      </section>

      <section className="rounded-2xl border border-border bg-card p-6">
        <h3 className="font-medium text-foreground">About</h3>
        <p className="mt-2 text-sm text-muted-foreground">Verdict · Phase 1 preview build. Analysis results are simulated for demonstration.</p>
      </section>
    </div>
  )
}
