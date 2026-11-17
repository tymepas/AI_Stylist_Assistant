/**
 * The deployment probes (scripts/verification/image-intake-probes.cjs) are meant
 * to be pointed at Production. This test is what makes that safe: it runs every
 * probe through the real API route in LIVE mode, with the model replaced by a
 * stub and the budget store by an in-memory one, and fails if any probe reaches
 * the model, reserves budget or is answered differently from what it expects.
 *
 * It also checks the probes against the real `sharp`: the "processed" probes
 * are answered by the duplicate check only if every image of the request was
 * decoded and re-encoded first.
 *
 * No network call is made. Every image is synthetic.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals'

jest.mock('server-only', () => ({}), { virtual: true })

import { POST } from '@/app/api/[[...path]]/route'
import * as normalizer from '@/lib/images/normalizeImage'
import { setSpendStoreForTesting } from '@/lib/spend/spendGuard'
import { allRated, openAIResponse } from '../helpers/fixtures'
import { installMemorySpendStore } from '../helpers/memorySpendStore'

interface Probe {
  name: string
  proves: string
  status: number
  contain: string
  photo: Blob
  garments: Blob[]
  mode: string | null
  reachesDuplicateCheck: boolean
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const probesModule = require('../../scripts/verification/image-intake-probes.cjs') as { buildProbes: () => Promise<Probe[]>; formFor: (probe: Probe) => FormData; INVALID_STYLE_PROFILE: string }

const originalEnv = { ...process.env }
let probes: Probe[]
let modelCalls: jest.SpiedFunction<typeof fetch>

function post(body: FormData) {
  return POST(new Request('http://localhost/api/analyze', { method: 'POST', body }), { params: Promise.resolve({ path: ['analyze'] }) })
}

// The synthetic images are generated once: a few of them are large on purpose.
beforeAll(async () => {
  probes = await probesModule.buildProbes()
}, 120_000)

beforeEach(() => {
  // Live mode with a usable key and model: if a probe got as far as the model, the stub WOULD be called.
  process.env = { ...originalEnv, ANALYSIS_MODE: 'openai', OPENAI_API_KEY: 'sk-test-fake-key-probes-0000', OPENAI_MODEL: 'gpt-6.1-terra' }
  for (const method of ['info', 'warn', 'error'] as const) jest.spyOn(console, method).mockImplementation(() => undefined)
  modelCalls = jest.spyOn(global, 'fetch').mockImplementation(async () => openAIResponse({ status: 'complete', dimensions: allRated('Good') }, { usage: { input_tokens: 1, output_tokens: 1 } }))
})

afterEach(() => {
  process.env = { ...originalEnv }
  setSpendStoreForTesting(undefined)
  jest.restoreAllMocks()
})

describe('deployment probes for image intake', () => {
  it('cover processing of every supported format and every kind of refusal', () => {
    expect(probes.length).toBeGreaterThanOrEqual(20)
    expect(probes.filter((probe) => probe.reachesDuplicateCheck).map((probe) => probe.name)).toEqual(['jpeg', 'png', 'png-transparent', 'webp', 'resize', 'exif-orientation', 'near-pixel-limit', 'four-images'])
    expect(new Set(probes.map((probe) => probe.name)).size).toBe(probes.length)
  })

  it('never reach the model, never reserve budget, and are answered exactly as the script expects, in live mode', async () => {
    const store = await installMemorySpendStore()
    for (const probe of probes) {
      const response = await post(probesModule.formFor(probe))
      const body = (await response.json()) as { error: string; message: string }
      expect({ probe: probe.name, status: response.status, matches: `${body.error}: ${body.message}`.includes(probe.contain) }).toEqual({ probe: probe.name, status: probe.status, matches: true })
      expect([400, 413]).toContain(response.status)
    }
    expect(modelCalls).not.toHaveBeenCalled()
    expect(store.spentTotal()).toBe(0)
    expect(store.leases.size).toBe(0)
  }, 120_000)

  it('are refused by the duplicate check only after every image was really processed', async () => {
    const normalize = jest.spyOn(normalizer, 'normalizeImage')
    for (const probe of probes.filter((candidate) => candidate.reachesDuplicateCheck)) {
      normalize.mockClear()
      const response = await post(probesModule.formFor(probe))
      expect(response.status).toBe(400)
      // The personal photo and every garment image went through sharp, and each call returned a JPEG.
      expect({ probe: probe.name, processed: normalize.mock.calls.length }).toEqual({ probe: probe.name, processed: 1 + probe.garments.length })
      const results = await Promise.all(normalize.mock.results.map((result) => result.value as Promise<normalizer.NormalizedImage>))
      for (const result of results) {
        expect(result.file.type).toBe('image/jpeg')
        expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(normalizer.NORMALIZED_LONG_EDGE_PX)
      }
    }
  }, 120_000)

  it('would report a broken image library instead of the duplicate message', async () => {
    // This is what makes the duplicate message evidence: if sharp fails, the answer is different.
    jest.spyOn(normalizer, 'normalizeImage').mockRejectedValue(new Error('simulated native failure'))
    const response = await post(probesModule.formFor(probes[0]))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_upload', message: 'Personal photo: The uploaded file could not be processed as an image.' })
    expect(modelCalls).not.toHaveBeenCalled()
  })

  it('carry a second stop: with different garment photos the request ends at the style profile check, still before the model', async () => {
    const store = await installMemorySpendStore()
    const [first] = probes
    const distinct = { ...first, garments: [first.garments[0], probes[1].photo] }
    const response = await post(probesModule.formFor(distinct))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_upload', message: 'Style profile data is invalid.' })
    expect(modelCalls).not.toHaveBeenCalled()
    expect(store.spentTotal()).toBe(0)
  })

  it('resize the large probe and apply the orientation of the rotated one', async () => {
    const normalize = jest.spyOn(normalizer, 'normalizeImage')
    const byName = (name: string) => probes.find((probe) => probe.name === name) as Probe
    await post(probesModule.formFor(byName('resize')))
    const large = await (normalize.mock.results[0].value as Promise<normalizer.NormalizedImage>)
    expect({ width: large.width, height: large.height, resized: large.resized }).toEqual({ width: 1152, height: 1536, resized: true })

    normalize.mockClear()
    await post(probesModule.formFor(byName('exif-orientation')))
    const rotated = await (normalize.mock.results[0].value as Promise<normalizer.NormalizedImage>)
    // Stored 1200 x 900 with orientation 6 (rotate a quarter turn): upright it is 900 x 1200.
    expect({ width: rotated.width, height: rotated.height }).toEqual({ width: 900, height: 1200 })
  })
})
