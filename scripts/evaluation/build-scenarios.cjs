#!/usr/bin/env node
/**
 * Builds the synthetic scenario datasets in evaluation/datasets/:
 *
 *   scenarios-v1   the original scenarios. Frozen: its cases never change.
 *   scenarios-v2   the same cases plus more multi-view, outfit and Style DNA
 *                  cases, so that every garment mode has at least ten.
 *
 *   node scripts/evaluation/build-scenarios.cjs          write cases.json and recording.json of both
 *   node scripts/evaluation/build-scenarios.cjs --check  exit 1 if a committed file differs
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
const { styleDna } = require('./style-dna-personas.cjs')

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
  { id: 'sc-outfit-shirt-trousers-jacket', scenario: 'outfit_items', category: 'multiple_garments', occasion: 'Client Meeting', description: 'Shirt, trousers and jacket photographed separately; a coherent business outfit.', g: 'shirt, trousers and jacket', r: 'EGEGEG', bands: [HR, R], profile: 'classic', mode: 'outfit_items', extra: 2, components: [
    { item: 1, garment_type: 'top', assessment: 'Works well', note: 'The shirt sets a suitably formal base for a client meeting.' },
    { item: 2, garment_type: 'bottom', assessment: 'Works well', note: 'The trousers match the formality of the other two items.' },
    { item: 3, garment_type: 'outerwear', assessment: 'Works', note: 'The jacket completes the outfit, in a slightly different tone from the trousers.' },
  ] },
  { id: 'sc-outfit-blazer-with-sport-shorts', scenario: 'outfit_items', category: 'multiple_garments', occasion: 'Business Lunch', description: 'A blazer combined with athletic shorts; the items do not belong to the same level of formality.', g: 'blazer and athletic shorts', r: 'FGPGPG', bands: [CA, NR], profile: 'minimal', mode: 'outfit_items', extra: 1, notes: { style: 'The two items pull in different directions: one is tailored and the other is sportswear.' }, components: [
    { item: 1, garment_type: 'outerwear', assessment: 'Works', note: 'The blazer on its own is in keeping with a business lunch.' },
    { item: 2, garment_type: 'bottom', assessment: 'Needs attention', note: 'The athletic shorts are far more casual than the blazer and the occasion.' },
  ] },

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

/**
 * Cases added by scenarios-v2. scenarios-v1 is every case above and nothing
 * else; scenarios-v2 is those same cases, unchanged, plus the ones below.
 *
 * They exist for two reasons found in the Phase 4 discovery:
 * - v1 has 3 multi-view and 2 outfit cases. Every figure counts cases and needs
 *   ten, so no figure about either mode could ever be more than indicative.
 *   v2 brings each garment mode to at least ten cases.
 * - No case carried a Style DNA profile, so the personalised path and the
 *   Shopping Advisor were never evaluated. v2 adds twelve cases with an
 *   invented profile (`dna`), spread over the three modes.
 *
 * Like every case here they are synthetic: no image, no model output.
 */
const rec = (title, garment_type, color_direction, style_direction, rationale, addresses, match_level = 'Strong Match') => ({ title, garment_type, color_direction, style_direction, rationale, addresses, match_level })

