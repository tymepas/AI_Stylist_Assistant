#!/usr/bin/env node
/**
 * Writes the case PLAN of the golden dataset:
 *
 *   evaluation/datasets/golden-v1/cases.template.json        the planned cases
 *   evaluation/datasets/golden-v1/references.template.json   one empty review stub per case
 *   evaluation/datasets/golden-v1/CASE_MATRIX.md             every case: mode, Style DNA, abstention, images, how it is reported
 *
 *   node scripts/evaluation/build-golden-plan.cjs          write both files
 *   node scripts/evaluation/build-golden-plan.cjs --check  exit 1 if a committed file differs
 *
 * WHAT THIS IS, AND WHAT IT IS NOT
 * The plan says which cases a balanced benchmark needs: what each image should
 * show, for which occasion, in which garment mode. It contains NO image, NO
 * review, NO rating and NO expected verdict. Every description starts with
 * "PLANNED, no image yet", and every review stub is `unreviewed` / `pending`.
 * Nothing here is evidence about anything until a person has sourced the
 * images and reviewed them (evaluation/HUMAN_REVIEW.md).
 *
 * WHAT THE PLAN GUARANTEES
 * - At least ten CASES in each garment mode, with margin in the two multi-image
 *   modes: 21 single, 12 views of one garment, 12 outfits. Each multi-image mode
 *   has two RESERVE cases beyond the ten its figures need, so that one case
 *   without a complete output does not cost the mode its figures. A reserve is
 *   an ordinary case in every respect; the word only says why it was added.
 *   Images are not cases: an outfit of three items is one.
 * - Ten comparison pairs. Garment g01 … g10 each appear twice, once as a single
 *   photo and once as several views, for the same occasion. A pair shares its
 *   image files, so both cases show the same garment by construction.
 * - Fourteen cases carry an invented Style DNA profile: six single, four
 *   multi-view, four outfits. Style DNA is a CONDITION on a case, not a garment
 *   mode: each of these cases is counted in exactly one mode. Both cases of a
 *   pair carry the same profile, or neither does, so a pair differs only in the
 *   number of photos. Four of the fourteen are the second half of a pair, so
 *   the fourteen cases are ten different photo-and-garment combinations.
 *   Only aesthetic-only personas are used next to real photos (see
 *   style-dna-personas.cjs). No personal profile is ever part of this data.
 *
 * WHAT THE PLAN DOES NOT GIVE
 * - Margin for the comparison pairs. There are exactly ten, and a reserve case
 *   has no single-photo twin. One pair without a complete output on both sides
 *   puts "one photo against several" back to "too few to conclude".
 * - Independence. The two cases of a pair share photo, garment and occasion.
 *   They are two cases, and they are not two independent observations.
 * - Separate figures by Style DNA for every garment mode. A report gives a
 *   figure for each condition where that condition has ten cases, and says
 *   "unavailable" where it has not. In this plan that is: overall with and
 *   without Style DNA, and single-garment cases without it. The multi-image
 *   modes have eight cases without and four with, too few for a separate
 *   figure, so their figures are pooled and labelled as pooled.
 * - Every case is `public_license`: the only source whose model output a
 *   recording may store, and so the only one that can be scored.
 *
 * Expected verdict bands are left empty on purpose. Which band is acceptable is
 * a judgement about the actual image, and belongs to the reviewer.
 */

const { readFileSync, writeFileSync } = require('node:fs')
const path = require('node:path')
const { AESTHETIC_ONLY, styleDna } = require('./style-dna-personas.cjs')
const { plan: planStubs } = require('./review-stubs.cjs')

const OUT_DIR = path.resolve(__dirname, '..', '..', 'evaluation', 'datasets', 'golden-v1')
const PLANNED = 'PLANNED, no image yet: '

const PROFILE = {
  minimal: { preferredStyles: ['Minimal', 'Classic'], favoriteColors: ['Navy', 'White', 'Grey'], occasionPreferences: [] },
  bold: { preferredStyles: ['Bold', 'Trendy'], favoriteColors: ['Red', 'Orange', 'Yellow'], occasionPreferences: [] },
  street: { preferredStyles: ['Streetwear', 'Casual'], favoriteColors: ['Black', 'Grey'], occasionPreferences: [] },
  classic: { preferredStyles: ['Classic', 'Elegant'], favoriteColors: ['Navy', 'Black', 'Beige'], occasionPreferences: [] },
}

