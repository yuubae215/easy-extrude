import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

// ─── Renderer / Camera / Scene ───────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(innerWidth, innerHeight)
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x1a1a2e)

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100)
camera.position.set(4, 3, 6)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true

// ─── Lighting ────────────────────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0xffffff, 0.5))
const dirLight = new THREE.DirectionalLight(0xffffff, 1.5)
dirLight.position.set(5, 10, 5)
scene.add(dirLight)

// ─── Grid ────────────────────────────────────────────────────────────────────
const grid = new THREE.GridHelper(20, 20, 0x444466, 0x222244)
grid.material.transparent = true
grid.material.opacity = 0.4
scene.add(grid)

// ─── Cuboid data model ────────────────────────────────────────────────────────
//
//      3─────2
//     /|    /|    +Y up
//    7─────6 |    +Z front
//    | 0───|─1    +X right
//    |/    |/
//    4─────5
//
// 8 corner positions (mutable logical vertices)
let corners = [
  new THREE.Vector3(-1, -1, -1), // 0 back-bottom-left
  new THREE.Vector3( 1, -1, -1), // 1 back-bottom-right
  new THREE.Vector3( 1,  1, -1), // 2 back-top-right
  new THREE.Vector3(-1,  1, -1), // 3 back-top-left
  new THREE.Vector3(-1, -1,  1), // 4 front-bottom-left
  new THREE.Vector3( 1, -1,  1), // 5 front-bottom-right
  new THREE.Vector3( 1,  1,  1), // 6 front-top-right
  new THREE.Vector3(-1,  1,  1), // 7 front-top-left
]

// Face definitions: 4 corner indices in CCW order when viewed from outside.
// Outward normal = cross(corners[b] - corners[a], corners[d] - corners[a])
// Faces are ordered so geometry vertex fi*4..fi*4+3 corresponds to FACES[fi].
const FACES = [
  { name: '前面 (+Z)', corners: [4, 5, 6, 7] }, // fi=0
  { name: '背面 (-Z)', corners: [1, 0, 3, 2] }, // fi=1
  { name: '上面 (+Y)', corners: [3, 7, 6, 2] }, // fi=2
  { name: '下面 (-Y)', corners: [0, 1, 5, 4] }, // fi=3
  { name: '右面 (+X)', corners: [5, 1, 2, 6] }, // fi=4
  { name: '左面 (-X)', corners: [0, 4, 7, 3] }, // fi=5
]

// Compute outward face normal from current corner positions
function computeFaceNormal(fi) {
  const [a, b, , d] = FACES[fi].corners
  const ab = new THREE.Vector3().subVectors(corners[b], corners[a])
  const ad = new THREE.Vector3().subVectors(corners[d], corners[a])
  return new THREE.Vector3().crossVectors(ab, ad).normalize()
}

