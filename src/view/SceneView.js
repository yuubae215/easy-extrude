/**
 * SceneView - manages the Three.js scene, renderer, camera, and controls
 *
 * Side effects: DOM manipulation, WebGL initialization, event listener registration.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { SceneStage } from './SceneStage.js'

export class SceneView {
  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setSize(innerWidth, innerHeight)
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    // Mount inside #canvas-container so the stacking order is explicit:
    // canvas (z-index:0) → gizmo (z-index:10) → React UI (z-index:100).
    const canvasContainer = document.getElementById('canvas-container') ?? document.body
    canvasContainer.appendChild(this.renderer.domElement)

    this.scene = new THREE.Scene()
    // Backdrop/fog ownership is delegated to the ambient stage (ADR-067):
    // SceneStage sets `scene.background` (gradient) and `scene.fog` itself.

    this.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100)
    this.camera.up.set(0, 0, 1)           // ROS convention: +Z is up
    this.camera.position.set(6, -4, 3)    // front (+X), right (-Y), above (+Z)
    this.camera.lookAt(0, 0, 0)

    this._orthoCamera = null
    this._useOrtho    = false

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
    // Ambient stage dressing: gradient backdrop, depth fog, floor glow,
    // drifting dust, rim light (ADR-067 — Tier D; persistent view owned here).
    this.stage = new SceneStage(this.scene)

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
    this._grid = new THREE.GridHelper(20, 20, 0x444466, 0x222244)
    this._grid.rotation.x = Math.PI / 2
    this._grid.material.transparent = true
    this._grid.material.opacity = 0.4
    this.scene.add(this._grid)
  }

  /**
   * Rescales the ground grid to stay visible at the given scene scale.
   * The 20-unit grid is sized for meter-scale scenes; in an mm-scale scene
   * (radius in the thousands) it shrinks to a sub-pixel dot (PHILOSOPHY #27).
   * Picks a power-of-10 cell size so grid lines stay on round world coordinates:
   * scale 1 for radius ≤ 10 (default look preserved), ×10 per decade above.
   * @param {number} radius  scene bounding-sphere radius (world units)
   */
  _updateGridScale(radius) {
    if (!this._grid || !(radius > 0)) return
    // 20·scale total span ≥ 2·radius  →  scale ≥ radius/10, rounded up to 10^n
    const scale = Math.pow(10, Math.max(0, Math.ceil(Math.log10(radius / 10))))
    this._grid.scale.setScalar(scale)
    // The ambient stage (dust field, floor glow, fog density) rides the same
    // power-of-10 scale so it stays proportionate in mm-scale scenes (#27).
    this.stage.setScale(scale)
  }

  _onResize() {
    this.camera.aspect = innerWidth / innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(innerWidth, innerHeight)
    if (this._orthoCamera) {
      const aspect = innerWidth / innerHeight
      const h = this._orthoCamera.top - this._orthoCamera.bottom
      this._orthoCamera.left   = -h * aspect / 2
      this._orthoCamera.right  =  h * aspect / 2
      this._orthoCamera.updateProjectionMatrix()
    }
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

    // Keep the ground grid visible at this scene scale (mm-scale imports/demo)
    this._updateGridScale(radius)
  }

  /**
   * Switches between the perspective camera and an orthographic top-down camera.
   * When enabling, the ortho camera is centred over the current OrbitControls target.
   * @param {boolean} enable
   * @param {number} [frustumSize=50] - visible world-units height in ortho view
   */
  useOrthoCamera(enable, frustumSize = 50) {
    if (enable) {
      const aspect = innerWidth / innerHeight
      if (!this._orthoCamera) {
        this._orthoCamera = new THREE.OrthographicCamera(
          -frustumSize * aspect / 2,  frustumSize * aspect / 2,
           frustumSize / 2,           -frustumSize / 2,
          -1000, 1000,
        )
      } else {
        this._orthoCamera.left   = -frustumSize * aspect / 2
        this._orthoCamera.right  =  frustumSize * aspect / 2
        this._orthoCamera.top    =  frustumSize / 2
        this._orthoCamera.bottom = -frustumSize / 2
      }
      // Centre ortho camera over the perspective camera's focus point (XY plane)
      const t = this.controls.target
      this._orthoCamera.position.set(t.x, t.y, 100)
      this._orthoCamera.up.set(0, 1, 0)
      this._orthoCamera.lookAt(t.x, t.y, 0)
      this._orthoCamera.updateProjectionMatrix()
      this._useOrtho = true
      this.controls.enabled = false
    } else {
      this._useOrtho = false
      this.controls.enabled = true
    }
  }

  /**
   * Adjusts the orthographic frustum height (zoom level) while keeping the camera centred.
   * @param {number} frustumSize
   */
  setOrthoZoom(frustumSize) {
    if (!this._orthoCamera) return
    const aspect = innerWidth / innerHeight
    this._orthoCamera.left   = -frustumSize * aspect / 2
    this._orthoCamera.right  =  frustumSize * aspect / 2
    this._orthoCamera.top    =  frustumSize / 2
    this._orthoCamera.bottom = -frustumSize / 2
    this._orthoCamera.updateProjectionMatrix()
  }

  /**
   * Translates the orthographic camera in XY (world-space pan).
   * @param {number} x
   * @param {number} y
   */
  panOrthoCamera(x, y) {
    if (!this._orthoCamera) return
    this._orthoCamera.position.set(x, y, 100)
    this._orthoCamera.lookAt(x, y, 0)
  }

  /** The camera currently being used for rendering. */
  get activeCamera() {
    return (this._useOrtho && this._orthoCamera) ? this._orthoCamera : this.camera
  }

  /** Updates controls and renders the scene (call from the animation loop) */
  render() {
    if (!this._useOrtho) this.controls.update()
    this.renderer.render(this.scene, this.activeCamera)
  }
}
