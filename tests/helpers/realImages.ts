/**
 * Real, decodable synthetic images for tests, built synchronously without any
 * image library. The API decodes every upload, so a file that only has a valid
 * header is rejected: route tests need actual pictures.
 *
 * A picture is a single flat colour. Different shades give different bytes,
 * which matters where the API refuses the same garment photo twice.
 */

import { deflateSync } from 'node:zlib'

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

const cache = new Map<string, Uint8Array>()

/** A complete 8-bit RGB PNG of one flat colour. `shade` (0–255) sets the grey level. */
export function pngBytes(width: number, height: number, shade = 128): Uint8Array {
  const key = `${width}x${height}:${shade}`
  const cached = cache.get(key)
  if (cached) return cached

  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header.set([8, 2, 0, 0, 0], 8) // 8 bits per channel, colour type 2 (RGB), no interlace

  const stride = 1 + width * 3 // one filter byte per row
  const raw = new Uint8Array(stride * height).fill(shade)
  for (let row = 0; row < height; row += 1) raw[row * stride] = 0 // filter type "none"

  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) { bytes.set(part, offset); offset += part.length }
  cache.set(key, bytes)
  return bytes
}

export function realPng(width = 800, height = 800, name = 'image.png', shade = 128): File {
  return new File([pngBytes(width, height, shade)], name, { type: 'image/png' })
}
