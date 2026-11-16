'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RECENT_ANALYSES_PREVIEW } from '@/lib/constants/mockDashboard'
import { BAND_TONE } from '@/lib/constants/verdictTones'
import { DIMENSION_DISPLAY } from '@/lib/services/evidenceSummary'
import { getProfile as getAIStyleProfile } from '@/lib/services/aiStyleProfileService'
import { getProfile, getProfileCompletion, isProfileComplete } from '@/lib/services/styleProfileService'
import { cn } from '@/lib/utils'
import type { AIStyleProfile, StyleProfile } from '@/types/schema'

const HOW_IT_WORKS = [
  { title: 'Add your photo and the garment', text: 'One garment photo, several views of it, or the items of a whole outfit.' },
  { title: 'Choose the occasion', text: 'Where you plan to wear it carries the most weight.' },
  { title: 'Read the verdict', text: 'Six ratings, one calculated recommendation, and what it is based on.' },
]

export default function DashboardHome() {
  const [profile, setProfile] = useState<StyleProfile | null>(null)
  const [aiProfile, setAIProfile] = useState<AIStyleProfile | null>(null)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setProfile(getProfile())
    setAIProfile(getAIStyleProfile())
    setHydrated(true)
  }, [])

  const profileComplete = hydrated && isProfileComplete(profile)
  const completion = getProfileCompletion(profile, hydrated ? aiProfile : undefined)
  const weighted = DIMENSION_DISPLAY.filter((entry) => entry.weightPercent !== null)

  return (
    <div className="mx-auto max-w-6xl space-y-16">
      {/* One primary action. */}
      <section className="surface bg-ambient relative overflow-hidden p-6 sm:p-10 lg:p-14">
        <p className="eyebrow animate-rise">Your decision assistant</p>
        <h2 className="animate-rise delay-1 mt-4 max-w-3xl font-display text-5xl text-foreground sm:text-6xl lg:text-7xl">
          Know before <em className="text-primary">you buy.</em>
        </h2>
        <p className="animate-rise delay-2 mt-5 max-w-xl text-base leading-relaxed text-muted-foreground">
          Add a photo of yourself and the garment, pick the occasion, and get one clear, explained recommendation.
        </p>
        <div className="animate-rise delay-3 mt-8 flex flex-wrap items-center gap-3">
          <Button asChild size="lg" className="focus-ring">
            <Link href="/dashboard/analysis">Start an analysis <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="focus-ring">
            <Link href="/dashboard/profile">{profileComplete ? 'Edit style profile' : 'Set up style profile'}</Link>
          </Button>
        </div>
      </section>

      <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr]">
        <section aria-labelledby="recent-heading">
          <p className="eyebrow">Recent analyses</p>
          <h3 id="recent-heading" className="mt-2 font-display text-4xl text-foreground">Nothing saved yet</h3>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Verdict does not keep your reports: each one is shown once and then gone. Saved history is planned. Until then, these three examples show what a report looks like.
          </p>
          <ul className="mt-6 divide-y divide-border border-y border-border" aria-label="Example reports, not your data">
            {RECENT_ANALYSES_PREVIEW.map((item) => {
              const tone = BAND_TONE[item.verdict]
              return (
                <li key={item.id} className="flex items-center justify-between gap-4 py-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={cn('h-2 w-2 shrink-0 rounded-full', tone.fill)} aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{item.garment}</p>
                      <p className="text-xs text-muted-foreground">{item.occasion}</p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={cn('text-sm font-medium', tone.text)}>{item.verdict}</p>
                    <p className="text-[0.6875rem] uppercase tracking-[0.14em] text-muted-foreground">Example</p>
                  </div>
                </li>
              )
            })}
          </ul>
          <Link href="/dashboard/history" className="focus-ring mt-4 inline-flex items-center gap-1 rounded-full text-sm text-primary hover:underline">
            About history <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </section>

        <section aria-labelledby="profile-heading">
          <p className="eyebrow">Your profile</p>
          <h3 id="profile-heading" className="mt-2 font-display text-4xl text-foreground">{profileComplete || aiProfile ? 'Personal context' : 'Optional, but useful'}</h3>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Style preferences and Style DNA are both optional. They make one dimension, style preference match, more personal. An analysis works without them.
          </p>
          <div className="mt-6">
            <div className="flex items-baseline justify-between text-xs text-muted-foreground">
              <span>{completion.completedSections} of {completion.totalSections} sections added</span>
              <span>{completion.percent}%</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label="Profile completion" aria-valuemin={0} aria-valuemax={100} aria-valuenow={completion.percent}>
              <div className="h-full" style={{ width: `${completion.percent}%` }}>
                <div className="animate-meter h-full w-full rounded-full bg-primary" />
              </div>
            </div>
          </div>
          <dl className="mt-6 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Style DNA</dt>
              <dd className="text-foreground">{hydrated && aiProfile ? 'Active' : 'Not added'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Styles you like</dt>
              <dd className="truncate text-right text-foreground">{profile?.preferredStyles?.length ? profile.preferredStyles.slice(0, 3).join(', ') : 'None'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Colors you like</dt>
              <dd className="truncate text-right text-foreground">{profile?.favoriteColors?.length ? profile.favoriteColors.slice(0, 3).join(', ') : 'None'}</dd>
            </div>
          </dl>
          <Link href="/dashboard/profile" className="focus-ring mt-5 inline-flex items-center gap-1 rounded-full text-sm text-primary hover:underline">
            Open style profile <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </section>
      </div>

      <section aria-labelledby="how-heading">
        <p className="eyebrow">How it works</p>
        <h3 id="how-heading" className="mt-2 font-display text-4xl text-foreground">Three steps to a verdict</h3>
        <ol className="mt-6 grid gap-8 md:grid-cols-3">
          {HOW_IT_WORKS.map((step, index) => (
            <li key={step.title}>
              <p className="font-display text-5xl text-primary/70">{index + 1}</p>
              <p className="mt-3 font-medium text-foreground">{step.title}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="formula-heading" className="surface-quiet p-6 sm:p-8">
        <p className="eyebrow">Calculated, not invented</p>
        <h3 id="formula-heading" className="mt-2 font-display text-3xl text-foreground">How verdicts are calculated</h3>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          The AI rates six dimensions independently. Verdict then applies one fixed formula to those ratings. The AI never sets the verdict, and style consistency is shown for context without being part of the calculation.
        </p>
        <ul className="mt-6 grid gap-x-10 gap-y-3 sm:grid-cols-2 lg:grid-cols-5">
          {weighted.map((entry) => (
            <li key={entry.key}>
              <p className="font-display text-3xl text-foreground">{entry.weightPercent}%</p>
              <p className="mt-1 text-sm text-muted-foreground">{entry.label}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
