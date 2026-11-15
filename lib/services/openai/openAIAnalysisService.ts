import 'server-only'

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { StyleProfile, AIStyleProfile } from '@/types/schema'
import type { RawOpenAIAnalysisResult } from '@/types/openai'
import { logEvent, type ConfigIssue } from '@/lib/observability/safeLogger'
import { validateRawOpenAIAnalysis } from './openAIAnalysisSchema'
import { OpenAIAnalysisError } from './openAIErrors'
import { resolveModelConfig, type NormalizedUsage, type SupportedModelId } from './modelConfig'
import { callResponsesApi, type RunOverrides } from './responsesClient'

export { OpenAIAnalysisError } from './openAIErrors'
export type { OpenAIAnalysisErrorCode } from './openAIErrors'

interface AnalyzeWithOpenAIInput {
  photo: File
  garment: File
  occasion: string
  styleProfile: StyleProfile
  /** Phase 3 — optional AI-generated style profile for richer context injection. */
  aiStyleProfile?: AIStyleProfile
  /** Correlates log events for one API request. Never derived from user input. */
  requestId?: string
  /** Called once with provider-reported usage (success or failure), for spend settlement. */
  onUsage?: (usage: NormalizedUsage) => void
  /** Benchmark harness only: choose the model and tuning explicitly. The API route never sets this. */
  runOverrides?: RunOverrides & { model?: SupportedModelId }
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

/**
 * Builds the user-facing context string injected into the outfit analysis prompt.
 *
 * Phase 3 extension: when an AI Style Profile is present, coloring, aesthetic,
 * and proportions data are included as labeled context so the AI can use them
 * to improve the color and style_preference_match dimensions without being asked
 * to reference them explicitly in its output text.
 * Spec: specs/phase3/07_AI_ANALYSIS_SPEC.md § "Additional Context Provided to the AI"
 */
export function buildUserContext(
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

function logConfigIssue(requestId: string | undefined, configIssue: ConfigIssue): void {
  logEvent('error', 'openai_config_invalid', {
    request_id: requestId,
    operation: 'analysis',
    error_code: 'configuration_error',
    config_issue: configIssue,
  })
}

export async function analyzeWithOpenAI({
  photo,
  garment,
  occasion,
  styleProfile,
  aiStyleProfile,
  requestId,
  onUsage,
  runOverrides,
}: AnalyzeWithOpenAIInput): Promise<RawOpenAIAnalysisResult> {
  const apiKey = process.env.OPENAI_API_KEY
  const modelSetting = runOverrides?.model ?? process.env.OPENAI_MODEL

  if (!apiKey || !modelSetting) {
    logConfigIssue(requestId, !apiKey && !modelSetting ? 'missing_api_key_and_model' : !apiKey ? 'missing_api_key' : 'missing_model')
    throw new OpenAIAnalysisError(
      'configuration_error',
      'OpenAI analysis is not configured.'
    )
  }

  const modelConfig = resolveModelConfig(modelSetting)
  if (!modelConfig) {
    // Never log the configured value: it may be a misplaced credential.
    logConfigIssue(requestId, 'unsupported_model')
    throw new OpenAIAnalysisError('configuration_error', 'The configured OpenAI model is not supported.')
  }

  let instructions: string
  try {
    instructions = await loadSystemPrompt()
  } catch {
    logConfigIssue(requestId, 'prompt_unreadable')
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

  return callResponsesApi({
    operation: 'analysis',
    apiKey,
    modelConfig,
    instructions,
    content: [
      { type: 'input_text', text: buildUserContext(occasion, styleProfile, aiStyleProfile) },
      { type: 'input_text', text: 'Person image:' },
      { type: 'input_image', image_url: photoDataUrl, detail: 'high' },
      { type: 'input_text', text: 'Garment image:' },
      { type: 'input_image', image_url: garmentDataUrl, detail: 'high' },
    ],
    validate: validateRawOpenAIAnalysis,
    outcomeOf: (result) => result.status,
    requestId,
    overrides: runOverrides,
    onUsage,
  })
}
