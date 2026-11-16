'use client'

import { Check } from 'lucide-react'
import { COLOR_OPTIONS, STYLE_OPTIONS } from '@/lib/constants/options'
import { cn } from '@/lib/utils'
import type { StyleProfile } from '@/types/schema'

interface StylePreferencesPickerProps {
  value: StyleProfile
  onChange: (profile: StyleProfile) => void
}

function toggle(list: string[], item: string): string[] {
  return list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item]
}

/**
 * Optional style preferences: the styles and colours the user likes. They feed
 * the "style preference match" dimension only. Leaving everything empty is a
 * valid choice; the analysis then says that this dimension could not be compared.
 */
export default function StylePreferencesPicker({ value, onChange }: StylePreferencesPickerProps) {
  return (
    <div className="space-y-7">
      <fieldset>
        <legend className="eyebrow">Styles you like</legend>
        <div className="mt-3 flex flex-wrap gap-2">
          {STYLE_OPTIONS.map((style) => {
            const selected = value.preferredStyles.includes(style)
            return (
              <button
                key={style}
                type="button"
                aria-pressed={selected}
                onClick={() => onChange({ ...value, preferredStyles: toggle(value.preferredStyles, style) })}
                className={cn(
                  'focus-ring press inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors',
                  selected ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
                )}
              >
                {selected ? <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> : null}
                {style}
              </button>
            )
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="eyebrow">Colors you like</legend>
        <div className="mt-3 flex flex-wrap gap-2">
          {COLOR_OPTIONS.map((color) => {
            const selected = value.favoriteColors.includes(color.name)
            return (
              <button
                key={color.name}
                type="button"
                aria-pressed={selected}
                onClick={() => onChange({ ...value, favoriteColors: toggle(value.favoriteColors, color.name) })}
                className={cn(
                  'focus-ring press inline-flex h-9 items-center gap-2 rounded-full border pl-2.5 pr-3.5 text-sm transition-colors',
                  selected ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
                )}
              >
                <span className="h-4 w-4 rounded-full border border-white/15" style={{ backgroundColor: color.hex }} aria-hidden="true" />
                {color.name}
              </button>
            )
          })}
        </div>
      </fieldset>
    </div>
  )
}
