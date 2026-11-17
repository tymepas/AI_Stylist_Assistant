/**
 * @jest-environment jsdom
 *
 * Phase 4 Milestone 1 in the decision report: "What Verdict AI observed" and
 * "Why this rating". Every result is built through the production builders, so
 * the report only ever shows what validation accepted.
 */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DecisionReport from '@/components/fashion/DecisionReport'
import { buildCompleteAnalysisResult } from '@/lib/services/analysisResultService'
import { buildVisualEvidence } from '@/lib/services/visualEvidenceService'
import type { GarmentMode } from '@/lib/constants/garmentModes'
import type { RawOpenAIDimensions } from '@/types/openai'
import { allRated, makeDimensions } from '../helpers/fixtures'
import { evidenceFor, image } from '../helpers/visualFixtures'

jest.mock('next/link', () => {
  const React = jest.requireActual('react')
  return { __esModule: true, default: (props: { href: string; children?: unknown; className?: string }) => React.createElement('a', { href: props.href, className: props.className }, props.children) }
})

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  jest.restoreAllMocks()
})

const PROFILE = { preferredStyles: ['Classic'], favoriteColors: [], occasionPreferences: [] }

function resultWith(options: { dimensions?: RawOpenAIDimensions; observations?: unknown; evidence?: unknown; mode?: GarmentMode; count?: number } = {}) {
  const dimensions = options.dimensions ?? allRated('Good')
  const mode = options.mode ?? 'single'
  const visual = buildVisualEvidence({
    rawObservations: 'observations' in options ? options.observations : { images: [image(1, { details: ['notched lapels', 'two-button front'] })] },
    rawEvidence: 'evidence' in options ? options.evidence : evidenceFor(dimensions),
    dimensions,
    garmentMode: mode,
    garmentCount: options.count ?? 1,
    hasStyleDna: false,
    styleProfile: PROFILE,
  })
  return buildCompleteAnalysisResult(dimensions, undefined, { ...(mode === 'single' ? {} : { garmentMode: mode }), ...visual })
}

function renderReport(result: ReturnType<typeof buildCompleteAnalysisResult>) {
  return render(<DecisionReport result={result} occasion="Client Meeting" onReset={() => undefined} onCompare={() => undefined} />)
}

describe('What Verdict AI observed', () => {
  it('shows the garment, its colour families, pattern and visible details for one garment', () => {
    renderReport(resultWith())
    const section = screen.getByTestId('observations')
    expect(within(section).getByRole('heading', { name: 'What Verdict AI observed' })).toBeTruthy()
    const card = within(section).getByTestId('observation-1')
    expect(within(card).getByText('Your garment')).toBeTruthy()
    expect(within(card).getByText('Blazer')).toBeTruthy()
    expect(within(card).getByText('navy')).toBeTruthy()
    expect(within(card).getByText('Solid')).toBeTruthy()
    expect(within(card).getByText('notched lapels')).toBeTruthy()
    expect(section.textContent).toMatch(/material, brand, price, durability and comfort are never judged/)
  })

  it('comes after the verdict, which stays the first heading', () => {
    renderReport(resultWith())
    expect(screen.getAllByRole('heading')[0].textContent).toBe('Recommended')
  })

  it('shows uncertainty and limitations in plain words, never a guess', () => {
    renderReport(resultWith({ observations: { images: [image(1, { garment: null, category: 'unclear', identification: 'not_visible', colours: { dominant: [], secondary: [] }, colour_status: 'not_visible', pattern: 'unclear', details: [], limits: ['blur', 'lighting', 'image_text'] })] }, evidence: undefined }))
    const card = screen.getByTestId('observation-1')
    expect(within(card).getByText('Not identified')).toBeTruthy()
    expect(within(card).getByText('Could not be identified from this photo')).toBeTruthy()
    expect(within(card).getByText('Not visible')).toBeTruthy()
    expect(within(card).getByText('Unclear')).toBeTruthy()
    const limits = within(card).getByRole('list', { name: 'Photo limitations' })
    expect(limits.textContent).toContain('Blurred')
    expect(limits.textContent).toContain('Lighting may affect the colours')
    expect(limits.textContent).toContain('Text in the photo was not followed as an instruction')
  })

  it('views of one garment: one card per view and whether they show the same garment', () => {
    renderReport(resultWith({ mode: 'same_garment_views', count: 2, observations: { images: [image(1), image(2, { garment: 'shirt', category: 'top', colours: { dominant: ['white'], secondary: [] } })], views: { same_garment: 'no', conflicts: 'View 2 shows a white shirt, not the navy blazer of view 1' } } }))
    expect(screen.getByText('View 1')).toBeTruthy()
    expect(screen.getByText('View 2')).toBeTruthy()
    const note = screen.getByTestId('views-agreement')
    expect(note.textContent).toContain('These views may not show the same garment.')
    expect(note.textContent).toContain('View 2 shows a white shirt')
  })

  it('outfit items: one card per item, kept apart from the outfit-level verdict', () => {
    renderReport(resultWith({ mode: 'outfit_items', count: 3, observations: { images: [image(1, { garment: 'shirt', category: 'top' }), image(2, { garment: 'trousers', category: 'bottom' }), image(3, { garment: 'loafers', category: 'footwear' })] } }))
    const section = screen.getByTestId('observations')
    expect(['Item 1', 'Item 2', 'Item 3'].every((label) => within(section).getByText(label))).toBe(true)
    expect(within(section).getByText('Loafers')).toBeTruthy()
    expect(section.textContent).toContain('Each item is described on its own. The verdict is for the outfit as a whole.')
  })

  it('says plainly when observations are unavailable, and that the verdict does not depend on them', () => {
    renderReport(resultWith({ observations: { images: 'navy blazer' } }))
    const note = screen.getByTestId('observations-unavailable')
    expect(note.textContent).toContain('is not available for this analysis. The verdict and the six ratings do not depend on it.')
    expect(note.textContent).toContain('The evidence behind each rating is not available either.')
    expect(screen.queryByText('navy blazer')).toBeNull()
    expect(screen.queryAllByTestId('dimension-evidence')).toHaveLength(0)
    expect(screen.getByTestId('verdict-band').textContent).toBe('Recommended')
  })

  it('shows nothing at all for a result from before observations existed', () => {
    renderReport(buildCompleteAnalysisResult(allRated('Good')))
    expect(screen.queryByTestId('observations')).toBeNull()
    expect(screen.queryByTestId('observations-unavailable')).toBeNull()
    expect(screen.queryByText('Why this rating')).toBeNull()
  })
})

