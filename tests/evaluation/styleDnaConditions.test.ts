/**
 * Style DNA is a condition on a case, not a garment mode. A profile changes what
 * the model is told, so cases with and without one must never be mixed silently:
 *
 * - every figure that combines both conditions is marked as pooled;
 * - the same figure is reported for each condition on its own wherever that
 *   condition has at least the minimum sample behind it;
 * - where it has fewer, the separate figure is unavailable, with no value.
 *
 * The second half of this file takes the golden case PLAN and checks that the
 * committed case matrix says what an evaluation of it would actually report.
 *
 * NOTHING HERE IS A REAL REVIEW OR A MODEL OUTPUT. The "reviews" and the
 * "outputs" are built in memory for the test, so that no committed file ever
 * claims that a planned case was reviewed. No network is used.
 */

import { describe, expect, it, jest } from '@jest/globals'
import { readFileSync } from 'node:fs'
import path from 'node:path'

jest.mock('server-only', () => ({}), { virtual: true })

import { describeComposition, manifestSchema, type BenchmarkCase } from '@/benchmark/harness'
import { evaluateRecording, renderMarkdown, serializeReport, type EvaluationReport } from '@/evaluation/evaluate'
import { MIN_SAMPLE, STYLE_DNA_READING, styleDnaMetricName } from '@/evaluation/quality'
import { describeReadiness, readinessLines } from '@/evaluation/readiness'
import { datasetFingerprint, type Recording } from '@/evaluation/recording'
import { parseReferenceSet, type ReferenceSet } from '@/evaluation/reference'
import { assessBaselineUpdate, classifyMetricChanges } from '@/evaluation/regression'
import { GARMENT_MODES } from '@/lib/constants/garmentModes'
import { degrade, fixtureCases, fixtureRecording, fixtureReferences, type FixtureOutput } from '../helpers/qualityFixture'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const personas = require('../../scripts/evaluation/style-dna-personas.cjs') as { styleDna: (persona: string) => Record<string, unknown> }
// eslint-disable-next-line @typescript-eslint/no-require-imports
const goldenPlan = require('../../scripts/evaluation/build-golden-plan.cjs') as {
  MIN_CASES: number
  buildCases: () => { cases: Array<Record<string, unknown>>; groups: Map<string, string>; reserves: Set<string> }
  matrixRows: (cases: unknown[], groups: Map<string, string>, reserves: Set<string>) => Array<{ id: string; mode: string; styleDna: string | null; abstain: boolean; rated: boolean; images: number; garments: number; pair: string | null; reserve: boolean; overall: string | null; inMode: string | null }>
  conditionCounts: (cases: unknown[]) => Record<'with' | 'without', Record<string, number>>
}

const root = process.cwd()
const CURRENT = { promptVersion: 'aaaaaaaaaaaa', schemaVersion: 'analysis-output/2' }
const WITH = 'with_style_dna' as const
const WITHOUT = 'without_style_dna' as const

/** The fixture cases (8 single, 4 multi-view, 10 outfits), with an invented profile on the cases `withProfile` selects. */
function mixedCases(withProfile: (id: string) => boolean, basis: 'image_review' | 'synthetic' = 'image_review'): BenchmarkCase[] {
  const raw = (JSON.parse(JSON.stringify(fixtureCases(basis, 10))) as Array<Record<string, unknown>>).map((entry) => (withProfile(entry.id as string) ? { ...entry, style_dna: personas.styleDna('persona-minimal-aesthetic') } : entry))
  return manifestSchema.parse({ version: 1, cases: raw }).cases
}

const outfits = (id: string) => id.startsWith('q-outfit')

