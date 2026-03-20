/**
 * CuboidModel - pure data model and side-effect-free pure functions
 *
 * No side effects. Every function returns a value based solely on its arguments.
 */
import * as THREE from 'three'

//
// ROS world frame: +X forward, +Y left, +Z up (right-handed)
//
//      6─────7
//     /|    /|    +Z up
//    5─────4 |    +Y left
//    | 2───|─3    +X front (toward viewer)
//    |/    |/
//    1─────0
//
// Face definitions: 4 corner indices in CCW order as seen from outside
export const FACES = [
  { name: 'Front (+X)', corners: [1, 2, 6, 5] }, // fi=0
  { name: 'Back (-X)',  corners: [0, 4, 7, 3] }, // fi=1
  { name: 'Top (+Z)',   corners: [4, 5, 6, 7] }, // fi=2
  { name: 'Bottom (-Z)', corners: [1, 0, 3, 2] }, // fi=3
  { name: 'Left (+Y)',  corners: [2, 3, 7, 6] }, // fi=4
  { name: 'Right (-Y)', corners: [1, 5, 4, 0] }, // fi=5
]

/** Pure factory that creates the initial corner array */
export function createInitialCorners() {
  return [
    new THREE.Vector3(-1, -1, -1), // 0 back-right-bottom
    new THREE.Vector3( 1, -1, -1), // 1 front-right-bottom
    new THREE.Vector3( 1,  1, -1), // 2 front-left-bottom
    new THREE.Vector3(-1,  1, -1), // 3 back-left-bottom
    new THREE.Vector3(-1, -1,  1), // 4 back-right-top
    new THREE.Vector3( 1, -1,  1), // 5 front-right-top
    new THREE.Vector3( 1,  1,  1), // 6 front-left-top
    new THREE.Vector3(-1,  1,  1), // 7 back-left-top
  ]
}

/** Pure function that computes the normal vector of face fi */
export function computeFaceNormal(corners, fi) {
  const [a, b, , d] = FACES[fi].corners
  const ab = new THREE.Vector3().subVectors(corners[b], corners[a])
  const ad = new THREE.Vector3().subVectors(corners[d], corners[a])
  return new THREE.Vector3().crossVectors(ab, ad).normalize()
}

/**
 * Pure function that computes the outward-facing normal of face fi.
 * Corrects sign so the normal always points away from the centroid,
 * even when a face has been pushed past the opposite face.
 */
export function computeOutwardFaceNormal(corners, fi) {
  const n = computeFaceNormal(corners, fi)
  const faceCorners = FACES[fi].corners
  const faceCenter = faceCorners
    .reduce((acc, ci) => acc.add(corners[ci]), new THREE.Vector3())
    .divideScalar(faceCorners.length)
  const objCentroid = getCentroid(corners)
  if (faceCenter.sub(objCentroid).dot(n) < 0) n.negate()
  return n
}

/** Pure function that builds a BufferGeometry from the corner array */
export function buildGeometry(corners) {
  const pos  = new Float32Array(72) // 6 faces × 4 verts × 3
  const norm = new Float32Array(72)
  const idx  = []

  FACES.forEach((face, fi) => {
    const rawN = computeFaceNormal(corners, fi)
    const n    = computeOutwardFaceNormal(corners, fi)
    // Inversion check: if the outward normal is opposite to the raw normal, flip winding too.
    // DoubleSide shading auto-flips the normal when gl_FrontFacing=false; by keeping winding
    // consistent we ensure gl_FrontFacing=true so shading stays accurate.
    const inverted = n.dot(rawN) < 0
    face.corners.forEach((ci, vi) => {
      const i = (fi * 4 + vi) * 3
      const v = corners[ci]
      pos[i]  = v.x; pos[i+1]  = v.y; pos[i+2]  = v.z
      norm[i] = n.x; norm[i+1] = n.y; norm[i+2] = n.z
    })
    const b = fi * 4
    if (inverted) {
      idx.push(b, b+2, b+1,  b, b+3, b+2)
    } else {
      idx.push(b, b+1, b+2,  b, b+2, b+3)
    }
  })

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('normal',   new THREE.BufferAttribute(norm, 3))
  geo.setIndex(idx)
  return geo
}

/** Pure function that returns vertex positions for a face highlight quad */
export function buildFaceHighlightPositions(corners, fi) {
  const pos = new Float32Array(12) // 4 verts × 3
  FACES[fi].corners.forEach((ci, vi) => {
    const v = corners[ci]
    const i = vi * 3
    pos[i] = v.x; pos[i+1] = v.y; pos[i+2] = v.z
  })
  return pos
}

/** Pure function that returns the centroid of the corner array */
export function getCentroid(corners) {
  const c = new THREE.Vector3()
  corners.forEach(v => c.add(v))
  return c.divideScalar(corners.length)
}

/** Pure function that converts mouse coordinates to NDC */
export function toNDC(clientX, clientY, width, height) {
  return new THREE.Vector2(
    (clientX / width)  *  2 - 1,
    (clientY / height) * -2 + 1,
  )
}

/**
 * Pure function that builds a corners[8] array from a 2D rect + height.
 * p1, p2 are XY positions (z ignored). height is in world Z units.
 * The resulting cuboid sits on Z=0 (or below if height is negative).
 * @param {THREE.Vector3} p1
 * @param {THREE.Vector3} p2
 * @param {number} height
 * @returns {THREE.Vector3[]}
 */
