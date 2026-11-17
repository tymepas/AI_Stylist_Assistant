#!/usr/bin/env node
/**
 * A second, independent review of cases that already have a finished review.
 *
 * A rating is one person's judgement. This script lets a second person rate the
 * same cases WITHOUT seeing the first ratings, and then records both side by
 * side, so that every difference between the two stays on record.
 *
 *   1. Make a blind sheet for the second reviewer (no ratings, facts or notes of the first review):
 *      node scripts/evaluation/second-review.cjs sheet --manifest <cases.json> --references <references.json> --out <sheet.json> [--cases id,id]
 *
 *   2. The second reviewer fills in the sheet: reviewer id, date, six ratings per case.
 *
 *   3. Add the sheet to the reference set and list where the two reviewers differ:
 *      node scripts/evaluation/second-review.cjs merge --sheet <sheet.json> --references <references.json>
 *      node scripts/evaluation/second-review.cjs merge --sheet <sheet.json> --references <references.json> --write
 *
 * Without --write, `merge` changes nothing and only prints what it would add.
 *
 * What it never does:
 * - it never shows the first review to the second reviewer;
 * - it never changes the first review, and never changes a rating to make two
 *   reviews agree. A difference is recorded, not resolved;
 * - it never writes a rating itself. An unfilled rating stops the merge;
 * - it sends nothing anywhere and reads no image.
 */

const { existsSync, readFileSync, writeFileSync } = require('node:fs')

const SHEET_FORMAT = 'verdict-second-review-sheet/1'
const REFERENCE_FORMAT = 'verdict-reference-set/1'
const DIMENSIONS = ['occasion', 'color', 'formality', 'seasonality', 'style', 'style_preference_match']
const RATINGS = ['Excellent', 'Good', 'Fair', 'Poor', 'Unable to Evaluate']
const BAND = { Excellent: 4, Good: 3, Fair: 2, Poor: 1 }
const TODO = 'TO DO'
const FLAGS = { '--manifest': 'manifest', '--references': 'references', '--out': 'out', '--sheet': 'sheet', '--cases': 'cases' }

