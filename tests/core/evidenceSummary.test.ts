/**
 * The evidence summary describes a verdict; it never changes one. These tests
 * also tie the weights and band boundaries the report DISPLAYS to the ones
 * `computeVerdict` actually USES, so the report can never show a formula that
 * differs from the calculation.
 */

import { BAND_FLOORS, DIMENSION_DISPLAY, MAX_SCORE, describeEvidence, summarizeEvidence } from '@/lib/services/evidenceSummary'
import { computeVerdict } from '@/lib/services/analysisService'
import { buildCompleteAnalysisResult } from '@/lib/services/analysisResultService'
import type { Dimensions, Rating } from '@/types/schema'
import { allRated, dimension } from '../helpers/fixtures'

const asDimensions = (value: unknown) => value as Dimensions

function rated(overrides: Partial<Record<keyof Dimensions, { rating?: Rating; confidence?: 'High' | 'Medium' | 'Low' }>>, base: Rating = 'Good'): Dimensions {
  const dimensions = allRated(base) as unknown as Record<string, { rating: Rating; reason: string; confidence: string }>
  for (const [key, change] of Object.entries(overrides)) dimensions[key] = { ...dimensions[key], ...change }
  return asDimensions(dimensions)
}

describe('displayed formula matches the real one', () => {
  it('shows the weight computeVerdict gives each dimension', () => {
    // From all Fair (3.0), raising one dimension to Excellent (+2) adds twice its weight to the score.
    for (const entry of DIMENSION_DISPLAY) {
      const raised = computeVerdict(asDimensions({ ...allRated('Fair'), [entry.key]: dimension('Excellent') })).verdict_score
      const actualPercent = Math.round(((raised - 3) / 2) * 100)
      expect({ key: entry.key, percent: actualPercent }).toEqual({ key: entry.key, percent: entry.weightPercent ?? 0 })
    }
    expect(DIMENSION_DISPLAY.reduce((sum, entry) => sum + (entry.weightPercent ?? 0), 0)).toBe(100)
  })

  it('shows the band boundaries computeVerdict applies', () => {
    const bandAt = (score: number) => {
      // Find ratings that produce this score: occasion and style preference drive it in 0.1 steps.
      for (const ratings of everyCombination()) {
        const result = computeVerdict(ratings)
        if (result.verdict_score === score) return result.overall_recommendation
      }
      throw new Error(`No combination gives ${score}`)
    }
    for (const { band, floor } of BAND_FLOORS.filter((entry) => entry.floor > 0)) {
      expect(bandAt(floor)).toBe(band)
      expect(bandAt(Math.round((floor - 0.1) * 10) / 10)).not.toBe(band)
    }
    expect(MAX_SCORE).toBe(computeVerdict(asDimensions(allRated('Excellent'))).verdict_score)
    expect(BAND_FLOORS.map((entry) => entry.band)).toEqual(['Highly Recommended', 'Recommended', 'Consider Alternatives', 'Not Recommended'])
  })
})

function* everyCombination(): Generator<Dimensions> {
  const ratings: Rating[] = ['Excellent', 'Good', 'Fair', 'Poor']
  for (const occasion of ratings) for (const formality of ratings) for (const preference of ratings) for (const color of ratings) for (const season of ratings) {
    yield asDimensions({ ...allRated('Good'), occasion: dimension(occasion), formality: dimension(formality), style_preference_match: dimension(preference), color: dimension(color), seasonality: dimension(season) })
  }
}

describe('evidence summary', () => {
  it('is full when every weighted dimension is rated without Low confidence', () => {
    const summary = summarizeEvidence(rated({ occasion: { confidence: 'Medium' } }))
    expect(summary).toEqual({ level: 'full', weightedTotal: 5, weightedRated: 5, unrated: [], lowConfidence: [], coveragePercent: 100 })
    expect(describeEvidence(summary)).toEqual([])
  })

  it('ignores style consistency, which is not part of the verdict', () => {
    expect(summarizeEvidence(rated({ style: { rating: 'Unable to Evaluate', confidence: 'Low' } })).level).toBe('full')
  })

  it('is limited when a weighted dimension could not be evaluated, and says how much of the weight was rated', () => {
    const summary = summarizeEvidence(rated({ formality: { rating: 'Unable to Evaluate' }, seasonality: { rating: 'Unable to Evaluate' } }))
    expect(summary).toMatchObject({ level: 'limited', weightedRated: 3, unrated: ['formality', 'seasonality'], coveragePercent: 65 })
    expect(describeEvidence(summary)).toEqual(['This verdict rests on 3 of 5 weighted dimensions (65% of the weight). Not evaluated: formality and seasonality.'])
  })

  it('is limited when a rated dimension has Low confidence, and names it', () => {
    const summary = summarizeEvidence(rated({ color: { confidence: 'Low' } }))
    expect(summary).toMatchObject({ level: 'limited', lowConfidence: ['color'], coveragePercent: 100 })
    expect(describeEvidence(summary)).toEqual(['Low confidence on color harmony: treat that rating as tentative.'])
  })

  it('is insufficient when nothing that counts could be evaluated', () => {
    const summary = summarizeEvidence(asDimensions(allRated('Unable to Evaluate')))
    expect(summary).toMatchObject({ level: 'insufficient', weightedRated: 0, coveragePercent: 0 })
    expect(describeEvidence(summary)[0]).toMatch(/None of the dimensions that make up the verdict could be evaluated/)
  })

  it('never changes the verdict: it is computed from the result and not the other way round', () => {
    for (const dimensions of [rated({}), rated({ color: { confidence: 'Low' } }), rated({ formality: { rating: 'Unable to Evaluate' } }), asDimensions(allRated('Unable to Evaluate'))]) {
      const before = computeVerdict(dimensions)
      const frozen = JSON.stringify(dimensions)
      summarizeEvidence(dimensions)
      describeEvidence(summarizeEvidence(dimensions))
      expect(JSON.stringify(dimensions)).toBe(frozen)
      expect(computeVerdict(dimensions)).toEqual(before)
      expect(buildCompleteAnalysisResult(dimensions as never)).toMatchObject(before)
    }
  })
})
