/**
 * Atomic spend store backed by Redis Lua scripts (see spendScripts.ts).
 * The transport is injected: Upstash REST in production, a real Redis server in
 * integration tests.
 */

import type { OpenAIOperation } from '@/lib/services/openai/modelConfig'
import { LEASE_TTL_MS, MAX_CONCURRENT_PER_CLIENT, RATE_LIMITS, type SpendConfig } from './spendConfig'
import { RESERVE_SCRIPT, SETTLE_SCRIPT } from './spendScripts'

/** Runs a Lua script and returns its decoded reply. Throws on any transport or script error. */
export type RedisEval = (script: string, keys: string[], args: string[]) => Promise<unknown>

export type RejectReason =
  | 'rate_limited'
  | 'daily_rate_limited'
  | 'client_busy'
  | 'busy'
  | 'daily_budget_exhausted'
  | 'total_budget_exhausted'

const REJECT_REASONS: readonly RejectReason[] = [
  'rate_limited', 'daily_rate_limited', 'client_busy', 'busy', 'daily_budget_exhausted', 'total_budget_exhausted',
]

export interface Lease {
  id: string
  amountMicroUsd: number
  keys: [day: string, total: string, leases: string, amounts: string, clientLeases: string]
}

export interface ReserveRequest {
  operation: OpenAIOperation
  clientKey: string
  leaseId: string
  amountMicroUsd: number
  nowMs: number
}

export type ReserveResult =
  | { ok: true; lease: Lease; dailyWarning: boolean }
  | { ok: false; reason: RejectReason; retryAfterS: number | null }

export type SettleResult = 'settled' | 'kept' | 'expired'

export interface SpendStore {
  reserve(request: ReserveRequest): Promise<ReserveResult>
  /** actualMicroUsd null means the outcome is unknown: the full reservation stays charged. */
  settle(lease: Lease, actualMicroUsd: number | null): Promise<SettleResult>
}

export class SpendStoreError extends Error {
  constructor(public readonly category: string) {
    super(`Spend store unavailable (${category}).`)
    this.name = 'SpendStoreError'
  }
}

export const DAY_KEY_TTL_S = 3 * 24 * 60 * 60

export function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10)
}

export function secondsUntilNextUtcDay(nowMs: number): number {
  const next = new Date(nowMs)
  next.setUTCHours(24, 0, 0, 0)
  return Math.max(1, Math.ceil((next.getTime() - nowMs) / 1000))
}

/** Retry-After for each rejection; null means retrying will not help soon. */
export function retryAfterFor(reason: RejectReason, operation: OpenAIOperation, nowMs: number): number | null {
  const windowMs = RATE_LIMITS[operation].windowSeconds * 1000
  switch (reason) {
    case 'rate_limited':
      return Math.max(1, Math.ceil(((Math.floor(nowMs / windowMs) + 1) * windowMs - nowMs) / 1000))
    case 'daily_rate_limited':
    case 'daily_budget_exhausted':
      return secondsUntilNextUtcDay(nowMs)
    case 'client_busy':
    case 'busy':
      return 15
    case 'total_budget_exhausted':
      return null
  }
}

function sanitizeNamespace(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 32) || 'default'
}

export function createRedisSpendStore(evalScript: RedisEval, config: SpendConfig, namespace: string): SpendStore {
  const prefix = `verdict:${sanitizeNamespace(namespace)}:spend`

  return {
    async reserve(request) {
      const limits = RATE_LIMITS[request.operation]
      const day = utcDay(request.nowMs)
      const windowIndex = Math.floor(request.nowMs / (limits.windowSeconds * 1000))
      const leaseKeys: Lease['keys'] = [
        `${prefix}:day:${day}`,
        `${prefix}:total`,
        `${prefix}:leases`,
        `${prefix}:lease_amounts`,
        `${prefix}:client_leases:${request.clientKey}`,
      ]
      const keys = [
        ...leaseKeys,
        `${prefix}:rate:${request.operation}:${request.clientKey}:w${windowIndex}`,
        `${prefix}:rate:${request.operation}:${request.clientKey}:d${day}`,
        `${prefix}:warn:${day}`,
      ]
      const args = [
        request.nowMs,
        request.leaseId,
        request.amountMicroUsd,
        config.dailyLimitMicroUsd,
        config.totalLimitMicroUsd,
        config.maxConcurrent,
        MAX_CONCURRENT_PER_CLIENT,
        limits.perWindow,
        limits.windowSeconds,
        limits.perDay,
        request.nowMs + LEASE_TTL_MS,
        config.dailyWarnMicroUsd,
        DAY_KEY_TTL_S,
      ].map(String)

      const reply = await evalScript(RESERVE_SCRIPT, keys, args)
      if (!Array.isArray(reply)) throw new SpendStoreError('unexpected_reply')

      if (Number(reply[0]) === 1) {
        return {
          ok: true,
          lease: { id: request.leaseId, amountMicroUsd: request.amountMicroUsd, keys: leaseKeys },
          dailyWarning: Number(reply[2]) === 1,
        }
      }
      const reason = reply[1] as RejectReason
      if (!REJECT_REASONS.includes(reason)) throw new SpendStoreError('unexpected_reply')
      return { ok: false, reason, retryAfterS: retryAfterFor(reason, request.operation, request.nowMs) }
    },

    async settle(lease, actualMicroUsd) {
      const actual = actualMicroUsd === null ? -1 : Math.max(0, Math.ceil(actualMicroUsd))
      const reply = await evalScript(SETTLE_SCRIPT, [...lease.keys], [lease.id, String(actual), String(lease.amountMicroUsd)])
      if (reply !== 'settled' && reply !== 'kept' && reply !== 'expired') throw new SpendStoreError('unexpected_reply')
      return reply
    },
  }
}
