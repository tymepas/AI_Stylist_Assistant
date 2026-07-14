import 'server-only'

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { AIStyleProfile, AIStyleProfileFailure } from '@/types/schema'
import { validateAIStyleProfileResult } from '@/lib/services/openai/aiStyleProfileSchema'
import { OpenAIAnalysisError } from '@/lib/services/openai/openAIAnalysisService'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
/**
 * Profile generation is more thorough than outfit analysis — allow 30 seconds.
 * Spec: specs/phase3/06_API_SPECIFICATION.md § "AI Call — Timeout: 30 seconds"
 */
const OPENAI_PROFILE_TIMEOUT_MS = 30_000

// ---------------------------------------------------------------------------
// System prompt loader (cached after first read, same pattern as analysis)
// ---------------------------------------------------------------------------

let profilePromptPromise: Promise<string> | undefined

function loadProfileSystemPrompt(): Promise<string> {
  if (!profilePromptPromise) {
    const promptPath = path.join(process.cwd(), 'memory', 'STYLE_PROFILE_SYSTEM_PROMPT.md')
    profilePromptPromise = readFile(promptPath, 'utf8')
  }
  return profilePromptPromise
}

// ---------------------------------------------------------------------------
// Internal utilities (mirrors openAIAnalysisService.ts patterns)
// ---------------------------------------------------------------------------

interface OpenAIUsage {
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
}

interface OpenAIResponseBody {
  status?: string
  output_text?: string
  output?: Array<{
    type?: string
    content?: Array<{
      type?: string
      text?: string
    }>
  }>
  usage?: OpenAIUsage
}

async function fileToDataUrl(file: File): Promise<string> {
  const bytes = Buffer.from(await file.arrayBuffer())
  return `data:${file.type};base64,${bytes.toString('base64')}`
}

function extractOutputText(response: OpenAIResponseBody): string | null {
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text
  }
  const outputText = response.output
    ?.flatMap((item) => item.content ?? [])
    .find((content) => content.type === 'output_text' && typeof content.text === 'string')
    ?.text
  return outputText?.trim() ? outputText : null
}

function logStarted(model: string): void {
  if (process.env.NODE_ENV !== 'production') {
    console.info('[OpenAI profile] request started', { model })
  }
}

function logCompleted(model: string, startedAt: number, usage?: OpenAIUsage): void {
  if (process.env.NODE_ENV !== 'production') {
    console.info('[OpenAI profile] request completed', {
      model,
      duration_ms: Date.now() - startedAt,
      usage: usage
        ? {
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
            total_tokens: usage.total_tokens,
          }
        : undefined,
    })
  }
}

function logFailed(model: string, startedAt: number, error: OpenAIAnalysisError): void {
  if (process.env.NODE_ENV !== 'production') {
    console.error('[OpenAI profile] request failed', {
      model,
      duration_ms: Date.now() - startedAt,
      code: error.code,
      status: error.status,
    })
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GenerateProfileWithOpenAIInput {
  photo: File
}

/**
 * Calls the OpenAI Responses API with a single user photo to generate an
 * AI Style Profile. Returns either a complete AIStyleProfile or an
 * AIStyleProfileFailure when the photo cannot be analyzed.
 *
 * Throws OpenAIAnalysisError for all infrastructure-level failures.
 * Schema validation failures are logged and surfaced as AIStyleProfileFailure.
 */
export async function generateProfileWithOpenAI(
  input: GenerateProfileWithOpenAIInput
): Promise<AIStyleProfile | AIStyleProfileFailure> {
  const { photo } = input

  const apiKey = process.env.OPENAI_API_KEY
  const model = process.env.OPENAI_MODEL

  if (!apiKey || !model) {
    throw new OpenAIAnalysisError(
      'configuration_error',
      'OpenAI profile generation is not configured.'
    )
  }

  let instructions: string
  try {
    instructions = await loadProfileSystemPrompt()
  } catch {
    throw new OpenAIAnalysisError(
      'configuration_error',
      'The style profile system prompt could not be loaded.'
    )
  }

  let photoDataUrl: string
  try {
    photoDataUrl = await fileToDataUrl(photo)
  } catch {
    throw new OpenAIAnalysisError('api_error', 'The uploaded photo could not be prepared.')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), OPENAI_PROFILE_TIMEOUT_MS)
  const startedAt = Date.now()
  logStarted(model)

  try {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        instructions,
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: 'Analyze the person in this photo and return only the JSON object described in your instructions. Set generated_at_utc to "".',
              },
              {
                type: 'input_image',
                image_url: photoDataUrl,
                detail: 'high',
              },
            ],
          },
        ],
        text: { format: { type: 'json_object' } },
        // Profile generation is more thorough than analysis; allow more tokens
        max_output_tokens: 2_000,
        store: false,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new OpenAIAnalysisError(
        response.status === 429 ? 'rate_limit' : 'api_error',
        response.status === 429
          ? 'The profile generation service is temporarily rate limited.'
          : 'The profile generation service returned an error.',
        response.status
      )
    }

    let responseBody: OpenAIResponseBody
    try {
      responseBody = (await response.json()) as OpenAIResponseBody
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      throw new OpenAIAnalysisError(
        'invalid_response',
        'The profile generation service returned invalid JSON.'
      )
    }

    if (responseBody.status && responseBody.status !== 'completed') {
      throw new OpenAIAnalysisError(
        'invalid_response',
        'The profile generation service did not complete the response.'
      )
    }

    const outputText = extractOutputText(responseBody)
    if (!outputText) {
      throw new OpenAIAnalysisError(
        'invalid_response',
        'The profile generation service returned no output.'
      )
    }

    let parsedOutput: unknown
    try {
      parsedOutput = JSON.parse(outputText)
    } catch {
      throw new OpenAIAnalysisError(
        'invalid_response',
        'The model response was not valid JSON.'
      )
    }

    // Validate against the full result schema (complete | unable_to_generate)
    try {
      const result = validateAIStyleProfileResult(parsedOutput)
      logCompleted(model, startedAt, responseBody.usage)
      return result
    } catch {
      // Schema validation failure — log raw output and surface as a generation failure
      // Never return raw AI output to the client (spec: 10_ERROR_HANDLING.md § FG-10)
      console.error(
        '[OpenAI profile] schema validation failed — raw AI output:',
        outputText.slice(0, 500) // truncate to avoid logging large payloads
      )
      throw new OpenAIAnalysisError(
        'invalid_response',
        'The model response did not match the required profile schema.'
      )
    }
  } catch (error) {
    if (error instanceof OpenAIAnalysisError) {
      logFailed(model, startedAt, error)
      throw error
    }
    if (error instanceof Error && error.name === 'AbortError') {
      const timeoutError = new OpenAIAnalysisError(
        'timeout',
        'The profile generation request timed out.'
      )
      logFailed(model, startedAt, timeoutError)
      throw timeoutError
    }
    const apiError = new OpenAIAnalysisError(
      'api_error',
      'The profile generation service could not be reached.'
    )
    logFailed(model, startedAt, apiError)
    throw apiError
  } finally {
    clearTimeout(timeout)
  }
}
