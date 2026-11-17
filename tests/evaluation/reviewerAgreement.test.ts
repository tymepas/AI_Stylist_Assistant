/**
 * Second reviews: a rating is one person's judgement, so the evaluation records
 * where two reviewers of the same case differ, reports how far reviewers agree
 * with each other, and never treats a single reviewer as unquestionable.
 *
 * NOTHING HERE IS A REAL REVIEW. The cases, the "reviewers" and the outputs are
 * in-memory test fixtures (tests/helpers/qualityFixture.ts). No network is used.
 */

import { describe, expect, it, jest } from '@jest/globals'

jest.mock('server-only', () => ({}), { virtual: true })

import { evaluateRecording, renderMarkdown, serializeReport } from '@/evaluation/evaluate'
import { reviewerDisagreement } from '@/evaluation/quality'
import { describeReadiness, readinessLines } from '@/evaluation/readiness'
import { ReferenceSetError, futureDatedProblems, parseReferenceSet, referenceSetFingerprint, reviewerRatings, type ReferenceSet } from '@/evaluation/reference'
import { classifyMetricChanges } from '@/evaluation/regression'
import { degrade, fixtureCases, fixtureRecording, fixtureReferences } from '../helpers/qualityFixture'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secondReview = require('../../scripts/evaluation/second-review.cjs') as {
  buildSheet: (manifest: { cases: unknown[] }, set: unknown, caseIds: string[] | null) => { sheet: { format: string; reviewer: { id: string }; reviewed_on: string; cases: Array<{ case_id: string; dimension_ratings: Record<string, { rating: string; note?: string }> } & Record<string, unknown>> }; skipped: string[]; unknown: string[] }
  mergeSheet: (set: unknown, sheet: unknown) => { set: ReferenceSet; problems: string[]; differences: Array<{ case_id: string; dimensions: Array<{ dimension: string; first: string; second: string; severe: boolean }> }>; added: string[] }
}

const CURRENT = { promptVersion: 'aaaaaaaaaaaa', schemaVersion: 'analysis-output/2' }
const FIRST = { occasion: 'Excellent', color: 'Good', formality: 'Good', seasonality: 'Good', style: 'Fair', style_preference_match: 'Good' } as const

type Ratings = Record<string, { rating: string }>
const ratings = (change: Record<string, string> = {}): Ratings => Object.fromEntries(Object.entries({ ...FIRST, ...change }).map(([key, rating]) => [key, { rating }]))

/** The fixture references, with a second review added to the single-garment cases named in `second`. */
function withSecondReviews(second: Record<string, Record<string, string>>, basis: 'image_review' | 'brief' = 'image_review', outfits = 5): ReferenceSet {
  const set = JSON.parse(JSON.stringify(fixtureReferences(basis, outfits))) as ReferenceSet & { references: Array<Record<string, unknown>> }
  for (const reference of set.references) {
    const change = second[reference.case_id as string]
    if (change) reference.second_reviews = [{ reviewer: { id: 'second-reviewer' }, reviewed_on: '2026-11-05', dimension_ratings: ratings(change) }]
  }
  return parseReferenceSet(set, fixtureCases(basis, outfits))
}

const SINGLES = Array.from({ length: 8 }, (_, index) => `q-single-0${index + 1}`)
/** Ten twice-reviewed cases: the eight single cases and two outfits. */
const TEN = [...SINGLES, 'q-outfit-01', 'q-outfit-02']

