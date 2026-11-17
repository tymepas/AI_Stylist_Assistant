import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
jest.mock('server-only', () => ({}), { virtual: true })
import { POST } from '@/app/api/[[...path]]/route'
import { realPng } from '../helpers/realImages'
import { VALID_COMPLETE_PROFILE } from '../phase3/fixtures'

const originalEnv = { ...process.env }
// A real, decodable picture: the API decodes every upload, so a header-only file would be rejected.
function makeValidPng(): File { return realPng(800, 800, 'image.png') }

async function analyze(extra: Record<string, string> = {}, mockVariant = 0) {
  jest.spyOn(Math, 'random').mockReturnValue(mockVariant)
  const formData = new FormData()
  formData.append('occasion', 'Client Presentation')
  formData.append('photo', makeValidPng())
  formData.append('garment', makeValidPng())
  formData.append('styleProfile', JSON.stringify({ preferredStyles: [], favoriteColors: [], occasionPreferences: [] }))
  for (const [key, value] of Object.entries(extra)) formData.append(key, value)
  const request = new Request('http://localhost/api/analyze', { method: 'POST', body: formData })
  const response = await POST(request, { params: Promise.resolve({ path: ['analyze'] }) })
  return { status: response.status, body: await response.json() }
}

beforeEach(() => {
  process.env = { ...originalEnv, ANALYSIS_MODE: 'mock' }
  jest.spyOn(global, 'setTimeout').mockImplementation((callback) => { if (typeof callback === 'function') callback(); return 0 as unknown as ReturnType<typeof setTimeout> })
  jest.spyOn(console, 'info').mockImplementation(() => undefined)
})
afterEach(() => { process.env = { ...originalEnv }; jest.restoreAllMocks() })

describe('POST /api/analyze Shopping Advisor integration', () => {
  it('keeps the mock verdict response and invites Style DNA when there is none', async () => {
    const { status, body } = await analyze()
    expect(status).toBe(200)
    expect(body.overall_recommendation).toBe('Highly Recommended')
    expect(body.verdict_score).toBe(4.7)
    expect(body.shopping_advisor.availability).toBe('requires_style_dna')
    expect(body.shopping_advisor.recommendations).toHaveLength(0)
  })

  // Regression: the advisor of a mock result is already in the shape the application uses. Passing it
  // whole to the validator for model output made every mock analysis with Style DNA lose its Shopping
  // Advisor, so the "Why it is suggested" explanations never appeared on Preview.
  it.each([[0, 'Highly Recommended'], [0.5, 'Not Recommended']])('shows the mock recommendations, with their explanations, when Style DNA is present (mock variant %s)', async (variant, band) => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { status, body } = await analyze({ aiStyleProfile: JSON.stringify(VALID_COMPLETE_PROFILE) }, variant)
    expect(status).toBe(200)
    expect(body.overall_recommendation).toBe(band)
    expect(body.shopping_advisor.availability).toBe('available')
    expect(body.shopping_advisor.recommendations).toHaveLength(2)
    for (const recommendation of body.shopping_advisor.recommendations) {
      expect(recommendation.rationale.trim().length).toBeGreaterThan(20)
      expect(recommendation.addresses.length).toBeGreaterThan(0)
      expect(recommendation.title.trim().length).toBeGreaterThan(0)
    }
    expect(warn).not.toHaveBeenCalled()
  })

  it('gives the same verdict with and without Style DNA: the advisor never moves it', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const without = await analyze()
    const withDna = await analyze({ aiStyleProfile: JSON.stringify(VALID_COMPLETE_PROFILE) })
    expect({ band: withDna.body.overall_recommendation, score: withDna.body.verdict_score, dimensions: withDna.body.dimensions })
      .toEqual({ band: without.body.overall_recommendation, score: without.body.verdict_score, dimensions: without.body.dimensions })
  })
})
