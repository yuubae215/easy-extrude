// @ts-nocheck — pre-existing Three.js object-access patterns; not yet fully annotated.
/**
 * CoordinateFrameView - Three.js representation of a CoordinateFrame entity.
 *
 * Renders three colour-coded axis lines at the frame origin:
 *   X → red    (+X forward in ROS world frame)
 *   Y → green  (+Y left)
 *   Z → blue   (+Z up)
 *
 * A small white sphere marks the origin point.
 * Arrow heads and text labels have been removed — the TC gizmo (TransformControls)
 * serves as the interactive representation when a frame is selected on mobile.
 *
 * Visibility modes (mutually exclusive visual states):
 *   hidden      – group.visible = false (default, e.g. parent geometry not selected)
 *   showFull()  – full opacity + X-ray; used when the parent geometry is selected,
 *                 or when this frame is the active/selected frame in its chain
 *   showDimmed()– reduced opacity + X-ray; used for non-selected frames that are
 *                 shown as context when another frame in the same tree is selected
 *
 * setObjectSelected(bool) is layered ON TOP of the visibility mode:
 *   true  → origin sphere turns gold + scales up (marks the active frame)
 *   false → origin sphere white + normal scale
 *
 * Interface contract:
 *   - No `cuboid` property (returns null) → not raycast-able.
 *   - All methods called via AppController's `_meshView` that don't apply
 *     are implemented as no-ops so that code paths active for MeasureLine /
 *     ImportedMesh still work without a type-guard.
 *
 * @see MENTAL_MODEL.md §1 "CoordinateFrame Depth Rendering and Visibility Policy"
 * @see ADR-018
 */
import * as THREE from 'three'

const AXIS_LENGTH   = 0.5
const ORIGIN_RADIUS = 0.04

// Opacity levels for chain-visibility modes
const OPACITY_FULL   = 1.0
const OPACITY_DIMMED = 0.30   // context frames (visible but de-emphasised)
const OPACITY_LINE_FULL   = 0.80  // connection line — full
const OPACITY_LINE_DIMMED = 0.28  // connection line — dimmed

// ── Helpers ────────────────────────────────────────────────────────────────

function makeAxisLine(x, y, z, color) {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, x, y, z], 3))
  const mat = new THREE.LineBasicMaterial({ color, depthTest: true })
  return new THREE.Line(geo, mat)
}

// ── Class ──────────────────────────────────────────────────────────────────

export class CoordinateFrameView {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this._scene = scene

    // ── Origin sphere ──────────────────────────────────────────────────────
    const sphereGeo = new THREE.SphereGeometry(ORIGIN_RADIUS, 8, 8)
    const sphereMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
    this._originSphere = new THREE.Mesh(sphereGeo, sphereMat)

    // ── Axis lines (thin RGB, no arrowheads or labels) ─────────────────────
    this._lineX = makeAxisLine(AXIS_LENGTH, 0, 0, 0xff4444)
    this._lineY = makeAxisLine(0, AXIS_LENGTH, 0, 0x44cc44)
    this._lineZ = makeAxisLine(0, 0, AXIS_LENGTH, 0x4488ff)

    // ── Group ──────────────────────────────────────────────────────────────
    this._group = new THREE.Group()
    this._group.add(
      this._originSphere,
      this._lineX, this._lineY, this._lineZ,
    )

    this._group.visible = false  // hidden until explicitly shown

    /**
     * Dashed line from parent CoordinateFrame origin to this frame's origin.
     * Null until showConnection() is called for the first time.
     * @type {THREE.Line|null}
     */
    this._connectionLine = null