export function buildCuboidFromRect(p1, p2, height) {
  const minX = Math.min(p1.x, p2.x), maxX = Math.max(p1.x, p2.x)
  const minY = Math.min(p1.y, p2.y), maxY = Math.max(p1.y, p2.y)
  const zMin = Math.min(0, height), zMax = Math.max(0, height)
  return [
    new THREE.Vector3(minX, minY, zMin), // 0 back-right-bottom
    new THREE.Vector3(maxX, minY, zMin), // 1 front-right-bottom
    new THREE.Vector3(maxX, maxY, zMin), // 2 front-left-bottom
    new THREE.Vector3(minX, maxY, zMin), // 3 back-left-bottom
    new THREE.Vector3(minX, minY, zMax), // 4 back-right-top
    new THREE.Vector3(maxX, minY, zMax), // 5 front-right-top
    new THREE.Vector3(maxX, maxY, zMax), // 6 front-left-top
    new THREE.Vector3(minX, maxY, zMax), // 7 back-left-top
  ]
}

/**
 * Collects snap target positions from a scene objects map.
 * @param {Map<string, import('../domain/Cuboid.js').Cuboid | import('../domain/Sketch.js').Sketch>} objects
 * @param {'all'|'vertex'|'edge'|'face'} [mode='all']
 *   'vertex' — Vertex positions only
 *   'edge'   — Edge midpoints only
 *   'face'   — Face centers
 *   'all'    — all of the above
 * @param {Set<string>} [excludeIds=new Set()] — object IDs to skip (e.g. objects currently being grabbed)
 * @returns {{ label: string, position: THREE.Vector3, type: string }[]}
 */
export function collectSnapTargets(objects, mode = 'all', excludeIds = new Set()) {
  const doVert  = mode === 'all' || mode === 'vertex'
  const doEdge  = mode === 'all' || mode === 'edge'
  const doFace  = mode === 'all' || mode === 'face'
  const targets = []

  for (const [id, obj] of objects.entries()) {
    if (excludeIds.has(id)) continue
    if (!obj.vertices) continue

    if (doVert) {
      for (const v of obj.vertices) {
        targets.push({ label: `${obj.name} Vertex`, position: v.position, type: 'vertex' })
      }
    }

    if (doEdge && obj.edges) {
      for (const e of obj.edges) {
        const mid = e.v0.position.clone().add(e.v1.position).multiplyScalar(0.5)
        targets.push({ label: `${obj.name} Edge`, position: mid, type: 'edge' })
      }
    }

    if (doFace && obj.faces) {
      for (const f of obj.faces) {
        const center = f.vertices
          .reduce((acc, v) => acc.add(v.position), new THREE.Vector3())
          .divideScalar(f.vertices.length)
        targets.push({ label: `${obj.name} ${f.name}`, position: center, type: 'face' })
      }
    }
  }

  return targets
}

/**
 * Returns world-space snap targets: world origin + projections onto X/Y/Z axes.
 * Axis targets are the closest point on each axis to pivotAfter.
 * @param {THREE.Vector3} pivotAfter  projected pivot position (pivot + current delta)
 * @returns {{ label: string, position: THREE.Vector3, type: string }[]}
 */
export function collectWorldSnapTargets(pivotAfter) {
  return [
    { label: 'World Origin', position: new THREE.Vector3(0, 0, 0),                              type: 'world' },
    { label: 'X Axis',       position: new THREE.Vector3(pivotAfter.x, 0,            0),         type: 'world' },
    { label: 'Y Axis',       position: new THREE.Vector3(0,            pivotAfter.y, 0),         type: 'world' },
    { label: 'Z Axis',       position: new THREE.Vector3(0,            0,            pivotAfter.z), type: 'world' },
  ]
}

// 12 unique edges of a cuboid defined by corner index pairs (matches Cuboid.js EDGE_PAIRS)
const PIVOT_EDGE_PAIRS = [
  [0, 1], [1, 2], [2, 3], [3, 0],  // bottom ring
  [4, 5], [5, 6], [6, 7], [7, 4],  // top ring
  [0, 4], [1, 5], [2, 6], [3, 7],  // vertical pillars
]

/**
 * Pivot candidates: 8 vertices only.
 * @param {THREE.Vector3[]} corners
 * @returns {{ label: string, position: THREE.Vector3, type: string }[]}
 */
export function getVertexPivotCandidates(corners) {
  return corners.map((c, i) => ({ label: `Vertex ${i}`, position: c.clone(), type: 'vertex' }))
}

/**
 * Pivot candidates: 12 edge midpoints only.
 * @param {THREE.Vector3[]} corners
 * @returns {{ label: string, position: THREE.Vector3, type: string }[]}
 */
export function getEdgePivotCandidates(corners) {
  return PIVOT_EDGE_PAIRS.map(([a, b], i) => ({
    label: `Edge ${i}`,
    position: corners[a].clone().add(corners[b]).multiplyScalar(0.5),
    type: 'edge',
  }))
}

/**
 * Pivot candidates: 6 face centers.
 * @param {THREE.Vector3[]} corners
 * @returns {{ label: string, position: THREE.Vector3, type: string }[]}
 */
export function getFacePivotCandidates(corners) {
  return FACES.map(face => {
    const center = face.corners
      .reduce((acc, ci) => acc.add(corners[ci].clone()), new THREE.Vector3())
      .divideScalar(face.corners.length)
    return { label: face.name, position: center, type: 'face' }
  })
}

/**
 * Pivot candidates: all of the above combined (8 vertices + 12 edge midpoints + 6 face centers).
 * @param {THREE.Vector3[]} corners
 * @returns {{ label: string, position: THREE.Vector3, type: string }[]}
 */
export function getPivotCandidates(corners) {
  return [
    ...getVertexPivotCandidates(corners),
    ...getEdgePivotCandidates(corners),
    ...getFacePivotCandidates(corners),
  ]
}
