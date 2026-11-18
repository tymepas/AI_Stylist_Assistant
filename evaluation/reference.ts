/**
 * Reference sets: what a case is expected to produce, and how much that
 * expectation can be trusted.
 *
 * A reference is kept apart from the manifest on purpose. Adding or correcting
 * a review does not change the manifest, so a recording that was paid for stays
 * valid, and the report names the manifest and the reference set separately.
 *
 * Every reference states its BASIS (what the expectation was derived from) and
 * its STATUS (how far the review has got). Together they decide the TIER:
 *
 * | Tier             | Meaning                                                        |
 * |------------------|----------------------------------------------------------------|
 * | `image_reviewed` | A person looked at the actual image files and rated them.      |
 * | `brief_derived`  | A person derived the expectation from a written brief.         |
 * | `synthetic`      | Written to exercise the evaluation code. Not a judgement.      |
 * | `unreviewed`     | A stub, or a review that is not finished. Never scored.        |
 *
 * Only `image_reviewed` references can contribute to image-grounded accuracy.
 * The rules below make that tier impossible to reach by accident: it needs a
 * reviewer, a review date, a real (non-synthetic) image source with a statement
 * of the right to use it, the SHA-256 of every image that was reviewed, and all
 * six dimension ratings. A synthetic expectation may not carry a reviewer at
 * all, so it can never be mistaken for a human judgement.
 *
 * These rules cannot stop someone from typing a false statement into a file.
 * They make sure it has to be a deliberate, attributable one.
 *
 * A RATING IS ONE PERSON'S JUDGEMENT, NOT A FACT. Whether a jacket is "Good"
 * or "Fair" for an occasion is a matter two careful people can differ on. A
 * reference may therefore carry SECOND REVIEWS: the same case rated again by
 * another person, independently. They are stored next to the first review and
 * never merged into it, so every disagreement stays on record, and the report
 * can say how far reviewers agree with each other before it says how far a
 * model agrees with one of them.
 *
 * This module performs no file or network access.
 */

import { z } from 'zod'
import { DIMENSION_KEYS, type BenchmarkCase, type DimensionKey } from '@/benchmark/harness'
import { fingerprint } from '@/lib/services/openai/promptVersion'
import { shoppingGarmentCategorySchema } from '@/lib/services/openai/shoppingRecommendationSchema'
import { COLOUR_FAMILIES, IMAGE_LIMITS, PATTERNS } from '@/lib/services/openai/observationsSchema'

export const REFERENCE_SET_FORMAT = 'verdict-reference-set/1'

/** What an expectation was derived from. */
export const REVIEW_BASES = ['image_review', 'brief', 'synthetic', 'unreviewed'] as const
export type ReviewBasis = (typeof REVIEW_BASES)[number]

/** How far a review has got. Only `complete` references are scored. */
export const REVIEW_STATUSES = ['pending', 'in_progress', 'complete'] as const
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

export const REFERENCE_TIERS = ['image_reviewed', 'brief_derived', 'synthetic', 'unreviewed'] as const
export type ReferenceTier = (typeof REFERENCE_TIERS)[number]

/** The tiers that are scored, each in its own section of a report. */
export const SCORED_TIERS = ['image_reviewed', 'brief_derived', 'synthetic'] as const
export type ScoredTier = (typeof SCORED_TIERS)[number]

/** Image sources that are real images, as opposed to generated or absent ones. */
export const REAL_IMAGE_SOURCES = ['owned', 'public_license', 'approved_volunteer'] as const

export const REFERENCE_RATINGS = ['Excellent', 'Good', 'Fair', 'Poor', 'Unable to Evaluate'] as const
export type ReferenceRating = (typeof REFERENCE_RATINGS)[number]

export const KEY_FACT_ATTRIBUTES = ['garment', 'colour', 'pattern', 'fit', 'occasion', 'other'] as const
export type KeyFactAttribute = (typeof KEY_FACT_ATTRIBUTES)[number]

