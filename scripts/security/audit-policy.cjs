/**
 * Policy for the dependency audit check. Pure functions, no I/O.
 *
 * The check fails when `npm audit` reports a high or critical advisory for a
 * production dependency, unless that exact advisory is listed in
 * security/audit-exceptions.json with a reason and an expiry date.
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

/**
 * Every distinct advisory in an `npm audit --json` report (auditReportVersion 2).
 * Packages that are only flagged because they depend on a vulnerable package
 * carry no advisory of their own and add nothing here.
 */
function collectAdvisories(report) {
  const advisories = new Map()
  const vulnerabilities = report && typeof report === 'object' ? report.vulnerabilities : null
  if (!vulnerabilities || typeof vulnerabilities !== 'object') return null

  for (const entry of Object.values(vulnerabilities)) {
    for (const via of Array.isArray(entry.via) ? entry.via : []) {
      if (!via || typeof via !== 'object') continue
      const id = advisoryIdFromUrl(via.url)
      // An advisory that cannot be identified can never be excepted, so it is kept under its URL.
      const key = id || String(via.url || via.title || 'unidentified')
      if (advisories.has(key)) continue
      advisories.set(key, {
        id,
        key,
        package: String(via.name || entry.name || 'unknown'),
        severity: SEVERITY_ORDER.includes(via.severity) ? via.severity : 'critical',
        title: String(via.title || ''),
        url: String(via.url || ''),
        range: String(via.range || ''),
      })
    }
  }
  return [...advisories.values()].sort((a, b) => a.package.localeCompare(b.package) || a.key.localeCompare(b.key))
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
      if (!ADVISORY_ID.test(id)) problems.push(`${label}: "${id}" is not a GHSA id.`)
      else if (seen.has(id)) problems.push(`${label}: ${id} is listed more than once.`)
      seen.add(id)
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

  const advisories = collectAdvisories(report)
  if (advisories === null) {
    result.problems.push('The audit report has no "vulnerabilities" section, so the audit did not complete.')
    return result
  }
  const now = parseDate(today)
  if (now === null) {
    result.problems.push(`"${today}" is not a date (YYYY-MM-DD).`)
    return result
  }
  result.problems.push(...validateExceptions(exceptions))

  const byAdvisory = new Map()
  for (const exception of (exceptions && Array.isArray(exceptions.exceptions) ? exceptions.exceptions : [])) {
    for (const id of Array.isArray(exception.advisories) ? exception.advisories : []) byAdvisory.set(id, exception)
  }

  const reported = new Set()
  for (const advisory of advisories) {
    result.counts[advisory.severity] = (result.counts[advisory.severity] || 0) + 1
    if (advisory.id) reported.add(advisory.id)
    if (!FAILING_SEVERITIES.includes(advisory.severity)) { result.belowThreshold.push(advisory); continue }

    const exception = advisory.id ? byAdvisory.get(advisory.id) : undefined
    // An exception written for one package never covers an advisory in another.
    if (!exception || exception.package !== advisory.package) { result.unreviewed.push(advisory); continue }
    const expires = parseDate(exception.expires)
    if (expires === null || expires < now) { result.expired.push({ ...advisory, expires: exception.expires }); continue }
    result.excepted.push({ ...advisory, decision: exception.decision, expires: exception.expires })
  }

  for (const [id, exception] of byAdvisory) {
    if (!reported.has(id)) result.unusedExceptions.push({ id, package: exception.package })
  }

  result.ok = result.problems.length === 0 && result.unreviewed.length === 0 && result.expired.length === 0
  return result
}

module.exports = { evaluateAudit, collectAdvisories, validateExceptions, advisoryIdFromUrl, FAILING_SEVERITIES, MAX_EXCEPTION_DAYS, DECISIONS }
