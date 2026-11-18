/**
 * @jest-environment jsdom
 *
 * Phase 4 Milestone 3 in the decision report: what each outfit item does to the
 * ratings, and how views of one garment differ.
 */

import { render, screen, within } from '@testing-library/react'
import DecisionReport from '@/components/fashion/DecisionReport'
import { buildCompleteAnalysisResult } from '@/lib/services/analysisResultService'
import { buildOutfitComponents } from '@/lib/services/outfitComponentsService'
import { buildVisualEvidence } from '@/lib/services/visualEvidenceService'
import { allRated } from '../helpers/fixtures'
import { evidenceFor, image } from '../helpers/visualFixtures'

jest.mock('next/link', () => {
  const React = jest.requireActual('react')
  return { __esModule: true, default: (props: { href: string; children?: unknown; className?: string }) => React.createElement('a', { href: props.href, className: props.className }, props.children) }
})

beforeEach(() => { jest.spyOn(console, 'warn').mockImplementation(() => undefined) })
afterEach(() => { jest.restoreAllMocks() })

const PROFILE = { preferredStyles: [], favoriteColors: [], occasionPreferences: [] }
const note = 'A note long enough to pass validation.'

function outfitResult(components: unknown[]) {
  const dimensions = allRated('Good')
  const visual = buildVisualEvidence({
    rawObservations: { images: [image(1, { category: 'suiting', garment: 'blazer' }), image(2, { category: 'bottom', garment: 'joggers', colours: { dominant: ['grey'], secondary: [] }, details: ['elastic cuffs'] })] },
    rawEvidence: evidenceFor(dimensions), dimensions, garmentMode: 'outfit_items', garmentCount: 2, hasStyleDna: false, styleProfile: PROFILE,
  })
  return buildCompleteAnalysisResult(dimensions, undefined, { garmentMode: 'outfit_items', outfitComponents: buildOutfitComponents(components, 'outfit_items', 2, undefined, visual.observations), ...visual })
}

const renderReport = (result: ReturnType<typeof buildCompleteAnalysisResult>) => render(<DecisionReport result={result} occasion="Client Presentation" onReset={() => undefined} onCompare={() => undefined} />)

describe('outfit item contributions', () => {
  it('say in plain words which ratings each item helps or works against, and what it rests on', () => {
    renderReport(outfitResult([
      { item: 1, garment_type: 'suiting', assessment: 'Works well', note, supports: ['formality', 'occasion'], cites: ['g1.type'] },
      { item: 2, garment_type: 'bottom', assessment: 'Needs attention', note, tension: ['formality'], unclear: ['seasonality'], cites: ['g2.type', 'g2.d1'] },
    ]))
    const [first, second] = screen.getAllByTestId('item-contribution')
    expect(first.textContent).toContain('Helpsformality, occasion fit')
    expect(first.textContent).toContain('Seenblazer')
    expect(second.textContent).toContain('Works againstformality')
    expect(second.textContent).toContain('Too little to judgeseasonality')
    expect(second.textContent).toContain('Seenjoggers; elastic cuffs')
  })

  it('say so per item when a contribution was dropped, and never invent one', () => {
    renderReport(outfitResult([
      { item: 1, garment_type: 'suiting', assessment: 'Works well', note, supports: ['formality'], cites: ['g1.type'] },
      { item: 2, garment_type: 'top', assessment: 'Works', note, supports: ['color'], cites: ['g2.colour'] },
    ]))
    expect(screen.getAllByTestId('item-contribution')).toHaveLength(1)
    expect(screen.getByTestId('item-contribution-unavailable').textContent).toBe('How this item affects each rating is not available.')
  })

  it('leave older results without contributions as they were', () => {
    const result = outfitResult([{ item: 1, garment_type: 'suiting', assessment: 'Works', note }, { item: 2, garment_type: 'bottom', assessment: 'Works', note }])
    const legacy = { ...result, outfit_components: { availability: 'available' as const, items: result.outfit_components!.items } }
    renderReport(legacy)
    expect(screen.queryByTestId('item-contribution')).toBeNull()
    expect(screen.queryByTestId('item-contribution-unavailable')).toBeNull()
    expect(within(screen.getByTestId('outfit-components')).getAllByText(note)).toHaveLength(2)
  })
})

describe('views of one garment', () => {
  it('explain how the views differ', () => {
    const dimensions = allRated('Good')
    const visual = buildVisualEvidence({
      rawObservations: { images: [image(1), image(2, { colours: { dominant: ['blue'], secondary: [] }, limits: ['lighting'] })], views: { same_garment: 'yes', differences: ['colour_lighting', 'detail_hidden'] } },
      rawEvidence: evidenceFor(dimensions), dimensions, garmentMode: 'same_garment_views', garmentCount: 2, hasStyleDna: false, styleProfile: PROFILE,
    })
    renderReport(buildCompleteAnalysisResult(dimensions, undefined, { garmentMode: 'same_garment_views', ...visual }))
    const note = screen.getByTestId('views-agreement')
    expect(note.textContent).toContain('These views appear to show the same garment.')
    expect(note.textContent).toContain('Colours differ between views, likely because of lighting.')
    expect(note.textContent).toContain('Some details show in one view only.')
  })
})
