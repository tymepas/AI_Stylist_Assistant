'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import AIStyleProfileSection from '@/components/fashion/AIStyleProfileSection'
import { STYLE_OPTIONS, COLOR_OPTIONS, OCCASION_OPTIONS } from '@/lib/constants/options'
import { getProfile, saveProfile, getProfileCompletion } from '@/lib/services/styleProfileService'
import { getProfile as getAIStyleProfile } from '@/lib/services/aiStyleProfileService'
import { cn } from '@/lib/utils'
import { fadeUp, staggerContainer } from '@/lib/motion'
import type { AIStyleProfile } from '@/types/schema'

export default function ProfilePage() {
  const [preferredStyles, setPreferredStyles] = useState<string[]>([])
  const [favoriteColors, setFavoriteColors] = useState<string[]>([])
  const [occasionPreferences, setOccasionPreferences] = useState<string[]>([])
  const [justSaved, setJustSaved] = useState(false)
  const [aiStyleProfile, setAIStyleProfile] = useState<AIStyleProfile | null>(null)

  const handleAIProfileChange = useCallback((profile: AIStyleProfile | null) => {
    setAIStyleProfile(profile)
  }, [])

  useEffect(() => {
    const existing = getProfile()
    if (existing) {
      setPreferredStyles(existing.preferredStyles ?? [])
      setFavoriteColors(existing.favoriteColors ?? [])
      setOccasionPreferences(existing.occasionPreferences ?? [])
    }
    setAIStyleProfile(getAIStyleProfile())
  }, [])

  const completion = getProfileCompletion({ preferredStyles, favoriteColors, occasionPreferences }, aiStyleProfile)

  function toggle(list: string[], setList: (value: string[]) => void, value: string) {
    setList(list.includes(value) ? list.filter((item) => item !== value) : [...list, value])
  }

  function handleSave() {
    saveProfile({ preferredStyles, favoriteColors, occasionPreferences })
    toast.success('Style profile saved')
    setJustSaved(true)
    setTimeout(() => setJustSaved(false), 2000)
  }

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="mx-auto max-w-3xl space-y-8">
      <motion.div variants={fadeUp}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">Style Profile</h2>
            <p className="mt-1 text-muted-foreground">Your preferences and Style DNA make each recommendation feel more personal.</p>
          </div>
          <div className="flex min-w-[140px] flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground"><span>Profile readiness</span><span>{completion.completedSections} of {completion.totalSections} ready</span></div>
            <div className="h-1.5 w-36 overflow-hidden rounded-full bg-secondary"><motion.div initial={{ width: 0 }} animate={{ width: `${completion.percent}%` }} transition={{ duration: 0.5, ease: 'easeOut' }} className="h-full rounded-full bg-primary" /></div>
          </div>
        </div>
      </motion.div>

      <motion.div variants={fadeUp}>
        <AIStyleProfileSection onProfileChange={handleAIProfileChange} />
      </motion.div>

      <div className="border-t border-border" />

      <motion.section variants={fadeUp} aria-labelledby="style-preferences-heading" className="space-y-6">
        <h3 id="style-preferences-heading" className="font-medium text-foreground">Style Preferences</h3>
        <div className="rounded-2xl border border-border bg-card p-6">
          <h4 className="font-medium text-foreground">Preferred Style</h4>
          <p className="mt-1 text-sm text-muted-foreground">Select as many as apply.</p>
          <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Preferred style">
            {STYLE_OPTIONS.map((style) => {
              const active = preferredStyles.includes(style)
              return <motion.button key={style} type="button" whileTap={{ scale: 0.95 }} onClick={() => toggle(preferredStyles, setPreferredStyles, style)} aria-pressed={active} className={cn('focus-ring rounded-full border px-4 py-2 text-sm font-medium transition-all duration-200', active ? 'border-primary bg-primary/10 text-primary shadow-sm shadow-primary/10' : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground')}>{style}</motion.button>
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6">
          <h4 className="font-medium text-foreground">Favorite Colors</h4>
          <p className="mt-1 text-sm text-muted-foreground">Pick the tones you gravitate toward.</p>
          <div className="mt-4 flex flex-wrap gap-4" role="group" aria-label="Favorite colors">
            {COLOR_OPTIONS.map((color) => {
              const active = favoriteColors.includes(color.name)
              return <button key={color.name} type="button" onClick={() => toggle(favoriteColors, setFavoriteColors, color.name)} aria-pressed={active} aria-label={color.name} className="focus-ring flex flex-col items-center gap-1.5 rounded-xl"><motion.span whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }} animate={{ scale: active ? 1.12 : 1 }} style={{ backgroundColor: color.hex }} className={cn('flex h-10 w-10 items-center justify-center rounded-full border-2 shadow-sm transition-colors', active ? 'border-primary ring-2 ring-primary/30' : 'border-border')}>{active && <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 15 }}><Check className="h-4 w-4 text-white drop-shadow" aria-hidden="true" /></motion.span>}</motion.span><span className="text-xs text-muted-foreground">{color.name}</span></button>
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6">
          <h4 className="font-medium text-foreground">Occasion Preferences</h4>
          <p className="mt-1 text-sm text-muted-foreground">What do you usually shop for?</p>
          <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Occasion preferences">
            {OCCASION_OPTIONS.map((occasion) => {
              const active = occasionPreferences.includes(occasion)
              return <motion.button key={occasion} type="button" whileTap={{ scale: 0.95 }} onClick={() => toggle(occasionPreferences, setOccasionPreferences, occasion)} aria-pressed={active} className={cn('focus-ring rounded-full border px-4 py-2 text-sm font-medium transition-all duration-200', active ? 'border-primary bg-primary/10 text-primary shadow-sm shadow-primary/10' : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground')}>{occasion}</motion.button>
            })}
          </div>
        </div>
      </motion.section>

      <motion.div variants={fadeUp} className="flex justify-end">
        <Button onClick={handleSave} size="lg" className="focus-ring relative overflow-hidden">
          {justSaved ? <motion.span initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2"><Check className="h-4 w-4" aria-hidden="true" /> Saved</motion.span> : 'Save Style Profile'}
        </Button>
      </motion.div>
    </motion.div>
  )
}