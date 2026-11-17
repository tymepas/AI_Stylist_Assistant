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

const PATTERNS: ReadonlyArray<readonly [ScreenedClaim, RegExp]> = [
  // Instructions printed on a garment or hidden in an image are data, never commands.
  ['instruction', /\b(ignore|disregard|override|forget)\b.{0,40}\b(instructions?|prompts?|rules?|previous|above)\b|\bsystem prompt\b|\byou are now\b|\b(rate|score) (this|it|everything) (as )?(excellent|highly)\b/i],
  ['link', /https?:\/\/|\bwww\.|\b[a-z0-9-]+\.(com|net|org|io|in|shop|store)\b/i],
  ['price', /[$€£₹]\s?\d|\b\d+(\.\d+)?\s?(usd|eur|gbp|inr|rupees?|dollars?)\b|\b(price[sd]?|cheap|expensive|discount(ed)?|on sale|bargain)\b/i],
  ['material', /\b\d{1,3}\s?%|\bmade (of|from)\b|\b(cotton|wool|silk|linen|cashmere|polyester|viscose|nylon|rayon|spandex|elastane|acrylic|fabric composition)\b/i],
  ['quality', /\b(durab(le|ility)|long[- ]lasting|comfortable|comfort|breathable|high[- ]quality|low[- ]quality|well[- ]made|cheaply made|premium quality)\b/i],
  ['brand', /\b(zara|h&m|gucci|prada|nike|adidas|uniqlo|levi'?s|myntra|amazon|ajio|shein|chanel|dior|louis vuitton|puma|reebok|mango)\b/i],
]

/** The claim categories a string makes, in a fixed order. Empty when it makes none. */
export function screenClaims(text: string): ScreenedClaim[] {
  return PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([claim]) => claim)
}
