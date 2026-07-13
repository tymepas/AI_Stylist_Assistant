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

export interface OccasionGroup {
  label: string
  options: string[]
}

export const OCCASION_GROUPS: OccasionGroup[] = [
  {
    label: 'Work',
    options: [
      'Office Work',
      'Client Meeting',
      'Client Presentation',
      'Corporate Interview',
      'Startup Interview',
      'Networking Event',
      'Business Lunch',
      'Business Casual',
      'Conference',
    ],
  },
  {
    label: 'Social',
    options: [
      'Coffee Date',
      'Dinner Date',
      'First Date',
      'Birthday Party',
      'Night Out',
      'House Party',
      'Cocktail Party',
    ],
  },
  {
    label: 'Formal',
    options: [
      'Wedding Guest',
      'Wedding Reception',
      'Formal Dinner',
      'Black Tie Event',
      'Award Ceremony',
    ],
  },
  {
    label: 'Casual',
    options: [
      'Casual Outing',
      'Shopping',
      'College',
      'Weekend',
      'Travel',
      'Vacation',
    ],
  },
  {
    label: 'Outdoor / Seasonal',
    options: [
      'Outdoor Event',
      'Summer Event',
      'Winter Event',
      'Beach',
      'Rainy Day',
    ],
  },
]

/** Flat list of all occasions, derived from OCCASION_GROUPS. */
export const OCCASION_OPTIONS: string[] = OCCASION_GROUPS.flatMap((g) => g.options)
