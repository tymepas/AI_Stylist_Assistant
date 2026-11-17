/**
 * Access to the browser's localStorage that never throws.
 *
 * localStorage can be unavailable or can refuse a write: private browsing in
 * some browsers, storage blocked by a setting or an embedding page, or a full
 * quota. Reading it then throws. An uncaught error inside a React effect takes
 * the whole page down, so every access goes through here.
 *
 * Nothing here logs: a stored value can be personal.
 */

export function readStorage(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

/** False when the value could not be stored. The caller decides whether to tell the user. */
export function writeStorage(key: string, value: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    window.localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

/** False when the key could not be removed. */
export function removeStorage(key: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    window.localStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}
