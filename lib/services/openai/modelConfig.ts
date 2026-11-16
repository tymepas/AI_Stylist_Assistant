/**
 * Model-specific configuration for OpenAI Responses API calls.
 *
 * Only models listed here can be used. Each model carries its own reasoning
 * setting, output caps, timeouts, pricing and the token bounds used to reserve
 * spend before a call. GPT-4.1 values reproduce the pre-existing behaviour exactly.
 *
 * Pricing and limits come from the official model pages (developers.openai.com)
 * as checked on 2026-11-16. Re-check them before changing a model.
 */

export const SUPPORTED_MODEL_IDS = ['gpt-4.1', 'gpt-6.1-terra'] as const
export type SupportedModelId = (typeof SUPPORTED_MODEL_IDS)[number]

export type OpenAIOperation = 'analysis' | 'profile'
export type ReasoningEffort = 'none' | 'low' | 'medium'
export const REASONING_EFFORTS: readonly ReasoningEffort[] = ['none', 'low', 'medium']

export interface OperationLimits {
  /** Hard cap on generated tokens. For reasoning models this INCLUDES reasoning tokens. */
  maxOutputTokens: number
  /** Client-side abort for the OpenAI call. Must stay below the route's maxDuration. */
  timeoutMs: number
  /**
   * Upper bound on text input tokens (instructions + user context + labels).
   * Derived from byte length, which is a safe bound for byte-level BPE tokenizers
   * (every token covers at least one byte). Enforced by tests/spend/costBounds.test.ts.
   */
  maxTextInputTokens: number
}

export interface ModelPricing {
  inputUsdPerMTok: number
  cachedInputUsdPerMTok: number
  outputUsdPerMTok: number
}

export interface ModelConfig {
  id: SupportedModelId
  /** null means the model does not accept a `reasoning` parameter, so none is sent. */
  reasoningEffort: ReasoningEffort | null
  operations: Record<OpenAIOperation, OperationLimits>
  /** Upper bound on input tokens billed for one image at detail "high". */
  maxImageInputTokens: number
  pricing: ModelPricing
}

const MODEL_CONFIGS: Record<SupportedModelId, ModelConfig> = {
  'gpt-4.1': {
    id: 'gpt-4.1',
    reasoningEffort: null,
    operations: {
      analysis: { maxOutputTokens: 1_500, timeoutMs: 20_000, maxTextInputTokens: 8_000 },
      profile: { maxOutputTokens: 2_000, timeoutMs: 30_000, maxTextInputTokens: 12_000 },
    },
    // Documented tile formula: fit 2048×2048, shortest side 768 → at most 2×4 tiles → 85 + 8×170.
    maxImageInputTokens: 1_445,
    pricing: { inputUsdPerMTok: 2, cachedInputUsdPerMTok: 0.5, outputUsdPerMTok: 8 },
  },
  'gpt-6.1-terra': {
    id: 'gpt-6.1-terra',
    // Explicit, never the provider default (medium). 'low' is a conservative starting
    // point; the benchmark decides between none, low and medium.
    reasoningEffort: 'low',
    operations: {
      // Reasoning tokens share this cap. 4,000 leaves ~3,000 for reasoning above the
      // ~600–900 visible tokens, while keeping the worst-case reservation near $0.04.
      analysis: { maxOutputTokens: 4_000, timeoutMs: 45_000, maxTextInputTokens: 8_000 },
      profile: { maxOutputTokens: 4_000, timeoutMs: 45_000, maxTextInputTokens: 12_000 },
    },
    // ASSUMPTION: the vision guide does not list gpt-6.1-terra. The documented GPT-6
    // patch rule at detail "high" caps an image at 2,500 patches × 1.2 = 3,000 tokens.
    // A 20% margin is added until the benchmark measures Terra directly.
    maxImageInputTokens: 3_600,
    pricing: { inputUsdPerMTok: 1, cachedInputUsdPerMTok: 0.05, outputUsdPerMTok: 5 },
  },
}

export function isSupportedModelId(value: unknown): value is SupportedModelId {
  return typeof value === 'string' && (SUPPORTED_MODEL_IDS as readonly string[]).includes(value)
}

/** Returns the configuration for an allowlisted model id, or null for anything else. */
export function resolveModelConfig(modelId: string | undefined | null): ModelConfig | null {
  const trimmed = modelId?.trim()
  return isSupportedModelId(trimmed) ? MODEL_CONFIGS[trimmed] : null
}

// ---------------------------------------------------------------------------
// Usage and cost
// ---------------------------------------------------------------------------

export interface NormalizedUsage {
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cached_tokens: number
  reasoning_tokens: number
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined
}

/** Parses a Responses API `usage` object defensively. Returns null when unusable. */
export function normalizeUsage(raw: unknown): NormalizedUsage | null {
  if (!raw || typeof raw !== 'object') return null
  const usage = raw as Record<string, unknown>
  const input = count(usage.input_tokens)
  const output = count(usage.output_tokens)
  if (input === undefined || output === undefined) return null
  const inputDetails = (usage.input_tokens_details ?? {}) as Record<string, unknown>
  const outputDetails = (usage.output_tokens_details ?? {}) as Record<string, unknown>
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: count(usage.total_tokens) ?? input + output,
    cached_tokens: Math.min(count(inputDetails.cached_tokens) ?? 0, input),
    reasoning_tokens: Math.min(count(outputDetails.reasoning_tokens) ?? 0, output),
  }
}

/**
 * Actual cost in integer micro-USD, rounded up. Reasoning tokens are already part of
 * output_tokens and are billed as output.
 */
export function computeCostMicroUsd(config: ModelConfig, usage: NormalizedUsage): number {
  const { inputUsdPerMTok, cachedInputUsdPerMTok, outputUsdPerMTok } = config.pricing
  const uncachedInput = usage.input_tokens - usage.cached_tokens
  // USD per 1M tokens equals micro-USD per token.
  return Math.ceil(uncachedInput * inputUsdPerMTok + usage.cached_tokens * cachedInputUsdPerMTok + usage.output_tokens * outputUsdPerMTok)
}

/**
 * Worst-case cost of one call, used to reserve budget BEFORE the call.
 * Assumes no caching, the text-input bound, the per-image bound and the full output cap.
 */
export function estimateMaxCostMicroUsd(
  config: ModelConfig,
  operation: OpenAIOperation,
  imageCount: number,
  maxOutputTokensOverride?: number
): number {
  const limits = config.operations[operation]
  const inputTokens = limits.maxTextInputTokens + imageCount * config.maxImageInputTokens
  const outputTokens = maxOutputTokensOverride ?? limits.maxOutputTokens
  return Math.ceil(inputTokens * config.pricing.inputUsdPerMTok + outputTokens * config.pricing.outputUsdPerMTok)
}
