/**
 * Guards the clock used by the Redis integration suite.
 *
 * That suite runs only where a real Redis is available (CI), so a mistake in it
 * cannot be seen locally. It once used a hard-coded date; when that date passed,
 * Redis treated every per-client lease key as already expired and the suite
 * started failing on every run. These checks run everywhere, with no Redis.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { LEASE_TTL_MS } from '@/lib/spend/spendConfig'
import { timeReplyToMs } from '../helpers/respClient'

const suite = readFileSync(path.join(process.cwd(), 'tests', 'spend', 'redisScripts.integration.test.ts'), 'utf8')
/** The suite's code without comments, so explanatory text cannot trip the checks. */
const code = suite.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('Redis integration suite clock', () => {
  it('contains no hard-coded date or timestamp', () => {
    expect(code).not.toMatch(/Date\.UTC\s*\(/)
    expect(code).not.toMatch(/new Date\s*\(\s*['"`\d]/)
    expect(code).not.toMatch(/Date\.parse\s*\(/)
    // No literal that looks like a Unix time in seconds or milliseconds.
    expect(code).not.toMatch(/\b1[5-9]\d{8}(\d{3})?\b/)
  })

  it('reads its clock from the Redis server and from nowhere else', () => {
    expect(code).toMatch(/NOW = await pool\[0\]\.serverTimeMs\(\)/)
    expect(code).not.toMatch(/Date\.now\s*\(/)
    // Every assignment to NOW: the declaration and the single read from the server.
    expect(code.match(/\bNOW\s*=(?!=)/g)).toHaveLength(2)
  })

  it('still asserts that one client cannot hold more than one lease', () => {
    expect(code).toContain("expect(sameClient.filter((r) => r.ok)).toHaveLength(1)")
    expect(code).toContain("expect(sameClient.filter((r) => !r.ok && r.reason === 'client_busy')).toHaveLength(2)")
  })

  it('removes the keys it creates', () => {
    expect(code).toMatch(/afterAll\(async \(\) => \{[\s\S]*deleteMatching\(keyPattern\(namespace\)\)/)
  })
})

describe('why the clock must not be fixed', () => {
  // Mirrors the reserve script: the per-client key expires at now + lease TTL + 60 s (absolute).
  const keyExpiry = (callerNowMs: number) => callerNowMs + LEASE_TTL_MS + 60_000
  const remainingAtServer = (callerNowMs: number, serverNowMs: number) => keyExpiry(callerNowMs) - serverNowMs

  it('a clock taken from the server leaves time to live, whatever the date', () => {
    for (const serverNow of [Date.UTC(2026, 10, 16, 12, 0, 0), Date.UTC(2026, 10, 16, 17, 42, 3), Date.UTC(2027, 0, 1, 0, 0, 0), Date.UTC(2031, 5, 30, 23, 59, 59)]) {
      // Even if the suite reads the time and then runs for a minute, the key is still alive.
      expect(remainingAtServer(serverNow, serverNow)).toBe(LEASE_TTL_MS + 60_000)
      expect(remainingAtServer(serverNow, serverNow + 60_000)).toBeGreaterThan(0)
    }
  })

  it('the old fixed clock stopped working 150 seconds after its own timestamp', () => {
    const fixed = Date.UTC(2026, 10, 16, 12, 0, 0)
    expect(remainingAtServer(fixed, Date.UTC(2026, 10, 16, 6, 43, 39))).toBeGreaterThan(0) // the last green CI run
    expect(remainingAtServer(fixed, Date.UTC(2026, 10, 16, 12, 2, 30))).toBe(0)
    expect(remainingAtServer(fixed, Date.UTC(2026, 10, 16, 17, 42, 3))).toBeLessThan(0) // the first failing CI run
  })
})

describe('timeReplyToMs', () => {
  it('converts a TIME reply of seconds and microseconds to milliseconds', () => {
    expect(timeReplyToMs(['1794849723', '456789'])).toBe(1_794_849_723_456)
    expect(timeReplyToMs(['1794849723', '0'])).toBe(1_794_849_723_000)
    expect(timeReplyToMs(['1794849723', '999999'])).toBe(1_794_849_723_999)
  })

  it('rejects anything that is not a TIME reply, instead of guessing a clock', () => {
    for (const reply of [null, 'OK', [], ['1794849723'], ['x', '1'], ['1794849723', '-1'], ['1794849723', '1000000'], ['0', '0'], ['1.5', '0'], [1, 2, 3]]) {
      expect(() => timeReplyToMs(reply)).toThrow('Unexpected reply to TIME')
    }
  })
})
