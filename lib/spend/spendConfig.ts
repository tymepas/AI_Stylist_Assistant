/**
 * Spending-protection configuration.
 *
 * Budgets are application-level controls in integer micro-USD (1,000,000 = $1).
 * They are NOT OpenAI account limits and cannot see spend from other clients
 * using the same OpenAI project (local development, benchmarks, other apps).
 */

import type { OpenAIOperation } from '@/lib/services/openai/modelConfig'

export interface SpendConfig {
  dailyLimitMicroUsd: number
  dailyWarnMicroUsd: number
  totalLimitMicroUsd: number
  maxConcurrent: number
}

export interface RateLimit {
  windowSeconds: number
  perWindow: number
  perDay: number
}

/** Must equal `maxDuration` exported by app/api/[[...path]]/route.js (checked by tests). */
export const ROUTE_MAX_DURATION_S = 60

/**
 * A reservation outlives the longest possible function run, so an abandoned
 * request is only swept (and charged in full) after it can no longer be running.
 */
export const LEASE_TTL_MS = ROUTE_MAX_DURATION_S * 1000 + 30_000

/** One billable call in flight per client address at a time. */
export const MAX_CONCURRENT_PER_CLIENT = 1

/** Per client address, per operation. Generous enough for shared office or campus IPs. */
export const RATE_LIMITS: Record<OpenAIOperation, RateLimit> = {
  analysis: { windowSeconds: 600, perWindow: 6, perDay: 30 },
  profile: { windowSeconds: 600, perWindow: 3, perDay: 10 },
}

export const DEFAULT_SPEND_CONFIG: SpendConfig = {
  dailyLimitMicroUsd: 1_000_000, // $1.00
  dailyWarnMicroUsd: 750_000, // $0.75
  totalLimitMicroUsd: 25_000_000, // $25.00
  maxConcurrent: 2,
}

export class SpendConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SpendConfigError'
  }
}

function usdToMicro(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0 || value > 1_000) {
    throw new SpendConfigError(`${name} must be a number of US dollars greater than 0 and at most 1000.`)
  }
  return Math.round(value * 1_000_000)
}

/** Reads SPEND_* overrides. Any invalid value fails closed (throws). */
export function parseSpendConfig(env: Record<string, string | undefined> = process.env): SpendConfig {
  const config: SpendConfig = {
    dailyLimitMicroUsd: usdToMicro('SPEND_DAILY_LIMIT_USD', env.SPEND_DAILY_LIMIT_USD, DEFAULT_SPEND_CONFIG.dailyLimitMicroUsd),
    dailyWarnMicroUsd: usdToMicro('SPEND_DAILY_WARN_USD', env.SPEND_DAILY_WARN_USD, DEFAULT_SPEND_CONFIG.dailyWarnMicroUsd),
    totalLimitMicroUsd: usdToMicro('SPEND_TOTAL_LIMIT_USD', env.SPEND_TOTAL_LIMIT_USD, DEFAULT_SPEND_CONFIG.totalLimitMicroUsd),
    maxConcurrent: DEFAULT_SPEND_CONFIG.maxConcurrent,
  }

  const rawConcurrency = env.SPEND_MAX_CONCURRENT
  if (rawConcurrency !== undefined && rawConcurrency.trim() !== '') {
    const value = Number(rawConcurrency)
    if (!Number.isInteger(value) || value < 1 || value > 20) {
      throw new SpendConfigError('SPEND_MAX_CONCURRENT must be an integer from 1 to 20.')
    }
    config.maxConcurrent = value
  }

  if (config.dailyWarnMicroUsd > config.dailyLimitMicroUsd) {
    throw new SpendConfigError('SPEND_DAILY_WARN_USD must not exceed SPEND_DAILY_LIMIT_USD.')
  }
  if (config.dailyLimitMicroUsd > config.totalLimitMicroUsd) {
    throw new SpendConfigError('SPEND_DAILY_LIMIT_USD must not exceed SPEND_TOTAL_LIMIT_USD.')
  }
  return config
}