/**
 * Ten garments, each photographed from two or three angles. Every garment gives
 * two cases: `<id>-single` (the first view only) and `<id>-views` (all views).
 */
const PAIRS = [
  { id: 'g01', garment: 'a navy tailored blazer', occasion: 'Corporate Interview', profile: 'classic', views: ['front', 'back'], fit: 'a clear match' },
  { id: 'g02', garment: 'a pastel midi dress', occasion: 'Wedding Guest', profile: 'classic', views: ['front', 'back'], fit: 'a clear match' },
  { id: 'g03', garment: 'a plain white shirt', occasion: 'Office Work', profile: 'minimal', views: ['front', 'back'], fit: 'a clear match', dna: 'persona-minimal-aesthetic' },
  { id: 'g04', garment: 'a pair of plain trainers', occasion: 'Casual Outing', profile: 'street', views: ['side', 'top', 'back'], fit: 'a clear match' },
  { id: 'g05', garment: 'a long winter coat', occasion: 'Winter Event', profile: 'classic', views: ['front', 'side', 'back'], fit: 'a clear match' },
  { id: 'g06', garment: 'a hoodie', occasion: 'Client Meeting', profile: 'street', views: ['front', 'back'], fit: 'a clear mismatch', dna: 'persona-bold-aesthetic' },
  { id: 'g07', garment: 'a sequinned evening dress', occasion: 'Shopping', profile: 'classic', views: ['front', 'side', 'back'], fit: 'a clear mismatch' },
  { id: 'g08', garment: 'a bold all-over print shirt', occasion: 'Corporate Interview', profile: 'minimal', views: ['front', 'back'], fit: 'a clear mismatch', dna: 'persona-minimal-aesthetic' },
  { id: 'g09', garment: 'a heavy overcoat', occasion: 'Summer Event', profile: 'classic', views: ['front', 'back'], fit: 'a clear mismatch' },
  { id: 'g10', garment: 'a denim jacket', occasion: 'Formal Dinner', profile: 'bold', views: ['front', 'side', 'back'], fit: 'a clear mismatch', dna: 'persona-bold-aesthetic' },
]

/**
 * Further single-photo cases: borderline fits, image quality, ambiguous detail, text in the image, insufficient input.
 * Their ids are neutral on purpose (s01 to s11). An id travels with the case to every reviewer, and a name such as
 * "borderline" or "blurred" would tell them what the planner expected before they have looked at the image.
 */
const SINGLES = [
  { id: 's01', category: 'clear', scenario: 'formal', occasion: 'Formal Dinner', profile: 'classic', dna: 'persona-minimal-aesthetic', brief: 'a dark suit shown without a tie; a borderline fit, where two careful reviewers may differ by one band' },
  { id: 's02', category: 'clear', scenario: 'office', occasion: 'Business Casual', profile: 'minimal', dna: 'persona-bold-aesthetic', brief: 'dark jeans with a smart shirt; a borderline fit, where two careful reviewers may differ by one band' },
  { id: 's03', category: 'lighting', scenario: 'low_confidence', occasion: 'Dinner Date', profile: 'minimal', brief: 'a shirt photographed under strong warm indoor light, so its true colour is uncertain' },
  { id: 's04', category: 'blur', scenario: 'low_confidence', occasion: 'Conference', profile: 'classic', brief: 'a jacket photographed out of focus, so its details cannot be made out' },
  { id: 's05', category: 'occluded', scenario: 'low_confidence', occasion: 'Client Presentation', profile: 'classic', brief: 'a garment half hidden behind another object, so its cut cannot be seen' },
  { id: 's06', category: 'difficult_colour', scenario: 'colour', occasion: 'Networking Event', profile: 'minimal', brief: 'a dark jacket that could be navy or black; list the colours you cannot tell apart in the review' },
  { id: 's07', category: 'ambiguous_detail', scenario: 'ambiguous_detail', occasion: 'Winter Event', profile: 'classic', brief: 'a coat whose thickness cannot be told from the photo; list the hidden details as unverifiable_terms in the review' },
  { id: 's08', category: 'product_claims_text', scenario: 'product_claims', occasion: 'Shopping', profile: 'minimal', brief: 'a garment with a readable price or brand tag; add the words on the tag as expected.forbidden_claims once you have the image' },
  { id: 's09', category: 'adversarial_text', scenario: 'adversarial', occasion: 'Office Work', profile: 'minimal', brief: 'a garment printed with a slogan that reads as an instruction or a judgement; add its words as expected.forbidden_claims, and name a twin case if you have the same garment without the text' },
  { id: 's10', category: 'insufficient_input', scenario: 'missing_input', occasion: 'Wedding Guest', profile: 'classic', abstain: true, brief: 'the personal photo shows no person (a landscape or an object); the garment photo is an ordinary garment' },
  { id: 's11', category: 'insufficient_input', scenario: 'missing_input', occasion: 'Office Work', profile: 'minimal', abstain: true, brief: 'the garment photo shows no garment (an empty table or a wall); the personal photo is an ordinary photo of a person' },
]

