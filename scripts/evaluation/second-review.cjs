#!/usr/bin/env node
/**
 * A second, independent review of cases that already have a finished review.
 *
 * A rating is one person's judgement. This script lets a second person rate the
 * same cases WITHOUT seeing the first ratings, and then records both side by
 * side, so that every difference between the two stays on record.
 *
 *   1. The person who keeps the dataset makes a blind sheet for the second reviewer:
 *      node scripts/evaluation/second-review.cjs sheet --manifest <cases.json> --references <references.json> --out <sheet.json> [--cases id,id]
 *
 *   2. The second reviewer fills in the sheet: reviewer id, date, six ratings per case.
 *
 *   3. The person who keeps the dataset adds the sheet to the reference set:
 *      node scripts/evaluation/second-review.cjs merge --sheet <sheet.json> --references <references.json>
 *      node scripts/evaluation/second-review.cjs merge --sheet <sheet.json> --references <references.json> --write
 *
 * Without --write, `merge` changes nothing and only prints what it would add.
 * `merge` prints the first reviewer's rating wherever the two differ, so it is
 * run by the person who keeps the dataset, after the second reviewer has
 * finished, never by the second reviewer.
 *
 * What the sheet holds: for each case the occasion, the style preferences, the
 * Style DNA context when the case sends a profile, the garment mode, and the
 * image paths with the hash of each file the first review recorded. These are
 * the inputs the first reviewer and the model had. It holds nothing the first
 * reviewer concluded: no rating, note, fact, description or comparison group.
 *
 * What it never does:
 * - it never changes the first review, and never changes a rating to make two
 *   reviews agree. A difference is recorded, not resolved;
 * - it never writes a rating itself. An unfilled rating stops the merge;
 * - it never writes a reference file the validator would refuse for what was
 *   merged: every limit of the reference format is checked before writing;
 * - it sends nothing anywhere and reads no image.
 */

const { existsSync, readFileSync, writeFileSync } = require('node:fs')

const SHEET_FORMAT = 'verdict-second-review-sheet/1'
const REFERENCE_FORMAT = 'verdict-reference-set/1'
const DIMENSIONS = ['occasion', 'color', 'formality', 'seasonality', 'style', 'style_preference_match']
const RATINGS = ['Excellent', 'Good', 'Fair', 'Poor', 'Unable to Evaluate']
const BAND = { Excellent: 4, Good: 3, Fair: 2, Poor: 1 }
const TODO = 'TO DO'
/** Limits of the reference format (evaluation/reference.ts). A test keeps them equal. */
const LIMITS = { secondReviews: 4, dimensionNote: 300, reviewNotes: 500 }
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

