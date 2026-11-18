/**
 * @jest-environment jsdom
 *
 * Phase 4 Milestone 2 in the decision report: the occasion context section.
 */

import { render, screen, within } from '@testing-library/react'
import DecisionReport from '@/components/fashion/DecisionReport'
import { buildCompleteAnalysisResult } from '@/lib/services/analysisResultService'
import { occasionContextOf } from '@/lib/constants/occasionProfiles'
import { allRated, makeDimensions } from '../helpers/fixtures'

jest.mock('next/link', () => {
  const React = jest.requireActual('react')
  return { __esModule: true, default: (props: { href: string; children?: unknown; className?: string }) => React.createElement('a', { href: props.href, className: props.className }, props.children) }
})

const renderReport = (result: ReturnType<typeof buildCompleteAnalysisResult>, occasion = 'Wedding Guest') =>
  render(<DecisionReport result={result} occasion={occasion} onReset={() => undefined} onCompare={() => undefined} />)

describe('Occasion context', () => {
  it('shows the selected occasion, what it usually expects, and the occasion fit rating', () => {
    const dimensions = makeDimensions({ occasion: 'Fair', color: 'Good', formality: 'Good', seasonality: 'Good', style_preference_match: 'Good' })
    renderReport(buildCompleteAnalysisResult(dimensions, undefined, { occasionContext: occasionContextOf('Wedding Guest') }))
    const section = screen.getByTestId('occasion-context')
    expect(within(section).getByRole('heading', { name: 'Wedding Guest' })).toBeTruthy()
    expect(section.textContent).toContain('Usually business formal to formal, wedding ceremony; celebratory, polished pieces tend to suit it.')
    expect(section.textContent).toContain('Expectations vary: Dress codes, timing, traditions differ.')
    expect(section.textContent).toContain('Occasion fit: Fair')
    expect(section.textContent).toContain('A general guide to the occasion, not a rule.')
  })

  it('states a season only when the occasion states one', () => {
    renderReport(buildCompleteAnalysisResult(allRated('Good'), undefined, { occasionContext: occasionContextOf('Beach') }), 'Beach')
    expect(screen.getByTestId('occasion-context').textContent).toContain('Season stated by the occasion: warm weather.')
    renderReport(buildCompleteAnalysisResult(allRated('Good'), undefined, { occasionContext: occasionContextOf('Office Work') }), 'Office Work')
    expect(screen.getAllByTestId('occasion-context')[1].textContent).not.toContain('Season stated')
  })

  it('uses the occasion the analysis was for in the verdict header', () => {
    renderReport(buildCompleteAnalysisResult(allRated('Good'), undefined, { occasionContext: occasionContextOf('Black Tie Event') }), 'Wedding Guest')
    expect(screen.getByText(/Your verdict for Black Tie Event/)).toBeTruthy()
  })

  it('is left out for a result from before occasion profiles existed, which still renders', () => {
    renderReport(buildCompleteAnalysisResult(allRated('Good')))
    expect(screen.queryByTestId('occasion-context')).toBeNull()
    expect(screen.getByTestId('verdict-band').textContent).toBe('Recommended')
    expect(screen.getByText(/Your verdict for Wedding Guest/)).toBeTruthy()
  })
})