describe('second reviews in a reference', () => {
  const cases = fixtureCases('image_review')
  const base = () => JSON.parse(JSON.stringify(fixtureReferences('image_review'))) as { references: Array<Record<string, unknown>> }
  const second = (extra: Record<string, unknown> = {}) => ({ reviewer: { id: 'second-reviewer' }, reviewed_on: '2026-11-05', dimension_ratings: ratings(), ...extra })
  const problemsOf = (change: (reference: Record<string, unknown>) => void): string[] => {
    const set = base()
    change(set.references[0])
    try {
      parseReferenceSet(set, cases)
      return []
    } catch (error) {
      return (error as ReferenceSetError).problems
    }
  }

  it('are accepted next to the first review, and both sets of ratings are kept', () => {
    const set = withSecondReviews({ 'q-single-01': { occasion: 'Good' } })
    const reference = set.references[0]
    expect(reviewerRatings(reference, 'occasion')).toEqual(['Excellent', 'Good'])
    expect(reviewerRatings(reference, 'color')).toEqual(['Good', 'Good'])
    // The first review is untouched.
    expect(reference.dimension_ratings?.occasion?.rating).toBe('Excellent')
  })

  it.each([
    ['by the first reviewer again', (reference: Record<string, unknown>) => { reference.second_reviews = [second({ reviewer: { id: 'test-reviewer' } })] }, /also the first reviewer/],
    ['by the same second reviewer twice', (reference: Record<string, unknown>) => { reference.second_reviews = [second(), second()] }, /appears twice/],
    ['that leaves a dimension out', (reference: Record<string, unknown>) => { const partial = ratings(); delete partial.style; reference.second_reviews = [second({ dimension_ratings: partial })] }, /rates all six dimensions; missing: style/],
    ['with a rating that does not exist', (reference: Record<string, unknown>) => { reference.second_reviews = [second({ dimension_ratings: ratings({ color: 'Great' }) })] }, /second_reviews/],
    ['without a date', (reference: Record<string, unknown>) => { reference.second_reviews = [{ reviewer: { id: 'second-reviewer' }, dimension_ratings: ratings() }] }, /second_reviews/],
    ['with an unknown field', (reference: Record<string, unknown>) => { reference.second_reviews = [second({ email: 'x@example.com' })] }, /second_reviews/],
  ])('refuses a second review %s', (_label, change, message) => {
    expect(problemsOf(change).join('\n')).toMatch(message)
  })

  it('refuses a second review on a synthetic expectation: only a human review can be reviewed again', () => {
    const set = JSON.parse(JSON.stringify(fixtureReferences('synthetic'))) as { references: Array<Record<string, unknown>> }
    set.references[0].second_reviews = [second()]
    expect(() => parseReferenceSet(set, fixtureCases('synthetic'))).toThrow(/only a human review/)
  })

  it('refuses a second review dated in the future, through the same check as the first review', () => {
    const set = withSecondReviews({ 'q-single-01': {} })
    expect(futureDatedProblems(set, '2026-11-04')).toEqual(['Reference q-single-01: the second review by "second-reviewer" is dated in the future'])
    expect(futureDatedProblems(set, '2026-11-05')).toEqual([])
  })

  it('changes the fingerprint of the reference set, so reports with and without it are not compared as equals', () => {
    expect(referenceSetFingerprint(withSecondReviews({ 'q-single-01': {} }))).not.toBe(referenceSetFingerprint(fixtureReferences('image_review')))
  })
})

describe('where reviewers differ', () => {
  it('lists the dimensions two reviewers rated differently, and marks those two bands or more apart', () => {
    const set = withSecondReviews({ 'q-single-01': { occasion: 'Good', style: 'Excellent', seasonality: 'Unable to Evaluate' } })
    expect(reviewerDisagreement(set.references[0])).toEqual({
      case_id: 'q-single-01',
      // occasion: Excellent vs Good (one band). style: Fair vs Excellent (two bands). seasonality: rated vs could not be judged.
      dimensions: ['occasion', 'seasonality', 'style'],
      severe: ['seasonality', 'style'],
    })
  })

  it('reports no difference when both agree, and nothing at all without a second review', () => {
    const set = withSecondReviews({ 'q-single-01': {} })
    expect(reviewerDisagreement(set.references[0])).toEqual({ case_id: 'q-single-01', dimensions: [], severe: [] })
    expect(reviewerDisagreement(set.references[1])).toBeNull()
  })
})

