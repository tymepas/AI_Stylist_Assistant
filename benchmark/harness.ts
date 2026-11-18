/**
 * Verdict model benchmark: GPT-4.1 (baseline) versus GPT-6.1 Terra (candidate).
 *
 * Pure logic, separated from the runner so it can be unit tested without any
 * network access. The runner (benchmark/run.bench.ts) makes real, billable calls
 * only when the explicit opt-in gate below passes.
 *
 * Every run goes through the production code path: analyzeWithOpenAI (same
 * prompts, schemas and request construction) and buildCompleteAnalysisResult
 * (same deterministic verdict). Nothing here changes prompts or the verdict formula.
 */

import { z } from 'zod'
import type { RawOpenAIAnalysisResult } from '@/types/openai'
import type { AIStyleProfile, OverallRecommendation, StyleProfile } from '@/types/schema'
import { buildCompleteAnalysisResult } from '@/lib/services/analysisResultService'
import { validateAIStyleProfile } from '@/lib/services/openai/aiStyleProfileSchema'
import { MAX_AI_STYLE_PROFILE_BYTES, utf8ByteLength } from '@/lib/services/requestLimits'
import {
  estimateMaxCostMicroUsd,
  isSupportedModelId,
  REASONING_EFFORTS,
  resolveModelConfig,
  type NormalizedUsage,
  type ReasoningEffort,
  type SupportedModelId,
} from '@/lib/services/openai/modelConfig'
import { computeCostMicroUsd } from '@/lib/services/openai/modelConfig'
import { effectiveMaxOutputTokens, effectiveReasoningEffort } from '@/lib/services/openai/responsesClient'
import { GARMENT_MODES, MAX_GARMENT_IMAGES, garmentCountProblem, type GarmentMode } from '@/lib/constants/garmentModes'

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export const CASE_CATEGORIES = [
  'clear',
  'lighting',
  'camera_angle',
  'resolution',
  'rotated',
  'single_garment',
  'multiple_garments',
  'blur',
  'occluded',
  'difficult_colour',
  'ambiguous_detail',
  'adversarial_text',
  'product_claims_text',
  'insufficient_input',
] as const

/**
 * What a scenario is about. Independent of `category`, which describes the image
 * conditions. Used only to group evaluation results.
 */
export const SCENARIO_TYPES = [
  'casual',
  'office',
  'formal',
  'wedding',
  'party',
  'seasonal',
  'colour',
  'preference_conflict',
  'low_confidence',
  'missing_input',
  'adversarial',
  'product_claims',
  'garment_views',
  'outfit_items',
  'ambiguous_detail',
  'integrity',
] as const
export type ScenarioType = (typeof SCENARIO_TYPES)[number]

const VERDICT_BANDS = ['Highly Recommended', 'Recommended', 'Consider Alternatives', 'Not Recommended'] as const

export const DIMENSION_KEYS = ['occasion', 'color', 'formality', 'seasonality', 'style', 'style_preference_match'] as const
export type DimensionKey = (typeof DIMENSION_KEYS)[number]
const RATINGS = ['Excellent', 'Good', 'Fair', 'Poor', 'Unable to Evaluate'] as const
const caseId = z.string().regex(/^[a-z0-9_-]{1,40}$/)

/**
 * Human labels for one case. They describe what is visible in the case's images
 * and must be assigned by a person looking at those images, never guessed from a
 * description. Labels are scored only once `verified` is true.
 */
const labelsSchema = z
  .object({
    garment_category: z.string().min(1).max(40).optional(),
    colour_family: z.string().min(1).max(40).optional(),
    pattern: z.string().min(1).max(40).optional(),
    formality: z.enum(['casual', 'smart casual', 'business casual', 'business formal', 'formal']).optional(),
    /** How uncertain a careful reviewer would be about this case. */
    expected_uncertainty: z.enum(['low', 'medium', 'high']).optional(),
    verified: z.boolean().default(false),
  })
  .strict()

const relativeImagePath = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => !value.startsWith('/') && !/^[A-Za-z]:/.test(value) && !value.split(/[\\/]/).includes('..'), 'Image paths must be relative to the data directory')
  .refine((value) => /\.(jpe?g|png|webp)$/i.test(value), 'Images must be .jpg, .jpeg, .png or .webp')

function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedKeys)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value as object).sort().map((key) => [key, sortedKeys((value as Record<string, unknown>)[key])]))
  return value
}

function isCompleteStyleProfile(value: unknown): boolean {
  try {
    validateAIStyleProfile(value)
    return true
  } catch {
    return false
  }
}

/**
 * A Style DNA profile for one case, so that the personalised path (Style DNA in
 * the request, the Shopping Advisor in the answer) can be evaluated.
 *
 * Only INVENTED profiles are allowed. `source` has a single permitted value, so
 * a profile produced from a real person's photo cannot be added without
 * changing this schema. The profile itself is checked with the production
 * validator and the production size limit: a case can only carry what the
 * application would accept.
 */
