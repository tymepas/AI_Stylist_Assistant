/**
 * Derives a rate-limit key for the requesting client.
 *
 * On Vercel the platform overwrites X-Forwarded-For and sets x-vercel-forwarded-for,
 * so those values are trusted ONLY when running on Vercel (process.env.VERCEL === '1').
 * Anywhere else client-supplied forwarding headers are ignored and every request
 * shares one bucket. Raw addresses are never stored: the key is an HMAC.
 */

import { createHmac } from 'node:crypto'
import { isIP } from 'node:net'

function expandIPv6(address: string): string[] | null {
  const [head, tail, ...rest] = address.split('::')
  if (rest.length > 0) return null
  const headParts = head ? head.split(':') : []
  const tailParts = tail !== undefined ? (tail ? tail.split(':') : []) : []
  const missing = 8 - headParts.length - tailParts.length
  if (tail === undefined && headParts.length !== 8) return null
  const parts = tail === undefined ? headParts : [...headParts, ...Array(Math.max(missing, 0)).fill('0'), ...tailParts]
  return parts.length === 8 ? parts.map((part) => part.toLowerCase().padStart(4, '0')) : null
}

/**
 * IPv4 addresses are used whole. IPv6 addresses are reduced to their /64 prefix,
 * because a single subscriber usually controls a whole /64.
 */
export function normalizeClientAddress(raw: string): string | null {
  let address = raw.trim()
  if (address.startsWith('[') && address.includes(']')) address = address.slice(1, address.indexOf(']'))
  const zone = address.indexOf('%')
  if (zone !== -1) address = address.slice(0, zone)

  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address)
  if (mapped) address = mapped[1]

  const version = isIP(address)
  if (version === 4) return address
  if (version === 6) {
    const parts = expandIPv6(address)
    return parts ? `${parts.slice(0, 4).join(':')}::/64` : null
  }
  return null
}

export function clientAddressFromHeaders(headers: Headers, env: Record<string, string | undefined> = process.env): string {
  if (env.VERCEL !== '1') return 'local'
  const forwarded = headers.get('x-vercel-forwarded-for') ?? headers.get('x-forwarded-for')
  const first = forwarded?.split(',')[0]
  return (first && normalizeClientAddress(first)) || 'unknown'
}

/** Stable, non-reversible key for an address. */
export function clientKey(address: string, secret: string): string {
  return createHmac('sha256', secret).update(address).digest('hex').slice(0, 32)
}
