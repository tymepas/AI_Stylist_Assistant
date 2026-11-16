import 'server-only'

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { AIStyleProfile, AIStyleProfileFailure } from '@/types/schema'
import { PROFILE_OUTPUT_SCHEMA_VERSION, validateAIStyleProfileResult } from '@/lib/services/openai/aiStyleProfileSchema'
import { fingerprint, IMAGE_PLACEHOLDER } from '@/lib/services/openai/promptVersion'
import { OpenAIAnalysisError } from '@/lib/services/openai/openAIErrors'
import { resolveModelConfig, type NormalizedUsage, type SupportedModelId } from '@/lib/services/openai/modelConfig'
import { callResponsesApi, type InputContentPart, type RunOverrides } from '@/lib/services/openai/responsesClient'
import { logEvent, type ConfigIssue } from '@/lib/observability/safeLogger'

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

async function fileToDataUrl(file: File): Promise<string> {
  const bytes = Buffer.from(await file.arrayBuffer())
  return `data:${file.type};base64,${bytes.toString('base64')}`
}

/** The user message of a profile request. The same builder is used for the real call and for the prompt version. */
export function buildProfileContent(photoDataUrl: string): InputContentPart[] {
  return [
    {
      type: 'input_text',
      text: 'Analyze the person in this photo and return only the JSON object described in your instructions. Set generated_at_utc to "".',
    },
    { type: 'input_image', image_url: photoDataUrl, detail: 'high' },
  ]
}

/** Fingerprint of the profile prompt template: the system prompt plus the fixed user message. */
export function computeProfilePromptVersion(instructions: string): string {
  return fingerprint([instructions, JSON.stringify(buildProfileContent(IMAGE_PLACEHOLDER))])
}

// Logging: safe, structured events only (lib/observability/safeLogger.ts).
// The profile output describes a person's appearance, so it is never logged,
// not even truncated. Only categories, counts and schema paths are recorded.

function logConfigIssue(requestId: string | undefined, configIssue: ConfigIssue): void {
  logEvent('error', 'openai_config_invalid', {
    request_id: requestId,
    operation: 'profile',
    error_code: 'configuration_error',
    config_issue: configIssue,
  })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GenerateProfileWithOpenAIInput {
  photo: File
  /** Correlates log events for one API request. Never derived from user input. */
  requestId?: string
  /** Called once with provider-reported usage (success or failure), for spend settlement. */
  onUsage?: (usage: NormalizedUsage) => void
  /** Benchmark harness only: choose the model and tuning explicitly. The API route never sets this. */
  runOverrides?: RunOverrides & { model?: SupportedModelId }
}

/**
 * Calls the OpenAI Responses API with a single user photo to generate an
 * AI Style Profile. Returns either a complete AIStyleProfile or an
 * AIStyleProfileFailure when the photo cannot be analyzed.
 *
 * Throws OpenAIAnalysisError for all infrastructure-level failures.
 * Schema validation failures are logged (schema paths only, never the output)
 * and thrown as an `invalid_response` OpenAIAnalysisError.
 */
export async function generateProfileWithOpenAI(
  input: GenerateProfileWithOpenAIInput
): Promise<AIStyleProfile | AIStyleProfileFailure> {
  const { photo, requestId, onUsage, runOverrides } = input

  const apiKey = process.env.OPENAI_API_KEY
  const modelSetting = runOverrides?.model ?? process.env.OPENAI_MODEL

  if (!apiKey || !modelSetting) {
    logConfigIssue(requestId, !apiKey && !modelSetting ? 'missing_api_key_and_model' : !apiKey ? 'missing_api_key' : 'missing_model')
    throw new OpenAIAnalysisError(
      'configuration_error',
      'OpenAI profile generation is not configured.'
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
    instructions = await loadProfileSystemPrompt()
  } catch {
    logConfigIssue(requestId, 'prompt_unreadable')
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

  return callResponsesApi({
    operation: 'profile',
    apiKey,
    modelConfig,
    instructions,
    content: buildProfileContent(photoDataUrl),
    // Validate against the full result schema (complete | unable_to_generate).
    // Never return raw AI output to the client (spec: 10_ERROR_HANDLING.md § FG-10).
    validate: validateAIStyleProfileResult,
    outcomeOf: (result) => result.status,
    requestId,
    promptVersion: computeProfilePromptVersion(instructions),
    schemaVersion: PROFILE_OUTPUT_SCHEMA_VERSION,
    overrides: runOverrides,
    onUsage,
  })
}
