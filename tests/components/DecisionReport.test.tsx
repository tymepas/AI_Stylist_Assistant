/**
 * @jest-environment jsdom
 *
 * The decision report and the Shopping Advisor as rendered: the verdict comes
 * first and is shown exactly as the application calculated it, uncertainty is
 * stated next to it, and the advisor is advice with no score or verdict of its own.
 */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DecisionReport from '@/components/fashion/DecisionReport'
import { buildCompleteAnalysisResult } from '@/lib/services/analysisResultService'
import type { CompleteAnalysisResult, Rating, ShoppingAdvisor } from '@/types/schema'
import { allRated, dimension, VALID_RECOMMENDATION } from '../helpers/fixtures'

jest.mock('next/link', () => {
  const React = jest.requireActual('react')
  return { __esModule: true, default: (props: { href: string; children?: unknown; className?: string }) => React.createElement('a', { href: props.href, className: props.className }, props.children) }
})

type Overrides = Partial<Record<string, { rating?: Rating; confidence?: 'High' | 'Medium' | 'Low'; reason?: string }>>

function resultWith(base: Rating, overrides: Overrides = {}, advisor?: ShoppingAdvisor, extras?: Parameters<typeof buildCompleteAnalysisResult>[2]): CompleteAnalysisResult {
  const dimensions = allRated(base) as unknown as Record<string, { rating: Rating; reason: string; confidence: string }>
  for (const [key, change] of Object.entries(overrides)) dimensions[key] = { ...dimensions[key], ...change }
  return buildCompleteAnalysisResult(dimensions as never, advisor, extras)
}

function renderReport(result: CompleteAnalysisResult, handlers: { onReset?: () => void; onCompare?: () => void } = {}) {
  return render(<DecisionReport result={result} occasion="Client Meeting" onReset={handlers.onReset ?? (() => undefined)} onCompare={handlers.onCompare ?? (() => undefined)} />)
}

const advisor = (recommendations: unknown[]): ShoppingAdvisor => ({ availability: 'available', recommendations: recommendations as ShoppingAdvisor['recommendations'] })

describe('verdict', () => {
  it('is the first heading and shows the band the application calculated', () => {
    const result = resultWith('Good')
    renderReport(result)
    const headings = screen.getAllByRole('heading')
    expect(headings[0].textContent).toBe(result.overall_recommendation)
    expect(screen.getByTestId('verdict-band').textContent).toBe('Recommended')
    expect(screen.getByText(result.next_step)).toBeTruthy()
  })

  it.each([
    ['Excellent', 'Highly Recommended', '5.0'],
    ['Good', 'Recommended', '4.0'],
    ['Fair', 'Consider Alternatives', '3.0'],
    ['Poor', 'Not Recommended', '2.0'],
  ] as const)('shows the calculated score unchanged for all %s ratings', (rating, band, score) => {
    renderReport(resultWith(rating))
    expect(screen.getByTestId('verdict-band').textContent).toBe(band)
    expect(screen.getByRole('img', { name: `Calculated score ${score} out of 5, in the ${band} band` })).toBeTruthy()
  })

  it('says who decides: the application calculates, the AI only rates', () => {
    renderReport(resultWith('Good'))
    expect(screen.getByText(/The AI rates each dimension; it never sets the verdict/)).toBeTruthy()
  })

  it('names the occasion and, for several garment photos, the mode', () => {
    renderReport(resultWith('Good', {}, undefined, { garmentMode: 'same_garment_views' }))
    expect(screen.getByText(/Your verdict for Client Meeting · Views of one garment/)).toBeTruthy()
  })
})

describe('ratings', () => {
  it('lists all six dimensions with their rating, confidence, reason and weight', () => {
    renderReport(resultWith('Good', { occasion: { rating: 'Excellent', reason: 'Suits a client meeting well.' }, color: { confidence: 'Medium' } }))
    const list = within(screen.getByRole('region', { name: 'The six ratings' }))
    expect(list.getAllByRole('listitem')).toHaveLength(6)
    expect(list.getAllByRole('heading').map((heading) => heading.textContent).slice(1)).toEqual(['Occasion fit', 'Formality', 'Style preference match', 'Color harmony', 'Seasonality', 'Style consistency'])
    expect(list.getByText('Suits a client meeting well.')).toBeTruthy()
    expect(list.getByText('30% of the verdict')).toBeTruthy()
    expect(list.getByText('Shown for context, not part of the verdict')).toBeTruthy()
    expect(list.getAllByRole('img', { name: 'High confidence' }).length).toBe(5)
    expect(list.getByRole('img', { name: 'Medium confidence' })).toBeTruthy()
  })

  it('names a conflict with the stated preference directly', () => {
    renderReport(resultWith('Good', { style_preference_match: { rating: 'Poor' } }))
    expect(screen.getByText(/Conflicts with your stated preference/)).toBeTruthy()
  })
})

