import { afterEach, describe, expect, it, jest } from '@jest/globals'
import { buildShoppingAdvisor } from '@/lib/services/shoppingAdvisorService'
import { buildOutfitComponents } from '@/lib/services/outfitComponentsService'

const recommendation = { title: 'Structured navy blazer', garment_type: 'suiting', color_direction: 'Deep navy', style_direction: 'Clean, classic tailoring', rationale: 'A polished alternative that better supports a professional setting.', addresses: ['occasion', 'formality'], match_level: 'Excellent Match' }
const validAdvisor = { recommendations: [recommendation] }
const UNAVAILABLE = { availability: 'unavailable', recommendations: [] }

afterEach(() => { jest.restoreAllMocks() })

function warnings(): Array<Record<string, unknown>> {
  return (console.warn as jest.Mock).mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>)
}

describe('Shopping Advisor result isolation', () => {
  it('requires Style DNA before exposing personalized alternatives', () => expect(buildShoppingAdvisor(validAdvisor, false)).toEqual({ availability: 'requires_style_dna', recommendations: [] }))
  it('exposes validated recommendations when Style DNA is available', () => expect(buildShoppingAdvisor(validAdvisor, true)).toEqual({ availability: 'available', recommendations: validAdvisor.recommendations }))

  it('degrades an invalid advisor without invalidating core analysis', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(buildShoppingAdvisor({ recommendations: [{ title: 'Missing required fields' }] }, true)).toEqual(UNAVAILABLE)
  })

  it('accepts only the block a model returns: anything else, including the application-shaped advisor, is unavailable', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    // The shape the application uses carries `availability`. It is not model output and must not be passed here.
    expect(buildShoppingAdvisor({ availability: 'available', recommendations: [recommendation] }, true)).toEqual(UNAVAILABLE)
    expect(buildShoppingAdvisor({ recommendations: [] }, true)).toEqual(UNAVAILABLE)
    expect(buildShoppingAdvisor(undefined, true)).toEqual(UNAVAILABLE)
    expect(buildShoppingAdvisor({ recommendations: [{ ...recommendation, rationale: '   ' }] }, true)).toEqual(UNAVAILABLE)
  })

  it('logs a dropped advisor with schema paths only, never with its content', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    buildShoppingAdvisor({ recommendations: [{ ...recommendation, rationale: 'SECRET-RATIONALE', match_level: 'Perfect Match' }] }, true, 'req-123')
    expect(warnings()).toHaveLength(1)
    expect(warnings()[0]).toMatchObject({ level: 'warn', event: 'shopping_advisor_unavailable', request_id: 'req-123', validation: 'failed', issue_count: 1, issue_paths: ['recommendations.0.match_level'] })
    expect(JSON.stringify(warnings())).not.toMatch(/SECRET-RATIONALE|Perfect Match|navy/)
  })

  it('logs nothing when Style DNA is absent or the advisor is valid', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    buildShoppingAdvisor({ recommendations: [] }, false)
    buildShoppingAdvisor(validAdvisor, true)
    expect(console.warn).not.toHaveBeenCalled()
  })
})

describe('outfit notes isolation', () => {
  const items = [
    { item: 1, garment_type: 'top', assessment: 'Works well', note: 'The shirt anchors the outfit.' },
    { item: 2, garment_type: 'bottom', assessment: 'Works', note: 'The trousers sit well with it.' },
  ]

  it('exposes one valid note per garment image', () => {
    // Notes without item contributions (analysis-output/4) are kept; the contributions are reported as unavailable.
    expect(buildOutfitComponents(items, 'outfit_items', 2)).toEqual({ availability: 'available', items, contributions: 'unavailable' })
  })

  it('is not applicable outside the outfit mode, whatever the model returned', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(buildOutfitComponents(items, 'single', 1)).toEqual({ availability: 'not_applicable', items: [] })
    expect(buildOutfitComponents(items, 'same_garment_views', 2)).toEqual({ availability: 'not_applicable', items: [] })
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('degrades to unavailable, and logs it without content, when the notes are missing or do not fit the images', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(buildOutfitComponents(undefined, 'outfit_items', 2)).toEqual({ availability: 'unavailable', items: [] })
    expect(buildOutfitComponents(items, 'outfit_items', 3)).toEqual({ availability: 'unavailable', items: [] })
    expect(buildOutfitComponents([{ ...items[0], note: 'SECRET-NOTE', assessment: 'Superb' }, items[1]], 'outfit_items', 2, 'req-9')).toEqual({ availability: 'unavailable', items: [] })
    expect(warnings()).toHaveLength(3)
    expect(warnings()[2]).toMatchObject({ event: 'outfit_components_unavailable', request_id: 'req-9', issue_paths: ['0.assessment'] })
    expect(JSON.stringify(warnings())).not.toMatch(/SECRET-NOTE|Superb|shirt/)
  })
})
