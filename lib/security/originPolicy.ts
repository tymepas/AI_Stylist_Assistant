/**
 * Cross-origin policy for the API routes.
 *
 * The Verdict frontend calls the API from its own origin, so by default no
 * cross-origin access is granted at all. Two things are enforced:
 *
 * 1. CORS response headers are sent only to origins listed exactly in
 *    CORS_ORIGINS. There is never a wildcard and never
 *    Access-Control-Allow-Credentials: the API uses no cookies or sessions.
 *
 * 2. State-changing requests that carry an Origin header from anywhere else are
 *    refused before any work is done. CORS alone does not do this: a multipart
 *    POST is a "simple request", so a browser sends it (and the model call would
 *    be billed) even when the page is not allowed to read the response.
 *
 * Requests without an Origin header (curl, server-to-server, same-origin GET)
 * are not affected here; rate limits and the spend guard still apply to them.
 */

export interface OriginDecision {
  /** False only for a browser request from an origin that is neither ours nor allowlisted. */
  allowed: boolean
  /** The allowlisted cross-origin caller that should receive CORS headers, or null. */
  corsOrigin: string | null
}

/** Methods the API implements. Anything else is answered by the framework with 405. */
export const ALLOWED_METHODS = 'GET, POST, OPTIONS'
/** The only non-safelisted request header the API reads. */
export const ALLOWED_REQUEST_HEADERS = 'Content-Type'
const PREFLIGHT_MAX_AGE_S = '600'

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    // An origin has no path, query, fragment or credentials.
    if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash || url.username || url.password) return null
    return url.origin
  } catch {
    return null
  }
}

/**
 * Parses CORS_ORIGINS: a comma-separated list of exact origins such as
 * `https://app.example.com`. Wildcards and anything that is not a plain http(s)
 * origin are ignored, so a leftover `*` grants nothing.
 */
export function parseAllowedOrigins(raw: string | undefined | null): string[] {
  if (!raw) return []
  const origins: string[] = []
  for (const entry of raw.split(',')) {
    if (!entry.trim() || entry.includes('*')) continue
    const origin = normalizeOrigin(entry)
    if (origin && !origins.includes(origin)) origins.push(origin)
  }
  return origins
}

/**
 * The host the client addressed. Vercel and other proxies put it in
 * X-Forwarded-Host. A page on another site cannot set either header, so
 * comparing against them is a sound same-origin test for browser requests.
 */
function requestHost(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  const host = forwarded || headers.get('host')?.trim()
  return host ? host.toLowerCase() : null
}

export function evaluateOrigin(headers: Headers, env: Record<string, string | undefined> = process.env): OriginDecision {
  const rawOrigin = headers.get('origin')
  if (rawOrigin === null || rawOrigin.trim() === '') return { allowed: true, corsOrigin: null }

  // "null" is sent by sandboxed frames, file:// pages and some redirects.
  const origin = normalizeOrigin(rawOrigin)
  if (!origin) return { allowed: false, corsOrigin: null }

  const host = requestHost(headers)
  if (host && new URL(origin).host.toLowerCase() === host) return { allowed: true, corsOrigin: null }

  if (parseAllowedOrigins(env.CORS_ORIGINS).includes(origin)) return { allowed: true, corsOrigin: origin }
  return { allowed: false, corsOrigin: null }
}

/** True for methods that can start work or spend money. */
export function isStateChanging(method: string): boolean {
  const upper = method.toUpperCase()
  return upper !== 'GET' && upper !== 'HEAD' && upper !== 'OPTIONS'
}

/** Adds CORS headers for an allowlisted cross-origin caller; otherwise only `Vary`. */
export function applyCorsHeaders(headers: Headers, decision: OriginDecision, options: { preflight?: boolean } = {}): void {
  // Responses differ by Origin, so shared caches must key on it.
  headers.append('Vary', 'Origin')
  if (!decision.corsOrigin) return
  headers.set('Access-Control-Allow-Origin', decision.corsOrigin)
  if (options.preflight) {
    headers.set('Access-Control-Allow-Methods', ALLOWED_METHODS)
    headers.set('Access-Control-Allow-Headers', ALLOWED_REQUEST_HEADERS)
    headers.set('Access-Control-Max-Age', PREFLIGHT_MAX_AGE_S)
  }
}
