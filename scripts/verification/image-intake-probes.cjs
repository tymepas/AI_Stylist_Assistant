#!/usr/bin/env node
/**
 * Exercises the image intake of POST /api/analyze on a running deployment
 * WITHOUT ever reaching a model call, so it can be pointed at Production.
 *
 *   node scripts/verification/image-intake-probes.cjs https://<host>
 *   npm run verify:image-intake -- https://<host>
 *
 * Why it cannot spend anything
 * ----------------------------
 * The route validates and normalises every image, then checks for duplicate
 * garment photos, then checks the style profile, and only after all of that
 * reserves budget and calls the model (app/api/[[...path]]/route.js). Every
 * probe here is refused before that point:
 *
 *   - a probe with a bad image is refused at image intake;
 *   - a probe with good images sends the SAME garment file twice, so it is
 *     refused at the duplicate check, which runs only after `sharp` has decoded
 *     and re-encoded every image of the request. That refusal is therefore
 *     evidence that real image processing worked;
 *   - every probe also carries an invalid style profile, so that a request
 *     which somehow passed the duplicate check would still be refused at the
 *     next check.
 *
 * tests/upload/imageIntakeProbes.test.ts runs every probe through the real
 * route in live mode with a model stub and fails if any probe reaches the
 * model or reserves budget. If a probe ever returns HTTP 200 against a
 * deployment, the script stops at once and sends nothing further.
 *
 * What it sends
 * -------------
 * Synthetic noise and flat colours generated here. No person, no real photo,
 * no credentials. Requests carry no Origin header (lib/security/originPolicy.ts
 * documents that such requests are accepted).
 *
 * What it cannot show
 * -------------------
 * The API does not return the processed image, so the bytes `sharp` produced on
 * the deployment are not visible from outside. Metadata stripping, the output
 * size and the JPEG quality are verified by tests/images/normalizeImage.test.ts
 * on the same code, not by this script.
 */

const sharp = require('sharp')

/** Deterministic pseudo-random RGB noise: two seeds give two different files. */
function noise(width, height, seed) {
  const data = Buffer.alloc(width * height * 3)
  let x = seed >>> 0
  for (let i = 0; i < data.length; i += 1) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0
    data[i] = x >>> 24
  }
  return sharp(data, { raw: { width, height, channels: 3 } })
}

function flat(width, height, colour, channels = 3) {
  return sharp({ create: { width, height, channels, background: colour } })
}

const blob = (buffer, type) => new Blob([buffer], { type })
const INVALID_STYLE_PROFILE = 'this-is-not-json'
const DUPLICATE = 'is the same file as an earlier garment photo'
const J = 'image/jpeg'
const P = 'image/png'
const W = 'image/webp'

/**
 * The probes. Each one: `name`, what a matching answer `proves`, the expected
 * `status`, a fragment the message must `contain`, and the request parts.
 * `reachesDuplicateCheck` marks the probes whose refusal comes after image processing.
 */
