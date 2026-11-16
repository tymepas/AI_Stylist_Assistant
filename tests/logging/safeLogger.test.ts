/**
 * Unit tests for the privacy-safe structured logger.
 */

import { afterEach, describe, expect, it, jest } from '@jest/globals'
import { z } from 'zod'
import { createRequestId, logEvent, looksLikeSecret, summarizeValidationIssues, type SafeLogFields } from '@/lib/observability/safeLogger'
import { captureLogs } from './logTestUtils'

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
  jest.restoreAllMocks()
})

describe('logEvent — output shape', () => {
  it('writes one JSON line with level, event, timestamp and allowlisted fields', () => {
    const logs = captureLogs()
    logEvent('info', 'openai_request_completed', { request_id: 'abc-123', operation: 'analysis', model: 'gpt-4.1', duration_ms: 812, input_tokens: 10, http_status: 200 })

    const [event] = logs.events()
    expect(event).toMatchObject({ level: 'info', event: 'openai_request_completed', request_id: 'abc-123', operation: 'analysis', model: 'gpt-4.1', duration_ms: 812, input_tokens: 10, http_status: 200 })
    expect(event.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(logs.text().split('\n')).toHaveLength(1)
  })

  it('routes levels to the matching console method', () => {
    captureLogs()
    logEvent('error', 'e')
    logEvent('warn', 'w')
    logEvent('info', 'i')
    expect(console.error).toHaveBeenCalledTimes(1)
    expect(console.warn).toHaveBeenCalledTimes(1)
    expect(console.info).toHaveBeenCalledTimes(1)
  })

  it('suppresses debug events in production only', () => {
    const logs = captureLogs()
    process.env = { ...originalEnv, NODE_ENV: 'production' }
    logEvent('debug', 'hidden_in_production')
    process.env = { ...originalEnv, NODE_ENV: 'development' }
    logEvent('debug', 'visible_in_development')
    expect(logs.events().map((e) => e.event)).toEqual(['visible_in_development'])
  })

  it('replaces an unexpected event name', () => {
    const logs = captureLogs()
    logEvent('info', 'Bad Event\n{"forged":true}')
    expect(logs.events()[0].event).toBe('invalid_event_name')
  })
})

describe('logEvent — field allowlist', () => {
  it('drops fields that are not on the allowlist', () => {
    const logs = captureLogs()
    const unsafe = {
      request_id: 'r1',
      prompt: 'Selected occasion: Wedding',
      output_text: '{"skin_tone_depth":"deep"}',
      image_url: 'data:image/png;base64,AAAA',
      body: { photo: 'x' },
      message: 'raw error message',
    } as unknown as SafeLogFields
    logEvent('error', 'test_event', unsafe)

    const [event] = logs.events()
    expect(Object.keys(event).sort()).toEqual(['event', 'level', 'request_id', 'ts'])
    expect(logs.text()).not.toMatch(/Wedding|skin_tone|base64|raw error/)
  })

  it('drops values of the wrong type, including nested objects in string fields', () => {
    const logs = captureLogs()
    logEvent('info', 'test_event', {
      model: { name: 'gpt-4.1', key: 'sk-proj-nested-secret-value-123456' },
      duration_ms: 'slow',
      input_tokens: Number.NaN,
      issue_paths: 'not-an-array',
    } as unknown as SafeLogFields)
    const [event] = logs.events()
    expect(Object.keys(event).sort()).toEqual(['event', 'level', 'ts'])
    expect(logs.text()).not.toContain('nested-secret')
  })
})

describe('logEvent — scrubbing', () => {
  it.each([
    ['an OpenAI key', 'failed with sk-proj-AbCdEfGhIjKlMnOpQrStUvWx0123456789', 'sk-proj-AbCd'],
    ['a service-account key', 'sk-svcacct-1234567890abcdefXYZ', 'sk-svcacct-1234'],
    ['a bearer token', 'Authorization: Bearer abc.def.ghi', 'abc.def.ghi'],
    ['an inline image', 'image data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==', '/9j/4AAQ'],
    ['a long base64 blob', `blob ${'QUJD'.repeat(80)}`, 'QUJDQUJDQUJD'],
  ])('redacts %s from string fields', (_label, value, secretFragment) => {
    const logs = captureLogs()
    logEvent('error', 'test_event', { endpoint: value })
    expect(logs.text()).not.toContain(secretFragment)
    expect(logs.events()[0].endpoint).toContain('[redacted]')
  })

  it('truncates long strings', () => {
    const logs = captureLogs()
    // Spaces keep this from matching the long-base64 redaction pattern.
    logEvent('info', 'test_event', { endpoint: 'abc '.repeat(125) })
    expect(String(logs.events()[0].endpoint)).toHaveLength(121)
  })

  it('removes control characters so a value cannot forge extra log lines', () => {
    const logs = captureLogs()
    logEvent('info', 'test_event', { endpoint: '/analyze\n{"level":"error","event":"forged"}\r' })
    expect(logs.text().split('\n')).toHaveLength(1)
    expect(logs.events()).toHaveLength(1)
  })
})

describe('logEvent — model names', () => {
  it('keeps a normal model id', () => {
    const logs = captureLogs()
    logEvent('info', 'test_event', { model: 'gpt-6.1-terra' })
    expect(logs.events()[0]).toMatchObject({ model: 'gpt-6.1-terra' })
    expect(logs.events()[0]).not.toHaveProperty('model_config_suspect')
  })

  it.each(['sk-proj-thisLooksLikeAnApiKey1234567890', 'sk-short-but-key', '  sk-abc  '])('redacts and flags a model value that looks like a key (%s)', (value) => {
    const logs = captureLogs()
    logEvent('info', 'test_event', { model: value })
    expect(logs.events()[0]).toMatchObject({ model: '[redacted]', model_config_suspect: true })
    expect(logs.text()).not.toContain(value.trim())
  })

  it('looksLikeSecret does not flag real model ids', () => {
    for (const id of ['gpt-4.1', 'gpt-6.1-terra', 'gpt-4.1-2025-04-14', 'o4-mini']) expect(looksLikeSecret(id)).toBe(false)
  })
})

describe('logEvent — never throws', () => {
  it('swallows errors raised while reading fields', () => {
    captureLogs()
    const fields = {}
    Object.defineProperty(fields, 'request_id', { enumerable: true, get() { throw new Error('boom') } })
    expect(() => logEvent('info', 'test_event', fields as SafeLogFields)).not.toThrow()
  })
})

describe('summarizeValidationIssues', () => {
  const schema = z.object({
    status: z.literal('complete'),
    coloring: z.object({ skin_tone_depth: z.enum(['light', 'deep']) }).strict(),
    keywords: z.array(z.string()).max(2),
  }).strict()

  it('returns issue count and schema paths without messages, values or unknown key names', () => {
    const result = schema.safeParse({
      status: 'complete',
      coloring: { skin_tone_depth: 'MARKER_VALUE_olive', MARKER_UNKNOWN_KEY: 'MARKER_EXTRA_VALUE' },
      keywords: ['a', 'b', 'MARKER_THIRD'],
      MARKER_TOP_LEVEL: 1,
    })
    expect(result.success).toBe(false)

    const summary = summarizeValidationIssues(result.success ? null : result.error)
    expect(summary.issue_count).toBeGreaterThanOrEqual(3)
    expect(summary.issue_paths).toEqual(expect.arrayContaining(['coloring.skin_tone_depth', 'coloring', 'keywords', '(root)']))
    expect(JSON.stringify(summary)).not.toContain('MARKER')
  })

  it('replaces path segments that are not plain keys or indices', () => {
    expect(summarizeValidationIssues({ issues: [{ path: ['a', 3, 'has space', '../x', -1] }] }).issue_paths).toEqual(['a.3.?.?.?'])
  })

  it('caps the number of paths at ten but reports the full count', () => {
    const issues = Array.from({ length: 25 }, (_, i) => ({ path: ['items', i] }))
    const summary = summarizeValidationIssues({ issues })
    expect(summary.issue_count).toBe(25)
    expect(summary.issue_paths).toHaveLength(10)
  })

  it('returns an empty summary for non-validation errors', () => {
    expect(summarizeValidationIssues(new Error('Unexpected token s in JSON'))).toEqual({ issue_count: 0, issue_paths: [] })
    expect(summarizeValidationIssues(undefined)).toEqual({ issue_count: 0, issue_paths: [] })
  })
})

describe('createRequestId', () => {
  it('returns unique UUIDs', () => {
    const ids = new Set(Array.from({ length: 50 }, () => createRequestId()))
    expect(ids.size).toBe(50)
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})
