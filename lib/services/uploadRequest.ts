/**
 * Client-side submission of a multipart upload to the Verdict API.
 *
 * One request per call: there are no automatic retries, because every attempt
 * that reaches the model is billable and rate limited. Failures are returned as
 * values with a title and message that are safe to show to the user.
 */

/** Above the route's 60 s maxDuration, so the server normally answers first. */
export const UPLOAD_TIMEOUT_MS = 70_000

const MAX_SERVER_MESSAGE_LENGTH = 300

export type UploadFailureKind =
  | 'offline'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'invalid_request'
  | 'payload_too_large'
  | 'rate_limited'
  | 'unavailable'
  | 'server_error'
  | 'invalid_response'

export interface UploadFailure {
  ok: false
  kind: UploadFailureKind
  /** HTTP status, when a response was received. */
  status?: number
  /** The API's own error code (for example `missing_image`), when present. */
  errorCode?: string
  title: string
  message: string
}

export interface UploadSuccess {
  ok: true
  data: unknown
}

export type UploadResult = UploadSuccess | UploadFailure

interface ErrorBody {
  error?: unknown
  message?: unknown
}

function failure(kind: UploadFailureKind, title: string, message: string, extra: Partial<UploadFailure> = {}): UploadFailure {
  return { ok: false, kind, title, message, ...extra }
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

/** A message from our own API, or null when it is missing or not plain short text. */
function serverMessage(body: ErrorBody): string | null {
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  return message && message.length <= MAX_SERVER_MESSAGE_LENGTH ? message : null
}

function failureForStatus(status: number, body: ErrorBody): UploadFailure {
  const errorCode = typeof body.error === 'string' ? body.error : undefined
  const message = serverMessage(body)
  const extra = { status, errorCode }

  if (status === 400) {
    return failure(
      'invalid_request',
      errorCode === 'missing_image' ? 'Missing Information' : 'Invalid Upload',
      message ?? 'Something was wrong with the upload. Please check your photos and try again.',
      extra
    )
  }
  if (status === 413) {
    // Returned by the hosting platform, not by our API, so its body is never shown.
    return failure('payload_too_large', 'Photos Too Large', 'Your photos are too large to send. Please choose smaller photos and try again.', extra)
  }
  if (status === 429) {
    return failure('rate_limited', 'Please Wait', message ?? 'Too many requests right now. Please wait a moment and try again.', extra)
  }
  if (status === 503) {
    return failure('unavailable', 'Service Unavailable', message ?? 'The analysis service is temporarily unavailable. Please try again later.', extra)
  }
  if (status === 504 || status === 408) {
    return failure('timeout', 'Taking Too Long', message ?? 'The analysis took too long. Please try again.', extra)
  }
  return failure('server_error', 'Something Went Wrong', message ?? 'Something went wrong on our side. Please try again.', extra)
}

/**
 * POSTs a FormData body once and maps the outcome to a result value.
 * Never throws and never retries.
 */
export async function postFormData(
  url: string,
  formData: FormData,
  options: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<UploadResult> {
  if (isOffline()) {
    return failure('offline', 'You Are Offline', 'You appear to be offline. Check your connection and try again.')
  }

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs ?? UPLOAD_TIMEOUT_MS)
  const onExternalAbort = () => controller.abort()
  if (options.signal?.aborted) controller.abort()
  else options.signal?.addEventListener('abort', onExternalAbort, { once: true })

  try {
    const response = await fetch(url, { method: 'POST', body: formData, signal: controller.signal })

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as ErrorBody
      return failureForStatus(response.status, body && typeof body === 'object' ? body : {})
    }

    try {
      return { ok: true, data: await response.json() }
    } catch (error) {
      if (controller.signal.aborted) throw error
      return failure('invalid_response', 'Something Went Wrong', 'We received an unexpected response. Please try again.', { status: response.status })
    }
  } catch {
    if (timedOut) {
      return failure('timeout', 'Taking Too Long', 'This is taking longer than expected, so the request was stopped. Please try again in a moment.')
    }
    if (controller.signal.aborted) {
      return failure('cancelled', 'Cancelled', 'The request was cancelled.')
    }
    if (isOffline()) {
      return failure('offline', 'You Are Offline', 'Your connection dropped before the upload finished. Check your connection and try again.')
    }
    return failure('network', 'Connection Problem', 'We could not reach the analysis service. Please check your connection and try again.')
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onExternalAbort)
  }
}
