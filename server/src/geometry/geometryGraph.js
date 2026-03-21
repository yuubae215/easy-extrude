/**
 * OperationGraph — DAG of geometry nodes (ADR-017, Phase B).
 *
 * Extends TransformGraph (ADR-016) with:
 *   - OperationNode: type + params + transform + cachedGeometry
 *   - OperationEdge: dataType ('geometry'|'transform'|'control')
 *   - Cycle detection on addEdge (DFS)
 *   - Serialisation to/from plain JSON (stored in scene data.operationGraph)
 */

import { v4 as uuidv4 } from 'uuid'
import { defaultParamsFor } from './nodeTypes.js'

/**
 * @typedef {{
 *   id: string,
 *   type: string,
 *   objectId: string|null,
 *   label: string,
 *   params: object,
 *   transform: { translation: number[], rotation: number[] },
 *   cachedGeometry?: object
 * }} OperationNode
 *
 * @typedef {{
 *   id: string,
 *   sourceId: string,
 *   targetId: string,
 *   dataType: 'geometry'|'transform'|'control'
 * }} OperationEdge
 */

export class CycleError extends Error {
  constructor(edgeId) {
    super(`Adding edge ${edgeId} would create a cycle`)
    this.name = 'CycleError'
  }
}

export class OperationGraph {
  constructor() {
    /** @type {Map<string, OperationNode>} */
    this._nodes = new Map()
    /** @type {Map<string, OperationEdge>} */
    this._edges = new Map()
  }

  // ── Accessors ──────────────────────────────────────────────────────────────

  get nodes() { return [...this._nodes.values()] }
  get edges() { return [...this._edges.values()] }

  getNode(id) { return this._nodes.get(id) ?? null }
  getEdge(id) { return this._edges.get(id) ?? null }

  // ── Mutations ──────────────────────────────────────────────────────────────

  /**
   * Adds a new OperationNode. Generates an id if not provided.
   * @param {{ type: string, objectId?: string, label?: string, params?: object, transform?: object }} opts
   * @returns {OperationNode}
   */
  addNode({ type, objectId = null, label = '', params = {}, transform } = {}) {
    const id = `gnode_${uuidv4().replace(/-/g, '').slice(0, 12)}`
    const node = {
      id,
      type,
      objectId,
      label: label || `${type}_${this._nodes.size}`,
      params: { ...defaultParamsFor(type), ...params },
      transform: transform ?? { translation: [0, 0, 0], rotation: [0, 0, 0, 1] },
    }
    this._nodes.set(id, node)
    return node
  }

  /**
   * Removes a node and all edges connected to it.
   * @param {string} nodeId
   * @returns {boolean}  true if the node existed
   */
  removeNode(nodeId) {
    if (!this._nodes.has(nodeId)) return false
    for (const [eid, edge] of this._edges) {
      if (edge.sourceId === nodeId || edge.targetId === nodeId) {
        this._edges.delete(eid)
      }
    }
    this._nodes.delete(nodeId)
    return true
  }

  /**
   * Connects two nodes. Throws CycleError if it would create a cycle.
   * @param {{ sourceId: string, targetId: string, dataType?: string }} opts
   * @returns {OperationEdge}
   */
  addEdge({ sourceId, targetId, dataType = 'geometry' }) {
    const id = `gedge_${uuidv4().replace(/-/g, '').slice(0, 12)}`
    // Temporarily add edge and check for cycle
    const edge = { id, sourceId, targetId, dataType }
    this._edges.set(id, edge)
    if (this._hasCycle()) {
      this._edges.delete(id)
      throw new CycleError(id)
    }
    return edge
  }

  /**
   * Removes an edge.
   * @param {string} edgeId
   * @returns {boolean}
   */
  removeEdge(edgeId) {
    return this._edges.delete(edgeId)
  }

  /**
   * Updates params of an existing node.
   * @param {string} nodeId
   * @param {string} param
   * @param {*} value
   * @returns {boolean}
   */
  setNodeParam(nodeId, param, value) {
    const node = this._nodes.get(nodeId)
    if (!node) return false
    node.params[param] = value
    return true
  }

  // ── Cycle detection (DFS) ──────────────────────────────────────────────────

  _hasCycle() {
    const visited  = new Set()
    const inStack  = new Set()

    const dfs = (nodeId) => {
      if (inStack.has(nodeId)) return true
      if (visited.has(nodeId)) return false
      visited.add(nodeId)
      inStack.add(nodeId)
      for (const edge of this._edges.values()) {
        if (edge.sourceId === nodeId) {
          if (dfs(edge.targetId)) return true
        }
      }
      inStack.delete(nodeId)
      return false
    }

    for (const id of this._nodes.keys()) {
      if (dfs(id)) return true
    }
    return false
  }

  // ── Topological sort ──────────────────────────────────────────────────────

  /**
   * Returns nodes in topological order (sources first).
   * Assumes no cycles (call after addEdge succeeds).
   * @returns {OperationNode[]}
   */
  topoSort() {
    const inDegree = new Map()
    for (const id of this._nodes.keys()) inDegree.set(id, 0)
    for (const { targetId } of this._edges.values()) {
      inDegree.set(targetId, (inDegree.get(targetId) ?? 0) + 1)
    }

    const queue  = []
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id)
    }

    const result = []
    while (queue.length) {
      const id = queue.shift()
      result.push(this._nodes.get(id))
      for (const edge of this._edges.values()) {
        if (edge.sourceId === id) {
          const newDeg = inDegree.get(edge.targetId) - 1
          inDegree.set(edge.targetId, newDeg)
          if (newDeg === 0) queue.push(edge.targetId)
        }
      }
    }
    return result
  }

  /**
   * Returns all upstream input nodes for a given node (direct sources only).
   * @param {string} nodeId
   * @returns {OperationNode[]}
   */
  inputsOf(nodeId) {
    const sources = []
    for (const edge of this._edges.values()) {
      if (edge.targetId === nodeId) {
        const src = this._nodes.get(edge.sourceId)
        if (src) sources.push(src)
      }
    }
    return sources
  }

  // ── Serialisation ──────────────────────────────────────────────────────────

  toJSON() {
    return {
      nodes: this.nodes.map(n => ({ ...n, cachedGeometry: undefined })),
      edges: this.edges,
    }
  }

  /**
   * Reconstructs an OperationGraph from a plain JSON object.
   * @param {{ nodes: object[], edges: object[] }} json
   * @returns {OperationGraph}
   */
  static fromJSON({ nodes = [], edges = [] } = {}) {
    const g = new OperationGraph()
    for (const n of nodes) g._nodes.set(n.id, { ...n })
    for (const e of edges) g._edges.set(e.id, { ...e })
    return g
  }
}
