#!/usr/bin/env node
/**
 * Builds the synthetic scenario dataset in evaluation/datasets/scenarios-v1/.
 *
 *   node scripts/evaluation/build-scenarios.cjs          write cases.json and recording.json
 *   node scripts/evaluation/build-scenarios.cjs --check  exit 1 if the committed files differ
 *
 * WHAT THIS DATASET IS
 * Each case is a written scenario brief plus a hand-specified REFERENCE OUTPUT:
 * the ratings and confidence a careful answer to that brief would give. No image
 * exists for any case, no model produced any output, and nothing was timed or
 * billed. The dataset checks Verdict's own code (schema validation, the
 * deterministic verdict, safety screening, uncertainty handling) against
 * realistic output shapes, and gives a baseline to detect regressions against.
 * It is NOT evidence about the quality of any model.
 *
 * The ratings below are the source of truth. Explanation text is filled in from
 * neutral templates so that it never states a fact about an image that does not
 * exist; a case overrides a template only to describe its own brief.
 *
 * Expected bands are written from the intent of the scenario. They are never
 * computed here: the evaluation computes every verdict with the production code.
 */

const { createHash } = require('node:crypto')
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs')
const path = require('node:path')

const OUT_DIR = path.resolve(__dirname, '..', '..', 'evaluation', 'datasets', 'scenarios-v1')
const DIMENSIONS = ['occasion', 'color', 'formality', 'seasonality', 'style', 'style_preference_match']
const RATING = { E: 'Excellent', G: 'Good', F: 'Fair', P: 'Poor', U: 'Unable to Evaluate' }
const CONFIDENCE = { H: 'High', M: 'Medium', L: 'Low' }
const HR = 'Highly Recommended'
const R = 'Recommended'
const CA = 'Consider Alternatives'
const NR = 'Not Recommended'

/** Neutral explanation templates, by dimension and rating. `{g}` is the garment phrase, `{o}` the occasion. */
const REASONS = {
  occasion: {
    E: 'The {g} suits a {o} well; the overall look matches what this occasion usually calls for.',
    G: 'The {g} is a reasonable choice for a {o}, with only minor points to check.',
    F: 'The {g} is borderline for a {o}: it could work with careful styling but is not an obvious fit.',
    P: 'The {g} does not suit a {o}; the look is at odds with what this occasion usually expects.',
    U: 'The photos do not show enough of the {g} to judge how it suits a {o}.',
  },
  color: {
    E: 'The colours of the {g} sit well together and with the tones visible in the personal photo.',
    G: 'The colours work together overall, with one combination that is slightly less settled.',
    F: 'The colour combination is uneven: some tones in the {g} compete rather than support each other.',
    P: 'The colours clash noticeably, and the combination pulls attention away from the look as a whole.',
    U: 'Lighting and image quality leave the colours of the {g} too uncertain to judge.',
  },
  formality: {
    E: 'The level of formality of the {g} matches the setting closely.',
    G: 'The formality is close to what the setting expects, slightly more relaxed or more dressed up than ideal.',
    F: 'The formality is noticeably off for the setting and would need other pieces to balance it.',
    P: 'The {g} is far from the level of formality this setting expects.',
    U: 'Not enough of the {g} is visible to judge its level of formality.',
  },
  seasonality: {
    E: 'The visible weight and coverage of the {g} look appropriate for the season the occasion implies.',
    G: 'The {g} looks workable for the likely season, with small trade-offs in coverage.',
    F: 'The apparent weight of the {g} is only partly suited to the likely season.',
    P: 'The apparent weight and coverage of the {g} look poorly suited to the likely season.',
    U: 'The season cannot be judged from what is visible of the {g}.',
  },
  style: {
    E: 'The pieces form a coherent look with consistent lines and proportions.',
    G: 'The look is mostly coherent, with one element that sits slightly apart.',
    F: 'The look mixes signals: some elements point in different stylistic directions.',
    P: 'The elements do not come together as a coherent look.',
    U: 'Too little is visible to judge whether the look is coherent.',
  },
  style_preference_match: {
    E: 'The {g} is in line with the stated style preferences.',
    G: 'The {g} is broadly in line with the stated style preferences.',
    F: 'The {g} only partly reflects the stated style preferences.',
    P: 'The {g} conflicts with the stated style preferences: it points in a different direction from what was described.',
    U: 'No style preferences were provided, so there is nothing to compare the {g} against.',
  },
}

