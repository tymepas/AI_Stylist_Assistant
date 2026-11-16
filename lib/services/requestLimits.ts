/**
 * Size caps for client-supplied text fields that reach the model prompt.
 *
 * They bound input tokens (and therefore the spend reserved before each call)
 * and stop oversized JSON from reaching schema validation. Real UI values are
 * far below these limits: occasions are under 25 characters and a saved
 * preference profile is about 1.2 KB.
 */

export const MAX_OCCASION_LENGTH = 64
export const MAX_STYLE_PROFILE_BYTES = 2_048
export const MAX_AI_STYLE_PROFILE_BYTES = 8_192

/**
 * UTF-8 byte length without relying on TextEncoder or Buffer, so it works in the
 * browser, Node and jsdom alike. Lone surrogates count as 3 bytes (U+FFFD).
 */
export function utf8ByteLength(value: string): number {
  let bytes = 0
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length && (value.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      bytes += 4
      i += 1
    } else bytes += 3
  }
  return bytes
}
