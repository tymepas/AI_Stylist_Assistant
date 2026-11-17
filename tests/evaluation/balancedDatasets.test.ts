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
import { parseReferenceSet } from '@/evaluation/reference'
import path from 'node:path'

jest.mock('server-only', () => ({}), { virtual: true })

import { HARD_MAX_USD, MIN_CASES_PER_MODE, describeComposition, evaluateGate, manifestSchema, plannedWorstCaseMicroUsd, type BenchmarkCase, type RunOptions } from '@/benchmark/harness'
import { detailsFromRecording, evaluateRecording, renderMarkdown, serializeReport, type EvaluationReport } from '@/evaluation/evaluate'
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

/** One entry per recorded run: its band, its score and its ratings, as the production verdict code computes them. */
const detailsOf = (recording: ReturnType<typeof loadRecording>) => detailsFromRecording(recording, loadCases(v2.casesPath))

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
    // 111 garment image slots belong to 79 cases; nothing below is built from the larger number.
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
    // 12 cases, 24 runs, 14 recommendations per run: the sample is 12.
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
    // Nothing else moves: every case report (bands, outcomes, status, every check), the summary and every
    // other figure are identical. The advisor reaches no rating, no score and no verdict.
    expect(broken.cases).toEqual(report.cases)
    expect(broken.summary).toEqual(report.summary)
    expect(broken.metrics).toEqual(report.metrics)
    const { shopping_advisor: _brokenAdvisor, ...brokenQuality } = broken.quality
    const { shopping_advisor: _advisor, ...quality } = report.quality
    expect(brokenQuality).toEqual(quality)
    expect(Object.keys(broken.metric_index).filter((name) => JSON.stringify(broken.metric_index[name]) !== JSON.stringify(report.metric_index[name])).every((name) => name.startsWith('shopping_advisor.'))).toBe(true)
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

  it('leave every band and score unchanged whatever the advisor block holds, including its own verdict', () => {
    const verdicts = (source: EvaluationReport) => source.cases.map((entry) => [entry.case_id, entry.outcomes, entry.modal_outcome])
    const scores = (change?: (recording: ReturnType<typeof loadRecording>) => void) => {
      const recording = loadRecording(v2.recordingPath)
      change?.(recording)
      return detailsOf(recording).map((detail) => [detail.case_id, detail.run, detail.band, detail.score, JSON.stringify(detail.dimensions)])
    }
    const baselineScores = scores()
    for (const block of [undefined, null, 'text', 7, [], { recommendations: [] }, { recommendations: 'x', overall_recommendation: 'Highly Recommended', verdict_score: 5 }]) {
      const change = (recording: ReturnType<typeof loadRecording>) => {
        for (const entry of recording.entries) {
          const output = entry.output as { status?: string; shopping_advisor?: unknown }
          if (output?.status !== 'complete') continue
          if (block === undefined) delete output.shopping_advisor
          else output.shopping_advisor = block
        }
      }
      expect(scores(change)).toEqual(baselineScores)
      expect(verdicts(evaluate(v2, change))).toEqual(verdicts(report))
    }
  })

  it('are screened like any other model text: what an alternative SAYS can fail a case, and still cannot move the verdict', () => {
    // The advisor is shown to the user, so its text goes through the same safety and unsupported-claim screening as a
    // reason. That is the one way it reaches a case result. It is deliberate, and it existed before this dataset.
    const screened = evaluate(v2, (recording) => {
      for (const entry of recording.entries) {
        if (entry.case_id !== 'sc-dna-classic-office-blazer') continue
        ;(entry.output as { shopping_advisor: { recommendations: Array<{ rationale: string }> } }).shopping_advisor.recommendations[0].rationale = 'This one is on sale at half price for 49 dollars.'
      }
    })
    const before = report.cases.find((entry) => entry.case_id === 'sc-dna-classic-office-blazer') as EvaluationReport['cases'][number]
    const after = screened.cases.find((entry) => entry.case_id === 'sc-dna-classic-office-blazer') as EvaluationReport['cases'][number]
    expect(before.status).toBe('pass')
    expect(after.status).toBe('fail')
    expect(after.failure_reasons.join(' ')).toMatch(/^unsupported_claims:/)
    expect({ outcomes: after.outcomes, modal: after.modal_outcome }).toEqual({ outcomes: before.outcomes, modal: before.modal_outcome })
  })

  it('do not count a recommendation as mistargeted when the run rated every dimension Excellent', () => {
    // With six Excellent ratings there is no weak dimension, and the prompt still asks for at least one alternative.
    const allExcellent = evaluate(v2, (recording) => {
      for (const entry of recording.entries) {
        if (entry.case_id !== 'sc-dna-classic-office-blazer') continue
        const output = entry.output as { dimensions: Record<string, { rating: string }> }
        for (const key of Object.keys(output.dimensions)) output.dimensions[key].rating = 'Excellent'
      }
    })
    // The case is left out of the figure instead of counting against it: eleven cases remain, none mistargeted.
    expect(allExcellent.quality.shopping_advisor.mistargeted_recommendation_rate).toMatchObject({ value: 0, n: 11 })
    expect(allExcellent.quality.shopping_advisor.availability_rate).toMatchObject({ value: 1, n: 12 })
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

  it('names the figures that are new and so were not gated, instead of passing them silently', () => {
    // A report in an older format has none of the newer figures. Whatever the candidate reports for them
    // has nothing to be compared with: that must be said, because it is not protection.
    const older = JSON.parse(JSON.stringify(baseline)) as EvaluationReport
    for (const name of Object.keys(older.metric_index)) if (name.startsWith('shopping_advisor.')) delete older.metric_index[name]
    const changes = classifyMetricChanges(older, report)
    expect(changes.new_in_candidate).toEqual(['shopping_advisor.availability_rate', 'shopping_advisor.mistargeted_recommendation_rate', 'shopping_advisor.unrequested_recommendation_rate'])
    expect(changes.has_regression).toBe(false)
    const decision = assessBaselineUpdate(older, report)
    expect(decision.allowed).toBe(true)
    expect((decision as { notes: string[] }).notes.some((note) => note.startsWith('Metrics new in this report: 3 figure(s) have nothing to compare with in the baseline, so this comparison does not gate them'))).toBe(true)
    // Against the committed baseline nothing is new.
    expect(classifyMetricChanges(baseline, report).new_in_candidate).toEqual([])
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

  it('sends an invented Style DNA profile in fourteen cases, as a condition on a case and never as a garment mode', () => {
    const composition = describeComposition(cases)
    expect(composition.style_dna).toEqual({ cases: 14, cases_by_mode: { single: 6, same_garment_views: 4, outfit_items: 4 }, personas: ['persona-bold-aesthetic', 'persona-minimal-aesthetic'] })
    // Every Style DNA case is counted in exactly one garment mode, and the modes add up with and without them.
    const sum = (counts: Record<string, number>) => Object.values(counts).reduce((total, count) => total + count, 0)
    expect(sum(composition.cases_by_mode)).toBe(composition.cases)
    expect(sum(composition.style_dna.cases_by_mode)).toBe(composition.style_dna.cases)
    const without = describeComposition(cases.filter((benchmarkCase) => !benchmarkCase.style_dna))
    expect(without.cases_by_mode).toEqual({ single: 15, same_garment_views: 6, outfit_items: 6 })
    expect(without.cases + composition.style_dna.cases).toBe(composition.cases)
    // Fourteen cases, ten different inputs: four of them are the second half of a pair.
    const inputs = new Set(cases.filter((benchmarkCase) => benchmarkCase.style_dna).map((benchmarkCase) => `${benchmarkCase.photo}|${benchmarkCase.garment}|${benchmarkCase.occasion}`))
    expect(inputs.size).toBe(10)
  })

  it('has no margin in the multi-image modes, and says so: exactly ten cases each', () => {
    // Recorded as a fact of the plan, so that a change to it is deliberate. See LIVE_VALIDATION_PLAN.md.
    expect(byMode('same_garment_views')).toHaveLength(10)
    expect(byMode('outfit_items')).toHaveLength(10)
    const rateable = cases.filter((benchmarkCase) => !benchmarkCase.expected.should_abstain)
    expect(rateable).toHaveLength(39)
    // 39 cases that can give ratings are 29 different photo, garment and occasion combinations: a pair shares all three.
    expect(new Set(rateable.map((benchmarkCase) => `${benchmarkCase.photo}|${benchmarkCase.garment}|${benchmarkCase.occasion}`)).size).toBe(29)
  })

  it('gives the extra single cases neutral ids, so an id tells a reviewer nothing about what to expect', () => {
    const extra = cases.filter((benchmarkCase) => !/^gv-(g|o)\d\d-/.test(benchmarkCase.id)).map((benchmarkCase) => benchmarkCase.id)
    expect(extra).toEqual(Array.from({ length: 11 }, (_, index) => `gv-s${String(index + 1).padStart(2, '0')}`))
    for (const benchmarkCase of cases) {
      const visible = [benchmarkCase.id, benchmarkCase.photo, benchmarkCase.garment, ...(benchmarkCase.extra_garments ?? [])].join(' ')
      expect(visible).not.toMatch(/borderline|blur|quality|ambiguous|insufficient|mismatch|match|clear/i)
    }
  })

  it('cannot have a comparison pair whose two cases differ in Style DNA or in style preferences', () => {
    const template = JSON.parse(readFileSync(path.join(dir, 'references.template.json'), 'utf8')) as unknown
    const without = cases.map((benchmarkCase) => {
      if (benchmarkCase.id !== 'gv-g03-views') return benchmarkCase
      const { style_dna: _dna, ...rest } = benchmarkCase
      return rest
    })
    expect(() => parseReferenceSet(template, without)).toThrow(/Comparison group g03: its cases differ in Style DNA \(\(none\), persona-minimal-aesthetic\)/)
    const otherPreferences = cases.map((benchmarkCase) => (benchmarkCase.id === 'gv-g01-views' ? { ...benchmarkCase, style_profile: { preferredStyles: ['Bold'], favoriteColors: [], occasionPreferences: [] } } : benchmarkCase))
    expect(() => parseReferenceSet(template, otherPreferences)).toThrow(/Comparison group g01: its cases have different style preferences/)
    expect(() => parseReferenceSet(template, cases)).not.toThrow()
  })

  it('covers borderline fits, poor image quality, ambiguous detail, text in the image and insufficient input', () => {
    const categories = new Set(cases.map((benchmarkCase) => benchmarkCase.category))
    for (const category of ['clear', 'lighting', 'blur', 'occluded', 'difficult_colour', 'ambiguous_detail', 'product_claims_text', 'adversarial_text', 'insufficient_input', 'single_garment', 'multiple_garments'] as const) {
      expect({ category, covered: categories.has(category) }).toEqual({ category, covered: true })
    }
    expect(cases.filter((benchmarkCase) => benchmarkCase.expected.should_abstain).map((benchmarkCase) => benchmarkCase.id)).toEqual(['gv-s10', 'gv-s11'])
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
    expect(plannedWorstCaseMicroUsd(cases, options(2))).toBe(3_095_200)
    // Without the opt-in phrase the benchmark is a dry run, whatever else is set.
    expect(evaluateGate({ BENCHMARK_MODEL: 'gpt-6.1-terra', BENCHMARK_MAX_USD: '5' }).mode).toBe('dry_run')
  })

  it('reserves for one personal photo plus every garment image of a case, and the same with or without Style DNA', () => {
    const options: RunOptions = { model: 'gpt-6.1-terra', reasoningEffort: 'low', maxOutputTokens: 4_000, runsPerCase: 1, maxUsd: 0 }
    // (8,000 text tokens + 3,600 per image) at $1 per million, plus 4,000 output tokens at $5 per million.
    const reservation = (images: number) => (8_000 + 3_600 * images) * 1 + 4_000 * 5
    for (const benchmarkCase of cases) {
      const images = 1 + 1 + (benchmarkCase.extra_garments?.length ?? 0)
      expect({ id: benchmarkCase.id, reserved: plannedWorstCaseMicroUsd([benchmarkCase], options) }).toEqual({ id: benchmarkCase.id, reserved: reservation(images) })
    }
    expect([reservation(2), reservation(3), reservation(4)]).toEqual([35_200, 38_800, 42_400])
  })
})
