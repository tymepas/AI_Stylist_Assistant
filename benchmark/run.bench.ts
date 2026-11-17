/**
 * Benchmark runner. Invoke with `npm run benchmark` (see benchmark/README.md).
 *
 * Default is a DRY RUN: it validates the manifest and images and prints the
 * worst-case cost, with network access disabled. Billable calls happen only when
 * evaluateGate() returns 'live' (explicit opt-in phrase plus a spend cap).
 *
 * Results (including model reasons, for human review) are written only to
 * benchmark/results/, which is git-ignored. The console shows aggregates only.
 */

import { describe, expect, it, jest } from '@jest/globals'

jest.mock('server-only', () => ({}), { virtual: true })

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { analyzeWithOpenAI, getAnalysisPromptVersion } from '@/lib/services/openai/openAIAnalysisService'
import { ANALYSIS_OUTPUT_SCHEMA_VERSION } from '@/lib/services/openai/openAIAnalysisSchema'
import { createRecorder, stableStringify } from '@/evaluation/recording'
import { validateImageFile } from '@/lib/services/analysisService'
import { ImageNormalizationError, normalizeImage } from '@/lib/images/normalizeImage'
import { resolveModelConfig } from '@/lib/services/openai/modelConfig'
import {
  evaluateGate,
  HARD_MAX_USD,
  manifestSchema,
  maxCostPerCallMicroUsd,
  plannedWorstCaseMicroUsd,
  runCases,
  summarize,
  type BenchmarkCase,
  type PreparedCase,
  type RunRecord,
} from './harness'

const ROOT = process.cwd()
const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }

function out(line = ''): void {
  process.stdout.write(`${line}\n`)
}

