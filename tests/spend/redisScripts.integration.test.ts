/**
 * Runs the production Lua scripts against a real Redis server.
 * Enabled when REDIS_TEST_URL is set (CI provides a Redis service container);
 * skipped otherwise. Each test uses its own key namespace.
 *
 * Concurrency tests open separate TCP connections so reservations genuinely race.
 *
 * Clock: every request uses the Redis server's own time, read once when the suite
 * starts. The reserve script gives the per-client lease key an absolute expiry
 * (PEXPIREAT) computed from the caller's clock, and Redis judges that expiry
 * against its own clock. A hard-coded date therefore only works until that date
 * passes: after it, Redis deletes the key at once and the per-client cap looks
 * broken. Production passes the real current time, as this suite now does.
 */

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import { createRedisSpendStore, type ReserveRequest } from '@/lib/spend/spendStore'
import { DEFAULT_SPEND_CONFIG, LEASE_TTL_MS, RATE_LIMITS, type SpendConfig } from '@/lib/spend/spendConfig'
import { RespConnection } from '../helpers/respClient'

const url = process.env.REDIS_TEST_URL
const describeRedis = url ? describe : describe.skip

// CI sets REQUIRE_REDIS_TESTS so this suite can never be skipped there by accident.
if (process.env.REQUIRE_REDIS_TESTS === '1' && !url) {
  describe('spend Lua scripts on real Redis', () => {
    it('requires REDIS_TEST_URL in CI', () => { throw new Error('REDIS_TEST_URL is not set') })
  })
}