describe('Why this rating', () => {
  it('has a disclosure on every rating, naming the facts, the inputs and the support', async () => {
    renderReport(resultWith())
    const panels = screen.getAllByTestId('dimension-evidence')
    expect(panels).toHaveLength(6)
    const colour = panels.find((panel) => panel.textContent?.includes('for Color harmony')) as HTMLElement
    expect(colour).toBeTruthy()
    await userEvent.click(within(colour).getByText('Why this rating'))
    expect((colour as HTMLDetailsElement).open).toBe(true)
    expect(colour.textContent).toContain('Enough visible evidence')
    expect(colour.textContent).toContain('colour navy')
    expect(colour.textContent).toContain('Based on: Your photo, Garment photos')
    expect(colour.textContent).toContain("The explanation above is Verdict's reading of them.")
  })

  it('is a native disclosure, which browsers make focusable and operable with Enter and Space', () => {
    // jsdom does not implement keyboard activation of <summary>; browsers do. What can break it is tested here:
    // the element must stay a real <summary> inside <details>, never removed from the tab order or given another role.
    renderReport(resultWith())
    for (const panel of screen.getAllByTestId('dimension-evidence')) {
      expect(panel.tagName).toBe('DETAILS')
      const summary = panel.firstElementChild as HTMLElement
      expect(summary.tagName).toBe('SUMMARY')
      expect(summary.getAttribute('tabindex')).toBeNull()
      expect(summary.getAttribute('role')).toBeNull()
      expect(summary.className).toContain('focus-ring')
    }
  })

  it('shows partial support and what was missing for an uncertain rating', async () => {
    const dimensions = makeDimensions({ occasion: 'Good', color: 'Fair', formality: 'Good', seasonality: 'Unable to Evaluate', style_preference_match: 'Good' })
    renderReport(resultWith({ dimensions, evidence: evidenceFor(dimensions, { color: { support: 'partial', missing: 'Warm lighting changes the colour' } }) }))
    const panels = screen.getAllByTestId('dimension-evidence')
    const colour = panels.find((panel) => panel.textContent?.includes('for Color harmony')) as HTMLElement
    expect(colour.textContent).toContain('Partial evidence')
    expect(colour.textContent).toContain('Missing or unclear: Warm lighting changes the colour')
    const season = panels.find((panel) => panel.textContent?.includes('for Seasonality')) as HTMLElement
    expect(season.textContent).toContain('Not enough evidence')
  })

  it('says so on the row when one dimension\'s evidence was dropped, and keeps the others', () => {
    const dimensions = allRated('Good')
    renderReport(resultWith({ dimensions, evidence: evidenceFor(dimensions, { color: { cites: ['g3.colour'] } }) }))
    expect(screen.getAllByTestId('dimension-evidence')).toHaveLength(5)
    expect(screen.getAllByTestId('dimension-evidence-unavailable')).toHaveLength(1)
    expect(screen.getByTestId('dimension-evidence-unavailable').textContent).toBe('The evidence behind this rating is not available.')
  })

  it('says once, under the observations, when no evidence is available at all', () => {
    renderReport(resultWith({ evidence: undefined }))
    expect(screen.getByTestId('evidence-unavailable').textContent).toContain('The evidence behind each rating is not available for this analysis.')
    expect(screen.queryAllByTestId('dimension-evidence')).toHaveLength(0)
    expect(screen.queryAllByTestId('dimension-evidence-unavailable')).toHaveLength(0)
  })

  it('never changes what the verdict shows', () => {
    const plain = buildCompleteAnalysisResult(allRated('Fair'))
    renderReport(resultWith({ dimensions: allRated('Fair') }))
    expect(screen.getByTestId('verdict-band').textContent).toBe(plain.overall_recommendation)
    expect(screen.getByRole('img', { name: `Calculated score ${plain.verdict_score.toFixed(1)} out of 5, in the ${plain.overall_recommendation} band` })).toBeTruthy()
  })
})