// Build BufferGeometry from current corner positions.
// Layout: face fi → geometry vertices [fi*4 .. fi*4+3]
// This lets us recover face index from hit.face.a via Math.floor(hit.face.a / 4).
function buildGeometry() {
  const pos  = new Float32Array(72) // 6 faces × 4 verts × 3
  const norm = new Float32Array(72)
  const idx  = []

  FACES.forEach((face, fi) => {
    const n = computeFaceNormal(fi)
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

// ─── Meshes ───────────────────────────────────────────────────────────────────
let cuboidGeo = buildGeometry()

const cuboid = new THREE.Mesh(
  cuboidGeo,
  new THREE.MeshStandardMaterial({ color: 0x4fc3f7, roughness: 0.3, metalness: 0.3 })
)
scene.add(cuboid)

// Edge wireframe
let edgesGeo = new THREE.EdgesGeometry(cuboidGeo, 1)
const wireframe = new THREE.LineSegments(
  edgesGeo,
  new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 })
)
scene.add(wireframe)

// Face highlight (semi-transparent yellow quad over hovered / dragged face)
const hlGeo = new THREE.BufferGeometry()
const hlMesh = new THREE.Mesh(hlGeo, new THREE.MeshBasicMaterial({
  color: 0xffeb3b,
  transparent: true,
  opacity: 0.35,
  depthTest: false,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: -1,
}))
scene.add(hlMesh)

function setHighlight(fi) {
  if (fi === null) {
    hlGeo.setIndex([])
    hlGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
    return
  }
  const pos = new Float32Array(12)
  FACES[fi].corners.forEach((ci, vi) => {
    const v = corners[ci]; const i = vi * 3
    pos[i] = v.x; pos[i+1] = v.y; pos[i+2] = v.z
  })
  hlGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  hlGeo.setIndex([0, 1, 2,  0, 2, 3])
  hlGeo.attributes.position.needsUpdate = true
  hlGeo.computeBoundingSphere()
}

function rebuildMeshes() {
  const newGeo = buildGeometry()
  cuboid.geometry.dispose()
  cuboid.geometry = newGeo
  wireframe.geometry.dispose()
  wireframe.geometry = new THREE.EdgesGeometry(newGeo, 1)
}

// ─── UI overlay ───────────────────────────────────────────────────────────────
const infoEl = document.createElement('div')
Object.assign(infoEl.style, {
  position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
  color: '#ccc', fontSize: '13px', fontFamily: 'sans-serif',
  background: 'rgba(0,0,0,0.55)', padding: '8px 18px', borderRadius: '8px',
  pointerEvents: 'none', textAlign: 'center', lineHeight: '1.6',
})
infoEl.innerHTML = '面にホバー → 選択 &nbsp;|&nbsp; 左ドラッグ → 面を押し出し &nbsp;|&nbsp; 右ドラッグ / Alt+ドラッグ → 視点回転'
document.body.appendChild(infoEl)

const faceEl = document.createElement('div')
Object.assign(faceEl.style, {
  position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
  color: '#ffeb3b', fontSize: '15px', fontFamily: 'sans-serif',
  background: 'rgba(0,0,0,0.55)', padding: '6px 16px', borderRadius: '6px',
  pointerEvents: 'none', minWidth: '120px', textAlign: 'center',
})
document.body.appendChild(faceEl)

// ─── Interaction ──────────────────────────────────────────────────────────────
const raycaster = new THREE.Raycaster()
const mouse = new THREE.Vector2()

let hoveredFace  = null
let isDragging   = false
let dragFaceIdx  = null
let dragNormal   = new THREE.Vector3()
let dragPlane    = new THREE.Plane()
let dragStart    = new THREE.Vector3()
let savedCorners = []

function toNDC(e) {
  mouse.set(
    (e.clientX / innerWidth)  *  2 - 1,
    (e.clientY / innerHeight) * -2 + 1
  )
}

function pickFace() {
  raycaster.setFromCamera(mouse, camera)
  const hits = raycaster.intersectObject(cuboid)
  if (!hits.length) return null
  // Geometry vertex index → face index: face fi occupies verts [fi*4 .. fi*4+3]
  return { faceIdx: Math.floor(hits[0].face.a / 4), point: hits[0].point }
}

window.addEventListener('mousemove', (e) => {
  toNDC(e)

  if (isDragging) {
    raycaster.setFromCamera(mouse, camera)
    const pt = new THREE.Vector3()
    if (!raycaster.ray.intersectPlane(dragPlane, pt)) return

    // Project displacement onto face normal → pure extrusion
    const dist = pt.clone().sub(dragStart).dot(dragNormal)
    const offset = dragNormal.clone().multiplyScalar(dist)

    FACES[dragFaceIdx].corners.forEach((ci, i) => {
      corners[ci].copy(savedCorners[i]).add(offset)
    })

    rebuildMeshes()
    setHighlight(dragFaceIdx)
    faceEl.textContent = `${FACES[dragFaceIdx].name}  Δ ${dist.toFixed(3)}`
    return
  }

  // Hover detection
  const hit = pickFace()
  const fi = hit ? hit.faceIdx : null
  if (fi !== hoveredFace) {
    hoveredFace = fi
    setHighlight(hoveredFace)
    faceEl.textContent = fi !== null ? FACES[fi].name : ''
    renderer.domElement.style.cursor = fi !== null ? 'pointer' : 'default'
  }
})

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return
  toNDC(e)
  const hit = pickFace()
  if (!hit) return

  isDragging   = true
  dragFaceIdx  = hit.faceIdx
  controls.enabled = false

  // Save face normal at drag start (stays constant during extrusion)
  dragNormal.copy(computeFaceNormal(dragFaceIdx))

  // Drag plane: camera-facing plane through hit point
  // (avoids singularity when face is nearly edge-on to camera)
  const camDir = new THREE.Vector3()
  camera.getWorldDirection(camDir)
  dragPlane.setFromNormalAndCoplanarPoint(camDir, hit.point)
  dragStart.copy(hit.point)

  // Snapshot corner positions before drag
  savedCorners = FACES[dragFaceIdx].corners.map(ci => corners[ci].clone())
})

window.addEventListener('mouseup', () => {
  if (!isDragging) return
  isDragging = false
  controls.enabled = true
  dragFaceIdx = null
})

// ─── Resize ───────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

// ─── Animate ─────────────────────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate)
  controls.update()
  renderer.render(scene, camera)
}
animate()