    scene.add(this._group)
  }

  // ── Required interface ─────────────────────────────────────────────────────

  /** No raycasting surface for CoordinateFrames. */
  get cuboid() { return null }

  /** @param {THREE.Vector3} position */
  updatePosition(position) {
    this._group.position.copy(position)
  }

  /** @param {import('three').Quaternion} quaternion */
  updateRotation(quaternion) {
    this._group.quaternion.copy(quaternion)
  }

  /** Outliner eye-icon toggle. */
  setVisible(visible) {
    this._group.visible = visible
  }

  // ── Visibility modes ───────────────────────────────────────────────────────

  /**
   * Show at full opacity with X-ray rendering.
   * Used when the parent geometry object is selected (all frames in the tree),
   * or for the active/selected frame itself within its tree.
   */
  showFull() {
    this._group.visible = true
    this._applyXray(OPACITY_FULL)
  }

  /**
   * Show at reduced opacity with X-ray rendering.
   * Used for non-selected context frames when another frame in the same tree
   * is the active selection — keeps them visible but shifts focus to the
   * selected frame.
   */
  showDimmed() {
    this._group.visible = true
    // Reset sphere to un-selected state before applying dimming
    this._originSphere.material.color.setHex(0xffffff)
    this._originSphere.scale.setScalar(1.0)
    this._applyXray(OPACITY_DIMMED)
  }

  /** Hide completely. Visibility restored by showFull() or showDimmed(). */
  hide() {
    this._group.visible = false
  }

  /**
   * Backward-compatibility alias.
   * @param {boolean} selected  true → showFull(), false → hide()
   */
  setParentSelected(selected) {
    if (selected) this.showFull()
    else this.hide()
  }

  // ── Selection highlight ────────────────────────────────────────────────────

  /**
   * Highlights the origin sphere to mark this frame as the active selection.
   * Layered on top of the current visibility mode (showFull / showDimmed).
   *   selected = true  → gold sphere (#ffcc00) + scale 1.6×
   *   selected = false → white sphere + scale 1.0
   * Does NOT change visibility or depthTest — those are managed by the
   * visibility methods above.
   * @param {boolean} selected
   */
  setObjectSelected(selected) {
    this._originSphere.material.color.setHex(selected ? 0xffcc00 : 0xffffff)
    this._originSphere.scale.setScalar(selected ? 1.6 : 1.0)
  }

  // ── Parent-child connection line ───────────────────────────────────────────

  /**
   * Shows the dashed connection line from the parent CoordinateFrame origin to
   * this frame's origin.  Lazily creates the Three.js Line on first call.
   * @param {boolean} [dimmed=false]  match the frame's opacity level
   */
  showConnection(dimmed = false) {
    if (!this._connectionLine) this._createConnectionLine()
    this._connectionLine.visible = true
    const opacity = dimmed ? OPACITY_LINE_DIMMED : OPACITY_LINE_FULL
    this._connectionLine.material.opacity     = opacity
    this._connectionLine.material.transparent = opacity < 1.0
    this._connectionLine.material.needsUpdate = true
  }

  /** Hides the connection line without disposing it. */
  hideConnection() {
    if (this._connectionLine) this._connectionLine.visible = false
  }

  /**
   * Updates both endpoints of the connection line.
   * Called every animation frame when the parent is also a CoordinateFrame.
   * Safe to call even when the line is invisible.
   * @param {THREE.Vector3} parentWorldPos
   */
  updateConnectionLine(parentWorldPos) {
    if (!this._connectionLine) return
    const attr = this._connectionLine.geometry.attributes.position
    attr.setXYZ(0, parentWorldPos.x, parentWorldPos.y, parentWorldPos.z)
    const p = this._group.position
    attr.setXYZ(1, p.x, p.y, p.z)
    attr.needsUpdate = true
    this._connectionLine.computeLineDistances()
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Releases all Three.js resources and removes the group from the scene.
   * @param {THREE.Scene} scene
   */
  dispose(scene) {
    scene.remove(this._group)
    this._group.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose()
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach(m => m.dispose())
        } else {
          obj.material.dispose()
        }
      }
    })
    if (this._connectionLine) {
      scene.remove(this._connectionLine)
      this._connectionLine.geometry.dispose()
      this._connectionLine.material.dispose()
      this._connectionLine = null
    }
  }

  /**
   * Scales the entire frame so the axis length appears at a constant screen
   * pixel size regardless of camera distance.  Call every animation frame.
   * Uses the same perspective-correction formula as MeasureLineView._scaleDots().
   *
   * @param {THREE.PerspectiveCamera} camera
   * @param {THREE.WebGLRenderer} renderer
   * @param {number} [maxWorldSize=Infinity]  Upper bound for the axis world length.
   *   Pass the parent object's bounding radius (× some factor) so the frame never
   *   grows larger than the parent when the user zooms far out.
   */
  updateScale(camera, renderer, maxWorldSize = Infinity) {
    if (!this._group.visible || !camera.isPerspectiveCamera) return
    const tanHalfFov = Math.tan((camera.fov * Math.PI) / 360)
    const screenH    = renderer.domElement.clientHeight || 1
    const targetPx   = 80   // axis length in screen pixels
    const d          = camera.position.distanceTo(this._group.position)
    let worldSize    = (targetPx / screenH) * 2 * d * tanHalfFov
    if (maxWorldSize < Infinity) worldSize = Math.min(worldSize, maxWorldSize)
    this._group.scale.setScalar(worldSize / AXIS_LENGTH)
  }

  // ── No-op interface (MENTAL_MODEL §1) ────────────────────────────────────
  setFaceHighlight()      {}
  clearExtrusionDisplay() {}
  clearSketchRect()       {}
  clearVertexHover()      {}
  clearEdgeHover()        {}
  clearEditSelection()    {}
  clearPivotDisplay()     {}
  clearSnapDisplay()      {}
  showSnapCandidates()    {}
  showSnapNearest()       {}
  clearSnapNearest()      {}
  showSnapLocked()        {}
  clearSnapLocked()       {}
  updateGeometry()        {}
  updateBoxHelper()       {}

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Applies X-ray rendering (depthTest: false, renderOrder: 1) and the given
   * opacity to all line and sphere materials.
   * @param {number} opacity  0–1
   */
  _applyXray(opacity) {
    const transparent = opacity < 1.0
    for (const line of [this._lineX, this._lineY, this._lineZ]) {
      line.material.depthTest   = false
      line.material.transparent = transparent
      line.material.opacity     = opacity
      line.material.needsUpdate = true
      line.renderOrder          = 1
    }
    this._originSphere.material.depthTest   = false
    this._originSphere.material.transparent = transparent
    this._originSphere.material.opacity     = opacity
    this._originSphere.material.needsUpdate = true
    this._originSphere.renderOrder          = 1
  }

  /** Lazily creates the dashed connection line Three.js object. */
  _createConnectionLine() {
    const positions = new Float32Array(6)  // 2 points × 3 coords
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const mat = new THREE.LineDashedMaterial({
      color:     0xcccccc,
      dashSize:  0.06,
      gapSize:   0.04,
      depthTest: false,
    })
    this._connectionLine = new THREE.Line(geo, mat)
    this._connectionLine.renderOrder = 1
    this._connectionLine.visible     = false
    this._scene.add(this._connectionLine)
  }
}