/**
 * Two further garments, as several views only. They are the RESERVE cases of the multi-view mode: ordinary cases
 * that give the mode margin above ten. They have no single-photo twin, so they add nothing to the comparison pairs.
 */
const RESERVE_VIEWS = [
  { id: 'g11', garment: 'a plain knit jumper', occasion: 'Coffee Date', profile: 'minimal', views: ['front', 'back'], fit: 'a clear match' },
  { id: 'g12', garment: 'a pair of tailored trousers', occasion: 'Beach', profile: 'classic', views: ['front', 'side'], fit: 'a clear mismatch' },
]

/** Ten outfits of two or three separately photographed items, and two reserve outfits (o11, o12). */
const OUTFITS = [
  { id: 'o01', items: ['shirt', 'trousers', 'blazer'], occasion: 'Client Meeting', profile: 'classic', fit: 'a coherent business outfit' },
  { id: 'o02', items: ['tee', 'jeans', 'trainers'], occasion: 'Weekend', profile: 'street', fit: 'a coherent relaxed outfit' },
  { id: 'o03', items: ['dress', 'heels'], occasion: 'Cocktail Party', profile: 'classic', fit: 'a coherent evening outfit' },
  { id: 'o04', items: ['kurta', 'trousers'], occasion: 'Wedding Guest', profile: 'classic', fit: 'a coherent festive outfit', dna: 'persona-minimal-aesthetic' },
  { id: 'o05', items: ['coat', 'knit', 'boots'], occasion: 'Winter Event', profile: 'classic', fit: 'a coherent cold-weather outfit' },
  { id: 'o06', items: ['blazer', 'athletic-shorts'], occasion: 'Business Lunch', profile: 'minimal', fit: 'two items at different levels of formality', dna: 'persona-minimal-aesthetic' },
  { id: 'o07', items: ['suit', 'trainers'], occasion: 'Corporate Interview', profile: 'classic', fit: 'one item out of step with the setting' },
  { id: 'o08', items: ['hoodie', 'tailored-trousers', 'loafers'], occasion: 'Client Presentation', profile: 'street', fit: 'one item too casual for the setting', dna: 'persona-bold-aesthetic' },
  { id: 'o09', items: ['top', 'trousers'], occasion: 'Birthday Party', profile: 'bold', fit: 'two items in competing strong colours', dna: 'persona-bold-aesthetic' },
  { id: 'o10', items: ['shirt', 'shorts', 'sandals'], occasion: 'Beach', profile: 'minimal', fit: 'a coherent warm-weather outfit' },
  // Reserve outfits: ordinary cases that give the mode margin above ten.
  { id: 'o11', items: ['polo-shirt', 'chinos'], occasion: 'Business Casual', profile: 'minimal', fit: 'a coherent smart casual outfit', reserve: true },
  { id: 'o12', items: ['formal-shirt', 'track-pants'], occasion: 'Wedding Reception', profile: 'classic', fit: 'one item far too casual for the setting', reserve: true },
]

function withDna(benchmarkCase, persona) {
  if (!persona) return benchmarkCase
  if (!AESTHETIC_ONLY.includes(persona)) throw new Error(`${benchmarkCase.id}: only an aesthetic-only persona may go with a real photo`)
  return { ...benchmarkCase, style_dna: styleDna(persona) }
}

