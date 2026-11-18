/**
 * scenarios-v4: synthetic scenarios for Phase 4 Milestones 2 to 4
 * (analysis-output/4): occasion intelligence, multi-view and outfit reasoning,
 * and limitations and uncertainty.
 *
 * Like scenarios-v3, every case is a written brief with a hand-specified
 * REFERENCE OUTPUT. No image exists and no model produced anything. The
 * dataset checks Verdict's own code and the evaluation figures; it is NOT
 * evidence about how well any model reasons about occasions or outfits.
 *
 * Some cases are deliberately written the way a careless model might answer
 * (a generic occasion reason, an assumed religion, a preference rating with no
 * preferences given, an overconfident seasonality rating, a formality rating
 * that contradicts occasion fit). They pass the blocking checks, because none
 * of that makes an output invalid, and they make the occasion figures non-zero,
 * which shows that the figures detect what they claim to.
 */

const { img, ADVISOR } = require('./scenarios-v3.cjs')

const HR = 'Highly Recommended'
const R = 'Recommended'
const CA = 'Consider Alternatives'
const NR = 'Not Recommended'
const AVAILABLE = { observations: 'available', evidence: 'available' }

/**
 * The occasion catalogue, as the application defines it. It is duplicated here
 * as plain data because this script runs without TypeScript; a test checks
 * that every label below is in the application's catalogue with the same
 * formality range and season.
 */
const CATALOGUE = [
  ['Office Work', 'office', 'business casual', 'business formal', 'office, working day'],
  ['Client Meeting', 'office', 'business casual', 'business formal', 'meeting with clients'],
  ['Client Presentation', 'office', 'business casual', 'business formal', 'presenting to an audience'],
  ['Corporate Interview', 'office', 'business formal', 'business formal', 'job interview at a company'],
  ['Startup Interview', 'office', 'smart casual', 'business casual', 'interview, informal workplace'],
  ['Networking Event', 'office', 'smart casual', 'business casual', 'professional social event'],
  ['Business Lunch', 'office', 'business casual', 'business casual', 'working meal at a restaurant'],
  ['Business Casual', 'office', 'business casual', 'business casual', 'business casual dress code'],
  ['Conference', 'office', 'smart casual', 'business casual', 'long day indoors, much walking'],
  ['Coffee Date', 'party', 'casual', 'smart casual', 'café, daytime'],
  ['Dinner Date', 'party', 'smart casual', 'smart casual', 'restaurant, evening'],
  ['First Date', 'party', 'casual', 'smart casual', 'meeting someone new'],
  ['Birthday Party', 'party', 'casual', 'smart casual', 'celebration'],
  ['Night Out', 'party', 'smart casual', 'smart casual', 'evening venues'],
  ['House Party', 'party', 'casual', 'casual', "someone's home"],
  ['Cocktail Party', 'party', 'business formal', 'formal', 'evening social event'],
  ['Wedding Guest', 'wedding', 'business formal', 'formal', 'wedding ceremony'],
  ['Wedding Reception', 'wedding', 'business formal', 'formal', 'wedding celebration, often evening'],
  ['Formal Dinner', 'formal', 'business formal', 'formal', 'formal evening meal'],
  ['Black Tie Event', 'formal', 'formal', 'formal', 'black tie dress code'],
  ['Award Ceremony', 'formal', 'business formal', 'formal', 'ceremony, often evening'],
  ['Casual Outing', 'casual', 'casual', 'casual', 'everyday, relaxed'],
  ['Shopping', 'casual', 'casual', 'casual', 'stores, on foot'],
  ['College', 'casual', 'casual', 'smart casual', 'campus'],
  ['Weekend', 'casual', 'casual', 'casual', 'free time'],
  ['Travel', 'casual', 'casual', 'smart casual', 'long transit'],
  ['Vacation', 'casual', 'casual', 'smart casual', 'holiday'],
  ['Outdoor Event', 'seasonal', 'casual', 'smart casual', 'outdoors'],
  ['Summer Event', 'seasonal', 'casual', 'smart casual', 'summer event', 'summer'],
  ['Winter Event', 'seasonal', 'casual', 'business formal', 'winter event', 'winter'],
  ['Beach', 'seasonal', 'casual', 'casual', 'beach, sun and sand', 'warm weather'],
  ['Rainy Day', 'seasonal', 'casual', 'smart casual', 'wet weather', 'rain'],
]