const identifier = (max: number) => z.string().regex(new RegExp(`^[a-z0-9][a-z0-9_-]{0,${max - 1}}$`))
const caseId = z.string().regex(/^[a-z0-9_-]{1,40}$/)
/** A word or short phrase looked for in explanation text. */
const term = z.string().trim().min(2).max(40)

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

const relativeImagePath = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => !value.startsWith('/') && !/^[A-Za-z]:/.test(value) && !value.split(/[\\/]/).includes('..'), 'Image paths must be relative to the data directory')
  .refine((value) => /\.(jpe?g|png|webp)$/i.test(value), 'Images must be .jpg, .jpeg, .png or .webp')

const imageSchema = z
  .object({
    id: identifier(40),
    role: z.enum(['photo', 'garment']),
    /** Relative to the image directory, exactly as in the manifest. */
    path: relativeImagePath,
    /** SHA-256 of the file that was reviewed. Required for an image review. */
    sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  })
  .strict()

const dimensionReferenceSchema = z
  .object({
    rating: z.enum(REFERENCE_RATINGS),
    /** Why the reviewer chose it. For people; never scored. */
    note: z.string().max(300).optional(),
  })
  .strict()

// An explicit object rather than a record keyed by an enum: every key stays optional in every Zod version.
const dimensionRatingsSchema = z
  .object({
    occasion: dimensionReferenceSchema.optional(),
    color: dimensionReferenceSchema.optional(),
    formality: dimensionReferenceSchema.optional(),
    seasonality: dimensionReferenceSchema.optional(),
    style: dimensionReferenceSchema.optional(),
    style_preference_match: dimensionReferenceSchema.optional(),
  })
  .strict()

/**
 * The same case rated again by another person, without sight of the first
 * review or of any model output. A second review is never used to "correct"
 * the first: both are kept, and where they differ that is a recorded
 * disagreement, not an error in either.
 */
const secondReviewSchema = z
  .object({
    reviewer: z.object({ id: identifier(40) }).strict(),
    reviewed_on: z.string().refine(isCalendarDate, 'reviewed_on must be a real date written as YYYY-MM-DD'),
    dimension_ratings: dimensionRatingsSchema,
    /** What the reviewers concluded when they discussed a difference. The ratings above stay as they were given. */
    notes: z.string().max(500).optional(),
  })
  .strict()

const garmentItemSchema = z
  .object({
    /** Number of the garment image this entry describes, starting at 1. */
    item: z.number().int().min(1).max(3),
    /** The kind of garment. Left out, together with `identifiable: false`, when a careful reviewer cannot tell from the image. */
    garment_type: shoppingGarmentCategorySchema.optional(),
    /** False when the garment cannot be identified from this image: the model is then expected to abstain. Absent means identifiable. */
    identifiable: z.boolean().optional(),
    /** Free-text notes kept from the first reference format. Never scored: the structured fields below are. */
    colour_family: z.string().trim().min(1).max(40).optional(),
    pattern: z.string().trim().min(1).max(40).optional(),
    /** The colour families a reviewer sees, in the same broad families the model must use (analysis-output/3). */
    colours: z
      .object({
        dominant: z.array(z.enum(COLOUR_FAMILIES)).min(1).max(2),
        secondary: z.array(z.enum(COLOUR_FAMILIES)).max(2).optional(),
      })
      .strict()
      .optional(),
    /** False when the colour cannot be judged from this image (lighting, occlusion). The model is then expected not to state it as observed. */
    colour_visible: z.boolean().optional(),
    /** The pattern a reviewer sees; `unclear` when it cannot be judged from the image. */
    pattern_category: z.enum(PATTERNS).optional(),
    /** Words that name details a reviewer confirms are visible. A model detail mentioning one of them is supported. */
    visible_details: z.array(term).min(1).max(8).optional(),
    /** Words that name details a reviewer confirms are NOT there. A model detail mentioning one of them is contradicted. */
    absent_details: z.array(term).min(1).max(8).optional(),
    /** What limits this image, as a reviewer sees it, in the codes the model uses (Phase 4 Milestone 4). */
    limits: z.array(z.enum(IMAGE_LIMITS)).min(1).max(IMAGE_LIMITS.length).optional(),
  })
  .strict()

