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

const V4_CASES = [...M2_CASES]

module.exports = { V4_CASES, CATALOGUE }