const V2_CASES = [
  // --- Several views of one garment (v1 has 3) ----------------------------------------
  { id: 'sc-views-coat-front-back', scenario: 'garment_views', occasion: 'Winter Event', description: 'Front and back views of one long coat; the second view adds nothing that changes the picture.', g: 'long coat seen from front and back', r: 'GGGEGG', bands: [R, HR], profile: 'classic', mode: 'same_garment_views', extra: 1 },
  { id: 'sc-views-dress-three-angles', scenario: 'garment_views', occasion: 'Wedding Guest', description: 'Front, side and back views of one midi dress for a daytime wedding.', g: 'midi dress seen from three angles', r: 'EEEGEG', bands: [HR, R], profile: 'classic', mode: 'same_garment_views', extra: 2 },
  { id: 'sc-views-back-reveals-open-back', scenario: 'garment_views', occasion: 'Corporate Interview', description: 'The front view shows a plain dress; the back view shows a low open back that the front alone would hide.', g: 'dress with a plain front and an open back', r: 'PGPGGG', bands: [CA, NR], profile: 'minimal', mode: 'same_garment_views', extra: 1, notes: { formality: 'The back view shows a low open back that the front view does not reveal; it is well below the formality an interview expects.' }, review: { explanation_quality: 'Does the explanation use the second view, or does it read as if only the front had been seen?' } },
  { id: 'sc-views-closeup-shows-pattern', scenario: 'garment_views', occasion: 'Client Meeting', description: 'A full view and a close-up of one shirt; the close-up shows a fine pattern that the full view does not.', g: 'shirt seen in full and in close-up', r: 'GGGGGF', bands: [R, HR], profile: 'minimal', mode: 'same_garment_views', extra: 1, notes: { style_preference_match: 'The close-up shows a fine all-over pattern, which only partly reflects a stated preference for plain, minimal pieces.' } },
  { id: 'sc-views-one-view-blurred', scenario: 'garment_views', category: 'blur', occasion: 'Conference', description: 'Two views of one jacket; one is sharp and the other is out of focus.', g: 'jacket with one sharp and one blurred view', r: 'GGGGGG', c: 'HMHMMH', bands: [R, HR], profile: 'classic', mode: 'same_garment_views', extra: 1, uncertainty: { max_high_confidence_dimensions: 3 } },
  { id: 'sc-views-colour-differs-between-photos', scenario: 'garment_views', category: 'lighting', occasion: 'Dinner Date', description: 'Two views of one shirt taken under different light; the shirt looks a different colour in each.', g: 'shirt photographed under two kinds of light', r: 'GUGGGG', c: 'MLMMMM', bands: [], profile: 'minimal', mode: 'same_garment_views', extra: 1, uncertainty: { unrated: ['color'], max_high_confidence_dimensions: 0 }, notes: { color: 'The two photos show the shirt in visibly different colours, so its true colour cannot be judged.' } },

  // --- Several items forming one outfit (v1 has 2) ----------------------------------------
  { id: 'sc-outfit-tee-jeans-trainers', scenario: 'outfit_items', category: 'multiple_garments', occasion: 'Weekend', description: 'Tee, jeans and trainers photographed separately; a coherent relaxed outfit.', g: 'tee, jeans and trainers', r: 'EGEGEG', bands: [HR, R], profile: 'street', mode: 'outfit_items', extra: 2, components: [
    { item: 1, garment_type: 'top', assessment: 'Works well', note: 'The tee sets the relaxed tone the weekend calls for.' },
    { item: 2, garment_type: 'bottom', assessment: 'Works well', note: 'The jeans sit naturally with the tee and the trainers.' },
    { item: 3, garment_type: 'footwear', assessment: 'Works', note: 'The trainers fit the outfit, in a slightly brighter tone than the rest.' },
  ] },
  { id: 'sc-outfit-dress-and-heels', scenario: 'outfit_items', category: 'multiple_garments', occasion: 'Cocktail Party', description: 'A knee-length dress and heeled shoes photographed separately; a coherent evening outfit.', g: 'knee-length dress and heeled shoes', r: 'EEEGEG', bands: [HR, R], profile: 'classic', mode: 'outfit_items', extra: 1, components: [
    { item: 1, garment_type: 'dress', assessment: 'Works well', note: 'The dress is at the level of formality a cocktail party expects.' },
    { item: 2, garment_type: 'footwear', assessment: 'Works well', note: 'The heeled shoes keep to the same dressed-up register as the dress.' },
  ] },
  { id: 'sc-outfit-suit-with-trainers', scenario: 'outfit_items', category: 'multiple_garments', occasion: 'Corporate Interview', description: 'A dark suit combined with casual trainers; one item is out of step with the setting.', g: 'dark suit and casual trainers', r: 'FGPGFG', bands: [CA, NR], profile: 'classic', mode: 'outfit_items', extra: 1, notes: { style: 'The suit is tailored and the trainers are sportswear, so the two items point in different directions.' }, components: [
    { item: 1, garment_type: 'suiting', assessment: 'Works well', note: 'The suit on its own is what a corporate interview expects.' },
    { item: 2, garment_type: 'footwear', assessment: 'Needs attention', note: 'The casual trainers are far more relaxed than the suit and the interview.' },
  ] },
  { id: 'sc-outfit-coat-knit-boots', scenario: 'outfit_items', category: 'multiple_garments', occasion: 'Winter Event', description: 'A long coat, a knit and boots photographed separately; a coherent cold-weather outfit.', g: 'long coat, knit and boots', r: 'GGGEEG', bands: [R, HR], profile: 'classic', mode: 'outfit_items', extra: 2, components: [
    { item: 1, garment_type: 'outerwear', assessment: 'Works well', note: 'The long coat gives the coverage a winter event calls for.' },
    { item: 2, garment_type: 'top', assessment: 'Works well', note: 'The knit layers easily under the coat.' },
    { item: 3, garment_type: 'footwear', assessment: 'Works', note: 'The boots suit the weather and sit a little apart from the coat in tone.' },
  ] },
  { id: 'sc-outfit-shirt-shorts-sandals', scenario: 'outfit_items', category: 'multiple_garments', occasion: 'Beach', description: 'A light shirt, shorts and sandals photographed separately; a coherent warm-weather outfit.', g: 'light shirt, shorts and sandals', r: 'EGEEGG', bands: [HR, R], profile: 'minimal', mode: 'outfit_items', extra: 2, components: [
    { item: 1, garment_type: 'top', assessment: 'Works well', note: 'The light shirt is easy and open, as a day at the beach calls for.' },
    { item: 2, garment_type: 'bottom', assessment: 'Works well', note: 'The shorts match the shirt in weight and in how relaxed they are.' },
    { item: 3, garment_type: 'footwear', assessment: 'Works', note: 'The sandals are practical here and plainer than the other two items.' },
  ] },
  { id: 'sc-outfit-hoodie-with-tailored-trousers', scenario: 'outfit_items', category: 'multiple_garments', occasion: 'Client Meeting', description: 'A hoodie combined with tailored trousers; the top is too casual for the setting.', g: 'hoodie and tailored trousers', r: 'PGPGFG', bands: [CA, NR], profile: 'street', mode: 'outfit_items', extra: 1, notes: { style: 'The hoodie is sportswear and the trousers are tailored, so the outfit mixes two registers.' }, components: [
    { item: 1, garment_type: 'top', assessment: 'Needs attention', note: 'The hoodie is much more casual than a client meeting expects.' },
    { item: 2, garment_type: 'bottom', assessment: 'Works', note: 'The tailored trousers on their own are in keeping with the meeting.' },
  ] },
  { id: 'sc-outfit-one-item-unclear', scenario: 'outfit_items', category: 'occluded', occasion: 'Office Work', description: 'Two outfit items; the second is folded so that its cut cannot be seen.', g: 'shirt and a folded second item', r: 'GGGGUG', c: 'MHMHLH', bands: [], profile: 'minimal', mode: 'outfit_items', extra: 1, uncertainty: { unrated: ['style'], max_high_confidence_dimensions: 3 }, notes: { style: 'The second item is folded so that its cut is hidden, so it cannot be judged whether the two pieces form a coherent look.' }, components: [
    { item: 1, garment_type: 'top', assessment: 'Works', note: 'The shirt is in keeping with a regular office day.' },
    { item: 2, garment_type: 'bottom', assessment: 'Unable to tell', note: 'The item is folded, so its cut and length cannot be seen.' },
  ] },

  // --- Style DNA: an invented profile is sent, and alternatives are returned -------------------
  { id: 'sc-dna-classic-office-blazer', scenario: 'office', occasion: 'Office Work', description: 'With an invented Style DNA profile (classic, tailored): a tailored blazer for an office day; a close match.', g: 'tailored blazer', r: 'EEEGEE', bands: [HR, R], profile: 'classic', dna: 'persona-classic-tailored', advisor: { recommendations: [
    rec('Lighter unlined blazer', 'outerwear', 'Mid grey or stone', 'The same clean tailoring in a lighter build', 'A lighter build would carry the same tailored look through warmer months.', ['seasonality'], 'Good Match'),
  ] } },
  { id: 'sc-dna-minimal-bold-print', scenario: 'preference_conflict', occasion: 'Casual Outing', description: 'With an invented Style DNA profile (minimalist, plain): a bold all-over print shirt; it conflicts with the profile.', g: 'bold all-over print shirt', r: 'GGGGGP', bands: [R, CA], profile: 'minimal', dna: 'persona-minimal-aesthetic', advisor: { recommendations: [
    rec('Plain relaxed shirt', 'top', 'Off-white or soft grey', 'Unpatterned, with clean lines', 'A plain shirt keeps the relaxed feel of this one and sits closer to the minimal style described in the profile.', ['style_preference_match'], 'Excellent Match'),
    rec('Shirt with a fine tonal stripe', 'top', 'Navy on navy', 'A quiet pattern that reads as plain from a distance', 'A tonal stripe keeps some interest while staying close to the plain, minimal direction of the profile.', ['style_preference_match'], 'Good Match'),
  ] } },
  { id: 'sc-dna-street-black-tie', scenario: 'preference_conflict', occasion: 'Black Tie Event', description: 'With an invented Style DNA profile (streetwear): a classic tuxedo; right for the event, at odds with the profile.', g: 'classic tuxedo', r: 'EGEGGP', bands: [R, HR], profile: 'street', dna: 'persona-street-relaxed', advisor: { recommendations: [
    rec('Tuxedo with a modern relaxed cut', 'suiting', 'Black or deep midnight tones', 'A slightly looser line that stays within evening dress', 'A more relaxed cut keeps to the dress code while moving a little towards the easier style of the profile.', ['style_preference_match'], 'Possible Match'),
  ] } },
  { id: 'sc-dna-romantic-wedding-guest', scenario: 'wedding', occasion: 'Wedding Guest', description: 'With an invented Style DNA profile (romantic, soft): a pastel midi dress for a daytime wedding; a close match.', g: 'pastel midi dress', r: 'EEEGEG', bands: [HR, R], profile: 'classic', dna: 'persona-romantic-soft', advisor: { recommendations: [
    rec('Light wrap for the evening', 'outerwear', 'A soft tone close to the dress', 'Fine and unstructured', 'A light layer would keep the dress workable if the celebration runs into a cooler evening.', ['seasonality'], 'Strong Match'),
  ] } },
  { id: 'sc-dna-warm-colouring-cool-grey', scenario: 'colour', occasion: 'Dinner Date', description: 'With an invented Style DNA profile that states warm colouring: a cool grey shirt; the colour is the weak point.', g: 'cool grey shirt', r: 'GFGGGG', bands: [R, CA], profile: 'street', dna: 'persona-street-relaxed', notes: { color: 'The cool grey of the shirt sits less comfortably with the warm colouring stated in the style profile than a warmer tone would.' }, advisor: { recommendations: [
    rec('Shirt in a warmer neutral', 'top', 'Warm beige, olive or rust', 'The same relaxed cut', 'A warmer tone would sit more comfortably with the colouring stated in the profile, without changing the look.', ['color'], 'Strong Match'),
  ] } },
  { id: 'sc-dna-smart-casual-first-date', scenario: 'casual', occasion: 'First Date', description: 'With an invented Style DNA profile (bold, eclectic): a plain smart casual shirt and chinos; fine throughout, a little quiet for the profile.', g: 'plain smart casual shirt and chinos', r: 'GGGGGG', c: 'HHHHHM', bands: [R], profile: 'bold', dna: 'persona-bold-aesthetic', advisor: { recommendations: [
    rec('Shirt with a confident print', 'top', 'A saturated accent colour', 'One statement piece with plain trousers', 'A bolder shirt would bring the outfit closer to the expressive style described in the profile.', ['style_preference_match'], 'Good Match'),
    rec('Textured casual jacket', 'outerwear', 'A deep contrasting tone', 'Relaxed, with visible texture', 'A jacket with some character would lift the look for a first date without making it formal.', ['occasion', 'style'], 'Possible Match'),
  ] } },
  { id: 'sc-views-dna-trainers-two-angles', scenario: 'garment_views', occasion: 'Casual Outing', description: 'With an invented Style DNA profile (streetwear): trainers seen from the side and from above.', g: 'trainers seen from two angles', r: 'EGEGGE', bands: [HR, R], profile: 'street', mode: 'same_garment_views', extra: 1, dna: 'persona-street-relaxed', advisor: { recommendations: [
    rec('Trainers in a darker tone', 'footwear', 'Black or charcoal', 'The same low profile', 'A darker pair would be easier to combine across the cooler months.', ['seasonality', 'color'], 'Good Match'),
  ] } },
  { id: 'sc-views-dna-evening-dress', scenario: 'garment_views', occasion: 'Formal Dinner', description: 'With an invented Style DNA profile (romantic, soft): an evening dress seen from the front and from the side.', g: 'evening dress seen from front and side', r: 'EGEGEG', bands: [HR, R], profile: 'classic', mode: 'same_garment_views', extra: 1, dna: 'persona-romantic-soft', advisor: { recommendations: [
    rec('Evening dress in a softer shade', 'dress', 'Dusty rose or soft blue', 'The same long line', 'A softer shade would sit closer to the gentle palette described in the profile.', ['color', 'style_preference_match'], 'Strong Match'),
  ] } },
  { id: 'sc-views-dna-suit-jacket-three-angles', scenario: 'garment_views', occasion: 'Business Lunch', description: 'With an invented Style DNA profile (classic, tailored): a suit jacket seen from three angles.', g: 'suit jacket seen from three angles', r: 'GGEGGG', bands: [R, HR], profile: 'classic', mode: 'same_garment_views', extra: 2, dna: 'persona-classic-tailored', advisor: { recommendations: [
    rec('Jacket in a softer construction', 'outerwear', 'Navy or mid grey', 'Tailored, with a less structured shoulder', 'A softer jacket would suit the easier tone of a lunch while staying tailored.', ['occasion'], 'Good Match'),
  ] } },
  { id: 'sc-outfit-dna-kurta-and-trousers', scenario: 'outfit_items', category: 'multiple_garments', occasion: 'Wedding Guest', description: 'With an invented Style DNA profile (classic, tailored): a festive kurta and matching trousers photographed separately.', g: 'festive kurta and trousers', r: 'EEEGEG', bands: [HR, R], profile: 'classic', mode: 'outfit_items', extra: 1, dna: 'persona-classic-tailored', advisor: { recommendations: [
    rec('Embroidered stole', 'accessory', 'A tone drawn from the kurta', 'Fine detailing, worn over one shoulder', 'A stole would add a layer for an evening ceremony and complete the festive look.', ['seasonality'], 'Good Match'),
  ] }, components: [
    { item: 1, garment_type: 'traditional_wear', assessment: 'Works well', note: 'The kurta is festive in a way that suits a wedding guest.' },
    { item: 2, garment_type: 'bottom', assessment: 'Works well', note: 'The trousers match the kurta in tone and in formality.' },
  ] },
  { id: 'sc-outfit-dna-blazer-tee-jeans', scenario: 'outfit_items', category: 'multiple_garments', occasion: 'Business Casual', description: 'With an invented Style DNA profile (minimalist): a blazer, a plain tee and dark jeans photographed separately.', g: 'blazer, plain tee and dark jeans', r: 'GGGGGG', bands: [R], profile: 'minimal', mode: 'outfit_items', extra: 2, dna: 'persona-minimal-aesthetic', advisor: { recommendations: [
    rec('Plain fine-knit top', 'top', 'Navy, grey or off-white', 'Unpatterned and close-fitting under a blazer', 'A fine knit in place of the tee would raise the formality a little while staying minimal.', ['formality'], 'Strong Match'),
  ] }, components: [
    { item: 1, garment_type: 'outerwear', assessment: 'Works well', note: 'The blazer brings the outfit up to a business casual level.' },
    { item: 2, garment_type: 'top', assessment: 'Works', note: 'The plain tee is the most relaxed of the three items.' },
    { item: 3, garment_type: 'bottom', assessment: 'Works', note: 'The dark jeans are acceptable here and plainer than tailored trousers.' },
  ] },
  { id: 'sc-outfit-dna-clashing-colours', scenario: 'outfit_items', category: 'multiple_garments', occasion: 'Birthday Party', description: 'With an invented Style DNA profile (bold, eclectic): a top and trousers in two competing saturated colours.', g: 'top and trousers in competing saturated colours', r: 'GPGGFG', bands: [R, CA], profile: 'bold', mode: 'outfit_items', extra: 1, dna: 'persona-bold-aesthetic', advisor: { recommendations: [
    rec('Trousers in a neutral tone', 'bottom', 'Black, cream or deep navy', 'The same cut as the current pair', 'A neutral pair would let the saturated top stand on its own instead of competing with it.', ['color', 'style'], 'Strong Match'),
  ] }, components: [
    { item: 1, garment_type: 'top', assessment: 'Works', note: 'The saturated top suits a birthday party on its own.' },
    { item: 2, garment_type: 'bottom', assessment: 'Needs attention', note: 'The trousers are in a second strong colour that competes with the top.' },
  ] },
]

