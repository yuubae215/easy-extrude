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
// Left button is reserved for object/face operations; right button orbits the camera
controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }

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
const FACES = [
  { name: '前面 (+Z)', corners: [4, 5, 6, 7] }, // fi=0
  { name: '背面 (-Z)', corners: [1, 0, 3, 2] }, // fi=1
  { name: '上面 (+Y)', corners: [3, 7, 6, 2] }, // fi=2
  { name: '下面 (-Y)', corners: [0, 1, 5, 4] }, // fi=3
  { name: '右面 (+X)', corners: [5, 1, 2, 6] }, // fi=4
  { name: '左面 (-X)', corners: [0, 4, 7, 3] }, // fi=5
]

function computeFaceNormal(fi) {
  const [a, b, , d] = FACES[fi].corners
  const ab = new THREE.Vector3().subVectors(corners[b], corners[a])
  const ad = new THREE.Vector3().subVectors(corners[d], corners[a])
  return new THREE.Vector3().crossVectors(ab, ad).normalize()
}

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
const cuboidMat = new THREE.MeshStandardMaterial({ color: 0x4fc3f7, roughness: 0.3, metalness: 0.3 })
const cuboid = new THREE.Mesh(buildGeometry(), cuboidMat)
scene.add(cuboid)

const wireframe = new THREE.LineSegments(
  new THREE.EdgesGeometry(cuboid.geometry, 1),
  new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 })
)
scene.add(wireframe)

// BoxHelper for object-selected highlight
const boxHelper = new THREE.BoxHelper(cuboid, 0x4fc3f7)
boxHelper.visible = false
scene.add(boxHelper)

// Face highlight quad
const hlGeo = new THREE.BufferGeometry()
const hlMesh = new THREE.Mesh(hlGeo, new THREE.MeshBasicMaterial({
  color: 0xffeb3b, transparent: true, opacity: 0.35,
  depthTest: false, side: THREE.DoubleSide,
  polygonOffset: true, polygonOffsetFactor: -1,
}))
scene.add(hlMesh)

function setFaceHighlight(fi) {
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
  if (objSelected) boxHelper.update()
}

// ─── Selection Mode ───────────────────────────────────────────────────────────
let selectionMode = 'object' // 'object' | 'face'

// ── Object mode state ──────────────────────────────────────────────────────
let objSelected           = false
let objDragging           = false
let objCtrlDrag           = false
const objDragPlane        = new THREE.Plane()
const objDragStart        = new THREE.Vector3()
let objDragStartCorners   = []
let objRotateStartX       = 0
const objRotateCentroid   = new THREE.Vector3()
let objRotateStartCorners = []

function getCentroid() {
  const c = new THREE.Vector3()
  corners.forEach(v => c.add(v))
  return c.divideScalar(corners.length)
}

function setObjectSelected(sel) {
  objSelected = sel
  cuboidMat.emissive.set(sel ? 0x112244 : 0x000000)
  boxHelper.visible = sel
  if (sel) boxHelper.update()
  statusEl.textContent = sel ? 'オブジェクト選択中' : ''
}

// ── Face mode state ────────────────────────────────────────────────────────
let hoveredFace      = null
let faceDragging     = false
let dragFaceIdx      = null
const dragNormal     = new THREE.Vector3()
const dragPlane      = new THREE.Plane()
const dragStart      = new THREE.Vector3()
let savedFaceCorners = []

// ─── UI ───────────────────────────────────────────────────────────────────────
const modeBarEl = document.createElement('div')
Object.assign(modeBarEl.style, {
  position: 'fixed', top: '20px', left: '20px',
  display: 'flex', gap: '8px',
})
document.body.appendChild(modeBarEl)

function makeModeBtn(label, mode) {
  const btn = document.createElement('button')
  btn.textContent = label
  Object.assign(btn.style, {
    padding: '7px 15px', borderRadius: '6px', border: '2px solid #555',
    background: 'rgba(0,0,0,0.6)', color: '#aaa', cursor: 'pointer',
    fontSize: '13px', fontFamily: 'sans-serif',
  })
  btn.addEventListener('click', () => setMode(mode))
  return btn
}

const btnObject = makeModeBtn('オブジェクト (O)', 'object')
const btnFace   = makeModeBtn('面選択 (F)', 'face')
modeBarEl.appendChild(btnObject)
modeBarEl.appendChild(btnFace)

// Status bar (top-center): selected object/face name
const statusEl = document.createElement('div')
Object.assign(statusEl.style, {
  position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
  color: '#ffeb3b', fontSize: '15px', fontFamily: 'sans-serif',
  background: 'rgba(0,0,0,0.55)', padding: '6px 16px', borderRadius: '6px',
  pointerEvents: 'none', minWidth: '120px', textAlign: 'center',
})
document.body.appendChild(statusEl)

// Info bar (bottom)
const infoEl = document.createElement('div')
Object.assign(infoEl.style, {
  position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
  color: '#ccc', fontSize: '13px', fontFamily: 'sans-serif',
  background: 'rgba(0,0,0,0.55)', padding: '8px 18px', borderRadius: '8px',
  pointerEvents: 'none', textAlign: 'center', lineHeight: '1.6',
})
document.body.appendChild(infoEl)

function updateModeUI() {
  const active   = { background: 'rgba(79,195,247,0.25)', color: '#4fc3f7', borderColor: '#4fc3f7' }
  const inactive = { background: 'rgba(0,0,0,0.6)',       color: '#aaa',    borderColor: '#555' }
  Object.assign(btnObject.style, selectionMode === 'object' ? active : inactive)
  Object.assign(btnFace.style,   selectionMode === 'face'   ? active : inactive)
  infoEl.innerHTML = selectionMode === 'object'
    ? 'クリック→選択 &nbsp;|&nbsp; 左ドラッグ→移動 &nbsp;|&nbsp; Ctrl+ドラッグ→Y軸回転 &nbsp;|&nbsp; 右ドラッグ→視点回転'
    : '面ホバー→ハイライト &nbsp;|&nbsp; 左ドラッグ→面の押し出し &nbsp;|&nbsp; 右ドラッグ→視点回転'
}