async function buildProbes() {
  const jpegA = await noise(900, 1200, 1).jpeg({ quality: 80 }).toBuffer()
  const jpegB = await noise(900, 1200, 2).jpeg({ quality: 80 }).toBuffer()
  const pngA = await noise(700, 900, 3).png().toBuffer()
  const pngAlpha = await flat(800, 1000, { r: 20, g: 90, b: 160, alpha: 0.5 }, 4).png().toBuffer()
  const webpA = await noise(900, 1200, 4).webp({ quality: 80 }).toBuffer()
  // 2400 x 3200 from a small source, so it is large in pixels and small in bytes. Its long edge is above 1,536: it must be resized.
  const large = await sharp(await noise(60, 80, 5).png().toBuffer()).resize(2400, 3200, { kernel: 'cubic' }).jpeg({ quality: 80 }).toBuffer()
  const rotated = await noise(1200, 900, 6).jpeg({ quality: 80 }).withMetadata({ orientation: 6 }).toBuffer()
  const nearLimit = await flat(3900, 3900, { r: 200, g: 180, b: 160 }).jpeg({ quality: 80 }).toBuffer() // 15.2 MP, under the 16 MP limit
  const tooManyPixels = await flat(4200, 4200, { r: 10, g: 10, b: 10 }).png({ compressionLevel: 9 }).toBuffer() // 17.6 MP
  const tooLongSide = await flat(8300, 600, { r: 10, g: 10, b: 10 }).png({ compressionLevel: 9 }).toBuffer()
  const tooSmall = await noise(300, 300, 7).jpeg().toBuffer()
  const truncated = jpegA.subarray(0, Math.floor(jpegA.length / 3))
  const notAnImage = Buffer.from('This is plain text pretending to be a photo.\n'.repeat(200))
  const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(2000, 1)])
  const overBudget = await noise(2300, 3000, 8).jpeg({ quality: 97 }).toBuffer()
  const small = (seed) => noise(560, 640, seed).jpeg({ quality: 70 }).toBuffer()
  const [s1, s2, s3, s4, s5] = await Promise.all([11, 12, 13, 14, 15].map(small))

  const processed = (name, proves, photo, garments, mode, contain = `Garment photo 2 ${DUPLICATE}`) => ({ name, proves, status: 400, contain, photo, garments, mode, reachesDuplicateCheck: true })
  const refused = (name, proves, status, contain, photo, garments, mode = null) => ({ name, proves, status, contain, photo, garments, mode, reachesDuplicateCheck: false })

  return [
    processed('jpeg', 'JPEG decoded and re-encoded (three images)', blob(jpegA, J), [blob(jpegB, J), blob(jpegB, J)], 'same_garment_views'),
    processed('png', 'PNG decoded and re-encoded as JPEG', blob(pngA, P), [blob(jpegB, J), blob(jpegB, J)], 'same_garment_views'),
    processed('png-transparent', 'transparent PNG flattened and re-encoded', blob(pngAlpha, P), [blob(pngA, P), blob(pngA, P)], 'outfit_items'),
    processed('webp', 'WEBP decoded and re-encoded', blob(webpA, W), [blob(webpA, W), blob(webpA, W)], 'same_garment_views'),
    processed('resize', 'a 2400 x 3200 image scaled down to the 1,536 px long edge', blob(large, J), [blob(jpegB, J), blob(jpegB, J)], 'same_garment_views'),
    processed('exif-orientation', 'a JPEG with an EXIF orientation tag processed', blob(rotated, J), [blob(jpegB, J), blob(jpegB, J)], 'same_garment_views'),
    processed('near-pixel-limit', 'a 15.2 MP image decoded within the memory limit', blob(nearLimit, J), [blob(jpegB, J), blob(jpegB, J)], 'same_garment_views'),
    processed('four-images', 'four images processed in one request', blob(jpegA, J), [blob(jpegB, J), blob(pngA, P), blob(jpegB, J)], 'outfit_items', `Garment photo 3 ${DUPLICATE}`),
    refused('too-many-pixels', '17.6 MP refused before decoding', 400, 'megapixels', blob(tooManyPixels, P), [blob(jpegB, J)]),
    refused('too-long-side', 'a side of 8,300 px refused', 400, 'megapixels', blob(tooLongSide, P), [blob(jpegB, J)]),
    refused('too-small', 'a 300 x 300 image refused', 400, '512', blob(tooSmall, J), [blob(jpegB, J)]),
    refused('truncated', 'a truncated JPEG refused, not partly decoded', 400, 'Personal photo', blob(truncated, J), [blob(jpegB, J)]),
    refused('corrupt-garment', 'a corrupt garment refused after a good photo', 400, 'Garment photo', blob(jpegA, J), [blob(truncated, J)]),
    refused('text-as-jpeg', 'bytes that are not an image refused', 400, 'Personal photo', blob(notAnImage, J), [blob(jpegB, J)]),
    refused('png-declared-as-jpeg', 'content that does not match its declared type refused', 400, 'Personal photo', blob(pngA, J), [blob(jpegB, J)]),
    refused('gif', 'an unsupported format refused', 400, 'JPEG, PNG, or WEBP', blob(gif, 'image/gif'), [blob(jpegB, J)]),
    refused('mode-count-mismatch', 'two garment photos in single mode refused', 400, 'One garment photo is expected', blob(jpegA, J), [blob(jpegB, J), blob(pngA, P)], 'single'),
    refused('four-garments', 'more than three garment photos refused', 400, 'up to 3', blob(s1, J), [blob(s2, J), blob(s3, J), blob(s4, J), blob(s5, J)], 'outfit_items'),
    refused('missing-garment', 'a request without a garment photo refused', 400, 'garment image', blob(jpegA, J), []),
    refused('over-request-limit', `a ${(overBudget.length / 1e6).toFixed(1)} MB request refused`, 413, '', blob(overBudget, J), [blob(jpegB, J)]),
  ]
}

/** The multipart body of one probe. Always carries the invalid style profile. */
function formFor(probe) {
  const form = new FormData()
  form.append('occasion', 'Client Meeting')
  form.append('photo', probe.photo, 'photo')
  for (const garment of probe.garments) form.append('garment', garment, 'garment')
  if (probe.mode) form.append('garmentMode', probe.mode)
  form.append('styleProfile', INVALID_STYLE_PROFILE)
  return form
}

function describeAnswer(text) {
  try {
    const parsed = JSON.parse(text)
    return `${parsed.error}: ${parsed.message}`
  } catch {
    return text.replace(/\s+/g, ' ').slice(0, 120)
  }
}

async function run(base, write = (line) => process.stdout.write(`${line}\n`)) {
  const probes = await buildProbes()
  let unexpected = 0
  write(`Target: ${base}`)
  write('No probe can reach a model call. Each is refused before the spend reservation.\n')
  for (const probe of probes) {
    const started = Date.now()
    let status = 0
    let text = ''
    try {
      const response = await fetch(`${base}/api/analyze`, { method: 'POST', body: formFor(probe) })
      status = response.status
      text = await response.text()
    } catch (error) {
      text = `request failed: ${error.message}`
    }
    const message = describeAnswer(text)
    const ok = status === probe.status && message.includes(probe.contain)
    if (!ok) unexpected += 1
    write(`${ok ? 'OK  ' : 'DIFF'} ${probe.name.padEnd(22)} ${String(status).padEnd(4)} ${String(Date.now() - started).padStart(5)} ms  ${message.slice(0, 140)}`)
    write(`     ${probe.reachesDuplicateCheck ? 'after image processing' : 'refused at intake'}: ${probe.proves}`)
    if (status === 200) {
      write('\nSTOP: a probe was answered with 200. It went further than image intake. Nothing more is sent.')
      return 3
    }
  }
  write(`\n${probes.length - unexpected} of ${probes.length} probes were answered as expected.`)
  return unexpected === 0 ? 0 : 1
}

if (require.main === module) {
  const base = (process.argv[2] || '').replace(/\/$/, '')
  if (!/^https?:\/\//.test(base)) {
    process.stderr.write('Usage: node scripts/verification/image-intake-probes.cjs https://<host>\n')
    process.exit(2)
  }
  run(base).then((code) => process.exit(code), (error) => { process.stderr.write(`${error.stack || error}\n`); process.exit(1) })
}

module.exports = { buildProbes, formFor, INVALID_STYLE_PROFILE }
