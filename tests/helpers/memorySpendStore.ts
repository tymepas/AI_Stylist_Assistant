/**
 * In-memory SpendStore with the same semantics as lib/spend/spendScripts.ts.
 * For route and guard unit tests only. The real Lua scripts are exercised against
 * a real Redis server in tests/spend/redisScripts.integration.test.ts.
 */

import { LEASE_TTL_MS, MAX_CONCURRENT_PER_CLIENT, RATE_LIMITS, type SpendConfig, DEFAULT_SPEND_CONFIG } from '@/lib/spend/spendConfig'
import { retryAfterFor, utcDay, type Lease, type ReserveRequest, type ReserveResult, type SettleResult, type SpendStore } from '@/lib/spend/spendStore'

export class MemorySpendStore implements SpendStore {
  readonly counters = new Map<string, number>()
  readonly leases = new Map<string, { expiry: number; amount: number; client: string; day: string }>()
  readonly rate = new Map<string, number>()
  readonly reserveCalls: ReserveRequest[] = []
  readonly settleCalls: Array<{ leaseId: string; actual: number | null }> = []
  warned = new Set<string>()
  now: () => number = () => Date.now()

  constructor(readonly config: SpendConfig = DEFAULT_SPEND_CONFIG) {}

  spentToday(nowMs = this.now()): number {
    return this.counters.get(`day:${utcDay(nowMs)}`) ?? 0
  }

  spentTotal(): number {
    return this.counters.get('total') ?? 0
  }

  async reserve(request: ReserveRequest): Promise<ReserveResult> {
    this.reserveCalls.push(request)
    const now = request.nowMs
    for (const [id, lease] of this.leases) if (lease.expiry <= now) this.leases.delete(id)

    const limits = RATE_LIMITS[request.operation]
    const day = utcDay(now)
    const windowKey = `${request.operation}:${request.clientKey}:w${Math.floor(now / (limits.windowSeconds * 1000))}`
    const dayKey = `${request.operation}:${request.clientKey}:d${day}`
    const reject = (reason: Parameters<typeof retryAfterFor>[0]): ReserveResult => ({ ok: false, reason, retryAfterS: retryAfterFor(reason, request.operation, now) })

    if ((this.rate.get(windowKey) ?? 0) >= limits.perWindow) return reject('rate_limited')
    if ((this.rate.get(dayKey) ?? 0) >= limits.perDay) return reject('daily_rate_limited')
    const live = [...this.leases.values()]
    if (live.filter((l) => l.client === request.clientKey).length >= MAX_CONCURRENT_PER_CLIENT) return reject('client_busy')
    if (live.length >= this.config.maxConcurrent) return reject('busy')
    if (this.spentTotal() + request.amountMicroUsd > this.config.totalLimitMicroUsd) return reject('total_budget_exhausted')
    if (this.spentToday(now) + request.amountMicroUsd > this.config.dailyLimitMicroUsd) return reject('daily_budget_exhausted')

    this.rate.set(windowKey, (this.rate.get(windowKey) ?? 0) + 1)
    this.rate.set(dayKey, (this.rate.get(dayKey) ?? 0) + 1)
    this.leases.set(request.leaseId, { expiry: now + LEASE_TTL_MS, amount: request.amountMicroUsd, client: request.clientKey, day })
    const dayCounter = `day:${day}`
    this.counters.set(dayCounter, this.spentToday(now) + request.amountMicroUsd)
    this.counters.set('total', this.spentTotal() + request.amountMicroUsd)

    let dailyWarning = false
    if (this.spentToday(now) >= this.config.dailyWarnMicroUsd && !this.warned.has(day)) {
      this.warned.add(day)
      dailyWarning = true
    }
    const lease: Lease = { id: request.leaseId, amountMicroUsd: request.amountMicroUsd, keys: [dayCounter, 'total', 'leases', 'amounts', request.clientKey] }
    return { ok: true, lease, dailyWarning }
  }

  async settle(lease: Lease, actualMicroUsd: number | null): Promise<SettleResult> {
    this.settleCalls.push({ leaseId: lease.id, actual: actualMicroUsd })
    const stored = this.leases.get(lease.id)
    const adjust = (delta: number) => {
      this.counters.set(lease.keys[0], (this.counters.get(lease.keys[0]) ?? 0) + delta)
      this.counters.set('total', this.spentTotal() + delta)
    }
    if (!stored) {
      if (actualMicroUsd !== null && actualMicroUsd > lease.amountMicroUsd) adjust(actualMicroUsd - lease.amountMicroUsd)
      return 'expired'
    }
    this.leases.delete(lease.id)
    if (actualMicroUsd === null) return 'kept'
    adjust(Math.ceil(actualMicroUsd) - stored.amount)
    return 'settled'
  }
}

/** Installs a fresh memory store into the guard and returns it. */
export async function installMemorySpendStore(config?: SpendConfig): Promise<MemorySpendStore> {
  const { setSpendStoreForTesting } = await import('@/lib/spend/spendGuard')
  const store = new MemorySpendStore(config)
  setSpendStoreForTesting({ store, hashSecret: 'test-secret' })
  return store
}
