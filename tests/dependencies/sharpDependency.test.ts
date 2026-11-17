/**
 * Dependency check for sharp, which is now an explicit, pinned dependency.
 *
 * This verifies only that the pinned version is the one installed, that there is
 * a single copy, and that its native binary loads and works on the platform the
 * tests run on (Windows locally, Linux x64 in CI on Node 22 and 24).
 *
 * The application uses sharp for server-side image intake
 * (lib/images/normalizeImage.ts, covered by tests/images/normalizeImage.test.ts).
 * This file only checks the dependency itself.
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import sharp from 'sharp'

const root = process.cwd()
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8')) as {
  packages: Record<string, { version?: string; optional?: boolean; optionalDependencies?: Record<string, string> }>
}

describe('sharp dependency', () => {
  it('is a direct dependency pinned to an exact version', () => {
    expect(packageJson.dependencies.sharp).toBe('0.35.5')
  })

  it('is installed at the pinned version and is no longer optional in the lockfile', () => {
    const installed = JSON.parse(readFileSync(path.join(root, 'node_modules', 'sharp', 'package.json'), 'utf8')) as { version: string }
    expect(installed.version).toBe('0.35.5')
    expect(lock.packages['node_modules/sharp']).toMatchObject({ version: '0.35.5' })
    expect(lock.packages['node_modules/sharp'].optional).toBeUndefined()
  })

  it('exists as a single copy shared with Next.js', () => {
    const nested = Object.keys(lock.packages).filter((name) => name.endsWith('/sharp') && name !== 'node_modules/sharp')
    expect(nested).toEqual([])
    const fromNext = createRequire(path.join(root, 'node_modules', 'next', 'package.json')).resolve('sharp')
    const fromRoot = createRequire(path.join(root, 'package.json')).resolve('sharp')
    expect(fromNext).toBe(fromRoot)
  })

  it('pins the Linux x64 binaries that CI and the deployment target need', () => {
    for (const name of ['@img/sharp-linux-x64', '@img/sharp-libvips-linux-x64', '@img/sharp-linuxmusl-x64']) {
      expect(lock.packages[`node_modules/${name}`]?.version).toBeDefined()
    }
    expect(lock.packages['node_modules/@img/sharp-linux-x64'].version).toBe('0.35.5')
  })

  it('satisfies the range Next.js declares for it', () => {
    expect(lock.packages['node_modules/next'].optionalDependencies?.sharp).toBe('^0.34.3 || ^0.35.5')
  })

  it('loads its native binary on this platform and reports the library versions', () => {
    expect(sharp.versions.sharp).toBe('0.35.5')
    expect(sharp.versions.vips).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('can encode and decode JPEG, PNG and WEBP with the loaded binary', async () => {
    const source = sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 10, g: 120, b: 200 } } })
    for (const format of ['jpeg', 'png', 'webp'] as const) {
      const encoded = await source.clone().toFormat(format).toBuffer()
      const metadata = await sharp(encoded).metadata()
      expect([metadata.format, metadata.width, metadata.height]).toEqual([format, 16, 16])
    }
  })
})
