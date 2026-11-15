/**
 * Privacy-safe structured logging for server code.
 *
 * Every log line is a single JSON object containing an event name and a fixed
 * allowlist of diagnostic fields. Unknown fields are dropped, strings are
 * truncated and scrubbed of secret-like values, and model names that look like
 * credentials are redacted.
 *
 * Never pass images, prompts, model output text, request bodies, error messages
 * or user profile data to this logger. Log categories, counts and identifiers.
 */

import { randomUUID } from 'node:crypto'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type ConfigIssue = 'missing_api_key' | 'missing_model' | 'missing_api_key_and_model' | 'prompt_unreadable'

export interface SafeLogFields {
  request_id?: string
  endpoint?: string
  operation?: 'analysis' | 'profile'
  model?: string
  outcome?: string
  config_issue?: ConfigIssue
  duration_ms?: number
  http_status?: number
  error_code?: string
  error_name?: string
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  issue_count?: number
  issue_paths?: string[]
}

const NUMBER_FIELDS = new Set<keyof SafeLogFields>([
  'duration_ms', 'http_status', 'input_tokens', 'output_tokens', 'total_tokens', 'issue_count',
])
const STRING_FIELDS = new Set<keyof SafeLogFields>([
  'request_id', 'endpoint', 'operation', 'model', 'outcome', 'config_issue', 'error_code', 'error_name',
])

const MAX_STRING_LENGTH = 120
const MAX_ISSUE_PATHS = 10
const REDACTED = '[redacted]'

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{8,}/g, // OpenAI-style API keys (sk-, sk-proj-, sk-svcacct-)
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]*/gi, // inline images
  /[A-Za-z0-9+/]{200,}={0,2}/g, // long base64 blobs
]

/** True when a value looks like a credential rather than an identifier. */
export function looksLikeSecret(value: string): boolean {
  const trimmed = value.trim()
  return /^sk-/i.test(trimmed) || SECRET_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0
    return pattern.test(trimmed)
  })
}

/** Removes control characters and secret-like substrings, then truncates. */
export function scrubString(value: string, maxLength = MAX_STRING_LENGTH): string {
  let result = value.replace(/[\u0000-\u001F\u007F]/g, ' ')
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0
    result = result.replace(pattern, REDACTED)
  }
  return result.length > maxLength ? `${result.slice(0, maxLength)}…` : result
}

/** A path segment is logged only if it is an index or a plain schema key. */
function safePathSegment(segment: unknown): string {
  if (typeof segment === 'number' && Number.isInteger(segment) && segment >= 0) return String(segment)
  if (typeof segment === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(segment)) return segment
  return '?'
}

/**
 * Summarises a validation failure (a ZodError or anything with `issues[].path`)
 * as an issue count and the schema paths involved. Issue messages, received
 * values and unrecognised key names are deliberately never included, because
 * they can echo model output or user input.
 */
export function summarizeValidationIssues(error: unknown): { issue_count: number; issue_paths: string[] } {
  const issues = (error as { issues?: unknown })?.issues
  if (!Array.isArray(issues)) return { issue_count: 0, issue_paths: [] }

  const paths: string[] = []
  for (const issue of issues) {
    const rawPath = (issue as { path?: unknown })?.path
    const path = Array.isArray(rawPath) && rawPath.length > 0 ? rawPath.map(safePathSegment).join('.') : '(root)'
    if (!paths.includes(path)) paths.push(path)
    if (paths.length >= MAX_ISSUE_PATHS) break
  }
  return { issue_count: issues.length, issue_paths: paths }
}

export function createRequestId(): string {
  return randomUUID()
}

function sanitizeFields(fields: SafeLogFields): Record<string, unknown> {
  const output: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(fields) as Array<[keyof SafeLogFields, unknown]>) {
    if (value === undefined || value === null) continue

    if (key === 'model' && typeof value === 'string') {
      if (looksLikeSecret(value)) {
        // OPENAI_MODEL appears to contain a credential. Never echo it; flag the misconfiguration.
        output.model = REDACTED
        output.model_config_suspect = true
      } else {
        output.model = scrubString(value, 64)
      }
    } else if (key === 'issue_paths' && Array.isArray(value)) {
      output.issue_paths = value
        .filter((item): item is string => typeof item === 'string')
        .slice(0, MAX_ISSUE_PATHS)
        .map((item) => scrubString(item, 80))
    } else if (NUMBER_FIELDS.has(key) && typeof value === 'number' && Number.isFinite(value)) {
      output[key] = value
    } else if (STRING_FIELDS.has(key) && typeof value === 'string') {
      output[key] = scrubString(value)
    }
    // Anything else — unknown keys, wrong types, nested objects — is dropped.
  }

  return output
}

/**
 * Emits one JSON log line. `debug` events are suppressed in production.
 * Logging never throws: a failure to log must not break a request.
 */
export function logEvent(level: LogLevel, event: string, fields: SafeLogFields = {}): void {
  if (level === 'debug' && process.env.NODE_ENV === 'production') return

  try {
    const record = {
      level,
      event: /^[a-z0-9_.]{1,64}$/.test(event) ? event : 'invalid_event_name',
      ts: new Date().toISOString(),
      ...sanitizeFields(fields),
    }
    const line = JSON.stringify(record)
    if (level === 'error') console.error(line)
    else if (level === 'warn') console.warn(line)
    else console.info(line)
  } catch {
    // Intentionally ignored.
  }
}
