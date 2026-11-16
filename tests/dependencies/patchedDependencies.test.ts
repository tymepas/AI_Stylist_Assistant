/**
 * Guards the dependency versions that were raised to resolve security advisories.
 *
 * Next.js 15.5.x declares an exact, unpatched PostCSS (8.4.31). An npm `overrides`
 * entry makes Next.js use the root copy instead, which is pinned to a patched
 * release. These tests fail if the override is lost, if a second copy of PostCSS
 * comes back, or if any copy of a listed package falls below its patched version.
 *
 * They read package.json, package-lock.json and the installed tree only. They are
 * not a substitute for `npm run audit:check`, which knows about new advisories.
 */

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const root = process.cwd()
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  devDependencies: Record<string, string>
  overrides?: Record<string, unknown>
  resolutions?: Record<string, string>
}
const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8')) as {
  packages: Record<string, { version?: string; dependencies?: Record<string, string> }>
}

/** First PostCSS release that fixes every advisory known on 2026-11-17 (GHSA-fxqj-rqcc-2cmp is the last one). */
const POSTCSS_PATCHED = '8.5.23'

/**
 * Minimum patched version per package, by major version. Every copy in the
 * lockfile must meet the minimum for its major; a major that is not listed fails.
 */
const MINIMUM_VERSIONS: Record<string, Record<number, string>> = {
  postcss: { 8: POSTCSS_PATCHED },
  nanoid: { 3: '3.3.18' }, // GHSA-28wg-ghj8-5hjv, GHSA-2v37-7h3g-55p8
  'source-map-js': { 1: '1.2.2' }, // GHSA-68fv-2mgg-jv7q
  'postcss-selector-parser': { 6: '6.1.5' }, // GHSA-rj75-hqrm-r3gf
  // Development and build tooling. Not deployed, but it runs in CI and in the build.
  handlebars: { 4: '4.7.10' }, // GHSA-8r5x-fm3f-whwj, GHSA-p8wg-vrv2-v86f (critical)
  'js-yaml': { 3: '3.15.2' }, // GHSA-5p4m-2wfm-xmqj, GHSA-2883-xcg3-v3hh
  'brace-expansion': { 1: '1.1.21', 2: '2.1.7' }, // GHSA-q2hr-2g5m-vwhr and earlier
  browserslist: { 4: '4.28.7' }, // GHSA-c83g-rgw3-j3cx, GHSA-73wf-gq98-2v4g
  'baseline-browser-mapping': { 2: '2.11.0' }, // GHSA-w5vr-8v7q-w6rv
}

function parse(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!match) throw new Error(`Not a plain x.y.z version: ${version}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function atLeast(version: string, minimum: string): boolean {
  const a = parse(version)
  const b = parse(minimum)
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] > b[i]
  return true
}

/** Every lockfile entry for a package name, wherever it is nested. */
function copiesOf(name: string): Array<{ location: string; version: string }> {
  return Object.entries(lock.packages)
    .filter(([location]) => location === `node_modules/${name}` || location.endsWith(`/node_modules/${name}`))
    .map(([location, entry]) => ({ location, version: String(entry.version) }))
}

describe('version comparison used by these checks', () => {
  it('orders versions numerically, not as text', () => {
    expect(atLeast('8.5.33', '8.5.23')).toBe(true)
    expect(atLeast('8.5.9', '8.5.23')).toBe(false)
    expect(atLeast('8.10.0', '8.5.23')).toBe(true)
    expect(atLeast('8.5.23', '8.5.23')).toBe(true)
    expect(() => parse('8.5')).toThrow()
  })
})

describe('PostCSS', () => {
  const pinned = packageJson.devDependencies.postcss

  it('is pinned to an exact patched version', () => {
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/)
    expect(atLeast(pinned, POSTCSS_PATCHED)).toBe(true)
  })

  it('is forced on Next.js through an npm override that follows the pinned version', () => {
    expect(packageJson.overrides).toEqual({ next: { postcss: '$postcss' } })
  })

  it('keeps the unused Yarn resolution on the same version, so it cannot reintroduce an old copy', () => {
    expect(packageJson.resolutions?.postcss).toBe(pinned)
  })

  it('exists as a single copy in the lockfile, at the pinned version', () => {
    expect(copiesOf('postcss')).toEqual([{ location: 'node_modules/postcss', version: pinned }])
  })

  it('is the copy Next.js loads from the installed tree', () => {
    expect(existsSync(path.join(root, 'node_modules', 'next', 'node_modules', 'postcss'))).toBe(false)
    const fromNext = createRequire(path.join(root, 'node_modules', 'next', 'package.json')).resolve('postcss/package.json')
    const fromRoot = createRequire(path.join(root, 'package.json')).resolve('postcss/package.json')
    expect(fromNext).toBe(fromRoot)
    expect((JSON.parse(readFileSync(fromNext, 'utf8')) as { version: string }).version).toBe(pinned)
  })

  it('still needs the override: remove it once Next.js declares a patched PostCSS itself', () => {
    const declared = lock.packages['node_modules/next'].dependencies?.postcss
    expect(declared).toMatch(/^\d+\.\d+\.\d+$/)
    expect(atLeast(String(declared), POSTCSS_PATCHED)).toBe(false)
  })
})

describe('packages raised to a patched version', () => {
  it.each(Object.keys(MINIMUM_VERSIONS))('%s: every copy in the lockfile is patched', (name) => {
    const copies = copiesOf(name)
    expect(copies.length).toBeGreaterThan(0)
    for (const copy of copies) {
      const minimum = MINIMUM_VERSIONS[name][parse(copy.version)[0]]
      expect({ ...copy, minimum, known_major: minimum !== undefined }).toMatchObject({ known_major: true })
      expect({ ...copy, minimum, patched: atLeast(copy.version, minimum) }).toMatchObject({ patched: true })
    }
  })

  it.each(['postcss', 'nanoid', 'source-map-js', 'handlebars'])('%s: the installed copy matches the lockfile', (name) => {
    const installed = JSON.parse(readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')) as { version: string }
    expect(installed.version).toBe(lock.packages[`node_modules/${name}`].version)
  })
})
