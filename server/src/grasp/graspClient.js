/**
 * grasp-search service client.
 *
 * SCOPE BOUNDARY (CLAUDE.md): the BFF *delegates* constraint solving to the
 * external grasp-search service. This module only forwards the wire request and
 * returns the wire response — it does NOT implement IK / collision / reach /
 * ranking. Those live in the external service.
 *
 * The request/response shapes are governed by @easy-extrude/grasp-contract;
 * schema conformance is enforced by the route, not here.
 */

/** Default upstream endpoint; override with GRASP_SEARCH_URL. */
const DEFAULT_URL = 'http://localhost:4001/grasp-search'

/**
 * Error thrown when the external grasp-search service is unreachable or returns
 * a non-2xx status. The route maps this to a 502/503.
 */
export class GraspServiceError extends Error {
  /** @param {string} message @param {number} [status] */
  constructor(message, status = 502) {
    super(message)
    this.name = 'GraspServiceError'
    this.status = status
  }
}

/**
 * Whether the external service endpoint is configured/known.
 * @returns {string}
 */
export function graspSearchUrl() {
  return process.env.GRASP_SEARCH_URL ?? DEFAULT_URL
}

/**
 * The core API's criteria-trial endpoint (ADR-165 D6). Same service as
 * grasp-search, so it is derived from `GRASP_SEARCH_URL` — one env var names the
 * core API (ADR-076: URLs are injected, never baked in).
 * @returns {string}
 */
export function criteriaTrialUrl() {
  return new URL('/criteria-trial', graspSearchUrl()).toString()
}

/**
 * Forward a (schema-valid) request to the external grasp-search service and
 * return the parsed JSON response. Conformance of both ends is checked by the
 * caller against the contract schema.
 *
 * @param {object} request  Schema-valid GraspSearchRequest (wire/camelCase)
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=20000]
 * @returns {Promise<unknown>} parsed JSON (validated by the caller)
 */
export async function callGraspSearch(request, { timeoutMs = 20000 } = {}) {
  return postToCore(graspSearchUrl(), 'grasp-search', request, { timeoutMs })
}

/**
 * Forward a (schema-valid) criteria-trial request to the core API (ADR-165 D6).
 * Conformance of both ends is checked by the caller.
 *
 * @param {object} request  Schema-valid CriteriaTrialRequest (wire/camelCase)
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=20000]
 * @returns {Promise<unknown>}
 */
export async function callCriteriaTrial(request, { timeoutMs = 20000 } = {}) {
  return postToCore(criteriaTrialUrl(), 'criteria-trial', request, { timeoutMs })
}

async function postToCore(url, name, request, { timeoutMs }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let res
  try {
    res = await fetch(url, {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify(request),
      signal:  controller.signal,
    })
  } catch (err) {
    const reason = err?.name === 'AbortError' ? 'timed out' : `unreachable (${err?.message})`
    throw new GraspServiceError(`${name} service ${reason}`, 503)
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    // A 4xx from the core API carries a reason the sender can act on (e.g. a
    // line that cannot be judged — ADR-165); keep it instead of a bare status.
    let reason = ''
    try {
      const body = await res.json()
      if (typeof body?.error?.message === 'string') reason = ` — ${body.error.message}`
    } catch { /* no JSON envelope: the status is all there is */ }
    throw new GraspServiceError(
      `${name} service returned ${res.status}${reason}`,
      res.status >= 500 ? 502 : res.status,
    )
  }

  try {
    return await res.json()
  } catch {
    throw new GraspServiceError(`${name} service returned non-JSON body`, 502)
  }
}
