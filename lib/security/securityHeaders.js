/**
 * Security response headers applied to every route by next.config.js.
 *
 * CommonJS on purpose: next.config.js loads this file directly.
 *
 * Not set here:
 * - Strict-Transport-Security: Vercel already sends it on every deployment, and
 *   it must not be sent over plain http in local development.
 * - Access-Control-*: the API decides CORS per request in lib/security/originPolicy.ts.
 * - script-src / style-src / img-src / connect-src: the app loads Google Fonts
 *   through a CSS @import, images from images.unsplash.com and Next.js inline
 *   bootstrap scripts, and Vercel previews inject their toolbar. A resource
 *   policy needs nonces and a check on a real preview deployment before it is
 *   enforced, so it is left for a separate change.
 */

/** Directives that restrict framing, <base>, form targets and plugins without affecting resource loading. */
const CONTENT_SECURITY_POLICY = [
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ')

/**
 * `camera=(self)` rather than `camera=()`: photo capture uses native file inputs,
 * which are not governed by this policy, but the stricter value would rule out
 * any later in-page camera use on our own origin.
 */
const PERMISSIONS_POLICY = [
  'camera=(self)',
  'microphone=()',
  'geolocation=()',
  'payment=()',
  'usb=()',
  'accelerometer=()',
  'gyroscope=()',
  'magnetometer=()',
].join(', ')

const SECURITY_HEADERS = [
  // Clickjacking: the app is never meant to be embedded in another page.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: PERMISSIONS_POLICY },
]

module.exports = { SECURITY_HEADERS, CONTENT_SECURITY_POLICY, PERMISSIONS_POLICY }