describe('agreement between reviewers in a report', () => {
  const cases = fixtureCases('image_review', 10)
  // Ten cases reviewed twice. On three of them the second reviewer rates the occasion Good instead of Excellent,
  // and on one of those the style Excellent instead of Fair.
  const references = withSecondReviews(Object.fromEntries(TEN.map((id, index) => [id, index < 3 ? { occasion: 'Good', ...(index === 0 ? { style: 'Excellent' } : {}) } : {}])), 'image_review', 10)
  const report = evaluateRecording(fixtureRecording(cases, 'model'), cases, CURRENT, 'replay', { references })
  const reviewers = report.quality.reviewer_agreement.image_reviewed

  it('counts cases, and gives one value per case', () => {
    expect(reviewers.cases).toBe(10)
    expect(reviewers.dimensions.occasion.exact_rate).toMatchObject({ status: 'measured', value: 0.7, n: 10 })
    expect(reviewers.dimensions.occasion.within_one_rate).toMatchObject({ status: 'measured', value: 1, n: 10 })
    expect(reviewers.dimensions.occasion.mean_distance).toMatchObject({ value: 0.3, n: 10 })
    expect(reviewers.dimensions.style.exact_rate).toMatchObject({ value: 0.9, n: 10 })
    expect(reviewers.dimensions.style.within_one_rate).toMatchObject({ value: 0.9, n: 10 })
    expect(reviewers.dimensions.color.exact_rate).toMatchObject({ value: 1, n: 10 })
  })

  it('lists every case the reviewers differ on', () => {
    expect(reviewers.disagreements).toEqual([
      { case_id: 'q-single-01', dimensions: ['occasion', 'style'], severe: ['style'] },
      { case_id: 'q-single-02', dimensions: ['occasion'], severe: [] },
      { case_id: 'q-single-03', dimensions: ['occasion'], severe: [] },
    ])
  })

  it('says how often the model lies within the range the reviewers span', () => {
    // The model rates the occasion Excellent everywhere: inside every range, although it differs from one reviewer on three cases.
    expect(reviewers.model_within_reviewer_range.occasion).toMatchObject({ status: 'measured', value: 1, n: 10 })
    // Style: the model says Fair on the single cases (inside every range) and Good on the two outfits, where both reviewers said Fair.
    expect(reviewers.model_within_reviewer_range.style).toMatchObject({ value: 0.8, n: 10 })
    expect(report.metric_index['agreement.image_reviewed.style.within_reviewer_range_rate']).toMatchObject({ status: 'measured', value: 0.8, n: 10, direction: 'higher_is_better', needs_references: true })
  })

  it('counts a model rating between two reviewers as inside their range', () => {
    const wide = withSecondReviews({ 'q-single-01': { style: 'Excellent' } })
    const fixture = fixtureCases('image_review')
    // First reviewer Fair, second Excellent; the model says Good, which neither gave and which lies between them.
    const recording = fixtureRecording(fixture, 'model', (output, caseId) => (caseId === 'q-single-01' ? { ...output, dimensions: { ...output.dimensions, style: { ...output.dimensions.style, rating: 'Good' } } } : output))
    const result = evaluateRecording(recording, fixture, CURRENT, 'replay', { references: wide })
    expect(result.quality.reviewer_agreement.image_reviewed.model_within_reviewer_range.style).toMatchObject({ value: 1, n: 1, status: 'insufficient_sample' })
    // Against the first reviewer alone the same rating is a disagreement: that is the difference a second review makes visible.
    expect(result.quality.agreement.image_reviewed.dimensions.style.exact_rate.value).toBeLessThan(1)
  })

  it('does not index agreement between reviewers: it describes the reviews, so it can neither regress nor improve', () => {
    expect(Object.keys(report.metric_index).filter((name) => name.includes('reviewer_agreement'))).toEqual([])
    const worse = evaluateRecording(fixtureRecording(cases, 'model', degrade), cases, CURRENT, 'replay', { references })
    expect(worse.quality.reviewer_agreement.image_reviewed.dimensions).toEqual(report.quality.reviewer_agreement.image_reviewed.dimensions)
    // The model's position within the reviewers' range does regress, and is caught.
    expect(classifyMetricChanges(report, worse).regressions).toContain('agreement.image_reviewed.occasion.within_reviewer_range_rate')
  })

  it('is reported even for hand-written outputs, because it needs no output at all', () => {
    const fixtureOutputs = evaluateRecording(fixtureRecording(cases, 'synthetic_fixture'), cases, CURRENT, 'mock', { references })
    expect(fixtureOutputs.quality.image_grounded_accuracy.status).toBe('unavailable')
    expect(fixtureOutputs.quality.reviewer_agreement.image_reviewed.dimensions.occasion.exact_rate).toMatchObject({ status: 'measured', value: 0.7, n: 10 })
    // The model figure is still withheld: fixture outputs are never scored against human reviews.
    expect(fixtureOutputs.quality.reviewer_agreement.image_reviewed.model_within_reviewer_range.occasion).toMatchObject({ status: 'unavailable', value: null })
  })

  it('names the reviewers in the summary and shows the disagreement in the Markdown, without any model text', () => {
    expect(report.references).toMatchObject({ image_cases_with_second_review: 10, image_second_reviewers: ['second-reviewer'] })
    const markdown = renderMarkdown(report)
    expect(markdown).toContain('A reference rating is one reviewer\'s judgement, not a fact about the image.')
    expect(markdown).toContain('### Agreement between reviewers: human-reviewed images')
    expect(markdown).toContain('| q-single-01 | occasion, style | style |')
    expect(markdown).toContain('- Rated by a second person as well: 10 of 22 image-reviewed case(s) (second-reviewer)')
    expect(serializeReport(report)).not.toContain('navy blazer suits')
  })

  it('tells the reader what follows from it', () => {
    expect(report.next_steps.some((step) => step.startsWith('Reviewers differ from each other on 3 of 10 twice-reviewed case(s) (1 by two bands or more): q-single-01, q-single-02, q-single-03.'))).toBe(true)
    const single = evaluateRecording(fixtureRecording(cases, 'model'), cases, CURRENT, 'replay', { references: fixtureReferences('image_review', 10) })
    expect(single.next_steps.some((step) => step.startsWith('No image-reviewed case was rated by a second reviewer.'))).toBe(true)
    expect(single.quality.reviewer_agreement.image_reviewed.dimensions.occasion.exact_rate).toEqual({ status: 'unavailable', reason: 'Unavailable: no case of this tier was rated by a second reviewer', value: null, n: 0, se: null })
  })

  it('marks agreement from fewer than ten twice-reviewed cases as too few to conclude', () => {
    const few = withSecondReviews({ 'q-single-01': { occasion: 'Good' }, 'q-single-02': {} })
    const fixture = fixtureCases('image_review')
    const result = evaluateRecording(fixtureRecording(fixture, 'model'), fixture, CURRENT, 'replay', { references: few })
    expect(result.quality.reviewer_agreement.image_reviewed.dimensions.occasion.exact_rate).toMatchObject({ status: 'insufficient_sample', value: 0.5, n: 2 })
  })
})