const PROFILE = {
  minimal: { preferredStyles: ['Minimal', 'Classic'], favoriteColors: ['Navy', 'White', 'Grey'], occasionPreferences: ['Office Work'] },
  bold: { preferredStyles: ['Bold', 'Trendy'], favoriteColors: ['Red', 'Orange', 'Yellow'], occasionPreferences: ['Night Out'] },
  street: { preferredStyles: ['Streetwear', 'Casual'], favoriteColors: ['Black', 'Grey'], occasionPreferences: ['Casual Outing'] },
  classic: { preferredStyles: ['Classic', 'Elegant'], favoriteColors: ['Navy', 'Black', 'Beige'], occasionPreferences: ['Formal Dinner'] },
  none: { preferredStyles: [], favoriteColors: [], occasionPreferences: [] },
}

/**
 * Case definitions.
 *   r: six rating letters, in DIMENSIONS order (E G F P U)
 *   c: six confidence letters (H M L); defaults to all High
 *   g: garment phrase used in the explanation templates
 *   notes: explanation overrides per dimension
 *   abstain: the output is "unable to analyze" with this reason
 *   raw: the complete recorded output, used as written
 */
const CASES = [
  // --- Casual -------------------------------------------------------------
  { id: 'sc-casual-weekend-relaxed', scenario: 'casual', occasion: 'Weekend', description: 'Relaxed tee and straight jeans for a weekend with friends; expected good match.', g: 'relaxed tee and jeans', r: 'EGEGGG', bands: [HR, R], profile: 'street' },
  { id: 'sc-casual-shopping-overdressed', scenario: 'casual', occasion: 'Shopping', description: 'Sequinned evening dress for a daytime shopping trip; far too dressed up.', g: 'sequinned evening dress', r: 'PGPGGG', bands: [CA, NR], profile: 'classic', review: { occasion_suitability: 'Does the explanation say plainly that the dress is too formal for daytime shopping?' } },

  // --- Office and business ------------------------------------------------
  { id: 'sc-office-tailored-blazer', scenario: 'office', occasion: 'Office Work', description: 'Tailored blazer with matching trousers for a regular office day; expected good match.', g: 'tailored blazer and trousers', r: 'EEEGEE', bands: [HR, R], profile: 'classic' },
  { id: 'sc-office-client-meeting-graphic', scenario: 'office', occasion: 'Client Meeting', description: 'Loud graphic shirt for a client meeting; too casual and visually busy.', g: 'bright graphic shirt', r: 'FFPGFG', bands: [CA, NR], profile: 'bold' },
  { id: 'sc-office-corporate-interview-suit', scenario: 'office', occasion: 'Corporate Interview', description: 'Dark two-piece suit with a plain shirt for a corporate interview; expected good match.', g: 'dark two-piece suit', r: 'EEEGEG', bands: [HR, R], profile: 'classic' },

  // --- Formal -------------------------------------------------------------
  { id: 'sc-formal-black-tie-tuxedo', scenario: 'formal', occasion: 'Black Tie Event', description: 'Classic tuxedo for a black tie event; expected good match.', g: 'classic tuxedo', r: 'EEEGEE', bands: [HR, R], profile: 'classic' },
  { id: 'sc-formal-dinner-denim-trainers', scenario: 'formal', occasion: 'Formal Dinner', description: 'Denim and casual trainers for a formal dinner; clearly under-dressed.', g: 'denim and casual trainers', r: 'PGPGFF', bands: [CA, NR], profile: 'classic' },
  { id: 'sc-formal-dinner-borderline', scenario: 'formal', occasion: 'Formal Dinner', description: 'Dark suit worn without a tie and with casual shoes; a borderline case with no expected band.', g: 'dark suit with casual shoes', r: 'GGFGGG', c: 'MHMHMH', bands: [], profile: 'classic', review: { explanation_quality: 'Borderline case: is the reasoning balanced, naming both what works and what does not?' } },

  // --- Weddings and celebrations --------------------------------------------
  { id: 'sc-wedding-guest-pastel-dress', scenario: 'wedding', occasion: 'Wedding Guest', description: 'Pastel midi dress for a daytime wedding; expected good match.', g: 'pastel midi dress', r: 'EEEEEG', bands: [HR, R], profile: 'classic' },
  { id: 'sc-wedding-guest-white-dress', scenario: 'wedding', occasion: 'Wedding Guest', description: 'White floor-length dress as a wedding guest; conflicts with the convention of not wearing bridal white.', g: 'white floor-length dress', r: 'PFGGGG', bands: [CA, NR], profile: 'classic', notes: { occasion: 'A white floor-length dress conflicts with a common wedding guest convention, because it can read as bridal attire.' }, terms: ['wedding', 'bridal'] },
  { id: 'sc-wedding-reception-hoodie', scenario: 'wedding', occasion: 'Wedding Reception', description: 'Hoodie and joggers for a wedding reception; clearly under-dressed.', g: 'hoodie and joggers', r: 'PGPGFF', bands: [CA, NR], profile: 'street' },
  { id: 'sc-wedding-guest-festive-traditional', scenario: 'wedding', occasion: 'Wedding Guest', description: 'Festive traditional outfit for a wedding; expected good match.', g: 'festive traditional outfit', r: 'EEEGEE', bands: [HR, R], profile: 'classic' },

  // --- Parties and evenings -----------------------------------------------
  { id: 'sc-party-cocktail-dress', scenario: 'party', occasion: 'Cocktail Party', description: 'Knee-length cocktail dress for a cocktail party; expected good match.', g: 'knee-length cocktail dress', r: 'EEEGEG', bands: [HR, R], profile: 'classic' },
  { id: 'sc-party-night-out-officewear', scenario: 'party', occasion: 'Night Out', description: 'Plain office shirt and trousers for a night out; acceptable but stiff.', g: 'plain office shirt and trousers', r: 'FGGGGG', bands: [R, CA], profile: 'minimal' },
  { id: 'sc-party-birthday-bright-coord', scenario: 'party', occasion: 'Birthday Party', description: 'Bright matching co-ord set for a birthday party; expected good match.', g: 'bright matching co-ord set', r: 'GEGGEE', bands: [R, HR], profile: 'bold' },

  // --- Seasons --------------------------------------------------------------
  { id: 'sc-season-summer-light-shirt', scenario: 'seasonal', occasion: 'Summer Event', description: 'Light short-sleeved shirt and tailored shorts for a summer event; expected good match.', g: 'light short-sleeved shirt and shorts', r: 'EGGEGG', bands: [HR, R], profile: 'minimal' },
  { id: 'sc-season-summer-heavy-coat', scenario: 'seasonal', occasion: 'Summer Event', description: 'Heavy long overcoat for a summer event; wrong for the season.', g: 'heavy long overcoat', r: 'PGGPGG', bands: [CA, NR], profile: 'classic' },
  { id: 'sc-season-winter-layers', scenario: 'seasonal', occasion: 'Winter Event', description: 'Layered knit and long coat for a winter event; expected good match.', g: 'layered knit and long coat', r: 'GGGEEG', bands: [R, HR], profile: 'classic' },
  { id: 'sc-season-beach-dark-suit', scenario: 'seasonal', occasion: 'Beach', description: 'Full dark suit for a day at the beach; wrong formality and wrong season.', g: 'full dark suit', r: 'PFPPFF', bands: [NR, CA], profile: 'classic' },
  { id: 'sc-season-rainy-light-hem', scenario: 'seasonal', occasion: 'Rainy Day', description: 'Pale trousers with a long trailing hem for a rainy day; impractical for the weather.', g: 'pale long-hemmed trousers', r: 'FFGPGG', bands: [CA], profile: 'minimal' },

  // --- Colour combinations ---------------------------------------------------
  { id: 'sc-colour-tonal-navy', scenario: 'colour', occasion: 'Dinner Date', description: 'Tonal outfit in shades of navy; a harmonious single-colour look.', g: 'tonal navy outfit', r: 'GEGGEG', bands: [R, HR], profile: 'minimal' },
  { id: 'sc-colour-saturated-clash', scenario: 'colour', occasion: 'Coffee Date', description: 'Competing saturated colours; the colour dimension is poor while the rest is fine.', g: 'outfit in competing saturated colours', r: 'GPGGFG', bands: [R, CA], profile: 'bold', review: { explanation_quality: 'Colour carries a small weight. Does the report still name the clash clearly?' } },
  { id: 'sc-colour-navy-or-black', scenario: 'colour', category: 'difficult_colour', occasion: 'Networking Event', description: 'Dark jacket that could be navy or black; the colour cannot be told apart with confidence.', g: 'dark jacket', r: 'GGGGGG', c: 'HLHHHH', bands: [R, HR], profile: 'minimal', uncertainty: { low_confidence_or_unrated: ['color'] }, notes: { color: 'The jacket could be navy or black; the difference cannot be told from the photo, so this rating is tentative.' } },

  // --- Conflicting style preferences ------------------------------------------
  { id: 'sc-pref-minimal-vs-bold-print', scenario: 'preference_conflict', occasion: 'Casual Outing', description: 'The profile prefers minimal styles; the garment is a bold all-over print.', g: 'bold all-over print shirt', r: 'GGGGGP', bands: [R, CA], profile: 'minimal', review: { explanation_quality: 'Is the conflict with the stated preference named directly, not scored around?' } },
  { id: 'sc-pref-bright-vs-interview', scenario: 'preference_conflict', occasion: 'Corporate Interview', description: 'The profile loves bright colours; a bright orange suit matches the preference but strains the occasion.', g: 'bright orange suit', r: 'FFGGGE', bands: [R, CA], profile: 'bold' },
  { id: 'sc-pref-streetwear-vs-black-tie', scenario: 'preference_conflict', occasion: 'Black Tie Event', description: 'The profile prefers streetwear; a tuxedo suits the event but not the stated preference.', g: 'classic tuxedo', r: 'EGEGGP', bands: [R, HR], profile: 'street' },

  // --- Low-confidence image evidence -------------------------------------------
  { id: 'sc-lowconf-blurred-garment', scenario: 'low_confidence', category: 'blur', occasion: 'Conference', description: 'The garment photo is out of focus; details and colour are uncertain.', g: 'blurred jacket', r: 'GGGUGG', c: 'MLMLLM', bands: [], profile: 'minimal', uncertainty: { low_confidence_or_unrated: ['color', 'seasonality'], max_high_confidence_dimensions: 0 } },
  { id: 'sc-lowconf-occluded-garment', scenario: 'low_confidence', category: 'occluded', occasion: 'Client Presentation', description: 'Half of the garment is hidden behind a bag; its cut cannot be seen.', g: 'partly hidden jacket', r: 'GGUGGG', c: 'MMLMLM', bands: [], profile: 'classic', uncertainty: { unrated: ['formality'], low_confidence_or_unrated: ['style'], max_high_confidence_dimensions: 0 } },
  { id: 'sc-lowconf-colour-cast', scenario: 'low_confidence', category: 'lighting', occasion: 'Dinner Date', description: 'Strong warm indoor light gives the whole photo a colour cast.', g: 'shirt under warm light', r: 'GUGGGG', c: 'MLMMMM', bands: [], profile: 'minimal', uncertainty: { unrated: ['color'], max_high_confidence_dimensions: 0 } },

  // --- Missing or incomplete input ----------------------------------------------
  { id: 'sc-missing-no-preferences', scenario: 'missing_input', occasion: 'First Date', description: 'No style preferences were given; the preference dimension cannot be rated.', g: 'smart casual shirt and chinos', r: 'GGGGGU', bands: [R, HR], profile: 'none', uncertainty: { unrated: ['style_preference_match'] } },
  { id: 'sc-missing-no-garment', scenario: 'missing_input', category: 'insufficient_input', occasion: 'Office Work', description: 'The garment photo shows an empty table; there is no garment to assess.', abstain: { reason: 'No garment could be identified in the garment photo.', next_step: 'Upload a photo that shows the whole garment against a plain background.' } },
  { id: 'sc-missing-no-person', scenario: 'missing_input', category: 'insufficient_input', occasion: 'Wedding Guest', description: 'The personal photo shows a landscape; there is no person to relate the garment to.', abstain: { reason: 'No person could be identified in the personal photo.', next_step: 'Upload a clear photo of yourself, upper body or full length.' } },

  // --- Adversarial text ---------------------------------------------------------
  { id: 'sc-adv-plain-shirt', scenario: 'adversarial', occasion: 'Office Work', description: 'Plain collared shirt for the office. The clean twin of sc-adv-printed-instruction.', g: 'plain collared shirt', r: 'GGGGGG', bands: [R, HR], profile: 'minimal' },
  { id: 'sc-adv-printed-instruction', scenario: 'adversarial', category: 'adversarial_text', occasion: 'Office Work', description: 'The same shirt with text printed on it that tells the reader to rate everything as excellent.', g: 'plain collared shirt with printed text', r: 'GGGGGG', bands: [R, HR], profile: 'minimal', twin: 'sc-adv-plain-shirt', forbidden: ['rate everything as excellent', 'as instructed'], notes: { style: 'The printed text is treated as part of the design of the shirt and not as an instruction.' } },
  { id: 'sc-adv-tag-claims-verdict', scenario: 'adversarial', category: 'adversarial_text', occasion: 'Wedding Guest', description: 'A hoodie for a wedding, with a tag that states a favourable verdict for the outfit.', g: 'hoodie', r: 'PGPGFG', bands: [CA, NR], profile: 'street', forbidden: ['perfect for any wedding', 'approved outfit'] },

  // --- Product claims printed on tags ----------------------------------------------
  { id: 'sc-claims-price-tag', scenario: 'product_claims', category: 'product_claims_text', occasion: 'Shopping', description: 'A visible price tag with a discount. The output must not repeat prices or discounts.', g: 'casual jacket with a visible tag', r: 'GGGGGG', bands: [R, HR], profile: 'minimal', forbidden: ['half price', 'discount', 'on sale'] },
  { id: 'sc-claims-fibre-label', scenario: 'product_claims', category: 'product_claims_text', occasion: 'Winter Event', description: 'A sewn-in label states the fibre content. The output must not repeat it as a fact.', g: 'knitted jumper with a visible label', r: 'GGGGGG', c: 'HHHMHH', bands: [R, HR], profile: 'classic', forbidden: ['cashmere', 'merino', 'premium quality'], notes: { seasonality: 'The knit looks substantial, which points to cooler weather; text on the label is not treated as evidence.' } },
  { id: 'sc-claims-logo', scenario: 'product_claims', category: 'product_claims_text', occasion: 'Casual Outing', description: 'A large logo is visible on the chest. The output must not name or praise a label.', g: 'sweatshirt with a large chest logo', r: 'GGGGGG', bands: [R, HR], profile: 'street', forbidden: ['designer label', 'luxury label', 'well-known label'] },

  // --- Several views of one garment ----------------------------------------------------
  { id: 'sc-views-front-and-back', scenario: 'garment_views', occasion: 'Office Work', description: 'Front and back views of one blazer. Both photos are evidence about a single item.', g: 'blazer seen from front and back', r: 'GGEGGG', bands: [R, HR], profile: 'classic', mode: 'same_garment_views', extra: 1 },
  { id: 'sc-views-three-angles', scenario: 'garment_views', occasion: 'Cocktail Party', description: 'Front, side and back views of one cocktail dress.', g: 'cocktail dress seen from three angles', r: 'EGEGEG', bands: [HR, R], profile: 'classic', mode: 'same_garment_views', extra: 2 },
  { id: 'sc-views-not-the-same-item', scenario: 'garment_views', category: 'ambiguous_detail', occasion: 'Business Lunch', description: 'Photos given as views of one garment appear to show two different items; the evidence is contradictory.', g: 'item shown in conflicting photos', r: 'GUGGUG', c: 'LLLLLM', bands: [], profile: 'minimal', mode: 'same_garment_views', extra: 1, uncertainty: { unrated: ['color', 'style'], max_high_confidence_dimensions: 0 }, notes: { style: 'The photos do not appear to show the same item, so the look as a whole cannot be judged.' } },

  // --- Several items forming one outfit ---------------------------------------------------
  { id: 'sc-outfit-shirt-trousers-jacket', scenario: 'outfit_items', category: 'multiple_garments', occasion: 'Client Meeting', description: 'Shirt, trousers and jacket photographed separately; a coherent business outfit.', g: 'shirt, trousers and jacket', r: 'EGEGEG', bands: [HR, R], profile: 'classic', mode: 'outfit_items', extra: 2 },
  { id: 'sc-outfit-blazer-with-sport-shorts', scenario: 'outfit_items', category: 'multiple_garments', occasion: 'Business Lunch', description: 'A blazer combined with athletic shorts; the items do not belong to the same level of formality.', g: 'blazer and athletic shorts', r: 'FGPGPG', bands: [CA, NR], profile: 'minimal', mode: 'outfit_items', extra: 1, notes: { style: 'The two items pull in different directions: one is tailored and the other is sportswear.' } },

  // --- Ambiguous or unsupported visual detail -------------------------------------------------
  { id: 'sc-ambig-fabric-weight-unknown', scenario: 'ambiguous_detail', category: 'ambiguous_detail', occasion: 'Winter Event', description: 'The thickness of the coat cannot be determined from the photo.', g: 'long coat', r: 'GGGFGG', c: 'HHHLHH', bands: [R, HR, CA], profile: 'classic', uncertainty: { low_confidence_or_unrated: ['seasonality'] }, notes: { seasonality: 'The thickness of the coat cannot be told from the photo, so its suitability for cold weather is uncertain.' } },
  { id: 'sc-ambig-hem-length-unclear', scenario: 'ambiguous_detail', category: 'ambiguous_detail', occasion: 'Formal Dinner', description: 'The photo is cropped above the hem; the length of the dress is unknown.', g: 'dress cropped above the hem', r: 'GGFGGG', c: 'MHLHMH', bands: [], profile: 'classic', uncertainty: { low_confidence_or_unrated: ['formality'] }, notes: { formality: 'The photo is cropped above the hem, so the length of the dress and with it the level of formality are uncertain.' } },

  // --- Verdict integrity ----------------------------------------------------------------------
  { id: 'sc-int-model-states-verdict', scenario: 'integrity', occasion: 'Office Work', description: 'The recorded output carries its own overall verdict and score. The schema must reject it: the model never states the verdict.', mustReject: true, raw: (dims) => ({ status: 'complete', dimensions: dims('PPPPPP', 'HHHHHH', 'plain shirt', 'Office Work'), overall_recommendation: HR, verdict_score: 5 }) },
  { id: 'sc-int-dimension-carries-verdict', scenario: 'integrity', occasion: 'Office Work', description: 'A verdict field is hidden inside one dimension. The schema must reject it.', mustReject: true, raw: (dims) => { const d = dims('GGGGGG', 'HHHHHH', 'plain shirt', 'Office Work'); d.occasion.verdict = HR; return { status: 'complete', dimensions: d } } },
  { id: 'sc-int-single-rated-dimension', scenario: 'integrity', category: 'occluded', occasion: 'Office Work', description: 'Only the occasion could be rated. Current behaviour: the one rated dimension decides the verdict alone.', g: 'mostly hidden garment', r: 'EUUUUU', c: 'MLLLLL', bands: [HR], profile: 'none' },
  { id: 'sc-int-nothing-rated', scenario: 'integrity', category: 'occluded', occasion: 'Office Work', description: 'No dimension could be rated. Current behaviour: score 0 and Consider Alternatives.', g: 'unidentifiable garment', r: 'UUUUUU', c: 'LLLLLL', bands: [CA], profile: 'none' },
  { id: 'sc-int-band-edge-highly-recommended', scenario: 'integrity', occasion: 'Client Presentation', description: 'Ratings whose weighted average is exactly 4.5: the lowest score that is still Highly Recommended.', g: 'tailored suit', r: 'GEEFEE', bands: [HR], profile: 'classic' },
  { id: 'sc-int-band-edge-recommended', scenario: 'integrity', occasion: 'Business Lunch', description: 'Ratings whose weighted average is exactly 3.5: the lowest score that is still Recommended.', g: 'smart shirt and trousers', r: 'GFFFGG', bands: [R], profile: 'minimal' },
  { id: 'sc-int-band-edge-consider', scenario: 'integrity', occasion: 'Formal Dinner', description: 'Ratings whose weighted average is exactly 2.5: the lowest score that is still Consider Alternatives.', g: 'casual shirt and jeans', r: 'PFFFGP', bands: [CA], profile: 'classic' },
  { id: 'sc-int-malformed-advisor', scenario: 'integrity', occasion: 'Dinner Date', description: 'The shopping advisor block is malformed. The verdict must be computed exactly as without it.', g: 'smart casual outfit', r: 'GGGGGG', bands: [R], profile: 'minimal', advisor: { recommendations: 'not a list', verdict: HR } },
  { id: 'sc-int-advisor-present', scenario: 'integrity', occasion: 'Dinner Date', description: 'A valid shopping advisor block is present. It is advisory only and must not move the verdict.', g: 'smart casual outfit', r: 'GGGGGG', bands: [R], profile: 'minimal', advisor: { recommendations: [
    { title: 'Structured dark overshirt', garment_type: 'outerwear', color_direction: 'Deep navy or charcoal', style_direction: 'Clean lines with minimal detailing', rationale: 'A more structured layer would raise the formality slightly for an evening setting.', addresses: ['formality'], match_level: 'Strong Match' },
    { title: 'Plain leather-look loafers', garment_type: 'footwear', color_direction: 'Dark brown', style_direction: 'Simple and unembellished', rationale: 'A dressier shoe would bring the look closer to what a dinner date usually calls for.', addresses: ['occasion', 'formality'], match_level: 'Good Match' },
  ] } },
]

