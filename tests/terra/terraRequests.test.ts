/**
 * Request construction and response handling for Terra versus GPT-4.1. Fetch is mocked.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'

jest.mock('server-only', () => ({}), { virtual: true })

import { analyzeWithOpenAI } from '@/lib/services/openai/openAIAnalysisService'
import { generateProfileWithOpenAI } from '@/lib/services/openai/openAIProfileService'
import { buildRequestBody } from '@/lib/services/openai/responsesClient'
import { resolveModelConfig } from '@/lib/services/openai/modelConfig'
import { allRated, makePng, openAIResponse } from '../helpers/fixtures'
import { VALID_COMPLETE_PROFILE } from '../phase3/fixtures'

const originalEnv = { ...process.env }
const input = () => ({
  photo: makePng(),
  garment: makePng(),
  occasion: 'Office Work',
  styleProfile: { preferredStyles: [], favoriteColors: [], occasionPreferences: [] },
})

function sentBody(fetchMock: { mock: { calls: unknown[][] } }) {
  return JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
}

beforeEach(() => {
  process.env = { ...originalEnv, OPENAI_API_KEY: 'sk-test-fake-terra-0000' }
  for (const method of ['info', 'warn', 'error'] as const) jest.spyOn(console, method).mockImplementation(() => undefined)
})

afterEach(() => {
  process.env = { ...originalEnv }
  jest.restoreAllMocks()
})

describe('buildRequestBody', () => {
  const content = [{ type: 'input_text' as const, text: 'x' }]

  it('builds the exact GPT-4.1 body used before this change (no reasoning key)', () => {
    const body = buildRequestBody(resolveModelConfig('gpt-4.1')!, 'analysis', 'instructions', content)
    expect(body).toEqual({
      model: 'gpt-4.1',
      instructions: 'instructions',
      input: [{ role: 'user', content }],
      text: { format: { type: 'json_object' } },
      max_output_tokens: 1_500,
      store: false,
    })
  })

  it('never sends reasoning to GPT-4.1, even if an override asks for it', () => {
    expect(buildRequestBody(resolveModelConfig('gpt-4.1')!, 'analysis', 'i', content, { reasoningEffort: 'medium' })).not.toHaveProperty('reasoning')
  })

  it('sends an explicit reasoning effort and the Terra cap', () => {
    const body = buildRequestBody(resolveModelConfig('gpt-6.1-terra')!, 'profile', 'i', content)
    expect(body).toMatchObject({ model: 'gpt-6.1-terra', reasoning: { effort: 'low' }, max_output_tokens: 4_000, store: false })
  })

  it('applies benchmark overrides for Terra', () => {
    const body = buildRequestBody(resolveModelConfig('gpt-6.1-terra')!, 'analysis', 'i', content, { reasoningEffort: 'none', maxOutputTokens: 2_500 })
    expect(body).toMatchObject({ reasoning: { effort: 'none' }, max_output_tokens: 2_500 })
  })
})

describe('Terra through the services', () => {
  beforeEach(() => { process.env.OPENAI_MODEL = 'gpt-6.1-terra' })

  it('analysis sends Terra settings and reports usage, including reasoning and cached tokens', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(openAIResponse({ status: 'complete', dimensions: allRated('Good') }, {
      output: [{ type: 'reasoning', summary: [] }],
      usage: { input_tokens: 7300, input_tokens_details: { cached_tokens: 0 }, output_tokens: 1900, output_tokens_details: { reasoning_tokens: 1300 }, total_tokens: 9200 },
    }))
    const onUsage = jest.fn()

    await expect(analyzeWithOpenAI({ ...input(), onUsage })).resolves.toMatchObject({ status: 'complete' })

    expect(sentBody(fetchMock)).toMatchObject({ model: 'gpt-6.1-terra', reasoning: { effort: 'low' }, max_output_tokens: 4_000 })
    expect(onUsage).toHaveBeenCalledWith({ input_tokens: 7300, output_tokens: 1900, total_tokens: 9200, cached_tokens: 0, reasoning_tokens: 1300 })
    const completed = jest.mocked(console.info).mock.calls.map((c) => JSON.parse(String(c[0]))).find((e) => e.event === 'openai_request_completed')
    expect(completed).toMatchObject({ model: 'gpt-6.1-terra', reasoning_effort: 'low', reasoning_tokens: 1300, cached_tokens: 0, cost_micro_usd: 7300 + 1900 * 5 })
  })

  it('finds the message text after a reasoning item when output_text is absent', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      status: 'completed',
      output: [
        { type: 'reasoning', summary: [], encrypted_content: 'opaque' },
        { type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ status: 'complete', dimensions: allRated('Fair') }) }] },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    }), { status: 200 }))
    await expect(analyzeWithOpenAI(input())).resolves.toEqual({ status: 'complete', dimensions: allRated('Fair') })
  })

  it('treats a response cut off by max_output_tokens as incomplete and still reports its billed usage', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(openAIResponse('', {
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      usage: { input_tokens: 7000, output_tokens: 4000, output_tokens_details: { reasoning_tokens: 4000 } },
    }))
    const onUsage = jest.fn()
    await expect(analyzeWithOpenAI({ ...input(), onUsage })).rejects.toMatchObject({ code: 'incomplete' })
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ output_tokens: 4000, reasoning_tokens: 4000 }))
  })

  it('treats a refusal as invalid output', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'I cannot help with that.' }] }],
    }), { status: 200 }))
    await expect(analyzeWithOpenAI(input())).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('profile generation uses the Terra settings', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(openAIResponse({ ...VALID_COMPLETE_PROFILE, generated_at_utc: '' }))
    await generateProfileWithOpenAI({ photo: makePng() })
    expect(sentBody(fetchMock)).toMatchObject({ model: 'gpt-6.1-terra', reasoning: { effort: 'low' }, max_output_tokens: 4_000 })
  })

  it('a usage observer that throws does not change the outcome', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(openAIResponse({ status: 'complete', dimensions: allRated('Good') }))
    await expect(analyzeWithOpenAI({ ...input(), onUsage: () => { throw new Error('observer bug') } })).resolves.toMatchObject({ status: 'complete' })
  })
})

describe('model validation at request entry', () => {
  it.each(['gpt-4o', 'gpt-6.1-sol', 'sk-proj-misplaced-key-0123456789'])('rejects OPENAI_MODEL=%j before any network call', async (model) => {
    process.env.OPENAI_MODEL = model
    const fetchMock = jest.spyOn(global, 'fetch')
    await expect(analyzeWithOpenAI(input())).rejects.toMatchObject({ code: 'configuration_error' })
    await expect(generateProfileWithOpenAI({ photo: makePng() })).rejects.toMatchObject({ code: 'configuration_error' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
