/**
 * The dependency audit policy: which advisories fail the check, and what a valid
 * exception looks like. Uses synthetic audit reports; no network access.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const policy = require('../../scripts/security/audit-policy.cjs') as {
  evaluateAudit: (report: unknown, exceptions: unknown, today: string) => AuditResult
  collectAdvisories: (report: unknown) => Array<{ id: string | null; package: string; severity: string }> | null
  validateExceptions: (file: unknown) => string[]
  MAX_EXCEPTION_DAYS: number
}

interface AuditResult {
  ok: boolean
  problems: string[]
  unreviewed: Array<{ id: string | null; package: string }>
  expired: Array<{ id: string | null; package: string }>
  excepted: Array<{ id: string | null; package: string; decision: string }>
  belowThreshold: Array<{ id: string | null; package: string }>
  unusedExceptions: Array<{ id: string; package: string }>
  counts: Record<string, number>
}

const HIGH_A = 'GHSA-2222-3333-4444'
const HIGH_B = 'GHSA-5555-6666-7777'
const CRITICAL = 'GHSA-8888-9999-cccc'
const MODERATE = 'GHSA-ffff-gggg-hhhh'
const TODAY = '2026-11-16'

function advisory(id: string, name: string, severity: string) {
  return { source: 1, name, dependency: name, title: `${name} advisory`, url: `https://github.com/advisories/${id}`, severity, range: '<1.0.0' }
}

function report(...entries: Array<{ name: string; via: unknown[] }>) {
  return { auditReportVersion: 2, vulnerabilities: Object.fromEntries(entries.map((entry) => [entry.name, { name: entry.name, severity: 'high', via: entry.via }])) }
}

function exception(overrides: Record<string, unknown> = {}) {
  return {
    package: 'left-pad',
    advisories: [HIGH_A],
    decision: 'pending_fix',
    reason: 'Not imported anywhere in this repository; scheduled for removal.',
    plan: 'Remove the dependency.',
    reviewed: '2026-11-16',
    expires: '2026-12-16',
    ...overrides,
  }
}

const file = (...exceptions: unknown[]) => ({ exceptions })

describe('evaluateAudit', () => {
  it('passes when nothing is reported', () => {
    expect(policy.evaluateAudit(report(), file(), TODAY)).toMatchObject({ ok: true, unreviewed: [], counts: {} })
  })

  it('fails on a high advisory that has no exception', () => {
    const result = policy.evaluateAudit(report({ name: 'left-pad', via: [advisory(HIGH_A, 'left-pad', 'high')] }), file(), TODAY)
    expect(result.ok).toBe(false)
    expect(result.unreviewed).toEqual([expect.objectContaining({ id: HIGH_A, package: 'left-pad' })])
  })

  it('fails on a critical advisory that has no exception', () => {
    const result = policy.evaluateAudit(report({ name: 'left-pad', via: [advisory(CRITICAL, 'left-pad', 'critical')] }), file(), TODAY)
    expect(result.ok).toBe(false)
    expect(result.counts).toEqual({ critical: 1 })
  })

  it('reports moderate and low advisories without failing', () => {
    const result = policy.evaluateAudit(report({ name: 'left-pad', via: [advisory(MODERATE, 'left-pad', 'moderate')] }), file(), TODAY)
    expect(result.ok).toBe(true)
    expect(result.belowThreshold).toEqual([expect.objectContaining({ id: MODERATE })])
  })

  it('passes when the exact advisory has a valid exception', () => {
    const result = policy.evaluateAudit(report({ name: 'left-pad', via: [advisory(HIGH_A, 'left-pad', 'high')] }), file(exception()), TODAY)
    expect(result.ok).toBe(true)
    expect(result.excepted).toEqual([expect.objectContaining({ id: HIGH_A, decision: 'pending_fix' })])
  })

  it('still fails on a new advisory for a package that already has an exception', () => {
    const result = policy.evaluateAudit(
      report({ name: 'left-pad', via: [advisory(HIGH_A, 'left-pad', 'high'), advisory(HIGH_B, 'left-pad', 'high')] }),
      file(exception()),
      TODAY
    )
    expect(result.ok).toBe(false)
    expect(result.unreviewed.map((item) => item.id)).toEqual([HIGH_B])
    expect(result.excepted.map((item) => item.id)).toEqual([HIGH_A])
  })

  it('does not let an exception for one package cover the same advisory id in another', () => {
    const result = policy.evaluateAudit(report({ name: 'right-pad', via: [advisory(HIGH_A, 'right-pad', 'high')] }), file(exception()), TODAY)
    expect(result.ok).toBe(false)
    expect(result.unreviewed).toEqual([expect.objectContaining({ id: HIGH_A, package: 'right-pad' })])
  })

  it('fails once an exception has expired', () => {
    const audit = report({ name: 'left-pad', via: [advisory(HIGH_A, 'left-pad', 'high')] })
    expect(policy.evaluateAudit(audit, file(exception()), '2026-12-16').ok).toBe(true)
    const late = policy.evaluateAudit(audit, file(exception()), '2026-12-17')
    expect(late.ok).toBe(false)
    expect(late.expired).toEqual([expect.objectContaining({ id: HIGH_A })])
  })

  it('counts an advisory once even when several packages report it', () => {
    const shared = advisory(HIGH_A, 'left-pad', 'high')
    const result = policy.evaluateAudit(report({ name: 'left-pad', via: [shared] }, { name: 'wrapper', via: [shared, 'left-pad'] }), file(), TODAY)
    expect(result.counts).toEqual({ high: 1 })
    expect(result.unreviewed).toHaveLength(1)
  })

  it('ignores packages that are flagged only through a dependency', () => {
    const result = policy.evaluateAudit(report({ name: 'wrapper', via: ['left-pad'] }), file(), TODAY)
    expect(result).toMatchObject({ ok: true, counts: {} })
  })

  it('fails on an advisory it cannot identify, and treats an unknown severity as critical', () => {
    const odd = { name: 'left-pad', title: 'Unlisted problem', url: 'https://example.com/advisory/123', severity: 'severe' }
    const result = policy.evaluateAudit(report({ name: 'left-pad', via: [odd] }), file(exception()), TODAY)
    expect(result.ok).toBe(false)
    expect(result.unreviewed).toEqual([expect.objectContaining({ id: null, severity: 'critical' })])
  })

  it('fails when the audit did not complete, rather than passing with nothing to check', () => {
    for (const broken of [null, {}, { error: { code: 'ENOTFOUND' } }, { vulnerabilities: null }]) {
      const result = policy.evaluateAudit(broken, file(), TODAY)
      expect(result.ok).toBe(false)
      expect(result.problems[0]).toMatch(/did not complete/)
    }
  })

  it('lists exceptions that are no longer needed without failing', () => {
    const result = policy.evaluateAudit(report(), file(exception()), TODAY)
    expect(result.ok).toBe(true)
    expect(result.unusedExceptions).toEqual([{ id: HIGH_A, package: 'left-pad' }])
  })

  it('fails when the exceptions file is invalid, even if nothing is reported', () => {
    const result = policy.evaluateAudit(report(), file(exception({ reason: 'ok' })), TODAY)
    expect(result.ok).toBe(false)
    expect(result.problems.join(' ')).toMatch(/reason/)
  })
})

describe('one advisory reported for two packages', () => {
  // Regression: advisories used to be de-duplicated by id alone. When the excepted
  // package came first in the report, the same advisory on a second package was
  // dropped and the check passed.
  const both = (first: string, second: string) =>
    report({ name: first, via: [advisory(HIGH_A, first, 'high')] }, { name: second, via: [advisory(HIGH_A, second, 'high')] })

  it.each([
    ['excepted package listed first', 'left-pad', 'right-pad'],
    ['excepted package listed second', 'right-pad', 'left-pad'],
  ])('fails for the package without an exception: %s', (_label, first, second) => {
    const result = policy.evaluateAudit(both(first, second), file(exception()), TODAY)

    expect(result.ok).toBe(false)
    expect(result.unreviewed.map((item) => [item.package, item.id])).toEqual([['right-pad', HIGH_A]])
    expect(result.excepted.map((item) => [item.package, item.id])).toEqual([['left-pad', HIGH_A]])
    expect(result.counts).toEqual({ high: 2 })
  })

  it('gives the same result whatever order the report lists the packages in', () => {
    const forward = policy.evaluateAudit(both('left-pad', 'right-pad'), file(exception()), TODAY)
    const reverse = policy.evaluateAudit(both('right-pad', 'left-pad'), file(exception()), TODAY)
    expect(reverse).toEqual(forward)
  })

  it('passes only when each package has its own exception', () => {
    const result = policy.evaluateAudit(both('left-pad', 'right-pad'), file(exception(), exception({ package: 'right-pad' })), TODAY)
    expect(result.ok).toBe(true)
    expect(result.excepted.map((item) => item.package)).toEqual(['left-pad', 'right-pad'])
  })

  it('applies expiry to each package separately', () => {
    const result = policy.evaluateAudit(
      both('left-pad', 'right-pad'),
      file(exception(), exception({ package: 'right-pad', reviewed: '2026-09-01', expires: '2026-10-01' })),
      TODAY
    )
    expect(result.ok).toBe(false)
    expect(result.excepted.map((item) => item.package)).toEqual(['left-pad'])
    expect(result.expired.map((item) => item.package)).toEqual(['right-pad'])
  })

  it('does not let an exception for a package that is no longer reported cover another package', () => {
    const result = policy.evaluateAudit(report({ name: 'right-pad', via: [advisory(HIGH_A, 'right-pad', 'high')] }), file(exception()), TODAY)
    expect(result.ok).toBe(false)
    expect(result.unreviewed.map((item) => item.package)).toEqual(['right-pad'])
    expect(result.unusedExceptions).toEqual([{ id: HIGH_A, package: 'left-pad' }])
  })

  it('treats a moderate advisory on one package and a high one on another independently', () => {
    const mixed = report({ name: 'left-pad', via: [advisory(HIGH_A, 'left-pad', 'moderate')] }, { name: 'right-pad', via: [advisory(HIGH_A, 'right-pad', 'high')] })
    const result = policy.evaluateAudit(mixed, file(), TODAY)
    expect(result.ok).toBe(false)
    expect(result.belowThreshold.map((item) => item.package)).toEqual(['left-pad'])
    expect(result.unreviewed.map((item) => item.package)).toEqual(['right-pad'])
  })
})

describe('duplicate and malformed audit records', () => {
  it('counts the same package and advisory once, however many entries repeat it', () => {
    const shared = advisory(HIGH_A, 'left-pad', 'high')
    const repeated = report({ name: 'left-pad', via: [shared, shared] }, { name: 'wrapper-one', via: [shared, 'left-pad'] }, { name: 'wrapper-two', via: ['left-pad', shared] })
    const result = policy.evaluateAudit(repeated, file(exception()), TODAY)
    expect(result.counts).toEqual({ high: 1 })
    expect(result.ok).toBe(true)
    expect(result.excepted).toHaveLength(1)
  })

  it('uses the entry name when an advisory record does not name its package', () => {
    const unnamed = { title: 'unnamed', url: `https://github.com/advisories/${HIGH_A}`, severity: 'high' }
    const result = policy.evaluateAudit(report({ name: 'right-pad', via: [unnamed] }), file(exception()), TODAY)
    expect(result.ok).toBe(false)
    expect(result.unreviewed).toEqual([expect.objectContaining({ package: 'right-pad', id: HIGH_A })])
  })

  it('treats a missing or unknown severity as critical', () => {
    for (const severity of [undefined, null, '', 'HIGH', 'severe', 7]) {
      const record = { name: 'left-pad', title: 't', url: `https://github.com/advisories/${HIGH_A}`, severity }
      const result = policy.evaluateAudit(report({ name: 'left-pad', via: [record] }), file(), TODAY)
      expect(result.ok).toBe(false)
      expect(result.counts).toEqual({ critical: 1 })
    }
  })

  it('fails on an advisory with no usable identifier, even when the package has exceptions', () => {
    for (const record of [{ name: 'left-pad', severity: 'high' }, { name: 'left-pad', severity: 'high', url: 'not a url' }, { name: 'left-pad', severity: 'high', url: 'https://github.com/advisories/GHSA-bad' }]) {
      const result = policy.evaluateAudit(report({ name: 'left-pad', via: [record] }), file(exception()), TODAY)
      expect(result.ok).toBe(false)
      expect(result.unreviewed).toEqual([expect.objectContaining({ package: 'left-pad', id: null })])
    }
  })

  it('keeps two unidentified advisories on one package apart', () => {
    const first = { name: 'left-pad', severity: 'high', title: 'First problem' }
    const second = { name: 'left-pad', severity: 'high', title: 'Second problem' }
    const result = policy.evaluateAudit(report({ name: 'left-pad', via: [first, second] }), file(), TODAY)
    expect(result.unreviewed).toHaveLength(2)
  })

  it('fails when an audit record cannot be read, rather than skipping it', () => {
    const broken: Array<[string, unknown]> = [
      ['no advisory list', { vulnerabilities: { 'left-pad': { name: 'left-pad' } } }],
      ['advisory list is not a list', { vulnerabilities: { 'left-pad': { name: 'left-pad', via: 'left-pad' } } }],
      ['record is null', { vulnerabilities: { 'left-pad': null } }],
      ['advisory is null', { vulnerabilities: { 'left-pad': { name: 'left-pad', via: [null] } } }],
      ['advisory is a number', { vulnerabilities: { 'left-pad': { name: 'left-pad', via: [42] } } }],
      ['advisory is a list', { vulnerabilities: { 'left-pad': { name: 'left-pad', via: [[advisory(HIGH_A, 'left-pad', 'high')]] } } }],
    ]
    for (const [label, audit] of broken) {
      const result = policy.evaluateAudit(audit, file(exception()), TODAY)
      expect({ label, ok: result.ok }).toEqual({ label, ok: false })
      expect(result.problems.join(' ')).toMatch(/audit record for "left-pad"/)
    }
  })

  it('still evaluates the readable records when one record is unreadable', () => {
    const audit = { vulnerabilities: { broken: null, 'right-pad': { name: 'right-pad', via: [advisory(HIGH_B, 'right-pad', 'high')] } } }
    const result = policy.evaluateAudit(audit, file(), TODAY)
    expect(result.ok).toBe(false)
    expect(result.problems).toHaveLength(1)
    expect(result.unreviewed.map((item) => item.package)).toEqual(['right-pad'])
  })

  it('fails when the vulnerabilities section is a list instead of a map', () => {
    const result = policy.evaluateAudit({ vulnerabilities: [] }, file(), TODAY)
    expect(result.ok).toBe(false)
    expect(result.problems[0]).toMatch(/did not complete/)
  })

  it('ignores a malformed exception entry for matching, and reports it as a problem', () => {
    const audit = report({ name: 'left-pad', via: [advisory(HIGH_A, 'left-pad', 'high')] })
    for (const bad of [null, 'left-pad', { advisories: [HIGH_A] }, { package: 42, advisories: [HIGH_A] }]) {
      const result = policy.evaluateAudit(audit, file(bad), TODAY)
      expect(result.ok).toBe(false)
      expect(result.problems.length).toBeGreaterThan(0)
      expect(result.unreviewed.map((item) => item.package)).toEqual(['left-pad'])
    }
  })
})

describe('validateExceptions', () => {
  it('accepts a complete exception', () => {
    expect(policy.validateExceptions(file(exception()))).toEqual([])
  })

  it('rejects a whole-package exception with no advisory ids', () => {
    expect(policy.validateExceptions(file(exception({ advisories: [] }))).join(' ')).toMatch(/Whole packages cannot be excepted/)
    expect(policy.validateExceptions(file(exception({ advisories: undefined }))).join(' ')).toMatch(/Whole packages cannot be excepted/)
  })

  it('rejects wildcards and anything that is not a GHSA id', () => {
    for (const id of ['*', 'all', 'CVE-2026-0001', 'GHSA-xxxx']) {
      expect(policy.validateExceptions(file(exception({ advisories: [id] }))).join(' ')).toMatch(/is not a GHSA id/)
    }
  })

  it('rejects a missing or too-short reason, a missing plan and an unknown decision', () => {
    expect(policy.validateExceptions(file(exception({ reason: 'low risk' }))).join(' ')).toMatch(/reason/)
    expect(policy.validateExceptions(file(exception({ reason: undefined }))).join(' ')).toMatch(/reason/)
    expect(policy.validateExceptions(file(exception({ plan: ' ' }))).join(' ')).toMatch(/plan/)
    expect(policy.validateExceptions(file(exception({ decision: 'ignore' }))).join(' ')).toMatch(/decision/)
  })

  it('requires dates, in order, and no longer than the maximum lifetime', () => {
    expect(policy.validateExceptions(file(exception({ expires: undefined }))).join(' ')).toMatch(/"expires" must be a date/)
    expect(policy.validateExceptions(file(exception({ expires: 'never' }))).join(' ')).toMatch(/"expires" must be a date/)
    expect(policy.validateExceptions(file(exception({ reviewed: '2026-12-20' }))).join(' ')).toMatch(/must be after "reviewed"/)
    expect(policy.MAX_EXCEPTION_DAYS).toBe(180)
    expect(policy.validateExceptions(file(exception({ expires: '2027-05-15' })))).toEqual([])
    expect(policy.validateExceptions(file(exception({ expires: '2027-05-16' }))).join(' ')).toMatch(/at most 180 days/)
  })

  it('rejects the same advisory listed twice for one package', () => {
    expect(policy.validateExceptions(file(exception(), exception())).join(' ')).toMatch(/listed more than once for this package/)
    expect(policy.validateExceptions(file(exception({ advisories: [HIGH_A, HIGH_A] }))).join(' ')).toMatch(/listed more than once for this package/)
  })

  it('allows the same advisory to be excepted separately for two packages', () => {
    // One advisory can affect two packages; each needs its own reviewed entry.
    expect(policy.validateExceptions(file(exception(), exception({ package: 'right-pad' })))).toEqual([])
  })

  it('rejects a file without an exceptions array', () => {
    expect(policy.validateExceptions({})).toHaveLength(1)
    expect(policy.validateExceptions(null)).toHaveLength(1)
  })
})

describe('the committed exceptions file', () => {
  const committed = JSON.parse(readFileSync(path.join(process.cwd(), 'security', 'audit-exceptions.json'), 'utf8')) as {
    exceptions: Array<{ package: string; advisories: string[]; reviewed: string; expires: string; decision: string }>
  }

  it('is structurally valid', () => {
    expect(policy.validateExceptions(committed)).toEqual([])
  })

  it('does not except Next.js or Sharp: those are fixed by updating, not tolerated', () => {
    expect(committed.exceptions.map((entry) => entry.package)).not.toEqual(expect.arrayContaining(['next']))
    expect(committed.exceptions.map((entry) => entry.package)).not.toEqual(expect.arrayContaining(['sharp']))
  })

  it('names individual advisories for every entry', () => {
    for (const entry of committed.exceptions) expect(entry.advisories.length).toBeGreaterThan(0)
  })
})

describe('the audit workflow', () => {
  const workflow = readFileSync(path.join(process.cwd(), '.github', 'workflows', 'dependency-audit.yml'), 'utf8')

  it('runs on pull requests, on main and on a schedule, with a read-only token', () => {
    expect(workflow).toMatch(/pull_request:/)
    expect(workflow).toMatch(/branches: \[main\]/)
    expect(workflow).toMatch(/schedule:/)
    expect(workflow).toMatch(/permissions:\s+contents: read/)
  })

  it('runs the policy script and cannot be made to pass by ignoring its result', () => {
    expect(workflow).toContain('run: node scripts/security/audit-check.cjs')
    expect(workflow).not.toMatch(/continue-on-error|\|\| true|--audit-level=none/)
  })

  it('pins its actions to commit hashes and uses no secrets', () => {
    const uses = workflow.match(/uses: .+/g) ?? []
    expect(uses.length).toBeGreaterThan(0)
    for (const line of uses) expect(line).toMatch(/@[0-9a-f]{40}\b/)
    expect(workflow).not.toMatch(/secrets\./)
  })
})
