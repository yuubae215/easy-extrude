/**
 * CoordinateFrameView - Three.js representation of a CoordinateFrame entity.
 *
 * Renders three colour-coded arrow helpers at the frame origin:
 *   X → red    (+X forward in ROS world frame)
 *   Y → green  (+Y left)
 *   Z → blue   (+Z up)
 *
 * A small white sphere marks the origin point.
 * A wireframe sphere is shown when the frame is selected.
 *
 * Interface contract:
 *   - No `cuboid` property (returns null) → not raycast-able.
 *   - All methods called via AppController's `_meshView` that don't apply
 *     are implemented as no-ops so that code paths active for MeasureLine /
 *     ImportedMesh still work without a type-guard.
 *
 * @see MENTAL_MODEL.md §1 "MeasureLineView No-Op Interface Completeness"
 * @see ADR-018
 */
import * as THREE from 'three'

const AXIS_LENGTH    = 0.5   // arrow shaft + head combined (world units)
const HEAD_LENGTH    = 0.12
const HEAD_WIDTH     = 0.06
const ORIGIN_RADIUS  = 0.04
const SELECTION_R    = 0.14

export class CoordinateFrameView {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this._scene = scene

    // ── Origin sphere ──────────────────────────────────────────────────────
    const sphereGeo = new THREE.SphereGeometry(ORIGIN_RADIUS, 8, 8)
    const sphereMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
    this._originSphere = new THREE.Mesh(sphereGeo, sphereMat)

    // ── Axes ───────────────────────────────────────────────────────────────
    const ZERO = new THREE.Vector3()
    this._arrowX = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0), ZERO, AXIS_LENGTH, 0xff4444, HEAD_LENGTH, HEAD_WIDTH,
    )
    this._arrowY = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0), ZERO, AXIS_LENGTH, 0x44cc44, HEAD_LENGTH, HEAD_WIDTH,
    )
    this._arrowZ = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1), ZERO, AXIS_LENGTH, 0x4488ff, HEAD_LENGTH, HEAD_WIDTH,
    )

    // ── Selection indicator (wireframe sphere) ────────────────────────────
    const ringGeo = new THREE.SphereGeometry(SELECTION_R, 12, 12)
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff8c69,
      wireframe: true,
      transparent: true,
      opacity: 0,
    })
    this._selectionRing = new THREE.Mesh(ringGeo, ringMat)

    // ── Group ──────────────────────────────────────────────────────────────
    this._group = new THREE.Group()
    this._group.add(
      this._originSphere,
      this._arrowX,
      this._arrowY,
      this._arrowZ,
      this._selectionRing,
    )

    scene.add(this._group)
  }

  // ── Required interface ─────────────────────────────────────────────────────

  /** No raycasting surface for CoordinateFrames. */
  get cuboid() { return null }

  /**
   * Positions the frame origin in world space.
   * Called by SceneService at creation and by AppController's animation loop
   * to keep the frame locked to its parent's centroid.
   * @param {THREE.Vector3} position
   */
  updatePosition(position) {
    this._group.position.copy(position)
  }

  /**
   * Applies a world-space rotation quaternion to the frame's axes.
   * Called by AppController after rotate operations (R key).
   * @param {import('three').Quaternion} quaternion
   */
  updateRotation(quaternion) {
    this._group.quaternion.copy(quaternion)
  }

  /** @param {boolean} visible */
  setVisible(visible) {
    this._group.visible = visible
  }

  /**
   * Highlights the frame when it is the active/selected object.
   * @param {boolean} selected
   */
  setObjectSelected(selected) {
    this._selectionRing.material.opacity = selected ? 0.55 : 0
  }

  /**
   * Releases all Three.js resources and removes the group from the scene.
   * @param {THREE.Scene} scene
   */
  dispose(scene) {
    scene.remove(this._group)
    this._group.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose()
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose())
        else obj.material.dispose()
      }
    })
  }

  // ── No-op interface (MENTAL_MODEL §1) ────────────────────────────────────
  setFaceHighlight()     {}
  clearExtrusionDisplay() {}
  clearSketchRect()      {}
  clearVertexHover()     {}
  clearEdgeHover()       {}
  clearEditSelection()   {}
  clearPivotDisplay()    {}
  clearSnapDisplay()     {}
  showSnapCandidates()   {}
  showSnapLocked()       {}
  clearSnapLocked()      {}
  updateGeometry()       {}
  updateBoxHelper()      {}
}