describe('a report that mixes both Style DNA conditions', () => {
  // Ten outfit cases send a profile; eight single and four multi-view cases do not.
  const cases = mixedCases(outfits)
  const references = fixtureReferences('image_review', 10)
  const report = evaluateRecording(fixtureRecording(cases, 'model'), cases, CURRENT, 'replay', { references })
  const index = report.metric_index

  it('says so, with the number of cases in each condition', () => {
    expect(report.quality.style_dna).toEqual({ mixed: true, cases_with_style_dna: 10, cases_without_style_dna: 12, reading: STYLE_DNA_READING.mixed })
    // Style DNA is not a garment mode: the modes still add up to every case, and the profile cases sit inside them.
    expect(report.composition.cases_by_mode).toEqual({ single: 8, same_garment_views: 4, outfit_items: 10 })
    expect(report.composition.style_dna.cases_by_mode).toEqual({ single: 0, same_garment_views: 0, outfit_items: 10 })
    expect(Object.keys(report.quality.multi_image.modes)).toEqual([...GARMENT_MODES])
  })

  it('marks every figure that combines both conditions as pooled, and no other', () => {
    for (const [name, metric] of Object.entries(index)) {
      const separate = name.startsWith('style_dna.')
      const advisor = name.startsWith('shopping_advisor.')
      expect({ name, pooled: metric.pooled_over_style_dna === true }).toEqual({ name, pooled: !separate && !advisor })
      expect({ name, condition: metric.style_dna_condition !== undefined }).toEqual({ name, condition: separate || advisor })
    }
    expect(index['agreement.image_reviewed.occasion.exact_rate']).toMatchObject({ status: 'measured', n: 22, pooled_over_style_dna: true })
    // The advisor figures are about one condition each, by definition.
    expect(index['shopping_advisor.availability_rate'].style_dna_condition).toBe(WITH)
    expect(index['shopping_advisor.mistargeted_recommendation_rate'].style_dna_condition).toBe(WITH)
    expect(index['shopping_advisor.unrequested_recommendation_rate'].style_dna_condition).toBe(WITHOUT)
  })

  it('gives each condition its own figure where ten cases stand behind it', () => {
    const withProfile = index[styleDnaMetricName(WITH, 'agreement.image_reviewed.occasion.exact_rate')]
    const without = index[styleDnaMetricName(WITHOUT, 'agreement.image_reviewed.occasion.exact_rate')]
    expect(withProfile).toMatchObject({ status: 'measured', value: 1, n: 10, style_dna_condition: WITH, needs_references: true, direction: 'higher_is_better' })
    expect(without).toMatchObject({ status: 'measured', value: 1, n: 12, style_dna_condition: WITHOUT })
    // The two conditions add up to the pooled figure: no case is counted twice and none is left out.
    expect(withProfile.n + without.n).toBe(index['agreement.image_reviewed.occasion.exact_rate'].n)
    expect(index[styleDnaMetricName(WITH, 'validity.valid_output_rate')].n + index[styleDnaMetricName(WITHOUT, 'validity.valid_output_rate')].n).toBe(index['validity.valid_output_rate'].n)
    expect(withProfile.pooled_over_style_dna).toBeUndefined()
  })

  it('makes a separate figure unavailable, with no value, where fewer than ten cases stand behind it', () => {
    // Without a profile there are eight single cases and four multi-view cases: too few for a figure of their own.
    const single = index[styleDnaMetricName(WITHOUT, 'multi_image.single.agreement.image_reviewed.exact_rate')]
    expect(single).toEqual({
      status: 'unavailable',
      reason: 'Unavailable: only 8 unit(s) without Style DNA stand behind this figure; a separate figure needs at least 10. See the pooled figure "multi_image.single.agreement.image_reviewed.exact_rate".',
      value: null,
      n: 0,
      se: null,
      direction: 'higher_is_better',
      kind: 'rate',
      needs_references: true,
      style_dna_condition: WITHOUT,
    })
    // The pooled figure of the same mode is still shown, small sample and all, and is labelled as pooled.
    expect(index['multi_image.single.agreement.image_reviewed.exact_rate']).toMatchObject({ status: 'insufficient_sample', n: 8, pooled_over_style_dna: true })
    // No separate figure is ever a small-sample value: it is measured or it is unavailable.
    const separate = Object.entries(index).filter(([name]) => name.startsWith('style_dna.'))
    expect(separate.length).toBeGreaterThan(200)
    for (const [name, metric] of separate) {
      expect({ name, status: metric.status === 'insufficient_sample' }).toEqual({ name, status: false })
      if (metric.status === 'measured') expect({ name, enough: metric.n >= MIN_SAMPLE }).toEqual({ name, enough: true })
      else expect({ name, value: metric.value, n: metric.n }).toEqual({ name, value: null, n: 0 })
    }
    expect(MIN_SAMPLE).toBe(10)
  })

  it('computes a separate figure with the same code as the pooled one: on cases of one condition it equals the ordinary figure', () => {
    const subset = cases.filter((benchmarkCase) => benchmarkCase.style_dna !== undefined)
    const recording = fixtureRecording(cases, 'model')
    const alone = evaluateRecording({ ...recording, entries: recording.entries.filter((entry) => outfits(entry.case_id)), dataset_fingerprint: datasetFingerprint(subset) }, subset, CURRENT, 'replay', { references: { ...references, references: references.references.filter((reference) => outfits(reference.case_id)) } })
    expect(alone.quality.style_dna).toMatchObject({ mixed: false, cases_with_style_dna: 10, cases_without_style_dna: 0, reading: STYLE_DNA_READING.with })
    for (const name of ['agreement.image_reviewed.style.exact_rate', 'agreement.image_reviewed.style.mae', 'calibration.image_reviewed.confidence_gap', 'grounding.image_reviewed.key_fact_mention_rate', 'multi_image.outfit_items.completeness_rate', 'garment_identification.image_reviewed.garment_type_accuracy']) {
      const { pooled_over_style_dna: _pooled, style_dna_condition: _condition, ...separate } = index[styleDnaMetricName(WITH, name)]
      expect({ name, metric: separate }).toEqual({ name, metric: alone.metric_index[name] })
    }
  })

  it('shows a difference between the conditions that the pooled figure hides', () => {
    // The outputs for the cases with a profile get worse; the cases without one are untouched.
    const worse = evaluateRecording(fixtureRecording(cases, 'model', (output, caseId) => (outfits(caseId) ? degrade(output) : output)), cases, CURRENT, 'replay', { references })
    const name = 'agreement.image_reviewed.occasion.exact_rate'
    expect(worse.metric_index[styleDnaMetricName(WITH, name)]).toMatchObject({ status: 'measured', value: 0, n: 10 })
    expect(worse.metric_index[styleDnaMetricName(WITHOUT, name)]).toMatchObject({ status: 'measured', value: 1, n: 12 })
    // Pooled, it reads as a middling 0.5455: neither condition looks like that.
    expect(worse.metric_index[name]).toMatchObject({ value: 0.5455, n: 22, pooled_over_style_dna: true })
    // And the regression is attributed to the condition it belongs to.
    const changes = classifyMetricChanges(report, worse)
    expect(changes.regressions).toContain(styleDnaMetricName(WITH, name))
    expect(changes.regressions).not.toContain(styleDnaMetricName(WITHOUT, name))
    expect(assessBaselineUpdate(report, worse)).toMatchObject({ allowed: false })
  })

  it('counts a separate figure that disappears as lost, like any other', () => {
    const fewer = mixedCases((id) => outfits(id) && id !== 'q-outfit-10')
    const candidate = evaluateRecording(fixtureRecording(fewer, 'model'), fewer, CURRENT, 'replay', { references })
    // Nine cases with a profile now: the separate figure is unavailable. Compared with a report of the same dataset it would be lost.
    expect(candidate.metric_index[styleDnaMetricName(WITH, 'agreement.image_reviewed.occasion.exact_rate')]).toMatchObject({ status: 'unavailable', value: null })
    const sameDataset = { ...candidate, dataset: report.dataset }
    expect(classifyMetricChanges(report, sameDataset as EvaluationReport).lost).toContain(styleDnaMetricName(WITH, 'agreement.image_reviewed.occasion.exact_rate'))
  })

  it('says in the Markdown which figures are pooled and shows the conditions side by side', () => {
    const markdown = renderMarkdown(report)
    expect(markdown).toContain('### With and without Style DNA')
    expect(markdown).toContain('Style DNA is a condition on a case, not a garment mode. 10 evaluated case(s) send a profile and 12 do not.')
    expect(markdown).toContain('| Figure | Without Style DNA | With Style DNA | Pooled (both together) |')
    expect(markdown).toContain('| Exact agreement with human reviews, occasion | 1 (n=12) | 1 (n=10) | 1 (n=22) |')
    expect(markdown).toContain('| Valid output, single | unavailable | unavailable | 1 (n=8, too few to conclude) |')
    // Every section whose figures combine both conditions says so at its head.
    const note = '**Pooled:** the figures of this section combine 10 case(s) with and 12 without Style DNA'
    for (const heading of ['## 3. Output validity', '## 5. Agreement with human-reviewed references', '## 7. Confidence', '## 8. Image modes', '## 9. Explanation grounding (proxy)']) {
      const start = markdown.indexOf(heading)
      expect({ heading, labelled: markdown.slice(start, start + heading.length + 4 + note.length).includes(note) }).toEqual({ heading, labelled: true })
    }
    expect(markdown).toContain('The Shopping Advisor lines are each about one condition only, by definition.')
    expect(report.next_steps.some((step) => step.startsWith('10 of 22 cases send a Style DNA profile. Figures marked "pooled" combine cases with and without one.'))).toBe(true)
    expect(serializeReport(report)).not.toContain('navy blazer suits')
  })
})

