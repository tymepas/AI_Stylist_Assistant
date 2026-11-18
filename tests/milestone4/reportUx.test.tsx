/**
 * @jest-environment jsdom
 *
 * Phase 4 Milestone 4 in the decision report: what limited the assessment,
 * limits tied to a rating, consistency flags, and honest states for missing
 * information, including results from before any Phase 4 field existed.
 */

import { render, screen, within } from '@testing-library/react'
import DecisionReport from '@/components/fashion/DecisionReport'
import { buildCompleteAnalysisResult } from '@/lib/services/analysisResultService'
import { buildVisualEvidence } from '@/lib/services/visualEvidenceService'
import { occasionContextOf } from '@/lib/constants/occasionProfiles'
import type { RawOpenAIDimensions } from '@/types/openai'
import { allRated } from '../helpers/fixtures'
import { evidenceFor, image } from '../helpers/visualFixtures'

jest.mock('next/link', () => {
  const React = jest.requireActual('react')
  return { __esModule: true, default: (props: { href: string; children?: unknown; className?: string }) => React.createElement('a', { href: props.href, className: props.className }, props.children) }
})

beforeEach(() => { jest.spyOn(console, 'warn').mockImplementation(() => undefined) })
afterEach(() => { jest.restoreAllMocks() })

const PROFILE = { preferredStyles: ['Classic'], favoriteColors: [], occasionPreferences: [] }

function result(options: { dimensions?: RawOpenAIDimensions; observations?: unknown; evidence?: (dimensions: RawOpenAIDimensions) => unknown } = {}) {
  const dimensions = options.dimensions ?? allRated('Good')
  const visual = buildVisualEvidence({
    rawObservations: 'observations' in options ? options.observations : { images: [image(1)] },
    rawEvidence: options.evidence ? options.evidence(dimensions) : evidenceFor(dimensions),
    dimensions, garmentMode: 'single', garmentCount: 1, hasStyleDna: false, styleProfile: PROFILE,
  })
  return buildCompleteAnalysisResult(dimensions, undefined, { ...visual, occasionContext: occasionContextOf('Office Work') })
}

const renderReport = (value: ReturnType<typeof buildCompleteAnalysisResult>) => render(<DecisionReport result={value} occasion="Office Work" onReset={() => undefined} onCompare={() => undefined} />)

describe('What limited this assessment', () => {
  it('summarises what the photo did not show well, in plain words', () => {
    renderReport(result({ observations: { images: [image(1, { colour_status: 'uncertain', limits: ['lighting', 'cropped'], pattern: 'unclear' })] } }))
    const section = screen.getByTestId('limitations-summary')
    expect(within(section).getByRole('heading', { name: 'What limited this assessment' })).toBeTruthy()
    expect(section.textContent).toContain('Lighting may change how colours look in the garment photo.')
    expect(section.textContent).toContain('The garment photo cuts off part of the garment.')
    expect(section.textContent).toContain('The pattern in the garment photo is not clearly visible.')
  })

  it('is left out when nothing limited the photo: no empty heading', () => {
    renderReport(result())
    expect(screen.queryByTestId('limitations-summary')).toBeNull()
    expect(screen.queryByText('What limited this assessment')).toBeNull()
  })
})

describe('limits tied to a rating', () => {
  it('appear under "Limited by" in that rating\'s evidence', () => {
    renderReport(result({
      observations: { images: [image(1, { colour_status: 'uncertain', limits: ['lighting'] })] },
      evidence: (dimensions) => evidenceFor(dimensions, { color: { cites: ['g1.colour', 'g1.lighting'], support: 'partial', missing: 'Lighting makes the colour uncertain' } }),
    }))
    const colour = screen.getAllByTestId('dimension-evidence').find((panel) => panel.textContent?.includes('for Color harmony')) as HTMLElement
    expect(colour.textContent).toContain('Limited by: lighting may affect the colours (the garment photo)')
    expect(colour.textContent).toContain('Partial evidence')
  })
})

describe('consistency flags', () => {
  it('are shown next to the rating they concern, which is shown as given', () => {
    const dimensions = allRated('Good')
    dimensions.color = { ...dimensions.color, reason: 'The red blazer is bold for the office.' }
    renderReport(result({ dimensions }))
    const flag = screen.getByTestId('consistency-flag')
    expect(flag.textContent).toContain('Check this explanation.')
    expect(flag.textContent).toContain('It mentions red, which was not among the colours observed in your photos.')
    expect(flag.textContent).toContain('The rating itself is shown as given.')
    expect(screen.getByText('The red blazer is bold for the office.')).toBeTruthy()
    expect(screen.getByTestId('verdict-band').textContent).toBe('Recommended')
  })

  it('are absent when the explanations match what was observed', () => {
    renderReport(result())
    expect(screen.queryByTestId('consistency-flag')).toBeNull()
  })
})

describe('missing information', () => {
  it('a fully unavailable analysis states it honestly and still shows the verdict and all six ratings', () => {
    renderReport(result({ observations: 'garbage', evidence: () => 'garbage' }))
    expect(screen.getByTestId('observations-unavailable').textContent).toContain('not available for this analysis')
    expect(screen.queryByTestId('limitations-summary')).toBeNull()
    expect(screen.queryAllByTestId('dimension-evidence')).toHaveLength(0)
    expect(screen.getByTestId('verdict-band').textContent).toBe('Recommended')
    expect(screen.getAllByRole('heading', { level: 4 })).toHaveLength(6)
  })

  it('a result from before Phase 4 renders without any Phase 4 section and without errors', () => {
    renderReport(buildCompleteAnalysisResult(allRated('Fair')))
    for (const id of ['occasion-context', 'observations', 'observations-unavailable', 'limitations-summary', 'consistency-flag', 'dimension-evidence']) expect(screen.queryByTestId(id)).toBeNull()
    expect(screen.getByTestId('verdict-band').textContent).toBe('Consider Alternatives')
  })

  it('every section that renders has a heading, so screen readers can navigate the report', () => {
    renderReport(result({ observations: { images: [image(1, { limits: ['blur'] })] } }))
    for (const id of ['occasion-context', 'observations', 'limitations-summary']) {
      const section = screen.getByTestId(id)
      expect(section.tagName).toBe('SECTION')
      const labelledBy = section.getAttribute('aria-labelledby') as string
      expect(document.getElementById(labelledBy)?.textContent?.length).toBeGreaterThan(0)
    }
  })
})