function buildCases() {
  const cases = []
  const groups = new Map()
  const reserves = new Set()

  for (const pair of PAIRS) {
    const files = pair.views.map((view) => `${pair.id}/garment-${view}.jpg`)
    const shared = { source: 'public_license', photo: `${pair.id}/photo.jpg`, garment: files[0], occasion: pair.occasion, style_profile: PROFILE[pair.profile], expected: {} }
    const dnaNote = pair.dna ? ' Sent with an invented Style DNA profile.' : ''
    cases.push(withDna({
      id: `gv-${pair.id}-single`,
      category: 'clear',
      description: `${PLANNED}${pair.garment}, ${pair.views[0]} view only; ${pair.fit} for the occasion. Uses the same files as gv-${pair.id}-views.${dnaNote}`,
      ...shared,
      scenario: 'garment_views',
    }, pair.dna))
    cases.push(withDna({
      id: `gv-${pair.id}-views`,
      category: 'single_garment',
      description: `${PLANNED}${pair.garment} seen from ${pair.views.length} angles (${pair.views.join(', ')}); the same garment, photo and occasion as gv-${pair.id}-single.${dnaNote}`,
      ...shared,
      scenario: 'garment_views',
      garment_mode: 'same_garment_views',
      extra_garments: files.slice(1),
    }, pair.dna))
    groups.set(`gv-${pair.id}-single`, pair.id)
    groups.set(`gv-${pair.id}-views`, pair.id)
  }

  for (const garment of RESERVE_VIEWS) {
    const files = garment.views.map((view) => `${garment.id}/garment-${view}.jpg`)
    cases.push({
      id: `gv-${garment.id}-views`,
      category: 'single_garment',
      description: `${PLANNED}${garment.garment} seen from ${garment.views.length} angles (${garment.views.join(', ')}); ${garment.fit} for the occasion. Reserve case: it gives the multi-view mode margin above ten cases and has no single-photo twin.`,
      source: 'public_license',
      photo: `${garment.id}/photo.jpg`,
      garment: files[0],
      occasion: garment.occasion,
      style_profile: PROFILE[garment.profile],
      expected: {},
      scenario: 'garment_views',
      garment_mode: 'same_garment_views',
      extra_garments: files.slice(1),
    })
    reserves.add(`gv-${garment.id}-views`)
  }

  for (const single of SINGLES) {
    cases.push(withDna({
      id: `gv-${single.id}`,
      category: single.category,
      description: `${PLANNED}${single.brief}.${single.dna ? ' Sent with an invented Style DNA profile.' : ''}`,
      source: 'public_license',
      photo: `${single.id}/photo.jpg`,
      garment: `${single.id}/garment-1.jpg`,
      occasion: single.occasion,
      style_profile: PROFILE[single.profile],
      expected: single.abstain ? { should_abstain: true } : {},
      scenario: single.scenario,
    }, single.dna))
  }

  for (const outfit of OUTFITS) {
    const files = outfit.items.map((item, index) => `${outfit.id}/garment-${index + 1}-${item}.jpg`)
    cases.push(withDna({
      id: `gv-${outfit.id}-outfit`,
      category: 'multiple_garments',
      description: `${PLANNED}${outfit.items.length} items photographed separately (${outfit.items.join(', ').replace(/-/g, ' ')}); ${outfit.fit}. Record the garment type of each item in the review.${outfit.dna ? ' Sent with an invented Style DNA profile.' : ''}${outfit.reserve ? ' Reserve case: it gives the outfit mode margin above ten cases.' : ''}`,
      source: 'public_license',
      photo: `${outfit.id}/photo.jpg`,
      garment: files[0],
      occasion: outfit.occasion,
      style_profile: PROFILE[outfit.profile],
      expected: {},
      scenario: 'outfit_items',
      garment_mode: 'outfit_items',
      extra_garments: files.slice(1),
    }, outfit.dna))
    if (outfit.reserve) reserves.add(`gv-${outfit.id}-outfit`)
  }

  return { cases, groups, reserves }
}

// ---------------------------------------------------------------------------
// Case matrix
// ---------------------------------------------------------------------------

/** Fewest cases a figure needs. The same number as MIN_SAMPLE in evaluation/quality.ts; a test keeps them equal. */
const MIN_CASES = 10
const MODES = ['single', 'same_garment_views', 'outfit_items']
const MODE_LABEL = { single: 'single garment', same_garment_views: 'views of one garment', outfit_items: 'outfit items' }

function modeOf(planCase) {
  return planCase.garment_mode || 'single'
}

/** Whether a planned case is expected to return ratings. A case that should abstain returns none. */
function givesRatings(planCase) {
  return !planCase.expected.should_abstain
}

/**
 * How many planned cases can give ratings, by Style DNA condition and garment mode. A separate figure for a
 * condition exists only where that condition has at least MIN_CASES such cases; otherwise it reads "unavailable".
 */
function conditionCounts(cases) {
  const counts = { with: { all: 0 }, without: { all: 0 } }
  for (const mode of MODES) { counts.with[mode] = 0; counts.without[mode] = 0 }
  for (const planCase of cases.filter(givesRatings)) {
    const condition = planCase.style_dna ? 'with' : 'without'
    counts[condition].all += 1
    counts[condition][modeOf(planCase)] += 1
  }
  return counts
}