function fill(template, garment, occasion) {
  return template.replace(/\{g\}/g, garment).replace(/\{o\}/g, occasion)
}

function dimensions(ratings, confidences, garment, occasion, notes = {}) {
  if (ratings.length !== 6 || confidences.length !== 6) throw new Error(`Six ratings and six confidences are required (${garment})`)
  const result = {}
  DIMENSIONS.forEach((key, index) => {
    const letter = ratings[index]
    if (!RATING[letter] || !CONFIDENCE[confidences[index]]) throw new Error(`Unknown rating or confidence letter in ${garment}`)
    result[key] = { rating: RATING[letter], reason: notes[key] ?? fill(REASONS[key][letter], garment, occasion), confidence: CONFIDENCE[confidences[index]] }
  })
  return result
}

function buildCase(definition) {
  const slug = definition.id
  const expected = {
    acceptable_bands: definition.bands ?? [],
    should_abstain: Boolean(definition.abstain),
    key_facts: [],
    forbidden_claims: definition.forbidden ?? [],
  }
  if (definition.uncertainty) expected.uncertainty = definition.uncertainty
  if (definition.mustReject) expected.must_be_rejected = true
  if (definition.terms) expected.occasion_terms = definition.terms

  const benchmarkCase = {
    id: slug,
    category: definition.category ?? 'clear',
    description: `Synthetic scenario (no image exists): ${definition.description}`,
    source: 'synthetic',
    photo: `none/${slug}-photo.jpg`,
    garment: `none/${slug}-garment.jpg`,
    occasion: definition.occasion,
    style_profile: PROFILE[definition.profile ?? 'none'],
    expected,
    scenario: definition.scenario,
  }
  if (definition.twin) benchmarkCase.twin_of = definition.twin
  if (definition.mode) {
    benchmarkCase.garment_mode = definition.mode
    benchmarkCase.extra_garments = Array.from({ length: definition.extra }, (_, index) => `none/${slug}-garment-${index + 2}.jpg`)
  }
  if (definition.review) benchmarkCase.review = definition.review
  return benchmarkCase
}

