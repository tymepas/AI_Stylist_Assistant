/**
 * An in-memory dataset for testing the quality metrics: cases, references and
 * outputs whose every figure can be worked out by hand.
 *
 * NOTHING HERE IS EVIDENCE ABOUT A MODEL OR ABOUT ANY IMAGE. No image exists,
 * no person reviewed anything and no model produced any output. The "reviewer"
 * is the string `test-reviewer` and the image hashes are placeholders. The data
 * lives only in memory during a test, so that the code path for human-reviewed
 * references can be exercised without a committed file ever claiming a review.
 *
 * Layout (17 cases, 2 runs each):
 * - q-single-01 … q-single-08    one garment image
 * - q-views-01  … q-views-04     two views of one garment; q-views-0N shares a
 *                                comparison group with q-single-0N
 * - q-outfit-01 … q-outfit-05    two outfit items (a top and a bottom)
 *
 * Reference ratings: occasion Excellent, color Good, formality Good,
 * style Fair, style_preference_match Good; seasonality Good, except for the
 * four `views` cases where the "reviewer" could not judge it.
 *
 * Clean outputs:
 * - occasion, color, formality, style_preference_match: the reference rating, High confidence
 * - seasonality: the reference rating, Medium confidence
 * - style: Low confidence; the reference rating for the 8 single cases, one band off (Good) for the other 9
 * - every explanation mentions the key facts; outfit notes are valid and correct
 */

import { manifestSchema, type BenchmarkCase } from '@/benchmark/harness'
import { datasetFingerprint, type Recording } from '@/evaluation/recording'
import { referenceSetSchema, type ReferenceSet } from '@/evaluation/reference'

export type FixtureBasis = 'image_review' | 'brief' | 'synthetic'

const SINGLE = Array.from({ length: 8 }, (_, index) => `q-single-0${index + 1}`)
const VIEWS = Array.from({ length: 4 }, (_, index) => `q-views-0${index + 1}`)
const OUTFITS = Array.from({ length: 5 }, (_, index) => `q-outfit-0${index + 1}`)
export const FIXTURE_CASE_IDS = [...SINGLE, ...VIEWS, ...OUTFITS]

const REFERENCE_RATINGS = { occasion: 'Excellent', color: 'Good', formality: 'Good', seasonality: 'Good', style: 'Fair', style_preference_match: 'Good' } as const
const CLEAN_REASON = 'The navy blazer suits the setting and reads as tailored and considered for it.'
const HASH = 'a'.repeat(64)

function garmentPaths(id: string): string[] {
  if (id.startsWith('q-single')) return [`${id}/garment-1.jpg`]
  return [`${id}/garment-1.jpg`, `${id}/garment-2.jpg`]
}

export function fixtureCases(basis: FixtureBasis): BenchmarkCase[] {
  const cases = FIXTURE_CASE_IDS.map((id) => {
    const garments = garmentPaths(id)
    const mode = id.startsWith('q-views') ? 'same_garment_views' : id.startsWith('q-outfit') ? 'outfit_items' : undefined
    return {
      id,
      category: 'clear',
      description: 'Test fixture: no image exists.',
      source: basis === 'image_review' ? 'public_license' : 'synthetic',
      photo: `${id}/photo.jpg`,
      garment: garments[0],
      occasion: 'Client Meeting',
      expected: {},
      ...(mode ? { garment_mode: mode, extra_garments: garments.slice(1) } : {}),
    }
  })
  return manifestSchema.parse({ version: 1, cases }).cases
}

export function fixtureReferences(basis: FixtureBasis): ReferenceSet {
  const references = FIXTURE_CASE_IDS.map((id) => {
    const garments = garmentPaths(id)
    const ratings = Object.fromEntries(Object.entries(REFERENCE_RATINGS).map(([key, rating]) => [key, { rating: key === 'seasonality' && id.startsWith('q-views') ? 'Unable to Evaluate' : rating }]))
    const group = /^q-(single|views)-0[1-4]$/.test(id) ? { comparison_group: `grp-${id.slice(-2)}` } : {}
    return {
      case_id: id,
      images: basis === 'image_review'
        ? [{ id: 'photo', role: 'photo', path: `${id}/photo.jpg`, sha256: HASH }, ...garments.map((path, index) => ({ id: `garment-${index + 1}`, role: 'garment', path, sha256: HASH }))]
        : [],
      garment_description: 'Test fixture: a navy blazer.',
      occasion: 'Client Meeting',
      basis,
      status: 'complete',
      ...(basis === 'synthetic' ? {} : { reviewer: { id: 'test-reviewer' }, reviewed_on: '2026-11-01' }),
      provenance: basis === 'image_review' ? { image_source: 'public_license', rights: 'Test fixture: no image exists.' } : { image_source: 'none' },
      dimension_ratings: ratings,
      ...(id.startsWith('q-outfit') ? { garment_facts: { items: [{ item: 1, garment_type: 'top' }, { item: 2, garment_type: 'bottom' }] } } : {}),
      key_facts: [
        { id: 'colour', statement: 'The jacket is navy.', attribute: 'colour', importance: 'key', terms: ['navy'], contradicted_by: ['black'] },
        { id: 'garment', statement: 'It is a blazer.', attribute: 'garment', importance: 'supporting', terms: ['blazer'] },
      ],
      unverifiable_terms: ['lining'],
      ...group,
    }
  })
  return referenceSetSchema.parse({ format: 'verdict-reference-set/1', dataset: 'quality-fixture', dataset_version: '1.0.0', references })
}