function setMode(mode) {
  selectionMode = mode
  if (mode === 'object') {
    setFaceHighlight(null)
    hoveredFace = null
    faceDragging = false
    dragFaceIdx = null
    statusEl.textContent = objSelected ? 'オブジェクト選択中' : ''
  } else {
    setObjectSelected(false)
    objDragging = false
    statusEl.textContent = ''
  }
  controls.enabled = true
  updateModeUI()
}

setMode('object')

// ─── Raycasting ───────────────────────────────────────────────────────────────
const raycaster = new THREE.Raycaster()
const mouse = new THREE.Vector2()

function toNDC(e) {
  mouse.set(
    (e.clientX / innerWidth)  *  2 - 1,
    (e.clientY / innerHeight) * -2 + 1
  )
}

function hitCuboid() {
  raycaster.setFromCamera(mouse, camera)
  const hits = raycaster.intersectObject(cuboid)
  return hits.length ? hits[0] : null
}

function hitFace() {
  const hit = hitCuboid()
  if (!hit) return null
  return { faceIdx: Math.floor(hit.face.a / 4), point: hit.point }
}

// ─── Mouse Events ─────────────────────────────────────────────────────────────
window.addEventListener('mousemove', (e) => {
  toNDC(e)

  // ── Object mode ──────────────────────────────────────────────────────────
  if (selectionMode === 'object') {
    if (objDragging) {
      if (objCtrlDrag) {
        // Rotate around object centroid's Y axis
        const angle = (e.clientX - objRotateStartX) * 0.01
        const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle)
        objRotateStartCorners.forEach((c, i) => {
          corners[i].copy(c).sub(objRotateCentroid).applyQuaternion(quat).add(objRotateCentroid)
        })
      } else {
        // Translate along camera-facing drag plane
        raycaster.setFromCamera(mouse, camera)
        const pt = new THREE.Vector3()
        if (raycaster.ray.intersectPlane(objDragPlane, pt)) {
          const delta = pt.clone().sub(objDragStart)
          objDragStartCorners.forEach((c, i) => corners[i].copy(c).add(delta))
        }
      }
      rebuildMeshes()
    } else {
      renderer.domElement.style.cursor = hitCuboid() ? 'pointer' : 'default'
    }
    return
  }

  // ── Face mode ─────────────────────────────────────────────────────────────
  if (faceDragging) {
    raycaster.setFromCamera(mouse, camera)
    const pt = new THREE.Vector3()
    if (!raycaster.ray.intersectPlane(dragPlane, pt)) return
    const dist = pt.clone().sub(dragStart).dot(dragNormal)
    const offset = dragNormal.clone().multiplyScalar(dist)
    FACES[dragFaceIdx].corners.forEach((ci, i) => {
      corners[ci].copy(savedFaceCorners[i]).add(offset)
    })
    rebuildMeshes()
    setFaceHighlight(dragFaceIdx)
    statusEl.textContent = `${FACES[dragFaceIdx].name}  Δ ${dist.toFixed(3)}`
    return
  }

  // Face hover detection
  const hit = hitFace()
  const fi = hit ? hit.faceIdx : null
  if (fi !== hoveredFace) {
    hoveredFace = fi
    setFaceHighlight(hoveredFace)
    statusEl.textContent = fi !== null ? FACES[fi].name : ''
    renderer.domElement.style.cursor = fi !== null ? 'pointer' : 'default'
  }
})

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return
  toNDC(e)

  // ── Object mode ──────────────────────────────────────────────────────────
  if (selectionMode === 'object') {
    const hit = hitCuboid()
    if (hit) {
      if (!objSelected) setObjectSelected(true)
      objDragging = true
      objCtrlDrag = e.ctrlKey
      controls.enabled = false
      const camDir = new THREE.Vector3()
      camera.getWorldDirection(camDir)
      objDragPlane.setFromNormalAndCoplanarPoint(camDir, hit.point)
      objDragStart.copy(hit.point)
      objDragStartCorners = corners.map(c => c.clone())
      if (e.ctrlKey) {
        objRotateStartX = e.clientX
        objRotateCentroid.copy(getCentroid())
        objRotateStartCorners = corners.map(c => c.clone())
      }
    } else {
      // Click on empty space → deselect
      setObjectSelected(false)
    }
    return
  }

  // ── Face mode ─────────────────────────────────────────────────────────────
  const hit = hitFace()
  if (!hit) return
  faceDragging = true
  dragFaceIdx = hit.faceIdx
  controls.enabled = false
  dragNormal.copy(computeFaceNormal(dragFaceIdx))
  const camDir = new THREE.Vector3()
  camera.getWorldDirection(camDir)
  dragPlane.setFromNormalAndCoplanarPoint(camDir, hit.point)
  dragStart.copy(hit.point)
  savedFaceCorners = FACES[dragFaceIdx].corners.map(ci => corners[ci].clone())
})

window.addEventListener('mouseup', (e) => {
  if (e.button !== 0) return
  if (objDragging)  { objDragging  = false; objCtrlDrag = false; controls.enabled = true }
  if (faceDragging) { faceDragging = false; dragFaceIdx = null;  controls.enabled = true }
})

window.addEventListener('keydown', (e) => {
  if (e.key === 'o' || e.key === 'O') setMode('object')
  if (e.key === 'f' || e.key === 'F') setMode('face')
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