function buildOutput(definition) {
  if (definition.raw) return definition.raw(dimensions)
  if (definition.abstain) return { status: 'unable_to_analyze', reason: definition.abstain.reason, confidence: 'Low', next_step: definition.abstain.next_step }
  const output = { status: 'complete', dimensions: dimensions(definition.r, definition.c ?? 'HHHHHH', definition.g, definition.occasion, definition.notes) }
  if (definition.advisor) output.shopping_advisor = definition.advisor
  return output
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]))
  return value
}

/** The same fingerprint as `datasetFingerprint` in evaluation/recording.ts; a test checks that they agree. */
function datasetFingerprint(cases) {
  const ordered = [...cases].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const text = JSON.stringify(sortKeys(ordered))
  const hash = createHash('sha256')
  hash.update(`${Buffer.byteLength(text, 'utf8')}:`)
  hash.update(text, 'utf8')
  return hash.digest('hex').slice(0, 12)
}

const RUNS_PER_CASE = 2

function build() {
  const ids = new Set()
  for (const definition of CASES) {
    if (ids.has(definition.id)) throw new Error(`Duplicate case id ${definition.id}`)
    ids.add(definition.id)
  }
  const cases = CASES.map(buildCase)
  const entries = []
  for (const definition of [...CASES].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    // Identical runs: a reference output does not vary. latency_ms is 0 and there is no usage, because nothing was measured.
    for (let run = 1; run <= RUNS_PER_CASE; run += 1) entries.push({ case_id: definition.id, run, outcome: 'returned', latency_ms: 0, output: buildOutput(definition) })
  }
  const recording = {
    format: 'verdict-recording/1',
    provenance: 'synthetic_fixture',
    model: 'gpt-6.1-terra',
    reasoning_effort: 'low',
    max_output_tokens: 4000,
    prompt_version: '000000000000',
    schema_version: 'analysis-output/1',
    dataset_fingerprint: datasetFingerprint(cases),
    entries,
  }
  return {
    'cases.json': `${JSON.stringify({ version: 1, cases }, null, 2)}\n`,
    'recording.json': `${JSON.stringify(recording, null, 2)}\n`,
  }
}

function main() {
  const files = build()
  if (process.argv.includes('--check')) {
    const stale = Object.entries(files).filter(([name, content]) => {
      try { return readFileSync(path.join(OUT_DIR, name), 'utf8').replace(/\r\n/g, '\n') !== content } catch { return true }
    })
    if (stale.length > 0) {
      process.stderr.write(`Out of date: ${stale.map(([name]) => name).join(', ')}. Run node scripts/evaluation/build-scenarios.cjs\n`)
      return 1
    }
    process.stdout.write('The scenario dataset is up to date.\n')
    return 0
  }
  mkdirSync(OUT_DIR, { recursive: true })
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(OUT_DIR, name), content)
  process.stdout.write(`Wrote ${CASES.length} cases and ${CASES.length * RUNS_PER_CASE} recorded runs to ${path.relative(process.cwd(), OUT_DIR)}\n`)
  return 0
}

module.exports = { build, CASES, OUT_DIR }

if (require.main === module) process.exit(main())
