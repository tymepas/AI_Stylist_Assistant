/**
 * Reference sets: schema, provenance, tiers, the cross-check against the
 * manifest, and the files that are committed.
 *
 * The point of these tests is the boundary between what a person reviewed
 * against an image and everything else. Each rule that guards that boundary
 * has a test that tries to cross it.
 *
 * No network is used.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

jest.mock('server-only', () => ({}), { virtual: true })

import { manifestSchema } from '@/benchmark/harness'
import { evaluateRecording } from '@/evaluation/evaluate'
import { loadCases, loadReferenceSet, mockFixturePaths, referenceImageProblems } from '@/evaluation/load'
import { resolveEvaluationPlan } from '@/evaluation/modes'
import { UNAVAILABLE_NO_GROUND_TRUTH } from '@/evaluation/quality'
import {
  REFERENCE_SET_FORMAT,
  ReferenceSetError,
  futureDatedProblems,
  manifestProblems,
  parseReferenceSet,
  referenceProblems,
  referenceSetFingerprint,
  referenceSetSchema,
  summarizeReferences,
  tierOf,
  type CaseReference,
  type ReferenceSet,
} from '@/evaluation/reference'
import { fixtureCases, fixtureRecording, fixtureReferences } from '../helpers/qualityFixture'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const stubs = require('../../scripts/evaluation/review-stubs.cjs') as { plan: (manifest: unknown, existing: unknown, imagesDir?: string) => { stubs: CaseReference[]; notes: string[] } }

const root = process.cwd()
const CURRENT = { promptVersion: 'aaaaaaaaaaaa', schemaVersion: 'analysis-output/2' }

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** One complete image review from the test fixture, to break in one way at a time. */
function reviewed(): CaseReference {
  return clone(fixtureReferences('image_review').references[0])
}

function problemsOf(reference: CaseReference): string[] {
  return referenceProblems(reference)
}

function parseErrors(value: unknown): string[] {
  const result = referenceSetSchema.safeParse(value)
  return result.success ? [] : result.error.issues.map((issue) => issue.message)
}

function setOf(...references: CaseReference[]): ReferenceSet {
  return { format: REFERENCE_SET_FORMAT, dataset: 'test', dataset_version: '1.0.0', references }
}

let fetchSpy: jest.SpiedFunction<typeof fetch>
beforeEach(() => {
  fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() => { throw new Error('Network access is not allowed in an evaluation.') })
})
afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled()
  jest.restoreAllMocks()
})

