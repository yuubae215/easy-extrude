/**
 * Geometry Service — DAG evaluator (ADR-017, Phase B).
 *
 * Performs topological-sort traversal of the OperationGraph,
 * calling each node's evaluate() function with its upstream geometry.
 * Results are cached on node.cachedGeometry.
 *
 * Returns a map of nodeId → GeometryData for all nodes that produced geometry.
 */

import { NODE_TYPES } from './nodeTypes.js'

/**
 * Evaluates all nodes in the graph in topological order.
 *
 * @param {import('./geometryGraph.js').OperationGraph} graph
 * @returns {Map<string, { positions: number[], normals: number[], indices: number[] }>}
 *   Map from nodeId to evaluated geometry (only non-empty results included)
 */
export function evaluateGraph(graph) {
  const sorted  = graph.topoSort()
  const results = new Map()   // nodeId → GeometryData

  for (const node of sorted) {
    const handler = NODE_TYPES[node.type]
    if (!handler) continue

    const inputGeometry = graph.inputsOf(node.id)
      .map(src => results.get(src.id))
      .filter(Boolean)

    const geom = handler.evaluate(node, inputGeometry)
    node.cachedGeometry = geom

    if (geom.positions.length > 0) {
      results.set(node.id, geom)
    }
  }

  return results
}

/**
 * Re-evaluates a single node and all of its downstream dependants.
 * Useful for incremental updates when only one node's params change.
 *
 * @param {import('./geometryGraph.js').OperationGraph} graph
 * @param {string} changedNodeId
 * @returns {Map<string, { positions: number[], normals: number[], indices: number[] }>}
 */
export function evaluateSubgraph(graph, changedNodeId) {
  // Find the set of nodes that need re-evaluation (changed node + descendants)
  const dirty = new Set()
  const markDirty = (id) => {
    if (dirty.has(id)) return
    dirty.add(id)
    for (const edge of graph.edges) {
      if (edge.sourceId === id) markDirty(edge.targetId)
    }
  }
  markDirty(changedNodeId)

  // Evaluate only dirty nodes in topo order
  const sorted  = graph.topoSort().filter(n => dirty.has(n.id))
  const results = new Map()

  for (const node of sorted) {
    const handler = NODE_TYPES[node.type]
    if (!handler) continue

    const inputGeometry = graph.inputsOf(node.id)
      .map(src => src.cachedGeometry ?? results.get(src.id))
      .filter(Boolean)

    const geom = handler.evaluate(node, inputGeometry)
    node.cachedGeometry = geom
    if (geom.positions.length > 0) results.set(node.id, geom)
  }

  return results
}
