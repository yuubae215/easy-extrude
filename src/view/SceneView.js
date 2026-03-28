/**
 * SceneView - manages the Three.js scene, renderer, camera, and controls
 *
 * Side effects: DOM manipulation, WebGL initialization, event listener registration.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

export class SceneView {
  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setSize(innerWidth, innerHeight)
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    document.body.appendChild(this.renderer.domElement)

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x1a1a2e)

    this.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100)
    this.camera.up.set(0, 0, 1)           // ROS convention: +Z is up
    this.camera.position.set(6, -4, 3)    // front (+X), right (-Y), above (+Z)
    this.camera.lookAt(0, 0, 0)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = false
    // Left button is reserved for object/face operations; right button orbits the camera
    this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
    // Touch: 1-finger orbits (AppController returns early for touch to let
    // OrbitControls handle it); 2-finger dolly+rotate
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE }

    // Prevent browser scroll/pan interference on the canvas
    this.renderer.domElement.style.touchAction = 'none'

    this._setupLighting()
    this._setupGrid()

    window.addEventListener('resize', () => this._onResize())
  }

  _setupLighting() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5))
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5)
    dirLight.position.set(5, -5, 10)  // front-right, high above (+Z up)
    this.scene.add(dirLight)
  }

  _setupGrid() {
    // GridHelper is in XZ plane by default; rotate 90deg around X to put it in XY plane (Z=0 ground)
    const grid = new THREE.GridHelper(20, 20, 0x444466, 0x222244)
    grid.rotation.x = Math.PI / 2
    grid.material.transparent = true
    grid.material.opacity = 0.4
    this.scene.add(grid)
  }

  _onResize() {
    this.camera.aspect = innerWidth / innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(innerWidth, innerHeight)
  }

  /**
   * Repositions the camera to frame a bounding sphere.
   * Updates OrbitControls target and expands near/far clip planes as needed.
   * @param {THREE.Vector3} center
   * @param {number} radius
   */
  fitCameraToSphere(center, radius) {
    const halfFovRad = THREE.MathUtils.degToRad(this.camera.fov * 0.5)
    const dist = (radius / Math.sin(halfFovRad)) * 1.3

    // Keep current orbital direction, move to new distance from center
    const dir = this.camera.position.clone().sub(this.controls.target)
    if (dir.lengthSq() < 1e-10) dir.set(1, -0.7, 0.5) // fallback direction
    dir.normalize().multiplyScalar(dist)
    this.camera.position.copy(center).add(dir)

    this.controls.target.copy(center)
    this.controls.update()

    // Expand clip planes to encompass the scene
    this.camera.near = Math.min(0.01, radius * 0.001)
    this.camera.far  = Math.max(this.camera.far, dist * 2 + radius * 4)
    this.camera.updateProjectionMatrix()
  }

  /** Updates controls and renders the scene (call from the animation loop) */
  render() {
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }
}
