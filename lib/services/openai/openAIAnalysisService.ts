import 'server-only'

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { StyleProfile, AIStyleProfile } from '@/types/schema'
import type { RawOpenAIAnalysisResult } from '@/types/openai'
import { logEvent, type ConfigIssue } from '@/lib/observability/safeLogger'
import { ANALYSIS_OUTPUT_SCHEMA_VERSION, validateRawOpenAIAnalysis } from './openAIAnalysisSchema'
import { OpenAIAnalysisError } from './openAIErrors'
import { resolveModelConfig, type NormalizedUsage, type SupportedModelId } from './modelConfig'
import { fingerprint, IMAGE_PLACEHOLDER } from './promptVersion'
import { MAX_GARMENT_IMAGES, garmentCountProblem, type GarmentMode } from '@/lib/constants/garmentModes'
import { callResponsesApi, type InputContentPart, type RunOverrides } from './responsesClient'

export { OpenAIAnalysisError } from './openAIErrors'
export type { OpenAIAnalysisErrorCode } from './openAIErrors'

interface AnalyzeWithOpenAIInput {
  photo: File
  /** The garment image, or the first of several. */
  garment: File
  /** Further garment images (at most two more). Only with a multi-image garment mode. */
  extraGarments?: File[]
  /** How the garment images relate to each other. Chosen by the user, never inferred. Defaults to one garment image. */
  garmentMode?: GarmentMode
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
  /** Recorded in the request trace. The API route leaves the default ('openai'). */
  analysisMode?: 'openai' | 'benchmark'
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

/** The garment images of one request: how they relate and how many there are. */
export interface GarmentContext {
  mode: GarmentMode
  count: number
}

/**
 * The image-mode line of the user message. Every mode, including a single
 * garment image, is named explicitly, so the model never has to guess how the
 * numbered garment images relate to each other. The rules for each mode are in
 * the system prompt; this line only says which one applies.
 */
function garmentModeLine(garments: GarmentContext): string {
  if (garments.mode === 'single') return 'Image mode: single. Garment image 1 shows one garment.'
  const range = `Garment images 1 to ${garments.count}`
  if (garments.mode === 'same_garment_views') return `Image mode: same_garment_views. ${range} are views of ONE garment; include observations.views.`
  return `Image mode: outfit_items. ${range} are ${garments.count} DIFFERENT items worn together; include outfit_components.`
}

/**
 * Builds the user message text of an analysis request: the image mode and the
 * request's own data. Every fixed rule, including the output format, is in the
 * system prompt (memory/SYSTEM_PROMPT.md), which is what the model receives as
 * instructions; it is stated there once and nowhere else.
 *
 * Phase 3: when a Style DNA profile is present, its coloring, aesthetic and
 * proportions data are added as labelled context lines.
 * Spec: specs/phase3/07_AI_ANALYSIS_SPEC.md § "Additional Context Provided to the AI"
 *
 * The whole prompt text must stay within `maxTextInputTokens`, the bound the
 * spend reservation is computed from (tests/core/garmentModes.test.ts measures
 * the worst case in every mode).
 */
export function buildUserContext(
  occasion: string,
  styleProfile: StyleProfile,
  aiStyleProfile?: AIStyleProfile,
  garments: GarmentContext = { mode: 'single', count: 1 }
): string {
  const lines = [
    garmentModeLine(garments),
    `Occasion: ${occasion}`,
    `Style preferences: ${JSON.stringify(styleProfile)}`,
  ]

  if (!aiStyleProfile) {
    lines.push('Style DNA: none.')
  } else {
    lines.push('Style DNA: provided.')
    // Coloring context — improves color dimension (spec § "Coloring context")
    const c = aiStyleProfile.coloring
    const coloringParts: string[] = []
    if (c.skin_tone_depth) coloringParts.push(`skin tone depth: ${c.skin_tone_depth}`)
    if (c.skin_tone_undertone) coloringParts.push(`undertone: ${c.skin_tone_undertone}`)
    if (c.hair_color) coloringParts.push(`hair: ${c.hair_color}`)
    if (c.high_contrast !== null) coloringParts.push(`high contrast coloring: ${c.high_contrast}`)
    if (coloringParts.length > 0) lines.push(`Style DNA coloring (for color): ${coloringParts.join(', ')}.`)

    // Aesthetic context — improves style_preference_match dimension (spec § "Aesthetic context")
    const a = aiStyleProfile.aesthetic_signals
    const aestheticParts: string[] = []
    if (aiStyleProfile.style_keywords.length > 0) {
      aestheticParts.push(`observed style: ${aiStyleProfile.style_keywords.map((k) => k.keyword).join(', ')}`)
    }
    if (a.current_outfit_formality) aestheticParts.push(`typical formality level: ${a.current_outfit_formality}`)
    if (aestheticParts.length > 0) lines.push(`Style DNA aesthetic (for style_preference_match): ${aestheticParts.join(', ')}.`)

    // Proportions context — optional enrichment for formality/silhouette (spec § "Proportions context")
    const p = aiStyleProfile.proportions
    const proportionParts: string[] = []
    if (p.frame_width) proportionParts.push(`frame: ${p.frame_width}`)
    if (p.torso_length) proportionParts.push(`torso: ${p.torso_length}`)
    if (p.shoulder_breadth) proportionParts.push(`shoulders: ${p.shoulder_breadth}`)
    if (proportionParts.length > 0) lines.push(`Style DNA proportions (only if relevant to the cut): ${proportionParts.join(', ')}.`)
  }

  lines.push('Return one JSON object only.')
  return lines.join('\n')
}

function garmentImageLabel(mode: GarmentMode, index: number, count: number): string {
  if (mode === 'single') return 'Garment image 1:'
  if (mode === 'same_garment_views') return `Garment image ${index + 1} of ${count} (view):`
  return `Garment image ${index + 1} of ${count} (item):`
}

/**
 * The user message of an analysis request. The same builder is used for the real call and for the prompt version.
 * Every garment image is numbered, so observations and evidence can name the image they are about.
 */
export function buildAnalysisContent(
  userContext: string,
  photoDataUrl: string,
  garmentDataUrls: string | readonly string[],
  garmentMode: GarmentMode = 'single'
): InputContentPart[] {
  const garments = typeof garmentDataUrls === 'string' ? [garmentDataUrls] : garmentDataUrls
  const content: InputContentPart[] = [
    { type: 'input_text', text: userContext },
    { type: 'input_text', text: 'Person image:' },
    { type: 'input_image', image_url: photoDataUrl, detail: 'high' },
  ]
  garments.forEach((dataUrl, index) => {
    content.push({ type: 'input_text', text: garmentImageLabel(garmentMode, index, garments.length) }, { type: 'input_image', image_url: dataUrl, detail: 'high' })
  })
  return content
}

// Placeholder inputs for fingerprinting. Every optional context line is switched
// on, so a change to any fixed instruction text changes the version.
const TEMPLATE_OCCASION = '<occasion>'
const TEMPLATE_STYLE_PROFILE: StyleProfile = { preferredStyles: [], favoriteColors: [], occasionPreferences: [] }
const TEMPLATE_AI_PROFILE = {
  coloring: { skin_tone_depth: '<depth>', skin_tone_undertone: '<undertone>', hair_color: '<hair>', high_contrast: false },
  aesthetic_signals: { current_outfit_formality: '<formality>' },
  style_keywords: [{ keyword: '<keyword>' }],
  proportions: { frame_width: '<frame>', torso_length: '<torso>', shoulder_breadth: '<shoulders>' },
} as unknown as AIStyleProfile

/**
 * Fingerprint of the analysis prompt template: the system prompt plus the user
 * message as built with and without Style DNA context, with placeholders in
 * place of user data and images.
 *
 * Each garment mode has its own template, and so its own version. The
 * multi-image templates are fingerprinted with the largest number of garment
 * images. Any change to the system prompt or to a fixed line of the message
 * changes every version, so a recording made with an earlier prompt can never
 * carry the version of the current one (tests/versioning/promptVersion.test.ts).
 */
export function computeAnalysisPromptVersion(instructions: string, garmentMode: GarmentMode = 'single'): string {
  const garments: GarmentContext | undefined = garmentMode === 'single' ? undefined : { mode: garmentMode, count: MAX_GARMENT_IMAGES }
  const images = garmentMode === 'single' ? IMAGE_PLACEHOLDER : Array.from({ length: MAX_GARMENT_IMAGES }, () => IMAGE_PLACEHOLDER)
  const withoutProfile = buildAnalysisContent(buildUserContext(TEMPLATE_OCCASION, TEMPLATE_STYLE_PROFILE, undefined, garments), IMAGE_PLACEHOLDER, images, garmentMode)
  const withProfile = buildAnalysisContent(
    buildUserContext(TEMPLATE_OCCASION, TEMPLATE_STYLE_PROFILE, TEMPLATE_AI_PROFILE, garments),
    IMAGE_PLACEHOLDER,
    images,
    garmentMode
  )
  return fingerprint([instructions, JSON.stringify(withoutProfile), JSON.stringify(withProfile)])
}

/** Version of the analysis prompt currently on disk, for benchmark and evaluation records. */
export async function getAnalysisPromptVersion(garmentMode: GarmentMode = 'single'): Promise<string> {
  return computeAnalysisPromptVersion(await loadSystemPrompt(), garmentMode)
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
  extraGarments = [],
  garmentMode = 'single',
  occasion,
  styleProfile,
  aiStyleProfile,
  requestId,
  onUsage,
  runOverrides,
  analysisMode,
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

  // The mode and the number of images must agree. The API route validates this first; this is the last line of defence.
  const garments = [garment, ...extraGarments]
  if (garmentCountProblem(garmentMode, garments.length) !== null) {
    throw new OpenAIAnalysisError('api_error', 'The garment images do not fit the selected garment mode.')
  }

  let photoDataUrl: string
  let garmentDataUrls: string[]
  try {
    [photoDataUrl, ...garmentDataUrls] = await Promise.all([fileToDataUrl(photo), ...garments.map(fileToDataUrl)])
  } catch {
    throw new OpenAIAnalysisError('api_error', 'The uploaded images could not be prepared.')
  }
  const garmentContext: GarmentContext | undefined = garmentMode === 'single' ? undefined : { mode: garmentMode, count: garments.length }

  return callResponsesApi({
    operation: 'analysis',
    apiKey,
    modelConfig,
    instructions,
    content: buildAnalysisContent(buildUserContext(occasion, styleProfile, aiStyleProfile, garmentContext), photoDataUrl, garmentDataUrls, garmentMode),
    validate: validateRawOpenAIAnalysis,
    outcomeOf: (result) => result.status,
    requestId,
    promptVersion: computeAnalysisPromptVersion(instructions, garmentMode),
    schemaVersion: ANALYSIS_OUTPUT_SCHEMA_VERSION,
    analysisMode,
    overrides: runOverrides,
    onUsage,
  })
}