describe('readiness of a reviewed dataset', () => {
  it('counts image-reviewed cases per garment mode, in cases, and lists reviewer differences', () => {
    const cases = fixtureCases('image_review', 10)
    const readiness = describeReadiness(withSecondReviews({ 'q-single-01': { occasion: 'Good' }, 'q-single-02': {} }, 'image_review', 10), cases)
    expect(readiness.image_reviewed_by_mode).toEqual({ single: 8, same_garment_views: 4, outfit_items: 10 })
    expect(readiness.image_reviewed_short_by).toEqual({ single: 2, same_garment_views: 6, outfit_items: 0 })
    expect(readiness.ready_for_measured_figures).toBe(false)
    expect(readiness.image_reviewed_scorable).toBe(22)
    expect(readiness.second_reviews).toEqual({ cases: 2, reviewers: ['second-reviewer'], disagreements: [{ case_id: 'q-single-01', dimensions: ['occasion'], severe: [] }] })
    const lines = readinessLines(readiness)
    expect(lines).toContain('Reviews per mode: NOT enough for measured figures (10 image-reviewed cases per mode): single needs 2 more, same_garment_views needs 6 more.')
    expect(lines).toContain('Second reviews: 2 case(s) rated by a second person (second-reviewer); reviewers differ on 1 of them.')
    expect(lines).toContain('  reviewers differ on q-single-01: occasion')
  })

  it('says plainly when no rating has been checked against a second person', () => {
    const cases = fixtureCases('image_review')
    expect(readinessLines(describeReadiness(fixtureReferences('image_review'), cases))).toContain('Second reviews: none. Every rating is one person\'s judgement and has not been checked against another\'s.')
  })

  it('counts nothing for references that are not image reviews', () => {
    const readiness = describeReadiness(fixtureReferences('brief'), fixtureCases('brief'))
    expect(readiness.image_reviewed_by_mode).toEqual({ single: 0, same_garment_views: 0, outfit_items: 0 })
    expect(readiness.image_reviewed_scorable).toBe(0)
  })
})

