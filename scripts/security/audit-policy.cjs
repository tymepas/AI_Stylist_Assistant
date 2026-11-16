/**
 * Policy for the dependency audit check. Pure functions, no I/O.
 *
 * The check fails when `npm audit` reports a high or critical advisory for a
 * production dependency, unless that exact advisory is listed in
 * security/audit-exceptions.json with a reason and an expiry date.
 *
 * Every (package, advisory) pair is judged on its own. One advisory id can be
 * reported for several packages; an exception for one of them never covers
 * another, whatever order npm lists them in.
 *
 * Exceptions are deliberately narrow:
 * - they name individual advisories, so a NEW advisory for the same package fails;
 * - they expire, and cannot be valid for longer than MAX_EXCEPTION_DAYS;
 * - a missing or short reason is rejected.
 *
 * A passing check means "no unreviewed high or critical advisory is known for the
 * production dependency tree today". It does not mean the dependencies are free
 * of vulnerabilities.
 */

const FAILING_SEVERITIES = ['high', 'critical']
const SEVERITY_ORDER = ['info', 'low', 'moderate', 'high', 'critical']
const MAX_EXCEPTION_DAYS = 180
const MIN_REASON_LENGTH = 40
const DECISIONS = ['pending_fix', 'accepted_with_mitigation']
const ADVISORY_ID = /^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function advisoryIdFromUrl(url) {
  const id = typeof url === 'string' ? url.split('/').pop() : ''
  return ADVISORY_ID.test(id) ? id : null
}

function parseDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return null
  const time = Date.parse(`${value}T00:00:00Z`)
  return Number.isNaN(time) ? null : time
}

/** Identifies one advisory as it applies to one package. */
function pairKey(packageName, advisoryKey) {
  return JSON.stringify([packageName, advisoryKey])
}

/**
 * Reads an `npm audit --json` report (auditReportVersion 2).
 *
 * Returns one record per (package, advisory) pair, plus a list of records that
 * could not be read. The same pair is often listed under several entries (the
 * package itself and everything that depends on it); it is kept once. The same
 * advisory id under a DIFFERENT package is a different pair and is kept too.
 *
 * Packages that are only flagged because they depend on a vulnerable package
 * carry a package name (a string) instead of an advisory and add nothing here.
 */
function readAuditReport(report) {
  const vulnerabilities = report && typeof report === 'object' ? report.vulnerabilities : null
  if (!vulnerabilities || typeof vulnerabilities !== 'object' || Array.isArray(vulnerabilities)) return null

  const advisories = new Map()
  const malformed = []

  for (const [entryName, entry] of Object.entries(vulnerabilities)) {
    if (!entry || typeof entry !== 'object' || !Array.isArray(entry.via)) {
      malformed.push(`The audit record for "${entryName}" has no advisory list.`)
      continue
    }
    entry.via.forEach((via, index) => {
      // A string names another flagged package: a dependency link, not an advisory.
      if (typeof via === 'string') return
      if (!via || typeof via !== 'object' || Array.isArray(via)) {
        malformed.push(`The audit record for "${entryName}" has an unreadable advisory at position ${index}.`)
        return
      }
      const packageName = typeof via.name === 'string' && via.name ? via.name : entryName
      const id = advisoryIdFromUrl(via.url)
      // An advisory that cannot be identified can never be excepted. It is kept under
      // whatever distinguishes it, so that it is reported and fails the check.
      const key = id || String(via.url || via.title || `unidentified advisory ${index}`)
      const pair = pairKey(packageName, key)
      if (advisories.has(pair)) return
      advisories.set(pair, {
        id,
        key,
        package: packageName,
        // Anything that is not a known severity is treated as the worst one.
        severity: SEVERITY_ORDER.includes(via.severity) ? via.severity : 'critical',
        title: String(via.title || ''),
        url: String(via.url || ''),
        range: String(via.range || ''),
      })
    })
  }

  return {
    advisories: [...advisories.values()].sort((a, b) => a.package.localeCompare(b.package) || a.key.localeCompare(b.key)),
    malformed,
  }
}

/** Every (package, advisory) pair in a report, or null when the report has no vulnerabilities section. */
function collectAdvisories(report) {
  const read = readAuditReport(report)
  return read === null ? null : read.advisories
}

