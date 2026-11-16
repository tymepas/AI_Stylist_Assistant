/**
 * Reproducible identifiers for the prompt that is actually sent to the model.
 *
 * A prompt version is a short SHA-256 fingerprint of the prompt text, computed
 * at runtime from the same strings and the same builder functions that produce
 * the request. It therefore cannot drift from what is sent: editing the system
 * prompt file or any fixed instruction line changes the version automatically.
 *
 * User-specific values (the occasion, profile contents, images) are replaced by
 * fixed placeholders before hashing, so the version identifies the prompt
 * template and never depends on, or reveals, anything about a user.
 */

import { createHash } from 'node:crypto'

const FINGERPRINT_LENGTH = 12

/**
 * Line endings are normalised before hashing, so a Windows checkout (CRLF) and
 * the Linux deployment (LF) report the same version for the same committed text.
 */
function normalise(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

/** Fingerprint of an ordered list of text parts. Each part is length-prefixed, so boundaries are unambiguous. */
export function fingerprint(parts: readonly string[]): string {
  const hash = createHash('sha256')
  for (const part of parts) {
    const text = normalise(part)
    hash.update(`${Buffer.byteLength(text, 'utf8')}:`)
    hash.update(text, 'utf8')
  }
  return hash.digest('hex').slice(0, FINGERPRINT_LENGTH)
}

/** Stands in for an image data URL when a request is built only to be fingerprinted. */
export const IMAGE_PLACEHOLDER = '<image>'
