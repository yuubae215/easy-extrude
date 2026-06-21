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
 * Internal token header the external grasp-search service requires.
 *
 * SCOPE BOUNDARY: this is the *external service's internal spec* (it gates its
 * private endpoint on a shared token), not part of the neutral contract and not
 * solving logic. The value is read ONLY from env (GRASP_SEARCH_TOKEN) and never
 * hardcoded; when unset the header is omitted (backward compatible).
 */
const INTERNAL_TOKEN_HEADER = 'X-Internal-Token'

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
  const url = graspSearchUrl()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  // Internal token (external service's private spec). Read from env only; when
  // unset the header is omitted so existing setups keep working unchanged.
  const headers = { 'content-type': 'application/json' }
  const token = process.env.GRASP_SEARCH_TOKEN
  if (token) headers[INTERNAL_TOKEN_HEADER] = token

  let res
  try {
    res = await fetch(url, {
      method:  'POST',
      headers,
      body:    JSON.stringify(request),
      signal:  controller.signal,
    })
  } catch (err) {
    const reason = err?.name === 'AbortError' ? 'timed out' : `unreachable (${err?.message})`
    throw new GraspServiceError(`grasp-search service ${reason}`, 503)
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    throw new GraspServiceError(
      `grasp-search service returned ${res.status}`,
      res.status >= 500 ? 502 : res.status,
    )
  }

  try {
    return await res.json()
  } catch {
    throw new GraspServiceError('grasp-search service returned non-JSON body', 502)
  }
}
