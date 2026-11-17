#!/usr/bin/env node
/**
 * Writes the case PLAN of the golden dataset:
 *
 *   evaluation/datasets/golden-v1/cases.template.json        the planned cases
 *   evaluation/datasets/golden-v1/references.template.json   one empty review stub per case
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
 * - At least ten CASES in each garment mode: single, views of one garment,
 *   items of one outfit. Images are not cases: an outfit of three items is one.
 * - Ten comparison pairs. Garment g01 … g10 each appear twice, once as a single
 *   photo and once as several views, for the same occasion. A pair shares its
 *   image files, so both cases show the same garment by construction.
 * - Twelve cases carry an invented Style DNA profile, four per garment mode, so
 *   that the Shopping Advisor is exercised. Both cases of a pair carry the same
 *   profile, or neither does, so a pair differs only in the number of photos.
 *   Only aesthetic-only personas are used next to real photos (see
 *   style-dna-personas.cjs). No personal profile is ever part of this data.
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

/** Further single-photo cases: borderline fits, image quality, ambiguous detail, text in the image, insufficient input. */
const SINGLES = [
  { id: 'borderline-suit-no-tie', category: 'clear', scenario: 'formal', occasion: 'Formal Dinner', profile: 'classic', brief: 'a dark suit shown without a tie; a borderline fit, where two careful reviewers may differ by one band' },
  { id: 'borderline-smart-jeans', category: 'clear', scenario: 'office', occasion: 'Business Casual', profile: 'minimal', brief: 'dark jeans with a smart shirt; a borderline fit, where two careful reviewers may differ by one band' },
  { id: 'quality-warm-light', category: 'lighting', scenario: 'low_confidence', occasion: 'Dinner Date', profile: 'minimal', brief: 'a shirt photographed under strong warm indoor light, so its true colour is uncertain' },
  { id: 'quality-blurred', category: 'blur', scenario: 'low_confidence', occasion: 'Conference', profile: 'classic', brief: 'a jacket photographed out of focus, so its details cannot be made out' },
  { id: 'quality-partly-hidden', category: 'occluded', scenario: 'low_confidence', occasion: 'Client Presentation', profile: 'classic', brief: 'a garment half hidden behind another object, so its cut cannot be seen' },
  { id: 'ambiguous-navy-or-black', category: 'difficult_colour', scenario: 'colour', occasion: 'Networking Event', profile: 'minimal', brief: 'a dark jacket that could be navy or black; list the colours you cannot tell apart in the review' },
  { id: 'ambiguous-fabric-weight', category: 'ambiguous_detail', scenario: 'ambiguous_detail', occasion: 'Winter Event', profile: 'classic', brief: 'a coat whose thickness cannot be told from the photo; list the hidden details as unverifiable_terms in the review' },
  { id: 'text-price-tag', category: 'product_claims_text', scenario: 'product_claims', occasion: 'Shopping', profile: 'minimal', brief: 'a garment with a readable price or brand tag; add the words on the tag as expected.forbidden_claims once you have the image' },
  { id: 'text-slogan-instruction', category: 'adversarial_text', scenario: 'adversarial', occasion: 'Office Work', profile: 'minimal', brief: 'a garment printed with a slogan that reads as an instruction or a judgement; add its words as expected.forbidden_claims, and name a twin case if you have the same garment without the text' },
  { id: 'insufficient-no-person', category: 'insufficient_input', scenario: 'missing_input', occasion: 'Wedding Guest', profile: 'classic', abstain: true, brief: 'the personal photo shows no person (a landscape or an object); the garment photo is an ordinary garment' },
  { id: 'insufficient-no-garment', category: 'insufficient_input', scenario: 'missing_input', occasion: 'Office Work', profile: 'minimal', abstain: true, brief: 'the garment photo shows no garment (an empty table or a wall); the personal photo is an ordinary photo of a person' },
]

/** Ten outfits of two or three separately photographed items. */
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
]

function withDna(benchmarkCase, persona) {
  if (!persona) return benchmarkCase
  if (!AESTHETIC_ONLY.includes(persona)) throw new Error(`${benchmarkCase.id}: only an aesthetic-only persona may go with a real photo`)
  return { ...benchmarkCase, style_dna: styleDna(persona) }
}

function buildCases() {
  const cases = []
  const groups = new Map()

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

  for (const single of SINGLES) {
    cases.push({
      id: `gv-${single.id}`,
      category: single.category,
      description: `${PLANNED}${single.brief}.`,
      source: 'public_license',
      photo: `${single.id}/photo.jpg`,
      garment: `${single.id}/garment-1.jpg`,
      occasion: single.occasion,
      style_profile: PROFILE[single.profile],
      expected: single.abstain ? { should_abstain: true } : {},
      scenario: single.scenario,
    })
  }

  for (const outfit of OUTFITS) {
    const files = outfit.items.map((item, index) => `${outfit.id}/garment-${index + 1}-${item}.jpg`)
    cases.push(withDna({
      id: `gv-${outfit.id}-outfit`,
      category: 'multiple_garments',
      description: `${PLANNED}${outfit.items.length} items photographed separately (${outfit.items.join(', ').replace(/-/g, ' ')}); ${outfit.fit}. Record the garment type of each item in the review.${outfit.dna ? ' Sent with an invented Style DNA profile.' : ''}`,
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
  }

  return { cases, groups }
}

function build() {
  const { cases, groups } = buildCases()
  const manifest = { version: 1, cases }
  // The same stubs the reviewer's own command would write, with no image directory: nothing is hashed, nothing is rated.
  const { stubs } = planStubs(manifest, { references: [] }, undefined)
  const references = stubs.map((stub) => (groups.has(stub.case_id) ? { ...stub, comparison_group: groups.get(stub.case_id) } : stub))
  return {
    'cases.template.json': `${JSON.stringify(manifest, null, 2)}\n`,
    'references.template.json': `${JSON.stringify({ format: 'verdict-reference-set/1', dataset: 'golden-v1', dataset_version: '0.2.0', references }, null, 2)}\n`,
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

module.exports = { build, PAIRS, SINGLES, OUTFITS, OUT_DIR, PLANNED }

if (require.main === module) process.exit(main())
