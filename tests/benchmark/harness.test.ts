/**
 * Benchmark harness logic: manifest validation, the live opt-in gate, scoring,
 * acceptance criteria and the spend cap. No network access.
 */

import { describe, expect, it, jest } from '@jest/globals'

jest.mock('server-only', () => ({}), { virtual: true })

import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  CASE_CATEGORIES,
  evaluateAcceptance,
  evaluateGate,
  HARD_MAX_USD,
  LIVE_OPT_IN,
  manifestSchema,
  maxCostPerCallMicroUsd,
  plannedWorstCaseMicroUsd,
  recordFromResult,
  runCases,
  scanText,
  summarize,
  type BenchmarkCase,
  type PreparedCase,
  type RunOptions,
} from '@/benchmark/harness'
import { allRated, makeDimensions, makePng } from '../helpers/fixtures'

const exampleManifest = () => JSON.parse(readFileSync(path.join(process.cwd(), 'benchmark', 'cases.example.json'), 'utf8'))
const cases = (): BenchmarkCase[] => manifestSchema.parse(exampleManifest()).cases
const terraOptions: RunOptions = { model: 'gpt-6.1-terra', reasoningEffort: 'low', maxOutputTokens: 4_000, runsPerCase: 3, maxUsd: 1 }

describe('manifest', () => {
  it('accepts the example manifest, which covers every category', () => {
    const parsed = cases()
    expect(new Set(parsed.map((c) => c.category)).size).toBe(CASE_CATEGORIES.length)
    expect(parsed.some((c) => c.expected.should_abstain)).toBe(true)
    expect(parsed.some((c) => c.category === 'adversarial_text')).toBe(true)
  })

  it.each([
    ['path traversal', { photo: '../secrets.jpg' }],
    ['absolute path', { photo: '/etc/passwd.jpg' }],
    ['Windows drive path', { photo: 'C:/Users/x.jpg' }],
    ['non-image extension', { garment: 'notes.txt' }],
    ['customer-photo source', { source: 'customer' }],
    ['unknown field', { prompt_override: 'x' }],
  ])('rejects %s', (_label, change) => {
    const manifest = exampleManifest()
    Object.assign(manifest.cases[0], change)
    expect(() => manifestSchema.parse(manifest)).toThrow()
  })

  it('rejects duplicate case ids', () => {
    const manifest = exampleManifest()
    manifest.cases[1].id = manifest.cases[0].id
    expect(() => manifestSchema.parse(manifest)).toThrow(/Duplicate/)
  })
})

describe('live opt-in gate', () => {
  it('defaults to a dry run', () => {
    expect(evaluateGate({ BENCHMARK_MODEL: 'gpt-6.1-terra' })).toMatchObject({ mode: 'dry_run', options: { model: 'gpt-6.1-terra', reasoningEffort: 'low', maxOutputTokens: 4_000, runsPerCase: 3 } })
  })

  it('stays dry with anything but the exact phrase', () => {
    for (const value of ['1', 'true', 'yes', LIVE_OPT_IN.toLowerCase()]) {
      expect(evaluateGate({ BENCHMARK_MODEL: 'gpt-4.1', BENCHMARK_LIVE: value, BENCHMARK_MAX_USD: '1' }).mode).toBe('dry_run')
    }
  })

  it('goes live only with the phrase and a valid cap', () => {
    expect(evaluateGate({ BENCHMARK_MODEL: 'gpt-4.1', BENCHMARK_LIVE: LIVE_OPT_IN, BENCHMARK_MAX_USD: '2' })).toMatchObject({ mode: 'live', options: { maxUsd: 2, reasoningEffort: null } })
  })

  it.each([
    [{ BENCHMARK_MODEL: 'gpt-4o' }],
    [{ BENCHMARK_MODEL: 'gpt-4.1', BENCHMARK_REASONING_EFFORT: 'low' }],
    [{ BENCHMARK_MODEL: 'gpt-6.1-terra', BENCHMARK_REASONING_EFFORT: 'max' }],
    [{ BENCHMARK_MODEL: 'gpt-6.1-terra', BENCHMARK_MAX_OUTPUT_TOKENS: '100' }],
    [{ BENCHMARK_MODEL: 'gpt-6.1-terra', BENCHMARK_RUNS: '9' }],
    [{ BENCHMARK_MODEL: 'gpt-6.1-terra', BENCHMARK_LIVE: LIVE_OPT_IN }],
    [{ BENCHMARK_MODEL: 'gpt-6.1-terra', BENCHMARK_LIVE: LIVE_OPT_IN, BENCHMARK_MAX_USD: '50' }],
    [{ BENCHMARK_MODEL: 'gpt-6.1-terra', BENCHMARK_LIVE: LIVE_OPT_IN, BENCHMARK_MAX_USD: '1', CI: 'true' }],
    [{ BENCHMARK_MODEL: 'gpt-6.1-terra', BENCHMARK_LIVE: LIVE_OPT_IN, BENCHMARK_MAX_USD: '1', VERCEL: '1' }],
  ])('refuses %j', (env) => {
    expect(evaluateGate(env).mode).toBe('refused')
  })
})