/** Problems with the exceptions file itself. Any problem fails the check. */
function validateExceptions(file) {
  const problems = []
  if (!file || typeof file !== 'object' || !Array.isArray(file.exceptions)) return ['The exceptions file must contain an "exceptions" array.']

  const seen = new Set()
  file.exceptions.forEach((exception, index) => {
    const label = `exceptions[${index}]${exception && exception.package ? ` (${exception.package})` : ''}`
    if (!exception || typeof exception !== 'object') { problems.push(`${label}: must be an object.`); return }
    if (typeof exception.package !== 'string' || !exception.package) problems.push(`${label}: "package" is required.`)
    if (!Array.isArray(exception.advisories) || exception.advisories.length === 0) problems.push(`${label}: "advisories" must list at least one GHSA id. Whole packages cannot be excepted.`)
    for (const id of Array.isArray(exception.advisories) ? exception.advisories : []) {
      if (!ADVISORY_ID.test(id)) { problems.push(`${label}: "${id}" is not a GHSA id.`); continue }
      // The same advisory may legitimately be excepted for two packages; the same pair may not appear twice.
      const pair = pairKey(String(exception.package), id)
      if (seen.has(pair)) problems.push(`${label}: ${id} is listed more than once for this package.`)
      seen.add(pair)
    }
    if (!DECISIONS.includes(exception.decision)) problems.push(`${label}: "decision" must be one of ${DECISIONS.join(', ')}.`)
    if (typeof exception.reason !== 'string' || exception.reason.trim().length < MIN_REASON_LENGTH) problems.push(`${label}: "reason" must explain the decision in at least ${MIN_REASON_LENGTH} characters.`)
    if (typeof exception.plan !== 'string' || !exception.plan.trim()) problems.push(`${label}: "plan" is required.`)
    const reviewed = parseDate(exception.reviewed)
    const expires = parseDate(exception.expires)
    if (reviewed === null) problems.push(`${label}: "reviewed" must be a date (YYYY-MM-DD).`)
    if (expires === null) problems.push(`${label}: "expires" must be a date (YYYY-MM-DD).`)
    if (reviewed !== null && expires !== null) {
      if (expires <= reviewed) problems.push(`${label}: "expires" must be after "reviewed".`)
      if (expires - reviewed > MAX_EXCEPTION_DAYS * 86_400_000) problems.push(`${label}: an exception may last at most ${MAX_EXCEPTION_DAYS} days.`)
    }
  })
  return problems
}

/**
 * Applies the policy.
 * @param report      Parsed `npm audit --json` output.
 * @param exceptions  Parsed security/audit-exceptions.json.
 * @param today       Date as YYYY-MM-DD.
 */
function evaluateAudit(report, exceptions, today) {
  const result = { ok: false, problems: [], unreviewed: [], expired: [], excepted: [], belowThreshold: [], unusedExceptions: [], counts: {} }

  const read = readAuditReport(report)
  if (read === null) {
    result.problems.push('The audit report has no "vulnerabilities" section, so the audit did not complete.')
    return result
  }
  const advisories = read.advisories
  // A record that cannot be read might be hiding an advisory, so it fails the check.
  result.problems.push(...read.malformed)
  const now = parseDate(today)
  if (now === null) {
    result.problems.push(`"${today}" is not a date (YYYY-MM-DD).`)
    return result
  }
  result.problems.push(...validateExceptions(exceptions))

  // Exceptions are looked up by (package, advisory), never by advisory alone.
  const exceptionByPair = new Map()
  for (const exception of (exceptions && Array.isArray(exceptions.exceptions) ? exceptions.exceptions : [])) {
    if (!exception || typeof exception !== 'object' || typeof exception.package !== 'string') continue
    for (const id of Array.isArray(exception.advisories) ? exception.advisories : []) {
      const pair = pairKey(exception.package, id)
      if (!exceptionByPair.has(pair)) exceptionByPair.set(pair, { id, exception })
    }
  }

  const reportedPairs = new Set()
  for (const advisory of advisories) {
    result.counts[advisory.severity] = (result.counts[advisory.severity] || 0) + 1
    if (advisory.id) reportedPairs.add(pairKey(advisory.package, advisory.id))
    if (!FAILING_SEVERITIES.includes(advisory.severity)) { result.belowThreshold.push(advisory); continue }

    const match = advisory.id ? exceptionByPair.get(pairKey(advisory.package, advisory.id)) : undefined
    if (!match) { result.unreviewed.push(advisory); continue }
    const expires = parseDate(match.exception.expires)
    if (expires === null || expires < now) { result.expired.push({ ...advisory, expires: match.exception.expires }); continue }
    result.excepted.push({ ...advisory, decision: match.exception.decision, expires: match.exception.expires })
  }

  for (const [pair, { id, exception }] of exceptionByPair) {
    if (!reportedPairs.has(pair)) result.unusedExceptions.push({ id, package: exception.package })
  }

  result.ok = result.problems.length === 0 && result.unreviewed.length === 0 && result.expired.length === 0
  return result
}

module.exports = { evaluateAudit, collectAdvisories, readAuditReport, validateExceptions, advisoryIdFromUrl, FAILING_SEVERITIES, MAX_EXCEPTION_DAYS, DECISIONS }
