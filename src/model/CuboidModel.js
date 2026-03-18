/**
 * CuboidModel - pure data model and side-effect-free pure functions
 *
 * No side effects. Every function returns a value based solely on its arguments.
 */
import * as THREE from 'three'

//
//      3─────2
//     /|    /|    +Y up
//    7─────6 |    +Z front
//    | 0───|─1    +X right
//    |/    |/
//    4─────5
//
// Face definitions: 4 corner indices in CCW order as seen from outside
export const FACES = [
  { name: 'Front (+Z)', corners: [4, 5, 6, 7] }, // fi=0
  { name: 'Back (-Z)',  corners: [1, 0, 3, 2] }, // fi=1
  { name: 'Top (+Y)',   corners: [3, 7, 6, 2] }, // fi=2
  { name: 'Bottom (-Y)', corners: [0, 1, 5, 4] }, // fi=3
  { name: 'Right (+X)', corners: [5, 1, 2, 6] }, // fi=4
  { name: 'Left (-X)',  corners: [0, 4, 7, 3] }, // fi=5
]

/** Pure factory that creates the initial corner array */
export function createInitialCorners() {
  return [
    new THREE.Vector3(-1, -1, -1), // 0 back-bottom-left
    new THREE.Vector3( 1, -1, -1), // 1 back-bottom-right
    new THREE.Vector3( 1,  1, -1), // 2 back-top-right
    new THREE.Vector3(-1,  1, -1), // 3 back-top-left
    new THREE.Vector3(-1, -1,  1), // 4 front-bottom-left
    new THREE.Vector3( 1, -1,  1), // 5 front-bottom-right
    new THREE.Vector3( 1,  1,  1), // 6 front-top-right
    new THREE.Vector3(-1,  1,  1), // 7 front-top-left
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
