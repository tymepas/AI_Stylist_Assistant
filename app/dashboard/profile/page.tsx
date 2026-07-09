'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { STYLE_OPTIONS, COLOR_OPTIONS, OCCASION_OPTIONS } from '@/lib/constants/options'
import { getProfile, saveProfile } from '@/lib/services/styleProfileService'
import { cn } from '@/lib/utils'

export default function ProfilePage() {
  const [preferredStyles, setPreferredStyles] = useState<string[]>([])
  const [favoriteColors, setFavoriteColors] = useState<string[]>([])
  const [occasionPreferences, setOccasionPreferences] = useState<string[]>([])

  useEffect(() => {
    const existing = getProfile()
    if (existing) {
      setPreferredStyles(existing.preferredStyles ?? [])
      setFavoriteColors(existing.favoriteColors ?? [])
      setOccasionPreferences(existing.occasionPreferences ?? [])
    }
  }, [])

  function toggle(list: string[], setList: (v: string[]) => void, value: string) {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value])
  }

  function handleSave() {
    saveProfile({ preferredStyles, favoriteColors, occasionPreferences })
    toast.success('Style profile saved')
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Style Profile</h2>
        <p className="mt-1 text-muted-foreground">A quick snapshot of your taste. Nothing here is required — save whenever you're ready.</p>
      </div>

      <section className="rounded-2xl border border-border bg-card p-6">
        <h3 className="font-medium text-foreground">Preferred Style</h3>
        <p className="mt-1 text-sm text-muted-foreground">Select as many as apply.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {STYLE_OPTIONS.map((style) => {
            const active = preferredStyles.includes(style)
            return (
              <button
                key={style}
                type="button"
                onClick={() => toggle(preferredStyles, setPreferredStyles, style)}
                className={cn(
                  'rounded-full border px-4 py-2 text-sm font-medium transition-colors',
                  active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
                )}
              >
                {style}
              </button>
            )
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-6">
        <h3 className="font-medium text-foreground">Favorite Colors</h3>
        <p className="mt-1 text-sm text-muted-foreground">Pick the tones you gravitate toward.</p>
        <div className="mt-4 flex flex-wrap gap-4">
          {COLOR_OPTIONS.map((color) => {
            const active = favoriteColors.includes(color.name)
            return (
              <button
                key={color.name}
                type="button"
                onClick={() => toggle(favoriteColors, setFavoriteColors, color.name)}
                className="flex flex-col items-center gap-1.5"
              >
                <span
                  style={{ backgroundColor: color.hex }}
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-full border-2 transition-transform',
                    active ? 'border-primary scale-110' : 'border-border'
                  )}
                >
                  {active && <Check className="h-4 w-4 text-white drop-shadow" />}
                </span>
                <span className="text-xs text-muted-foreground">{color.name}</span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-6">
        <h3 className="font-medium text-foreground">Occasion Preferences</h3>
        <p className="mt-1 text-sm text-muted-foreground">What do you usually shop for?</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {OCCASION_OPTIONS.map((occasion) => {
            const active = occasionPreferences.includes(occasion)
            return (
              <button
                key={occasion}
                type="button"
                onClick={() => toggle(occasionPreferences, setOccasionPreferences, occasion)}
                className={cn(
                  'rounded-full border px-4 py-2 text-sm font-medium transition-colors',
                  active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
                )}
              >
                {occasion}
              </button>
            )
          })}
        </div>
      </section>

      <div className="flex justify-end">
        <Button onClick={handleSave} size="lg">Save Style Profile</Button>
      </div>
    </div>
  )
}
