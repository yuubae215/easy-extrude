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