describe('a report with one Style DNA condition only', () => {
  it('pools nothing, labels nothing as pooled and adds no separate figures', () => {
    const cases = fixtureCases('image_review', 10)
    const report = evaluateRecording(fixtureRecording(cases, 'model'), cases, CURRENT, 'replay', { references: fixtureReferences('image_review', 10) })
    expect(report.quality.style_dna).toEqual({ mixed: false, cases_with_style_dna: 0, cases_without_style_dna: 22, reading: STYLE_DNA_READING.without })
    expect(Object.keys(report.metric_index).filter((name) => name.startsWith('style_dna.'))).toEqual([])
    expect(Object.values(report.metric_index).filter((metric) => metric.pooled_over_style_dna !== undefined)).toEqual([])
    const markdown = renderMarkdown(report)
    expect(markdown).not.toContain('**Pooled:**')
    expect(markdown).toContain(STYLE_DNA_READING.without)
  })
})

describe('the separation of synthetic and human-reviewed evidence holds inside each condition', () => {
  it('never scores hand-written outputs against human reviews, with or without a profile', () => {
    const cases = mixedCases(outfits)
    const report = evaluateRecording(fixtureRecording(cases, 'synthetic_fixture'), cases, CURRENT, 'mock', { references: fixtureReferences('image_review', 10) })
    expect(report.quality.image_grounded_accuracy.status).toBe('unavailable')
    const imageFigures = Object.entries(report.metric_index).filter(([name]) => name.includes('.image_reviewed.') || name.endsWith('.image_reviewed'))
    expect(imageFigures.length).toBeGreaterThan(100)
    // Not one figure about agreement with human reviews has a value: not pooled, and not for either condition.
    expect(imageFigures.filter(([, metric]) => metric.value !== null).map(([name]) => name)).toEqual([])
    expect(report.metric_index[styleDnaMetricName(WITH, 'agreement.image_reviewed.occasion.exact_rate')].reason).toBe('Unavailable: the outputs are hand-written fixtures, not model outputs')
  })

  it('keeps the tiers apart inside each condition', () => {
    const cases = mixedCases(outfits, 'synthetic')
    const report = evaluateRecording(fixtureRecording(cases, 'synthetic_fixture'), cases, CURRENT, 'mock', { references: fixtureReferences('synthetic', 10) })
    // Synthetic expectations are scored in the synthetic tier of each condition, and nowhere else.
    expect(report.metric_index[styleDnaMetricName(WITH, 'agreement.synthetic.occasion.exact_rate')]).toMatchObject({ status: 'measured', n: 10 })
    expect(report.metric_index[styleDnaMetricName(WITH, 'agreement.image_reviewed.occasion.exact_rate')]).toMatchObject({ status: 'unavailable', reason: 'Unavailable: insufficient human-reviewed ground truth' })
    expect(report.metric_index[styleDnaMetricName(WITH, 'agreement.brief_derived.occasion.exact_rate')].value).toBeNull()
    expect(report.quality.image_grounded_accuracy).toEqual({ status: 'unavailable', reason: 'Unavailable: insufficient human-reviewed ground truth', cases: 0 })
  })
})

