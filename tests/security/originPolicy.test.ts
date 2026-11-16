/**
 * Origin policy: which browser origins may call the API and which receive CORS headers.
 */

import {
  ALLOWED_METHODS,
  ALLOWED_REQUEST_HEADERS,
  applyCorsHeaders,
  evaluateOrigin,
  isStateChanging,
  parseAllowedOrigins,
} from '@/lib/security/originPolicy'

function headers(values: Record<string, string>): Headers {
  return new Headers(values)
}

describe('parseAllowedOrigins', () => {
  it('returns nothing when unset or empty', () => {
    expect(parseAllowedOrigins(undefined)).toEqual([])
    expect(parseAllowedOrigins('')).toEqual([])
    expect(parseAllowedOrigins(' , ')).toEqual([])
  })

  it('ignores wildcards, so a leftover "*" grants nothing', () => {
    expect(parseAllowedOrigins('*')).toEqual([])
    expect(parseAllowedOrigins('https://*.example.com')).toEqual([])
    expect(parseAllowedOrigins('*, https://app.example.com')).toEqual(['https://app.example.com'])
  })

  it('accepts exact http(s) origins, normalised and de-duplicated', () => {
    expect(parseAllowedOrigins('https://App.Example.com/, https://app.example.com , http://localhost:3000')).toEqual([
      'https://app.example.com',
      'http://localhost:3000',
    ])
  })

  it('ignores entries that are not plain origins', () => {
    expect(parseAllowedOrigins('app.example.com')).toEqual([])
    expect(parseAllowedOrigins('https://app.example.com/path')).toEqual([])
    expect(parseAllowedOrigins('https://app.example.com?x=1')).toEqual([])
    expect(parseAllowedOrigins('https://user:pass@app.example.com')).toEqual([])
    expect(parseAllowedOrigins('ftp://app.example.com')).toEqual([])
    expect(parseAllowedOrigins('javascript:alert(1)')).toEqual([])
    expect(parseAllowedOrigins('null')).toEqual([])
  })
})

