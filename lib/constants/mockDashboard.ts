// Illustrative-only demo data for dashboard widgets.
// These are example analyses shown to demonstrate what the dashboard will look like
// once saved history is available. No backend, no database, no timestamps.

export interface RecentAnalysisPreview {
  id: string
  garment: string
  occasion: string
  verdict: 'Highly Recommended' | 'Recommended' | 'Consider Alternatives' | 'Not Recommended'
  score: number
}

export const RECENT_ANALYSES_PREVIEW: RecentAnalysisPreview[] = [
  { id: '1', garment: 'Navy Tailored Blazer', occasion: 'Interview', verdict: 'Highly Recommended', score: 4.7 },
  { id: '2', garment: 'Distressed Denim Jacket', occasion: 'Wedding', verdict: 'Not Recommended', score: 2.3 },
  { id: '3', garment: 'Linen Summer Shirt', occasion: 'Date Night', verdict: 'Recommended', score: 3.9 },
]

export interface QuickTip {
  title: string
  description: string
}

export const QUICK_TIPS: QuickTip[] = [
  { title: 'Match formality first', description: 'Occasion and formality carry the most weight in your verdict — get those right before worrying about color.' },
  { title: 'Name the conflict', description: 'If a garment clashes with your stated style, the report calls it out directly instead of scoring around it.' },
  { title: 'Confidence matters', description: 'A "Fair" rating with High confidence is more decisive than a "Good" rating with Low confidence.' },
  { title: 'Re-shoot in good light', description: 'Most "Unable to Analyze" results come from unclear photos — natural light helps the most.' },
]
