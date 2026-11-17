/**
 * The two balanced datasets of Phase 4, Milestone 0, and the Shopping Advisor
 * figures they make measurable:
 *
 * - `scenarios-v2`: the synthetic scenarios, with at least ten cases per garment
 *   mode and twelve cases that send an invented Style DNA profile. Hand-written
 *   outputs: it checks Verdict's own code and is never evidence about a model.
 * - the golden case PLAN: which real images a balanced benchmark needs. It
 *   holds no image, no review and no rating.
 *
 * The two are kept apart from each other and from any human review, and this
 * file checks that they stay apart.
 *
 * Nothing here calls a model or the network.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

jest.mock('server-only', () => ({}), { virtual: true })

import { HARD_MAX_USD, MIN_CASES_PER_MODE, describeComposition, evaluateGate, manifestSchema, plannedWorstCaseMicroUsd, type BenchmarkCase, type RunOptions } from '@/benchmark/harness'
import { evaluateRecording, renderMarkdown, serializeReport, type EvaluationReport } from '@/evaluation/evaluate'
import { DATASETS, datasetPaths, loadCases, loadRecording, loadReferenceSet, loadReport } from '@/evaluation/load'
import { describeReadiness } from '@/evaluation/readiness'
import { RECORDABLE_SOURCES, datasetFingerprint } from '@/evaluation/recording'
import { tierOf } from '@/evaluation/reference'
import { assessBaselineUpdate, classifyMetricChanges, classifyRegressions } from '@/evaluation/regression'
import { GARMENT_MODES } from '@/lib/constants/garmentModes'
import { OCCASION_OPTIONS } from '@/lib/constants/options'
import { ANALYSIS_OUTPUT_SCHEMA_VERSION } from '@/lib/services/openai/openAIAnalysisSchema'
import { validateShoppingRecommendations } from '@/lib/services/openai/shoppingRecommendationSchema'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const scenarios = require('../../scripts/evaluation/build-scenarios.cjs') as { build: (name?: string) => Record<string, string>; CASES: Array<{ id: string }>; V2_CASES: Array<{ id: string; dna?: string }> }
// eslint-disable-next-line @typescript-eslint/no-require-imports
const goldenPlan = require('../../scripts/evaluation/build-golden-plan.cjs') as { build: () => Record<string, string>; PLANNED: string }

const root = process.cwd()
const CURRENT = { promptVersion: 'aaaaaaaaaaaa', schemaVersion: ANALYSIS_OUTPUT_SCHEMA_VERSION }
const v1 = datasetPaths(root, 'scenarios-v1')
const v2 = datasetPaths(root, 'scenarios-v2')

let fetchSpy: jest.SpiedFunction<typeof fetch>

beforeEach(() => {
  fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() => {
    throw new Error('Network access is not allowed in an evaluation.')
  })
})

afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled()
  jest.restoreAllMocks()
})

const evaluate = (paths: typeof v2, change?: (recording: ReturnType<typeof loadRecording>) => void): EvaluationReport => {
  const recording = loadRecording(paths.recordingPath)
  change?.(recording)
  return evaluateRecording(recording, loadCases(paths.casesPath), CURRENT, 'mock')
}

describe('scenarios-v2: the balanced synthetic dataset', () => {
  const cases = loadCases(v2.casesPath)
  const recording = loadRecording(v2.recordingPath)
  const report = evaluate(v2)

  it('is the output of its generator, so it is never edited by hand', () => {
    const built = scenarios.build('scenarios-v2')
    for (const name of ['cases.json', 'recording.json']) {
      const committed = readFileSync(path.join(root, DATASETS['scenarios-v2'].dir, name), 'utf8').replace(/\r\n/g, '\n')
      expect({ name, upToDate: committed === built[name] }).toEqual({ name, upToDate: true })
    }
  })

  it('holds every case of scenarios-v1, unchanged, and leaves scenarios-v1 itself as it was', () => {
    const before = loadCases(v1.casesPath)
    const byId = new Map(cases.map((benchmarkCase) => [benchmarkCase.id, benchmarkCase]))
    for (const benchmarkCase of before) expect(byId.get(benchmarkCase.id)).toEqual(benchmarkCase)
    expect(cases.length).toBe(before.length + scenarios.V2_CASES.length)
    // The original dataset keeps the fingerprint its baseline was recorded for.
    expect(datasetFingerprint(before)).toBe('356564d74840')
    expect(loadReport(v1.baselinePath as string).dataset.fingerprint).toBe('356564d74840')
    const outputsOf = (file: string) => new Map(loadRecording(file).entries.map((entry) => [`${entry.case_id}#${entry.run}`, JSON.stringify(entry.output)]))
    const next = outputsOf(v2.recordingPath)
    for (const [key, output] of outputsOf(v1.recordingPath)) expect(next.get(key)).toBe(output)
  })

  it('has at least ten cases in each garment mode, counted in cases and not in images', () => {
    const composition = describeComposition(cases)
    expect(composition.cases_by_mode).toEqual({ single: 55, same_garment_views: 12, outfit_items: 12 })
    expect(composition.mode_balance).toEqual({ target_per_mode: 10, short_by: { single: 0, same_garment_views: 0, outfit_items: 0 }, balanced: true })
    // 111 garment images belong to 79 cases; nothing below is built from the larger number.
    expect(composition.images).toMatchObject({ personal_photos: 79, garment_images: 111, total: 190 })
    for (const mode of GARMENT_MODES) expect(report.quality.multi_image.modes[mode].cases).toBe(composition.cases_by_mode[mode])
  })

  it('sends an invented Style DNA profile in twelve cases, spread over the three modes', () => {
    const composition = describeComposition(cases)
    expect(composition.style_dna.cases).toBe(12)
    expect(composition.style_dna.cases_by_mode).toEqual({ single: 6, same_garment_views: 3, outfit_items: 3 })
    for (const benchmarkCase of cases.filter((entry) => entry.style_dna)) {
      expect(benchmarkCase.style_dna?.source).toBe('synthetic')
      expect(benchmarkCase.description).toMatch(/^Synthetic scenario \(no image exists\): With an invented Style DNA profile/)
    }
  })

  it('is synthetic throughout and uses only occasions the application offers', () => {
    for (const benchmarkCase of cases) {
      expect(benchmarkCase.source).toBe('synthetic')
      expect(benchmarkCase.description).toMatch(/^Synthetic scenario \(no image exists\)/)
      expect(benchmarkCase.id).toMatch(/^sc-[a-z0-9-]+$/)
      expect(OCCASION_OPTIONS).toContain(benchmarkCase.occasion)
    }
    expect(recording.provenance).toBe('synthetic_fixture')
    expect(recording.dataset_fingerprint).toBe(datasetFingerprint(cases))
    expect(recording.entries.length).toBe(cases.length * 2)
    expect(recording.entries.every((entry) => entry.latency_ms === 0 && entry.usage === undefined)).toBe(true)
  })

  it('has no reference set, so nothing in it can be read as agreement with a reviewer', () => {
    expect(DATASETS['scenarios-v2'].references).toBe(false)
    expect(existsSync(path.join(root, DATASETS['scenarios-v2'].dir, 'references.json'))).toBe(false)
    expect(report.references).toMatchObject({ status: 'none', cases_by_tier: { image_reviewed: 0, brief_derived: 0, synthetic: 0, unreviewed: 0 } })
    expect(report.quality.image_grounded_accuracy).toEqual({ status: 'unavailable', reason: 'Unavailable: insufficient human-reviewed ground truth', cases: 0 })
    expect(Object.entries(report.metric_index).filter(([name, metric]) => /^(agreement|grounding|calibration|garment_identification)\./.test(name) && metric.status !== 'unavailable')).toEqual([])
    expect(report.interpretation).toMatch(/says nothing about model quality/)
    expect(renderMarkdown(report)).toContain('No figure below this line is evidence about accuracy on real images.')
  })

  it('passes every case, each judged on its expected behaviour', () => {
    expect(report.cases.filter((entry) => entry.status !== 'pass').map((entry) => [entry.case_id, entry.failure_reasons])).toEqual([])
    expect(report.summary).toMatchObject({ total_cases: 79, failed: 0, not_applicable: 0, pass_rate: 1, proxy_flags: { proxy_occasion: 0, proxy_explanation: 0 } })
    for (const entry of report.cases) {
      const applicable = entry.checks.filter((check) => check.blocking && check.status !== 'not_applicable').map((check) => check.check)
      expect({ id: entry.case_id, behaviour: applicable.some((check) => ['expected_outcome', 'uncertainty', 'verdict_integrity'].includes(check)) }).toEqual({ id: entry.case_id, behaviour: true })
    }
  })

  it('turns the figures of both multi-image modes from indicative into measured', () => {
    const before = evaluate(v1)
    for (const name of ['multi_image.same_garment_views.valid_output_rate', 'multi_image.same_garment_views.repeat_rating_stability', 'multi_image.outfit_items.valid_output_rate', 'multi_image.outfit_items.repeat_rating_stability', 'multi_image.outfit_items.completeness_rate']) {
      expect({ name, v1: before.metric_index[name].status, v2: report.metric_index[name].status, n: report.metric_index[name].n }).toEqual({ name, v1: 'insufficient_sample', v2: 'measured', n: 12 })
    }
  })

  it('contains no model text, file names or timestamps in its report', () => {
    const text = serializeReport(report)
    for (const fragment of ['suits a', 'The colours', '.jpg', 'recorded_at', 'latency_ms', 'A plain shirt keeps', 'Lighter unlined blazer', 'skin_tone', 'dark brown']) expect(text).not.toContain(fragment)
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
  })
})

describe('Shopping Advisor figures', () => {
  const cases = loadCases(v2.casesPath)
  const dnaIds = new Set(cases.filter((benchmarkCase) => benchmarkCase.style_dna).map((benchmarkCase) => benchmarkCase.id))
  const report = evaluate(v2)

  it('carry a block the application would show, in every case with Style DNA', () => {
    for (const entry of loadRecording(v2.recordingPath).entries.filter((candidate) => dnaIds.has(candidate.case_id))) {
      expect(() => validateShoppingRecommendations((entry.output as { shopping_advisor?: unknown }).shopping_advisor)).not.toThrow()
    }
    expect(report.quality.shopping_advisor).toMatchObject({ cases_with_style_dna: 12, cases_without_style_dna: 63 })
    expect(report.quality.shopping_advisor.availability_rate).toMatchObject({ status: 'measured', value: 1, n: 12 })
    expect(report.quality.shopping_advisor.mistargeted_recommendation_rate).toMatchObject({ status: 'measured', value: 0, n: 12 })
    expect(report.metric_index['shopping_advisor.availability_rate']).toMatchObject({ status: 'measured', value: 1, n: 12, direction: 'higher_is_better', needs_references: false })
  })

  it('count a case once, however many recommendations and runs it has', () => {
    // 12 cases, 24 runs, 15 recommendations per run: the sample is 12.
    expect(report.quality.shopping_advisor.availability_rate.n).toBe(12)
    expect(report.quality.shopping_advisor.mistargeted_recommendation_rate.n).toBe(12)
  })

  it('notice an advisor block that goes missing or malformed, and report it as a regression', () => {
    const broken = evaluate(v2, (recording) => {
      for (const entry of recording.entries) {
        const output = entry.output as { shopping_advisor?: unknown }
        if (!dnaIds.has(entry.case_id)) continue
        if (entry.run === 1) delete output.shopping_advisor
        else output.shopping_advisor = { recommendations: [{ title: 'Only a title' }] }
      }
    })
    expect(broken.quality.shopping_advisor.availability_rate).toMatchObject({ status: 'measured', value: 0, n: 12 })
    // The ratings and the verdict are untouched: the advisor never reaches them.
    expect(broken.cases.map((entry) => [entry.case_id, entry.outcomes])).toEqual(report.cases.map((entry) => [entry.case_id, entry.outcomes]))
    expect(broken.summary.failed).toBe(0)
    const changes = classifyMetricChanges(report, broken)
    expect(changes.regressions).toContain('shopping_advisor.availability_rate')
    // With no valid block left there is nothing to judge the targeting on: that figure is lost, which also counts as worse.
    expect(changes.lost).toContain('shopping_advisor.mistargeted_recommendation_rate')
    expect(broken.next_steps.some((step) => step.startsWith('With Style DNA, the advisor block is missing or invalid'))).toBe(true)
    const decision = assessBaselineUpdate(report, broken)
    expect(decision.allowed).toBe(false)
  })

  it('notice recommendations that address only dimensions already rated Excellent', () => {
    const mistargeted = evaluate(v2, (recording) => {
      for (const entry of recording.entries) {
        if (entry.case_id !== 'sc-dna-classic-office-blazer') continue
        // This case rates the occasion Excellent; the recommendation is rewritten to address only that.
        const advisor = (entry.output as { shopping_advisor: { recommendations: Array<{ addresses: string[] }> } }).shopping_advisor
        advisor.recommendations[0].addresses = ['occasion']
      }
    })
    // One of twelve cases, all of its recommendations: 1 / 12.
    expect(mistargeted.quality.shopping_advisor.mistargeted_recommendation_rate).toMatchObject({ value: 0.0833, n: 12 })
    expect(mistargeted.quality.shopping_advisor.availability_rate.value).toBe(1)
  })

  it('notice recommendations returned without Style DNA, which the prompt asks to leave empty', () => {
    // The one case in the dataset that does so on purpose is the integrity case with a valid block and no profile.
    expect(report.quality.shopping_advisor.unrequested_recommendation_rate).toMatchObject({ status: 'measured', value: 0.0159, n: 63 })
    const noisy = evaluate(v2, (recording) => {
      for (const entry of recording.entries) {
        const output = entry.output as { status?: string; shopping_advisor?: unknown }
        if (!dnaIds.has(entry.case_id) && output?.status === 'complete' && output.shopping_advisor === undefined) output.shopping_advisor = { recommendations: [{ title: 'Unasked' }] }
      }
    })
    expect(noisy.quality.shopping_advisor.unrequested_recommendation_rate.value).toBeGreaterThan(0.9)
    expect(classifyMetricChanges(report, noisy).regressions).toContain('shopping_advisor.unrequested_recommendation_rate')
  })

  it('are unavailable, never zero, for a dataset without Style DNA', () => {
    const before = evaluate(v1)
    expect(before.quality.shopping_advisor.availability_rate).toEqual({ status: 'unavailable', reason: 'Unavailable: no case with a Style DNA profile produced ratings', value: null, n: 0, se: null })
    expect(before.quality.shopping_advisor.mistargeted_recommendation_rate.value).toBeNull()
  })
})

describe('scenarios-v2: the committed baseline', () => {
  const report = evaluate(v2)
  const baseline = loadReport(v2.baselinePath as string)

  it('exists, is complete, describes this dataset and is in the current report format', () => {
    expect(baseline.selection.partial).toBe(false)
    expect(baseline.dataset.fingerprint).toBe(report.dataset.fingerprint)
    expect(baseline.dataset.matches_recording).toBe(true)
    expect(baseline.provenance).toBe('synthetic_fixture')
    expect(baseline.report_format).toBe(report.report_format)
  })

  it('shows no regression at case level or at metric level: this is the check that fails CI', () => {
    const regressions = classifyRegressions(baseline, report)
    expect(regressions.comparable).toBe(true)
    expect(regressions.has_regression).toBe(false)
    expect({ fixed: regressions.fixed, added: regressions.added_cases, removed: regressions.removed_cases }).toEqual({ fixed: [], added: [], removed: [] })
    const changes = classifyMetricChanges(baseline, report)
    expect({ regressions: changes.regressions, improvements: changes.improvements, lost: changes.lost }).toEqual({ regressions: [], improvements: [], lost: [] })
    // Only the abstention figure is still built from fewer than ten cases.
    expect(changes.comparisons.filter((comparison) => comparison.classification === 'inconclusive').map((comparison) => comparison.metric)).toEqual(['abstention.recall'])
  })

  it('is byte-identical to the current report, so the committed file is exactly what the code produces', () => {
    // After an intended change to the report, refresh it with: npm run eval:baseline:v2
    const committed = readFileSync(v2.baselinePath as string, 'utf8').replace(/\r\n/g, '\n')
    const promptVersion = (JSON.parse(committed) as EvaluationReport).evaluated_with.prompt_version
    expect(serializeReport(evaluateRecording(loadRecording(v2.recordingPath), loadCases(v2.casesPath), { promptVersion, schemaVersion: ANALYSIS_OUTPUT_SCHEMA_VERSION }, 'mock'))).toBe(committed)
  })

  it('cannot be replaced by a partial run', () => {
    const partial = evaluateRecording(loadRecording(v2.recordingPath), loadCases(v2.casesPath), CURRENT, 'mock', { selection: { caseIds: ['sc-dna-classic-office-blazer'], categories: [], scenarios: [] } })
    expect(assessBaselineUpdate(baseline, partial)).toMatchObject({ allowed: false })
  })
})

describe('the golden case plan', () => {
  const dir = path.join(root, 'evaluation', 'datasets', 'golden-v1')
  const cases = manifestSchema.parse(JSON.parse(readFileSync(path.join(dir, 'cases.template.json'), 'utf8'))).cases
  const references = loadReferenceSet(path.join(dir, 'references.template.json'), cases)
  const byMode = (mode: string) => cases.filter((benchmarkCase) => (benchmarkCase.garment_mode ?? 'single') === mode)

  it('is the output of its generator', () => {
    const built = goldenPlan.build()
    for (const name of ['cases.template.json', 'references.template.json']) {
      const committed = readFileSync(path.join(dir, name), 'utf8').replace(/\r\n/g, '\n')
      expect({ name, upToDate: committed === built[name] }).toEqual({ name, upToDate: true })
    }
  })

  it('plans at least ten cases in each garment mode: 41 cases, which need 111 image slots', () => {
    const composition = describeComposition(cases)
    expect(composition.cases).toBe(41)
    expect(composition.cases_by_mode).toEqual({ single: 21, same_garment_views: 10, outfit_items: 10 })
    expect(composition.mode_balance.balanced).toBe(true)
    for (const mode of GARMENT_MODES) expect(composition.cases_by_mode[mode]).toBeGreaterThanOrEqual(MIN_CASES_PER_MODE)
    // A pair shares its files, so 111 image slots are 91 different files.
    expect(composition.images).toMatchObject({ personal_photos: 41, garment_images: 70, total: 111, distinct_files: 91 })
  })

  it('is a plan and says so: no image, no review, no rating, no expected band', () => {
    for (const benchmarkCase of cases) {
      expect(benchmarkCase.description.startsWith(goldenPlan.PLANNED)).toBe(true)
      expect(benchmarkCase.expected.acceptable_bands).toEqual([])
      expect(benchmarkCase.expected.dimension_ratings).toBeUndefined()
      expect(benchmarkCase.labels).toBeUndefined()
    }
    expect(references.references).toHaveLength(41)
    for (const reference of references.references) {
      expect(tierOf(reference)).toBe('unreviewed')
      expect({ basis: reference.basis, status: reference.status, reviewer: reference.reviewer, ratings: reference.dimension_ratings, second: reference.second_reviews }).toEqual({ basis: 'unreviewed', status: 'pending', reviewer: undefined, ratings: undefined, second: undefined })
      expect(reference.images.every((image) => image.sha256 === undefined)).toBe(true)
    }
    const readiness = describeReadiness(references, cases)
    expect(readiness.image_reviewed_by_mode).toEqual({ single: 0, same_garment_views: 0, outfit_items: 0 })
    expect(readiness.ready_for_measured_figures).toBe(false)
  })

  it('uses only public-licence images, the one source whose outputs may be recorded and scored', () => {
    expect(new Set(cases.map((benchmarkCase) => benchmarkCase.source))).toEqual(new Set(['public_license']))
    expect(RECORDABLE_SOURCES).toContain('public_license')
  })

  it('pairs ten garments as one photo and as several views, sharing the files, the occasion and the Style DNA', () => {
    const groups = new Map<string, string[]>()
    for (const reference of references.references) if (reference.comparison_group) groups.set(reference.comparison_group, [...(groups.get(reference.comparison_group) ?? []), reference.case_id])
    expect(groups.size).toBe(10)
    const byId = new Map(cases.map((benchmarkCase) => [benchmarkCase.id, benchmarkCase]))
    for (const [group, ids] of groups) {
      const [single, views] = ids.map((id) => byId.get(id) as BenchmarkCase).sort((a, b) => (a.garment_mode ?? 'single').localeCompare(b.garment_mode ?? 'single')).reverse()
      expect({ group, modes: [single.garment_mode ?? 'single', views.garment_mode] }).toEqual({ group, modes: ['single', 'same_garment_views'] })
      expect({ photo: views.photo, garment: views.garment, occasion: views.occasion, profile: views.style_profile, dna: views.style_dna?.persona }).toEqual({ photo: single.photo, garment: single.garment, occasion: single.occasion, profile: single.style_profile, dna: single.style_dna?.persona })
    }
  })

  it('sends an invented Style DNA profile in twelve cases, four per garment mode', () => {
    const composition = describeComposition(cases)
    expect(composition.style_dna).toEqual({ cases: 12, cases_by_mode: { single: 4, same_garment_views: 4, outfit_items: 4 }, personas: ['persona-bold-aesthetic', 'persona-minimal-aesthetic'] })
  })

  it('covers borderline fits, poor image quality, ambiguous detail, text in the image and insufficient input', () => {
    const categories = new Set(cases.map((benchmarkCase) => benchmarkCase.category))
    for (const category of ['clear', 'lighting', 'blur', 'occluded', 'difficult_colour', 'ambiguous_detail', 'product_claims_text', 'adversarial_text', 'insufficient_input', 'single_garment', 'multiple_garments'] as const) {
      expect({ category, covered: categories.has(category) }).toEqual({ category, covered: true })
    }
    expect(cases.filter((benchmarkCase) => benchmarkCase.expected.should_abstain).map((benchmarkCase) => benchmarkCase.id)).toEqual(['gv-insufficient-no-person', 'gv-insufficient-no-garment'])
    expect(byMode('outfit_items').filter((benchmarkCase) => benchmarkCase.extra_garments?.length === 2)).toHaveLength(5)
    expect(byMode('same_garment_views').filter((benchmarkCase) => benchmarkCase.extra_garments?.length === 2)).toHaveLength(4)
    for (const benchmarkCase of cases) expect(OCCASION_OPTIONS).toContain(benchmarkCase.occasion)
  })

  it('has a known worst-case cost, inside the hard cap, that only a separately approved live run could spend', () => {
    const options = (runsPerCase: number): RunOptions => ({ model: 'gpt-6.1-terra', reasoningEffort: 'low', maxOutputTokens: 4_000, runsPerCase, maxUsd: 0 })
    // 21 cases with one garment image, 11 with two, 9 with three: 21 x 0.0352 + 11 x 0.0388 + 9 x 0.0424 = 1.5476 per run.
    expect(plannedWorstCaseMicroUsd(cases, options(1))).toBe(1_547_600)
    expect(plannedWorstCaseMicroUsd(cases, options(3))).toBe(4_642_800)
    expect(plannedWorstCaseMicroUsd(cases, options(3))).toBeLessThan(HARD_MAX_USD * 1_000_000)
    expect(HARD_MAX_USD).toBe(10)
    // Without the opt-in phrase the benchmark is a dry run, whatever else is set.
    expect(evaluateGate({ BENCHMARK_MODEL: 'gpt-6.1-terra', BENCHMARK_MAX_USD: '5' }).mode).toBe('dry_run')
  })

  it('leaves the golden dataset empty: the plan is the only thing committed', () => {
    expect(existsSync(path.join(dir, 'cases.json'))).toBe(false)
    expect(existsSync(path.join(dir, 'references.json'))).toBe(false)
  })
})
