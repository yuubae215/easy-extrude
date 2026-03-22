/**
 * WebSocket Session Manager (ADR-017, Phase B).
 *
 * Each browser tab that connects gets one Session object with:
 *   - sessionId (UUID)
 *   - ws (WebSocket connection)
 *   - operationGraph (OperationGraph | null)
 *   - sceneId (string | null) — set after session.resume
 *
 * Sessions are stored in-memory only. All sessions are lost on BFF restart.
 * Clients should reconnect and send `session.resume` to restore graph state.
 */

import { v4 as uuidv4 } from 'uuid'
import { OperationGraph, CycleError } from '../geometry/geometryGraph.js'
import { evaluateGraph, evaluateSubgraph } from '../geometry/evaluator.js'
import { encodeGeometryUpdate, encodeGraphSnapshot } from '../geometry/meshEncoder.js'
import { getScene, updateScene } from '../services/sceneStore.js'

/** @type {Map<string, Session>} */
const sessions = new Map()

class Session {
  /** @param {import('ws').WebSocket} ws */
  constructor(ws) {
    this.sessionId = `sess_${uuidv4().replace(/-/g, '').slice(0, 16)}`
    this.ws        = ws
    /** @type {OperationGraph|null} */
    this.graph     = null
    this.sceneId   = null
  }

  /** Send a typed message to this session's client. */
  send(type, payload = {}) {
    if (this.ws.readyState !== 1 /* OPEN */) return
    this.ws.send(JSON.stringify({ type, sessionId: this.sessionId, payload }))
  }