describe('the second-review tool', () => {
  const cases = fixtureCases('image_review')
  const set = () => JSON.parse(JSON.stringify(fixtureReferences('image_review'))) as ReferenceSet
  const filled = (change: Record<string, Record<string, string>> = {}) => {
    const { sheet } = secondReview.buildSheet({ cases }, set(), ['q-single-01', 'q-single-02'])
    sheet.reviewer = { id: 'second-reviewer' }
    sheet.reviewed_on = '2026-11-05'
    for (const entry of sheet.cases) entry.dimension_ratings = ratings(change[entry.case_id])
    return sheet
  }

  it('makes a blind sheet: nothing the first reviewer concluded is in it', () => {
    const { sheet, skipped } = secondReview.buildSheet({ cases }, set(), null)
    expect(sheet.cases).toHaveLength(17)
    expect(skipped).toEqual([])
    const text = JSON.stringify(sheet)
    for (const fragment of ['Excellent', 'Good', 'Fair', 'test-reviewer', '2026-11-01', 'navy', 'key_facts', 'garment_description', 'comparison_group', 'sha256']) expect(text).not.toContain(fragment)
    expect(sheet.cases[0]).toMatchObject({ case_id: 'q-single-01', occasion: 'Client Meeting', garment_mode: 'single', images: ['q-single-01/photo.jpg', 'q-single-01/garment-1.jpg'] })
    expect(Object.values(sheet.cases[0].dimension_ratings).every((entry) => entry.rating === 'TO DO')).toBe(true)
  })

  it('leaves out cases whose first review is not finished, and says which', () => {
    const unfinished = set() as unknown as { references: Array<Record<string, unknown>> }
    unfinished.references[0].status = 'in_progress'
    const { sheet, skipped, unknown } = secondReview.buildSheet({ cases }, unfinished, ['q-single-01', 'q-single-02', 'no-such-case'])
    expect(sheet.cases.map((entry) => entry.case_id)).toEqual(['q-single-02'])
    expect(skipped).toEqual(['q-single-01'])
    expect(unknown).toEqual(['no-such-case'])
  })

  it('adds a filled-in sheet as second reviews that the reference validator accepts, and lists the differences', () => {
    const original = set()
    const { set: merged, problems, differences, added } = secondReview.mergeSheet(original, filled({ 'q-single-01': { occasion: 'Good', style: 'Excellent' } }))
    expect(problems).toEqual([])
    expect(added).toEqual(['q-single-01', 'q-single-02'])
    expect(differences).toEqual([{ case_id: 'q-single-01', dimensions: [
      { dimension: 'occasion', first: 'Excellent', second: 'Good', severe: false },
      { dimension: 'style', first: 'Fair', second: 'Excellent', severe: true },
    ] }])
    const parsed = parseReferenceSet(merged, cases)
    expect(reviewerRatings(parsed.references[0], 'occasion')).toEqual(['Excellent', 'Good'])
    // The first review, and the set that was passed in, are unchanged.
    expect(parsed.references[0].dimension_ratings).toEqual(original.references[0].dimension_ratings)
    expect(original.references[0].second_reviews).toBeUndefined()
  })

  it.each([
    ['an unfilled rating', (sheet: ReturnType<typeof filled>) => { sheet.cases[0].dimension_ratings.color = { rating: 'TO DO' } }, /q-single-01: color is not rated/],
    ['a missing reviewer', (sheet: ReturnType<typeof filled>) => { sheet.reviewer = { id: 'TO DO' } }, /reviewer\.id must be a short identifier/],
    ['a name in place of an identifier', (sheet: ReturnType<typeof filled>) => { sheet.reviewer = { id: 'Jane Doe' } }, /not a name or an email address/],
    ['a missing date', (sheet: ReturnType<typeof filled>) => { sheet.reviewed_on = 'TO DO: YYYY-MM-DD' }, /reviewed_on must be a date/],
    ['the first reviewer reviewing again', (sheet: ReturnType<typeof filled>) => { sheet.reviewer = { id: 'test-reviewer' } }, /did the first review/],
    ['a case that has no reference', (sheet: ReturnType<typeof filled>) => { sheet.cases[0].case_id = 'no-such-case' }, /no such reference/],
  ])('refuses a sheet with %s, and adds nothing', (_label, change, message) => {
    const sheet = filled()
    change(sheet)
    const original = set()
    const result = secondReview.mergeSheet(original, sheet)
    expect(result.problems.join('\n')).toMatch(message)
    expect(result.added).toEqual([])
    expect(result.set).toBe(original)
  })

  it('refuses the same reviewer a second time', () => {
    const once = secondReview.mergeSheet(set(), filled()).set
    expect(secondReview.mergeSheet(once, filled()).problems.join('\n')).toMatch(/has already given a second review/)
  })
})
