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
 * Pure function that returns all pivot point candidates.
 * Includes the 8 corners, 6 face centers, and the world origin.
 * @param {THREE.Vector3[]} corners
 * @returns {{ label: string, position: THREE.Vector3 }[]}
 */
export function getPivotCandidates(corners) {
  const candidates = []
  corners.forEach((c, i) => candidates.push({ label: `Corner ${i}`, position: c.clone() }))
  FACES.forEach(face => {
    const center = face.corners
      .reduce((acc, ci) => acc.add(corners[ci].clone()), new THREE.Vector3())
      .divideScalar(face.corners.length)
    candidates.push({ label: face.name, position: center })
  })
  candidates.push({ label: 'World Origin', position: new THREE.Vector3(0, 0, 0) })
  return candidates
}