describeRedis('spend Lua scripts on real Redis', () => {
  const pool: RespConnection[] = []
  /** Key namespaces created by this suite, so they can be removed afterwards. */
  const namespaces: string[] = []
  /** The Redis server's time when the suite started. Fixed for the whole suite so requests share a day and a rate window. */
  let NOW = 0

  const keyPattern = (namespace: string) => `verdict:${namespace}:spend:*`

  beforeAll(async () => {
    for (let i = 0; i < 12; i += 1) pool.push(await RespConnection.open(url!))
    NOW = await pool[0].serverTimeMs()
  })

  afterAll(async () => {
    for (const namespace of namespaces) await pool[0].deleteMatching(keyPattern(namespace))
    for (const connection of pool) connection.close()
  })

  function stores(config: Partial<SpendConfig> = {}) {
    const namespace = `test_${randomUUID().slice(0, 8)}`
    namespaces.push(namespace)
    const full = { ...DEFAULT_SPEND_CONFIG, ...config }
    return pool.map((connection) => createRedisSpendStore(connection.eval, full, namespace))
  }

  const request = (overrides: Partial<ReserveRequest> = {}): ReserveRequest => ({
    operation: 'analysis',
    clientKey: randomUUID().slice(0, 8),
    leaseId: randomUUID(),
    amountMicroUsd: 35_200,
    nowMs: NOW,
    ...overrides,
  })

  async function counter(key: string): Promise<number> {
    return Number((await pool[0].command('GET', key)) ?? 0)
  }

  it('uses the Redis server clock, so lease keys expire in the future and not at once', async () => {
    const serverNow = await pool[0].serverTimeMs()
    // NOW was read from this server moments ago; it can only be slightly behind.
    expect(NOW).toBeGreaterThan(0)
    expect(serverNow - NOW).toBeGreaterThanOrEqual(0)
    expect(serverNow - NOW).toBeLessThan(60_000)

    const [store] = stores()
    const result = await store.reserve(request({ clientKey: 'clock-client' }))
    if (!result.ok) throw new Error('expected reservation')
    const clientLeasesKey = result.lease.keys[4]
    // The key must still exist with time to live: this is what the per-client cap depends on.
    expect(await pool[0].command('ZCARD', clientLeasesKey)).toBe(1)
    const ttl = Number(await pool[0].command('PTTL', clientLeasesKey))
    expect(ttl).toBeGreaterThan(LEASE_TTL_MS)
    expect(ttl).toBeLessThanOrEqual(LEASE_TTL_MS + 60_000)
  })

  it('reserves, then settles to the actual cost', async () => {
    const [store] = stores()
    const result = await store.reserve(request())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [dayKey, totalKey] = result.lease.keys
    expect(await counter(dayKey)).toBe(35_200)
    expect(await counter(totalKey)).toBe(35_200)

    await expect(store.settle(result.lease, 12_345)).resolves.toBe('settled')
    expect(await counter(dayKey)).toBe(12_345)
    expect(await counter(totalKey)).toBe(12_345)
    await expect(store.settle(result.lease, 12_345)).resolves.toBe('expired') // idempotent: no double adjustment
    expect(await counter(totalKey)).toBe(12_345)
  })

  it('keeps the full reservation for an unknown outcome', async () => {
    const [store] = stores()
    const result = await store.reserve(request())
    if (!result.ok) throw new Error('expected reservation')
    await expect(store.settle(result.lease, null)).resolves.toBe('kept')
    expect(await counter(result.lease.keys[1])).toBe(35_200)
  })

  it('never lets concurrent reservations exceed the daily budget', async () => {
    const amount = 35_200
    const all = stores({ dailyLimitMicroUsd: amount * 5, maxConcurrent: 20 })
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => all[i % all.length].reserve(request({ amountMicroUsd: amount }))))
    const accepted = results.filter((r) => r.ok)
    expect(accepted).toHaveLength(5)
    expect(results.filter((r) => !r.ok && r.reason === 'daily_budget_exhausted')).toHaveLength(35)
    const first = accepted[0]
    if (!first.ok) return
    expect(await counter(first.lease.keys[0])).toBe(amount * 5)
  })

  it('never lets concurrent reservations exceed the cumulative budget', async () => {
    const amount = 35_200
    const all = stores({ totalLimitMicroUsd: amount * 3, dailyLimitMicroUsd: amount * 3, maxConcurrent: 20 })
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => all[i % all.length].reserve(request({ amountMicroUsd: amount }))))
    expect(results.filter((r) => r.ok)).toHaveLength(3)
    expect(results.filter((r) => !r.ok && r.reason === 'total_budget_exhausted')).toHaveLength(27)
  })

  it('caps concurrent leases globally and per client', async () => {
    const all = stores({ maxConcurrent: 3 })
    const globalResults = await Promise.all(Array.from({ length: 12 }, (_, i) => all[i].reserve(request({ amountMicroUsd: 10 }))))
    expect(globalResults.filter((r) => r.ok)).toHaveLength(3)
    expect(globalResults.filter((r) => !r.ok && r.reason === 'busy')).toHaveLength(9)

    const perClient = stores({ maxConcurrent: 10 })
    const sameClient = await Promise.all([0, 1, 2].map((i) => perClient[i].reserve(request({ clientKey: 'one-client', amountMicroUsd: 10 }))))
    expect(sameClient.filter((r) => r.ok)).toHaveLength(1)
    expect(sameClient.filter((r) => !r.ok && r.reason === 'client_busy')).toHaveLength(2)

    // The cap still holds for a later, sequential request while the first lease is live.
    const fourth = await perClient[3].reserve(request({ clientKey: 'one-client', amountMicroUsd: 10 }))
    expect(fourth).toMatchObject({ ok: false, reason: 'client_busy' })
  })

  it('sweeps expired leases without refunding them', async () => {
    const [store] = stores({ maxConcurrent: 1 })
    const first = await store.reserve(request())
    if (!first.ok) throw new Error('expected reservation')
    expect((await store.reserve(request())).ok).toBe(false) // busy while the lease is live

    const later = await store.reserve(request({ nowMs: NOW + LEASE_TTL_MS + 1 }))
    expect(later.ok).toBe(true) // expired lease no longer counts toward concurrency
    expect(await counter(first.lease.keys[1])).toBe(35_200 * 2) // but its reservation stays charged

    await expect(store.settle(first.lease, 1_000)).resolves.toBe('expired') // late settlement cannot refund
    expect(await counter(first.lease.keys[1])).toBe(35_200 * 2)
    await expect(store.settle(first.lease, 50_000)).resolves.toBe('expired') // but an overrun is still added
    expect(await counter(first.lease.keys[1])).toBe(35_200 * 2 + (50_000 - 35_200))
  })

  it('rate limits per client and operation within a window', async () => {
    const [store] = stores({ maxConcurrent: 20 })
    const clientKey = 'rate-client'
    const limit = RATE_LIMITS.profile.perWindow
    for (let i = 0; i < limit; i += 1) {
      const result = await store.reserve(request({ operation: 'profile', clientKey, amountMicroUsd: 1 }))
      if (!result.ok) throw new Error(`unexpected rejection ${result.reason}`)
      await store.settle(result.lease, 1)
    }
    const limited = await store.reserve(request({ operation: 'profile', clientKey, amountMicroUsd: 1 }))
    expect(limited).toMatchObject({ ok: false, reason: 'rate_limited' })
    expect((await store.reserve(request({ operation: 'analysis', clientKey, amountMicroUsd: 1 }))).ok).toBe(true) // separate operation
  })

  it('raises the daily warning exactly once', async () => {
    const [store] = stores({ dailyWarnMicroUsd: 50_000, maxConcurrent: 20 })
    const warnings: boolean[] = []
    for (let i = 0; i < 4; i += 1) {
      const result = await store.reserve(request())
      warnings.push(result.ok && result.dailyWarning)
    }
    expect(warnings).toEqual([false, true, false, false])
  })

  it('can remove every key it created, leaving nothing behind for other runs', async () => {
    const [store] = stores()
    const result = await store.reserve(request())
    if (!result.ok) throw new Error('expected reservation')
    expect(namespaces.length).toBeGreaterThan(1)

    let removed = 0
    for (const namespace of namespaces) removed += await pool[0].deleteMatching(keyPattern(namespace))
    expect(removed).toBeGreaterThan(0)

    // A second full scan finds nothing left to delete.
    for (const namespace of namespaces) expect(await pool[0].deleteMatching(keyPattern(namespace))).toBe(0)
  })
})
