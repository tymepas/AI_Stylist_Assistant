import { Eye, ScanSearch } from 'lucide-react'
import type { GarmentMode } from '@/lib/constants/garmentModes'
import {
  COLOUR_SWATCHES,
  LIMIT_LABELS,
  PATTERN_LABELS,
  describeViews,
  garmentName,
  imageLabel,
  CATEGORY_LABELS,
} from '@/lib/services/visualEvidenceDisplay'
import { cn } from '@/lib/utils'
import type { ColourFamily, GarmentObservation, Observations, RatingEvidence } from '@/types/schema'

interface VisualObservationsProps {
  observations?: Observations
  evidence?: RatingEvidence
  garmentMode?: GarmentMode
}

function Swatch({ family }: { family: ColourFamily }) {
  return (
    <span
      className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-foreground/15"
      style={{ background: COLOUR_SWATCHES[family] }}
      aria-hidden="true"
    />
  )
}

function ColourRow({ observation }: { observation: GarmentObservation }) {
  if (observation.colour_status === 'not_visible') return <dd className="text-muted-foreground">Not visible</dd>
  const families = [
    ...observation.colours.dominant.map((family) => ({ family, role: 'main' })),
    ...observation.colours.secondary.map((family) => ({ family, role: 'accent' })),
  ]
  return (
    <dd>
      <ul className="flex flex-wrap gap-x-3 gap-y-1.5">
        {families.map(({ family, role }) => (
          <li key={`${role}-${family}`} className="inline-flex items-center gap-1.5">
            <Swatch family={family} />
            <span className={role === 'main' ? 'text-foreground' : 'text-muted-foreground'}>{family}{role === 'accent' ? ' (accent)' : ''}</span>
          </li>
        ))}
      </ul>
      {observation.colour_status === 'uncertain' ? <p className="mt-1 text-xs text-verdict-caution">Colour uncertain</p> : null}
    </dd>
  )
}

function ObservationCard({ observation, mode }: { observation: GarmentObservation; mode?: GarmentMode }) {
  const status = observation.identification
  return (
    <li className="surface-quiet min-w-0 p-5" data-testid={`observation-${observation.image}`}>
      <p className="eyebrow">{imageLabel(mode, observation.image)}</p>
      <p className="mt-1.5 break-words font-display text-2xl text-foreground">{garmentName(observation)}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {observation.category !== 'unclear' && observation.garment ? CATEGORY_LABELS[observation.category] : null}
        {status === 'uncertain' ? <span className="text-verdict-caution">{observation.garment ? ' · ' : ''}Identification uncertain</span> : null}
        {status === 'not_visible' ? <span>Could not be identified from this photo</span> : null}
      </p>

      <dl className="mt-4 grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-2.5 text-sm">
        <dt className="text-muted-foreground">Colour</dt>
        <ColourRow observation={observation} />
        <dt className="text-muted-foreground">Pattern</dt>
        <dd className={observation.pattern === 'unclear' ? 'text-muted-foreground' : 'text-foreground'}>{PATTERN_LABELS[observation.pattern]}</dd>
        {observation.details.length > 0 ? (
          <>
            <dt className="text-muted-foreground">Details</dt>
            <dd>
              <ul className="space-y-1">
                {observation.details.map((detail) => (
                  <li key={detail} className="break-words text-foreground">{detail}</li>
                ))}
              </ul>
            </dd>
          </>
        ) : null}
      </dl>

      {observation.limits.length > 0 ? (
        <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Photo limitations">
          {observation.limits.map((limit) => (
            <li key={limit} className="rounded-full border border-verdict-caution/30 bg-verdict-caution/[0.07] px-2.5 py-0.5 text-xs text-foreground/85">{LIMIT_LABELS[limit]}</li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

/**
 * "What Verdict AI observed": what was visible in each garment photo.
 *
 * Informational. It describes the photos only (never the person), it is shown
 * apart from the verdict, and nothing in it changes a rating or the verdict.
 * Each photo has its own card, so separate outfit items are never merged and
 * views of one garment are shown as views. When the observations are not
 * available the section says so in one plain note; it never shows guesses.
 * Results from before observations existed have no section at all.
 */
export default function VisualObservations({ observations, evidence, garmentMode }: VisualObservationsProps) {
  if (!observations) return null
  const evidenceUnavailable = evidence?.availability === 'unavailable'

  if (observations.availability !== 'available') {
    return (
      <section aria-labelledby="observed-heading" data-testid="observations-unavailable" className="surface-quiet p-6 sm:p-8">
        <p className="eyebrow">Observed in your photos</p>
        <h3 id="observed-heading" className="mt-1 font-display text-3xl text-foreground">What Verdict AI observed</h3>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
          A description of what is visible in your garment photos is not available for this analysis. The verdict and the six ratings do not depend on it.
          {evidenceUnavailable ? ' The evidence behind each rating is not available either.' : ''}
        </p>
      </section>
    )
  }

  const views = garmentMode === 'same_garment_views' ? observations.views : undefined
  const single = observations.images.length === 1

  return (
    <section aria-labelledby="observed-heading" data-testid="observations">
      <p className="eyebrow inline-flex items-center gap-1.5"><Eye className="h-3.5 w-3.5" aria-hidden="true" /> Observed in your photos</p>
      <h3 id="observed-heading" className="mt-2 font-display text-4xl text-foreground">What Verdict AI observed</h3>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        {garmentMode === 'outfit_items'
          ? 'Each item is described on its own. The verdict is for the outfit as a whole.'
          : garmentMode === 'same_garment_views'
            ? 'Each view is described on its own, as evidence about one garment.'
            : 'What is visible in your garment photo.'}
        {' '}Only what can be seen is described: material, brand, price, durability and comfort are never judged.
      </p>

      {views ? (
        <div role="note" data-testid="views-agreement" className={cn('mt-4 flex max-w-2xl items-start gap-3 rounded-xl border p-4 text-sm leading-relaxed', views.same_garment === 'yes' ? 'border-border text-foreground/90' : 'border-verdict-caution/30 bg-verdict-caution/[0.07] text-foreground/90')}>
          <ScanSearch className={cn('mt-0.5 h-4 w-4 shrink-0', views.same_garment === 'yes' ? 'text-muted-foreground' : 'text-verdict-caution')} aria-hidden="true" />
          <div>
            <p className="font-medium text-foreground">{describeViews(views)}</p>
            {views.conflicts ? <p className="mt-1 break-words">{views.conflicts}</p> : null}
          </div>
        </div>
      ) : null}

      {/* Columns only from `lg`: at tablet width the sidebar leaves this area about 420px wide, too narrow to split. */}
      <ul className={cn('mt-5 grid gap-4', single ? 'max-w-md' : 'lg:grid-cols-2 xl:grid-cols-3')}>
        {observations.images.map((observation) => (
          <ObservationCard key={observation.image} observation={observation} mode={garmentMode} />
        ))}
      </ul>

      {evidenceUnavailable ? (
        <p className="mt-4 max-w-2xl text-xs leading-relaxed text-muted-foreground" data-testid="evidence-unavailable">The evidence behind each rating is not available for this analysis. The ratings and the verdict do not depend on it.</p>
      ) : null}
    </section>
  )
}
