/**
 * Geometry Service — wire-protocol encoder (ADR-017, Phase B).
 *
 * Converts in-memory geometry (plain arrays) to the JSON payload
 * sent over WebSocket as a `geometry.update` message.
 *
 * For Phase B, positions/normals/indices are sent as plain number arrays.
 * Phase C can optimise to binary (e.g. base64-encoded Float32Array).
 */

/**
 * Encodes geometry data for a single node into a geometry.update payload.
 *
 * @param {string} objectId   The scene object id this geometry belongs to
 * @param {{ positions: number[], normals: number[], indices: number[] }} geom
 * @returns {{ objectId: string, positions: number[], normals: number[], indices: number[] }}
 */
export function encodeGeometryUpdate(objectId, geom) {
  return {
    objectId,
    positions: Array.isArray(geom.positions) ? geom.positions : [...geom.positions],
    normals:   Array.isArray(geom.normals)   ? geom.normals   : [...geom.normals],
    indices:   Array.isArray(geom.indices)   ? geom.indices   : [...geom.indices],
  }
}

/**
 * Encodes a complete graph snapshot for the `graph.snapshot` message.
 * Strips cachedGeometry from nodes (sent separately as geometry.update).
 *
 * @param {import('./geometryGraph.js').OperationGraph} graph
 * @returns {{ nodes: object[], edges: object[] }}
 */
export function encodeGraphSnapshot(graph) {
  return graph.toJSON()
}