/** A garment that sits at the bottom of each formality level, with its observation. */
const KITS = {
  casual: { g: 'relaxed tee and jeans', obs: () => img(1, 'top', 't-shirt', ['white'], { details: ['crew neck'] }) },
  'smart casual': { g: 'knit polo and chinos', obs: () => img(1, 'top', 'polo shirt', ['navy'], { pattern: 'textured', details: ['ribbed collar'] }) },
  'business casual': { g: 'collared shirt and tailored trousers', obs: () => img(1, 'top', 'shirt', ['blue'], { details: ['button-down collar'] }) },
  'business formal': { g: 'tailored navy suit', obs: () => img(1, 'suiting', 'suit', ['navy'], { details: ['notched lapels'] }) },
  formal: { g: 'black tuxedo', obs: () => img(1, 'suiting', 'tuxedo', ['black'], { details: ['peak lapels', 'bow tie'] }) },
}

function slug(label) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function seasonNote(g, season) {
  return season ? `The visible weight of the ${g} suits ${season}.` : `No season is stated; the visible weight of the ${g} works across most seasons.`
}

// --- Milestone 2: one case for every occasion in the catalogue --------------------------------------------
const PER_OCCASION = CATALOGUE.map(([label, scenario, low, high, setting, season]) => {
  const kit = KITS[low]
  const range = low === high ? low : `${low} to ${high}`
  return {
    id: `v4-occ-${slug(label)}`,
    scenario,
    occasion: label,
    description: `Every occasion has a profile: a ${kit.g} for ${label}, at the usual formality (${range}).`,
    g: kit.g,
    r: 'GGGGGG',
    c: `HHH${season ? 'H' : 'M'}HH`,
    bands: [R],
    profile: 'classic',
    notes: {
      occasion: `The ${kit.g} suits ${label.toLowerCase()} (${setting}), within its usual ${range} range.`,
      seasonality: seasonNote(kit.g, season),
    },
    obs: { images: [kit.obs()] },
    visual: AVAILABLE,
  }
})

const suit = () => img(1, 'suiting', 'suit', ['navy'], { details: ['notched lapels'] })

