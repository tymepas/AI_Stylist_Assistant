export const STYLE_OPTIONS: string[] = [
  'Casual',
  'Classic',
  'Minimalist',
  'Streetwear',
  'Business',
  'Bohemian',
  'Sporty',
  'Trendy',
  'Edgy',
  'Romantic',
]

export interface ColorOption {
  name: string
  hex: string
}

export const COLOR_OPTIONS: ColorOption[] = [
  { name: 'Black', hex: '#0a0a0a' },
  { name: 'White', hex: '#f5f5f5' },
  { name: 'Navy', hex: '#1e293b' },
  { name: 'Gray', hex: '#6b7280' },
  { name: 'Beige', hex: '#d6c3a5' },
  { name: 'Red', hex: '#dc2626' },
  { name: 'Blue', hex: '#2563eb' },
  { name: 'Green', hex: '#16a34a' },
  { name: 'Pink', hex: '#ec4899' },
  { name: 'Purple', hex: '#7c3aed' },
  { name: 'Yellow', hex: '#eab308' },
  { name: 'Brown', hex: '#78350f' },
]

export const OCCASION_OPTIONS: string[] = [
  'Work',
  'Casual Outing',
  'Date Night',
  'Wedding',
  'Interview',
  'Party',
  'Travel',
  'Formal Event',
]