describe('reference schema', () => {
  it('accepts a complete reference of each basis', () => {
    for (const basis of ['image_review', 'brief', 'synthetic'] as const) {
      expect(referenceSetSchema.safeParse(fixtureReferences(basis)).success).toBe(true)
    }
  })

  it('carries every field a review needs', () => {
    const reference = fixtureReferences('image_review').references.find((entry) => entry.case_id === 'q-outfit-01') as CaseReference
    expect(Object.keys(reference).sort()).toEqual(['basis', 'case_id', 'dimension_ratings', 'garment_description', 'garment_facts', 'images', 'key_facts', 'occasion', 'provenance', 'reviewed_on', 'reviewer', 'status', 'unverifiable_terms'])
    expect(reference.images[0]).toEqual({ id: 'photo', role: 'photo', path: 'q-outfit-01/photo.jpg', sha256: 'a'.repeat(64) })
    expect(fixtureReferences('image_review')).toMatchObject({ format: 'verdict-reference-set/1', dataset: 'quality-fixture', dataset_version: '1.0.0' })
  })

  it('rejects unknown fields, so nothing unreviewed can ride along', () => {
    expect(parseErrors(setOf({ ...reviewed(), verified: true } as CaseReference)).join(' ')).toMatch(/[Uu]nrecognized key/)
    expect(parseErrors({ ...setOf(reviewed()), approved_by: 'someone' }).join(' ')).toMatch(/[Uu]nrecognized key/)
    const withScore = reviewed()
    ;(withScore.dimension_ratings as Record<string, unknown>).overall = { rating: 'Good' }
    expect(parseErrors(setOf(withScore)).join(' ')).toMatch(/[Uu]nrecognized key/)
  })

  it('rejects an invalid rating, garment type, date, hash, path or version', () => {
    const bad = (change: (reference: CaseReference) => void): boolean => {
      const reference = reviewed()
      change(reference)
      return referenceSetSchema.safeParse(setOf(reference)).success
    }
    expect(bad((reference) => { (reference.dimension_ratings as Record<string, { rating: string }>).occasion.rating = 'Superb' })).toBe(false)
    expect(bad((reference) => { reference.reviewed_on = '2026-02-30' })).toBe(false)
    expect(bad((reference) => { reference.reviewed_on = '17/11/2026' })).toBe(false)
    expect(bad((reference) => { reference.images[0].sha256 = 'abc' })).toBe(false)
    expect(bad((reference) => { reference.images[0].path = '../outside/photo.jpg' })).toBe(false)
    expect(bad((reference) => { reference.images[0].path = 'C:/photos/me.jpg' })).toBe(false)
    expect(bad((reference) => { reference.reviewer = { id: 'Not An Id' } })).toBe(false)
    expect(bad((reference) => { reference.garment_facts = { items: [{ item: 1, garment_type: 'cape' as 'top' }] } })).toBe(false)
    expect(referenceSetSchema.safeParse({ ...setOf(reviewed()), dataset_version: 'v1' }).success).toBe(false)
    expect(referenceSetSchema.safeParse({ ...setOf(reviewed()), format: 'verdict-reference-set/2' }).success).toBe(false)
  })

  it('rejects two references for one case, and repeated ids inside a reference', () => {
    expect(parseErrors(setOf(reviewed(), reviewed())).join(' ')).toMatch(/more than one reference for this case/)
    const repeated = reviewed()
    repeated.key_facts = [...(repeated.key_facts ?? []), ...(repeated.key_facts ?? [])]
    expect(problemsOf(repeated)).toContain('key fact id "colour" is used twice')
    const sameImage = reviewed()
    sameImage.images[1].id = 'photo'
    expect(problemsOf(sameImage)).toContain('image id "photo" is used twice')
  })
})