const keyFactSchema = z
  .object({
    id: identifier(24),
    /** The fact in plain words, about the garment or the setting, never about the person. */
    statement: z.string().trim().min(3).max(200),
    attribute: z.enum(KEY_FACT_ATTRIBUTES),
    /** `key`: an explanation that leaves it out has missed something important. */
    importance: z.enum(['key', 'supporting']),
    /** Words or phrases that count as mentioning the fact. Any one of them is enough. */
    terms: z.array(term).min(1).max(8),
    /** Words that would contradict the fact, for example another colour. */
    contradicted_by: z.array(term).max(8).optional(),
  })
  .strict()

const referenceSchema = z
  .object({
    case_id: caseId,
    /** The images the expectation is about, in manifest order. Empty when there is no image. */
    images: z.array(imageSchema).max(4),
    /** The garment or outfit in plain words. Garments only: never describe the person. */
    garment_description: z.string().trim().min(1).max(300),
    occasion: z.string().min(1).max(64),
    basis: z.enum(REVIEW_BASES),
    status: z.enum(REVIEW_STATUSES),
    /** A short identifier chosen by the reviewer. Not a name or an email address. */
    reviewer: z.object({ id: identifier(40) }).strict().optional(),
    /** The day the review was done, YYYY-MM-DD. */
    reviewed_on: z.string().refine(isCalendarDate, 'reviewed_on must be a real date written as YYYY-MM-DD').optional(),
    provenance: z
      .object({
        image_source: z.enum([...REAL_IMAGE_SOURCES, 'synthetic', 'none']),
        /** The licence, or the consent or ownership statement, that allows this use of the image. */
        rights: z.string().trim().min(3).max(200).optional(),
        notes: z.string().max(300).optional(),
      })
      .strict(),
    dimension_ratings: dimensionRatingsSchema.optional(),
    garment_facts: z.object({ items: z.array(garmentItemSchema).min(1).max(3) }).strict().optional(),
    key_facts: z.array(keyFactSchema).max(12).optional(),
    /** Details that cannot be seen in the images. An explanation that states one makes an unsupported claim. */
    unverifiable_terms: z.array(term).max(12).optional(),
    /** Cases that show the same garment for the same occasion and differ only in how it was photographed. */
    comparison_group: identifier(40).optional(),
    /** Views of one garment only: whether the views really show the same garment, as a reviewer sees it. */
    views_same_garment: z.enum(['yes', 'no']).optional(),
    /** Independent reviews of the same case by other people. See secondReviewSchema. */
    second_reviews: z.array(secondReviewSchema).min(1).max(4).optional(),
    review_notes: z.string().max(500).optional(),
  })
  .strict()

export type CaseReference = z.infer<typeof referenceSchema>
export type KeyFact = NonNullable<CaseReference['key_facts']>[number]
export type SecondReview = NonNullable<CaseReference['second_reviews']>[number]

function duplicates(values: Array<string | number>): Array<string | number> {
  const seen = new Set<string | number>()
  const repeated = new Set<string | number>()
  for (const value of values) (seen.has(value) ? repeated : seen).add(value)
  return [...repeated]
}

