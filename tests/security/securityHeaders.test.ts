/**
 * Security response headers configured in next.config.js for every route.
 */

import { CONTENT_SECURITY_POLICY, PERMISSIONS_POLICY, SECURITY_HEADERS } from '@/lib/security/securityHeaders'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nextConfig = require('../../next.config.js') as {
  poweredByHeader?: boolean
  headers: () => Promise<Array<{ source: string; headers: Array<{ key: string; value: string }> }>>
}

async function configuredHeaders(): Promise<Map<string, string>> {
  const rules = await nextConfig.headers()
  expect(rules).toHaveLength(1)
  expect(rules[0].source).toBe('/(.*)')
  return new Map(rules[0].headers.map(({ key, value }) => [key.toLowerCase(), value]))
}

describe('security headers', () => {
  it('applies the shared header list to every route', async () => {
    const rules = await nextConfig.headers()
    expect(rules[0].headers).toBe(SECURITY_HEADERS)
  })

  it('forbids framing by any site, with both the legacy header and CSP', async () => {
    const headers = await configuredHeaders()
    expect(headers.get('x-frame-options')).toBe('DENY')
    expect(headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(headers.get('content-security-policy')).not.toMatch(/frame-ancestors[^;]*\*/)
  })

  it('restricts <base>, form targets and plugins', () => {
    expect(CONTENT_SECURITY_POLICY).toBe("frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'")
  })

  it('does not yet restrict script, style, image or connection sources', () => {
    // These need nonces and a check on a real preview deployment first.
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/default-src|script-src|style-src|img-src|connect-src|font-src/)
  })

  it('sets nosniff, a referrer policy and a permissions policy', async () => {
    const headers = await configuredHeaders()
    expect(headers.get('x-content-type-options')).toBe('nosniff')
    expect(headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
    expect(headers.get('permissions-policy')).toBe(PERMISSIONS_POLICY)
  })

  it('keeps the camera available to our own origin and turns unused sensors off', () => {
    expect(PERMISSIONS_POLICY).toContain('camera=(self)')
    for (const feature of ['microphone', 'geolocation', 'payment', 'usb']) expect(PERMISSIONS_POLICY).toContain(`${feature}=()`)
  })

  it('sets no CORS headers globally', async () => {
    const headers = await configuredHeaders()
    expect([...headers.keys()].filter((key) => key.startsWith('access-control'))).toEqual([])
  })

  it('leaves HSTS to the hosting platform', async () => {
    const headers = await configuredHeaders()
    expect(headers.has('strict-transport-security')).toBe(false)
  })

  it('does not advertise the framework', () => {
    expect(nextConfig.poweredByHeader).toBe(false)
  })

  it('contains no template values', () => {
    const serialised = JSON.stringify(SECURITY_HEADERS)
    expect(serialised).not.toContain('ALLOWALL')
    expect(serialised).not.toContain('*')
  })
})