  /** Send an error message. */
  sendError(code, message, requestOp) {
    this.send('error', { code, message, requestOp })
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Creates a new session for an incoming WebSocket connection.
 * Sends `session.ready` to the client.
 * @param {import('ws').WebSocket} ws
 * @returns {Session}
 */
export function createSession(ws) {
  const session = new Session(ws)
  sessions.set(session.sessionId, session)
  session.send('session.ready', { sessionId: session.sessionId })
  return session
}

/**
 * Removes a session (called on WebSocket close).
 * @param {string} sessionId
 */
export function removeSession(sessionId) {
  sessions.delete(sessionId)
}

/**
 * Dispatches an incoming message to the correct handler.
 * @param {Session} session
 * @param {string} raw  raw JSON string from the WebSocket
 */
export async function handleMessage(session, raw) {
  let msg
  try {
    msg = JSON.parse(raw)
  } catch {
    session.sendError('PARSE_ERROR', 'Message is not valid JSON', null)
    return
  }

  const { op, payload = {} } = msg

  switch (op) {
    case 'session.resume':   return handleResume(session, payload)
    case 'graph.node.add':   return handleNodeAdd(session, payload)
    case 'graph.node.remove':return handleNodeRemove(session, payload)
    case 'graph.edge.add':   return handleEdgeAdd(session, payload)
    case 'graph.edge.remove':return handleEdgeRemove(session, payload)
    case 'graph.node.setParam': return handleSetParam(session, payload)
    case 'import.step':      return handleStepImport(session, payload)
    default:
      session.sendError('UNKNOWN_OP', `Unknown operation: ${op}`, op)
  }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleResume(session, { sceneId }) {
  if (!sceneId) {
    // No existing scene — start with empty graph
    session.graph   = new OperationGraph()
    session.sceneId = null
    session.send('graph.snapshot', encodeGraphSnapshot(session.graph))
    return
  }

  let row
  try {
    row = await getScene(sceneId)
  } catch (err) {
    session.sendError('DB_ERROR', err.message, 'session.resume')
    return
  }

  if (!row) {
    session.sendError('SCENE_NOT_FOUND', `Scene ${sceneId} not found`, 'session.resume')
    return
  }

  const data = row.data
  session.graph   = OperationGraph.fromJSON(data.operationGraph ?? {})
  session.sceneId = sceneId

  // Send full snapshot
  session.send('graph.snapshot', encodeGraphSnapshot(session.graph))

  // Evaluate all nodes and stream geometry
  const results = evaluateGraph(session.graph)
  _streamGeometry(session, results)
}

function handleNodeAdd(session, { node }) {
  if (!_ensureGraph(session, 'graph.node.add')) return
  try {
    const added = session.graph.addNode(node)
    // Evaluate just the new node
    const results = evaluateSubgraph(session.graph, added.id)
    session.send('graph.node.add', { node: added })
    _streamGeometry(session, results)
    _autosave(session)
  } catch (err) {
    session.sendError('EVAL_ERROR', err.message, 'graph.node.add')
  }
}

function handleNodeRemove(session, { nodeId }) {
  if (!_ensureGraph(session, 'graph.node.remove')) return
  const removed = session.graph.removeNode(nodeId)
  if (!removed) {
    session.sendError('NODE_NOT_FOUND', `Node ${nodeId} not found`, 'graph.node.remove')
    return
  }
  session.send('graph.node.remove', { nodeId })
  _autosave(session)
}

function handleEdgeAdd(session, { edge }) {
  if (!_ensureGraph(session, 'graph.edge.add')) return
  try {
    const added = session.graph.addEdge(edge)
    // Re-evaluate downstream of the new edge's target
    const results = evaluateSubgraph(session.graph, added.targetId)
    session.send('graph.edge.add', { edge: added })
    _streamGeometry(session, results)
    _autosave(session)
  } catch (err) {
    if (err instanceof CycleError) {
      session.sendError('CYCLE_DETECTED', err.message, 'graph.edge.add')
    } else {
      session.sendError('EVAL_ERROR', err.message, 'graph.edge.add')
    }
  }
}

function handleEdgeRemove(session, { edgeId }) {
  if (!_ensureGraph(session, 'graph.edge.remove')) return
  const removed = session.graph.removeEdge(edgeId)
  if (!removed) {
    session.sendError('EDGE_NOT_FOUND', `Edge ${edgeId} not found`, 'graph.edge.remove')
    return
  }
  session.send('graph.edge.remove', { edgeId })
  _autosave(session)
}

function handleSetParam(session, { nodeId, param, value }) {
  if (!_ensureGraph(session, 'graph.node.setParam')) return
  const ok = session.graph.setNodeParam(nodeId, param, value)
  if (!ok) {
    session.sendError('NODE_NOT_FOUND', `Node ${nodeId} not found`, 'graph.node.setParam')
    return
  }
  // Re-evaluate changed node and downstream
  const results = evaluateSubgraph(session.graph, nodeId)
  session.send('graph.node.setParam', { nodeId, param, value })
  _streamGeometry(session, results)
  _autosave(session)
}

async function handleStepImport(session, { jobId, filename, data: base64 }) {
  if (!_ensureGraph(session, 'import.step')) return

  session.send('import.progress', { jobId, percent: 0, status: 'started' })

  try {
    // Lazy-load occt-import-js (WASM); fall back gracefully if unavailable
    let occt
    try {
      const mod = await import('occt-import-js')
      occt = await mod.default()
    } catch {
      session.send('import.progress', { jobId, percent: 0, status: 'unavailable',
        message: 'occt-import-js not installed — stub result used' })
      // Insert a stub StepImportNode so the graph is still updated
      _insertStepStub(session, jobId, filename)
      return
    }

    session.send('import.progress', { jobId, percent: 10, status: 'loading' })
    const buffer = Buffer.from(base64, 'base64')
    session.send('import.progress', { jobId, percent: 30, status: 'parsing' })

    const result = occt.ReadStepFile(new Uint8Array(buffer), null)
    session.send('import.progress', { jobId, percent: 80, status: 'converting' })

    if (!result.success) {
      session.sendError('STEP_PARSE_ERROR', 'STEP parsing failed', 'import.step')
      return
    }

    // Flatten all mesh data from the STEP result
    const positions = [], normals = [], indices = []
    let offset = 0
    for (const mesh of result.meshes ?? []) {
      for (const face of mesh.faces ?? []) {
        const pos = face.position?.array ?? []
        const nrm = face.normal?.array   ?? []
        const idx = face.index?.array    ?? []
        positions.push(...pos)
        normals.push(...nrm)
        indices.push(...idx.map(i => i + offset))
        offset += pos.length / 3
      }
    }

    // Add a StepImportNode to the graph
    const node = session.graph.addNode({
      type: 'stepImport',
      label: filename,
      params: { filename },
    })
    node.cachedGeometry = { positions, normals, indices }

    session.send('import.progress', { jobId, percent: 100, status: 'done' })
    session.send('graph.node.add', { node })
    _streamGeometry(session, new Map([[node.id, node.cachedGeometry]]))
    _autosave(session)
  } catch (err) {
    session.sendError('STEP_ERROR', err.message, 'import.step')
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _ensureGraph(session, op) {
  if (session.graph) return true
  // Auto-create graph on first operation if resume was skipped
  session.graph = new OperationGraph()
  return true
}

function _streamGeometry(session, results) {
  for (const [nodeId, geom] of results) {
    // Use objectId from the node if available, otherwise fall back to nodeId
    const node = session.graph?.getNode(nodeId)
    const objectId = node?.objectId ?? nodeId
    session.send('geometry.update', encodeGeometryUpdate(objectId, geom))
  }
}

/** Persists the current graph state back to the scene DB (fire-and-forget). */
async function _autosave(session) {
  if (!session.sceneId || !session.graph) return
  try {
    const row  = await getScene(session.sceneId)
    if (!row) return
    const data = row.data
    data.operationGraph = session.graph.toJSON()
    await updateScene(session.sceneId, { data })
  } catch (err) {
    console.warn('[SessionManager] autosave failed:', err.message)
  }
}

/** Inserts a stub StepImportNode when occt-import-js is not available. */
function _insertStepStub(session, jobId, filename) {
  const node = session.graph.addNode({
    type: 'stepImport',
    label: filename,
    params: { filename },
  })
  session.send('graph.node.add', { node })
  _autosave(session)
}
