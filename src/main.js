import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

// Scene
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x1a1a2e)
scene.fog = new THREE.FogExp2(0x1a1a2e, 0.02)

// Camera
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000)
camera.position.set(5, 5, 10)

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
document.body.appendChild(renderer.domElement)

// Controls
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.dampingFactor = 0.05

// Lights
const ambientLight = new THREE.AmbientLight(0xffffff, 0.3)
scene.add(ambientLight)

const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5)
directionalLight.position.set(5, 10, 5)
directionalLight.castShadow = true
directionalLight.shadow.mapSize.width = 2048
directionalLight.shadow.mapSize.height = 2048
scene.add(directionalLight)

const pointLight1 = new THREE.PointLight(0x4fc3f7, 2, 20)
pointLight1.position.set(-5, 3, -5)
scene.add(pointLight1)

const pointLight2 = new THREE.PointLight(0xf48fb1, 2, 20)
pointLight2.position.set(5, 3, -5)
scene.add(pointLight2)

// Floor
const floorGeometry = new THREE.PlaneGeometry(30, 30)
const floorMaterial = new THREE.MeshStandardMaterial({
  color: 0x16213e,
  roughness: 0.8,
  metalness: 0.2,
})
const floor = new THREE.Mesh(floorGeometry, floorMaterial)
floor.rotation.x = -Math.PI / 2
floor.receiveShadow = true
scene.add(floor)

// Grid helper
const grid = new THREE.GridHelper(30, 30, 0x4fc3f7, 0x0d3b66)
grid.material.opacity = 0.3
grid.material.transparent = true
scene.add(grid)

// --- Extrude sample shapes ---
const extrudeSettings = { depth: 1, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 4 }

// Star shape
function createStarShape(outerR, innerR, points) {
  const shape = new THREE.Shape()
  for (let i = 0; i < points * 2; i++) {
    const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2
    const r = i % 2 === 0 ? outerR : innerR
    const x = Math.cos(angle) * r
    const y = Math.sin(angle) * r
    i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)
  }
  shape.closePath()
  return shape
}

const starShape = createStarShape(1.2, 0.5, 5)
const starGeometry = new THREE.ExtrudeGeometry(starShape, extrudeSettings)
const starMaterial = new THREE.MeshStandardMaterial({ color: 0xffd54f, roughness: 0.3, metalness: 0.6 })
const star = new THREE.Mesh(starGeometry, starMaterial)
star.position.set(-4, 1, 0)
star.castShadow = true
scene.add(star)

// Heart shape
function createHeartShape() {
  const shape = new THREE.Shape()
  shape.moveTo(0, 0.5)
  shape.bezierCurveTo(0, 1, 1, 1.5, 1, 0.5)
  shape.bezierCurveTo(1, -0.3, 0, -0.8, 0, -1.2)
  shape.bezierCurveTo(0, -0.8, -1, -0.3, -1, 0.5)
  shape.bezierCurveTo(-1, 1.5, 0, 1, 0, 0.5)
  return shape
}

const heartShape = createHeartShape()
const heartGeometry = new THREE.ExtrudeGeometry(heartShape, extrudeSettings)
const heartMaterial = new THREE.MeshStandardMaterial({ color: 0xef5350, roughness: 0.3, metalness: 0.4 })
const heart = new THREE.Mesh(heartGeometry, heartMaterial)
heart.position.set(0, 1.2, 0)
heart.castShadow = true
scene.add(heart)

// Arrow shape
function createArrowShape() {
  const shape = new THREE.Shape()
  shape.moveTo(0, 1.5)
  shape.lineTo(1.2, 0)
  shape.lineTo(0.4, 0)
  shape.lineTo(0.4, -1.5)
  shape.lineTo(-0.4, -1.5)
  shape.lineTo(-0.4, 0)
  shape.lineTo(-1.2, 0)
  shape.closePath()
  return shape
}

const arrowShape = createArrowShape()
const arrowGeometry = new THREE.ExtrudeGeometry(arrowShape, extrudeSettings)
const arrowMaterial = new THREE.MeshStandardMaterial({ color: 0x66bb6a, roughness: 0.3, metalness: 0.5 })
const arrow = new THREE.Mesh(arrowGeometry, arrowMaterial)
arrow.position.set(4, 1.5, 0)
arrow.castShadow = true
scene.add(arrow)

// Floating particles
const particleCount = 200
const particleGeometry = new THREE.BufferGeometry()
const positions = new Float32Array(particleCount * 3)
for (let i = 0; i < particleCount; i++) {
  positions[i * 3] = (Math.random() - 0.5) * 20
  positions[i * 3 + 1] = Math.random() * 8
  positions[i * 3 + 2] = (Math.random() - 0.5) * 20
}
particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
const particleMaterial = new THREE.PointsMaterial({ color: 0x4fc3f7, size: 0.05, transparent: true, opacity: 0.6 })
const particles = new THREE.Points(particleGeometry, particleMaterial)
scene.add(particles)

// Resize handler
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

// Animation loop
const clock = new THREE.Clock()
function animate() {
  requestAnimationFrame(animate)
  const elapsed = clock.getElapsedTime()

  star.rotation.y = elapsed * 0.8
  star.position.y = 1 + Math.sin(elapsed * 1.2) * 0.3

  heart.rotation.y = elapsed * 0.6
  heart.position.y = 1.2 + Math.sin(elapsed * 1.0 + 1) * 0.3

  arrow.rotation.y = elapsed * 1.0
  arrow.position.y = 1.5 + Math.sin(elapsed * 0.8 + 2) * 0.3

  particles.rotation.y = elapsed * 0.05

  pointLight1.position.x = Math.sin(elapsed * 0.5) * 6
  pointLight1.position.z = Math.cos(elapsed * 0.5) * 6
  pointLight2.position.x = Math.sin(elapsed * 0.5 + Math.PI) * 6
  pointLight2.position.z = Math.cos(elapsed * 0.5 + Math.PI) * 6

  controls.update()
  renderer.render(scene, camera)
}
animate()