// ---------------------------------------------------------------------------
// The golden plan: what the case matrix says, against what an evaluation would report
// ---------------------------------------------------------------------------

const planDir = path.join(root, 'evaluation', 'datasets', 'golden-v1')
const planCases = manifestSchema.parse(JSON.parse(readFileSync(path.join(planDir, 'cases.template.json'), 'utf8'))).cases
const planTemplate = JSON.parse(readFileSync(path.join(planDir, 'references.template.json'), 'utf8')) as { references: Array<{ case_id: string; comparison_group?: string }> }

/**
 * The plan as it would look once every case had been reviewed. TEST DATA ONLY: built in memory, with a made-up
 * "reviewer" and placeholder hashes, so that the code path can be exercised without any file claiming a review.
 */
function reviewedPlan(): ReferenceSet {
  const groups = new Map(planTemplate.references.map((reference) => [reference.case_id, reference.comparison_group]))
  return parseReferenceSet({
    format: 'verdict-reference-set/1',
    dataset: 'golden-plan-test-fixture',
    dataset_version: '0.0.1',
    references: planCases.map((benchmarkCase) => ({
      case_id: benchmarkCase.id,
      images: [benchmarkCase.photo, benchmarkCase.garment, ...(benchmarkCase.extra_garments ?? [])].map((file, index) => ({ id: index === 0 ? 'photo' : `garment-${index}`, role: index === 0 ? 'photo' : 'garment', path: file, sha256: 'a'.repeat(64) })),
      garment_description: 'Test fixture: no image exists.',
      occasion: benchmarkCase.occasion,
      basis: 'image_review',
      status: 'complete',
      reviewer: { id: 'test-reviewer' },
      reviewed_on: '2026-11-01',
      provenance: { image_source: 'public_license', rights: 'Test fixture: no image exists.' },
      dimension_ratings: Object.fromEntries(['occasion', 'color', 'formality', 'seasonality', 'style', 'style_preference_match'].map((key) => [key, { rating: 'Good' }])),
      ...(groups.get(benchmarkCase.id) ? { comparison_group: groups.get(benchmarkCase.id) } : {}),
    })),
  }, planCases)
}