describe('uncertainty', () => {
  it('shows no caution when the evidence is complete', () => {
    renderReport(resultWith('Good'))
    expect(screen.queryByTestId('evidence-note')).toBeNull()
  })

  it('says how many dimensions the verdict rests on when some could not be evaluated', () => {
    renderReport(resultWith('Good', { formality: { rating: 'Unable to Evaluate' } }))
    const note = screen.getByTestId('evidence-note')
    expect(note.textContent).toMatch(/Limited evidence/)
    expect(note.textContent).toMatch(/rests on 4 of 5 weighted dimensions \(75% of the weight\)\. Not evaluated: formality\./)
    // The verdict is still the one the application calculated.
    expect(screen.getByTestId('verdict-band').textContent).toBe('Recommended')
  })

  it('calls out Low confidence, on the rating and next to the verdict', () => {
    renderReport(resultWith('Good', { color: { confidence: 'Low' } }))
    expect(screen.getByTestId('evidence-note').textContent).toMatch(/Low confidence on color harmony: treat that rating as tentative/)
    expect(screen.getByRole('img', { name: 'Low confidence' })).toBeTruthy()
  })

  it('shows no score when nothing that counts could be evaluated', () => {
    renderReport(resultWith('Unable to Evaluate'))
    expect(screen.getByText(/No score: nothing that counts towards the verdict could be evaluated/)).toBeTruthy()
    expect(screen.queryByRole('img', { name: /Calculated score/ })).toBeNull()
    expect(screen.getByTestId('evidence-note').textContent).toMatch(/Not enough to go on/)
  })

  it('lists what was not considered, so nothing is implied about price, material or brand', () => {
    renderReport(resultWith('Good'))
    const basis = within(screen.getByRole('region', { name: 'What this is based on' }))
    for (const item of ['price', 'material quality', 'brand', 'durability', 'comfort']) expect(basis.getByText(item)).toBeTruthy()
  })
})

describe('outfit items', () => {
  const components = { availability: 'available' as const, items: [
    { item: 1, garment_type: 'top' as const, assessment: 'Works well' as const, note: 'The shirt anchors the outfit.' },
    { item: 2, garment_type: 'bottom' as const, assessment: 'Needs attention' as const, note: 'The shorts are more casual than the rest.' },
  ] }

  it('shows per-item notes as advisory, after the ratings, without changing the verdict', () => {
    const plain = resultWith('Fair')
    const withNotes = resultWith('Fair', {}, undefined, { garmentMode: 'outfit_items', outfitComponents: components })
    renderReport(withNotes)
    const section = within(screen.getByTestId('outfit-components'))
    expect(section.getAllByRole('listitem')).toHaveLength(2)
    expect(section.getByText('Item 2 · Bottom')).toBeTruthy()
    expect(section.getByText('Needs attention')).toBeTruthy()
    expect(section.getByText(/They are advisory: the verdict above is for the outfit as a whole/)).toBeTruthy()
    expect(screen.getByTestId('verdict-band').textContent).toBe(plain.overall_recommendation)
    expect(withNotes.verdict_score).toBe(plain.verdict_score)
  })

  it('says the notes are unavailable instead of leaving a gap, and keeps the verdict', () => {
    const plain = resultWith('Good')
    renderReport(resultWith('Good', {}, undefined, { garmentMode: 'outfit_items', outfitComponents: { availability: 'unavailable', items: [] } }))
    expect(screen.queryByTestId('outfit-components')).toBeNull()
    const note = within(screen.getByTestId('outfit-components-unavailable'))
    expect(note.getByRole('heading', { name: 'The pieces of the outfit' })).toBeTruthy()
    expect(note.getByText(/Notes on the individual items are not available for this analysis/)).toBeTruthy()
    expect(note.queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.getByTestId('verdict-band').textContent).toBe(plain.overall_recommendation)
  })

  it('shows no item section at all for one garment or for views of one garment', () => {
    const { unmount } = renderReport(resultWith('Good'))
    expect(screen.queryByText('The pieces of the outfit')).toBeNull()
    unmount()
    renderReport(resultWith('Good', {}, undefined, { garmentMode: 'same_garment_views', outfitComponents: { availability: 'not_applicable', items: [] } }))
    expect(screen.queryByText('The pieces of the outfit')).toBeNull()
  })
})