function parse(argv) {
  const [command, ...rest] = argv
  if (command !== 'sheet' && command !== 'merge') throw new Error('The first argument must be "sheet" or "merge"')
  const options = { command, write: false }
  for (let i = 0; i < rest.length; i += 1) {
    const [flag, inline] = rest[i].split('=')
    if (flag === '--write') { options.write = true; continue }
    if (!Object.prototype.hasOwnProperty.call(FLAGS, flag)) throw new Error(`Unknown option: ${rest[i]}`)
    const value = inline !== undefined ? inline : rest[++i]
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`)
    options[FLAGS[flag]] = value
  }
  if (!options.references) throw new Error('--references <references.json> is required')
  if (command === 'sheet' && !options.manifest) throw new Error('--manifest <cases.json> is required')
  if (command === 'sheet' && !options.out) throw new Error('--out <sheet.json> is required')
  if (command === 'merge' && !options.sheet) throw new Error('--sheet <sheet.json> is required')
  return options
}

/** Only a finished human review can be reviewed a second time. */
function reviewable(reference) {
  return reference.status === 'complete' && (reference.basis === 'image_review' || reference.basis === 'brief')
}

/**
 * The blind sheet: what the second reviewer needs in order to rate, and nothing
 * the first reviewer concluded. Pure.
 */
function buildSheet(manifest, set, caseIds) {
  const byId = new Map(manifest.cases.map((manifestCase) => [manifestCase.id, manifestCase]))
  const wanted = caseIds ? new Set(caseIds) : null
  const cases = []
  const skipped = []
  for (const reference of set.references) {
    if (wanted && !wanted.has(reference.case_id)) continue
    const manifestCase = byId.get(reference.case_id)
    if (!manifestCase || !reviewable(reference)) { skipped.push(reference.case_id); continue }
    cases.push({
      case_id: reference.case_id,
      occasion: manifestCase.occasion,
      style_profile: manifestCase.style_profile,
      garment_mode: manifestCase.garment_mode || 'single',
      images: [manifestCase.photo, manifestCase.garment, ...(manifestCase.extra_garments || [])],
      dimension_ratings: Object.fromEntries(DIMENSIONS.map((key) => [key, { rating: TODO }])),
    })
  }
  const unknown = wanted ? [...wanted].filter((id) => !set.references.some((reference) => reference.case_id === id)) : []
  return {
    sheet: {
      format: SHEET_FORMAT,
      dataset: set.dataset,
      instructions: 'Rate every case from the images alone, using the rubric in evaluation/HUMAN_REVIEW.md. Do not look at the first review or at any model output before you finish.',
      reviewer: { id: TODO },
      reviewed_on: `${TODO}: YYYY-MM-DD`,
      cases,
    },
    skipped,
    unknown,
  }
}

function distance(a, b) {
  if (a === b) return 0
  if (BAND[a] === undefined || BAND[b] === undefined) return null
  return Math.abs(BAND[a] - BAND[b])
}

/**
 * Adds a filled-in sheet to a reference set as second reviews. Returns the new
 * set, the problems that stop the merge, and where the two reviewers differ.
 * Pure: the input set is not modified.
 */
function mergeSheet(set, sheet) {
  const problems = []
  if (sheet.format !== SHEET_FORMAT) problems.push(`the sheet is not a ${SHEET_FORMAT} file`)
  const reviewer = sheet.reviewer && sheet.reviewer.id
  if (typeof reviewer !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(reviewer)) problems.push('reviewer.id must be a short identifier (lower case letters, digits, "-" or "_"), not a name or an email address')
  if (typeof sheet.reviewed_on !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(sheet.reviewed_on)) problems.push('reviewed_on must be a date written as YYYY-MM-DD')
  if (problems.length > 0 || !Array.isArray(sheet.cases)) return { set, problems: problems.length > 0 ? problems : ['the sheet has no "cases" array'], differences: [], added: [] }

  const byId = new Map(set.references.map((reference) => [reference.case_id, reference]))
  const additions = new Map()
  const differences = []
  for (const entry of sheet.cases) {
    const at = `case ${entry.case_id}`
    const reference = byId.get(entry.case_id)
    if (!reference) { problems.push(`${at}: no such reference`); continue }
    if (!reviewable(reference)) { problems.push(`${at}: the first review is not a finished human review`); continue }
    if (reference.reviewer && reference.reviewer.id === reviewer) { problems.push(`${at}: "${reviewer}" did the first review; a second review is by another person`); continue }
    if ((reference.second_reviews || []).some((review) => review.reviewer.id === reviewer)) { problems.push(`${at}: "${reviewer}" has already given a second review`); continue }
    const ratings = {}
    for (const key of DIMENSIONS) {
      const given = entry.dimension_ratings && entry.dimension_ratings[key]
      const rating = given && given.rating
      if (!RATINGS.includes(rating)) { problems.push(`${at}: ${key} is not rated (use one of: ${RATINGS.join(', ')})`); continue }
      ratings[key] = typeof given.note === 'string' && given.note.length > 0 ? { rating, note: given.note } : { rating }
    }
    if (Object.keys(ratings).length !== DIMENSIONS.length) continue
    additions.set(entry.case_id, { reviewer: { id: reviewer }, reviewed_on: sheet.reviewed_on, dimension_ratings: ratings })

    const differing = DIMENSIONS.filter((key) => reference.dimension_ratings[key].rating !== ratings[key].rating)
    if (differing.length > 0) {
      differences.push({
        case_id: entry.case_id,
        dimensions: differing.map((key) => {
          const first = reference.dimension_ratings[key].rating
          const second = ratings[key].rating
          const apart = distance(first, second)
          return { dimension: key, first, second, severe: apart === null || apart >= 2 }
        }),
      })
    }
  }
  if (problems.length > 0) return { set, problems, differences: [], added: [] }

  const references = set.references.map((reference) => (additions.has(reference.case_id)
    ? { ...reference, second_reviews: [...(reference.second_reviews || []), additions.get(reference.case_id)] }
    : reference))
  return { set: { ...set, references }, problems: [], differences, added: [...additions.keys()] }
}

function main() {
  let options
  try {
    options = parse(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    return 2
  }
  const set = JSON.parse(readFileSync(options.references, 'utf8'))
  if (set.format !== REFERENCE_FORMAT || !Array.isArray(set.references)) {
    process.stderr.write(`The reference file is not a ${REFERENCE_FORMAT} file.\n`)
    return 2
  }

  if (options.command === 'sheet') {
    if (existsSync(options.out)) {
      process.stderr.write(`${options.out} already exists. Choose another file: a sheet may hold a review in progress.\n`)
      return 2
    }
    const manifest = JSON.parse(readFileSync(options.manifest, 'utf8'))
    const { sheet, skipped, unknown } = buildSheet(manifest, set, options.cases ? options.cases.split(',').map((id) => id.trim()).filter(Boolean) : null)
    for (const id of unknown) process.stdout.write(`NOTE ${id}: no such reference\n`)
    if (skipped.length > 0) process.stdout.write(`NOTE ${skipped.length} case(s) left out because their first review is not finished: ${skipped.join(', ')}\n`)
    if (sheet.cases.length === 0) {
      process.stdout.write('No case has a finished first review. Nothing was written.\n')
      return 0
    }
    writeFileSync(options.out, `${JSON.stringify(sheet, null, 2)}\n`)
    process.stdout.write(`Wrote a blind sheet of ${sheet.cases.length} case(s) to ${options.out}. It holds no rating from the first review.\n`)
    return 0
  }

  const sheet = JSON.parse(readFileSync(options.sheet, 'utf8'))
  const { set: merged, problems, differences, added } = mergeSheet(set, sheet)
  if (problems.length > 0) {
    process.stderr.write('The sheet cannot be added:\n')
    for (const problem of problems) process.stderr.write(`  - ${problem}\n`)
    return 1
  }
  process.stdout.write(`${added.length} second review(s) by "${sheet.reviewer.id}"; the two reviewers differ on ${differences.length} case(s).\n`)
  for (const entry of differences) {
    for (const item of entry.dimensions) process.stdout.write(`  ${entry.case_id}  ${item.dimension}: first "${item.first}", second "${item.second}"${item.severe ? '  (two bands or more apart)' : ''}\n`)
  }
  if (differences.length > 0) process.stdout.write('A difference is recorded as it is. Do not change either rating to make them agree; note what you concluded in the second review\'s "notes".\n')
  if (!options.write) {
    process.stdout.write('Nothing was written. Add --write to add the second reviews.\n')
    return 0
  }
  writeFileSync(options.references, `${JSON.stringify(merged, null, 2)}\n`)
  process.stdout.write(`Wrote ${added.length} second review(s) to ${options.references}. Bump dataset_version, then run the validator.\n`)
  return 0
}

if (require.main === module) process.exit(main())

module.exports = { buildSheet, mergeSheet, parse, SHEET_FORMAT }