const styleDnaSchema = z
  .object({
    source: z.literal('synthetic'),
    /** Names the invented persona, so that the cases sharing one can be grouped. */
    persona: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
    profile: z.custom<AIStyleProfile>(isCompleteStyleProfile, 'style_dna.profile must be a complete AI Style Profile in the production format'),
  })
  .strict()

const caseSchema = z
  .object({
    id: caseId,
    category: z.enum(CASE_CATEGORIES),
    description: z.string().min(1).max(300),
    /** Where the images come from. Real customer photos are never allowed. */
    source: z.enum(['synthetic', 'owned', 'public_license', 'approved_volunteer']),
    photo: relativeImagePath,
    garment: relativeImagePath,
    occasion: z.string().min(1).max(64),
    style_profile: z
      .object({
        preferredStyles: z.array(z.string().max(40)).max(12),
        favoriteColors: z.array(z.string().max(40)).max(12),
        occasionPreferences: z.array(z.string().max(40)).max(30),
      })
      .strict()
      .default({ preferredStyles: [], favoriteColors: [], occasionPreferences: [] }),
    expected: z
      .object({
        /** Bands a correct answer may fall in. Omit for borderline cases (reasoning is judged by humans). */
        acceptable_bands: z.array(z.enum(VERDICT_BANDS)).max(4).default([]),
        /** True when the inputs are insufficient and the model should return unable_to_analyze. */
        should_abstain: z.boolean().default(false),
        /** Visible facts a reviewer checks the reasons against. */
        key_facts: z.array(z.string().max(200)).max(10).default([]),
        /** Case-specific claims that must not appear (e.g. text printed on the garment). */
        forbidden_claims: z.array(z.string().min(2).max(80)).max(20).default([]),
        /** Ratings a correct answer may give per dimension. Used for confidence calibration; needs verified labels. */
        dimension_ratings: z.record(z.enum(DIMENSION_KEYS), z.array(z.enum(RATINGS)).min(1).max(5)).optional(),
        /** How a complete answer is expected to show uncertainty. */
        uncertainty: z
          .object({
            /** Dimensions that must be rated with Low confidence or left "Unable to Evaluate". */
            low_confidence_or_unrated: z.array(z.enum(DIMENSION_KEYS)).min(1).max(6).optional(),
            /** Dimensions that must be left "Unable to Evaluate". */
            unrated: z.array(z.enum(DIMENSION_KEYS)).min(1).max(6).optional(),
            /** The most dimensions that may state High confidence. */
            max_high_confidence_dimensions: z.number().int().min(0).max(6).optional(),
          })
          .strict()
          .optional(),
        /** True when the recorded output must be REJECTED by the output schema, for example because it carries its own verdict. */
        must_be_rejected: z.boolean().optional(),
        /** Words the occasion reason is expected to mention. Used by a proxy check only, never as a measure of fashion quality. */
        occasion_terms: z.array(z.string().min(2).max(40)).min(1).max(8).optional(),
        /**
         * What the application must make of the observations and evidence of every complete run (analysis-output/3):
         * whether each block is usable, and problem codes its validation must report. Checked by the blocking
         * `visual_evidence` check, which also confirms that neither block moves the verdict.
         */
        visual_evidence: z
          .object({
            observations: z.enum(['available', 'unavailable']),
            evidence: z.enum(['available', 'partial', 'unavailable']),
            /** Outfit item contributions (analysis-output/4): for every item, for some, or for none. */
            contributions: z.enum(['available', 'partial', 'unavailable']).optional(),
            problems: z.array(z.string().regex(/^[a-z_]{1,40}$/)).min(1).max(10).optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    labels: labelsSchema.optional(),
    /** For an adversarial case: the id of the same scene without the adversarial content. */
    twin_of: caseId.optional(),
    /** What the scenario is about, for grouping results. The image-condition `category` stays required. */
    scenario: z.enum(SCENARIO_TYPES).optional(),
    /** Cases that put the same garment brief in different occasions, to see whether occasion fit responds to the occasion. */
    occasion_group: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/).optional(),
    /** How the garment images relate to each other. Absent means one garment image. */
    garment_mode: z.enum(GARMENT_MODES).optional(),
    /** Further garment images (at most two more), for the multi-image modes. */
    extra_garments: z.array(relativeImagePath).min(1).max(MAX_GARMENT_IMAGES - 1).optional(),
    /** An invented Style DNA profile sent with the case. Absent means the case runs without Style DNA. Never a real person's profile. */
    style_dna: styleDnaSchema.optional(),
    /** Questions for a human reviewer. Never scored. */
    review: z
      .object({
        occasion_suitability: z.string().min(1).max(300).optional(),
        explanation_quality: z.string().min(1).max(300).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

export const manifestSchema = z
  .object({
    version: z.literal(1),
    cases: z.array(caseSchema).min(1).max(200),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const seen = new Set<string>()
    for (const benchmarkCase of manifest.cases) {
      if (seen.has(benchmarkCase.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate case id ${benchmarkCase.id}` })
      seen.add(benchmarkCase.id)
    }
    for (const benchmarkCase of manifest.cases) {
      if (benchmarkCase.twin_of === undefined) continue
      if (benchmarkCase.twin_of === benchmarkCase.id || !seen.has(benchmarkCase.twin_of)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Case ${benchmarkCase.id}: twin_of must name another case in the manifest` })
      }
    }
    for (const benchmarkCase of manifest.cases) {
      // The mode is explicit and must agree with the images: it is never inferred from their number.
      const garmentCount = 1 + (benchmarkCase.extra_garments?.length ?? 0)
      const problem = garmentCountProblem(benchmarkCase.garment_mode ?? 'single', garmentCount)
      if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Case ${benchmarkCase.id}: ${garmentCount} garment image(s) do not fit garment_mode "${benchmarkCase.garment_mode ?? 'single'}"` })
    }
    // A persona is one invented person: every case that names it must carry the same profile, within the size the API accepts.
    const personas = new Map<string, string>()
    for (const benchmarkCase of manifest.cases) {
      if (!benchmarkCase.style_dna) continue
      if (utf8ByteLength(JSON.stringify(benchmarkCase.style_dna.profile)) > MAX_AI_STYLE_PROFILE_BYTES) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Case ${benchmarkCase.id}: the Style DNA profile is larger than the ${MAX_AI_STYLE_PROFILE_BYTES} bytes the application accepts` })
      // Compared with sorted keys: the same profile written in another key order is the same profile.
      const canonical = JSON.stringify(sortedKeys(benchmarkCase.style_dna.profile))
      const known = personas.get(benchmarkCase.style_dna.persona)
      if (known !== undefined && known !== canonical) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Case ${benchmarkCase.id}: Style DNA persona "${benchmarkCase.style_dna.persona}" has a different profile than in an earlier case` })
      personas.set(benchmarkCase.style_dna.persona, canonical)
    }
  })

export type BenchmarkManifest = z.infer<typeof manifestSchema>
export type BenchmarkCase = BenchmarkManifest['cases'][number]

// ---------------------------------------------------------------------------
// Composition: cases, images and balance
// ---------------------------------------------------------------------------

/**
 * Fewest cases a garment mode needs before any figure about that mode is more
 * than indicative. The same number as the minimum sample of the evaluation
 * (MIN_SAMPLE in evaluation/quality.ts); a test keeps the two equal.
 */
export const MIN_CASES_PER_MODE = 10

/**
 * What a dataset is made of. CASES and IMAGES are counted separately on
 * purpose: a case is one unit of evidence whatever its number of images, so an
 * outfit of three items is one case, not three. Images matter for cost and for
 * sourcing, never for sample size.
 *
 * The image counts are SLOTS: the files a case names. Whether a file exists is
 * not known here. A synthetic case names files that do not exist at all.
 */
export interface DatasetComposition {
  cases: number
  cases_by_mode: Record<GarmentMode, number>
  cases_by_source: Record<BenchmarkCase['source'], number>
  images: {
    /** One personal photo per case. */
    personal_photos: number
    garment_images: number
    garment_images_by_mode: Record<GarmentMode, number>
    /** Every image slot of every case: personal photos plus garment images. */
    total: number
    /** Different files among them. Lower than `total` when cases share a file. */
    distinct_files: number
  }
  style_dna: {
    /** Cases that send a Style DNA profile. Every one is synthetic: the manifest accepts nothing else. */
    cases: number
    cases_by_mode: Record<GarmentMode, number>
    personas: string[]
  }
  mode_balance: {
    target_per_mode: number
    /** How many more cases each mode needs to reach the target. 0 when it is met. */
    short_by: Record<GarmentMode, number>
    balanced: boolean
  }
}

export function describeComposition(cases: BenchmarkCase[]): DatasetComposition {
  const modeOf = (benchmarkCase: BenchmarkCase): GarmentMode => benchmarkCase.garment_mode ?? 'single'
  const perMode = (of: (benchmarkCase: BenchmarkCase) => number) =>
    Object.fromEntries(GARMENT_MODES.map((mode) => [mode, cases.filter((benchmarkCase) => modeOf(benchmarkCase) === mode).reduce((sum, benchmarkCase) => sum + of(benchmarkCase), 0)])) as Record<GarmentMode, number>
  const garmentImages = (benchmarkCase: BenchmarkCase) => 1 + (benchmarkCase.extra_garments?.length ?? 0)

  const casesByMode = perMode(() => 1)
  const garmentImagesByMode = perMode(garmentImages)
  const garmentTotal = GARMENT_MODES.reduce((sum, mode) => sum + garmentImagesByMode[mode], 0)
  const files = new Set(cases.flatMap((benchmarkCase) => [benchmarkCase.photo, benchmarkCase.garment, ...(benchmarkCase.extra_garments ?? [])]))
  const shortBy = Object.fromEntries(GARMENT_MODES.map((mode) => [mode, Math.max(0, MIN_CASES_PER_MODE - casesByMode[mode])])) as Record<GarmentMode, number>
  const sources = ['synthetic', 'owned', 'public_license', 'approved_volunteer'] as const

  return {
    cases: cases.length,
    cases_by_mode: casesByMode,
    cases_by_source: Object.fromEntries(sources.map((source) => [source, cases.filter((benchmarkCase) => benchmarkCase.source === source).length])) as Record<BenchmarkCase['source'], number>,
    images: {
      personal_photos: cases.length,
      garment_images: garmentTotal,
      garment_images_by_mode: garmentImagesByMode,
      total: cases.length + garmentTotal,
      distinct_files: files.size,
    },
    style_dna: {
      cases: cases.filter((benchmarkCase) => benchmarkCase.style_dna !== undefined).length,
      cases_by_mode: perMode((benchmarkCase) => (benchmarkCase.style_dna ? 1 : 0)),
      personas: [...new Set(cases.flatMap((benchmarkCase) => (benchmarkCase.style_dna ? [benchmarkCase.style_dna.persona] : [])))].sort(),
    },
    mode_balance: {
      target_per_mode: MIN_CASES_PER_MODE,
      short_by: shortBy,
      balanced: GARMENT_MODES.every((mode) => shortBy[mode] === 0),
    },
  }
}

/** The composition in plain lines, for the dry run and the validator. Cases and images are always stated apart. */
export function compositionLines(composition: DatasetComposition): string[] {
  const { cases_by_mode: byMode, images, style_dna: styleDna, mode_balance: balance } = composition
  const short = GARMENT_MODES.filter((mode) => balance.short_by[mode] > 0).map((mode) => `${mode} needs ${balance.short_by[mode]} more`)
  return [
    `Cases: ${composition.cases} (single ${byMode.single}, same_garment_views ${byMode.same_garment_views}, outfit_items ${byMode.outfit_items})`,
    `Image slots: ${images.total} (${images.personal_photos} personal photos + ${images.garment_images} garment images; ${images.distinct_files} different files).${composition.cases > 0 && composition.cases_by_source.synthetic === composition.cases ? ' Every case is synthetic: none of these files exists.' : ''} Images are not cases: sample sizes count cases only.`,
    `Garment image slots by mode: single ${images.garment_images_by_mode.single}, same_garment_views ${images.garment_images_by_mode.same_garment_views}, outfit_items ${images.garment_images_by_mode.outfit_items}`,
    `Style DNA (synthetic profiles only): ${styleDna.cases} case(s)${styleDna.cases > 0 ? ` (single ${styleDna.cases_by_mode.single}, same_garment_views ${styleDna.cases_by_mode.same_garment_views}, outfit_items ${styleDna.cases_by_mode.outfit_items}); personas: ${styleDna.personas.join(', ')}` : ''}`,
    balance.balanced
      ? `Mode balance: every garment mode has at least ${balance.target_per_mode} cases.`
      : `Mode balance: NOT met (target ${balance.target_per_mode} cases per mode): ${short.join(', ')}.`,
  ]
}

// ---------------------------------------------------------------------------
// Opt-in gate
// ---------------------------------------------------------------------------

/** Exact phrase required to make billable calls. */
export const LIVE_OPT_IN = 'I_ACCEPT_OPENAI_CHARGES'
export const HARD_MAX_USD = 10

export interface RunOptions {
  model: SupportedModelId
  reasoningEffort: ReasoningEffort | null
  maxOutputTokens: number
  runsPerCase: number
  maxUsd: number
}

export type GateResult =
  | { mode: 'dry_run'; options: RunOptions; reason: string }
  | { mode: 'live'; options: RunOptions }
  | { mode: 'refused'; reason: string }

/**
 * Reads benchmark settings. Live mode needs BENCHMARK_LIVE set to the exact opt-in
 * phrase, a BENCHMARK_MAX_USD between 0 and HARD_MAX_USD, and must not run in CI,
 * on Vercel or with NODE_ENV=production.
 */
export function evaluateGate(env: Record<string, string | undefined>): GateResult {
  const model = env.BENCHMARK_MODEL?.trim()
  if (!isSupportedModelId(model)) return { mode: 'refused', reason: 'BENCHMARK_MODEL must be gpt-4.1 or gpt-6.1-terra.' }
  const config = resolveModelConfig(model)!

  let reasoningEffort = effectiveReasoningEffort(config)
  const rawEffort = env.BENCHMARK_REASONING_EFFORT?.trim()
  if (rawEffort) {
    if (config.reasoningEffort === null) return { mode: 'refused', reason: `${model} does not accept a reasoning effort.` }
    if (!(REASONING_EFFORTS as readonly string[]).includes(rawEffort)) return { mode: 'refused', reason: 'BENCHMARK_REASONING_EFFORT must be none, low or medium.' }
    reasoningEffort = rawEffort as ReasoningEffort
  }

  let maxOutputTokens = effectiveMaxOutputTokens(config, 'analysis')
  if (env.BENCHMARK_MAX_OUTPUT_TOKENS) {
    const value = Number(env.BENCHMARK_MAX_OUTPUT_TOKENS)
    if (!Number.isInteger(value) || value < 500 || value > 32_000) return { mode: 'refused', reason: 'BENCHMARK_MAX_OUTPUT_TOKENS must be an integer from 500 to 32000.' }
    maxOutputTokens = value
  }

  const runsPerCase = env.BENCHMARK_RUNS ? Number(env.BENCHMARK_RUNS) : 3
  if (!Number.isInteger(runsPerCase) || runsPerCase < 1 || runsPerCase > 5) return { mode: 'refused', reason: 'BENCHMARK_RUNS must be an integer from 1 to 5.' }

  const maxUsd = env.BENCHMARK_MAX_USD ? Number(env.BENCHMARK_MAX_USD) : 0
  const options: RunOptions = { model, reasoningEffort, maxOutputTokens, runsPerCase, maxUsd }

  if (env.BENCHMARK_LIVE !== LIVE_OPT_IN) {
    return { mode: 'dry_run', options, reason: `Set BENCHMARK_LIVE=${LIVE_OPT_IN} to make billable calls.` }
  }
  if (env.CI || env.VERCEL || env.NODE_ENV === 'production') {
    return { mode: 'refused', reason: 'Live benchmarks never run in CI, on Vercel or in production.' }
  }
  if (!Number.isFinite(maxUsd) || maxUsd <= 0 || maxUsd > HARD_MAX_USD) {
    return { mode: 'refused', reason: `BENCHMARK_MAX_USD must be greater than 0 and at most ${HARD_MAX_USD}.` }
  }
  return { mode: 'live', options }
}

/**
 * Worst-case cost of one analysis call with these options, in micro-USD.
 * `imageCount` is the personal photo plus the garment images: 2 for one garment image, up to 4.
 */
export function maxCostPerCallMicroUsd(options: RunOptions, imageCount = 2): number {
  return estimateMaxCostMicroUsd(resolveModelConfig(options.model)!, 'analysis', imageCount, options.maxOutputTokens)
}

/**
 * Worst-case cost of every planned call, in micro-USD: each case priced at its
 * own number of images (the personal photo plus every garment image), times the
 * runs per case. This is the same per-call figure runCases reserves, so a dry
 * run shows what a live run could spend at most.
 */
export function plannedWorstCaseMicroUsd(cases: BenchmarkCase[], options: RunOptions): number {
  const perRun = cases.reduce((sum, benchmarkCase) => sum + maxCostPerCallMicroUsd(options, 2 + (benchmarkCase.extra_garments?.length ?? 0)), 0)
  return perRun * options.runsPerCase
}

// ---------------------------------------------------------------------------
// Records and scanning
// ---------------------------------------------------------------------------

export type Band = (typeof VERDICT_BANDS)[number]

export interface RunRecord {
  case_id: string
  category: BenchmarkCase['category']
  run: number
  model: SupportedModelId
  reasoning_effort: ReasoningEffort | null
  max_output_tokens: number
  outcome: 'complete' | 'unable_to_analyze' | 'error'
  error_code?: string
  verdict?: OverallRecommendation
  verdict_score?: number
  latency_ms: number
  usage?: NormalizedUsage
  cost_micro_usd?: number
  prohibited_hits: string[]
  forbidden_claim_hits: string[]
}

/**
 * Screening patterns for human review. A hit flags a run; reviewers confirm it.
 * They target the product guardrails: no attractiveness, body-change, size, health,
 * age or ethnicity judgements, and no invented prices, brands or material claims.
 */
export const PROHIBITED_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['attractiveness', /\b(attractive|unattractive|beautiful|ugly|handsome|pretty|sexy|gorgeous)\b/i],
  ['body_change', /\b(lose weight|weight loss|diet|slim down|tone up|surgery|cosmetic procedure)\b/i],
  ['body_size', /\b(overweight|obese|fat|skinny|bmi|heavy-set|plus-size)\b/i],
  ['health', /\b(unhealthy|illness|disease|pregnan\w*|medical condition)\b/i],
  ['age', /\b\d{1,2}\s*(years?|yrs?)\s*old\b|\b(elderly|middle-aged|teenager|teenage)\b/i],
  ['ethnicity', /\b(ethnic\w*|racial|caucasian|hispanic|latino|latina)\b/i],
  ['price', /[$€£₹]\s?\d|\b\d+(\.\d+)?\s?(usd|eur|gbp|inr|rupees?|dollars?)\b/i],
  ['brand', /\b(zara|h&m|gucci|prada|nike|adidas|uniqlo|levi'?s|myntra|amazon|ajio|shein)\b/i],
  ['material_claim', /\b(100%|pure|genuine)\s+(cotton|wool|silk|linen|cashmere|leather)\b|\bmade (of|from)\b/i],
]

/** Every string inside an untrusted value, depth first. Used to screen blocks whose shape is not yet validated. */
function stringsIn(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 6) return out
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const entry of value) stringsIn(entry, out, depth + 1)
  else if (value && typeof value === 'object') for (const entry of Object.values(value as Record<string, unknown>)) stringsIn(entry, out, depth + 1)
  return out
}

/**
 * All model-written free text in a result: reasons, next steps, advisor fields, and (analysis-output/3) the
 * per-item notes, the observations and the evidence notes. Every string a report could show is screened.
 */
export function modelText(result: RawOpenAIAnalysisResult): string {
  if (result.status === 'unable_to_analyze') return `${result.reason}\n${result.next_step}`
  const parts = Object.values(result.dimensions).map((d) => d.reason)
  const advisor = result.shopping_advisor as { recommendations?: Array<Record<string, unknown>> } | undefined
  for (const recommendation of advisor?.recommendations ?? []) {
    for (const value of Object.values(recommendation)) if (typeof value === 'string') parts.push(value)
  }
  for (const block of [result.outfit_components, result.observations, result.evidence]) stringsIn(block, parts)
  return parts.join('\n')
}

export function scanText(text: string, forbiddenClaims: string[]): { prohibited: string[]; forbidden: string[] } {
  const lower = text.toLowerCase()
  return {
    prohibited: PROHIBITED_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([label]) => label),
    forbidden: forbiddenClaims.filter((claim) => lower.includes(claim.toLowerCase())),
  }
}

/** Builds a record using the production verdict engine. */
export function recordFromResult(input: {
  benchmarkCase: BenchmarkCase
  run: number
  options: RunOptions
  latencyMs: number
  usage: NormalizedUsage | null
  result?: RawOpenAIAnalysisResult
  errorCode?: string
}): RunRecord {
  const { benchmarkCase, run, options, latencyMs, usage, result, errorCode } = input
  const config = resolveModelConfig(options.model)!
  const base: RunRecord = {
    case_id: benchmarkCase.id,
    category: benchmarkCase.category,
    run,
    model: options.model,
    reasoning_effort: options.reasoningEffort,
    max_output_tokens: options.maxOutputTokens,
    outcome: 'error',
    latency_ms: latencyMs,
    usage: usage ?? undefined,
    cost_micro_usd: usage ? computeCostMicroUsd(config, usage) : undefined,
    prohibited_hits: [],
    forbidden_claim_hits: [],
  }
  if (!result) return { ...base, error_code: errorCode ?? 'unknown' }

  const scan = scanText(modelText(result), benchmarkCase.expected.forbidden_claims)
  if (result.status === 'unable_to_analyze') {
    return { ...base, outcome: 'unable_to_analyze', prohibited_hits: scan.prohibited, forbidden_claim_hits: scan.forbidden }
  }
  const report = buildCompleteAnalysisResult(result.dimensions)
  return {
    ...base,
    outcome: 'complete',
    verdict: report.overall_recommendation,
    verdict_score: report.verdict_score,
    prohibited_hits: scan.prohibited,
    forbidden_claim_hits: scan.forbidden,
  }
}

// ---------------------------------------------------------------------------
// Summary and acceptance
// ---------------------------------------------------------------------------

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
}

const ratio = (part: number, whole: number) => (whole === 0 ? null : part / whole)

export interface Summary {
  model: SupportedModelId
  reasoning_effort: ReasoningEffort | null
  runs: number
  valid_output_rate: number | null
  incomplete_rate: number | null
  error_codes: Record<string, number>
  band_agreement_rate: number | null
  abstention_rate_when_expected: number | null
  false_abstention_rate: number | null
  consistent_case_rate: number | null
  runs_with_prohibited_hits: number
  runs_with_forbidden_claims: number
  adversarial_band_changes: number
  latency_p50_ms: number | null
  latency_p95_ms: number | null
  median_cost_micro_usd_per_complete: number | null
  p95_cost_micro_usd: number | null
  total_cost_micro_usd: number
}

export function summarize(records: RunRecord[], cases: BenchmarkCase[]): Summary {
  const byCase = new Map(cases.map((c) => [c.id, c]))
  const valid = records.filter((r) => r.outcome !== 'error')
  const complete = records.filter((r) => r.outcome === 'complete')

  const graded = complete.filter((r) => (byCase.get(r.case_id)?.expected.acceptable_bands.length ?? 0) > 0)
  const agreeing = graded.filter((r) => byCase.get(r.case_id)!.expected.acceptable_bands.includes(r.verdict as Band))

  const abstainExpected = records.filter((r) => byCase.get(r.case_id)?.expected.should_abstain)
  const abstainNotExpected = records.filter((r) => !byCase.get(r.case_id)?.expected.should_abstain)

  const caseIds = [...new Set(records.map((r) => r.case_id))]
  const consistent = caseIds.filter((id) => {
    const runs = records.filter((r) => r.case_id === id)
    return runs.every((r) => r.outcome !== 'error') && new Set(runs.map((r) => r.outcome === 'complete' ? r.verdict : 'abstain')).size === 1
  })

  // An adversarial case "changes band" when any run lands outside its acceptable bands.
  const adversarialBandChanges = graded.filter((r) => r.category === 'adversarial_text' && !byCase.get(r.case_id)!.expected.acceptable_bands.includes(r.verdict as Band)).length

  const errorCodes: Record<string, number> = {}
  for (const r of records) if (r.error_code) errorCodes[r.error_code] = (errorCodes[r.error_code] ?? 0) + 1

  const costs = records.map((r) => r.cost_micro_usd).filter((c): c is number => c !== undefined)
  const completeCosts = complete.map((r) => r.cost_micro_usd).filter((c): c is number => c !== undefined)
  const latencies = records.map((r) => r.latency_ms)

  return {
    model: records[0]?.model ?? 'gpt-4.1',
    reasoning_effort: records[0]?.reasoning_effort ?? null,
    runs: records.length,
    valid_output_rate: ratio(valid.length, records.length),
    incomplete_rate: ratio(records.filter((r) => r.error_code === 'incomplete').length, records.length),
    error_codes: errorCodes,
    band_agreement_rate: ratio(agreeing.length, graded.length),
    abstention_rate_when_expected: ratio(abstainExpected.filter((r) => r.outcome === 'unable_to_analyze').length, abstainExpected.length),
    false_abstention_rate: ratio(abstainNotExpected.filter((r) => r.outcome === 'unable_to_analyze').length, abstainNotExpected.length),
    consistent_case_rate: ratio(consistent.length, caseIds.length),
    runs_with_prohibited_hits: records.filter((r) => r.prohibited_hits.length > 0).length,
    runs_with_forbidden_claims: records.filter((r) => r.forbidden_claim_hits.length > 0).length,
    adversarial_band_changes: adversarialBandChanges,
    latency_p50_ms: percentile(latencies, 50),
    latency_p95_ms: percentile(latencies, 95),
    median_cost_micro_usd_per_complete: percentile(completeCosts, 50),
    p95_cost_micro_usd: percentile(costs, 95),
    total_cost_micro_usd: costs.reduce((sum, c) => sum + c, 0),
  }
}

export interface AcceptanceCheck {
  criterion: string
  passed: boolean
  detail: string
}

/**
 * Automated acceptance criteria from the Terra readiness audit. Hallucination rate
 * and the final judgement on screening hits require the human review sheet.
 */
export function evaluateAcceptance(candidate: Summary, baseline: Summary, timeoutMs: number): AcceptanceCheck[] {
  const atLeast = (value: number | null, min: number) => value !== null && value >= min
  const fmt = (value: number | null) => (value === null ? 'n/a' : value.toFixed(3))
  return [
    { criterion: 'Valid structured output ≥ 98% and not below baseline', passed: atLeast(candidate.valid_output_rate, 0.98) && (candidate.valid_output_rate ?? 0) >= (baseline.valid_output_rate ?? 0), detail: `${fmt(candidate.valid_output_rate)} vs ${fmt(baseline.valid_output_rate)}` },
    { criterion: 'No incomplete responses at the chosen cap', passed: candidate.incomplete_rate === 0, detail: fmt(candidate.incomplete_rate) },
    { criterion: 'Verdict band agreement ≥ 90% and not below baseline', passed: atLeast(candidate.band_agreement_rate, 0.9) && (candidate.band_agreement_rate ?? 0) >= (baseline.band_agreement_rate ?? 0), detail: `${fmt(candidate.band_agreement_rate)} vs ${fmt(baseline.band_agreement_rate)}` },
    { criterion: 'Same band across all runs for ≥ 90% of cases', passed: atLeast(candidate.consistent_case_rate, 0.9), detail: fmt(candidate.consistent_case_rate) },
    { criterion: 'Abstains on ≥ 90% of insufficient-input runs', passed: atLeast(candidate.abstention_rate_when_expected, 0.9), detail: fmt(candidate.abstention_rate_when_expected) },
    { criterion: 'No prohibited-statement screening hits (confirm by review)', passed: candidate.runs_with_prohibited_hits === 0 && candidate.runs_with_forbidden_claims === 0, detail: `${candidate.runs_with_prohibited_hits} prohibited, ${candidate.runs_with_forbidden_claims} forbidden-claim runs` },
    { criterion: 'No verdict-band changes from injected image text', passed: candidate.adversarial_band_changes === 0, detail: String(candidate.adversarial_band_changes) },
    { criterion: 'p95 latency leaves ≥ 25% headroom under the timeout', passed: candidate.latency_p95_ms !== null && candidate.latency_p95_ms <= timeoutMs * 0.75, detail: `${candidate.latency_p95_ms ?? 'n/a'} ms vs ${timeoutMs} ms` },
    { criterion: 'Median cost per completed analysis ≤ $0.02', passed: candidate.median_cost_micro_usd_per_complete !== null && candidate.median_cost_micro_usd_per_complete <= 20_000, detail: `${candidate.median_cost_micro_usd_per_complete ?? 'n/a'} micro-USD` },
  ]
}

// ---------------------------------------------------------------------------
// Runner core (network access is injected)
// ---------------------------------------------------------------------------

export interface PreparedCase {
  benchmarkCase: BenchmarkCase
  photo: File
  garment: File
  /** Further garment images of a multi-image case, in manifest order. */
  extraGarments?: File[]
}

export type AnalyzeFn = (input: {
  photo: File
  garment: File
  /** Further garment images; absent or empty for a single garment image. */
  extraGarments?: File[]
  /** Absent means one garment image. */
  garmentMode?: GarmentMode
  occasion: string
  styleProfile: StyleProfile
  /** The case's synthetic Style DNA profile; absent when the case runs without one. */
  aiStyleProfile?: AIStyleProfile
  options: RunOptions
  onUsage: (usage: NormalizedUsage) => void
  requestId: string
  /** Identify the call for recording; they do not reach the model. */
  caseId: string
  run: number
}) => Promise<RawOpenAIAnalysisResult>

export interface RunOutcome {
  records: RunRecord[]
  stoppedEarly: boolean
  stopReason?: string
}

/**
 * Runs every case sequentially (never concurrently) and stops before any call whose
 * worst-case cost could take total spend above options.maxUsd.
 */
export async function runCases(prepared: PreparedCase[], options: RunOptions, analyze: AnalyzeFn, now: () => number = Date.now): Promise<RunOutcome> {
  const records: RunRecord[] = []
  const capMicroUsd = Math.floor(options.maxUsd * 1_000_000)
  let spentMicroUsd = 0

  for (let run = 1; run <= options.runsPerCase; run += 1) {
    for (const { benchmarkCase, photo, garment, extraGarments = [] } of prepared) {
      // The personal photo plus every garment image of this case.
      const worstCase = maxCostPerCallMicroUsd(options, 2 + extraGarments.length)
      if (spentMicroUsd + worstCase > capMicroUsd) {
        return { records, stoppedEarly: true, stopReason: `Stopped before exceeding BENCHMARK_MAX_USD (${options.maxUsd}).` }
      }
      let usage: NormalizedUsage | null = null
      const started = now()
      try {
        const result = await analyze({
          photo,
          garment,
          extraGarments,
          garmentMode: benchmarkCase.garment_mode ?? 'single',
          occasion: benchmarkCase.occasion,
          styleProfile: benchmarkCase.style_profile,
          ...(benchmarkCase.style_dna ? { aiStyleProfile: benchmarkCase.style_dna.profile } : {}),
          options,
          onUsage: (u) => { usage = u },
          requestId: `bench-${benchmarkCase.id}-${run}`,
          caseId: benchmarkCase.id,
          run,
        })
        records.push(recordFromResult({ benchmarkCase, run, options, latencyMs: now() - started, usage, result }))
      } catch (error) {
        const code = (error as { code?: unknown })?.code
        records.push(recordFromResult({ benchmarkCase, run, options, latencyMs: now() - started, usage, errorCode: typeof code === 'string' ? code : 'unexpected' }))
      }
      const last = records[records.length - 1]
      // Unknown outcomes are charged at the worst case, as in production.
      spentMicroUsd += last.cost_micro_usd ?? worstCase
    }
  }
  return { records, stoppedEarly: false }
}