/** Everything that is wrong with one reference on its own, without the manifest. */
export function referenceProblems(reference: CaseReference): string[] {
  const problems: string[] = []
  const { basis, status, provenance } = reference
  const realImage = (REAL_IMAGE_SOURCES as readonly string[]).includes(provenance.image_source)

  for (const id of duplicates(reference.images.map((image) => image.id))) problems.push(`image id "${id}" is used twice`)
  for (const id of duplicates((reference.key_facts ?? []).map((fact) => fact.id))) problems.push(`key fact id "${id}" is used twice`)
  for (const item of duplicates((reference.garment_facts?.items ?? []).map((entry) => entry.item))) problems.push(`garment item ${item} is described twice`)
  for (const entry of reference.garment_facts?.items ?? []) {
    const at = `garment item ${entry.item}`
    if (entry.identifiable === false && entry.garment_type !== undefined) problems.push(`${at} is marked not identifiable and still names a garment type`)
    if (entry.identifiable !== false && entry.garment_type === undefined) problems.push(`${at} names no garment type; mark it identifiable: false if it cannot be identified`)
    if (entry.colour_visible === false && entry.colours !== undefined) problems.push(`${at} is marked colour not visible and still lists colours`)
    const colours = [...(entry.colours?.dominant ?? []), ...(entry.colours?.secondary ?? [])]
    if (new Set(colours).size !== colours.length) problems.push(`${at} lists a colour family twice`)
    if (colours.length > 3) problems.push(`${at} lists more than three colour families`)
  }

  // An image review is a claim about a real image, whatever stage the review is at.
  if (basis === 'image_review' && !realImage) problems.push('an image review needs a real image: provenance.image_source must be owned, public_license or approved_volunteer');
  // A synthetic expectation is not a judgement, so it may not look like one.
  if (basis === 'synthetic') {
    if (realImage) problems.push('a synthetic expectation cannot name a real image source')
    if (reference.reviewer) problems.push('a synthetic expectation carries no reviewer')
    if (reference.reviewed_on) problems.push('a synthetic expectation carries no review date')
  }

  // A second review is a second human judgement, complete in itself and by someone else.
  const second = reference.second_reviews ?? []
  if (second.length > 0) {
    if (basis !== 'image_review' && basis !== 'brief') problems.push('only a human review (basis image_review or brief) can carry a second review')
    else if (status !== 'complete') problems.push('a second review is added only to a finished first review (status "complete")')
    for (const id of duplicates(second.map((review) => review.reviewer.id))) problems.push(`second reviewer "${id}" appears twice`)
    for (const review of second) {
      if (review.reviewer.id === reference.reviewer?.id) problems.push(`second reviewer "${review.reviewer.id}" is also the first reviewer; a second review is by another person`)
      const unrated = DIMENSION_KEYS.filter((key) => review.dimension_ratings[key] === undefined)
      if (unrated.length > 0) problems.push(`the second review by "${review.reviewer.id}" rates all six dimensions; missing: ${unrated.join(', ')}`)
    }
  }

  if (status !== 'complete') return problems

  if (basis === 'unreviewed') problems.push('a complete reference must state its basis: image_review, brief or synthetic')
  const missing = DIMENSION_KEYS.filter((key) => reference.dimension_ratings?.[key] === undefined)
  if (missing.length > 0) problems.push(`a complete reference rates all six dimensions; missing: ${missing.join(', ')} (use "Unable to Evaluate" where a dimension cannot be judged)`)

  if (basis === 'image_review' || basis === 'brief') {
    if (!reference.reviewer) problems.push('a complete review names its reviewer')
    if (!reference.reviewed_on) problems.push('a complete review states the day it was done')
  }
  if (basis === 'image_review') {
    if (!provenance.rights) problems.push('an image review states the right to use the image in provenance.rights')
    if (!reference.images.some((image) => image.role === 'photo')) problems.push('an image review lists the personal photo')
    if (!reference.images.some((image) => image.role === 'garment')) problems.push('an image review lists at least one garment image')
    const unhashed = reference.images.filter((image) => image.sha256 === undefined).map((image) => image.id)
    if (unhashed.length > 0) problems.push(`an image review records the SHA-256 of every image; missing for: ${unhashed.join(', ')}`)
  }
  return problems
}