function matrixRows(cases, groups, reserves) {
  const counts = conditionCounts(cases)
  return cases.map((planCase) => {
    const mode = modeOf(planCase)
    const condition = planCase.style_dna ? 'with' : 'without'
    const garments = 1 + (planCase.extra_garments || []).length
    const rated = givesRatings(planCase)
    const separate = (n) => (n >= MIN_CASES ? `separate (${n} cases)` : `unavailable (${n} cases)`)
    return {
      id: planCase.id,
      mode,
      styleDna: planCase.style_dna ? planCase.style_dna.persona : null,
      abstain: Boolean(planCase.expected.should_abstain),
      rated,
      images: 1 + garments,
      garments,
      pair: groups.get(planCase.id) || null,
      reserve: reserves.has(planCase.id),
      // Every case is part of the pooled figures. Its condition-specific figures exist only where the sample allows.
      overall: rated ? separate(counts[condition].all) : null,
      inMode: rated ? separate(counts[condition][mode]) : null,
    }
  })
}

function renderMatrix(cases, groups, reserves) {
  const rows = matrixRows(cases, groups, reserves)
  const counts = conditionCounts(cases)
  const total = (of) => rows.filter(of).length
  const byMode = (of) => MODES.map((mode) => total((row) => row.mode === mode && of(row)))
  const line = (cells) => `| ${cells.join(' | ')} |`
  const yes = (value) => (value ? 'Yes' : 'No')

  const out = [
    '# Golden dataset v1: case matrix',
    '',
    'Generated by `npm run eval:build-golden-plan` from the case plan. Do not edit by hand; a test fails if it differs.',
    '',
    '**This is a plan.** No image exists yet, no case has been reviewed and no model has been called. The matrix says',
    'what each planned case is and how its results would be reported. It contains no rating and no result.',
    '',
    '## How to read it',
    '',
    '- **Garment mode** is one of three. **Style DNA is not a mode.** It is a condition on a case: a case with a',
    '  profile is counted in exactly one garment mode, like any other case.',
    '- **Images** is the number of images in the request: one personal photo plus the garment images.',
    '  Images are never a sample size. Every sample size counts cases.',
    '- **Abstain expected**: the inputs are insufficient on purpose, and the right answer is to decline.',
    '- **Gives ratings**: whether the case can contribute to the figures that compare ratings with a review',
    '  (agreement, calibration, grounding). A case that should abstain gives none. It still counts in output',
    '  validity and in the abstention figures.',
    '- **Reported as** says where the results of the case appear:',
    '  - *Pooled* figures combine cases with and without Style DNA. Every pooled figure is labelled as pooled in a report.',
    `  - A *separate* figure for one condition exists where that condition has at least ${MIN_CASES} cases that give ratings.`,
    '    Where it has fewer, the separate figure reads "unavailable" and only the pooled figure exists.',
    '',
    '## Totals',
    '',
    line(['', 'Single garment', 'Views of one garment', 'Outfit items', 'Total']),
    '|---|---|---|---|---|',
    line(['Cases', ...byMode(() => true), rows.length]),
    line(['of which reserve cases', ...byMode((row) => row.reserve), total((row) => row.reserve)]),
    line(['Expected to abstain', ...byMode((row) => row.abstain), total((row) => row.abstain)]),
    line(['Give ratings', ...byMode((row) => row.rated), total((row) => row.rated)]),
    line(['Give ratings, without Style DNA', ...MODES.map((mode) => counts.without[mode]), counts.without.all]),
    line(['Give ratings, with Style DNA', ...MODES.map((mode) => counts.with[mode]), counts.with.all]),
    line(['Images in the requests', ...MODES.map((mode) => rows.filter((row) => row.mode === mode).reduce((sum, row) => sum + row.images, 0)), rows.reduce((sum, row) => sum + row.images, 0)]),
    '',
    '## Which figures are separate and which are pooled',
    '',
    line(['Figure', 'Without Style DNA', 'With Style DNA', 'Both together']),
    '|---|---|---|---|',
    line(['All cases that give ratings', `${counts.without.all}: ${counts.without.all >= MIN_CASES ? 'separate figure' : 'unavailable'}`, `${counts.with.all}: ${counts.with.all >= MIN_CASES ? 'separate figure' : 'unavailable'}`, `${counts.without.all + counts.with.all}: pooled, labelled`]),
    ...MODES.map((mode) => line([`${MODE_LABEL[mode][0].toUpperCase()}${MODE_LABEL[mode].slice(1)}`, `${counts.without[mode]}: ${counts.without[mode] >= MIN_CASES ? 'separate figure' : 'unavailable'}`, `${counts.with[mode]}: ${counts.with[mode] >= MIN_CASES ? 'separate figure' : 'unavailable'}`, `${counts.without[mode] + counts.with[mode]}: pooled, labelled`])),
    line(['Comparison pairs (one photo against several)', `${new Set(rows.filter((row) => row.pair && !row.styleDna).map((row) => row.pair)).size} pairs: unavailable`, `${new Set(rows.filter((row) => row.pair && row.styleDna).map((row) => row.pair)).size} pairs: unavailable`, `${new Set(rows.filter((row) => row.pair).map((row) => row.pair)).size} pairs: pooled, labelled, no margin`]),
    line(['Shopping Advisor: usable block', 'not applicable', `${counts.with.all}: with Style DNA only, by definition`, 'not applicable']),
    line(['Shopping Advisor: unrequested recommendations', `${counts.without.all}: without Style DNA only, by definition`, 'not applicable', 'not applicable']),
    line(['Abstention on insufficient input', `${total((row) => row.abstain)} cases: too few to conclude`, '0', 'not applicable']),
    '',
    'These counts assume that every case is reviewed and returns a complete output. A case that fails lowers them.',
    'The two cases of a comparison pair share their photo, garment and occasion: they are two cases and not two',
    'independent observations.',
    '',
    '## Every case',
    '',
    line(['Case', 'Garment mode', 'Images', 'Style DNA', 'Abstain expected', 'Gives ratings', 'Pair', 'Reported as']),
    '|---|---|---|---|---|---|---|---|',
    ...rows.map((row) => line([
      `\`${row.id}\`${row.reserve ? ' (reserve)' : ''}`,
      MODE_LABEL[row.mode],
      `${row.images} (1 photo + ${row.garments})`,
      row.styleDna ? `On (${row.styleDna.replace('persona-', '')})` : 'Off',
      yes(row.abstain),
      yes(row.rated),
      row.pair || 'none',
      row.rated
        ? `Pooled. ${row.styleDna ? 'With' : 'Without'} Style DNA: overall ${row.overall}; ${MODE_LABEL[row.mode]} ${row.inMode}`
        : 'Output validity and abstention only. No ratings, so no agreement figure',
    ])),
    '',
  ]
  return `${out.join('\n')}`
}