describe('evaluateOrigin', () => {
  const env = { CORS_ORIGINS: 'https://partner.example.com' }

  it('allows requests without an Origin header and grants no CORS', () => {
    expect(evaluateOrigin(headers({ host: 'verdict.example.com' }), env)).toEqual({ allowed: true, corsOrigin: null })
    expect(evaluateOrigin(headers({ host: 'verdict.example.com', origin: '' }), env)).toEqual({ allowed: true, corsOrigin: null })
  })

  it('allows the same origin without CORS headers', () => {
    expect(evaluateOrigin(headers({ host: 'verdict.example.com', origin: 'https://verdict.example.com' }), env)).toEqual({ allowed: true, corsOrigin: null })
  })

  it('allows local development on any local host and port', () => {
    expect(evaluateOrigin(headers({ host: 'localhost:3000', origin: 'http://localhost:3000' }), {})).toEqual({ allowed: true, corsOrigin: null })
    expect(evaluateOrigin(headers({ host: '192.168.1.20:3000', origin: 'http://192.168.1.20:3000' }), {})).toEqual({ allowed: true, corsOrigin: null })
  })

  it('uses the forwarded host on Vercel, so production and every preview are same-origin with no configuration', () => {
    const production = headers({ host: 'internal.vercel', 'x-forwarded-host': 'verdictai-fawn.vercel.app', origin: 'https://verdictai-fawn.vercel.app' })
    expect(evaluateOrigin(production, {})).toEqual({ allowed: true, corsOrigin: null })

    const preview = headers({ 'x-forwarded-host': 'verdict-git-feature-team.vercel.app', origin: 'https://verdict-git-feature-team.vercel.app' })
    expect(evaluateOrigin(preview, {})).toEqual({ allowed: true, corsOrigin: null })
  })

  it('compares hosts case-insensitively and includes the port', () => {
    expect(evaluateOrigin(headers({ host: 'Verdict.Example.com', origin: 'https://verdict.example.com' }), {}).allowed).toBe(true)
    expect(evaluateOrigin(headers({ host: 'localhost:3000', origin: 'http://localhost:4000' }), {}).allowed).toBe(false)
  })

  it('rejects another site', () => {
    expect(evaluateOrigin(headers({ host: 'verdict.example.com', origin: 'https://evil.example' }), env)).toEqual({ allowed: false, corsOrigin: null })
  })

  it('rejects look-alike hosts', () => {
    for (const origin of ['https://verdict.example.com.evil.example', 'https://evilverdict.example.com', 'https://sub.verdict.example.com']) {
      expect(evaluateOrigin(headers({ host: 'verdict.example.com', origin }), env).allowed).toBe(false)
    }
  })

  it('rejects the opaque "null" origin and malformed values', () => {
    expect(evaluateOrigin(headers({ host: 'verdict.example.com', origin: 'null' }), env).allowed).toBe(false)
    expect(evaluateOrigin(headers({ host: 'verdict.example.com', origin: 'not a url' }), env).allowed).toBe(false)
    expect(evaluateOrigin(headers({ host: 'verdict.example.com', origin: 'file:///etc/passwd' }), env).allowed).toBe(false)
  })

  it('allows an exactly allowlisted origin and names it for CORS', () => {
    expect(evaluateOrigin(headers({ host: 'verdict.example.com', origin: 'https://partner.example.com' }), env)).toEqual({ allowed: true, corsOrigin: 'https://partner.example.com' })
  })

  it('does not treat a wildcard CORS_ORIGINS as permission', () => {
    expect(evaluateOrigin(headers({ host: 'verdict.example.com', origin: 'https://evil.example' }), { CORS_ORIGINS: '*' })).toEqual({ allowed: false, corsOrigin: null })
  })

  it('rejects a cross-origin request when no host is known', () => {
    expect(evaluateOrigin(headers({ origin: 'https://evil.example' }), {}).allowed).toBe(false)
  })
})

describe('isStateChanging', () => {
  it('is false for safe methods and true for everything else', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'get']) expect(isStateChanging(method)).toBe(false)
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'post']) expect(isStateChanging(method)).toBe(true)
  })
})

describe('applyCorsHeaders', () => {
  it('sends only Vary when no cross-origin access is granted', () => {
    const target = new Headers()
    applyCorsHeaders(target, { allowed: true, corsOrigin: null }, { preflight: true })
    expect(target.get('vary')).toBe('Origin')
    expect([...target.keys()].filter((key) => key.startsWith('access-control'))).toEqual([])
  })

  it('echoes the allowlisted origin, never a wildcard and never credentials', () => {
    const target = new Headers()
    applyCorsHeaders(target, { allowed: true, corsOrigin: 'https://partner.example.com' })
    expect(target.get('access-control-allow-origin')).toBe('https://partner.example.com')
    expect(target.has('access-control-allow-credentials')).toBe(false)
    expect(target.has('access-control-allow-methods')).toBe(false)
  })

  it('adds the minimum methods and headers on a preflight', () => {
    const target = new Headers()
    applyCorsHeaders(target, { allowed: true, corsOrigin: 'https://partner.example.com' }, { preflight: true })
    expect(target.get('access-control-allow-methods')).toBe(ALLOWED_METHODS)
    expect(target.get('access-control-allow-headers')).toBe(ALLOWED_REQUEST_HEADERS)
    expect(ALLOWED_METHODS).toBe('GET, POST, OPTIONS')
    expect(ALLOWED_REQUEST_HEADERS).toBe('Content-Type')
    expect(Number(target.get('access-control-max-age'))).toBeGreaterThan(0)
  })

  it('keeps an existing Vary value', () => {
    const target = new Headers({ Vary: 'Accept-Encoding' })
    applyCorsHeaders(target, { allowed: true, corsOrigin: null })
    expect(target.get('vary')).toBe('Accept-Encoding, Origin')
  })
})