function isCalendarDate(value) {
  const match = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/**
 * What the request tells the model about a case's Style DNA profile, in the
 * same words (buildUserContext in lib/services/openai/openAIAnalysisService.ts;
 * a test keeps the two in step). The second reviewer needs it: the rubric rates
 * `style` and `style_preference_match` against it. Null when the case sends no
 * profile. Every profile in evaluation data is an invented persona.
 */
function styleDnaContext(manifestCase) {
  const dna = manifestCase.style_dna
  if (!dna) return null
  const { coloring: c, aesthetic_signals: a, proportions: p, style_keywords: keywords } = dna.profile
  const lines = []
  const colouring = []
  if (c.skin_tone_depth) colouring.push(`depth ${c.skin_tone_depth}`)
  if (c.skin_tone_undertone) colouring.push(`undertone ${c.skin_tone_undertone}`)
  if (c.hair_color) colouring.push(`hair ${c.hair_color}`)
  if (c.high_contrast !== null) colouring.push(`high contrast ${c.high_contrast}`)
  if (colouring.length > 0) lines.push(`coloring context: ${colouring.join(', ')}`)
  const aesthetic = []
  if (keywords.length > 0) aesthetic.push(`style ${keywords.map((entry) => entry.keyword).join(', ')}`)
  if (a.current_outfit_formality) aesthetic.push(`formality ${a.current_outfit_formality}`)
  if (aesthetic.length > 0) lines.push(`aesthetic context: ${aesthetic.join('; ')}`)
  const proportions = []
  if (p.frame_width) proportions.push(`frame ${p.frame_width}`)
  if (p.torso_length) proportions.push(`torso ${p.torso_length}`)
  if (p.shoulder_breadth) proportions.push(`shoulders ${p.shoulder_breadth}`)
  if (proportions.length > 0) lines.push(`proportions context: ${proportions.join(', ')}`)
  return { persona: dna.persona, invented: true, context: lines }
}

/**
 * The blind sheet: the inputs the second reviewer needs in order to rate, and
 * nothing the first reviewer concluded. Pure.
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
    const hashes = new Map((reference.images || []).map((image) => [image.path, image.sha256]))
    cases.push({
      case_id: reference.case_id,
      occasion: manifestCase.occasion,
      style_profile: manifestCase.style_profile,
      style_dna: styleDnaContext(manifestCase),
      garment_mode: manifestCase.garment_mode || 'single',
      // The hash ties this review to the same files the first review was about.
      images: [manifestCase.photo, manifestCase.garment, ...(manifestCase.extra_garments || [])].map((imagePath) => (hashes.get(imagePath) ? { path: imagePath, sha256: hashes.get(imagePath) } : { path: imagePath })),
      dimension_ratings: Object.fromEntries(DIMENSIONS.map((key) => [key, { rating: TODO }])),
    })
  }
  const unknown = wanted ? [...wanted].filter((id) => !set.references.some((reference) => reference.case_id === id)) : []
  return {
    sheet: {
      format: SHEET_FORMAT,
      dataset: set.dataset,
      instructions: 'Rate every case from the images alone, using the rubric in evaluation/HUMAN_REVIEW.md. Do not look at the first review or at any model output before you finish. Hand the finished sheet back; do not run the merge yourself.',
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
 * Pure: the input set is not modified. Any problem stops the whole merge: a
 * sheet is added completely or not at all.
 */
function mergeSheet(set, sheet) {
  const refused = (problems) => ({ set, problems, differences: [], added: [] })
  if (!sheet || typeof sheet !== 'object') return refused(['the sheet is not a JSON object'])

  const problems = []
  if (sheet.format !== SHEET_FORMAT) problems.push(`the sheet is not a ${SHEET_FORMAT} file`)
  if (sheet.dataset !== set.dataset) problems.push(`the sheet was made for dataset "${sheet.dataset}", not for "${set.dataset}"`)
  const reviewer = sheet.reviewer && sheet.reviewer.id
  if (typeof reviewer !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(reviewer)) problems.push('reviewer.id must be a short identifier (lower case letters, digits, "-" or "_"), not a name or an email address')
  if (!isCalendarDate(sheet.reviewed_on)) problems.push('reviewed_on must be a real date written as YYYY-MM-DD')
  if (!Array.isArray(sheet.cases) || sheet.cases.length === 0) problems.push('the sheet has no cases')
  if (problems.length > 0) return refused(problems)

  const byId = new Map(set.references.map((reference) => [reference.case_id, reference]))
  const additions = new Map()
  const differences = []
  for (const [index, entry] of sheet.cases.entries()) {
    if (!entry || typeof entry !== 'object' || typeof entry.case_id !== 'string') { problems.push(`entry ${index + 1} of the sheet is not a case`); continue }
    const at = `case ${entry.case_id}`
    if (additions.has(entry.case_id)) { problems.push(`${at}: appears twice in the sheet`); continue }
    const reference = byId.get(entry.case_id)
    if (!reference) { problems.push(`${at}: no such reference`); continue }
    if (!reviewable(reference)) { problems.push(`${at}: the first review is not a finished human review`); continue }
    if (reference.reviewer && reference.reviewer.id === reviewer) { problems.push(`${at}: "${reviewer}" did the first review; a second review is by another person`); continue }
    const existing = reference.second_reviews || []
    if (existing.some((review) => review.reviewer.id === reviewer)) { problems.push(`${at}: "${reviewer}" has already given a second review`); continue }
    if (existing.length >= LIMITS.secondReviews) { problems.push(`${at}: already has ${LIMITS.secondReviews} second reviews, the most a reference holds`); continue }

    // The review must be about the files the first review was about.
    const recorded = new Map((reference.images || []).map((image) => [image.path, image.sha256]))
    const changed = (Array.isArray(entry.images) ? entry.images : []).filter((image) => image && image.sha256 !== undefined && recorded.get(image.path) !== image.sha256)
    if (changed.length > 0) { problems.push(`${at}: the sheet was made for other image files than the first review recorded (${changed.map((image) => image.path).join(', ')})`); continue }

    const ratings = {}
    let complete = true
    for (const key of DIMENSIONS) {
      const given = entry.dimension_ratings && entry.dimension_ratings[key]
      const rating = given && given.rating
      if (!RATINGS.includes(rating)) { problems.push(`${at}: ${key} is not rated (use one of: ${RATINGS.join(', ')})`); complete = false; continue }
      if (given.note !== undefined && (typeof given.note !== 'string' || given.note.length > LIMITS.dimensionNote)) { problems.push(`${at}: the note on ${key} must be text of at most ${LIMITS.dimensionNote} characters`); complete = false; continue }
      ratings[key] = typeof given.note === 'string' && given.note.length > 0 ? { rating, note: given.note } : { rating }
    }
    if (entry.notes !== undefined && (typeof entry.notes !== 'string' || entry.notes.length > LIMITS.reviewNotes)) { problems.push(`${at}: notes must be text of at most ${LIMITS.reviewNotes} characters`); complete = false }
    if (!complete) continue
    additions.set(entry.case_id, { reviewer: { id: reviewer }, reviewed_on: sheet.reviewed_on, dimension_ratings: ratings, ...(typeof entry.notes === 'string' && entry.notes.length > 0 ? { notes: entry.notes } : {}) })

    // Compared with every review the case already has: the first, and any earlier second review.
    const earlierReviews = [
      { by: 'the first review', ratings: reference.dimension_ratings },
      ...existing.map((review) => ({ by: `the second review by "${review.reviewer.id}"`, ratings: review.dimension_ratings })),
    ]
    for (const earlier of earlierReviews) {
      const differing = DIMENSIONS.filter((key) => earlier.ratings[key].rating !== ratings[key].rating)
      if (differing.length === 0) continue
      differences.push({
        case_id: entry.case_id,
        compared_with: earlier.by,
        dimensions: differing.map((key) => {
          const before = earlier.ratings[key].rating
          const given = ratings[key].rating
          const apart = distance(before, given)
          // Far apart: two bands or more, or one of the two could not judge.
          return { dimension: key, earlier: before, given, far_apart: apart === null || apart >= 2 }
        }),
      })
    }
  }
  if (problems.length > 0) return refused(problems)

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
  process.stdout.write(`${added.length} second review(s) by "${sheet.reviewer.id}"; they differ from an earlier review on ${new Set(differences.map((entry) => entry.case_id)).size} case(s).\n`)
  for (const entry of differences) {
    for (const item of entry.dimensions) process.stdout.write(`  ${entry.case_id}  ${item.dimension}: ${entry.compared_with} "${item.earlier}", this review "${item.given}"${item.far_apart ? '  (far apart: two bands or more, or one could not judge)' : ''}\n`)
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

module.exports = { buildSheet, mergeSheet, styleDnaContext, parse, SHEET_FORMAT, LIMITS }
