/**
 * From the API route to the rendered report, in one test.
 *
 * The original defect sat between the two: the route answered with an advisor
 * that the report then had nothing to show for. The route test checks the
 * response and the component test checks the rendering, each on its own input.
 * This test joins them: the real route (mock mode, no model, no network)
 * produces the response, and the real report component renders exactly that
 * response.
 *
 * The report is rendered to static markup on the server side, so no browser
 * environment is needed and the route runs in its normal Node environment.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { renderToStaticMarkup } from 'react-dom/server'

jest.mock('server-only', () => ({}), { virtual: true })
jest.mock('next/link', () => {
  const React = jest.requireActual('react') as typeof import('react')
  return { __esModule: true, default: (props: { href: string; children?: React.ReactNode; className?: string }) => React.createElement('a', { href: props.href, className: props.className }, props.children) }
})

import { POST } from '@/app/api/[[...path]]/route'
import DecisionReport from '@/components/fashion/DecisionReport'
import type { CompleteAnalysisResult } from '@/types/schema'
import { realPng } from '../helpers/realImages'
import { VALID_COMPLETE_PROFILE } from '../phase3/fixtures'

const originalEnv = { ...process.env }

/** Calls the real route in mock mode. `mockVariant` picks which mock analysis it returns. */
async function analyze(withStyleDna: boolean, mockVariant: number): Promise<CompleteAnalysisResult> {
  jest.spyOn(Math, 'random').mockReturnValue(mockVariant)
  const formData = new FormData()
  formData.append('occasion', 'Client Presentation')
  formData.append('photo', realPng(800, 800, 'photo.png'))
  formData.append('garment', realPng(800, 800, 'garment.png'))
  formData.append('styleProfile', JSON.stringify({ preferredStyles: [], favoriteColors: [], occasionPreferences: [] }))
  if (withStyleDna) formData.append('aiStyleProfile', JSON.stringify(VALID_COMPLETE_PROFILE))
  const response = await POST(new Request('http://localhost/api/analyze', { method: 'POST', body: formData }), { params: Promise.resolve({ path: ['analyze'] }) })
  expect(response.status).toBe(200)
  return (await response.json()) as CompleteAnalysisResult
}

/** The visible text of the report as rendered from `result`, with markup removed. */
function renderedText(result: CompleteAnalysisResult): string {
  const html = renderToStaticMarkup(<DecisionReport result={result} occasion="Client Presentation" onReset={() => undefined} onCompare={() => undefined} />)
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
}

const count = (text: string, fragment: string) => text.split(fragment).length - 1

beforeEach(() => {
  process.env = { ...originalEnv, ANALYSIS_MODE: 'mock' }
  jest.spyOn(global, 'setTimeout').mockImplementation((callback) => { if (typeof callback === 'function') callback(); return 0 as unknown as ReturnType<typeof setTimeout> })
  for (const method of ['info', 'warn'] as const) jest.spyOn(console, method).mockImplementation(() => undefined)
})

afterEach(() => {
  process.env = { ...originalEnv }
  jest.restoreAllMocks()
})

describe('a mock analysis with Style DNA, from the route to the rendered report', () => {
  it.each([[0, 'Highly Recommended'], [0.5, 'Not Recommended']])('shows "Why it is suggested" with the explanation of every recommendation the route returned (mock variant %s)', async (variant, band) => {
    const result = await analyze(true, variant)
    const text = renderedText(result)

    expect(result.overall_recommendation).toBe(band)
    expect(text).toContain(band)
    expect(result.shopping_advisor.recommendations).toHaveLength(2)
    // One explanation block per recommendation, each carrying the text the route returned.
    expect(count(text, 'Why it is suggested')).toBe(2)
    expect(count(text, 'Expected Outcome')).toBe(2)
    for (const recommendation of result.shopping_advisor.recommendations) {
      expect(text).toContain(recommendation.title)
      expect(text).toContain(recommendation.rationale)
    }
    expect(text).not.toContain('No alternatives are available for this analysis')
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('invites Style DNA, and shows no explanation block, when the request carries none', async () => {
    const text = renderedText(await analyze(false, 0))
    expect(text).toContain('Build your Style DNA to unlock personalized alternatives')
    expect(count(text, 'Why it is suggested')).toBe(0)
    expect(text).not.toContain('No alternatives are available for this analysis')
  })

  it('renders the same verdict and score with and without Style DNA', async () => {
    const without = await analyze(false, 0)
    const withDna = await analyze(true, 0)
    expect({ band: withDna.overall_recommendation, score: withDna.verdict_score }).toEqual({ band: without.overall_recommendation, score: without.verdict_score })
    const scoreLine = (text: string) => /Calculated score\s+[\d.]+\s+of 5/.exec(text)?.[0]
    expect(scoreLine(renderedText(withDna))).toBeDefined()
    expect(scoreLine(renderedText(withDna))).toBe(scoreLine(renderedText(without)))
  })
})
