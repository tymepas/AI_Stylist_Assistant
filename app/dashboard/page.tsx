'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Sparkles, UserCircle2, ArrowRight, Clock, BarChart3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getProfile, isProfileComplete } from '@/lib/services/styleProfileService'
import { StyleProfile } from '@/types/schema'

export default function DashboardHome() {
  const [profile, setProfile] = useState<StyleProfile | null>(null)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setProfile(getProfile())
    setHydrated(true)
  }, [])

  const profileComplete = hydrated && isProfileComplete(profile)

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Welcome back</h2>
        <p className="mt-1 text-muted-foreground">Here's a quick overview of your fashion decision assistant.</p>
      </div>

      {hydrated && !profileComplete && (
        <div className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-primary/30 bg-primary/5 p-6 sm:flex-row sm:items-center">
          <div>
            <p className="font-medium text-foreground">Complete your style profile</p>
            <p className="mt-1 text-sm text-muted-foreground">Add your preferred style, colors, and occasions for more relevant analysis.</p>
          </div>
          <Button asChild>
            <Link href="/dashboard/profile">Set up profile <ArrowRight className="ml-2 h-4 w-4" /></Link>
          </Button>
        </div>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        <Link href="/dashboard/analysis" className="group rounded-2xl border border-border bg-card p-6 transition-colors hover:border-primary/40">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <h3 className="font-medium text-foreground">Start New Analysis</h3>
          <p className="mt-2 text-sm text-muted-foreground">Upload a photo and a garment to get your decision report.</p>
          <span className="mt-4 inline-flex items-center text-sm text-primary">
            Begin analysis <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1" />
          </span>
        </Link>
        <Link href="/dashboard/profile" className="group rounded-2xl border border-border bg-card p-6 transition-colors hover:border-primary/40">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-secondary">
            <UserCircle2 className="h-5 w-5 text-primary" />
          </div>
          <h3 className="font-medium text-foreground">Style Profile</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {profileComplete ? 'Your preferences are saved. Update them anytime.' : 'Tell us your style, colors, and occasions.'}
          </p>
          <span className="mt-4 inline-flex items-center text-sm text-primary">
            {profileComplete ? 'Edit profile' : 'Set up profile'} <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1" />
          </span>
        </Link>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card/50 p-6">
          <h3 className="flex items-center gap-2 font-medium text-foreground">
            <BarChart3 className="h-4 w-4 text-primary" /> How verdicts are calculated
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Each analysis rates six dimensions independently. A weighted formula then produces one of four verdicts: Highly Recommended, Recommended, Consider Alternatives, or Not Recommended. The verdict is always calculated, never invented.
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card/50 p-6">
          <h3 className="flex items-center gap-2 font-medium text-foreground">
            <Clock className="h-4 w-4 text-muted-foreground" /> History
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Saved analysis history is coming in a future release. For now, each analysis is independent.
          </p>
        </div>
      </div>
    </div>
  )
}