/** The committed synthetic datasets this script writes. Each is the list of its case definitions. */
const DATASET_CASES = {
  'scenarios-v1': CASES,
  'scenarios-v2': [...CASES, ...V2_CASES],
}

function datasetDir(name) {
  return path.resolve(__dirname, '..', '..', 'evaluation', 'datasets', name)
}

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
  // An invented Style DNA profile, from the library of personas. Never a real person's profile.
  if (definition.dna) benchmarkCase.style_dna = styleDna(definition.dna)
  if (definition.review) benchmarkCase.review = definition.review
  return benchmarkCase
}

function buildOutput(definition) {
  if (definition.raw) return definition.raw(dimensions)
  if (definition.abstain) return { status: 'unable_to_analyze', reason: definition.abstain.reason, confidence: 'Low', next_step: definition.abstain.next_step }
  const output = { status: 'complete', dimensions: dimensions(definition.r, definition.c ?? 'HHHHHH', definition.g, definition.occasion, definition.notes) }
  if (definition.advisor) output.shopping_advisor = definition.advisor
  // Per-item notes exist only for outfits of several items. They are advisory and never reach the verdict.
  if (definition.components) output.outfit_components = definition.components
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

/** The files of one dataset, by name. `build()` without a name builds scenarios-v1, as it always did. */
function build(name = 'scenarios-v1') {
  const definitions = DATASET_CASES[name]
  if (!definitions) throw new Error(`Unknown dataset ${name}`)
  const ids = new Set()
  for (const definition of definitions) {
    if (ids.has(definition.id)) throw new Error(`Duplicate case id ${definition.id}`)
    ids.add(definition.id)
  }
  const cases = definitions.map(buildCase)
  const entries = []
  for (const definition of [...definitions].sort((a, b) => (a.id < b.id ? -1 : 1))) {
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
    schema_version: 'analysis-output/2',
    dataset_fingerprint: datasetFingerprint(cases),
    entries,
  }
  return {
    'cases.json': `${JSON.stringify({ version: 1, cases }, null, 2)}\n`,
    'recording.json': `${JSON.stringify(recording, null, 2)}\n`,
  }
}

function main() {
  const check = process.argv.includes('--check')
  const stale = []
  for (const dataset of Object.keys(DATASET_CASES)) {
    const dir = datasetDir(dataset)
    const files = build(dataset)
    if (check) {
      for (const [name, content] of Object.entries(files)) {
        let same = false
        try { same = readFileSync(path.join(dir, name), 'utf8').replace(/\r\n/g, '\n') === content } catch { same = false }
        if (!same) stale.push(`${dataset}/${name}`)
      }
      continue
    }
    mkdirSync(dir, { recursive: true })
    for (const [name, content] of Object.entries(files)) writeFileSync(path.join(dir, name), content)
    const count = DATASET_CASES[dataset].length
    process.stdout.write(`Wrote ${count} cases and ${count * RUNS_PER_CASE} recorded runs to ${path.relative(process.cwd(), dir)}\n`)
  }
  if (!check) return 0
  if (stale.length > 0) {
    process.stderr.write(`Out of date: ${stale.join(', ')}. Run node scripts/evaluation/build-scenarios.cjs\n`)
    return 1
  }
  process.stdout.write('The scenario datasets are up to date.\n')
  return 0
}

module.exports = { build, CASES, V2_CASES, DATASET_CASES, datasetDir }

if (require.main === module) process.exit(main())