export const referenceSetSchema = z
  .object({
    format: z.literal(REFERENCE_SET_FORMAT),
    /** The dataset these references belong to, for example `golden-v1`. */
    dataset: identifier(40),
    /** Bumped by hand whenever a case or a reference changes: major.minor.patch. */
    dataset_version: z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/),
    references: z.array(referenceSchema).max(500),
  })
  .strict()
  .superRefine((set, ctx) => {
    for (const id of duplicates(set.references.map((reference) => reference.case_id))) {
      ctx.addIssue({ code: 'custom', message: `Reference ${id}: more than one reference for this case` })
    }
    for (const reference of set.references) {
      for (const problem of referenceProblems(reference)) ctx.addIssue({ code: 'custom', message: `Reference ${reference.case_id}: ${problem}` })
    }
  })

export type ReferenceSet = z.infer<typeof referenceSetSchema>

/** The tier a reference is scored in. Anything that is not a complete review is `unreviewed`. */
export function tierOf(reference: Pick<CaseReference, 'basis' | 'status'>): ReferenceTier {
  if (reference.status !== 'complete') return 'unreviewed'
  if (reference.basis === 'image_review') return 'image_reviewed'
  if (reference.basis === 'brief') return 'brief_derived'
  if (reference.basis === 'synthetic') return 'synthetic'
  return 'unreviewed'
}

/** The images of a case in the order the manifest gives them: the photo, then every garment image. */
export function manifestImages(benchmarkCase: BenchmarkCase): Array<{ role: 'photo' | 'garment'; path: string }> {
  return [
    { role: 'photo', path: benchmarkCase.photo },
    { role: 'garment', path: benchmarkCase.garment },
    ...(benchmarkCase.extra_garments ?? []).map((path) => ({ role: 'garment' as const, path })),
  ]
}

/**
 * Everything in a reference set that disagrees with its manifest. A reference
 * about a different occasion, or other images, than the case that is evaluated
 * would silently score the wrong thing, so every one of these is an error.
 */
export function manifestProblems(set: ReferenceSet, cases: BenchmarkCase[]): string[] {
  const byId = new Map(cases.map((benchmarkCase) => [benchmarkCase.id, benchmarkCase]))
  const problems: string[] = []

  for (const reference of set.references) {
    const at = `Reference ${reference.case_id}`
    const benchmarkCase = byId.get(reference.case_id)
    if (!benchmarkCase) {
      problems.push(`${at}: no such case in the manifest`)
      continue
    }
    if (reference.occasion !== benchmarkCase.occasion) problems.push(`${at}: the occasion differs from the manifest`)

    const expected = manifestImages(benchmarkCase)
    if (reference.images.length > 0) {
      const same = reference.images.length === expected.length && reference.images.every((image, index) => image.role === expected[index].role && image.path === expected[index].path)
      if (!same) problems.push(`${at}: the images differ from the manifest (they must be the same files in the same order)`)
    }

    const garmentCount = expected.length - 1
    const items = reference.garment_facts?.items ?? []
    if (items.some((entry) => entry.item > garmentCount)) problems.push(`${at}: garment_facts names an item beyond the ${garmentCount} garment image(s) of the case`)
    if (tierOf(reference) !== 'unreviewed' && items.length > 0 && (benchmarkCase.garment_mode ?? 'single') === 'outfit_items' && items.length !== garmentCount) {
      problems.push(`${at}: an outfit of ${garmentCount} items needs one garment_facts entry per item`)
    }

    if (reference.views_same_garment !== undefined && (benchmarkCase.garment_mode ?? 'single') !== 'same_garment_views') {
      problems.push(`${at}: views_same_garment applies only to a case of views of one garment`)
    }

    if (tierOf(reference) === 'image_reviewed') {
      if (benchmarkCase.source === 'synthetic') problems.push(`${at}: an image review cannot belong to a case whose manifest source is synthetic`)
      else if (benchmarkCase.source !== reference.provenance.image_source) problems.push(`${at}: provenance.image_source differs from the manifest source`)
    }
  }

  // The cases of one comparison group show the same garment for the same occasion; only the image mode differs.
  const occasionsByGroup = new Map<string, Set<string>>()
  for (const reference of set.references) {
    const benchmarkCase = byId.get(reference.case_id)
    if (!reference.comparison_group || !benchmarkCase) continue
    occasionsByGroup.set(reference.comparison_group, (occasionsByGroup.get(reference.comparison_group) ?? new Set<string>()).add(benchmarkCase.occasion))
  }
  for (const group of [...occasionsByGroup.keys()].sort()) {
    if ((occasionsByGroup.get(group) as Set<string>).size > 1) problems.push(`Comparison group ${group}: its cases have different occasions. A group holds the same garment for the same occasion`)
  }

  // A group compares image modes and nothing else. Its cases must be sent with the same style preferences and the
  // same Style DNA condition (the same persona, or none): otherwise a difference between them could come from either.
  const conditionsByGroup = new Map<string, { preferences: Set<string>; styleDna: Set<string> }>()
  for (const reference of set.references) {
    const benchmarkCase = byId.get(reference.case_id)
    if (!reference.comparison_group || !benchmarkCase) continue
    const seen = conditionsByGroup.get(reference.comparison_group) ?? { preferences: new Set<string>(), styleDna: new Set<string>() }
    seen.preferences.add(JSON.stringify(sortKeys(benchmarkCase.style_profile)))
    seen.styleDna.add(benchmarkCase.style_dna?.persona ?? '(none)')
    conditionsByGroup.set(reference.comparison_group, seen)
  }
  for (const group of [...conditionsByGroup.keys()].sort()) {
    const seen = conditionsByGroup.get(group) as { preferences: Set<string>; styleDna: Set<string> }
    if (seen.styleDna.size > 1) problems.push(`Comparison group ${group}: its cases differ in Style DNA (${[...seen.styleDna].sort().join(', ')}). Every case of a group is sent with the same profile, or with none`)
    if (seen.preferences.size > 1) problems.push(`Comparison group ${group}: its cases have different style preferences. A group differs only in how the garment was photographed`)
  }
  return problems
}