type Dimension = { rating: string; reason: string; confidence: string }
export type FixtureOutput = { status: 'complete'; dimensions: Record<string, Dimension>; outfit_components?: unknown }

function cleanOutput(id: string): FixtureOutput {
  const seasonality = id.startsWith('q-views') ? 'Unable to Evaluate' : REFERENCE_RATINGS.seasonality
  const output: FixtureOutput = {
    status: 'complete',
    dimensions: {
      occasion: { rating: REFERENCE_RATINGS.occasion, reason: CLEAN_REASON, confidence: 'High' },
      color: { rating: REFERENCE_RATINGS.color, reason: CLEAN_REASON, confidence: 'High' },
      formality: { rating: REFERENCE_RATINGS.formality, reason: CLEAN_REASON, confidence: 'High' },
      seasonality: { rating: seasonality, reason: CLEAN_REASON, confidence: 'Medium' },
      style: { rating: id.startsWith('q-single') ? REFERENCE_RATINGS.style : 'Good', reason: CLEAN_REASON, confidence: 'Low' },
      style_preference_match: { rating: REFERENCE_RATINGS.style_preference_match, reason: CLEAN_REASON, confidence: 'High' },
    },
  }
  if (id.startsWith('q-outfit')) {
    output.outfit_components = [
      { item: 1, garment_type: 'top', assessment: 'Works well', note: 'The navy top is in keeping with the setting.' },
      { item: 2, garment_type: 'bottom', assessment: 'Works', note: 'The trousers sit well with the top.' },
    ]
  }
  return output
}

/** Outputs recorded "from a model" or written by hand, depending on `provenance`. Both are test data. */
export function fixtureRecording(cases: BenchmarkCase[], provenance: Recording['provenance'], change: (output: FixtureOutput, caseId: string, run: number) => FixtureOutput = (output) => output): Recording {
  return {
    format: 'verdict-recording/1',
    provenance,
    model: 'gpt-6.1-terra',
    reasoning_effort: 'low',
    max_output_tokens: 4000,
    prompt_version: 'aaaaaaaaaaaa',
    schema_version: 'analysis-output/2',
    dataset_fingerprint: datasetFingerprint(cases),
    entries: cases.flatMap((benchmarkCase) => [1, 2].map((run) => ({
      case_id: benchmarkCase.id,
      run,
      outcome: 'returned' as const,
      output: change(cleanOutput(benchmarkCase.id), benchmarkCase.id, run),
      latency_ms: 0,
    }))),
  }
}

const DEGRADED_REASON = 'The black jacket with its silk lining looks fine for this.'

/**
 * A deliberately worse set of outputs, changed in ways a real regression could look like:
 * - occasion is two bands off (Excellent -> Fair) and still stated with High confidence
 * - color is one band off (Good -> Fair)
 * - seasonality is rated Good with High confidence, also where the reference says it cannot be judged
 * - every explanation drops the key facts, uses a contradicting word and states a detail that cannot be seen
 * - the first outfit item is given the wrong garment type
 */
export function degrade(output: FixtureOutput): FixtureOutput {
  const dimensions = Object.fromEntries(Object.entries(output.dimensions).map(([key, value]) => [key, { ...value, reason: DEGRADED_REASON }])) as Record<string, Dimension>
  dimensions.occasion = { ...dimensions.occasion, rating: 'Fair', confidence: 'High' }
  dimensions.color = { ...dimensions.color, rating: 'Fair' }
  dimensions.seasonality = { ...dimensions.seasonality, rating: 'Good', confidence: 'High' }
  const degraded: FixtureOutput = { ...output, dimensions }
  if (Array.isArray(output.outfit_components)) {
    degraded.outfit_components = (output.outfit_components as Array<Record<string, unknown>>).map((entry) => (entry.item === 1 ? { ...entry, garment_type: 'outerwear', note: 'The black jacket is in keeping with the setting.' } : entry))
  }
  return degraded
}