const M2_CASES = [
  ...PER_OCCASION,

  // --- One garment, contrasting occasions (occasion fit must respond to the occasion) -------------------
  { id: 'v4-group-suit-interview', scenario: 'office', group: 'navy-suit', occasion: 'Corporate Interview', description: 'A tailored navy suit for a corporate interview: within the expected formality.', g: 'tailored navy suit', r: 'EEEGEE', c: 'HHHMHH', bands: [HR, R], profile: 'classic',
    notes: { occasion: 'The tailored navy suit matches a corporate interview: conservative and tidy, as the setting expects.', seasonality: seasonNote('tailored navy suit') }, obs: { images: [suit()] }, visual: AVAILABLE },
  { id: 'v4-group-suit-black-tie', scenario: 'formal', group: 'navy-suit', occasion: 'Black Tie Event', description: 'The same suit for a black tie event: below the expected formality.', g: 'tailored navy suit', r: 'FGFGGG', c: 'HHHMHH', bands: [R, CA], profile: 'classic',
    notes: { occasion: 'A business suit falls short of the black tie dress code, which expects evening formalwear.', formality: 'The suit is business formal, below the formal level a black tie dress code expects.', seasonality: seasonNote('tailored navy suit') }, obs: { images: [suit()] }, visual: AVAILABLE },
  { id: 'v4-group-suit-beach', scenario: 'seasonal', group: 'navy-suit', occasion: 'Beach', description: 'The same suit at the beach: far above the expected formality and heavy for warm weather.', g: 'tailored navy suit', r: 'PGPFGG', c: 'HHHHHH', bands: [CA, NR], profile: 'classic',
    notes: { occasion: 'A tailored suit is out of place on a beach of sun and sand, which calls for light, relaxed pieces.', formality: 'The suit is far more formal than the casual level a beach expects.', seasonality: 'The suit looks heavy for the warm weather the occasion states.' }, obs: { images: [suit()] }, visual: AVAILABLE },
  { id: 'v4-group-suit-house-party', scenario: 'party', group: 'navy-suit', occasion: 'House Party', description: 'The same suit at a house party: more formal than a relaxed home setting expects.', g: 'tailored navy suit', r: 'FGPGGG', c: 'HHHMHH', bands: [CA], profile: 'classic',
    notes: { occasion: "A full suit reads as stiff at a house party in someone's home, where relaxed pieces are usual.", formality: 'The suit sits well above the casual level of a house party.', seasonality: seasonNote('tailored navy suit') }, obs: { images: [suit()] }, visual: AVAILABLE },

  // --- One occasion, different garments ------------------------------------------------------------------
  { id: 'v4-wedding-pastel-dress', scenario: 'wedding', occasion: 'Wedding Guest', description: 'A pastel midi dress for a wedding ceremony.', g: 'pastel midi dress', r: 'EEEGEG', c: 'HHHMHH', bands: [HR, R], profile: 'classic',
    notes: { occasion: 'The pastel midi dress is celebratory and polished, as a wedding ceremony usually expects.', seasonality: seasonNote('pastel midi dress') },
    obs: { images: [img(1, 'dress', 'midi dress', ['pink'], { details: ['midi length'] })] }, visual: AVAILABLE },
  { id: 'v4-wedding-hoodie', scenario: 'wedding', occasion: 'Wedding Guest', description: 'A hoodie for a wedding ceremony: well below the expected formality.', g: 'grey hoodie', r: 'PGPGGP', c: 'HHHMHH', bands: [CA, NR], profile: 'classic',
    notes: { occasion: 'A hoodie is too casual for a wedding ceremony, which expects celebratory, polished pieces.', style_preference_match: 'A hoodie conflicts with the stated classic preference.', seasonality: seasonNote('grey hoodie') },
    obs: { images: [img(1, 'top', 'hoodie', ['grey'], { details: ['drawstring hood'] })] }, visual: AVAILABLE },
  { id: 'v4-wedding-traditional-ambiguous', scenario: 'wedding', category: 'ambiguous_detail', occasion: 'Wedding Reception', description: 'A festive traditional outfit for a reception whose dress code is not stated: occasion fit is held with medium confidence.', g: 'festive traditional outfit', r: 'GGGGGG', c: 'MHMMHH', bands: [R], profile: 'classic',
    notes: { occasion: 'The festive outfit suits many wedding celebrations, but dress codes and traditions differ and none is stated here.', seasonality: seasonNote('festive traditional outfit') },
    obs: { images: [img(1, 'traditional_wear', 'embroidered outfit', ['gold'], { secondary: ['red'], pattern: 'printed', details: ['embroidered neckline'] })] }, visual: AVAILABLE },

  // --- An occasion with no profile -----------------------------------------------------------------------
  { id: 'v4-unknown-occasion', scenario: 'integrity', occasion: 'Garden Gala', description: 'An occasion that is not in the catalogue: the API would refuse it; a manifest can still carry it, and it has no profile.', g: 'linen-look summer dress', r: 'FGGGGG', c: 'LHHMHH', bands: [R, CA], profile: 'classic',
    notes: { occasion: 'There is no profile for a garden gala, so its expectations are unknown and the fit is uncertain.', seasonality: seasonNote('summer dress') },
    obs: { images: [img(1, 'dress', 'summer dress', ['yellow'], { details: ['sleeveless'] })] }, visual: AVAILABLE },

  // --- Style DNA on and off, and preference against occasion ---------------------------------------------
  { id: 'v4-dna-office-suit', scenario: 'office', occasion: 'Client Meeting', description: 'With an invented Style DNA profile (classic): a suit for a client meeting.', g: 'tailored navy suit', r: 'EEEGEE', c: 'HHHMHH', bands: [HR, R], profile: 'classic', dna: 'persona-classic-tailored', advisor: ADVISOR,
    notes: { occasion: 'The suit is polished and put-together, as a meeting with clients expects.', seasonality: seasonNote('tailored navy suit') }, obs: { images: [suit()] }, visual: AVAILABLE },
  { id: 'v4-dna-night-out', scenario: 'party', occasion: 'Night Out', description: 'With an invented Style DNA profile (bold): an expressive printed shirt for a night out.', g: 'printed silk-look shirt', r: 'EEGGEE', c: 'HHHMHH', bands: [HR, R], profile: 'bold', dna: 'persona-bold-aesthetic', advisor: ADVISOR,
    notes: { occasion: 'The printed shirt is evening-ready and expressive, as a night out at evening venues expects.', seasonality: seasonNote('printed shirt') },
    obs: { images: [img(1, 'top', 'shirt', ['multicolour'], { pattern: 'printed', details: ['camp collar'] })] }, visual: AVAILABLE },
  { id: 'v4-conflict-black-tie-street', scenario: 'preference_conflict', occasion: 'Black Tie Event', description: 'A tuxedo for black tie by someone whose stated preferences are streetwear: the occasion fits, the preference does not.', g: 'black tuxedo', r: 'EEEGEP', c: 'HHHMHH', bands: [R], profile: 'street',
    notes: { occasion: 'The tuxedo meets the black tie dress code: evening formalwear.', style_preference_match: 'The tuxedo conflicts with the stated streetwear and casual preferences.', seasonality: seasonNote('black tuxedo') },
    obs: { images: [img(1, 'suiting', 'tuxedo', ['black'], { details: ['peak lapels', 'bow tie'] })] }, visual: AVAILABLE },
  { id: 'v4-preference-none-unrated', scenario: 'casual', occasion: 'Weekend', description: 'No style preferences and no Style DNA: preference match is left Unable to Evaluate, as the rules require.', g: 'relaxed tee and jeans', r: 'GGGGGU', c: 'HHHMHL', bands: [R], profile: 'none',
    notes: { occasion: 'The relaxed tee suits free time at the weekend.', seasonality: seasonNote('relaxed tee and jeans') }, obs: { images: [KITS.casual.obs()] }, visual: AVAILABLE },

  // --- Outputs that break the occasion rules (the figures must catch them) -------------------------------
  { id: 'v4-rule-preference-inferred', scenario: 'integrity', occasion: 'Weekend', description: 'No preferences and no Style DNA, yet preference match is rated: taste inferred from the photo.', g: 'relaxed tee and jeans', r: 'GGGGGG', c: 'HHHMHH', bands: [R], profile: 'none',
    notes: { occasion: 'The relaxed tee suits free time at the weekend.', seasonality: seasonNote('relaxed tee and jeans') }, obs: { images: [KITS.casual.obs()] }, visual: AVAILABLE },
  { id: 'v4-rule-seasonality-overconfident', scenario: 'integrity', occasion: 'Office Work', description: 'No season is stated, yet seasonality is rated with High confidence.', g: 'collared shirt and tailored trousers', r: 'GGGGGG', c: 'HHHHHH', bands: [R], profile: 'classic',
    notes: { occasion: 'The collared shirt suits an office working day.', seasonality: 'The shirt is clearly right for the season.' }, obs: { images: [KITS['business casual'].obs()] }, visual: AVAILABLE },
  { id: 'v4-rule-generic-occasion-reason', scenario: 'integrity', occasion: 'Networking Event', description: 'An occasion explanation that says nothing about the occasion.', g: 'knit polo and chinos', r: 'GGGGGG', c: 'HHHMHH', bands: [R], profile: 'classic',
    notes: { occasion: 'This is a lovely look overall.', seasonality: seasonNote('knit polo and chinos') }, obs: { images: [KITS['smart casual'].obs()] }, visual: AVAILABLE },
  { id: 'v4-rule-assumed-religion', scenario: 'integrity', occasion: 'Wedding Guest', description: 'An occasion explanation that assumes a religious ceremony the user never stated.', g: 'pastel midi dress', r: 'GGGGGG', c: 'HHHMHH', bands: [R], profile: 'classic',
    notes: { occasion: 'The dress is modest enough for a church wedding ceremony.', seasonality: seasonNote('pastel midi dress') },
    obs: { images: [img(1, 'dress', 'midi dress', ['pink'], { details: ['midi length'] })] }, visual: AVAILABLE },
  { id: 'v4-rule-formality-contradiction', scenario: 'integrity', occasion: 'Corporate Interview', description: 'Formality rated Poor while occasion fit is rated Excellent: the two contradict each other.', g: 'relaxed tee and jeans', r: 'EGPGGG', c: 'HHHMHH', bands: [R, CA], profile: 'classic',
    notes: { occasion: 'The tee is perfect for a job interview at a company.', formality: 'The tee is far below the business formal level an interview expects.', seasonality: seasonNote('relaxed tee and jeans') }, obs: { images: [KITS.casual.obs()] }, visual: AVAILABLE },
]