describe('Shopping Advisor', () => {
  const second = { ...VALID_RECOMMENDATION, title: 'Dark leather-look loafers', garment_type: 'footwear', match_level: 'Possible Match', addresses: ['occasion', 'formality'] }

  it('is presented as advice, separate from the verdict, with no score', () => {
    renderReport(resultWith('Fair', {}, advisor([VALID_RECOMMENDATION, second])))
    const section = within(screen.getByTestId('shopping-advisor'))
    expect(section.getByText(/Advice, separate from your verdict/)).toBeTruthy()
    expect(section.getByText(/advisory suggestions, not predicted verdicts/)).toBeTruthy()
    // No number, band or score anywhere inside the advisor.
    const text = screen.getByTestId('shopping-advisor').textContent ?? ''
    expect(text).not.toMatch(/\d(\.\d)?\s*(\/|of|out of)\s*5/)
    expect(text).not.toMatch(/Highly Recommended|Not Recommended|Consider Alternatives|verdict score/i)
  })

  it('keeps the four qualitative match levels', () => {
    const all = (['Excellent Match', 'Strong Match', 'Good Match'] as const).map((match_level, index) => ({ ...VALID_RECOMMENDATION, title: `Suggestion ${index + 1}`, match_level }))
    renderReport(resultWith('Fair', {}, advisor(all)))
    for (const label of ['Excellent match', 'Strong match', 'Good match']) expect(screen.getByLabelText(`Match level: ${label}`)).toBeTruthy()
    renderReport(resultWith('Fair', {}, advisor([second])))
    expect(screen.getByLabelText('Match level: Possible match')).toBeTruthy()
  })

  it('explains each suggestion and its expected outcome qualitatively', () => {
    renderReport(resultWith('Fair', {}, advisor([second])))
    const card = within(screen.getByTestId('shopping-advisor'))
    expect(card.getByText('Why it is suggested')).toBeTruthy()
    expect(card.getByText('Expected Outcome')).toBeTruthy()
    expect(card.getByText('Better Occasion Fit')).toBeTruthy()
    expect(card.getByText('More Appropriate Formality')).toBeTruthy()
    expect(card.getByText('A direction to explore, not a guaranteed result.')).toBeTruthy()
  })

  it('keeps the three retailer search links, with no affiliate parameters', () => {
    renderReport(resultWith('Fair', {}, advisor([VALID_RECOMMENDATION])))
    const links = screen.getAllByRole('link').filter((link) => /View on/.test(link.textContent ?? '')) as HTMLAnchorElement[]
    expect(links.map((link) => link.textContent?.trim())).toEqual(['View on Myntra', 'View on Amazon', 'View on Ajio'])
    expect(links[0].href.startsWith('https://www.myntra.com/')).toBe(true)
    expect(links[1].href.startsWith('https://www.amazon.in/s?k=')).toBe(true)
    expect(links[2].href.startsWith('https://www.ajio.com/search/?text=')).toBe(true)
    for (const link of links) {
      expect(link.target).toBe('_blank')
      expect(link.rel).toBe('noopener noreferrer')
      expect(link.href).not.toMatch(/tag=|affid|utm_|ref=/)
    }
    expect(screen.getByText(/Verdict does not check price, stock or product details, and earns nothing from these links/)).toBeTruthy()
  })

  it('invites Style DNA when there is none, and says the verdict does not depend on it', () => {
    renderReport(resultWith('Good', {}, { availability: 'requires_style_dna', recommendations: [] }))
    expect(screen.getByText(/Your verdict does not depend on it/)).toBeTruthy()
    expect((screen.getByRole('link', { name: 'Build Style DNA' }) as HTMLAnchorElement).getAttribute('href')).toBe('/dashboard/profile')
    expect(screen.getByTestId('verdict-band').textContent).toBe('Recommended')
  })

  it('says so when advice is unavailable, without a card, a reason or a suggestion of its own', () => {
    renderReport(resultWith('Good'))
    expect(screen.queryByTestId('shopping-advisor')).toBeNull()
    const note = within(screen.getByTestId('shopping-advisor-unavailable'))
    expect(note.getByRole('heading', { name: 'Shopping Advisor' })).toBeTruthy()
    expect(note.getByText(/No alternatives are available for this analysis\. Your verdict and the six ratings above are complete/)).toBeTruthy()
    expect(screen.queryByText('Why it is suggested')).toBeNull()
    expect(screen.queryByText('Expected Outcome')).toBeNull()
    expect(screen.queryAllByRole('link')).toHaveLength(0)
    expect(screen.getByTestId('verdict-band')).toBeTruthy()
  })

  it('treats an available advisor with no suggestions the same way, never as an empty grid', () => {
    renderReport(resultWith('Good', {}, advisor([])))
    expect(screen.queryByTestId('shopping-advisor')).toBeNull()
    expect(screen.getByTestId('shopping-advisor-unavailable')).toBeTruthy()
  })

  it('never changes the verdict shown above it', () => {
    const { unmount } = renderReport(resultWith('Poor'))
    const without = screen.getByTestId('verdict-band').textContent
    unmount()
    renderReport(resultWith('Poor', {}, advisor([{ ...VALID_RECOMMENDATION, match_level: 'Excellent Match' }])))
    expect(screen.getByTestId('verdict-band').textContent).toBe(without)
  })
})