describe('scoring', () => {
  const benchmarkCase = cases()[0]

  it('flags prohibited statements and case-specific forbidden claims', () => {
    expect(scanText('A flattering, attractive fit. Only $49 at Zara, made of pure silk.', ['silk']))
      .toEqual({ prohibited: ['attractiveness', 'price', 'brand', 'material_claim'], forbidden: ['silk'] })
    expect(scanText('The navy jacket suits the client presentation.', []).prohibited).toEqual([])
  })

  it('computes the verdict with the production engine, never from model output', () => {
    const record = recordFromResult({ benchmarkCase, run: 1, options: terraOptions, latencyMs: 900, usage: { input_tokens: 7000, output_tokens: 1500, total_tokens: 8500, cached_tokens: 0, reasoning_tokens: 900 }, result: { status: 'complete', dimensions: allRated('Excellent') } })
    expect(record).toMatchObject({ outcome: 'complete', verdict: 'Highly Recommended', verdict_score: 5, cost_micro_usd: 7000 + 1500 * 5 })
  })

  it('summarises validity, agreement, abstention, consistency and cost', () => {
    const all = cases()
    const good = all.find((c) => c.id === 'clear-navy-suit-presentation')!
    const abstain = all.find((c) => c.expected.should_abstain)!
    const usage = { input_tokens: 7000, output_tokens: 1000, total_tokens: 8000, cached_tokens: 0, reasoning_tokens: 400 }
    const records = [
      recordFromResult({ benchmarkCase: good, run: 1, options: terraOptions, latencyMs: 1000, usage, result: { status: 'complete', dimensions: allRated('Excellent') } }),
      recordFromResult({ benchmarkCase: good, run: 2, options: terraOptions, latencyMs: 3000, usage, result: { status: 'complete', dimensions: allRated('Fair') } }),
      recordFromResult({ benchmarkCase: abstain, run: 1, options: terraOptions, latencyMs: 800, usage, result: { status: 'unable_to_analyze', reason: 'No person visible.', confidence: 'Low', next_step: 'Retake.' } }),
      recordFromResult({ benchmarkCase: abstain, run: 2, options: terraOptions, latencyMs: 20000, usage: null, errorCode: 'incomplete' }),
    ]
    const summary = summarize(records, all)
    expect(summary).toMatchObject({
      runs: 4,
      valid_output_rate: 0.75,
      incomplete_rate: 0.25,
      band_agreement_rate: 0.5,
      abstention_rate_when_expected: 0.5,
      false_abstention_rate: 0,
      consistent_case_rate: 0,
      total_cost_micro_usd: 3 * 12_000,
    })
  })

  it('applies the acceptance criteria', () => {
    const passing = { model: 'gpt-6.1-terra' as const, reasoning_effort: 'low' as const, runs: 30, valid_output_rate: 1, incomplete_rate: 0, error_codes: {}, band_agreement_rate: 0.95, abstention_rate_when_expected: 1, false_abstention_rate: 0, consistent_case_rate: 0.95, runs_with_prohibited_hits: 0, runs_with_forbidden_claims: 0, adversarial_band_changes: 0, latency_p50_ms: 6000, latency_p95_ms: 12000, median_cost_micro_usd_per_complete: 15_000, p95_cost_micro_usd: 25_000, total_cost_micro_usd: 450_000 }
    const baseline = { ...passing, model: 'gpt-4.1' as const, reasoning_effort: null, band_agreement_rate: 0.93 }
    expect(evaluateAcceptance(passing, baseline, 45_000).every((c) => c.passed)).toBe(true)

    const failing = evaluateAcceptance({ ...passing, incomplete_rate: 0.05, adversarial_band_changes: 1, band_agreement_rate: 0.9 }, baseline, 45_000)
    expect(failing.filter((c) => !c.passed).map((c) => c.criterion)).toEqual([
      'No incomplete responses at the chosen cap',
      'Verdict band agreement ≥ 90% and not below baseline',
      'No verdict-band changes from injected image text',
    ])
  })
})

