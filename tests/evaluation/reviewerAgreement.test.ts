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
import { ReferenceSetError, futureDatedProblems, parseReferenceSet, referenceScoringFingerprint, referenceSetFingerprint, referenceSetSchema, reviewerRatings, type ReferenceSet } from '@/evaluation/reference'
import { assessBaselineUpdate, classifyMetricChanges } from '@/evaluation/regression'
import { manifestSchema } from '@/benchmark/harness'
import { validateAIStyleProfile } from '@/lib/services/openai/aiStyleProfileSchema'
import { buildUserContext } from '@/lib/services/openai/openAIAnalysisService'
import { degrade, fixtureCases, fixtureRecording, fixtureReferences } from '../helpers/qualityFixture'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secondReview = require('../../scripts/evaluation/second-review.cjs') as {
  buildSheet: (manifest: { cases: unknown[] }, set: unknown, caseIds: string[] | null) => { sheet: Sheet; skipped: string[]; unknown: string[] }
  mergeSheet: (set: unknown, sheet: unknown) => { set: ReferenceSet; problems: string[]; differences: Array<{ case_id: string; compared_with: string; dimensions: Array<{ dimension: string; earlier: string; given: string; far_apart: boolean }> }>; added: string[] }
  LIMITS: { secondReviews: number; dimensionNote: number; reviewNotes: number }
}
type SheetCase = { case_id: string; dimension_ratings: Record<string, { rating: string; note?: string }>; images: Array<{ path: string; sha256?: string }>; style_dna: { persona: string; invented: boolean; context: string[] } | null; notes?: string } & Record<string, unknown>
type Sheet = { format: string; dataset: string; reviewer: { id: string }; reviewed_on: string; cases: SheetCase[] }

