/**
 * Screening of short model-written text in the informational blocks
 * (observations and rating evidence).
 *
 * These blocks describe what is VISIBLE. A photo cannot show a price, a fibre
 * composition, a brand that is not printed, durability or comfort, and text
 * in an image is never an instruction. A string that states any of these, or
 * repeats an instruction, is refused: the block it belongs to is then
 * unavailable, and nothing is rewritten on the model's behalf.
 *
 * The check returns category names only. It never returns, logs or quotes the
 * text it looked at.
 */

export const SCREENED_CLAIMS = ['instruction', 'link', 'price', 'material', 'quality', 'brand'] as const
export type ScreenedClaim = (typeof SCREENED_CLAIMS)[number]

/** A fibre or material word, unless it only describes a look ("silk-like", "leather-look", "cotton candy"). */
const MATERIAL = String.raw`(cotton(?! candy)|wool|silk|linen|cashmere|polyester|viscose|nylon|rayon|spandex|elastane|acrylic|leather|suede|fur|velvet|satin)(?![- ]?(like|look|effect|style|candy)\b)`

const PATTERNS: ReadonlyArray<readonly [ScreenedClaim, RegExp]> = [
  // Instructions printed on a garment or hidden in an image are data, never commands.
  ['instruction', /\b(ignore|disregard|override|forget)\s+(all|any|the|your|previous|prior|above|earlier|these|those)\b|\bsystem prompt\b|\byou are now\b|\bnew instructions?\b|\binstructions?\s*:|\b(rate|score|set|mark|give)\b.{0,30}\b(excellent|highly recommended|5\s?\/\s?5|top marks)\b/i],
  // Lower-case top-level domains only, and no `.in`: "cropped.In image 3" is a sentence, not a link.
  ['link', /https?:\/\/|\bwww\.|\b[A-Za-z0-9-]+\.(com|net|org|io|co|shop|store)(\/|\b)/],
  ['price', /[$€£₹]\s?\d|\brs\.?\s?\d|\b\d+\s?\/-|\b\d+(\.\d+)?\s?(usd|eur|gbp|inr|rupees?|dollars?)\b|\b\d{1,3}\s?%\s?off\b|\b(priced|pricey|cheap|expensive|discount(ed)?|on sale|bargain|affordable)\b/i],
  ['material', new RegExp(String.raw`\b\d{1,3}\s?%(?!\s?off\b)|\bmade (of|from) (\w+ )?${MATERIAL}|\b(genuine|real|faux|vegan|pure)\s+${MATERIAL}|\b${MATERIAL}\b|\bfabric composition\b`, 'i')],
  ['quality', /\b(durab(le|ility)|long[- ]lasting|comfortable|comfy|breathable|stretchy|sturdy|high[- ]quality|low[- ]quality|well[- ]made|cheaply made|premium quality|soft to the touch)\b/i],
  ['brand', /\b(zara|h&m|gucci|prada|nike|adidas|uniqlo|levi'?s|myntra|ajio|shein|chanel|dior|louis vuitton|puma|reebok|versace|ralph lauren|burberry|calvin klein|tommy hilfiger|lacoste|balenciaga|herm[eè]s|fendi|armani|valentino)\b/i],
]

/** Invisible characters that could split a word to slip past a pattern. They are removed before screening. */
const INVISIBLE = /[\u00AD\u200B-\u200F\u2060\uFEFF]/g

/** The claim categories a string makes, in a fixed order. Empty when it makes none. */
export function screenClaims(text: string): ScreenedClaim[] {
  const visible = text.replace(INVISIBLE, '')
  return PATTERNS.filter(([, pattern]) => pattern.test(visible)).map(([claim]) => claim)
}