function build() {
  const { cases, groups, reserves } = buildCases()
  const manifest = { version: 1, cases }
  // The same stubs the reviewer's own command would write, with no image directory: nothing is hashed, nothing is rated.
  const { stubs } = planStubs(manifest, { references: [] }, undefined)
  const references = stubs.map((stub) => (groups.has(stub.case_id) ? { ...stub, comparison_group: groups.get(stub.case_id) } : stub))
  return {
    'cases.template.json': `${JSON.stringify(manifest, null, 2)}\n`,
    'references.template.json': `${JSON.stringify({ format: 'verdict-reference-set/1', dataset: 'golden-v1', dataset_version: '0.3.0', references }, null, 2)}\n`,
    'CASE_MATRIX.md': renderMatrix(cases, groups, reserves),
  }
}

function main() {
  const files = build()
  if (process.argv.includes('--check')) {
    const stale = Object.entries(files).filter(([name, content]) => {
      try { return readFileSync(path.join(OUT_DIR, name), 'utf8').replace(/\r\n/g, '\n') !== content } catch { return true }
    })
    if (stale.length > 0) {
      process.stderr.write(`Out of date: ${stale.map(([name]) => name).join(', ')}. Run node scripts/evaluation/build-golden-plan.cjs\n`)
      return 1
    }
    process.stdout.write('The golden case plan is up to date.\n')
    return 0
  }
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(OUT_DIR, name), content)
  process.stdout.write(`Wrote a plan of ${JSON.parse(files['cases.template.json']).cases.length} cases to ${path.relative(process.cwd(), OUT_DIR)}. No image, review or rating was written.\n`)
  return 0
}

module.exports = { build, buildCases, matrixRows, conditionCounts, PAIRS, RESERVE_VIEWS, SINGLES, OUTFITS, OUT_DIR, PLANNED, MIN_CASES }

if (require.main === module) process.exit(main())
