/**
 * Shared helpers for component tests that involve photo selection and upload.
 * Files are small synthetic byte arrays, never real photographs, and `fetch` is
 * always a mock, so nothing leaves the test process.
 */

export function syntheticFile(name: string, type = 'image/jpeg', size = 2_048): File {
  return new File([new Uint8Array(size)], name, { type })
}

export interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

export function fakeResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

export interface ObjectUrlMocks {
  create: jest.Mock<string, [Blob]>
  revoke: jest.Mock<void, [string]>
  /** URLs created and not yet revoked. */
  live: () => string[]
}

/** jsdom has no object URLs. Installs counting fakes and returns them. */
export function installObjectUrlMocks(): ObjectUrlMocks {
  const live = new Set<string>()
  let counter = 0
  const create = jest.fn((_blob: Blob) => {
    counter += 1
    const url = `blob:verdict-test/${counter}`
    live.add(url)
    return url
  })
  const revoke = jest.fn((url: string) => {
    live.delete(url)
  })
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: create })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revoke })
  return { create, revoke, live: () => [...live] }
}

export function setNavigatorOnline(online: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online })
}
