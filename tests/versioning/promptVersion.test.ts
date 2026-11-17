/**
 * Prompt versions: reproducible fingerprints of the prompt template that is
 * actually sent, independent of user data. OpenAI is mocked; no network calls.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { readFileSync } from 'node:fs'
import path from 'node:path'

jest.mock('server-only', () => ({}), { virtual: true })

import {
  analyzeWithOpenAI,
  buildAnalysisContent,
  buildUserContext,
  computeAnalysisPromptVersion,
  getAnalysisPromptVersion,
} from '@/lib/services/openai/openAIAnalysisService'
import { buildProfileContent, computeProfilePromptVersion, generateProfileWithOpenAI } from '@/lib/services/openai/openAIProfileService'
import { fingerprint, IMAGE_PLACEHOLDER } from '@/lib/services/openai/promptVersion'
import { allRated, makePng, openAIResponse } from '../helpers/fixtures'
import { captureLogs } from '../logging/logTestUtils'
import { VALID_COMPLETE_PROFILE } from '../phase3/fixtures'

const ANALYSIS_PROMPT = readFileSync(path.join(process.cwd(), 'memory', 'SYSTEM_PROMPT.md'), 'utf8')
const PROFILE_PROMPT = readFileSync(path.join(process.cwd(), 'memory', 'STYLE_PROFILE_SYSTEM_PROMPT.md'), 'utf8')

/**
 * The versions of the prompts currently in the repository. A prompt change is
 * meant to be a deliberate, reviewed event: when one is intended, update the
 * value here in the same change so the new version is visible in the diff.
 */
// Phase 4 Milestone 1 (observations and evidence, analysis-output/3). Was 3c78bd7bbd3b.
const CURRENT_ANALYSIS_PROMPT_VERSION = '8dd94dba7564'
const CURRENT_PROFILE_PROMPT_VERSION = 'fce6c25bb5cf'

const originalEnv = { ...process.env }
const EMPTY_PROFILE = { preferredStyles: [], favoriteColors: [], occasionPreferences: [] }

beforeEach(() => {
  process.env = { ...originalEnv, OPENAI_API_KEY: 'sk-test-fake-key-version-0000', OPENAI_MODEL: 'gpt-4.1' }
})

afterEach(() => {
  process.env = { ...originalEnv }
  jest.restoreAllMocks()
})

describe('fingerprint', () => {
  it('is a stable 12-character hex string', () => {
    expect(fingerprint(['a', 'b'])).toMatch(/^[0-9a-f]{12}$/)
    expect(fingerprint(['a', 'b'])).toBe(fingerprint(['a', 'b']))
  })

  it('distinguishes content, order and part boundaries', () => {
    const values = [fingerprint(['ab', 'c']), fingerprint(['a', 'bc']), fingerprint(['abc']), fingerprint(['c', 'ab']), fingerprint(['ab', 'd'])]
    expect(new Set(values).size).toBe(values.length)
  })

  it('ignores line-ending differences, so Windows and Linux checkouts agree', () => {
    expect(fingerprint(['line one\r\nline two\r\n'])).toBe(fingerprint(['line one\nline two\n']))
    expect(fingerprint(['line one\rline two'])).toBe(fingerprint(['line one\nline two']))
  })

  it('is sensitive to any other whitespace or wording change', () => {
    expect(fingerprint(['Rate each dimension.'])).not.toBe(fingerprint(['Rate each dimension. ']))
    expect(fingerprint(['Rate each dimension.'])).not.toBe(fingerprint(['Rate every dimension.']))
  })
})

