'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Sparkles, UserCircle2, ArrowRight, Clock, BarChart3, Lightbulb, Activity, Palette } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getProfile, isProfileComplete, getProfileCompletion } from '@/lib/services/styleProfileService'
import { RECENT_ANALYSES_PREVIEW, QUICK_TIPS, RECENT_ACTIVITY } from '@/lib/constants/mockDashboard'
import { StyleProfile } from '@/types/schema'
import { fadeUp, staggerContainer, viewportOnce } from '@/lib/motion'

const VERDICT_COLOR: Record<string, string> = {
  'Highly Recommended': 'text-emerald-400',
  Recommended: 'text-blue-400',
  'Consider Alternatives': 'text-amber-400',
  'Not Recommended': 'text-red-400',
}

export default function DashboardHome() {
  const [profile, setProfile] = useState<StyleProfile | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [tipIndex, setTipIndex] = useState(0)

  useEffect(() => {
    setProfile(getProfile())
    setHydrated(true)
  }, [])

  useEffect(() => {
    const interval = setInterval(() => setTipIndex((i) => (i + 1) % QUICK_TIPS.length), 6000)
    return () => clearInterval(interval)
  }, [])

  const profileComplete = hydrated && isProfileComplete(profile)
  const completion = getProfileCompletion(profile)
  const tip = QUICK_TIPS[tipIndex]

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="mx-auto max-w-6xl space-y-8">
      <motion.div variants={fadeUp}>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Welcome back</h2>
        <p className="mt-1 text-muted-foreground">Here is a quick overview of your fashion decision assistant.</p>
      </motion.div>

      {hydrated && !profileComplete && (
        <motion.div variants={fadeUp} className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-primary/30 bg-primary/5 p-6 sm:flex-row sm:items-center">
          <div>
            <p className="font-medium text-foreground">Complete your style profile</p>
            <p className="mt-1 text-sm text-muted-foreground">Add your preferred style, colors, and occasions for more relevant analysis.</p>
          </div>
          <Button asChild className="focus-ring">
            <Link href="/dashboard/profile">Set up profile <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></Link>
          </Button>
        </motion.div>
      )}

      {/* Primary actions */}
      <div className="grid gap-6 sm:grid-cols-2">
        <motion.div variants={fadeUp}>
          <Link href="/dashboard/analysis" className="card-hover focus-ring group block rounded-2xl border border-border bg-card p-6">
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
              <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
            </div>
            <h3 className="font-medium text-foreground">Start New Analysis</h3>
            <p className="mt-2 text-sm text-muted-foreground">Upload a photo and a garment to get your decision report.</p>
            <span className="mt-4 inline-flex items-center text-sm text-primary">
              Begin analysis <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
            </span>
          </Link>
        </motion.div>
        <motion.div variants={fadeUp}>
          <Link href="/dashboard/profile" className="card-hover focus-ring group block rounded-2xl border border-border bg-card p-6">
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-secondary">
              <UserCircle2 className="h-5 w-5 text-primary" aria-hidden="true" />
            </div>
            <h3 className="font-medium text-foreground">Style Profile</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {profileComplete ? 'Your preferences are saved. Update them anytime.' : 'Tell us your style, colors, and occasions.'}
            </p>
            <span className="mt-4 inline-flex items-center text-sm text-primary">
              {profileComplete ? 'Edit profile' : 'Set up profile'} <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
            </span>
          </Link>
        </motion.div>
      </div>

      {/* Widgets grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Profile completion (real data) */}
        <motion.div variants={fadeUp} className="rounded-2xl border border-border bg-card p-6 lg:col-span-1">
          <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
            <UserCircle2 className="h-4 w-4 text-primary" aria-hidden="true" /> Profile Completion
          </h3>
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{completion.completedSections} of {completion.totalSections} sections</span>
              <span>{completion.percent}%</span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-secondary">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${completion.percent}%` }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
                className="h-full rounded-full bg-primary"
              />
            </div>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            {completion.percent === 100
              ? 'Your profile is fully set up.'
              : 'A complete profile helps the style preference match dimension.'}
          </p>
        </motion.div>

        {/* Recent analyses (mock preview) */}
        <motion.div variants={fadeUp} className="rounded-2xl border border-border bg-card p-6 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
              <BarChart3 className="h-4 w-4 text-primary" aria-hidden="true" /> Recent Analyses
            </h3>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">Example</span>
          </div>
          <div className="mt-4 space-y-3">
            {RECENT_ANALYSES_PREVIEW.map((item) => (
              <div key={item.id} className="flex items-center justify-between rounded-xl border border-border/60 bg-background/40 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-foreground">{item.garment}</p>
                  <p className="text-xs text-muted-foreground">{item.occasion} · {item.timeAgo}</p>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-medium ${VERDICT_COLOR[item.verdict]}`}>{item.verdict}</p>
                  <p className="text-xs text-muted-foreground">{item.score.toFixed(1)} / 5</p>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground/70">Illustrative preview — saved analysis history is on the roadmap.</p>
        </motion.div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Style insights */}
        <motion.div variants={fadeUp} className="rounded-2xl border border-border bg-card/50 p-6">
          <h3 className="flex items-center gap-2 font-medium text-foreground">
            <Palette className="h-4 w-4 text-primary" aria-hidden="true" /> Style Insights
          </h3>
          {profileComplete && profile ? (
            <div className="mt-3 space-y-2 text-sm text-muted-foreground">
              {profile.preferredStyles[0] && <p>Your top style: <span className="text-foreground">{profile.preferredStyles[0]}</span></p>}
              {profile.favoriteColors[0] && <p>Favorite tone: <span className="text-foreground">{profile.favoriteColors[0]}</span></p>}
              {profile.occasionPreferences[0] && <p>Shops most for: <span className="text-foreground">{profile.occasionPreferences[0]}</span></p>}
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">Complete your style profile to unlock personalized insights.</p>
          )}
        </motion.div>

        {/* Quick tips */}
        <motion.div variants={fadeUp} className="rounded-2xl border border-border bg-card/50 p-6">
          <h3 className="flex items-center gap-2 font-medium text-foreground">
            <Lightbulb className="h-4 w-4 text-primary" aria-hidden="true" /> Quick Tip
          </h3>
          <motion.div key={tip.title} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="mt-3">
            <p className="text-sm font-medium text-foreground">{tip.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{tip.description}</p>
          </motion.div>
        </motion.div>

        {/* Recent activity (mock) */}
        <motion.div variants={fadeUp} className="rounded-2xl border border-border bg-card/50 p-6">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-medium text-foreground">
              <Activity className="h-4 w-4 text-primary" aria-hidden="true" /> Recent Activity
            </h3>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">Example</span>
          </div>
          <ul className="mt-3 space-y-2.5">
            {RECENT_ACTIVITY.map((activity) => (
              <li key={activity.id} className="flex items-start gap-2 text-sm text-muted-foreground">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary/60" aria-hidden="true" />
                <span>{activity.label} <span className="text-muted-foreground/60">· {activity.timeAgo}</span></span>
              </li>
            ))}
          </ul>
        </motion.div>
      </div>

      <motion.div variants={fadeUp} className="grid gap-6 sm:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card/50 p-6">
          <h3 className="flex items-center gap-2 font-medium text-foreground">
            <BarChart3 className="h-4 w-4 text-primary" aria-hidden="true" /> How verdicts are calculated
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Each analysis rates six dimensions independently. A weighted formula then produces one of four verdicts:
            Highly Recommended, Recommended, Consider Alternatives, or Not Recommended. The verdict is always
            calculated, never invented.
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card/50 p-6">
          <h3 className="flex items-center gap-2 font-medium text-foreground">
            <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> History
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Saved analysis history is coming in a future release. For now, each analysis is independent.
          </p>
        </div>
      </motion.div>
    </motion.div>
  )
}
