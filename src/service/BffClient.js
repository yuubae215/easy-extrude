/**
 * BffClient — HTTP + WebSocket client for the BFF (ADR-015, ADR-017).
 *
 * Phase A: REST API for scene CRUD.
 * Phase B: WebSocket channel for geometry streaming (WsChannel).
 *
 * Usage:
 *   const client = new BffClient()
 *   const scenes = await client.listScenes()
 *   const ws     = client.openWs()
 *   ws.on('geometry.update', payload => { ... })
 *   ws.send('session.resume', { sceneId })
 *
 * When the BFF is unreachable, REST methods throw BffUnavailableError.
 * WsChannel emits 'close' and 'error' events so callers can reconnect.
 */

export class BffUnavailableError extends Error {
  constructor(cause) {
    super('BFF unavailable')
    this.name = 'BffUnavailableError'
    this.cause = cause
  }
}

// ── WsChannel ─────────────────────────────────────────────────────────────────

/**
 * Wraps a native WebSocket with typed send/on API (ADR-017).
 *
 * send(op, payload)   → sends { op, payload } to the server
 * on(type, handler)   → registers a handler for server-pushed { type, payload } messages
 * close()             → closes the WebSocket
 */
export class WsChannel {
  /**
   * @param {string} url  WebSocket URL, e.g. ws://localhost:3001/api/ws
   */
  constructor(url) {
    this._url             = url
    this._ws              = null
    this._handlers        = /** @type {Map<string, Function[]>} */ (new Map())
    this._sessionId       = null
    this._open            = false
    this._manuallyClosed  = false
    this._reconnectDelay  = 1000   // ms; doubles on each failure, caps at 30 s
    this._reconnectTimer  = null
    this._connect()
  }

  /**
   * Sends an operation message to the BFF.
   * @param {string} op
   * @param {object} [payload]
   */
  send(op, payload = {}) {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
      console.warn(`[WsChannel] Cannot send ${op} — socket not open`)
      return
    }
    this._ws.send(JSON.stringify({ op, payload }))
  }

  /**
   * Registers a handler for a server-pushed message type.
   * @param {string} type
   * @param {(payload: object) => void} handler
   * @returns {() => void}  unsubscribe function
   */
  on(type, handler) {
    if (!this._handlers.has(type)) this._handlers.set(type, [])
    this._handlers.get(type).push(handler)
    return () => {
      const list = this._handlers.get(type)
      if (list) {
        const i = list.indexOf(handler)
        if (i >= 0) list.splice(i, 1)
      }
    }
  }

  /**
   * Returns the server-assigned sessionId (available after 'session.ready').
   * @returns {string|null}
   */
  get sessionId() { return this._sessionId }

  /** Whether the underlying WebSocket is currently open. */
  get isOpen() { return this._open }

  /** Permanently closes the channel. No auto-reconnect after this. */
  close() {
    this._manuallyClosed = true
    clearTimeout(this._reconnectTimer)
    this._destroySocket()
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  _destroySocket() {
    if (this._ws) {
      this._ws.removeEventListener('open',    this._onWsOpen)
      this._ws.removeEventListener('message', this._onWsMessage)
      this._ws.removeEventListener('close',   this._onWsClose)
      this._ws.removeEventListener('error',   this._onWsError)
      this._ws.close()
      this._ws = null
    }
  }

  _connect() {
    let ws
    try {
      ws = new WebSocket(this._url)
    } catch (err) {
      this._emit('error', { message: err.message })
      this._scheduleReconnect()
      return
    }
    this._ws = ws

    this._onWsOpen = () => {
      this._open = true
      this._reconnectDelay = 1000  // reset backoff on successful connect
      this._emit('open', {})
    }
    this._onWsMessage = (event) => {
      let msg
      try { msg = JSON.parse(event.data) } catch { return }
      const { type, sessionId, payload = {} } = msg
      if (sessionId) this._sessionId = sessionId
      this._emit(type, payload)
    }
    this._onWsClose = (event) => {
      this._open = false
      this._emit('close', { code: event.code, reason: event.reason })
      if (!this._manuallyClosed) this._scheduleReconnect()
    }
    this._onWsError = () => { this._emit('error', { message: 'WebSocket error' }) }

    ws.addEventListener('open',    this._onWsOpen)
    ws.addEventListener('message', this._onWsMessage)
    ws.addEventListener('close',   this._onWsClose)
    ws.addEventListener('error',   this._onWsError)
  }

  _scheduleReconnect() {
    if (this._manuallyClosed) return
    console.log(`[WsChannel] Reconnecting in ${this._reconnectDelay}ms…`)
    this._reconnectTimer = setTimeout(() => {
      this._destroySocket()
      this._reconnectDelay = Math.min(this._reconnectDelay * 2, 30_000)
      this._connect()
    }, this._reconnectDelay)
  }

  _emit(type, payload) {
    for (const handler of this._handlers.get(type) ?? []) {
      try { handler(payload) } catch (err) {
        console.error(`[WsChannel] Handler error for ${type}:`, err)
      }
    }
  }
}

// ── BffClient ─────────────────────────────────────────────────────────────────

export class BffClient {
  /**
   * @param {string} [baseUrl]  defaults to '/api' (proxied by Vite in dev)
   */
  constructor(baseUrl = '/api') {
    this._base  = baseUrl
    this._token = null
    /** @type {WsChannel|null} */
    this._ws    = null
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

  // ── WebSocket (Phase B) ─────────────────────────────────────────────────────

  /**
   * Opens a WebSocket channel to the BFF Geometry Service.
   * Idempotent — returns the existing channel if already open.
   * @returns {WsChannel}
   */
  openWs() {
    if (this._ws?.isOpen) return this._ws
    // Derive WS URL from the HTTP base URL
    const wsUrl = this._wsUrl()
    this._ws = new WsChannel(wsUrl)
    return this._ws
  }

  /**
   * Returns the current WsChannel (null if not opened yet).
   * @returns {WsChannel|null}
   */
  get ws() { return this._ws }

  /**
   * Closes the WebSocket channel (if open).
   */
  closeWs() {
    this._ws?.close()
    this._ws = null
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

  // ── STEP import (Phase B) ───────────────────────────────────────────────────

  /**
   * Uploads a STEP file for import. Returns the parsed mesh data.
   * Progress notifications are also streamed via the WebSocket channel.
   * @param {File} file  browser File object
   * @returns {Promise<{ jobId: string, filename: string, status: string, mesh: object }>}
   */
  async importStep(file, { scale = 1, sessionId = null } = {}) {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('scale', String(scale))
    if (sessionId) formData.append('sessionId', sessionId)

    const url     = this._base + '/import/step'
    const headers = {}
    if (this._token) headers['Authorization'] = `Bearer ${this._token}`

    let res
    try {
      res = await fetch(url, { method: 'POST', headers, body: formData })
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
    return res.json()
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

  /**
   * Converts the HTTP base URL to a WebSocket URL.
   * e.g. '/api' → 'ws://localhost:3001/api/ws' (via Vite proxy in dev)
   * or 'https://bff.example.com/api' → 'wss://bff.example.com/api/ws'
   */
  _wsUrl() {
    if (this._base.startsWith('http')) {
      return this._base.replace(/^http/, 'ws') + '/ws'
    }
    // Relative base (Vite proxy): use current host
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${location.host}${this._base}/ws`
  }
}