// eslint-disable-next-line @typescript-eslint/no-require-imports
const personas = require('../../scripts/evaluation/style-dna-personas.cjs') as { PERSONAS: Record<string, unknown>; styleDna: (persona: string) => Record<string, unknown> }

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

  it('refuses a second review on a first review that is not finished', () => {
    expect(problemsOf((reference) => { reference.status = 'in_progress'; reference.second_reviews = [second()] }).join('\n')).toMatch(/only to a finished first review/)
  })

  it('changes the full fingerprint and leaves the scoring fingerprint alone: no first review changed', () => {
    const before = fixtureReferences('image_review')
    const after = withSecondReviews({ 'q-single-01': { occasion: 'Good' } })
    expect(referenceSetFingerprint(after)).not.toBe(referenceSetFingerprint(before))
    expect(referenceScoringFingerprint(after)).toBe(referenceScoringFingerprint(before))
    // Bumping the hand-kept version, as the guide asks after a merge, does not change it either.
    expect(referenceScoringFingerprint({ ...after, dataset_version: '1.1.0' })).toBe(referenceScoringFingerprint(before))
    // A change to a first review does.
    const edited = JSON.parse(JSON.stringify(before)) as ReferenceSet
    ;(edited.references[0].dimension_ratings as Record<string, { rating: string }>).occasion.rating = 'Good'
    expect(referenceScoringFingerprint(edited)).not.toBe(referenceScoringFingerprint(before))
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
    expect(report.next_steps.some((step) => step.startsWith('Reviewers differ from each other on 3 of 10 twice-reviewed case(s) (1 far apart: two bands or more, or one reviewer could not judge): q-single-01, q-single-02, q-single-03.'))).toBe(true)
    const single = evaluateRecording(fixtureRecording(cases, 'model'), cases, CURRENT, 'replay', { references: fixtureReferences('image_review', 10) })
    expect(single.next_steps.some((step) => step.startsWith('No image-reviewed case was rated by a second reviewer.'))).toBe(true)
    expect(single.quality.reviewer_agreement.image_reviewed.dimensions.occasion.exact_rate).toEqual({ status: 'unavailable', reason: 'Unavailable: no case of this tier was rated by a second reviewer', value: null, n: 0, se: null })
  })

  it('keeps the regression gate working after a second review is added: no first review changed, so every figure is still compared', () => {
    // The finding this guards against: adding one second review used to change the only fingerprint, every
    // reference-dependent figure became "inconclusive", and a worse report could replace the baseline unnoticed.
    const fixture = fixtureCases('image_review', 10)
    const plain = fixtureReferences('image_review', 10)
    const withOne = withSecondReviews({ 'q-single-01': {} }, 'image_review', 10)
    const baseline = evaluateRecording(fixtureRecording(fixture, 'model'), fixture, CURRENT, 'replay', { references: plain })
    const worseSameReferences = evaluateRecording(fixtureRecording(fixture, 'model', degrade), fixture, CURRENT, 'replay', { references: plain })
    const worseAfterSecondReview = evaluateRecording(fixtureRecording(fixture, 'model', degrade), fixture, CURRENT, 'replay', { references: withOne })

    const expected = classifyMetricChanges(baseline, worseSameReferences)
    const actual = classifyMetricChanges(baseline, worseAfterSecondReview)
    expect(expected.regressions.length).toBeGreaterThan(10)
    expect(actual.regressions).toEqual(expected.regressions)
    expect(actual.lost).toEqual(expected.lost)
    expect(actual.not_compared).toBe(0)
    expect(assessBaselineUpdate(baseline, worseAfterSecondReview)).toMatchObject({ allowed: false })
    // A change to a first review still makes the figures incomparable, as before.
    const edited = JSON.parse(JSON.stringify(plain)) as ReferenceSet
    ;(edited.references[0].dimension_ratings as Record<string, { rating: string }>).occasion.rating = 'Good'
    const afterEdit = evaluateRecording(fixtureRecording(fixture, 'model', degrade), fixture, CURRENT, 'replay', { references: parseReferenceSet(edited, fixture) })
    expect(classifyMetricChanges(baseline, afterEdit).regressions.filter((name) => name.startsWith('agreement.'))).toEqual([])
    expect(classifyMetricChanges(baseline, afterEdit).not_compared).toBeGreaterThan(0)
  })

  it('compares the figures that use second reviews only when the second reviews are the same', () => {
    const fixture = fixtureCases('image_review', 10)
    const ten = withSecondReviews(Object.fromEntries(TEN.map((id) => [id, {}])), 'image_review', 10)
    const otherTen = withSecondReviews(Object.fromEntries(TEN.map((id) => [id, { color: 'Fair' }])), 'image_review', 10)
    const base = evaluateRecording(fixtureRecording(fixture, 'model'), fixture, CURRENT, 'replay', { references: ten })
    const candidate = evaluateRecording(fixtureRecording(fixture, 'model'), fixture, CURRENT, 'replay', { references: otherTen })
    const changes = classifyMetricChanges(base, candidate)
    const range = changes.comparisons.find((comparison) => comparison.metric === 'agreement.image_reviewed.color.within_reviewer_range_rate')
    expect(range).toMatchObject({ classification: 'inconclusive', reason: 'The two reports used different second reviews.' })
    // The figures scored against the first review are compared as usual.
    expect(changes.comparisons.find((comparison) => comparison.metric === 'agreement.image_reviewed.color.exact_rate')?.classification).toBe('no_meaningful_change')
    expect(base.metric_index['agreement.image_reviewed.color.within_reviewer_range_rate'].needs_second_reviews).toBe(true)
    expect(base.metric_index['agreement.image_reviewed.color.exact_rate'].needs_second_reviews).toBeUndefined()
  })

  it('gives the right reason when two reviewers both could not judge: there is agreement and no distance', () => {
    const fixture = fixtureCases('image_review')
    const set = JSON.parse(JSON.stringify(fixtureReferences('image_review'))) as { references: Array<Record<string, unknown>> }
    // q-views-01: the first review says seasonality cannot be judged; the second says the same.
    const views = set.references.find((reference) => reference.case_id === 'q-views-01') as Record<string, unknown>
    views.second_reviews = [{ reviewer: { id: 'second-reviewer' }, reviewed_on: '2026-11-05', dimension_ratings: ratings({ seasonality: 'Unable to Evaluate' }) }]
    const result = evaluateRecording(fixtureRecording(fixture, 'model'), fixture, CURRENT, 'replay', { references: parseReferenceSet(set, fixture) })
    const seasonality = result.quality.reviewer_agreement.image_reviewed.dimensions.seasonality
    expect(seasonality.exact_rate).toMatchObject({ value: 1, n: 1 })
    expect(seasonality.mean_distance).toEqual({ status: 'unavailable', reason: 'Unavailable: in no twice-reviewed case did two reviewers both give a rating for this dimension', value: null, n: 0, se: null })
    expect(result.quality.reviewer_agreement.image_reviewed.disagreements).toEqual([])
  })

  it('shows the reviewers of each tier in that tier\'s own section, never under human-reviewed images', () => {
    const fixture = fixtureCases('brief', 10)
    const brief = withSecondReviews(Object.fromEntries(TEN.map((id) => [id, {}])), 'brief', 10)
    const markdown = renderMarkdown(evaluateRecording(fixtureRecording(fixture, 'synthetic_fixture'), fixture, CURRENT, 'mock', { references: brief }))
    const five = markdown.indexOf('## 5. Agreement with human-reviewed references')
    const six = markdown.indexOf('## 6. Agreement with other expectations')
    const seven = markdown.indexOf('## 7. Confidence')
    const reviewers = markdown.indexOf('### Agreement between reviewers: brief-derived expectations')
    expect(five).toBeGreaterThan(0)
    expect(reviewers).toBeGreaterThan(six)
    expect(reviewers).toBeLessThan(seven)
    expect(markdown.slice(five, six)).not.toContain('Agreement between reviewers')
    // Hand-written outputs are never called a model.
    expect(markdown).toContain('Fixture outputs (not a model) within the reviewers\' range')
    expect(markdown).not.toContain('| Model within')
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
    expect(readiness.scorable_by_mode).toEqual({ single: 8, same_garment_views: 4, outfit_items: 10 })
    expect(readiness.scorable_short_by).toEqual({ single: 2, same_garment_views: 6, outfit_items: 0 })
    expect(readiness.ready_for_measured_figures).toBe(false)
    expect(readiness.image_reviewed_scorable).toBe(22)
    expect(readiness.second_reviews).toEqual({ cases: 2, reviewers: ['second-reviewer'], disagreements: [{ case_id: 'q-single-01', dimensions: ['occasion'], severe: [] }] })
    const lines = readinessLines(readiness)
    expect(lines).toContain('Reviews per mode: NOT enough for measured figures (10 such cases per mode): single needs 2 more, same_garment_views needs 6 more.')
    expect(lines).toContain('Second reviews: 2 case(s) rated by a second person (second-reviewer); reviewers differ on 1 of them.')
    expect(lines).toContain('  reviewers differ on q-single-01: occasion')
  })

  it('says plainly when no rating has been checked against a second person', () => {
    const cases = fixtureCases('image_review')
    expect(readinessLines(describeReadiness(fixtureReferences('image_review'), cases))).toContain('Second reviews: none. Every rating is one person\'s judgement and has not been checked against another\'s.')
  })

  it('counts towards a mode only cases that can give ratings to score: recorded output, and not an expected abstention', () => {
    // Twelve image-reviewed single cases: ten photos whose output is withheld, and two public-licence cases that should abstain.
    const ids = Array.from({ length: 12 }, (_, index) => `r-${String(index + 1).padStart(2, '0')}`)
    const cases = manifestSchema.parse({ version: 1, cases: ids.map((id, index) => ({ id, category: 'clear', description: 'Test fixture: no image exists.', source: index < 10 ? 'owned' : 'public_license', photo: `${id}/photo.jpg`, garment: `${id}/garment-1.jpg`, occasion: 'Client Meeting', expected: index < 10 ? {} : { should_abstain: true } })) }).cases
    const template = fixtureReferences('image_review').references[0]
    const references = parseReferenceSet({
      format: 'verdict-reference-set/1',
      dataset: 'readiness-fixture',
      dataset_version: '1.0.0',
      references: ids.map((id, index) => ({
        ...template,
        case_id: id,
        comparison_group: undefined,
        images: [{ id: 'photo', role: 'photo', path: `${id}/photo.jpg`, sha256: 'a'.repeat(64) }, { id: 'garment-1', role: 'garment', path: `${id}/garment-1.jpg`, sha256: 'a'.repeat(64) }],
        provenance: { image_source: index < 10 ? 'owned' : 'public_license', rights: 'Test fixture: no image exists.' },
      })),
    }, cases)
    const readiness = describeReadiness(references, cases)
    expect(readiness.image_reviewed_by_mode.single).toBe(12)
    expect(readiness.scorable_by_mode.single).toBe(0)
    expect(readiness.scorable_short_by.single).toBe(10)
    expect(readiness.ready_for_measured_figures).toBe(false)
    expect(readinessLines(readiness).join('\n')).toContain('single 0, same_garment_views 0, outfit_items 0 (0 of 12)')
  })

  it('warns that a mode with exactly ten cases has no margin', () => {
    const cases = fixtureCases('image_review', 10)
    const ready = describeReadiness(fixtureReferences('image_review', 10), cases)
    // Force the picture of a balanced dataset without building one: every mode at ten or more.
    const lines = readinessLines({ ...ready, scorable_short_by: { single: 0, same_garment_views: 0, outfit_items: 0 }, ready_for_measured_figures: true })
    expect(lines.join('\n')).toContain('A mode with exactly 10 has no margin: one case without a complete output puts its figures back to "too few to conclude".')
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
    for (const fragment of ['Excellent', 'Good', 'Fair', 'test-reviewer', '2026-11-01', 'navy', 'key_facts', 'garment_description', 'comparison_group', 'review_notes', 'unverifiable']) expect(text).not.toContain(fragment)
    // The inputs, and the hash of each file the first review was about, so both reviews are tied to the same files.
    expect(sheet.cases[0]).toMatchObject({ case_id: 'q-single-01', occasion: 'Client Meeting', garment_mode: 'single', style_dna: null, images: [{ path: 'q-single-01/photo.jpg', sha256: 'a'.repeat(64) }, { path: 'q-single-01/garment-1.jpg', sha256: 'a'.repeat(64) }] })
    expect(sheet.dataset).toBe('quality-fixture')
    expect(Object.values(sheet.cases[0].dimension_ratings).every((entry) => entry.rating === 'TO DO')).toBe(true)
  })

  it('gives the second reviewer the Style DNA context the first reviewer and the model had, in the same words', () => {
    // The rubric rates style and style_preference_match against it. Without it the two reviewers would rate different questions.
    for (const persona of Object.keys(personas.PERSONAS)) {
      const manifestCase = { ...(JSON.parse(JSON.stringify(cases[0])) as Record<string, unknown>), style_dna: personas.styleDna(persona) }
      const { sheet } = secondReview.buildSheet({ cases: [manifestCase] }, set(), ['q-single-01'])
      const dna = sheet.cases[0].style_dna as NonNullable<SheetCase['style_dna']>
      expect(dna).toMatchObject({ persona, invented: true })
      expect(dna.context.length).toBeGreaterThan(0)
      // Every statement on the sheet is, word for word, part of what the request tells the model.
      const sent = buildUserContext('Client Meeting', { preferredStyles: [], favoriteColors: [], occasionPreferences: [] }, validateAIStyleProfile(personas.PERSONAS[persona]))
      for (const line of dna.context) expect(sent).toContain(line.slice(line.indexOf(': ') + 2))
      // And everything the request says about the profile is on the sheet.
      const sentLines = sent.split('\n').filter((line) => /^Style DNA (coloring|aesthetic|proportions)/.test(line))
      expect(dna.context).toHaveLength(sentLines.length)
    }
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
    expect(differences).toEqual([{ case_id: 'q-single-01', compared_with: 'the first review', dimensions: [
      { dimension: 'occasion', earlier: 'Excellent', given: 'Good', far_apart: false },
      { dimension: 'style', earlier: 'Fair', given: 'Excellent', far_apart: true },
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
    ['a missing date', (sheet: ReturnType<typeof filled>) => { sheet.reviewed_on = 'TO DO: YYYY-MM-DD' }, /reviewed_on must be a real date/],
    ['a date that does not exist', (sheet: ReturnType<typeof filled>) => { sheet.reviewed_on = '2026-02-30' }, /reviewed_on must be a real date/],
    ['a sheet made for another dataset', (sheet: ReturnType<typeof filled>) => { sheet.dataset = 'golden-v9' }, /made for dataset "golden-v9", not for "quality-fixture"/],
    ['the same case twice', (sheet: ReturnType<typeof filled>) => { sheet.cases.push(JSON.parse(JSON.stringify(sheet.cases[0])) as SheetCase) }, /q-single-01: appears twice in the sheet/],
    ['an entry that is not a case', (sheet: ReturnType<typeof filled>) => { sheet.cases.push(null as unknown as SheetCase) }, /entry 3 of the sheet is not a case/],
    ['a note longer than the reference format allows', (sheet: ReturnType<typeof filled>) => { sheet.cases[0].dimension_ratings.color = { rating: 'Good', note: 'x'.repeat(301) } }, /note on color must be text of at most 300 characters/],
    ['notes longer than the reference format allows', (sheet: ReturnType<typeof filled>) => { sheet.cases[0].notes = 'x'.repeat(501) }, /notes must be text of at most 500 characters/],
    ['other image files than the first review recorded', (sheet: ReturnType<typeof filled>) => { sheet.cases[0].images[1].sha256 = 'b'.repeat(64) }, /made for other image files than the first review recorded \(q-single-01\/garment-1\.jpg\)/],
    ['no cases', (sheet: ReturnType<typeof filled>) => { sheet.cases = [] }, /the sheet has no cases/],
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

  it('compares a later second review with every earlier review, not only with the first', () => {
    const once = secondReview.mergeSheet(set(), filled({ 'q-single-01': { color: 'Fair' } })).set
    const third = filled()
    third.reviewer = { id: 'third-reviewer' }
    const result = secondReview.mergeSheet(once, third)
    expect(result.problems).toEqual([])
    // The third review agrees with the first and differs from the second on colour.
    expect(result.differences).toEqual([{ case_id: 'q-single-01', compared_with: 'the second review by "second-reviewer"', dimensions: [{ dimension: 'color', earlier: 'Fair', given: 'Good', far_apart: false }] }])
    expect(parseReferenceSet(result.set, cases).references[0].second_reviews).toHaveLength(2)
  })

  it('keeps the limits of the reference format, so it never writes a file the validator refuses', () => {
    // The tool is plain JavaScript and cannot import the schema; these checks tie its limits to the schema.
    const reference = () => { const copy = set(); return { copy, first: copy.references[0] as unknown as Record<string, unknown> } }
    const review = (id: string, extra: Record<string, unknown> = {}) => ({ reviewer: { id }, reviewed_on: '2026-11-05', dimension_ratings: ratings(), ...extra })
    const accepts = (change: (first: Record<string, unknown>) => void) => { const { copy, first } = reference(); change(first); return referenceSetSchema.safeParse(copy).success }
    const { secondReviews, dimensionNote, reviewNotes } = secondReview.LIMITS
    expect(accepts((first) => { first.second_reviews = Array.from({ length: secondReviews }, (_, index) => review(`reviewer-${index}`)) })).toBe(true)
    expect(accepts((first) => { first.second_reviews = Array.from({ length: secondReviews + 1 }, (_, index) => review(`reviewer-${index}`)) })).toBe(false)
    expect(accepts((first) => { first.second_reviews = [review('second-reviewer', { notes: 'x'.repeat(reviewNotes) })] })).toBe(true)
    expect(accepts((first) => { first.second_reviews = [review('second-reviewer', { notes: 'x'.repeat(reviewNotes + 1) })] })).toBe(false)
    expect(accepts((first) => { first.second_reviews = [review('second-reviewer', { dimension_ratings: { ...ratings(), color: { rating: 'Good', note: 'x'.repeat(dimensionNote) } } })] })).toBe(true)
    expect(accepts((first) => { first.second_reviews = [review('second-reviewer', { dimension_ratings: { ...ratings(), color: { rating: 'Good', note: 'x'.repeat(dimensionNote + 1) } } })] })).toBe(false)

    // A reference that already holds the most second reviews takes no more.
    const full = set()
    ;(full.references[0] as unknown as Record<string, unknown>).second_reviews = Array.from({ length: secondReviews }, (_, index) => review(`reviewer-${index}`))
    expect(secondReview.mergeSheet(parseReferenceSet(full, cases), filled()).problems.join('\n')).toMatch(/already has 4 second reviews/)
  })

  it('writes notes and per-dimension notes through, and the result still validates', () => {
    const sheet = filled()
    sheet.cases[0].notes = 'We agree that the hem is not visible.'
    sheet.cases[0].dimension_ratings.color = { rating: 'Good', note: 'Between Good and Fair.' }
    const result = secondReview.mergeSheet(set(), sheet)
    expect(result.problems).toEqual([])
    const merged = parseReferenceSet(result.set, cases).references[0].second_reviews?.[0]
    expect(merged).toMatchObject({ notes: 'We agree that the hem is not visible.', dimension_ratings: { color: { rating: 'Good', note: 'Between Good and Fair.' } } })
  })
})
