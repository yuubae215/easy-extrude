/**
 * SceneView - manages the Three.js scene, renderer, camera, and controls
 *
 * Side effects: DOM manipulation, WebGL initialization, event listener registration.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { SceneStage } from './SceneStage.js'
import { RobotStageSet } from './RobotStageSet.js'
import { TCP_LOCAL_SEED } from './robotSkeleton.js'
import { focusPose as computeFocusPose, clipPlanesFor, frustumForDistance } from './CameraMath.js'
import { orbitControlsTouches } from './CameraGestures.js'
import { COLOR, hexNumber } from '../theme/tokens.js'

/**
 * The projection axis (ADR-103). Two values, cardinality exactly 1 — there is no
 * "no projection". Orthogonal to camera ORIENTATION (owned by the gizmo /
 * OrbitControls) and to the top-level MODE (`SceneModel._selectionMode`): the
 * former Map Mode fused all three, which is why `edit` + top-down was
 * unreachable while `edit ∧ mapMode.active` was representable.
 */
export const PROJECTION = Object.freeze({
  PERSPECTIVE:  'perspective',
  ORTHOGRAPHIC: 'orthographic',
})

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

    // The orthographic camera is a DERIVED VIEW of the perspective camera, never
    // a second pose source (原則 #24 / §1.1). It is created lazily on the first
    // switch to ortho and re-derived every frame from `camera` + `controls.target`;
    // nothing ever writes the perspective camera FROM it, so there is no cycle.
    this._orthoCamera = null
    /** @type {'perspective'|'orthographic'} — written only by `setProjection()`. */
    this._projection  = PROJECTION.PERSPECTIVE

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = false
    // Left button is reserved for object/face operations; right button orbits the camera
    this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
    // Touch: 1-finger orbits (AppController returns early for touch to let
    // OrbitControls handle it); 2-finger pinch dollies and 2-finger drag pans.
    // The assignment is NOT written here — it is derived from the camera-DOF
    // table (ADR-114 D2), because a degree of freedom with no gesture has no
    // line of its own and so cannot be seen by reading this file. `pan` had
    // none from the first commit until ADR-114.
    this.controls.touches = orbitControlsTouches()

    // Prevent browser scroll/pan interference on the canvas
    this.renderer.domElement.style.touchAction = 'none'
    // The orbit gestures a drawing tool fully consumes, captured once so the
    // suspension below is a restore rather than a second declaration (§1.1).
    this._orbitDefaults = {
      right: this.controls.mouseButtons.RIGHT,
      touchOne: this.controls.touches.ONE,
    }
    this._drawGestureActive = false

    this._setupLighting()
    this._setupGrid()
    // Ambient stage dressing: gradient backdrop, depth fog, floor glow,
    // drifting dust, rim light (ADR-067 — Tier D; persistent view owned here).
    this.stage = new SceneStage(this.scene)
    // grasp-search verification aid: one fixed-pose robot skeleton PER ROBOT in
    // the scene (0 / 1 / N — ADR-090). The set owns each stage's lifecycle and is
    // reconciled from the roster by AppController._syncRobotStage; a robot-less
    // scene simply draws none (ADR: see RobotStage.js / RobotStageSet.js).
    this.robotStages = new RobotStageSet(this.scene)
    // The tcp default seed, DERIVED from the same bundled URDF the skeleton is
    // drawn from (ADR-088). Handed to SceneService via AppController so the tool
    // point seeds at the rendered flange — one source, no drift.
    this.robotTcpSeed = TCP_LOCAL_SEED

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
    this._grid = new THREE.GridHelper(20, 20, hexNumber(COLOR.gridMajor), hexNumber(COLOR.gridMinor))
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
    // The ortho camera needs no resize branch: `render()` re-derives it (aspect
    // included) from the perspective camera every frame while it is active.
  }

  /**
   * Computes (side-effect-free) the camera pose that frames a bounding sphere,
   * keeping the current orbital direction. The ONE framing derivation (ADR-068,
   * 核 §1.1): both the instant `fitCameraToSphere` below and the animated
   * `CameraFlight` consume this, so a "frame the scene" jump and a "frame the
   * selection" flight can never drift apart. Does NOT touch the grid scale —
   * that belongs to scene framing (`fitCameraToSphere`), not selection framing.
   * @param {THREE.Vector3} center
   * @param {number} radius
   * @returns {{position: THREE.Vector3, target: THREE.Vector3, near: number, far: number, dist: number}}
   */
  focusPose(center, radius) {
    const dir = this.camera.position.clone().sub(this.controls.target)
    const p = computeFocusPose(center, radius, dir, this.camera.fov)
    const { near, far } = clipPlanesFor(radius, p.dist, this.camera.far)
    return {
      position: new THREE.Vector3(p.position.x, p.position.y, p.position.z),
      target:   new THREE.Vector3(p.target.x, p.target.y, p.target.z),
      near,
      far,
      dist:     p.dist,
    }
  }

  /**
   * Repositions the camera to frame a bounding sphere (instant — "frame the
   * scene" entry point). Updates OrbitControls target, expands clip planes, and
   * rescales the ground grid to the scene radius (PHILOSOPHY #27). For a smooth
   * "frame the selection" journey, AppController eases to `focusPose` via
   * `CameraFlight` instead — that path deliberately does NOT rescale the grid.
   * @param {THREE.Vector3} center
   * @param {number} radius
   */
  fitCameraToSphere(center, radius) {
    const pose = this.focusPose(center, radius)
    this.camera.position.copy(pose.position)
    this.controls.target.copy(pose.target)
    this.controls.update()

    // Expand clip planes to encompass the scene
    this.camera.near = pose.near
    this.camera.far  = pose.far
    this.camera.updateProjectionMatrix()

    // Keep the ground grid visible at this scene scale (mm-scale imports/demo)
    this._updateGridScale(radius)
  }

  /** The current projection (`PROJECTION.*`). */
  get projection() { return this._projection }

  /**
   * Sets the projection — **the only writer of the projection axis** (原則 #4).
   *
   * ADR-103: projection is a VIEW SETTING orthogonal to orientation, not a mode.
   * Switching does not move the camera, does not touch OrbitControls, and does
   * not touch `SceneModel._selectionMode`; orbit / dolly / pan keep working
   * identically because the perspective camera stays the pose authority and the
   * ortho camera is re-derived from it each frame (`_syncOrthoCamera`).
   *
   * @param {'perspective'|'orthographic'} kind
   */
  setProjection(kind) {
    if (kind !== PROJECTION.PERSPECTIVE && kind !== PROJECTION.ORTHOGRAPHIC) {
      // Unknown kind throws rather than falling through to a default: a silent
      // default makes "declared" and "nobody thought about it" indistinguishable
      // (原則 #31, the same rule as PLACEMENT_BY_KIND / EXPLICIT_DEFAULTS).
      throw new Error(`[SceneView] unknown projection "${kind}"`)
    }
    if (kind === this._projection) return
    this._projection = kind
    if (kind === PROJECTION.ORTHOGRAPHIC) this._syncOrthoCamera()
  }

  /**
   * Re-derives the orthographic camera from the perspective camera. Called once
   * per rendered frame while ortho is active — the ortho camera holds NO state of
   * its own (no saved pose, no independent zoom, no pan offset), so there is
   * nothing that can drift out of sync with the perspective camera and nothing
   * to restore when switching back (原則 #24: a derived value must never feed
   * its own input — nothing writes `this.camera` from here).
   *
   * Same eye point and same orientation ⇒ toggling projection is a pure change
   * of projection, never a jump. The frustum height is the perspective camera's
   * visible world height at the orbit target (`frustumForDistance`), so apparent
   * scale at the focus point is preserved and OrbitControls' dolly keeps working
   * as "zoom" in ortho too.
   */
  _syncOrthoCamera() {
    const aspect = innerWidth / innerHeight
    if (!this._orthoCamera) this._orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1)
    const oc   = this._orthoCamera
    const dist = Math.max(this.camera.position.distanceTo(this.controls.target), 1e-3)
    const h    = frustumForDistance(dist, this.camera.fov)

    oc.left   = -h * aspect / 2
    oc.right  =  h * aspect / 2
    oc.top    =  h / 2
    oc.bottom = -h / 2
    // Symmetric depth box around the eye: an ortho frustum has linear depth, so a
    // generous range costs no precision, and clipping the scene when the user
    // merely changed projection would be a silent loss (原則 #11).
    const depth = dist * 2 + 1000
    oc.near   = -depth
    oc.far    =  depth
    oc.position.copy(this.camera.position)
    oc.quaternion.copy(this.camera.quaternion)
    oc.up.copy(this.camera.up)
    oc.updateProjectionMatrix()
    oc.updateMatrixWorld(true)
  }

  /**
   * Suspends exactly the orbit gestures a drawing tool fully consumes, and
   * nothing else (原則 #14 — disable shared controls only on a true conflict).
   * RMB completes a polyline and a one-finger drag draws, so those two are taken;
   * middle-drag dolly, wheel zoom and two-finger pinch stay with OrbitControls,
   * which is why the place tool needs no pan/zoom/pinch code of its own.
   * @param {boolean} active
   */
  setDrawGestureActive(active) {
    if (active === this._drawGestureActive) return
    this._drawGestureActive = active
    this.controls.mouseButtons.RIGHT = active ? null : this._orbitDefaults.right
    this.controls.touches.ONE        = active ? null : this._orbitDefaults.touchOne
  }

  /** The camera currently being used for rendering. */
  get activeCamera() {
    return (this._projection === PROJECTION.ORTHOGRAPHIC && this._orthoCamera)
      ? this._orthoCamera
      : this.camera
  }

  /** Updates controls and renders the scene (call from the animation loop) */
  render() {
    this.controls.update()
    if (this._projection === PROJECTION.ORTHOGRAPHIC) this._syncOrthoCamera()
    this.renderer.render(this.scene, this.activeCamera)
  }
}
