'use client'

import { Images, Layers, Shirt, type LucideIcon } from 'lucide-react'
import { GARMENT_MODES, GARMENT_MODE_LABELS, type GarmentMode } from '@/lib/constants/garmentModes'
import { cn } from '@/lib/utils'

const ICONS: Record<GarmentMode, LucideIcon> = {
  single: Shirt,
  same_garment_views: Images,
  outfit_items: Layers,
}

const EXAMPLES: Record<GarmentMode, string> = {
  single: 'For example: one photo of a jacket.',
  same_garment_views: 'For example: the front, back and side of one dress.',
  outfit_items: 'For example: a shirt, trousers and a jacket.',
}

interface GarmentModeSelectorProps {
  /** Null until the user has chosen. The mode is always the user's choice; it is never guessed. */
  value: GarmentMode | null
  onChange: (mode: GarmentMode) => void
  disabled?: boolean
}

/** Three explicit choices for how the garment photos relate to each other. */
export default function GarmentModeSelector({ value, onChange, disabled = false }: GarmentModeSelectorProps) {
  return (
    <div role="radiogroup" aria-label="How many garment photos" className="grid gap-3 md:grid-cols-3">
      {GARMENT_MODES.map((mode) => {
        const Icon = ICONS[mode]
        const selected = value === mode
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={selected}
            data-testid={`garment-mode-${mode}`}
            disabled={disabled}
            onClick={() => onChange(mode)}
            className={cn(
              'focus-ring press card-hover flex h-full flex-col items-start rounded-2xl border p-5 text-left',
              selected ? 'border-primary bg-primary/[0.07]' : 'border-border bg-card/40',
              disabled && 'pointer-events-none opacity-50'
            )}
          >
            <span className={cn('flex h-10 w-10 items-center justify-center rounded-full border transition-colors', selected ? 'border-primary/50 bg-primary/15 text-primary' : 'border-border text-muted-foreground')}>
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="mt-4 font-display text-xl text-foreground">{GARMENT_MODE_LABELS[mode].title}</span>
            <span className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{GARMENT_MODE_LABELS[mode].description}</span>
            <span className="mt-3 text-xs text-muted-foreground/70">{EXAMPLES[mode]}</span>
          </button>
        )
      })}
    </div>
  )
}
