/**
 * Recordings: model outputs captured once and replayed any number of times.
 *
 * A recording stores, for each case and run, the JSON the model returned (or the
 * error it produced), tied to the model, prompt version, schema version and
 * dataset it was produced with. Replaying it costs nothing and gives the same
 * result every time.
 *
 * Privacy rules enforced here:
 * - A recording never contains images, file names, prompts or credentials.
 * - Model text is stored only for cases whose images are synthetic or publicly
 *   licensed. For photos of real people (`owned`, `approved_volunteer`) the
 *   output is withheld, because model text describes the person in the photo.
 */

import { z } from 'zod'
import type { RawOpenAIAnalysisResult } from '@/types/openai'
import { REASONING_EFFORTS, SUPPORTED_MODEL_IDS, type NormalizedUsage } from '@/lib/services/openai/modelConfig'
import { fingerprint } from '@/lib/services/openai/promptVersion'
import type { AnalyzeFn, BenchmarkCase, RunOptions } from '@/benchmark/harness'

export const RECORDING_FORMAT = 'verdict-recording/1'

/** Image sources whose model outputs may be stored. */
export const RECORDABLE_SOURCES: ReadonlyArray<BenchmarkCase['source']> = ['synthetic', 'public_license']

const usageSchema = z
  .object({
    input_tokens: z.number().int().min(0),
    output_tokens: z.number().int().min(0),
    total_tokens: z.number().int().min(0),
    cached_tokens: z.number().int().min(0),
    reasoning_tokens: z.number().int().min(0),
  })
  .strict()

const entrySchema = z
  .object({
    case_id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
    run: z.number().int().min(1).max(5),
    /** `withheld`: the call happened but its output may not be stored (see RECORDABLE_SOURCES). */
    outcome: z.enum(['returned', 'error', 'withheld']),
    /** The model's JSON output exactly as returned, before validation. Present only for `returned`. */
    output: z.unknown().optional(),
    error_code: z.string().regex(/^[a-z_]{1,40}$/).optional(),
    latency_ms: z.number().min(0),
    usage: usageSchema.optional(),
  })
  .strict()

export const recordingSchema = z
  .object({
    format: z.literal(RECORDING_FORMAT),
    /** `synthetic_fixture`: hand-written outputs for testing the harness. `model`: real model outputs. */
    provenance: z.enum(['synthetic_fixture', 'model']),
    model: z.enum(SUPPORTED_MODEL_IDS),
    reasoning_effort: z.enum(REASONING_EFFORTS as [string, ...string[]]).nullable(),
    max_output_tokens: z.number().int().min(1),
    prompt_version: z.string().regex(/^[0-9a-f]{12}$/),
    schema_version: z.string().regex(/^[a-z-]+\/[0-9.]+$/),
    dataset_fingerprint: z.string().regex(/^[0-9a-f]{12}$/),
    /** Informational only; never part of an evaluation report. */
    recorded_at: z.string().max(40).optional(),
    entries: z.array(entrySchema).max(1000),
  })
  .strict()
  .superRefine((recording, ctx) => {
    const seen = new Set<string>()
    for (const entry of recording.entries) {
      const key = `${entry.case_id}#${entry.run}`
      if (seen.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate entry ${key}` })
      seen.add(key)
      if (entry.outcome === 'returned' && entry.output === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Entry ${key} has no output` })
      if (entry.outcome !== 'returned' && entry.output !== undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Entry ${key} must not carry an output` })
      if (entry.outcome === 'error' && !entry.error_code) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Entry ${key} has no error_code` })
    }
  })

export type Recording = z.infer<typeof recordingSchema>
export type RecordingEntry = Recording['entries'][number]

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as object).sort().map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]))
  }
  return value
}

/** JSON with object keys sorted at every level, so equal data always serialises identically. */
export function stableStringify(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`
}

/** Identifies a dataset: the cases, their inputs and their expectations, independent of order. */
export function datasetFingerprint(cases: BenchmarkCase[]): string {
  const ordered = [...cases].sort((a, b) => a.id.localeCompare(b.id))
  return fingerprint([JSON.stringify(sortKeys(ordered))])
}

export interface RecordingMeta {
  options: RunOptions
  promptVersion: string
  schemaVersion: string
  cases: BenchmarkCase[]
  recordedAt?: string
}

export interface Recorder {
  /** Wraps an analyze function so every call is captured. The wrapped function behaves identically. */
  wrap: (analyze: AnalyzeFn) => AnalyzeFn
  recording: () => Recording
}

/**
 * Captures the outputs of an analyze function. Used by the live benchmark; the
 * recorder itself makes no calls.
 */
export function createRecorder(meta: RecordingMeta, now: () => number = Date.now): Recorder {
  const sources = new Map(meta.cases.map((benchmarkCase) => [benchmarkCase.id, benchmarkCase.source]))
  const entries: RecordingEntry[] = []

  const wrap = (analyze: AnalyzeFn): AnalyzeFn => async (input) => {
    const started = now()
    let usage: NormalizedUsage | undefined
    const observed = { ...input, onUsage: (reported: NormalizedUsage) => { usage = reported; input.onUsage(reported) } }
    const recordable = RECORDABLE_SOURCES.includes(sources.get(input.caseId) as BenchmarkCase['source'])
    try {
      const output: RawOpenAIAnalysisResult = await analyze(observed)
      entries.push(recordable
        ? { case_id: input.caseId, run: input.run, outcome: 'returned', output, latency_ms: now() - started, usage }
        : { case_id: input.caseId, run: input.run, outcome: 'withheld', latency_ms: now() - started, usage })
      return output
    } catch (error) {
      const code = (error as { code?: unknown })?.code
      entries.push({
        case_id: input.caseId,
        run: input.run,
        outcome: 'error',
        error_code: typeof code === 'string' && /^[a-z_]{1,40}$/.test(code) ? code : 'unexpected',
        latency_ms: now() - started,
        usage,
      })
      throw error
    }
  }

  return {
    wrap,
    recording: () => recordingSchema.parse({
      format: RECORDING_FORMAT,
      provenance: 'model',
      model: meta.options.model,
      reasoning_effort: meta.options.reasoningEffort,
      max_output_tokens: meta.options.maxOutputTokens,
      prompt_version: meta.promptVersion,
      schema_version: meta.schemaVersion,
      dataset_fingerprint: datasetFingerprint(meta.cases),
      recorded_at: meta.recordedAt,
      entries: [...entries].sort((a, b) => a.case_id.localeCompare(b.case_id) || a.run - b.run),
    }),
  }
}