/** Outputs for the plan, as if recorded from a model. TEST DATA ONLY. `fails` names cases whose every run errors. */
function planRecording(fails: string[] = []): Recording {
  const dimension = { rating: 'Good', reason: 'Test fixture explanation that is long enough to pass the length proxy.', confidence: 'High' }
  return {
    format: 'verdict-recording/1',
    provenance: 'model',
    model: 'gpt-6.1-terra',
    reasoning_effort: 'low',
    max_output_tokens: 4000,
    prompt_version: 'aaaaaaaaaaaa',
    schema_version: 'analysis-output/2',
    dataset_fingerprint: datasetFingerprint(planCases),
    entries: planCases.flatMap((benchmarkCase) => [1, 2].map((run) => {
      if (fails.includes(benchmarkCase.id)) return { case_id: benchmarkCase.id, run, outcome: 'error' as const, error_code: 'timeout', latency_ms: 0 }
      if (benchmarkCase.expected.should_abstain) return { case_id: benchmarkCase.id, run, outcome: 'returned' as const, latency_ms: 0, output: { status: 'unable_to_analyze', reason: 'Test fixture: insufficient input.', confidence: 'Low', next_step: 'Test fixture: add a clearer photo.' } }
      const garments = 1 + (benchmarkCase.extra_garments?.length ?? 0)
      const output: FixtureOutput & { shopping_advisor?: unknown } = { status: 'complete', dimensions: Object.fromEntries(['occasion', 'color', 'formality', 'seasonality', 'style', 'style_preference_match'].map((key) => [key, { ...dimension }])) }
      if (benchmarkCase.garment_mode === 'outfit_items') output.outfit_components = Array.from({ length: garments }, (_, index) => ({ item: index + 1, garment_type: 'top', assessment: 'Works', note: 'Test fixture note about this item.' }))
      if (benchmarkCase.style_dna) output.shopping_advisor = { recommendations: [{ title: 'Test fixture alternative', garment_type: 'top', color_direction: 'A neutral tone', style_direction: 'A plain cut', rationale: 'Test fixture rationale for the alternative.', addresses: ['occasion'], match_level: 'Good Match' }] }
      return { case_id: benchmarkCase.id, run, outcome: 'returned' as const, latency_ms: 0, output }
    })),
  }
}

