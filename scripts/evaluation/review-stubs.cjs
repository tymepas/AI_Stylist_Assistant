#!/usr/bin/env node
/**
 * Adds an empty review stub to a reference set for every manifest case that
 * has none yet, so a reviewer never has to type image paths or hashes by hand.
 *
 *   node scripts/evaluation/review-stubs.cjs --manifest <cases.json> --references <references.json> --images <directory>
 *   node scripts/evaluation/review-stubs.cjs --manifest <cases.json> --references <references.json> --images <directory> --write
 *
 * Without --write nothing is changed: the script only prints what it would add.
 *
 * What it does:
 * - copies the case id, the occasion and the image paths from the manifest;
 * - records the SHA-256 of each image file, so the review is tied to the exact
 *   file that was looked at;
 * - marks the stub `basis: "unreviewed"`, `status: "pending"`.
 *
 * What it never does:
 * - it never writes a rating, a fact, a reviewer or a date: those come from a
 *   person looking at the images (evaluation/HUMAN_REVIEW.md);
 * - it never changes a reference that already exists, not even its hashes. An
 *   image that changed after its review is reported, and the review must be
 *   redone by a person;
 * - it reads image files only to hash them. Nothing is sent anywhere.
 */

const { createHash } = require('node:crypto')
const { existsSync, readFileSync, writeFileSync } = require('node:fs')
const path = require('node:path')

const FORMAT = 'verdict-reference-set/1'
const FLAGS = { '--manifest': 'manifest', '--references': 'references', '--images': 'images', '--dataset': 'dataset' }

function parse(argv) {
  const options = { write: false }
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].split('=')
    if (flag === '--write') { options.write = true; continue }
    if (!Object.prototype.hasOwnProperty.call(FLAGS, flag)) throw new Error(`Unknown option: ${argv[i]}`)
    const value = inline !== undefined ? inline : argv[++i]
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`)
    options[FLAGS[flag]] = value
  }
  if (!options.manifest) throw new Error('--manifest <cases.json> is required')
  if (!options.references) throw new Error('--references <references.json> is required')
  return options
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/** The images of a manifest case in manifest order: the photo, then every garment image. */
function imagesOf(manifestCase) {
  const garments = [manifestCase.garment, ...(manifestCase.extra_garments || [])]
  return [
    { id: 'photo', role: 'photo', path: manifestCase.photo },
    ...garments.map((imagePath, index) => ({ id: `garment-${index + 1}`, role: 'garment', path: imagePath })),
  ]
}

/** Builds the stubs to add and the problems found. Pure apart from reading image files to hash them. */
function plan(manifest, existing, imagesDir) {
  const known = new Set(existing.references.map((reference) => reference.case_id))
  const stubs = []
  const notes = []

  for (const manifestCase of manifest.cases) {
    if (known.has(manifestCase.id)) continue
    const images = imagesOf(manifestCase).map((image) => {
      if (!imagesDir) return image
      const file = path.join(imagesDir, image.path)
      if (!existsSync(file)) {
        notes.push(`${manifestCase.id}: image not found, no hash recorded: ${image.path}`)
        return image
      }
      return { ...image, sha256: sha256(file) }
    })
    stubs.push({
      case_id: manifestCase.id,
      images,
      garment_description: 'TO DO: describe the garment or outfit in plain words. Garments only, never the person.',
      occasion: manifestCase.occasion,
      basis: 'unreviewed',
      status: 'pending',
      provenance: { image_source: manifestCase.source },
    })
  }

  // An existing reference is never touched. A changed image is only reported.
  if (imagesDir) {
    for (const reference of existing.references) {
      for (const image of reference.images || []) {
        if (!image.sha256) continue
        const file = path.join(imagesDir, image.path)
        if (!existsSync(file)) notes.push(`${reference.case_id}: reviewed image is missing from the image directory: ${image.path}`)
        else if (sha256(file) !== image.sha256) notes.push(`${reference.case_id}: image changed since its review (SHA-256 differs): ${image.path}. The review must be redone.`)
      }
    }
  }
  return { stubs, notes }
}

function main() {
  let options
  try {
    options = parse(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    return 2
  }

  const manifest = JSON.parse(readFileSync(options.manifest, 'utf8'))
  if (!manifest || !Array.isArray(manifest.cases)) {
    process.stderr.write('The manifest has no "cases" array.\n')
    return 2
  }
  const existing = existsSync(options.references)
    ? JSON.parse(readFileSync(options.references, 'utf8'))
    : { format: FORMAT, dataset: options.dataset || 'golden-v1', dataset_version: '0.1.0', references: [] }
  if (existing.format !== FORMAT || !Array.isArray(existing.references)) {
    process.stderr.write(`The reference file is not a ${FORMAT} file.\n`)
    return 2
  }

  const { stubs, notes } = plan(manifest, existing, options.images)
  for (const note of notes) process.stdout.write(`NOTE ${note}\n`)
  process.stdout.write(`${manifest.cases.length} case(s) in the manifest, ${existing.references.length} reference(s) present, ${stubs.length} stub(s) to add${stubs.length > 0 ? `: ${stubs.map((stub) => stub.case_id).join(', ')}` : ''}.\n`)
  if (!options.images) process.stdout.write('No --images directory given: stubs carry no SHA-256. An image review needs one for every image.\n')

  if (!options.write) {
    process.stdout.write('Nothing was written. Add --write to add the stubs.\n')
    return 0
  }
  if (stubs.length > 0) {
    writeFileSync(options.references, `${JSON.stringify({ ...existing, references: [...existing.references, ...stubs] }, null, 2)}\n`)
    process.stdout.write(`Wrote ${stubs.length} stub(s) to ${options.references}. Bump dataset_version when the reviews are done.\n`)
  }
  return 0
}

if (require.main === module) process.exit(main())

module.exports = { imagesOf, plan, parse }
