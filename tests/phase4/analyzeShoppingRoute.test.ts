import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
jest.mock('server-only', () => ({}), { virtual: true })
import { POST } from '@/app/api/[[...path]]/route'
import { realPng } from '../helpers/realImages'

const originalEnv = { ...process.env }
// A real, decodable picture: the API decodes every upload, so a header-only file would be rejected.
function makeValidPng(): File { return realPng(800, 800, 'image.png') }
beforeEach(() => { process.env = { ...originalEnv, ANALYSIS_MODE: 'mock' }; jest.spyOn(global, 'setTimeout').mockImplementation((callback) => { if (typeof callback === 'function') callback(); return 0 as unknown as ReturnType<typeof setTimeout> }); jest.spyOn(Math, 'random').mockReturnValue(0) })
afterEach(() => { process.env = { ...originalEnv }; jest.restoreAllMocks() })
describe('POST /api/analyze Shopping Advisor integration', () => { it('keeps the mock verdict response and includes advisory recommendations', async () => { const formData = new FormData(); formData.append('occasion', 'Client Presentation'); formData.append('photo', makeValidPng()); formData.append('garment', makeValidPng()); formData.append('styleProfile', JSON.stringify({ preferredStyles: [], favoriteColors: [], occasionPreferences: [] })); const request = new Request('http://localhost/api/analyze', { method: 'POST', body: formData }); const response = await POST(request, { params: Promise.resolve({ path: ['analyze'] }) }); const body = await response.json(); expect(response.status).toBe(200); expect(body.overall_recommendation).toBe('Highly Recommended'); expect(body.verdict_score).toBe(4.7); expect(body.shopping_advisor.availability).toBe('requires_style_dna'); expect(body.shopping_advisor.recommendations).toHaveLength(0) }) })