describe('the golden case matrix', () => {
  const { cases: plannedCases, groups, reserves } = goldenPlan.buildCases()
  const rows = goldenPlan.matrixRows(plannedCases, groups, reserves)
  const counts = goldenPlan.conditionCounts(plannedCases)
  const matrix = readFileSync(path.join(planDir, 'CASE_MATRIX.md'), 'utf8').replace(/\r\n/g, '\n')
  const report = evaluateRecording(planRecording(), planCases, CURRENT, 'replay', { references: reviewedPlan() })
  const index = report.metric_index
  const separate = (condition: typeof WITH | typeof WITHOUT, name: string) => index[styleDnaMetricName(condition, name)]

  it('lists every planned case once, with its mode, images, Style DNA, abstention and pair', () => {
    expect(rows.map((row) => row.id)).toEqual(planCases.map((benchmarkCase) => benchmarkCase.id))
    expect(rows).toHaveLength(45)
    for (const benchmarkCase of planCases) {
      const row = rows.find((entry) => entry.id === benchmarkCase.id) as (typeof rows)[number]
      expect({ id: row.id, mode: row.mode, images: row.images, styleDna: row.styleDna, abstain: row.abstain, rated: row.rated }).toEqual({
        id: benchmarkCase.id,
        mode: benchmarkCase.garment_mode ?? 'single',
        // One personal photo plus every garment image.
        images: 2 + (benchmarkCase.extra_garments?.length ?? 0),
        styleDna: benchmarkCase.style_dna?.persona ?? null,
        abstain: benchmarkCase.expected.should_abstain,
        rated: !benchmarkCase.expected.should_abstain,
      })
      // Every case appears in the committed table.
      expect(matrix).toContain(`| \`${benchmarkCase.id}\``)
    }
    expect(rows.filter((row) => row.reserve).map((row) => row.id)).toEqual(['gv-g11-views', 'gv-g12-views', 'gv-o11-outfit', 'gv-o12-outfit'])
  })

  it('counts cases, never images, and treats Style DNA as a condition inside the three modes', () => {
    const composition = describeComposition(planCases)
    const perMode = (of: (row: (typeof rows)[number]) => boolean) => Object.fromEntries(GARMENT_MODES.map((mode) => [mode, rows.filter((row) => row.mode === mode && of(row)).length]))
    expect(perMode(() => true)).toEqual(composition.cases_by_mode)
    expect(perMode((row) => row.styleDna !== null)).toEqual(composition.style_dna.cases_by_mode)
    expect(rows.reduce((sum, row) => sum + row.images, 0)).toBe(composition.images.total)
    expect(new Set(rows.map((row) => row.mode))).toEqual(new Set(GARMENT_MODES))
    expect(matrix).toContain('| Cases | 21 | 12 | 12 | 45 |')
    expect(matrix).toContain('| Give ratings, without Style DNA | 13 | 8 | 8 | 29 |')
    expect(matrix).toContain('| Give ratings, with Style DNA | 6 | 4 | 4 | 14 |')
    expect(matrix).toContain('| Images in the requests | 42 | 40 | 41 | 123 |')
    expect(goldenPlan.MIN_CASES).toBe(MIN_SAMPLE)
  })

  it('says which figures are separate, and an evaluation of the fully reviewed plan reports exactly that', () => {
    expect(counts).toEqual({ with: { all: 14, single: 6, same_garment_views: 4, outfit_items: 4 }, without: { all: 29, single: 13, same_garment_views: 8, outfit_items: 8 } })
    expect(report.quality.style_dna).toMatchObject({ mixed: true, cases_with_style_dna: 14, cases_without_style_dna: 31 })

    // Overall, each condition has its own figure. 29 and 14 cases give ratings; together they are the 43 of the pooled figure.
    expect(separate(WITHOUT, 'agreement.image_reviewed.occasion.exact_rate')).toMatchObject({ status: 'measured', n: counts.without.all })
    expect(separate(WITH, 'agreement.image_reviewed.occasion.exact_rate')).toMatchObject({ status: 'measured', n: counts.with.all })
    expect(index['agreement.image_reviewed.occasion.exact_rate']).toMatchObject({ status: 'measured', n: 43, pooled_over_style_dna: true })

    // Per garment mode, what the matrix calls separate is measured, and what it calls unavailable has no value.
    for (const mode of GARMENT_MODES) {
      for (const [condition, key] of [[WITHOUT, 'without'], [WITH, 'with']] as const) {
        const metric = separate(condition, `multi_image.${mode}.agreement.image_reviewed.exact_rate`)
        const n = counts[key][mode]
        expect({ mode, condition, status: metric.status, n: metric.n, value: metric.value === null }).toEqual(
          n >= MIN_SAMPLE ? { mode, condition, status: 'measured', n, value: false } : { mode, condition, status: 'unavailable', n: 0, value: true },
        )
      }
      // The pooled figure of every mode is measured, on all its cases that give ratings, and labelled as pooled.
      expect(index[`multi_image.${mode}.agreement.image_reviewed.exact_rate`]).toMatchObject({ status: 'measured', n: counts.with[mode] + counts.without[mode], pooled_over_style_dna: true })
    }
    expect(matrix).toContain('| Single garment | 13: separate figure | 6: unavailable | 19: pooled, labelled |')
    expect(matrix).toContain('| Views of one garment | 8: unavailable | 4: unavailable | 12: pooled, labelled |')
    expect(matrix).toContain('| Outfit items | 8: unavailable | 4: unavailable | 12: pooled, labelled |')

    // What each row says about its own case agrees with the same counts.
    for (const row of rows.filter((entry) => entry.rated)) {
      const key = row.styleDna ? 'with' : 'without'
      expect({ id: row.id, overall: row.overall, inMode: row.inMode }).toEqual({
        id: row.id,
        overall: `separate (${counts[key].all} cases)`,
        inMode: counts[key][row.mode] >= MIN_SAMPLE ? `separate (${counts[key][row.mode]} cases)` : `unavailable (${counts[key][row.mode]} cases)`,
      })
    }
  })

  it('agrees with an evaluation on the comparison pairs, the advisor and the abstaining cases', () => {
    // Ten pairs, pooled: six without a profile and four with one, too few for a separate figure of either.
    expect(index['multi_image.comparison_groups.cross_mode_rating_consistency']).toMatchObject({ status: 'measured', n: 10, pooled_over_style_dna: true })
    expect(separate(WITHOUT, 'multi_image.comparison_groups.cross_mode_rating_consistency')).toMatchObject({ status: 'unavailable', value: null })
    expect(separate(WITH, 'multi_image.comparison_groups.cross_mode_rating_consistency')).toMatchObject({ status: 'unavailable', value: null })
    expect(matrix).toContain('| Comparison pairs (one photo against several) | 6 pairs: unavailable | 4 pairs: unavailable | 10 pairs: pooled, labelled, no margin |')
    // The advisor figures belong to one condition each.
    expect(index['shopping_advisor.availability_rate']).toMatchObject({ status: 'measured', value: 1, n: 14, style_dna_condition: WITH })
    expect(index['shopping_advisor.unrequested_recommendation_rate']).toMatchObject({ status: 'measured', value: 0, n: 29, style_dna_condition: WITHOUT })
    // The two cases that should abstain give no ratings: they count in validity and abstention, and nowhere else.
    expect(index['abstention.recall']).toMatchObject({ status: 'insufficient_sample', value: 1, n: 2 })
    expect(index['validity.valid_output_rate']).toMatchObject({ status: 'measured', value: 1, n: 45 })
    for (const row of rows.filter((entry) => entry.abstain)) expect({ id: row.id, rated: row.rated, overall: row.overall }).toEqual({ id: row.id, rated: false, overall: null })
    expect(report.quality.agreement.image_reviewed).toMatchObject({ reference_cases: 45, cases_with_output: 43 })
  })

  it('has margin where the reserve cases were added: one failed case in a multi-image mode does not cost the mode its figures', () => {
    for (const [failed, mode] of [['gv-g02-views', 'same_garment_views'], ['gv-o03-outfit', 'outfit_items']] as const) {
      const partial = evaluateRecording(planRecording([failed]), planCases, CURRENT, 'replay', { references: reviewedPlan() })
      expect({ failed, metric: partial.metric_index[`multi_image.${mode}.agreement.image_reviewed.exact_rate`] }).toMatchObject({ failed, metric: { status: 'measured', n: 11 } })
      expect(partial.metric_index[`multi_image.${mode}.repeat_rating_stability`]).toMatchObject({ status: 'measured', n: 11 })
    }
    // With the 41 earlier cases alone the same failure left nine: "too few to conclude".
    const reserveIds = ['gv-g11-views', 'gv-g12-views', 'gv-o11-outfit', 'gv-o12-outfit']
    const withoutReserves = evaluateRecording(planRecording(['gv-g02-views', ...reserveIds]), planCases, CURRENT, 'replay', { references: reviewedPlan() })
    expect(withoutReserves.metric_index['multi_image.same_garment_views.agreement.image_reviewed.exact_rate']).toMatchObject({ status: 'insufficient_sample', n: 9 })
  })

  it('has no margin for the comparison pairs, as the matrix says: one failed pair puts that figure back to too few', () => {
    const partial = evaluateRecording(planRecording(['gv-g02-views']), planCases, CURRENT, 'replay', { references: reviewedPlan() })
    expect(partial.metric_index['multi_image.comparison_groups.cross_mode_rating_consistency']).toMatchObject({ status: 'insufficient_sample', n: 9 })
  })

  it('tells the reviewer the same thing before any model is called', () => {
    const lines = readinessLines(describeReadiness(reviewedPlan(), planCases))
    expect(lines).toContain('Cases that can give ratings, without Style DNA: single 13, same_garment_views 8, outfit_items 8 (29 in all)')
    expect(lines).toContain('Cases that can give ratings, with Style DNA: single 6, same_garment_views 4, outfit_items 4 (14 in all)')
    expect(lines).toContain('Style DNA is a condition, not a garment mode. Separate figures (at least 10 cases): all cases without Style DNA (29); all cases with Style DNA (14); single without (13).')
    expect(lines).toContain('Unavailable as separate figures, reported only as figures labelled pooled: single with (6); same_garment_views without (8); same_garment_views with (4); outfit_items without (8); outfit_items with (4).')
    expect(lines.join('\n')).toContain('Reviews per mode: every garment mode has at least 10 such cases.')
  })

  it('does not claim anything about pooling while no case is reviewed', () => {
    const unreviewed = parseReferenceSet(planTemplate, planCases)
    const lines = readinessLines(describeReadiness(unreviewed, planCases))
    expect(lines).toContain('Style DNA condition: no reviewed case can give ratings yet. The case matrix shows what the plan would report with and without Style DNA.')
    expect(lines.join(' ')).not.toContain('no figure is pooled')
  })

  it('is a plan: the committed files hold no review, and the matrix says so', () => {
    expect(matrix).toContain('**This is a plan.** No image exists yet, no case has been reviewed and no model has been called.')
    expect(matrix).not.toMatch(/Excellent|Good|Fair|Poor|test-reviewer/)
    expect(planTemplate.references.every((reference) => (reference as Record<string, unknown>).basis === 'unreviewed')).toBe(true)
  })
})