/** Reviews dated after `today` (YYYY-MM-DD). Kept out of the schema so that validation never depends on the clock. */
export function futureDatedProblems(set: ReferenceSet, today: string): string[] {
  return set.references.flatMap((reference) => [
    ...(reference.reviewed_on !== undefined && reference.reviewed_on > today ? [`Reference ${reference.case_id}: reviewed_on is in the future`] : []),
    ...(reference.second_reviews ?? [])
      .filter((review) => review.reviewed_on > today)
      .map((review) => `Reference ${reference.case_id}: the second review by "${review.reviewer.id}" is dated in the future`),
  ])
}

/**
 * Every rating a case received for one dimension, the first review first.
 * Empty when the first review does not rate the dimension.
 */
export function reviewerRatings(reference: CaseReference, key: DimensionKey): ReferenceRating[] {
  const first = reference.dimension_ratings?.[key]?.rating
  if (first === undefined) return []
  return [first, ...(reference.second_reviews ?? []).flatMap((review) => (review.dimension_ratings[key] ? [review.dimension_ratings[key].rating] : []))]
}

export class ReferenceSetError extends Error {
  constructor(readonly problems: string[]) {
    super(`The reference set is not valid:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`)
    this.name = 'ReferenceSetError'
  }
}

/** Parses a reference set and checks it against its manifest. Throws a ReferenceSetError that lists every problem. */
export function parseReferenceSet(value: unknown, cases: BenchmarkCase[]): ReferenceSet {
  const parsed = referenceSetSchema.safeParse(value)
  if (!parsed.success) {
    throw new ReferenceSetError(parsed.error.issues.map((issue) => (issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message)))
  }
  const problems = manifestProblems(parsed.data, cases)
  if (problems.length > 0) throw new ReferenceSetError(problems)
  return parsed.data
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as object).sort().map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]))
  }
  return value
}

/** Identifies a reference set: its dataset, its version and every reference, independent of order. */
export function referenceSetFingerprint(set: ReferenceSet): string {
  const ordered = [...set.references].sort((a, b) => a.case_id.localeCompare(b.case_id))
  return fingerprint([JSON.stringify(sortKeys({ dataset: set.dataset, dataset_version: set.dataset_version, references: ordered }))])
}

