/**
 * Model allowlist, per-model settings, usage parsing and cost arithmetic.
 */

import { describe, expect, it } from '@jest/globals'
import {
  computeCostMicroUsd,
  estimateMaxCostMicroUsd,
  normalizeUsage,
  resolveModelConfig,
  SUPPORTED_MODEL_IDS,
} from '@/lib/services/openai/modelConfig'
import { ROUTE_MAX_DURATION_S } from '@/lib/spend/spendConfig'

describe('model allowlist', () => {
  it('supports exactly gpt-4.1 and gpt-6.1-terra', () => {
    expect([...SUPPORTED_MODEL_IDS]).toEqual(['gpt-4.1', 'gpt-6.1-terra'])
  })

  it.each(['gpt-4.1', ' gpt-4.1 ', 'gpt-6.1-terra'])('resolves %j', (id) => {
    expect(resolveModelConfig(id)?.id).toBe(id.trim())
  })

  it.each([undefined, null, '', 'gpt-4o', 'GPT-4.1', 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-4.1-mini', 'sk-proj-abc123def456ghi789'])('rejects %j', (id) => {
    expect(resolveModelConfig(id)).toBeNull()
  })
})

describe('gpt-4.1 keeps its existing request behaviour', () => {
  const config = resolveModelConfig('gpt-4.1')!

  it('sends no reasoning parameter and keeps the original caps and timeouts', () => {
    expect(config.reasoningEffort).toBeNull()
    expect(config.operations.analysis).toMatchObject({ maxOutputTokens: 1_500, timeoutMs: 20_000 })
    expect(config.operations.profile).toMatchObject({ maxOutputTokens: 2_000, timeoutMs: 30_000 })
  })
})

describe('gpt-6.1-terra configuration', () => {
  const config = resolveModelConfig('gpt-6.1-terra')!

  it('sets reasoning effort explicitly instead of relying on the provider default (medium)', () => {
    expect(config.reasoningEffort).toBe('low')
  })

  it('uses budget-sized output caps, not the 25,000-token exploration guidance', () => {
    expect(config.operations.analysis.maxOutputTokens).toBe(4_000)
    expect(config.operations.profile.maxOutputTokens).toBe(4_000)
  })

  it('keeps every timeout below the Vercel function limit', () => {
    for (const model of SUPPORTED_MODEL_IDS) {
      for (const limits of Object.values(resolveModelConfig(model)!.operations)) {
        expect(limits.timeoutMs).toBeLessThan(ROUTE_MAX_DURATION_S * 1000)
      }
    }
  })

  it('uses official list prices', () => {
    expect(config.pricing).toEqual({ inputUsdPerMTok: 1, cachedInputUsdPerMTok: 0.05, outputUsdPerMTok: 5 })
    expect(resolveModelConfig('gpt-4.1')!.pricing).toEqual({ inputUsdPerMTok: 2, cachedInputUsdPerMTok: 0.5, outputUsdPerMTok: 8 })
  })
})

describe('normalizeUsage', () => {
  it('reads cached and reasoning token details', () => {
    expect(normalizeUsage({
      input_tokens: 7000,
      input_tokens_details: { cached_tokens: 1024 },
      output_tokens: 1800,
      output_tokens_details: { reasoning_tokens: 1200 },
      total_tokens: 8800,
    })).toEqual({ input_tokens: 7000, output_tokens: 1800, total_tokens: 8800, cached_tokens: 1024, reasoning_tokens: 1200 })
  })

  it('defaults missing details to zero and derives a missing total', () => {
    expect(normalizeUsage({ input_tokens: 10, output_tokens: 5 })).toEqual({ input_tokens: 10, output_tokens: 5, total_tokens: 15, cached_tokens: 0, reasoning_tokens: 0 })
  })

  it('clamps details that exceed their totals', () => {
    expect(normalizeUsage({ input_tokens: 10, output_tokens: 5, input_tokens_details: { cached_tokens: 99 }, output_tokens_details: { reasoning_tokens: 99 } }))
      .toMatchObject({ cached_tokens: 10, reasoning_tokens: 5 })
  })

  it.each([undefined, null, 'x', {}, { input_tokens: -1, output_tokens: 1 }, { input_tokens: 'a', output_tokens: 1 }])('returns null for %j', (raw) => {
    expect(normalizeUsage(raw)).toBeNull()
  })
})

describe('cost arithmetic (integer micro-USD)', () => {
  const terra = resolveModelConfig('gpt-6.1-terra')!
  const gpt41 = resolveModelConfig('gpt-4.1')!

  it('bills cached input at the cached rate and reasoning as output', () => {
    const usage = { input_tokens: 7000, output_tokens: 1800, total_tokens: 8800, cached_tokens: 1000, reasoning_tokens: 1200 }
    // Terra: 6000 × $1 + 1000 × $0.05 + 1800 × $5 per 1M tokens = 6000 + 50 + 9000 micro-USD
    expect(computeCostMicroUsd(terra, usage)).toBe(15_050)
    // GPT-4.1: 6000 × 2 + 1000 × 0.5 + 1800 × 8
    expect(computeCostMicroUsd(gpt41, usage)).toBe(26_900)
  })

  it('reserves the worst case: text bound + per-image bound + full output cap', () => {
    // Terra analysis: (8000 + 2 × 3600) × $1 + 4000 × $5 = 15,200 + 20,000
    expect(estimateMaxCostMicroUsd(terra, 'analysis', 2)).toBe(35_200)
    // GPT-4.1 analysis: (8000 + 2 × 1445) × $2 + 1500 × $8 = 21,780 + 12,000
    expect(estimateMaxCostMicroUsd(gpt41, 'analysis', 2)).toBe(33_780)
    expect(estimateMaxCostMicroUsd(terra, 'analysis', 2, 1_000)).toBe(15_200 + 5_000)
  })

  it('never reserves less than a realistic worst-case request costs', () => {
    const worst = { input_tokens: 8000 + 2 * 3600, output_tokens: 4000, total_tokens: 0, cached_tokens: 0, reasoning_tokens: 3000 }
    expect(estimateMaxCostMicroUsd(terra, 'analysis', 2)).toBeGreaterThanOrEqual(computeCostMicroUsd(terra, worst))
  })
})