describe('planned worst-case cost', () => {
  it('prices each case at its own number of images, from the configured pricing', () => {
    // Terra: $1 per million input tokens, $5 per million output tokens; 8,000 text tokens, 3,600 per image, 4,000 output.
    expect(maxCostPerCallMicroUsd(terraOptions, 2)).toBe(35_200) // 8,000 + 2 x 3,600 input, 4,000 output
    expect(maxCostPerCallMicroUsd(terraOptions, 3)).toBe(38_800)
    expect(maxCostPerCallMicroUsd(terraOptions, 4)).toBe(42_400)

    const [single] = cases()
    const twoGarments = { ...single, id: 'two', garment_mode: 'outfit_items' as const, extra_garments: ['g/extra-1.jpg'] }
    const threeGarments = { ...single, id: 'three', garment_mode: 'same_garment_views' as const, extra_garments: ['g/extra-1.jpg', 'g/extra-2.jpg'] }
    // One run of each: 35,200 + 38,800 + 42,400; three runs per case.
    expect(plannedWorstCaseMicroUsd([single, twoGarments, threeGarments], terraOptions)).toBe((35_200 + 38_800 + 42_400) * 3)
    expect(plannedWorstCaseMicroUsd([], terraOptions)).toBe(0)
  })

  it('keeps 60 four-image cases at three runs inside the hard cap of $10', () => {
    const [single] = cases()
    const heavy = Array.from({ length: 60 }, (_, index) => ({ ...single, id: `c${index}`, garment_mode: 'outfit_items' as const, extra_garments: ['g/extra-1.jpg', 'g/extra-2.jpg'] }))
    expect(plannedWorstCaseMicroUsd(heavy, terraOptions)).toBe(7_632_000) // $7.63
    expect(HARD_MAX_USD).toBe(10)
  })
})

describe('runner spend cap', () => {
  const prepared = (n: number): PreparedCase[] => cases().slice(0, n).map((benchmarkCase) => ({ benchmarkCase, photo: makePng(), garment: makePng() }))

  it('stops before a call whose worst case could exceed the cap, counting unknown outcomes at the worst case', async () => {
    const perCall = maxCostPerCallMicroUsd(terraOptions)
    const options = { ...terraOptions, runsPerCase: 1, maxUsd: (perCall * 2.5) / 1e6 }
    const analyze = jest.fn(async () => { const e = new Error('timeout'); Object.assign(e, { code: 'timeout' }); throw e })

    const outcome = await runCases(prepared(5), options, analyze)

    expect(analyze).toHaveBeenCalledTimes(2)
    expect(outcome.stoppedEarly).toBe(true)
    expect(outcome.records.map((r) => r.error_code)).toEqual(['timeout', 'timeout'])
  })

  it('runs every case sequentially and records usage-based cost', async () => {
    let active = 0
    let maxActive = 0
    const analyze = jest.fn(async (input: { onUsage: (u: { input_tokens: number; output_tokens: number; total_tokens: number; cached_tokens: number; reasoning_tokens: number }) => void }) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((r) => setImmediate(r))
      input.onUsage({ input_tokens: 100, output_tokens: 10, total_tokens: 110, cached_tokens: 0, reasoning_tokens: 0 })
      active -= 1
      return { status: 'complete' as const, dimensions: makeDimensions({ occasion: 'Good', formality: 'Good', style_preference_match: 'Good', color: 'Good', seasonality: 'Good' }) }
    })
    const outcome = await runCases(prepared(3), { ...terraOptions, runsPerCase: 2 }, analyze)
    expect(outcome.records).toHaveLength(6)
    expect(maxActive).toBe(1)
    expect(outcome.records.every((r) => r.cost_micro_usd === 100 + 10 * 5)).toBe(true)
  })
})
