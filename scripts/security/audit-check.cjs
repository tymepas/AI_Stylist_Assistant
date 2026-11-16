#!/usr/bin/env node
/**
 * Dependency audit check: `npm run audit:check`.
 *
 * Runs `npm audit` for production dependencies and applies the policy in
 * audit-policy.cjs against security/audit-exceptions.json. It reads only
 * package.json and package-lock.json, so it needs no installed node_modules.
 *
 * Exit codes: 0 pass, 1 policy failure, 2 the audit could not be completed.
 * An audit that cannot run is a failure, never a pass.
 */

const { spawnSync } = require('node:child_process')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { evaluateAudit, FAILING_SEVERITIES } = require('./audit-policy.cjs')

const root = path.resolve(__dirname, '..', '..')
const exceptionsPath = path.join(root, 'security', 'audit-exceptions.json')

function line(text = '') {
  process.stdout.write(`${text}\n`)
}

function describe(advisory) {
  return `${advisory.package}  ${advisory.severity}  ${advisory.id || advisory.url}  ${advisory.title}`
}

function runAudit() {
  // npm exits non-zero when it finds vulnerabilities; the JSON on stdout is what matters.
  // The arguments are fixed strings, so running through the shell (needed for npm.cmd on Windows) is safe.
  const outcome = spawnSync('npm audit --omit=dev --json', { cwd: root, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (outcome.error) return { error: `npm could not be started: ${outcome.error.message}` }
  try {
    const report = JSON.parse(outcome.stdout)
    if (report && report.error) return { error: `npm audit reported an error: ${report.error.code || ''} ${report.error.summary || ''}`.trim() }
    return { report }
  } catch {
    return { error: 'npm audit did not return JSON.' }
  }
}

function main() {
  let exceptions
  try {
    exceptions = JSON.parse(readFileSync(exceptionsPath, 'utf8'))
  } catch (error) {
    line(`Cannot read ${path.relative(root, exceptionsPath)}: ${error.message}`)
    return 2
  }

  const audit = runAudit()
  if (audit.error) {
    line(`Dependency audit could not be completed: ${audit.error}`)
    line('This is treated as a failure. Re-run the check; nothing is assumed to be safe.')
    return 2
  }

  const today = new Date().toISOString().slice(0, 10)
  const result = evaluateAudit(audit.report, exceptions, today)

  line(`Dependency audit, production dependencies, ${today}`)
  line(`Advisories reported, counted per package: ${Object.entries(result.counts).map(([severity, count]) => `${count} ${severity}`).join(', ') || 'none'}`)
  line(`Policy: ${FAILING_SEVERITIES.join(' and ')} advisories fail unless listed in security/audit-exceptions.json.`)

  const section = (title, items, format) => {
    if (items.length === 0) return
    line()
    line(`${title} (${items.length})`)
    for (const item of items) line(`  - ${format(item)}`)
  }

  section('UNREVIEWED: not covered by an exception', result.unreviewed, describe)
  section('EXPIRED exceptions: decide again or fix', result.expired, (item) => `${describe(item)}  (expired ${item.expires})`)
  section('Problems in the audit report or the exceptions file', result.problems, (item) => item)
  section('Covered by a time-limited exception', result.excepted, (item) => `${describe(item)}  [${item.decision}, until ${item.expires}]`)
  section('Below the failing threshold (reported only)', result.belowThreshold, describe)
  section('Exceptions no longer needed: remove them', result.unusedExceptions, (item) => `${item.package}  ${item.id}`)

  line()
  if (result.ok) {
    line('PASS: no unreviewed high or critical advisory is known for production dependencies.')
    line('This is not a statement that the dependencies are free of vulnerabilities.')
    return 0
  }
  line('FAIL: update the dependency, or add a reviewed, time-limited exception with a reason.')
  return 1
}

process.exit(main())
