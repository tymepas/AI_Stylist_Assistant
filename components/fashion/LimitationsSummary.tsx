import { CircleAlert } from 'lucide-react'
import type { GarmentMode } from '@/lib/constants/garmentModes'
import { photoName } from '@/lib/services/visualEvidenceDisplay'
import type { ImageLimitation, Observations } from '@/types/schema'

interface LimitationsSummaryProps {
  observations?: Observations
  garmentMode?: GarmentMode
}

const LIMIT_SENTENCES: Record<ImageLimitation, (photo: string) => string> = {
  lighting: (photo) => `Lighting may change how colours look in ${photo}.`,
  shadow: (photo) => `Strong shadows hide part of ${photo}.`,
  occlusion: (photo) => `Part of the garment is hidden in ${photo}.`,
  cropped: (photo) => `${photo} cuts off part of the garment.`,
  blur: (photo) => `${photo} is blurred.`,
  low_resolution: (photo) => `${photo} is low resolution.`,
  angle: (photo) => `${photo} is taken at an unusual angle.`,
  partial_view: (photo) => `Too little of the garment is visible in ${photo}.`,
  image_text: (photo) => `Text in ${photo} was treated as part of the picture.`,
  several_items: (photo) => `${photo} shows several items.`,
}

function capitalise(text: string): string {
  return `${text[0].toUpperCase()}${text.slice(1)}`
}

/** Plain sentences about what limited the observations, without repeats. Exported for tests. */
export function limitationSentences(observations: Observations | undefined, mode: GarmentMode | undefined): string[] {
  if (!observations || observations.availability !== 'available' || !Array.isArray(observations.images)) return []
  const sentences: string[] = []
  for (const entry of observations.images) {
    const photo = photoName(mode, entry.image)
    for (const limit of entry.limits) sentences.push(capitalise(LIMIT_SENTENCES[limit](photo)))
    if (entry.identification === 'not_visible') sentences.push(capitalise(`the garment in ${photo} could not be identified.`))
    if (entry.colour_status === 'uncertain' && !entry.limits.includes('lighting')) sentences.push(capitalise(`the colour in ${photo} is uncertain.`))
    if (entry.colour_status === 'not_visible') sentences.push(capitalise(`the colour in ${photo} is not visible.`))
    if (entry.pattern === 'unclear' && entry.identification !== 'not_visible') sentences.push(capitalise(`the pattern in ${photo} is not clearly visible.`))
  }
  if (observations.views && (observations.views.same_garment !== 'yes' || observations.views.differences?.includes('different_item'))) {
    sentences.push('The views may not all show the same garment.')
  }
  return [...new Set(sentences)]
}

const MAX_SENTENCES = 6

/**
 * "What limited this assessment": what the photos did not show well, in plain
 * words, so a reader knows which parts of the analysis rest on less. It is
 * drawn only from validated observations; nothing is inferred. When nothing
 * limited the photos the section is left out entirely: no empty heading.
 */
export default function LimitationsSummary({ observations, garmentMode }: LimitationsSummaryProps) {
  const sentences = limitationSentences(observations, garmentMode)
  if (sentences.length === 0) return null
  const shown = sentences.slice(0, MAX_SENTENCES)
  return (
    <section aria-labelledby="limitations-heading" data-testid="limitations-summary" className="rounded-xl border border-verdict-caution/30 bg-verdict-caution/[0.06] p-5 sm:p-6">
      <h3 id="limitations-heading" className="inline-flex items-center gap-2 text-base font-medium text-foreground">
        <CircleAlert className="h-4 w-4 text-verdict-caution" aria-hidden="true" /> What limited this assessment
      </h3>
      <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-foreground/90">
        {shown.map((sentence) => <li key={sentence}>{sentence}</li>)}
      </ul>
      {sentences.length > MAX_SENTENCES ? <p className="mt-2 text-xs text-muted-foreground">And {sentences.length - MAX_SENTENCES} more, shown with each photo above.</p> : null}
      <p className="mt-3 text-xs text-muted-foreground">Clearer, well-lit photos that show the whole garment give a firmer answer.</p>
    </section>
  )
}
