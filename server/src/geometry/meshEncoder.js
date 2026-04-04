/**
 * Geometry Service — wire-protocol encoder (ADR-017, Phase B).
 *
 * Converts in-memory geometry (TypedArrays or plain arrays) to the JSON payload
 * sent over WebSocket as a `geometry.update` message.
 *
 * Geometry is encoded as base64 strings to avoid the cost of spreading
 * TypedArrays into plain JS arrays before JSON serialisation.
 * The client decodes the base64 strings back to TypedArrays in SceneService.
 */

/**
 * Encodes geometry data for a single node into a geometry.update payload.
 * Geometry buffers are base64-encoded to minimise serialisation overhead.
 *
 * @param {string} objectId
 * @param {{ positions: Float32Array|number[], normals: Float32Array|number[], indices: Uint32Array|number[] }} geom
 * @returns {{ objectId: string, positionsB64: string, normalsB64: string, indicesB64: string }}
 */
export function encodeGeometryUpdate(objectId, geom) {
  return {
    objectId,
    positionsB64: _toBase64F32(geom.positions),
    normalsB64:   _toBase64F32(geom.normals),
    indicesB64:   _toBase64U32(geom.indices),
  }
}

function _toBase64F32(src) {
  const arr = src instanceof Float32Array ? src : new Float32Array(src)
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString('base64')
}

function _toBase64U32(src) {
  const arr = src instanceof Uint32Array ? src : new Uint32Array(src)
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString('base64')
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
