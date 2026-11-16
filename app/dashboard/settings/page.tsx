'use client'

import { toast } from 'sonner'
import { Check, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { clearProfile } from '@/lib/services/styleProfileService'

const PRIVACY = [
  'Your style preferences and Style DNA are saved in this browser, and sent along as context when you run an analysis.',
  'Photos stay on your device until you press Analyze or generate Style DNA.',
  'They are then sent to Verdict and to the AI provider for that one analysis.',
  'Verdict does not keep your photos afterwards, and reports are not saved.',
]

export default function SettingsPage() {
  function handleClear() {
    clearProfile()
    toast.success('Style profile cleared')
  }

  return (
    <div className="mx-auto max-w-3xl space-y-12">
      <div>
        <p className="eyebrow">Settings</p>
        <h2 className="mt-2 font-display text-5xl text-foreground">Your data</h2>
        <p className="mt-3 max-w-xl leading-relaxed text-muted-foreground">What Verdict keeps, where it keeps it, and how to remove it.</p>
      </div>

      <section aria-labelledby="privacy-heading" className="border-t border-border pt-10">
        <h3 id="privacy-heading" className="font-display text-3xl text-foreground">Privacy</h3>
        <ul className="mt-5 space-y-3">
          {PRIVACY.map((item) => (
            <li key={item} className="flex items-start gap-2.5 text-sm leading-relaxed text-foreground/90">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-verdict-high" aria-hidden="true" />
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="data-heading" className="border-t border-border pt-10">
        <h3 id="data-heading" className="font-display text-3xl text-foreground">Style profile</h3>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Your style preferences are stored only in this browser. Clearing them removes them from this device; nothing else needs to be deleted because no account exists.
        </p>
        <Button variant="outline" className="focus-ring mt-5" onClick={handleClear}>
          <Trash2 className="h-4 w-4" aria-hidden="true" /> Clear Style Profile
        </Button>
      </section>

      <section aria-labelledby="about-heading" className="border-t border-border pt-10">
        <h3 id="about-heading" className="font-display text-3xl text-foreground">About Verdict</h3>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Verdict helps you decide whether a garment suits you, the occasion and your style before you buy it. The AI rates six dimensions; the app calculates the verdict from them with one fixed formula.
        </p>
      </section>
    </div>
  )
}
