/**
 * Minimal Upstash Redis REST transport for EVAL. No SDK dependency.
 *
 * Accepts the standard Upstash variables or the names injected by Vercel's
 * Upstash integration. The URL must be an https *.upstash.io endpoint, so a
 * misconfiguration cannot send the token anywhere else.
 */

import { SpendStoreError, type RedisEval } from './spendStore'

export interface UpstashConfig {
  url: string
  token: string
}

export type UpstashConfigResult =
  | { status: 'configured'; config: UpstashConfig }
  | { status: 'missing' }
  | { status: 'invalid' }

export function upstashConfigFromEnv(env: Record<string, string | undefined> = process.env): UpstashConfigResult {
  const url = (env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL)?.trim()
  const token = (env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN)?.trim()
  if (!url && !token) return { status: 'missing' }
  if (!url || !token) return { status: 'invalid' }
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.upstash.io')) return { status: 'invalid' }
    return { status: 'configured', config: { url: parsed.origin, token } }
  } catch {
    return { status: 'invalid' }
  }
}

export const UPSTASH_TIMEOUT_MS = 2_000

export function createUpstashEval(config: UpstashConfig, timeoutMs = UPSTASH_TIMEOUT_MS): RedisEval {
  return async (script, keys, args) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(config.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(['EVAL', script, String(keys.length), ...keys, ...args]),
        signal: controller.signal,
        cache: 'no-store',
      })
      if (!response.ok) throw new SpendStoreError(`http_${response.status}`)
      const body = (await response.json().catch(() => null)) as { result?: unknown; error?: unknown } | null
      if (!body || body.error !== undefined || !('result' in body)) throw new SpendStoreError('script_error')
      return body.result
    } catch (error) {
      if (error instanceof SpendStoreError) throw error
      throw new SpendStoreError(error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'network')
    } finally {
      clearTimeout(timer)
    }
  }
}
