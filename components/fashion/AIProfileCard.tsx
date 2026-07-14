'use client'

import { Palette, Sparkles, Star } from 'lucide-react'
import type { AIProfileConfidence, AIStyleProfile } from '@/types/schema'

interface AIProfileCardProps {
  profile: AIStyleProfile
}

const SKIN_TONE_SWATCH: Record<NonNullable<AIStyleProfile['coloring']['skin_tone_depth']>, string> = {
  'very light': '#f3d9cc',
  light: '#e6b99a',
  'medium light': '#c88f6a',
  medium: '#a86f4d',
  'medium deep': '#814b31',
  deep: '#5b3225',
}

const HARMONY_PALETTES: Record<'cool' | 'warm' | 'neutral', string[]> = {
  cool: ['#7695c9', '#a490b9', '#8eb9b0'],
  warm: ['#c98259', '#b69a4d', '#a96d6e'],
  neutral: ['#8b9b91', '#958a7a', '#7d90a5'],
}

function display(value: string | null): string {
  return value ? value.replace(/_/g, ' ') : '—'
}

function confidenceLabel(confidence: AIProfileConfidence): string {
  return confidence === 'High' ? 'High clarity' : confidence === 'Medium' ? 'Moderate clarity' : 'Limited clarity'
}

function confidenceStars(confidence: AIProfileConfidence): number {
  return confidence === 'High' ? 5 : confidence === 'Medium' ? 3 : 2
}

function ConfidenceIndicator({ confidence }: { confidence: AIProfileConfidence }) {
  const filled = confidenceStars(confidence)
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground" aria-label={`${confidenceLabel(confidence)} confidence`}>
      <span className="inline-flex" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => <Star key={index} className={`h-3 w-3 ${index < filled ? 'fill-primary text-primary' : 'text-border'}`} />)}
      </span>
      {confidenceLabel(confidence)}
    </span>
  )
}

function DetailSection({ title, confidence, children }: { title: string; confidence?: AIProfileConfidence; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border/70 bg-gradient-to-b from-secondary/35 to-secondary/10 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{title}</h4>
        {confidence && <ConfidenceIndicator confidence={confidence} />}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function DetailGrid({ items }: { items: Array<{ label: string; value: string }> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="mt-1 capitalize text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export default function AIProfileCard({ profile }: AIProfileCardProps) {
  const { coloring, proportions, aesthetic_signals: signals, analysis_notes: notes } = profile
  const skinTone = [coloring.skin_tone_depth, coloring.skin_tone_undertone].filter(Boolean).join(' · ')
  const palette = coloring.skin_tone_undertone ? HARMONY_PALETTES[coloring.skin_tone_undertone] : HARMONY_PALETTES.neutral
  const skinSwatch = coloring.skin_tone_depth ? SKIN_TONE_SWATCH[coloring.skin_tone_depth] : '#71717a'
  const hairSwatch = coloring.hair_color_family === 'light' ? '#c9a875' : coloring.hair_color_family === 'medium' ? '#8b6347' : coloring.hair_color_family === 'vivid' ? '#a45a62' : '#423028'

  return (
    <div className="space-y-5">
      <DetailSection title="Style DNA">
        <div className="flex flex-wrap gap-2.5">
          {profile.style_keywords.map((item) => (
            <span key={item.keyword} className={`rounded-full border border-primary/25 bg-primary/10 px-3.5 py-1.5 text-xs font-semibold tracking-wide text-primary shadow-sm shadow-primary/5 ${item.confidence === 'Low' ? 'opacity-65' : item.confidence === 'Medium' ? 'opacity-80' : ''}`}>
              {item.keyword}
            </span>
          ))}
        </div>
      </DetailSection>

      <div className="grid gap-5 sm:grid-cols-2">
        <DetailSection title="Coloring" confidence={coloring.confidence}>
          <div className="flex items-start gap-4">
            <div className="flex shrink-0 gap-2 pt-0.5" aria-label="Coloring cues">
              <span className="h-9 w-9 rounded-full border-2 border-background shadow-sm ring-1 ring-border" style={{ backgroundColor: skinSwatch }} title="Skin tone cue" />
              <span className="h-9 w-9 rounded-full border-2 border-background shadow-sm ring-1 ring-border" style={{ backgroundColor: hairSwatch }} title="Hair color cue" />
            </div>
            <DetailGrid items={[
              { label: 'Skin tone', value: skinTone || '—' },
              { label: 'Hair', value: display(coloring.hair_color) },
              { label: 'Contrast', value: coloring.high_contrast === null ? '—' : coloring.high_contrast ? 'High' : 'Low' },
            ]} />
          </div>
          <div className="mt-5 border-t border-border/70 pt-4">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Palette className="h-3.5 w-3.5 text-primary" aria-hidden="true" />Color harmony cues</p>
            <div className="mt-2 flex gap-2" aria-label="Color harmony palette">
              {palette.map((color) => <span key={color} className="h-5 w-9 rounded-full border border-background/50 shadow-sm" style={{ backgroundColor: color }} />)}
            </div>
          </div>
        </DetailSection>
        <DetailSection title="Proportions" confidence={proportions.confidence}>
          <DetailGrid items={[
            { label: 'Frame', value: display(proportions.frame_width) },
            { label: 'Torso', value: display(proportions.torso_length) },
            { label: 'Shoulders', value: display(proportions.shoulder_breadth) },
            { label: 'Visibility', value: notes.visibility_limitations.length ? 'Partial view' : 'Clear view' },
          ]} />
        </DetailSection>
      </div>

      <DetailSection title="Observed Style" confidence={signals.confidence}>
        <DetailGrid items={[
          { label: 'Formality', value: display(signals.current_outfit_formality) },
          { label: 'Style signals', value: signals.current_outfit_style.length ? signals.current_outfit_style.map((style) => display(style)).join(', ') : '—' },
          { label: 'Accessories', value: display(signals.accessory_presence) },
          { label: 'Pattern', value: display(signals.pattern_preference_signal) },
        ]} />
      </DetailSection>

      <section className="rounded-2xl border border-primary/15 bg-primary/[0.035] p-5">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"><Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />Stylist&apos;s read</div>
        <p className="mt-3 text-sm leading-relaxed text-foreground/85">{notes.confidence_summary}</p>
        {notes.visibility_limitations.length > 0 && <p className="mt-3 text-xs leading-relaxed text-muted-foreground">To keep this profile reliable, some details are treated more conservatively: {notes.visibility_limitations.join(', ')}.</p>}
      </section>
    </div>
  )
}