/**
 * Identifies what the reference-dependent figures are scored against: every
 * first review, and nothing else. Second reviews and the hand-kept
 * `dataset_version` are left out, because neither changes a single agreement,
 * grounding or calibration figure. Two reports with the same scoring
 * fingerprint can therefore be compared metric by metric even when a second
 * review was added in between. Without this, adding a second review would make
 * every such comparison "inconclusive" and a real regression would go unseen.
 *
 * The figures that do use second reviews are compared on the full fingerprint.
 */
export function referenceScoringFingerprint(set: ReferenceSet): string {
  const ordered = [...set.references]
    .sort((a, b) => a.case_id.localeCompare(b.case_id))
    .map((reference) => Object.fromEntries(Object.entries(reference).filter(([key]) => key !== 'second_reviews')))
  return fingerprint([JSON.stringify(sortKeys({ dataset: set.dataset, references: ordered }))])
}

export interface ResolvedReference {
  reference: CaseReference
  tier: ReferenceTier
}

/** The references of the given cases, by case id, each with its tier. */
export function resolveReferences(set: ReferenceSet | undefined, cases: BenchmarkCase[]): Map<string, ResolvedReference> {
  const wanted = new Set(cases.map((benchmarkCase) => benchmarkCase.id))
  const resolved = new Map<string, ResolvedReference>()
  for (const reference of set?.references ?? []) {
    if (wanted.has(reference.case_id)) resolved.set(reference.case_id, { reference, tier: tierOf(reference) })
  }
  return resolved
}

export interface ReferenceSummary {
  /** `none` when the evaluation ran without a reference set. */
  status: 'loaded' | 'none'
  dataset: string | null
  dataset_version: string | null
  fingerprint: string | null
  /** The first reviews only (see referenceScoringFingerprint). What figures that ignore second reviews are compared on. */
  scoring_fingerprint: string | null
  /** Cases of the evaluated selection, by the tier of their reference. */
  cases_by_tier: Record<ReferenceTier, number>
  cases_without_reference: number
  /** Who did the image reviews, and when. Empty without image-reviewed cases. */
  image_reviewers: string[]
  image_reviews_from: string | null
  image_reviews_to: string | null
  /** Image-reviewed cases that were also rated by a second person, and who those people are. */
  image_cases_with_second_review: number
  image_second_reviewers: string[]
}

export function summarizeReferences(set: ReferenceSet | undefined, cases: BenchmarkCase[]): ReferenceSummary {
  const resolved = resolveReferences(set, cases)
  const counts = Object.fromEntries(REFERENCE_TIERS.map((tier) => [tier, 0])) as Record<ReferenceTier, number>
  for (const { tier } of resolved.values()) counts[tier] += 1
  const reviewed = [...resolved.values()].filter(({ tier }) => tier === 'image_reviewed').map(({ reference }) => reference)
  const dates = reviewed.map((reference) => reference.reviewed_on as string).sort()
  return {
    status: set ? 'loaded' : 'none',
    dataset: set?.dataset ?? null,
    dataset_version: set?.dataset_version ?? null,
    fingerprint: set ? referenceSetFingerprint(set) : null,
    scoring_fingerprint: set ? referenceScoringFingerprint(set) : null,
    cases_by_tier: counts,
    cases_without_reference: cases.length - resolved.size,
    image_reviewers: [...new Set(reviewed.map((reference) => reference.reviewer?.id as string))].sort(),
    image_reviews_from: dates[0] ?? null,
    image_reviews_to: dates[dates.length - 1] ?? null,
    image_cases_with_second_review: reviewed.filter((reference) => (reference.second_reviews ?? []).length > 0).length,
    image_second_reviewers: [...new Set(reviewed.flatMap((reference) => (reference.second_reviews ?? []).map((review) => review.reviewer.id)))].sort(),
  }
}

export type { DimensionKey }