describe('analysis prompt version', () => {
  it('matches the recorded version of the prompt in the repository', async () => {
    expect(computeAnalysisPromptVersion(ANALYSIS_PROMPT)).toBe(CURRENT_ANALYSIS_PROMPT_VERSION)
    await expect(getAnalysisPromptVersion()).resolves.toBe(CURRENT_ANALYSIS_PROMPT_VERSION)
  })

  it('changes when the system prompt changes', () => {
    expect(computeAnalysisPromptVersion(`${ANALYSIS_PROMPT}\nOne more rule.`)).not.toBe(CURRENT_ANALYSIS_PROMPT_VERSION)
  })

  it('covers the fixed instruction lines of the user message, with and without Style DNA context', () => {
    const template = buildUserContext('<occasion>', EMPTY_PROFILE)
    const withProfile = buildUserContext('<occasion>', EMPTY_PROFILE, VALID_COMPLETE_PROFILE)
    expect(template).toContain('Return one JSON object only.')
    expect(withProfile).toContain('Style DNA coloring (for color)')
    // The version is exactly the fingerprint of the system prompt and both message forms.
    const placeholderProfile = {
      coloring: { skin_tone_depth: '<depth>', skin_tone_undertone: '<undertone>', hair_color: '<hair>', high_contrast: false },
      aesthetic_signals: { current_outfit_formality: '<formality>' },
      style_keywords: [{ keyword: '<keyword>' }],
      proportions: { frame_width: '<frame>', torso_length: '<torso>', shoulder_breadth: '<shoulders>' },
    } as unknown as typeof VALID_COMPLETE_PROFILE
    expect(computeAnalysisPromptVersion(ANALYSIS_PROMPT)).toBe(
      fingerprint([
        ANALYSIS_PROMPT,
        JSON.stringify(buildAnalysisContent(template, IMAGE_PLACEHOLDER, IMAGE_PLACEHOLDER)),
        JSON.stringify(buildAnalysisContent(buildUserContext('<occasion>', EMPTY_PROFILE, placeholderProfile), IMAGE_PLACEHOLDER, IMAGE_PLACEHOLDER)),
      ])
    )
  })

  it('switches on every optional context line in the fingerprinted template', () => {
    // Each of these lines is conditional in buildUserContext; all must be part of the version.
    const placeholderProfile = {
      coloring: { skin_tone_depth: '<depth>', skin_tone_undertone: '<undertone>', hair_color: '<hair>', high_contrast: false },
      aesthetic_signals: { current_outfit_formality: '<formality>' },
      style_keywords: [{ keyword: '<keyword>' }],
      proportions: { frame_width: '<frame>', torso_length: '<torso>', shoulder_breadth: '<shoulders>' },
    } as unknown as typeof VALID_COMPLETE_PROFILE
    const text = buildUserContext('<occasion>', EMPTY_PROFILE, placeholderProfile)
    for (const fragment of ['skin tone depth:', 'undertone:', 'hair:', 'high contrast coloring:', 'observed style:', 'typical formality level:', 'frame:', 'torso:', 'shoulders:']) {
      expect(text).toContain(fragment)
    }
  })

  it('is recorded in the trace and matches the request that was actually sent', async () => {
    const logs = captureLogs()
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async () =>
      openAIResponse({ status: 'complete', dimensions: allRated('Good'), shopping_advisor: { recommendations: [] } })
    )
    const occasion = 'PRIVATE-OCCASION-MARKER'
    const styleProfile = { preferredStyles: ['PRIVATE-STYLE-MARKER'], favoriteColors: [], occasionPreferences: [] }

    await analyzeWithOpenAI({ photo: makePng(), garment: makePng(), occasion, styleProfile, aiStyleProfile: VALID_COMPLETE_PROFILE, requestId: 'req-1' })

    const sent = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body)) as {
      instructions: string
      input: Array<{ content: Array<{ type: string; text?: string; image_url?: string }> }>
    }
    // What was sent: the prompt file, and the message built by the same builder the version uses.
    expect(sent.instructions).toBe(ANALYSIS_PROMPT)
    const images = sent.input[0].content.filter((part) => part.type === 'input_image').map((part) => part.image_url as string)
    expect(sent.input[0].content).toEqual(
      buildAnalysisContent(buildUserContext(occasion, styleProfile, VALID_COMPLETE_PROFILE), images[0], images[1])
    )

    const completed = logs.events().find((event) => event.event === 'openai_request_completed')
    expect(completed).toMatchObject({ prompt_version: computeAnalysisPromptVersion(sent.instructions), request_id: 'req-1' })
    expect(completed?.prompt_version).toBe(CURRENT_ANALYSIS_PROMPT_VERSION)
  })

  it('does not depend on, or reveal, user data', async () => {
    const logs = captureLogs()
    jest.spyOn(global, 'fetch').mockImplementation(async () =>
      openAIResponse({ status: 'complete', dimensions: allRated('Good'), shopping_advisor: { recommendations: [] } })
    )
    const versions: unknown[] = []
    for (const occasion of ['Wedding Guest', 'PRIVATE-OCCASION-MARKER']) {
      await analyzeWithOpenAI({
        photo: makePng(),
        garment: makePng(),
        occasion,
        styleProfile: { preferredStyles: [occasion], favoriteColors: [], occasionPreferences: [] },
        aiStyleProfile: occasion === 'Wedding Guest' ? undefined : VALID_COMPLETE_PROFILE,
      })
    }
    for (const event of logs.events()) if (event.event === 'openai_request_completed') versions.push(event.prompt_version)

    expect(versions).toEqual([CURRENT_ANALYSIS_PROMPT_VERSION, CURRENT_ANALYSIS_PROMPT_VERSION])
    expect(logs.text()).not.toContain('PRIVATE-OCCASION-MARKER')
  })
})

describe('profile prompt version', () => {
  it('matches the recorded version of the prompt in the repository', () => {
    expect(computeProfilePromptVersion(PROFILE_PROMPT)).toBe(CURRENT_PROFILE_PROMPT_VERSION)
  })

  it('differs from the analysis prompt version and changes with the prompt', () => {
    expect(CURRENT_PROFILE_PROMPT_VERSION).not.toBe(CURRENT_ANALYSIS_PROMPT_VERSION)
    expect(computeProfilePromptVersion(`${PROFILE_PROMPT} `)).not.toBe(CURRENT_PROFILE_PROMPT_VERSION)
  })

  it('is recorded in the trace and matches the request that was actually sent', async () => {
    const logs = captureLogs()
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async () => openAIResponse(VALID_COMPLETE_PROFILE))

    await generateProfileWithOpenAI({ photo: makePng(), requestId: 'req-2' })

    const sent = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body)) as {
      instructions: string
      input: Array<{ content: Array<{ type: string; image_url?: string }> }>
    }
    expect(sent.instructions).toBe(PROFILE_PROMPT)
    const image = sent.input[0].content.find((part) => part.type === 'input_image')?.image_url as string
    expect(sent.input[0].content).toEqual(buildProfileContent(image))

    const completed = logs.events().find((event) => event.event === 'openai_request_completed')
    expect(completed).toMatchObject({ prompt_version: CURRENT_PROFILE_PROMPT_VERSION, request_id: 'req-2' })
  })
})
