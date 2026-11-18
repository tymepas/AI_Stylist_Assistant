import type { GarmentMode } from '@/lib/constants/garmentModes'
import { logEvent, summarizeValidationIssues } from '@/lib/observability/safeLogger'
import { inspectObservations } from '@/lib/services/openai/observationsSchema'
import { inspectEvidence } from '@/lib/services/openai/ratingEvidenceSchema'
import type { RawOpenAIDimensions } from '@/types/openai'
import type { Observations, RatingEvidence, StyleProfile } from '@/types/schema'

/**
 * Converts the untrusted `observations` and `evidence` blocks of a model
 * response into application-owned values.
 *
 * Both blocks are informational. They are validated after, and separately
 * from, the six ratings: whatever they contain, the ratings and the verdict
 * computed from them are exactly what they would have been without them. A
 * missing or invalid block becomes `unavailable` and the report says so;
 * nothing is filled in on the model's behalf.
 *
 * What is logged when something is dropped: fixed problem codes, counts and
 * schema paths. Never model text, never image content.
 */

export interface VisualEvidenceInput {
  rawObservations: unknown
  rawEvidence: unknown
  dimensions: RawOpenAIDimensions
  garmentMode: GarmentMode
  garmentCount: number
  hasStyleDna: boolean
  styleProfile: StyleProfile
  requestId?: string
}

export interface VisualEvidence {
  observations: Observations
  evidence: RatingEvidence
}

const UNAVAILABLE_OBSERVATIONS: Observations = { availability: 'unavailable', images: [] }
const UNAVAILABLE_EVIDENCE: RatingEvidence = { availability: 'unavailable', dimensions: {} }

/** True when the user stated at least one style preference. Evidence may only name an input that exists. */
export function hasStylePreferences(profile: StyleProfile): boolean {
  return profile.preferredStyles.length > 0 || profile.favoriteColors.length > 0 || profile.occasionPreferences.length > 0
}

export function buildVisualEvidence(input: VisualEvidenceInput): VisualEvidence {
  const { requestId } = input

  let observations = UNAVAILABLE_OBSERVATIONS
  if (input.rawObservations === undefined) {
    logEvent('warn', 'observations_unavailable', { request_id: requestId, operation: 'analysis', validation: 'absent' })
  } else {
    const inspection = inspectObservations(input.rawObservations, { mode: input.garmentMode, garmentCount: input.garmentCount })
    if (inspection.value) observations = inspection.value
    else {
      logEvent('warn', 'observations_unavailable', {
        request_id: requestId,
        operation: 'analysis',
        validation: 'failed',
        problem_codes: inspection.problems,
        ...summarizeValidationIssues(inspection.schemaError),
      })
    }
  }

  let evidence = UNAVAILABLE_EVIDENCE
  if (input.rawEvidence === undefined) {
    logEvent('warn', 'rating_evidence_unavailable', { request_id: requestId, operation: 'analysis', validation: 'absent' })
  } else {
    const inspection = inspectEvidence(input.rawEvidence, {
      dimensions: input.dimensions,
      observations: observations.availability === 'available' ? observations : null,
      hasStyleDna: input.hasStyleDna,
      hasStylePreferences: hasStylePreferences(input.styleProfile),
    })
    evidence = inspection.value
    if (evidence.availability !== 'available') {
      const codes = [...new Set([...inspection.blockProblems, ...Object.values(inspection.problems).flat()])].sort()
      logEvent('warn', 'rating_evidence_unavailable', {
        request_id: requestId,
        operation: 'analysis',
        validation: evidence.availability === 'partial' ? 'partial' : 'failed',
        problem_codes: codes,
        dimension_count: Object.keys(evidence.dimensions).length,
        ...summarizeValidationIssues(inspection.schemaError),
      })
    }
  }

  return { observations, evidence }
}