// --- Milestone 3: views of one garment --------------------------------------------------------------------
const comp = (item, garment_type, assessment, note, effect = {}) => ({ item, garment_type, assessment, note, ...effect })
const views = (same_garment, differences, conflicts) => ({ same_garment, ...(differences ? { differences } : {}), ...(conflicts ? { conflicts } : {}) })
const VIEWS = { mode: 'same_garment_views' }
const OUTFIT = { mode: 'outfit_items' }
const OUTFIT_AVAILABLE = { ...AVAILABLE, contributions: 'available' }

const M3_CASES = [
  { id: 'v4-views-front-back-coat', scenario: 'garment_views', occasion: 'Winter Event', ...VIEWS, extra: 1, description: 'Front and back of one coat; the back vent shows in one view only, which is missing evidence, not a conflict.', g: 'camel coat seen front and back', r: 'GGGEGG', c: 'HHHHHH', bands: [R], profile: 'classic',
    obs: { images: [img(1, 'outerwear', 'coat', ['beige'], { details: ['notched lapels'] }), img(2, 'outerwear', 'coat', ['beige'], { details: ['single back vent'] })], views: views('yes', ['detail_hidden']) }, visual: AVAILABLE },
  { id: 'v4-views-three-angles-dress', scenario: 'garment_views', occasion: 'Wedding Guest', ...VIEWS, extra: 2, description: 'Three angles of one dress, consistent with each other.', g: 'green dress seen from three angles', r: 'EEEGEG', c: 'HHHMHH', bands: [HR, R], profile: 'classic',
    obs: { images: [img(1, 'dress', 'dress', ['green'], { details: ['square neckline'] }), img(2, 'dress', 'dress', ['green']), img(3, 'dress', 'dress', ['green'], { details: ['side slit'] })], views: views('yes') }, visual: AVAILABLE },
  { id: 'v4-views-lighting-explained', scenario: 'colour', category: 'difficult_colour', occasion: 'Client Meeting', ...VIEWS, extra: 1, description: 'One blazer looks navy in one view and blue in the other; the output says lighting explains it.', g: 'blazer seen under two lights', r: 'GFGGGG', c: 'HMHMHH', bands: [R, CA], profile: 'classic',
    obs: { images: [img(1, 'suiting', 'blazer', ['navy']), img(2, 'suiting', 'blazer', ['blue'], { limits: ['lighting'] })], views: views('yes', ['colour_lighting']) }, visual: AVAILABLE },
  { id: 'v4-views-lighting-unexplained', scenario: 'integrity', occasion: 'Client Meeting', ...VIEWS, extra: 1, description: 'The views show different colours and the output calls them one garment without explaining it.', g: 'blazer seen under two lights', r: 'GGGGGG', c: 'HHHMHH', bands: [R], profile: 'classic',
    obs: { images: [img(1, 'suiting', 'blazer', ['navy']), img(2, 'suiting', 'blazer', ['black'])], views: views('yes') }, visual: AVAILABLE },
  { id: 'v4-views-different-item', scenario: 'garment_views', category: 'ambiguous_detail', occasion: 'Office Work', ...VIEWS, extra: 1, description: 'The second view shows another garment; the output says so and lowers its confidence.', g: 'garment whose views disagree', r: 'GGGGGG', c: 'MLMMLM', bands: [R], profile: 'classic',
    obs: { images: [img(1, 'suiting', 'blazer', ['navy']), img(2, 'top', 'shirt', ['white'])], views: views('no', ['different_item'], 'View 2 shows a white shirt, not the navy blazer of view 1') }, visual: AVAILABLE },
  { id: 'v4-views-conflict-overconfident', scenario: 'integrity', occasion: 'Winter Event', ...VIEWS, extra: 1, description: 'The output cannot tell whether the views show one garment, yet keeps every rating at High confidence.', g: 'garment whose views disagree', r: 'GGGGGG', c: 'HHHHHH', bands: [R], profile: 'classic',
    obs: { images: [img(1, 'suiting', 'blazer', ['navy']), img(2, 'suiting', 'blazer', ['navy'], { id: 'uncertain', limits: ['angle'] })], views: views('unclear', null, 'View 2 is at a steep angle and may show a different jacket') }, visual: AVAILABLE },
  { id: 'v4-views-occluded-detail', scenario: 'garment_views', category: 'occluded', occasion: 'Office Work', ...VIEWS, extra: 1, description: 'A bag hides the front pocket in one view; the other view shows it.', g: 'jacket seen front and side', r: 'GGGGGG', c: 'HHHMHH', bands: [R], profile: 'classic',
    obs: { images: [img(1, 'outerwear', 'jacket', ['grey'], { limits: ['occlusion'] }), img(2, 'outerwear', 'jacket', ['grey'], { details: ['patch pocket'] })], views: views('yes', ['detail_hidden']) }, visual: AVAILABLE },
  { id: 'v4-views-dna-skirt', scenario: 'garment_views', occasion: 'Wedding Guest', ...VIEWS, extra: 1, dna: 'persona-romantic-soft', advisor: ADVISOR, description: 'With an invented Style DNA profile (romantic): two views of one pleated skirt.', g: 'pleated pink skirt seen from two sides', r: 'GGGGEG', c: 'HHHMHH', bands: [R], profile: 'classic',
    obs: { images: [img(1, 'bottom', 'pleated skirt', ['pink'], { details: ['knife pleats'] }), img(2, 'bottom', 'pleated skirt', ['pink'])], views: views('yes') }, visual: AVAILABLE },
  { id: 'v4-views-dna-coat', scenario: 'garment_views', occasion: 'Winter Event', ...VIEWS, extra: 1, dna: 'persona-classic-tailored', advisor: ADVISOR, description: 'With an invented Style DNA profile (classic): two views of one coat.', g: 'charcoal coat seen from two sides', r: 'GEGEEE', c: 'HHHHHH', bands: [HR, R], profile: 'classic',
    obs: { images: [img(1, 'outerwear', 'coat', ['grey'], { details: ['wide lapels'] }), img(2, 'outerwear', 'coat', ['grey'])], views: views('yes') }, visual: AVAILABLE },
  { id: 'v4-views-dna-trainers', scenario: 'garment_views', occasion: 'Casual Outing', ...VIEWS, extra: 1, dna: 'persona-street-relaxed', advisor: ADVISOR, description: 'With an invented Style DNA profile (street): two views of one pair of trainers.', g: 'white trainers seen from two sides', r: 'EGEGEE', c: 'HHHMHH', bands: [HR, R], profile: 'street',
    obs: { images: [img(1, 'footwear', 'trainers', ['white'], { details: ['gum sole'] }), img(2, 'footwear', 'trainers', ['white'])], views: views('yes') }, visual: AVAILABLE },
  { id: 'v4-views-difference-contradiction', scenario: 'integrity', occasion: 'Office Work', ...VIEWS, extra: 1, description: 'The output says the views are one garment and also that a view shows a different item: contradictory, refused.', g: 'navy blazer seen from two sides', r: 'GGGGGG', c: 'HHHMHH', bands: [R], profile: 'classic',
    obs: { images: [img(1, 'suiting', 'blazer', ['navy']), img(2, 'suiting', 'blazer', ['navy'])], views: views('yes', ['different_item']) }, evidenceFrom: { images: [img(1, 'suiting', 'blazer', ['navy']), img(2, 'suiting', 'blazer', ['navy'])] },
    visual: { observations: 'unavailable', evidence: 'unavailable', problems: ['views_contradiction', 'invalid_citation'] } },

  // --- Milestone 3: outfit items and what each contributes ------------------------------------------------
  { id: 'v4-outfit-office-three', scenario: 'outfit_items', occasion: 'Office Work', ...OUTFIT, extra: 2, description: 'Blazer, shirt and trousers: each item states which ratings it supports.', g: 'blazer, shirt and trousers', r: 'EEEGEE', c: 'HHHMHH', bands: [HR, R], profile: 'classic',
    obs: { images: [img(1, 'suiting', 'blazer', ['navy'], { details: ['notched lapels'] }), img(2, 'top', 'shirt', ['white'], { details: ['spread collar'] }), img(3, 'bottom', 'trousers', ['grey'])] },
    components: [comp(1, 'suiting', 'Works well', 'The blazer sets the formality for the office.', { supports: ['formality', 'occasion'], cites: ['g1.type', 'g1.d1'] }), comp(2, 'top', 'Works well', 'The plain shirt sits cleanly under the blazer.', { supports: ['color', 'style'], cites: ['g2.colour'] }), comp(3, 'bottom', 'Works', 'The grey trousers suit the blazer.', { supports: ['formality'], unclear: ['seasonality'], cites: ['g3.type'] })], visual: OUTFIT_AVAILABLE },
  { id: 'v4-outfit-mixed-formality', scenario: 'outfit_items', occasion: 'Client Presentation', ...OUTFIT, extra: 1, description: 'A tailored blazer with jersey joggers: the joggers strain formality and occasion fit.', g: 'blazer with joggers', r: 'FGFGFG', c: 'HHHMHH', bands: [R, CA], profile: 'classic',
    obs: { images: [img(1, 'suiting', 'blazer', ['navy']), img(2, 'bottom', 'joggers', ['grey'], { details: ['elastic cuffs'] })] },
    components: [comp(1, 'suiting', 'Works well', 'The blazer brings the outfit towards business formality.', { supports: ['formality'], cites: ['g1.type'] }), comp(2, 'bottom', 'Needs attention', 'The joggers pull the outfit well below the expected formality.', { tension: ['formality', 'occasion', 'style'], cites: ['g2.type', 'g2.d1'] })], visual: OUTFIT_AVAILABLE },
  { id: 'v4-outfit-colour-clash', scenario: 'colour', ...OUTFIT, occasion: 'Birthday Party', extra: 1, description: 'A red top with an orange skirt: the skirt creates colour tension.', g: 'red top and orange skirt', r: 'GPGGFG', c: 'HHHMHH', bands: [R, CA], profile: 'bold',
    obs: { images: [img(1, 'top', 'blouse', ['red']), img(2, 'bottom', 'skirt', ['orange'])] },
    components: [comp(1, 'top', 'Works', 'The red blouse is festive on its own.', { supports: ['occasion'], cites: ['g1.colour'] }), comp(2, 'bottom', 'Needs attention', 'The orange skirt competes with the red blouse.', { tension: ['color', 'style'], cites: ['g2.colour'] })], visual: OUTFIT_AVAILABLE },
  { id: 'v4-outfit-one-item-tension', scenario: 'outfit_items', occasion: 'Corporate Interview', ...OUTFIT, extra: 2, description: 'Shirt, trousers and chunky trainers for an interview: one item strains the rest.', g: 'shirt, trousers and chunky trainers', r: 'FGFGFG', c: 'HHHMHH', bands: [R, CA], profile: 'classic',
    obs: { images: [img(1, 'top', 'shirt', ['white']), img(2, 'bottom', 'trousers', ['navy']), img(3, 'footwear', 'trainers', ['white'], { details: ['chunky sole'] })] },
    components: [comp(1, 'top', 'Works well', 'The white shirt is right for an interview.', { supports: ['formality', 'occasion'], cites: ['g1.type'] }), comp(2, 'bottom', 'Works well', 'The navy trousers are tidy and conservative.', { supports: ['formality'], cites: ['g2.type'] }), comp(3, 'footwear', 'Needs attention', 'The chunky trainers undercut the formality of the rest.', { tension: ['formality', 'occasion'], cites: ['g3.type', 'g3.d1'] })], visual: OUTFIT_AVAILABLE },
  { id: 'v4-outfit-multi-dimension', scenario: 'outfit_items', occasion: 'Formal Dinner', ...OUTFIT, extra: 1, description: 'A dress that supports several dimensions at once, with heels.', g: 'black dress and heels', r: 'EEEGEE', c: 'HHHMHH', bands: [HR, R], profile: 'classic',
    obs: { images: [img(1, 'dress', 'sheath dress', ['black'], { details: ['boat neckline'] }), img(2, 'footwear', 'heels', ['black'], { details: ['pointed toe'] })] },
    components: [comp(1, 'dress', 'Works well', 'The sheath dress carries the outfit for a formal dinner.', { supports: ['occasion', 'color', 'formality', 'style'], cites: ['g1.type', 'g1.colour', 'g1.d1'] }), comp(2, 'footwear', 'Works well', 'The heels match the dress.', { supports: ['formality'], cites: ['g2.type'] })], visual: OUTFIT_AVAILABLE },
  { id: 'v4-outfit-dna-street', scenario: 'outfit_items', occasion: 'Casual Outing', ...OUTFIT, extra: 2, dna: 'persona-street-relaxed', advisor: ADVISOR, description: 'With an invented Style DNA profile (street): hoodie, joggers and trainers.', g: 'hoodie, joggers and trainers', r: 'EGEGEE', c: 'HHHMHH', bands: [HR, R], profile: 'street',
    obs: { images: [img(1, 'top', 'hoodie', ['black']), img(2, 'bottom', 'joggers', ['grey']), img(3, 'footwear', 'trainers', ['white'])] },
    components: [comp(1, 'top', 'Works well', 'The hoodie sets a relaxed tone.', { supports: ['style_preference_match', 'occasion'], cites: ['g1.type'] }), comp(2, 'bottom', 'Works', 'The joggers match the hoodie.', { supports: ['style'], cites: ['g2.type'] }), comp(3, 'footwear', 'Works well', 'The trainers finish the casual look.', { supports: ['style_preference_match'], cites: ['g3.type'] })], visual: OUTFIT_AVAILABLE },
  { id: 'v4-outfit-dna-evening', scenario: 'outfit_items', occasion: 'Cocktail Party', ...OUTFIT, extra: 1, dna: 'persona-classic-tailored', advisor: ADVISOR, description: 'With an invented Style DNA profile (classic): a tailored dress and a clutch.', g: 'tailored dress and clutch', r: 'EEEGEE', c: 'HHHMHH', bands: [HR, R], profile: 'classic',
    obs: { images: [img(1, 'dress', 'tailored dress', ['navy']), img(2, 'accessory', 'clutch', ['gold'])] },
    components: [comp(1, 'dress', 'Works well', 'The tailored dress suits cocktail attire.', { supports: ['occasion', 'formality'], cites: ['g1.type'] }), comp(2, 'accessory', 'Works well', 'The gold clutch adds a dressy accent.', { supports: ['color'], cites: ['g2.colour'] })], visual: OUTFIT_AVAILABLE },
  { id: 'v4-outfit-occasion-beach', scenario: 'seasonal', occasion: 'Beach', ...OUTFIT, extra: 1, description: 'A short-sleeved shirt and shorts for the beach: the occasion states warm weather.', g: 'short-sleeved shirt and shorts', r: 'EGEEGG', c: 'HHHHHH', bands: [HR, R], profile: 'street',
    obs: { images: [img(1, 'top', 'shirt', ['white'], { details: ['short sleeves'] }), img(2, 'bottom', 'shorts', ['beige'])] },
    components: [comp(1, 'top', 'Works well', 'The short-sleeved shirt suits warm weather.', { supports: ['seasonality', 'occasion'], cites: ['g1.d1'] }), comp(2, 'bottom', 'Works well', 'The shorts are relaxed, as the beach expects.', { supports: ['seasonality', 'formality'], cites: ['g2.type'] })], visual: OUTFIT_AVAILABLE },
  { id: 'v4-outfit-missing-observations', scenario: 'integrity', occasion: 'Weekend', ...OUTFIT, extra: 1, description: 'Item contributions cite observations the output never gave: every contribution is dropped, the notes stay.', g: 'tee and jeans', r: 'GGGGGG', c: 'HHHMHH', bands: [R], profile: 'street',
    obs: undefined, evidenceFrom: { images: [img(1, 'top', 't-shirt', ['white']), img(2, 'bottom', 'jeans', ['blue'])] },
    components: [comp(1, 'top', 'Works', 'The tee is a simple base for the outfit.', { supports: ['style'], cites: ['g1.type'] }), comp(2, 'bottom', 'Works', 'The jeans keep the outfit casual.', { supports: ['occasion'], cites: ['g2.type'] })],
    visual: { observations: 'unavailable', evidence: 'unavailable', contributions: 'unavailable', problems: ['invalid_citation'] } },
  { id: 'v4-outfit-foreign-citation', scenario: 'integrity', occasion: 'Weekend', ...OUTFIT, extra: 1, description: 'Item 1 argues its effect from item 2: that contribution is dropped, the other is kept.', g: 'tee and jeans', r: 'GGGGGG', c: 'HHHMHH', bands: [R], profile: 'street',
    obs: { images: [img(1, 'top', 't-shirt', ['white']), img(2, 'bottom', 'jeans', ['blue'])] },
    components: [comp(1, 'top', 'Works', 'The tee is a simple base for the outfit.', { supports: ['color'], cites: ['g2.colour'] }), comp(2, 'bottom', 'Works', 'The jeans keep the outfit casual.', { supports: ['occasion'], cites: ['g2.type'] })],
    visual: { ...AVAILABLE, contributions: 'partial', problems: ['foreign_citation'] } },
  { id: 'v4-outfit-identity-mismatch', scenario: 'integrity', occasion: 'Weekend', ...OUTFIT, extra: 1, description: 'Item 2 is called a top while its observation identifies trousers: its contribution is dropped.', g: 'tee and trousers', r: 'GGGGGG', c: 'HHHMHH', bands: [R], profile: 'street',
    obs: { images: [img(1, 'top', 't-shirt', ['black']), img(2, 'bottom', 'trousers', ['beige'])] },
    components: [comp(1, 'top', 'Works', 'The tee is a simple base for the outfit.', { supports: ['style'], cites: ['g1.type'] }), comp(2, 'top', 'Works', 'This item pairs well with the tee.', { supports: ['color'], cites: ['g2.colour'] })],
    visual: { ...AVAILABLE, contributions: 'partial', problems: ['identity_mismatch'] } },
  { id: 'v4-outfit-uncited-effect', scenario: 'integrity', occasion: 'Weekend', ...OUTFIT, extra: 1, description: 'An item claims to support colour harmony without citing anything it shows.', g: 'tee and jeans', r: 'GGGGGG', c: 'HHHMHH', bands: [R], profile: 'street',
    obs: { images: [img(1, 'top', 't-shirt', ['white']), img(2, 'bottom', 'jeans', ['blue'])] },
    components: [comp(1, 'top', 'Works', 'The tee is a simple base for the outfit.', { supports: ['color'] }), comp(2, 'bottom', 'Works', 'The jeans keep the outfit casual.', { supports: ['occasion'], cites: ['g2.type'] })],
    visual: { ...AVAILABLE, contributions: 'partial', problems: ['uncited_effect'] } },
  { id: 'v4-outfit-duplicate-item', scenario: 'integrity', occasion: 'Weekend', ...OUTFIT, extra: 1, description: 'Two outfit images are observed as the same shirt: one garment counted twice.', g: 'two identical shirts', r: 'GGGGGG', c: 'HHHMHH', bands: [R], profile: 'street',
    obs: { images: [img(1, 'top', 'shirt', ['blue']), img(2, 'top', 'shirt', ['blue'])] },
    components: [comp(1, 'top', 'Works', 'The shirt is a plain everyday piece.', { unclear: ['formality'], cites: ['g1.type'] }), comp(2, 'top', 'Unable to tell', 'This looks like the same shirt again.', { unclear: ['formality'], cites: ['g2.type'] })], visual: OUTFIT_AVAILABLE },
]

const V4_CASES = [...M2_CASES, ...M3_CASES]

module.exports = { V4_CASES, CATALOGUE }