/** Reads OPENAI_API_KEY from the environment or .env.local without printing it. */
function loadApiKey(): boolean {
  if (process.env.OPENAI_API_KEY) return true
  const file = path.join(ROOT, '.env.local')
  if (!existsSync(file)) return false
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?OPENAI_API_KEY\s*=\s*(.*)\s*$/.exec(raw)
    if (match) {
      process.env.OPENAI_API_KEY = match[1].replace(/^(['"])(.*)\1$/, '$2')
      return process.env.OPENAI_API_KEY.length > 0
    }
  }
  return false
}

async function prepare(cases: BenchmarkCase[], dataDir: string): Promise<{ prepared: PreparedCase[]; problems: string[] }> {
  const prepared: PreparedCase[] = []
  const problems: string[] = []
  for (const benchmarkCase of cases) {
    const files: File[] = []
    const relatives = [benchmarkCase.photo, benchmarkCase.garment, ...(benchmarkCase.extra_garments ?? [])]
    for (const relative of relatives) {
      const full = path.join(dataDir, relative)
      if (!existsSync(full)) { problems.push(`${benchmarkCase.id}: missing ${relative}`); continue }
      const file = new File([readFileSync(full)], path.basename(full), { type: MIME[path.extname(full).toLowerCase()] })
      const check = await validateImageFile(file)
      if (!check.valid) { problems.push(`${benchmarkCase.id}: ${relative} rejected (${check.message})`); continue }
      // The same server-side normalisation as the API route, so the model receives exactly what production sends.
      try {
        files.push((await normalizeImage(file, `image-${files.length + 1}.jpg`)).file)
      } catch (error) {
        problems.push(`${benchmarkCase.id}: ${relative} rejected (${error instanceof ImageNormalizationError ? error.message : 'could not be processed'})`)
      }
    }
    if (files.length === relatives.length) prepared.push({ benchmarkCase, photo: files[0], garment: files[1], extraGarments: files.slice(2) })
  }
  return { prepared, problems }
}

describe('Verdict model benchmark', () => {
  it('runs', async () => {
    const gate = evaluateGate(process.env)
    if (gate.mode === 'refused') {
      out(`Benchmark refused: ${gate.reason}`)
      throw new Error(gate.reason)
    }
    const { options } = gate

    if (gate.mode === 'dry_run') {
      // Guarantee a dry run cannot reach any network service.
      globalThis.fetch = (() => { throw new Error('Network access is disabled during a dry run.') }) as typeof fetch
    }

    const casesPath = path.resolve(ROOT, process.env.BENCHMARK_CASES ?? 'benchmark/cases.json')
    const dataDir = path.resolve(ROOT, process.env.BENCHMARK_DATA_DIR ?? 'benchmark/data')
    if (!existsSync(casesPath)) throw new Error(`Manifest not found: ${path.relative(ROOT, casesPath)}. Copy benchmark/cases.example.json to start.`)
    const manifest = manifestSchema.parse(JSON.parse(readFileSync(casesPath, 'utf8')))
    const { prepared, problems } = await prepare(manifest.cases, dataDir)

    const plannedCalls = prepared.length * options.runsPerCase
    out(`Model: ${options.model}  reasoning: ${options.reasoningEffort ?? 'n/a'}  max_output_tokens: ${options.maxOutputTokens}  runs/case: ${options.runsPerCase}`)
    out(`Cases: ${manifest.cases.length} in manifest, ${prepared.length} ready, ${problems.length} problem(s)`)
    for (const problem of problems) out(`  - ${problem}`)
    const manifestCalls = manifest.cases.length * options.runsPerCase
    // Each case is priced at its own number of images: a multi-photo case costs more than a single-photo one.
    const readyWorst = plannedWorstCaseMicroUsd(prepared.map((entry) => entry.benchmarkCase), options)
    const manifestWorst = plannedWorstCaseMicroUsd(manifest.cases, options)
    out(`Worst-case cost: $${(maxCostPerCallMicroUsd(options, 2) / 1e6).toFixed(4)} per call with one garment image, $${(maxCostPerCallMicroUsd(options, 4) / 1e6).toFixed(4)} with three; $${(readyWorst / 1e6).toFixed(2)} for ${plannedCalls} ready calls ($${(manifestWorst / 1e6).toFixed(2)} for all ${manifestCalls} manifest calls)`)
    if (manifestWorst > HARD_MAX_USD * 1e6) out(`NOTE: the whole manifest could cost more than the hard cap of $${HARD_MAX_USD}. A live run stops before the cap, so it would not finish every case.`)

    if (gate.mode === 'dry_run') {
      out(`DRY RUN — no API calls were made. ${gate.reason}`)
      expect(true).toBe(true)
      return
    }

    if (!loadApiKey()) throw new Error('OPENAI_API_KEY is not available.')
    out(`LIVE RUN — spend cap $${options.maxUsd.toFixed(2)}. Calls run one at a time.`)

    // Service logs are content-free, but keep the console to aggregates only.
    jest.spyOn(console, 'info').mockImplementation(() => undefined)

    // Capture the outputs so this run can be replayed for free (`npm run eval`).
    // Outputs for photos of real people are withheld by the recorder.
    const promptVersion = await getAnalysisPromptVersion()
    const recorder = createRecorder({ options, promptVersion, schemaVersion: ANALYSIS_OUTPUT_SCHEMA_VERSION, cases: manifest.cases, recordedAt: new Date().toISOString() })

    const outcome = await runCases(prepared, options, recorder.wrap((input) => analyzeWithOpenAI({
      photo: input.photo,
      garment: input.garment,
      extraGarments: input.extraGarments,
      garmentMode: input.garmentMode,
      occasion: input.occasion,
      styleProfile: input.styleProfile,
      requestId: input.requestId,
      onUsage: input.onUsage,
      runOverrides: { model: input.options.model, reasoningEffort: input.options.reasoningEffort, maxOutputTokens: input.options.maxOutputTokens },
      analysisMode: 'benchmark',
    })))

    const summary = summarize(outcome.records, manifest.cases)
    const resultsDir = path.join(ROOT, 'benchmark', 'results')
    mkdirSync(resultsDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const base = path.join(resultsDir, `${stamp}-${options.model}-${options.reasoningEffort ?? 'default'}`)
    writeFileSync(`${base}.json`, JSON.stringify({ options, prompt_version: promptVersion, schema_version: ANALYSIS_OUTPUT_SCHEMA_VERSION, summary, stoppedEarly: outcome.stoppedEarly, records: outcome.records }, null, 2))
    writeFileSync(`${base}.review.csv`, reviewSheet(outcome.records))
    writeFileSync(`${base}.recording.json`, stableStringify(recorder.recording()))

    out(JSON.stringify(summary, null, 2))
    if (outcome.stoppedEarly) out(outcome.stopReason ?? 'Stopped early.')
    out(`Results: ${path.relative(ROOT, base)}.json, .review.csv and .recording.json`)
    out(`Timeout for this model: ${resolveModelConfig(options.model)!.operations.analysis.timeoutMs} ms (for the latency criterion).`)
  }, 2 * 60 * 60 * 1000)
})

function reviewSheet(records: RunRecord[]): string {
  const header = ['case_id', 'category', 'run', 'outcome', 'error_code', 'verdict', 'verdict_score', 'prohibited_hits', 'forbidden_claim_hits', 'reviewer_hallucination_y_n', 'reviewer_notes']
  const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
  return [header.join(','), ...records.map((r) => [r.case_id, r.category, r.run, r.outcome, r.error_code, r.verdict, r.verdict_score, r.prohibited_hits.join(' '), r.forbidden_claim_hits.join(' '), '', ''].map(escape).join(','))].join('\n')
}
