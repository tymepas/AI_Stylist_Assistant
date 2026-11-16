/**
 * Minimal RESP2 client for integration tests against a real Redis server.
 * Lets CI run the production Lua scripts without adding a Redis dependency.
 */

import { connect, type Socket } from 'node:net'
import type { RedisEval } from '@/lib/spend/spendStore'

type Reply = string | number | null | Reply[] | Error

function encode(args: string[]): string {
  return `*${args.length}\r\n${args.map((a) => `$${Buffer.byteLength(a)}\r\n${a}\r\n`).join('')}`
}

function parse(buffer: Buffer, offset: number): { value: Reply; next: number } | null {
  const lineEnd = buffer.indexOf('\r\n', offset)
  if (lineEnd === -1) return null
  const type = String.fromCharCode(buffer[offset])
  const line = buffer.toString('utf8', offset + 1, lineEnd)
  const after = lineEnd + 2
  if (type === '+') return { value: line, next: after }
  if (type === '-') return { value: new Error(line), next: after }
  if (type === ':') return { value: Number(line), next: after }
  if (type === '$') {
    const length = Number(line)
    if (length === -1) return { value: null, next: after }
    if (buffer.length < after + length + 2) return null
    return { value: buffer.toString('utf8', after, after + length), next: after + length + 2 }
  }
  if (type === '*') {
    const count = Number(line)
    if (count === -1) return { value: null, next: after }
    const items: Reply[] = []
    let cursor = after
    for (let i = 0; i < count; i += 1) {
      const item = parse(buffer, cursor)
      if (!item) return null
      items.push(item.value)
      cursor = item.next
    }
    return { value: items, next: cursor }
  }
  throw new Error(`Unsupported RESP type ${type}`)
}

/**
 * Converts a Redis `TIME` reply ([seconds, microseconds]) to Unix milliseconds.
 * Throws on anything else, so a test can never silently fall back to another clock.
 */
export function timeReplyToMs(reply: unknown): number {
  if (!Array.isArray(reply) || reply.length !== 2) throw new Error('Unexpected reply to TIME')
  const seconds = Number(reply[0])
  const microseconds = Number(reply[1])
  if (!Number.isInteger(seconds) || !Number.isInteger(microseconds) || seconds <= 0 || microseconds < 0 || microseconds >= 1_000_000) {
    throw new Error('Unexpected reply to TIME')
  }
  return seconds * 1000 + Math.floor(microseconds / 1000)
}

export class RespConnection {
  private buffer = Buffer.alloc(0)
  private pending: Array<{ resolve: (v: Reply) => void; reject: (e: Error) => void }> = []

  private constructor(private readonly socket: Socket) {
    socket.on('data', (chunk) => {
      this.buffer = Buffer.concat([this.buffer, typeof chunk === 'string' ? Buffer.from(chunk) : chunk])
      for (;;) {
        const parsed = parse(this.buffer, 0)
        if (!parsed) break
        this.buffer = this.buffer.subarray(parsed.next)
        const waiter = this.pending.shift()
        if (!waiter) continue
        if (parsed.value instanceof Error) waiter.reject(parsed.value)
        else waiter.resolve(parsed.value)
      }
    })
    socket.on('error', (error) => { for (const waiter of this.pending.splice(0)) waiter.reject(error) })
  }

  static open(url: string): Promise<RespConnection> {
    const { hostname, port } = new URL(url)
    return new Promise((resolve, reject) => {
      const socket = connect({ host: hostname, port: Number(port || 6379) }, () => resolve(new RespConnection(socket)))
      socket.once('error', reject)
    })
  }

  command(...args: string[]): Promise<Reply> {
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject })
      this.socket.write(encode(args))
    })
  }

  /**
   * The Redis server's own clock, in Unix milliseconds. Redis evaluates absolute
   * key expiries (PEXPIREAT) against this clock, not against the test process's.
   */
  async serverTimeMs(): Promise<number> {
    return timeReplyToMs(await this.command('TIME'))
  }

  /** Deletes every key matching a pattern, using SCAN so the server is never blocked. Returns the number deleted. */
  async deleteMatching(pattern: string): Promise<number> {
    let cursor = '0'
    let deleted = 0
    do {
      const reply = (await this.command('SCAN', cursor, 'MATCH', pattern, 'COUNT', '500')) as [string, string[]]
      cursor = String(reply[0])
      const keys = reply[1] ?? []
      if (keys.length > 0) deleted += Number(await this.command('DEL', ...keys))
    } while (cursor !== '0')
    return deleted
  }

  /** Same contract as the Upstash transport. */
  readonly eval: RedisEval = async (script, keys, args) => this.command('EVAL', script, String(keys.length), ...keys, ...args)

  close(): void {
    this.socket.end()
  }
}
