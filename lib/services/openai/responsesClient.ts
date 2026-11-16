import 'server-only'

/**
 * Single place that calls the OpenAI Responses API.
 *
 * Applies the model configuration (allowlisted model, explicit reasoning effort,
 * output cap, timeout), parses usage including cached and reasoning tokens, and
 * logs only safe structured events. It never retries: every attempt is billable.
 */

import { logEvent, summarizeValidationIssues, type SafeLogFields } from '@/lib/observability/safeLogger'
import { OpenAIAnalysisError } from './openAIErrors'
import {
  computeCostMicroUsd,
  normalizeUsage,
  type ModelConfig,
  type NormalizedUsage,
  type OpenAIOperation,
  type ReasoningEffort,
} from './modelConfig'

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'

export type InputContentPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string; detail: 'high' }

/** Benchmark-only overrides. The API route never passes these. */
export interface RunOverrides {
  reasoningEffort?: ReasoningEffort | null
  maxOutputTokens?: number
}

interface ResponseBody {
  status?: string
  incomplete_details?: { reason?: string } | null
  output_text?: string
  output?: Array<{
    type?: string
    content?: Array<{
      type?: string
      text?: string
    }>
  }>
  usage?: unknown
}

export interface ResponsesCallInput<T> {
  operation: OpenAIOperation
  apiKey: string
  modelConfig: ModelConfig
  instructions: string
  content: InputContentPart[]
  /** Throws when the parsed model output does not match the expected schema. */
  validate: (parsed: unknown) => T
  /** Safe enum describing a successful result (e.g. its status), for logs. */
  outcomeOf: (result: T) => string
  requestId?: string
  overrides?: RunOverrides
  /** Called once when the provider reports usage, on success or failure. */
  onUsage?: (usage: NormalizedUsage) => void
}

/** The reasoning effort actually sent; null means no `reasoning` parameter at all. */
export function effectiveReasoningEffort(config: ModelConfig, overrides?: RunOverrides): ReasoningEffort | null {
  // A model without reasoning support never receives the parameter, whatever the override says.
  if (config.reasoningEffort === null) return null
  return overrides?.reasoningEffort !== undefined ? overrides.reasoningEffort : config.reasoningEffort
}

export function effectiveMaxOutputTokens(config: ModelConfig, operation: OpenAIOperation, overrides?: RunOverrides): number {
  return overrides?.maxOutputTokens ?? config.operations[operation].maxOutputTokens
}

export function buildRequestBody(
  config: ModelConfig,
  operation: OpenAIOperation,
  instructions: string,
  content: InputContentPart[],
  overrides?: RunOverrides
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: config.id,
    instructions,
    input: [{ role: 'user', content }],
    text: { format: { type: 'json_object' } },
    max_output_tokens: effectiveMaxOutputTokens(config, operation, overrides),
    store: false,
  }
  const effort = effectiveReasoningEffort(config, overrides)
  if (effort !== null) body.reasoning = { effort }
  return body
}

function extractOutputText(response: ResponseBody): string | null {
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text
  }
  // Reasoning items carry no `content`, so only message output_text parts are found here.
  const outputText = response.output
    ?.flatMap((item) => item.content ?? [])
    .find((content) => content.type === 'output_text' && typeof content.text === 'string')
    ?.text
  return outputText?.trim() ? outputText : null
}

function usageLogFields(config: ModelConfig, usage: NormalizedUsage | null): SafeLogFields {
  if (!usage) return {}
  return {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    total_tokens: usage.total_tokens,
    cached_tokens: usage.cached_tokens,
    reasoning_tokens: usage.reasoning_tokens,
    cost_micro_usd: computeCostMicroUsd(config, usage),
  }
}

export async function callResponsesApi<T>(input: ResponsesCallInput<T>): Promise<T> {
  const { operation, modelConfig, overrides } = input
  const label = operation === 'analysis' ? 'analysis' : 'profile generation'
  const effort = effectiveReasoningEffort(modelConfig, overrides)
  const logBase: SafeLogFields = {
    request_id: input.requestId,
    operation,
    model: modelConfig.id,
    reasoning_effort: effort ?? undefined,
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), modelConfig.operations[operation].timeoutMs)
  const startedAt = Date.now()
  let usage: NormalizedUsage | null = null

  const logFailed = (error: OpenAIAnalysisError) => {
    logEvent('error', 'openai_request_failed', {
      ...logBase,
      duration_ms: Date.now() - startedAt,
      error_code: error.code,
      http_status: error.status,
      ...usageLogFields(modelConfig, usage),
    })
  }

  logEvent('debug', 'openai_request_started', logBase)

  try {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildRequestBody(modelConfig, operation, input.instructions, input.content, overrides)),
      signal: controller.signal,
    })

    if (!response.ok) {
      // The provider's error body is never read or logged: it can echo request data.
      throw new OpenAIAnalysisError(
        response.status === 429 ? 'rate_limit' : 'api_error',
        response.status === 429
          ? `The ${label} service is temporarily rate limited.`
          : `The ${label} service returned an error.`,
        response.status
      )
    }

    let body: ResponseBody
    try {
      body = (await response.json()) as ResponseBody
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      throw new OpenAIAnalysisError('invalid_response', `The ${label} service returned invalid JSON.`)
    }

    usage = normalizeUsage(body.usage)
    if (usage) {
      try {
        input.onUsage?.(usage)
      } catch {
        // A usage observer must never change the request outcome.
      }
    }

    if (body.status && body.status !== 'completed') {
      // Status and reason are OpenAI enum values (e.g. incomplete:max_output_tokens), never content.
      const reason = body.incomplete_details?.reason
      logEvent('warn', 'openai_response_not_completed', {
        ...logBase,
        outcome: reason ? `${body.status}:${reason}` : body.status,
      })
      throw new OpenAIAnalysisError(
        body.status === 'incomplete' ? 'incomplete' : 'invalid_response',
        `The ${label} service did not complete the response.`
      )
    }

    const outputText = extractOutputText(body)
    if (!outputText) {
      throw new OpenAIAnalysisError('invalid_response', `The ${label} service returned no output.`)
    }

    let parsedOutput: unknown
    try {
      parsedOutput = JSON.parse(outputText)
    } catch {
      throw new OpenAIAnalysisError('invalid_response', 'The model response was not valid JSON.')
    }

    let result: T
    try {
      result = input.validate(parsedOutput)
    } catch (validationError) {
      // Schema paths only. Issue messages and received values can echo model output,
      // which may describe the person in the photo.
      logEvent('warn', 'openai_output_schema_invalid', {
        ...logBase,
        ...summarizeValidationIssues(validationError),
      })
      throw new OpenAIAnalysisError('invalid_response', `The model response did not match the required ${label} schema.`)
    }

    logEvent('info', 'openai_request_completed', {
      ...logBase,
      duration_ms: Date.now() - startedAt,
      outcome: input.outcomeOf(result),
      ...usageLogFields(modelConfig, usage),
    })
    return result
  } catch (error) {
    if (error instanceof OpenAIAnalysisError) {
      logFailed(error)
      throw error
    }
    if (error instanceof Error && error.name === 'AbortError') {
      const timeoutError = new OpenAIAnalysisError('timeout', `The ${label} request timed out.`)
      logFailed(timeoutError)
      throw timeoutError
    }
    const apiError = new OpenAIAnalysisError('api_error', `The ${label} service could not be reached.`)
    logFailed(apiError)
    throw apiError
  } finally {
    clearTimeout(timeout)
  }
}
