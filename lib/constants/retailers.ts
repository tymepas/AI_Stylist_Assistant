export type RetailerId = 'myntra' | 'amazon' | 'ajio'

export interface Retailer {
  id: RetailerId
  label: string
  /** Receives an already URL-encoded query. */
  buildSearchUrl: (encodedQuery: string) => string
}

/** Static retailer configuration only; no affiliate parameters are used. */
export const RETAILERS: Retailer[] = [
  { id: 'myntra', label: 'View on Myntra', buildSearchUrl: (query) => `https://www.myntra.com/${query}` },
  { id: 'amazon', label: 'View on Amazon', buildSearchUrl: (query) => `https://www.amazon.in/s?k=${query}` },
  { id: 'ajio', label: 'View on Ajio', buildSearchUrl: (query) => `https://www.ajio.com/search/?text=${query}` },
]