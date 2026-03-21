/**
 * BffClient — HTTP client for the BFF REST API (ADR-015, Phase A).
 *
 * Usage:
 *   const client = new BffClient()            // uses /api by default
 *   const scenes = await client.listScenes()
 *   const scene  = await client.saveScene({ name, data })
 *
 * When the BFF is unreachable (network error / 5xx), methods throw a
 * BffUnavailableError so callers can fall back to local-only mode.
 *
 * Auth: Phase A sends the dev JWT if one has been fetched; otherwise
 * requests are sent without a token (BFF accepts this in dev mode).
 */

export class BffUnavailableError extends Error {
  constructor(cause) {
    super('BFF unavailable')
    this.name = 'BffUnavailableError'
    this.cause = cause
  }
}

export class BffClient {
  /**
   * @param {string} [baseUrl]  defaults to '/api' (proxied by Vite in dev)
   */
  constructor(baseUrl = '/api') {
    this._base = baseUrl
    this._token = null  // set after fetchToken()
  }

  // ── Auth ────────────────────────────────────────────────────────────────────

  /**
   * Obtains a dev JWT from the BFF and caches it for subsequent requests.
   * Safe to call multiple times (no-op if token already cached).
   */
  async fetchToken() {
    if (this._token) return
    const res = await this._request('GET', '/auth/token', null, false)
    this._token = res.token
  }

  // ── Scene CRUD ──────────────────────────────────────────────────────────────

  /**
   * Lists all scenes (metadata only, no full data payload).
   * @returns {Promise<{ id: string, name: string, created_at: string, updated_at: string }[]>}
   */
  listScenes() {
    return this._request('GET', '/scenes')
  }

  /**
   * Fetches the full scene including objects and transformGraph.
   * @param {string} id
   * @returns {Promise<{ id, name, data: object, created_at, updated_at }>}
   */
  getScene(id) {
    return this._request('GET', `/scenes/${id}`)
  }

  /**
   * Saves a new scene. Returns the created scene with server-assigned id.
   * @param {{ name: string, data: object }} scene
   * @returns {Promise<{ id, name, data, created_at, updated_at }>}
   */
  saveScene({ name, data }) {
    return this._request('POST', '/scenes', { name, data })
  }

  /**
   * Updates an existing scene (partial patch — send only changed fields).
   * @param {string} id
   * @param {{ name?: string, data?: object }} patch
   * @returns {Promise<{ id, name, updated_at }>}
   */
  updateScene(id, patch) {
    return this._request('PUT', `/scenes/${id}`, patch)
  }

  /**
   * Deletes a scene.
   * @param {string} id
   * @returns {Promise<void>}
   */
  async deleteScene(id) {
    await this._request('DELETE', `/scenes/${id}`, null, true, true)
  }

  // ── Health ──────────────────────────────────────────────────────────────────

  /**
   * Checks if the BFF is reachable. Returns true/false (never throws).
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    try {
      await this._request('GET', '/health', null, false)
      return true
    } catch {
      return false
    }
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  /**
   * @param {string}  method
   * @param {string}  path       relative to base URL
   * @param {object|null} body
   * @param {boolean} auth       whether to send Authorization header
   * @param {boolean} expectEmpty  true for 204 No Content responses
   */
  async _request(method, path, body = null, auth = true, expectEmpty = false) {
    const url     = this._base + path
    const headers = { 'Content-Type': 'application/json' }
    if (auth && this._token) headers['Authorization'] = `Bearer ${this._token}`

    let res
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body != null ? JSON.stringify(body) : undefined,
      })
    } catch (err) {
      throw new BffUnavailableError(err)
    }

    if (res.status >= 500) {
      const text = await res.text().catch(() => '')
      throw new BffUnavailableError(new Error(`Server error ${res.status}: ${text}`))
    }

    if (!res.ok) {
      const payload = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(payload.error ?? `HTTP ${res.status}`)
    }

    if (expectEmpty || res.status === 204) return
    return res.json()
  }
}
