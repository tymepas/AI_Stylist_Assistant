import 'server-only'

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { StyleProfile, AIStyleProfile } from '@/types/schema'
import type { RawOpenAIAnalysisResult } from '@/types/openai'
import { validateRawOpenAIAnalysis } from './openAIAnalysisSchema'

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const OPENAI_TIMEOUT_MS = 20_000

export type OpenAIAnalysisErrorCode =
  | 'configuration_error'
  | 'timeout'
  | 'rate_limit'
  | 'api_error'
  | 'invalid_response'

export class OpenAIAnalysisError extends Error {
  constructor(
    public readonly code: OpenAIAnalysisErrorCode,
    message: string,
    public readonly status?: number
  ) {
    super(message)
    this.name = 'OpenAIAnalysisError'
  }
}

interface AnalyzeWithOpenAIInput {
  photo: File
  garment: File
  occasion: string
  styleProfile: StyleProfile
  /** Phase 3 — optional AI-generated style profile for richer context injection. */
  aiStyleProfile?: AIStyleProfile
}

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

let systemPromptPromise: Promise<string> | undefined

function loadSystemPrompt(): Promise<string> {
  if (!systemPromptPromise) {
    const promptPath = path.join(process.cwd(), 'memory', 'SYSTEM_PROMPT.md')
    systemPromptPromise = readFile(promptPath, 'utf8')
  }
  return systemPromptPromise
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

/**
 * Builds the user-facing context string injected into the outfit analysis prompt.
 *
 * Phase 3 extension: when an AI Style Profile is present, coloring, aesthetic,
 * and proportions data are included as labeled context so the AI can use them
 * to improve the color and style_preference_match dimensions without being asked
 * to reference them explicitly in its output text.
 * Spec: specs/phase3/07_AI_ANALYSIS_SPEC.md § "Additional Context Provided to the AI"
 */
function buildUserContext(
  occasion: string,
  styleProfile: StyleProfile,
  aiStyleProfile?: AIStyleProfile
): string {
  const lines = [
    'Analyze the person image and garment image together for the supplied context.',
    `Selected occasion: ${occasion}`,
    `Complete style profile: ${JSON.stringify(styleProfile)}`,
  ]

  if (aiStyleProfile) {
    // Coloring context — improves color dimension (spec § "Coloring context")
    const c = aiStyleProfile.coloring
    const coloringParts: string[] = []
    if (c.skin_tone_depth) coloringParts.push(`skin tone depth: ${c.skin_tone_depth}`)
    if (c.skin_tone_undertone) coloringParts.push(`undertone: ${c.skin_tone_undertone}`)
    if (c.hair_color) coloringParts.push(`hair: ${c.hair_color}`)
    if (c.high_contrast !== null) coloringParts.push(`high contrast coloring: ${c.high_contrast}`)
    if (coloringParts.length > 0) {
      lines.push(`AI-analyzed coloring context (use for color harmony assessment): ${coloringParts.join(', ')}.`)
    }

    // Aesthetic context — improves style_preference_match dimension (spec § "Aesthetic context")
    const a = aiStyleProfile.aesthetic_signals
    const aestheticParts: string[] = []
    if (aiStyleProfile.style_keywords.length > 0) {
      aestheticParts.push(`observed style: ${aiStyleProfile.style_keywords.map((k) => k.keyword).join(', ')}`)
    }
    if (a.current_outfit_formality) {
      aestheticParts.push(`typical formality level: ${a.current_outfit_formality}`)
    }
    if (aestheticParts.length > 0) {
      lines.push(`AI-analyzed aesthetic context (use for style preference match assessment): ${aestheticParts.join(', ')}.`)
    }

    // Proportions context — optional enrichment for formality/silhouette (spec § "Proportions context")
    const p = aiStyleProfile.proportions
    const proportionParts: string[] = []
    if (p.frame_width) proportionParts.push(`frame: ${p.frame_width}`)
    if (p.torso_length) proportionParts.push(`torso: ${p.torso_length}`)
    if (p.shoulder_breadth) proportionParts.push(`shoulders: ${p.shoulder_breadth}`)
    if (proportionParts.length > 0) {
      lines.push(`AI-analyzed proportions context (optional — use only if relevant to garment cut): ${proportionParts.join(', ')}.`)
    }
  }

  lines.push(
    'For status "complete", return exactly this raw JSON shape and no additional fields:',
    '{"status":"complete","dimensions":{"occasion":{"rating":"","reason":"","confidence":""},"color":{"rating":"","reason":"","confidence":""},"formality":{"rating":"","reason":"","confidence":""},"seasonality":{"rating":"","reason":"","confidence":""},"style":{"rating":"","reason":"","confidence":""},"style_preference_match":{"rating":"","reason":"","confidence":""}},"shopping_advisor":{"recommendations":[]}}',
    'The shopping_advisor is advisory only. If AI Style Profile context is absent, return an empty recommendations array. If it is present, return one to three alternatives that address weak dimensions without changing their ratings.',
    'Each recommendation must contain title, garment_type (top|bottom|outerwear|dress|footwear|accessory|suiting|traditional_wear), color_direction, style_direction, rationale, addresses (one or two dimension keys), and match_level (Excellent Match|Strong Match|Good Match|Possible Match).',
    'Describe expected outcomes qualitatively through the affected dimensions. Never estimate a future verdict score, calculate a verdict, mention retailers, provide URLs, claim price, availability, discounts, material quality, brand, durability, or comfort.',
    'Do not return an overall verdict, recommendation, verdict score, weighted score, things_to_consider, analysis_based_on, or next_step for a complete analysis.',
    'For status "unable_to_analyze", return exactly: {"status":"unable_to_analyze","reason":"","confidence":"Low","next_step":""}.',
    'Return one JSON object only.',
  )

  return lines.join('\n')
}

function logStarted(model: string): void {
  if (process.env.NODE_ENV !== 'production') {
    console.info('[OpenAI analysis] request started', { model })
  }
}

function logCompleted(model: string, startedAt: number, usage?: OpenAIUsage): void {
  if (process.env.NODE_ENV !== 'production') {
    console.info('[OpenAI analysis] request completed', {
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

function logFailed(
  model: string,
  startedAt: number,
  error: OpenAIAnalysisError
): void {
  if (process.env.NODE_ENV !== 'production') {
    console.error('[OpenAI analysis] request failed', {
      model,
      duration_ms: Date.now() - startedAt,
      code: error.code,
      status: error.status,
    })
  }
}

export async function analyzeWithOpenAI({
  photo,
  garment,
  occasion,
  styleProfile,
  aiStyleProfile,
}: AnalyzeWithOpenAIInput): Promise<RawOpenAIAnalysisResult> {
  const apiKey = process.env.OPENAI_API_KEY
  const model = process.env.OPENAI_MODEL

  if (!apiKey || !model) {
    throw new OpenAIAnalysisError(
      'configuration_error',
      'OpenAI analysis is not configured.'
    )
  }

  let instructions: string
  try {
    instructions = await loadSystemPrompt()
  } catch {
    throw new OpenAIAnalysisError(
      'configuration_error',
      'The system prompt could not be loaded.'
    )
  }

  let photoDataUrl: string
  let garmentDataUrl: string
  try {
    [photoDataUrl, garmentDataUrl] = await Promise.all([
      fileToDataUrl(photo),
      fileToDataUrl(garment),
    ])
  } catch {
    throw new OpenAIAnalysisError('api_error', 'The uploaded images could not be prepared.')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS)
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
              { type: 'input_text', text: buildUserContext(occasion, styleProfile, aiStyleProfile) },
              { type: 'input_text', text: 'Person image:' },
              { type: 'input_image', image_url: photoDataUrl, detail: 'high' },
              { type: 'input_text', text: 'Garment image:' },
              { type: 'input_image', image_url: garmentDataUrl, detail: 'high' },
            ],
          },
        ],
        text: { format: { type: 'json_object' } },
        max_output_tokens: 1_500,
        store: false,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new OpenAIAnalysisError(
        response.status === 429 ? 'rate_limit' : 'api_error',
        response.status === 429
          ? 'The analysis service is temporarily rate limited.'
          : 'The analysis service returned an error.',
        response.status
      )
    }

    let responseBody: OpenAIResponseBody
    try {
      responseBody = await response.json() as OpenAIResponseBody
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      throw new OpenAIAnalysisError('invalid_response', 'The analysis service returned invalid JSON.')
    }

    if (responseBody.status && responseBody.status !== 'completed') {
      throw new OpenAIAnalysisError('invalid_response', 'The analysis service did not complete the response.')
    }

    const outputText = extractOutputText(responseBody)
    if (!outputText) {
      throw new OpenAIAnalysisError('invalid_response', 'The analysis service returned no analysis.')
    }

    let parsedOutput: unknown
    try {
      parsedOutput = JSON.parse(outputText)
    } catch {
      throw new OpenAIAnalysisError('invalid_response', 'The model response was not valid JSON.')
    }

    let result: RawOpenAIAnalysisResult
    try {
      result = validateRawOpenAIAnalysis(parsedOutput)
    } catch {
      throw new OpenAIAnalysisError(
        'invalid_response',
        'The model response did not match the required analysis schema.'
      )
    }

    logCompleted(model, startedAt, responseBody.usage)
    return result
  } catch (error) {
    if (error instanceof OpenAIAnalysisError) {
      logFailed(model, startedAt, error)
      throw error
    }
    if (error instanceof Error && error.name === 'AbortError') {
      const timeoutError = new OpenAIAnalysisError('timeout', 'The analysis request timed out.')
      logFailed(model, startedAt, timeoutError)
      throw timeoutError
    }
    const apiError = new OpenAIAnalysisError('api_error', 'The analysis service could not be reached.')
    logFailed(model, startedAt, apiError)
    throw apiError
  } finally {
    clearTimeout(timeout)
  }
}
