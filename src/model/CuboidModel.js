/**
 * CuboidModel - 純粋データモデルと副作用のない純粋関数群
 *
 * 副作用なし。全関数は入力のみに基づいて値を返す。
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
// 面定義: 外側から見て CCW 順の 4 コーナーインデックス
export const FACES = [
  { name: '前面 (+Z)', corners: [4, 5, 6, 7] }, // fi=0
  { name: '背面 (-Z)', corners: [1, 0, 3, 2] }, // fi=1
  { name: '上面 (+Y)', corners: [3, 7, 6, 2] }, // fi=2
  { name: '下面 (-Y)', corners: [0, 1, 5, 4] }, // fi=3
  { name: '右面 (+X)', corners: [5, 1, 2, 6] }, // fi=4
  { name: '左面 (-X)', corners: [0, 4, 7, 3] }, // fi=5
]

/** 初期コーナー配列を生成する純粋ファクトリ */
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

/** 面 fi の法線ベクトルを計算する純粋関数 */
export function computeFaceNormal(corners, fi) {
  const [a, b, , d] = FACES[fi].corners
  const ab = new THREE.Vector3().subVectors(corners[b], corners[a])
  const ad = new THREE.Vector3().subVectors(corners[d], corners[a])
  return new THREE.Vector3().crossVectors(ab, ad).normalize()
}

/** コーナー配列から BufferGeometry を構築する純粋関数 */
export function buildGeometry(corners) {
  const pos  = new Float32Array(72) // 6 faces × 4 verts × 3
  const norm = new Float32Array(72)
  const idx  = []

  FACES.forEach((face, fi) => {
    const n = computeFaceNormal(corners, fi)
    face.corners.forEach((ci, vi) => {
      const i = (fi * 4 + vi) * 3
      const v = corners[ci]
      pos[i]  = v.x; pos[i+1]  = v.y; pos[i+2]  = v.z
      norm[i] = n.x; norm[i+1] = n.y; norm[i+2] = n.z
    })
    const b = fi * 4
    idx.push(b, b+1, b+2,  b, b+2, b+3)
  })

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('normal',   new THREE.BufferAttribute(norm, 3))
  geo.setIndex(idx)
  return geo
}

/** 面ハイライト用の頂点位置配列を返す純粋関数 */
export function buildFaceHighlightPositions(corners, fi) {
  const pos = new Float32Array(12) // 4 verts × 3
  FACES[fi].corners.forEach((ci, vi) => {
    const v = corners[ci]
    const i = vi * 3
    pos[i] = v.x; pos[i+1] = v.y; pos[i+2] = v.z
  })
  return pos
}

/** コーナー配列の重心を返す純粋関数 */
export function getCentroid(corners) {
  const c = new THREE.Vector3()
  corners.forEach(v => c.add(v))
  return c.divideScalar(corners.length)
}

/** マウス座標を NDC に変換する純粋関数 */
export function toNDC(clientX, clientY, width, height) {
  return new THREE.Vector2(
    (clientX / width)  *  2 - 1,
    (clientY / height) * -2 + 1,
  )
}
