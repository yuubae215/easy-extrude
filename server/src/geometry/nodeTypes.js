/**
 * Geometry Service — node type definitions (ADR-017, Phase B).
 *
 * Each node type has:
 *   - defaultParams  — parameter schema with default values
 *   - evaluate(node, inputGeometry[]) → GeometryData
 *
 * GeometryData shape:
 *   { positions: Float32Array, indices: Uint32Array, normals: Float32Array }
 */

/** @typedef {'cuboid'|'sketch'|'extrude'|'stepImport'|'transform'} NodeType */

/**
 * Build 8 corner positions for a box of given half-extents, centred at origin.
 * Corners follow the Cuboid vertex ordering (ADR-007):
 *   0-3 = bottom face, 4-7 = top face (Z-up, ROS frame)
 *
 * @param {number} dx  half-width  (X)
 * @param {number} dy  half-depth  (Y)
 * @param {number} dz  half-height (Z)
 * @returns {number[]}  flat [x0,y0,z0, x1,y1,z1, ...]
 */
function boxCorners(dx, dy, dz) {
  return [
    -dx, -dy, 0,
     dx, -dy, 0,
     dx,  dy, 0,
    -dx,  dy, 0,
    -dx, -dy, dz * 2,
     dx, -dy, dz * 2,
     dx,  dy, dz * 2,
    -dx,  dy, dz * 2,
  ]
}

/**
 * Build indexed triangle mesh for a box defined by 8 corner positions.
 * Returns { positions: number[], indices: number[], normals: number[] }.
 *
 * @param {number[]} corners  24-element flat array (8 × xyz)
 */
function boxMesh(corners) {
  // Face definitions: each face = [v0, v1, v2, v3] (quad split into 2 tris)
  // and an outward normal direction.
  const faces = [
    { verts: [0, 1, 5, 4], nx:  0, ny: -1, nz:  0 }, // front (-Y)
    { verts: [2, 3, 7, 6], nx:  0, ny:  1, nz:  0 }, // back  (+Y)
    { verts: [1, 2, 6, 5], nx:  1, ny:  0, nz:  0 }, // right (+X)
    { verts: [3, 0, 4, 7], nx: -1, ny:  0, nz:  0 }, // left  (-X)
    { verts: [4, 5, 6, 7], nx:  0, ny:  0, nz:  1 }, // top   (+Z)
    { verts: [0, 3, 2, 1], nx:  0, ny:  0, nz: -1 }, // bottom(-Z)
  ]

  const positions = []
  const normals   = []
  const indices   = []
  let base = 0

  for (const { verts, nx, ny, nz } of faces) {
    for (const vi of verts) {
      positions.push(corners[vi * 3], corners[vi * 3 + 1], corners[vi * 3 + 2])
      normals.push(nx, ny, nz)
    }
    // Two triangles: 0-1-2 and 0-2-3
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    base += 4
  }

  return { positions, normals, indices }
}

// ── Node type registry ──────────────────────────────────────────────────────

export const NODE_TYPES = {

  /** A parametric axis-aligned box (default shape). */
  cuboid: {
    defaultParams: { sizeX: 1, sizeY: 1, sizeZ: 1, posX: 0, posY: 0, posZ: 0 },
    evaluate(node /*, inputs */) {
      const { sizeX = 1, sizeY = 1, sizeZ = 1 } = node.params
      const corners = boxCorners(sizeX / 2, sizeY / 2, sizeZ / 2)
      // Apply translation from transform field if present
      const { translation = [0, 0, 0] } = node.transform ?? {}
      for (let i = 0; i < 8; i++) {
        corners[i * 3]     += translation[0]
        corners[i * 3 + 1] += translation[1]
        corners[i * 3 + 2] += translation[2]
      }
      return boxMesh(corners)
    },
  },

  /** A 2D rectangle on the ground plane (Z=0). No geometry until extruded. */
  sketch: {
    defaultParams: { x0: 0, y0: 0, x1: 1, y1: 1 },
    evaluate(node /*, inputs */) {
      // Sketches produce no mesh on their own; geometry flows after extrude
      return { positions: [], normals: [], indices: [] }
    },
  },

  /** Extrudes the upstream sketch/face along Z by `height`. */
  extrude: {
    defaultParams: { height: 1 },
    evaluate(node, inputs) {
      const upstream = inputs[0]
      if (!upstream) return { positions: [], normals: [], indices: [] }

      // Simplified: re-use upstream positions as bottom, offset by height for top
      const { positions: pos, normals: nrm, indices: idx } = upstream
      const h = node.params?.height ?? 1

      // Deep-copy and extend upward — full mesh rebuild not needed for prototype
      const positions = [...pos]
      const normals   = [...nrm]
      const indices   = [...idx]
      // Apply height offset to all positions that belong to "top" half (z=0 → z=h)
      // This is a prototype-quality approximation; replace with proper CSG in Phase C.
      for (let i = 2; i < positions.length; i += 3) {
        positions[i] += h
      }
      return { positions, normals, indices }
    },
  },

  /** Placeholder for STEP import result. Geometry is populated externally. */
  stepImport: {
    defaultParams: { filename: '' },
    evaluate(node /*, inputs */) {
      // Geometry is set on node.cachedGeometry after STEP processing completes
      return node.cachedGeometry ?? { positions: [], normals: [], indices: [] }
    },
  },

  /** Pure transform node — passes upstream geometry through with a translation. */
  transform: {
    defaultParams: {},
    evaluate(node, inputs) {
      const upstream = inputs[0]
      if (!upstream) return { positions: [], normals: [], indices: [] }
      const { translation = [0, 0, 0] } = node.transform ?? {}
      const positions = [...upstream.positions]
      for (let i = 0; i < positions.length; i += 3) {
        positions[i]     += translation[0]
        positions[i + 1] += translation[1]
        positions[i + 2] += translation[2]
      }
      return { positions, normals: [...upstream.normals], indices: [...upstream.indices] }
    },
  },
}

/**
 * Returns default params for a given node type.
 * @param {NodeType} type
 * @returns {object}
 */
export function defaultParamsFor(type) {
  return { ...(NODE_TYPES[type]?.defaultParams ?? {}) }
}