describe('no blank sections', () => {
  /** Every heading of the report with the text of the block it introduces, heading excluded. */
  function sectionsWithoutContent(): string[] {
    const empty: string[] = []
    for (const heading of screen.getAllByRole('heading')) {
      const block = heading.closest('section, header, li, article') as HTMLElement | null
      if (!block) continue
      const rest = (block.textContent ?? '').replace(heading.textContent ?? '', '').trim()
      if (rest.length === 0) empty.push(heading.textContent ?? '')
    }
    return empty
  }

  const outfit = { availability: 'available' as const, items: [
    { item: 1, garment_type: 'top' as const, assessment: 'Works well' as const, note: 'The shirt anchors the outfit.' },
    { item: 2, garment_type: 'bottom' as const, assessment: 'Works' as const, note: 'The trousers sit well with it.' },
  ] }

  it.each<[string, () => CompleteAnalysisResult]>([
    ['one garment, no Style DNA', () => resultWith('Good', {}, { availability: 'requires_style_dna', recommendations: [] })],
    ['one garment, advice unavailable', () => resultWith('Good')],
    ['one garment, with advice', () => resultWith('Fair', {}, advisor([VALID_RECOMMENDATION]))],
    ['an outfit with notes and advice', () => resultWith('Poor', {}, advisor([VALID_RECOMMENDATION]), { garmentMode: 'outfit_items', outfitComponents: outfit })],
    ['an outfit whose notes are unavailable', () => resultWith('Good', {}, undefined, { garmentMode: 'outfit_items', outfitComponents: { availability: 'unavailable', items: [] } })],
    ['nothing could be evaluated', () => resultWith('Unable to Evaluate')],
  ])('has content under every heading: %s', (_name, make) => {
    renderReport(make())
    expect(sectionsWithoutContent()).toEqual([])
  })

  it('leaves out "Things to consider" when there is nothing to list, instead of a heading over nothing', () => {
    const result = { ...resultWith('Good'), things_to_consider: ['', '   '] }
    renderReport(result)
    expect(screen.queryByRole('heading', { name: 'Things to consider' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'What this is based on' })).toBeTruthy()
    expect(sectionsWithoutContent()).toEqual([])
  })

  it('lists every consideration the application produced', () => {
    const result = resultWith('Good', { formality: { rating: 'Poor', reason: 'Far too casual for this setting.' } })
    renderReport(result)
    const section = screen.getByRole('heading', { name: 'Things to consider' }).closest('section') as HTMLElement
    expect(within(section).getAllByRole('listitem')).toHaveLength(result.things_to_consider.length)
    expect(within(section).getByText(/Far too casual for this setting\./)).toBeTruthy()
  })

  it('states that a rating has no explanation rather than showing a blank line or inventing one', () => {
    const result = resultWith('Good')
    result.dimensions.color = { ...result.dimensions.color, reason: '   ' }
    renderReport(result)
    expect(screen.getAllByText('No explanation was given for this rating.')).toHaveLength(1)
    expect(sectionsWithoutContent()).toEqual([])
  })

  it('leaves out an empty "Considered" or "Not considered" list', () => {
    const result = { ...resultWith('Good'), analysis_based_on: { considered: [], not_considered: [] } } as unknown as CompleteAnalysisResult
    renderReport(result)
    expect(screen.queryByText('Considered')).toBeNull()
    expect(screen.queryByText('Not considered')).toBeNull()
    expect(screen.getByText(/Verdict cannot see price, material quality, brand, durability or comfort/)).toBeTruthy()
  })
})

describe('actions', () => {
  it('offers to compare another outfit or start again', async () => {
    const user = userEvent.setup()
    const onCompare = jest.fn()
    const onReset = jest.fn()
    renderReport(resultWith('Good'), { onCompare, onReset })
    await user.click(screen.getByRole('button', { name: /Compare Another Outfit/ }))
    await user.click(screen.getByRole('button', { name: /Start New Analysis/ }))
    expect(onCompare).toHaveBeenCalledTimes(1)
    expect(onReset).toHaveBeenCalledTimes(1)
  })
})