describe('provenance: what an image review must state', () => {
  it('is complete in the fixture', () => {
    expect(problemsOf(reviewed())).toEqual([])
    expect(tierOf(reviewed())).toBe('image_reviewed')
  })

  it('needs a reviewer and a review date', () => {
    const noReviewer = reviewed()
    delete noReviewer.reviewer
    expect(problemsOf(noReviewer)).toEqual(['a complete review names its reviewer'])
    const noDate = reviewed()
    delete noDate.reviewed_on
    expect(problemsOf(noDate)).toEqual(['a complete review states the day it was done'])
  })

  it('needs a real image, the right to use it, and the hash of every file that was reviewed', () => {
    const synthetic = reviewed()
    synthetic.provenance.image_source = 'synthetic'
    expect(problemsOf(synthetic)).toContain('an image review needs a real image: provenance.image_source must be owned, public_license or approved_volunteer')

    const noRights = reviewed()
    delete noRights.provenance.rights
    expect(problemsOf(noRights)).toEqual(['an image review states the right to use the image in provenance.rights'])

    const unhashed = reviewed()
    delete unhashed.images[1].sha256
    expect(problemsOf(unhashed)).toEqual(['an image review records the SHA-256 of every image; missing for: garment-1'])

    const noImages = reviewed()
    noImages.images = []
    expect(problemsOf(noImages)).toEqual(['an image review lists the personal photo', 'an image review lists at least one garment image'])
  })

  it('needs all six ratings, with "Unable to Evaluate" where a dimension cannot be judged', () => {
    const partial = reviewed()
    delete (partial.dimension_ratings as Record<string, unknown>).seasonality
    delete (partial.dimension_ratings as Record<string, unknown>).style
    expect(problemsOf(partial)).toEqual(['a complete reference rates all six dimensions; missing: seasonality, style (use "Unable to Evaluate" where a dimension cannot be judged)'])
    const unable = reviewed()
    ;(unable.dimension_ratings as Record<string, { rating: string }>).seasonality.rating = 'Unable to Evaluate'
    expect(problemsOf(unable)).toEqual([])
  })

  it('does not let a synthetic expectation look like a human judgement', () => {
    const synthetic = clone(fixtureReferences('synthetic').references[0])
    expect(problemsOf(synthetic)).toEqual([])
    expect(problemsOf({ ...synthetic, reviewer: { id: 'someone' } })).toEqual(['a synthetic expectation carries no reviewer'])
    expect(problemsOf({ ...synthetic, reviewed_on: '2026-11-01' })).toEqual(['a synthetic expectation carries no review date'])
    expect(problemsOf({ ...synthetic, provenance: { image_source: 'owned' } })).toEqual(['a synthetic expectation cannot name a real image source'])
  })

  it('does not accept "complete" without a basis', () => {
    expect(problemsOf({ ...reviewed(), basis: 'unreviewed' })).toContain('a complete reference must state its basis: image_review, brief or synthetic')
  })

  it('reports every problem of a set at once, each with its case', () => {
    const broken = reviewed()
    delete broken.reviewer
    delete broken.provenance.rights
    const cases = fixtureCases('image_review')
    let error: unknown
    try {
      parseReferenceSet(setOf(broken), cases)
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(ReferenceSetError)
    expect((error as ReferenceSetError).problems).toEqual([
      'Reference q-single-01: a complete review names its reviewer',
      'Reference q-single-01: an image review states the right to use the image in provenance.rights',
    ])
  })
})

describe('tiers: reviewed and unreviewed references', () => {
  it('derives the tier from the basis and the status', () => {
    expect(tierOf({ basis: 'image_review', status: 'complete' })).toBe('image_reviewed')
    expect(tierOf({ basis: 'brief', status: 'complete' })).toBe('brief_derived')
    expect(tierOf({ basis: 'synthetic', status: 'complete' })).toBe('synthetic')
    expect(tierOf({ basis: 'unreviewed', status: 'complete' })).toBe('unreviewed')
    for (const status of ['pending', 'in_progress'] as const) {
      for (const basis of ['image_review', 'brief', 'synthetic', 'unreviewed'] as const) expect(tierOf({ basis, status })).toBe('unreviewed')
    }
  })

  it('accepts an unfinished review with gaps, because it is not scored', () => {
    const draft = reviewed()
    draft.status = 'in_progress'
    delete draft.reviewer
    delete draft.dimension_ratings
    expect(problemsOf(draft)).toEqual([])
    expect(tierOf(draft)).toBe('unreviewed')
  })

  it('never scores an unfinished review, even one that already carries ratings', () => {
    const cases = fixtureCases('image_review')
    const references = fixtureReferences('image_review')
    const drafts: ReferenceSet = { ...references, references: references.references.map((reference) => ({ ...reference, status: 'in_progress' as const })) }
    const report = evaluateRecording(fixtureRecording(cases, 'model'), cases, CURRENT, 'replay', { references: parseReferenceSet(drafts, cases) })
    expect(report.references.cases_by_tier).toEqual({ image_reviewed: 0, brief_derived: 0, synthetic: 0, unreviewed: 17 })
    expect(report.references.image_reviewers).toEqual([])
    expect(report.quality.image_grounded_accuracy).toEqual({ status: 'unavailable', reason: UNAVAILABLE_NO_GROUND_TRUTH, cases: 0 })
    for (const tier of ['image_reviewed', 'brief_derived', 'synthetic'] as const) {
      expect(report.quality.agreement[tier].dimensions.occasion.exact_rate.value).toBeNull()
      expect(report.quality.calibration[tier].high_confidence_error_rate.value).toBeNull()
    }
    expect(report.next_steps.join('\n')).toMatch(/Finish the 17 unreviewed reference\(s\); they are not scored\./)
  })

  it('counts cases by tier and names who reviewed what, and when', () => {
    const cases = fixtureCases('image_review')
    const references = fixtureReferences('image_review')
    references.references[0].status = 'pending'
    references.references[1].reviewed_on = '2026-10-15'
    const summary = summarizeReferences({ ...references, references: references.references.slice(0, 10) }, cases)
    expect(summary).toMatchObject({
      status: 'loaded',
      dataset: 'quality-fixture',
      dataset_version: '1.0.0',
      cases_by_tier: { image_reviewed: 9, brief_derived: 0, synthetic: 0, unreviewed: 1 },
      cases_without_reference: 7,
      image_reviewers: ['test-reviewer'],
      image_reviews_from: '2026-10-15',
      image_reviews_to: '2026-11-01',
    })
    expect(summarizeReferences(undefined, cases)).toMatchObject({ status: 'none', fingerprint: null, cases_without_reference: 17 })
  })
})

describe('a reference must describe the case it is scored against', () => {
  const cases = fixtureCases('image_review')

  it('accepts the fixture against its manifest', () => {
    expect(manifestProblems(fixtureReferences('image_review'), cases)).toEqual([])
  })

  it('refuses a reference for a case that is not in the manifest', () => {
    expect(manifestProblems(setOf({ ...reviewed(), case_id: 'q-unknown' }), cases)).toEqual(['Reference q-unknown: no such case in the manifest'])
  })

  it('refuses a different occasion or different images', () => {
    expect(manifestProblems(setOf({ ...reviewed(), occasion: 'Wedding Guest' }), cases)).toEqual(['Reference q-single-01: the occasion differs from the manifest'])
    const otherImage = reviewed()
    otherImage.images[1].path = 'q-single-02/garment-1.jpg'
    expect(manifestProblems(setOf(otherImage), cases)).toEqual(['Reference q-single-01: the images differ from the manifest (they must be the same files in the same order)'])
    const fewer = fixtureReferences('image_review').references.find((reference) => reference.case_id === 'q-views-01') as CaseReference
    expect(manifestProblems(setOf({ ...fewer, images: fewer.images.slice(0, 2) }), cases)[0]).toMatch(/the images differ from the manifest/)
  })

  it('refuses an image review of a case whose manifest says the image is synthetic', () => {
    // The same reviews against a manifest whose cases are marked synthetic.
    expect(manifestProblems(setOf(reviewed()), fixtureCases('synthetic'))).toEqual(['Reference q-single-01: an image review cannot belong to a case whose manifest source is synthetic'])
    expect(manifestProblems(setOf({ ...reviewed(), provenance: { image_source: 'owned', rights: 'Mine' } }), cases)).toEqual(['Reference q-single-01: provenance.image_source differs from the manifest source'])
  })

  it('needs one garment fact per item of an outfit', () => {
    const outfit = clone(fixtureReferences('image_review').references.find((reference) => reference.case_id === 'q-outfit-01') as CaseReference)
    outfit.garment_facts = { items: [{ item: 1, garment_type: 'top' }] }
    expect(manifestProblems(setOf(outfit), cases)).toEqual(['Reference q-outfit-01: an outfit of 2 items needs one garment_facts entry per item'])
    outfit.garment_facts = { items: [{ item: 1, garment_type: 'top' }, { item: 3, garment_type: 'bottom' }] }
    expect(manifestProblems(setOf(outfit), cases)[0]).toMatch(/names an item beyond the 2 garment image\(s\)/)
  })

  it('reports a review dated in the future, given today', () => {
    const set = setOf({ ...reviewed(), reviewed_on: '2027-01-01' })
    expect(futureDatedProblems(set, '2026-11-17')).toEqual(['Reference q-single-01: reviewed_on is in the future'])
    expect(futureDatedProblems(set, '2027-01-01')).toEqual([])
  })
})

describe('fingerprint', () => {
  it('does not depend on the order of the references', () => {
    const set = fixtureReferences('image_review')
    expect(referenceSetFingerprint({ ...set, references: [...set.references].reverse() })).toBe(referenceSetFingerprint(set))
    expect(referenceSetFingerprint(set)).toMatch(/^[0-9a-f]{12}$/)
  })

  it('changes when a rating, a version or a hash changes', () => {
    const set = fixtureReferences('image_review')
    const base = referenceSetFingerprint(set)
    const rating = clone(set)
    ;(rating.references[0].dimension_ratings as Record<string, { rating: string }>).occasion.rating = 'Good'
    const hash = clone(set)
    hash.references[0].images[0].sha256 = 'b'.repeat(64)
    expect(new Set([base, referenceSetFingerprint(rating), referenceSetFingerprint(hash), referenceSetFingerprint({ ...set, dataset_version: '1.0.1' })]).size).toBe(4)
  })
})

describe('reviewed images are tied to their files', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(path.join(os.tmpdir(), 'verdict-refs-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  const sha = (content: string) => createHash('sha256').update(content).digest('hex')

  it('reports an image that is missing or is no longer the file that was reviewed', () => {
    mkdirSync(path.join(dir, 'q-single-01'))
    writeFileSync(path.join(dir, 'q-single-01', 'photo.jpg'), 'photo bytes')
    const reference = reviewed()
    reference.images[0].sha256 = sha('photo bytes')
    reference.images[1].sha256 = sha('garment bytes')
    expect(referenceImageProblems(setOf(reference), dir)).toEqual(['Reference q-single-01: image "garment-1" is not in the image directory'])

    writeFileSync(path.join(dir, 'q-single-01', 'garment-1.jpg'), 'garment bytes')
    expect(referenceImageProblems(setOf(reference), dir)).toEqual([])

    writeFileSync(path.join(dir, 'q-single-01', 'photo.jpg'), 'a different photo')
    expect(referenceImageProblems(setOf(reference), dir)).toEqual(['Reference q-single-01: image "photo" is not the file that was reviewed (its SHA-256 differs)'])
  })

  it('generates stubs with hashes and no judgement, and never touches an existing reference', () => {
    const manifest = { version: 1, cases: fixtureCases('image_review').slice(0, 2) }
    mkdirSync(path.join(dir, 'q-single-01'))
    mkdirSync(path.join(dir, 'q-single-02'))
    writeFileSync(path.join(dir, 'q-single-01', 'photo.jpg'), 'changed after the review')
    writeFileSync(path.join(dir, 'q-single-02', 'photo.jpg'), 'photo two')
    const existing = setOf(reviewed())
    const before = JSON.stringify(existing)

    const { stubs: added, notes } = stubs.plan(manifest, existing, dir)
    expect(JSON.stringify(existing)).toBe(before)
    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({ case_id: 'q-single-02', occasion: 'Client Meeting', basis: 'unreviewed', status: 'pending', provenance: { image_source: 'public_license' } })
    expect(added[0].images).toEqual([
      { id: 'photo', role: 'photo', path: 'q-single-02/photo.jpg', sha256: sha('photo two') },
      { id: 'garment-1', role: 'garment', path: 'q-single-02/garment-1.jpg' },
    ])
    for (const field of ['dimension_ratings', 'garment_facts', 'key_facts', 'reviewer', 'reviewed_on']) expect(added[0]).not.toHaveProperty(field)
    expect(notes).toContain('q-single-02: image not found, no hash recorded: q-single-02/garment-1.jpg')
    expect(notes.some((note) => note.startsWith('q-single-01: image changed since its review (SHA-256 differs): q-single-01/photo.jpg'))).toBe(true)

    // A generated stub is a valid, unreviewed reference.
    const parsed = parseReferenceSet(setOf(...added), manifestSchema.parse(manifest).cases)
    expect(tierOf(parsed.references[0])).toBe('unreviewed')
  })
})

describe('checking references from the command line', () => {
  it('needs a manifest and a reference file, and evaluates nothing', () => {
    expect(resolveEvaluationPlan({ EVAL_MODE: 'check-references', EVAL_CASES: 'c.json', EVAL_REFERENCES: 'r.json', EVAL_IMAGES: 'images' })).toEqual({ mode: 'check_references', casesPath: 'c.json', referencesPath: 'r.json', imagesDir: 'images' })
    expect(resolveEvaluationPlan({ EVAL_MODE: 'check-references', EVAL_CASES: 'c.json' })).toMatchObject({ mode: 'refused' })
    expect(resolveEvaluationPlan({ EVAL_MODE: 'check-references', EVAL_REFERENCES: 'r.json' })).toMatchObject({ mode: 'refused' })
  })

  it('passes a reference file to a replay', () => {
    expect(resolveEvaluationPlan({ EVAL_MODE: 'replay', EVAL_RECORDING: 'r.json', EVAL_CASES: 'c.json', EVAL_REFERENCES: 'refs.json' })).toMatchObject({ mode: 'replay', referencesPath: 'refs.json' })
  })
})

describe('committed reference files', () => {
  function jsonFilesUnder(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name)
      return statSync(full).isDirectory() ? jsonFilesUnder(full) : name.endsWith('.json') ? [full] : []
    })
  }

  const referenceFiles = jsonFilesUnder(path.join(root, 'evaluation'))
    .filter((file) => !file.includes(`${path.sep}reports${path.sep}`))
    .filter((file) => (JSON.parse(readFileSync(file, 'utf8')) as { format?: string }).format === REFERENCE_SET_FORMAT)

  it('are found: the self-test references, the scenarios-v3 synthetic garment facts and the golden template', () => {
    expect(referenceFiles.map((file) => path.relative(root, file).replace(/\\/g, '/')).sort()).toEqual([
      'evaluation/datasets/golden-v1/references.template.json',
      'evaluation/datasets/scenarios-v3/references.json',
      'evaluation/datasets/scenarios-v4/references.json',
      'evaluation/fixtures/mock/references.json',
    ])
  })

  it('contain no image review: no committed file claims that a person reviewed an image', () => {
    for (const file of referenceFiles) {
      const set = referenceSetSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
      expect({ file: path.basename(file), imageReviews: set.references.filter((reference) => reference.basis === 'image_review').length }).toEqual({ file: path.basename(file), imageReviews: 0 })
      expect(set.references.every((reference) => reference.reviewer === undefined)).toBe(true)
    }
  })

  it('include the self-test references, which are synthetic and say so', () => {
    const paths = mockFixturePaths(root)
    const set = loadReferenceSet(paths.referencesPath, loadCases(paths.casesPath))
    expect(set.references.map((reference) => [reference.case_id, tierOf(reference)])).toEqual([
      ['fx-clear-suit', 'synthetic'],
      ['fx-hoodie-wedding', 'synthetic'],
      ['fx-plain-shirt', 'synthetic'],
      ['fx-adversarial-shirt', 'synthetic'],
      ['fx-prohibited', 'unreviewed'],
    ])
  })

  it('include a golden template that is valid, unreviewed and exactly what the stub generator writes', () => {
    const dir = path.join(root, 'evaluation', 'datasets', 'golden-v1')
    const manifest = JSON.parse(readFileSync(path.join(dir, 'cases.template.json'), 'utf8')) as { cases: unknown[] }
    const cases = manifestSchema.parse(manifest).cases
    const template = loadReferenceSet(path.join(dir, 'references.template.json'), cases)
    // A plan, not a review: every reference is an empty stub.
    expect(new Set(template.references.map(tierOf))).toEqual(new Set(['unreviewed']))
    expect(template.references).toHaveLength(cases.length)
    expect(new Set(cases.map((benchmarkCase) => benchmarkCase.garment_mode ?? 'single'))).toEqual(new Set(['single', 'same_garment_views', 'outfit_items']))
    // Apart from the comparison group of a planned pair, a stub is exactly what the reviewer's own command writes.
    const generated = stubs.plan(manifest, { format: REFERENCE_SET_FORMAT, dataset: 'golden-v1', dataset_version: '0.1.0', references: [] }).stubs
    expect(template.references.map(({ comparison_group: _group, ...stub }) => stub)).toEqual(generated)
  })

  it('leave the golden dataset empty until real images have been reviewed', () => {
    const dir = path.join(root, 'evaluation', 'datasets', 'golden-v1')
    // The plan, its empty review stubs and the generated case matrix. No real manifest, no reviews, no image.
    expect(readdirSync(dir).sort()).toEqual(['CASE_MATRIX.md', 'README.md', 'cases.template.json', 'references.template.json'])
  })
})

describe('images are never committed', () => {
  it('tracks no image file under evaluation/ or benchmark/', () => {
    const tracked = execFileSync('git', ['ls-files', 'evaluation', 'benchmark'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)
    expect(tracked.length).toBeGreaterThan(5)
    expect(tracked.filter((file) => /\.(jpe?g|png|webp|gif|heic|heif|bmp|tiff?)$/i.test(file))).toEqual([])
  })

  it('ignores the image directory, the recordings and the reports', () => {
    const ignore = readFileSync(path.join(root, '.gitignore'), 'utf8')
    for (const rule of ['benchmark/data/', 'benchmark/results/', 'evaluation/reports/', 'evaluation/recordings/', 'evaluation/datasets/*/images/']) {
      expect(ignore.split(/\r?\n/)).toContain(rule)
    }
  })
})
