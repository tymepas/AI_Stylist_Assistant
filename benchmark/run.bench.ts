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
import { analyzeWithOpenAI } from '@/lib/services/openai/openAIAnalysisService'
import { validateImageFile } from '@/lib/services/analysisService'
import { resolveModelConfig } from '@/lib/services/openai/modelConfig'
import {
  evaluateGate,
  manifestSchema,
  maxCostPerCallMicroUsd,
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
    for (const relative of [benchmarkCase.photo, benchmarkCase.garment]) {
      const full = path.join(dataDir, relative)
      if (!existsSync(full)) { problems.push(`${benchmarkCase.id}: missing ${relative}`); continue }
      const file = new File([readFileSync(full)], path.basename(full), { type: MIME[path.extname(full).toLowerCase()] })
      const check = await validateImageFile(file)
      if (!check.valid) { problems.push(`${benchmarkCase.id}: ${relative} rejected (${check.message})`); continue }
      files.push(file)
    }
    if (files.length === 2) prepared.push({ benchmarkCase, photo: files[0], garment: files[1] })
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

    const perCall = maxCostPerCallMicroUsd(options)
    const plannedCalls = prepared.length * options.runsPerCase
    out(`Model: ${options.model}  reasoning: ${options.reasoningEffort ?? 'n/a'}  max_output_tokens: ${options.maxOutputTokens}  runs/case: ${options.runsPerCase}`)
    out(`Cases: ${manifest.cases.length} in manifest, ${prepared.length} ready, ${problems.length} problem(s)`)
    for (const problem of problems) out(`  - ${problem}`)
    const manifestCalls = manifest.cases.length * options.runsPerCase
    out(`Worst-case cost: $${(perCall / 1e6).toFixed(4)} per call, $${((perCall * plannedCalls) / 1e6).toFixed(2)} for ${plannedCalls} ready calls ($${((perCall * manifestCalls) / 1e6).toFixed(2)} for all ${manifestCalls} manifest calls)`)

    if (gate.mode === 'dry_run') {
      out(`DRY RUN — no API calls were made. ${gate.reason}`)
      expect(true).toBe(true)
      return
    }

    if (!loadApiKey()) throw new Error('OPENAI_API_KEY is not available.')
    out(`LIVE RUN — spend cap $${options.maxUsd.toFixed(2)}. Calls run one at a time.`)

    // Service logs are content-free, but keep the console to aggregates only.
    jest.spyOn(console, 'info').mockImplementation(() => undefined)

    const outcome = await runCases(prepared, options, (input) => analyzeWithOpenAI({
      photo: input.photo,
      garment: input.garment,
      occasion: input.occasion,
      styleProfile: input.styleProfile,
      requestId: input.requestId,
      onUsage: input.onUsage,
      runOverrides: { model: input.options.model, reasoningEffort: input.options.reasoningEffort, maxOutputTokens: input.options.maxOutputTokens },
    }))

    const summary = summarize(outcome.records, manifest.cases)
    const resultsDir = path.join(ROOT, 'benchmark', 'results')
    mkdirSync(resultsDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const base = path.join(resultsDir, `${stamp}-${options.model}-${options.reasoningEffort ?? 'default'}`)
    writeFileSync(`${base}.json`, JSON.stringify({ options, summary, stoppedEarly: outcome.stoppedEarly, records: outcome.records }, null, 2))
    writeFileSync(`${base}.review.csv`, reviewSheet(outcome.records))

    out(JSON.stringify(summary, null, 2))
    if (outcome.stoppedEarly) out(outcome.stopReason ?? 'Stopped early.')
    out(`Results: ${path.relative(ROOT, base)}.json and .review.csv`)
    out(`Timeout for this model: ${resolveModelConfig(options.model)!.operations.analysis.timeoutMs} ms (for the latency criterion).`)
  }, 2 * 60 * 60 * 1000)
})

function reviewSheet(records: RunRecord[]): string {
  const header = ['case_id', 'category', 'run', 'outcome', 'error_code', 'verdict', 'verdict_score', 'prohibited_hits', 'forbidden_claim_hits', 'reviewer_hallucination_y_n', 'reviewer_notes']
  const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
  return [header.join(','), ...records.map((r) => [r.case_id, r.category, r.run, r.outcome, r.error_code, r.verdict, r.verdict_score, r.prohibited_hits.join(' '), r.forbidden_claim_hits.join(' '), '', ''].map(escape).join(','))].join('\n')
}
