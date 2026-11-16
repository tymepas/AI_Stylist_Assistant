/**
 * Helpers for asserting what the server writes to logs.
 * Captures every console method so nothing can slip through an unspied channel.
 */

import { jest } from '@jest/globals'

const METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const

export interface LogCapture {
  /** Every argument of every console call, stringified and joined. */
  text: () => string
  /** Parsed JSON log events (lines emitted by safeLogger). */
  events: () => Array<Record<string, unknown>>
}

export function captureLogs(): LogCapture {
  const calls: unknown[][] = []
  for (const method of METHODS) {
    jest.spyOn(console, method).mockImplementation((...args: unknown[]) => { calls.push(args) })
  }
  const stringify = (value: unknown) => {
    if (typeof value === 'string') return value
    if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack ?? ''}`
    try { return JSON.stringify(value) } catch { return String(value) }
  }
  return {
    text: () => calls.map((args) => args.map(stringify).join(' ')).join('\n'),
    events: () => calls.flatMap((args) => {
      if (args.length !== 1 || typeof args[0] !== 'string') return []
      try { return [JSON.parse(args[0]) as Record<string, unknown>] } catch { return [] }
    }),
  }
}

export function makePng(width = 800, height = 800): File {
  const buffer = new ArrayBuffer(33)
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  view.setUint32(8, 13)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return new File([buffer], 'photo.png', { type: 'image/png' })
}

export function openAIResponse(modelOutput: unknown, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({
    status: 'completed',
    output_text: typeof modelOutput === 'string' ? modelOutput : JSON.stringify(modelOutput),
    usage: { input_tokens: 2100, output_tokens: 410, total_tokens: 2510 },
    ...extra,
  }), { status: 200 })
}

const dim = (rating: string, reason = 'Plain reasoning.') => ({ rating, reason, confidence: 'High' })

export function dimensions(reason?: string) {
  return {
    occasion: dim('Good', reason),
    color: dim('Good', reason),
    formality: dim('Good', reason),
    seasonality: dim('Good', reason),
    style: dim('Good', reason),
    style_preference_match: dim('Good', reason),
  }
}

/** Base64 of the PNG signature: present in any inline PNG data URL. */
export const PNG_BASE64_PREFIX = 'iVBORw0KGgo'
