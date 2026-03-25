/**
 * CoordinateFrameView - Three.js representation of a CoordinateFrame entity.
 *
 * Renders three colour-coded arrow helpers at the frame origin:
 *   X → red    (+X forward in ROS world frame)
 *   Y → green  (+Y left)
 *   Z → blue   (+Z up)
 *
 * Each axis has a matching text label sprite (X / Y / Z) positioned just
 * past the arrowhead so the reference direction is immediately readable.
 * A small white sphere marks the origin point.
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

const AXIS_LENGTH   = 0.5   // arrow shaft + head combined (world units)
const HEAD_LENGTH   = 0.12
const HEAD_WIDTH    = 0.06
const ORIGIN_RADIUS = 0.04
const LABEL_OFFSET  = AXIS_LENGTH + 0.09  // just past the arrowhead tip

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Creates a canvas-texture sprite for an axis label (e.g. "X", "Y", "Z").
 * @param {string} letter   single character
 * @param {number} hexColor  e.g. 0xff4444
 * @returns {THREE.Sprite}
 */
function makeAxisLabel(letter, hexColor) {
  const size   = 64
  const canvas = document.createElement('canvas')
  canvas.width  = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, size, size)
  ctx.fillStyle = `#${hexColor.toString(16).padStart(6, '0')}`
  ctx.font          = `bold ${Math.round(size * 0.72)}px sans-serif`
  ctx.textAlign     = 'center'
  ctx.textBaseline  = 'middle'
  ctx.fillText(letter, size / 2, size / 2)
  const tex = new THREE.CanvasTexture(canvas)
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true })
  const sprite = new THREE.Sprite(mat)
  sprite.scale.set(0.18, 0.18, 1)
  return sprite
}

// ── Class ──────────────────────────────────────────────────────────────────

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

    // ── Axis labels (X / Y / Z sprites) ───────────────────────────────────
    this._labelX = makeAxisLabel('X', 0xff4444)
    this._labelX.position.set(LABEL_OFFSET, 0, 0)
    this._labelY = makeAxisLabel('Y', 0x44cc44)
    this._labelY.position.set(0, LABEL_OFFSET, 0)
    this._labelZ = makeAxisLabel('Z', 0x4488ff)
    this._labelZ.position.set(0, 0, LABEL_OFFSET)

    // ── Group ──────────────────────────────────────────────────────────────
    this._group = new THREE.Group()
    this._group.add(
      this._originSphere,
      this._arrowX,
      this._arrowY,
      this._arrowZ,
      this._labelX,
      this._labelY,
      this._labelZ,
    )

    this._group.visible = false  // hidden until parent object is selected
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
   * Shows or hides the frame based on whether its parent object is selected.
   * When shown, applies X-ray (depthTest: false) so the frame is always visible
   * through the parent geometry.
   * @param {boolean} selected
   */
  setParentSelected(selected) {
    this._group.visible = selected
    if (selected) {
      for (const arrow of [this._arrowX, this._arrowY, this._arrowZ]) {
        arrow.line.material.depthTest = false; arrow.line.renderOrder = 1
        arrow.cone.material.depthTest = false; arrow.cone.renderOrder = 1
      }
      for (const label of [this._labelX, this._labelY, this._labelZ]) {
        label.material.depthTest = false; label.renderOrder = 1
      }
      this._originSphere.material.depthTest = false
      this._originSphere.renderOrder        = 1
    }
  }

  /**
   * Highlights the frame when it is the active/selected object.
   *
   * Selected   → depthTest: false + renderOrder: 1 so the frame always renders
   *              on top of any overlapping geometry (Option A).
   * Deselected → depthTest: true (default) so the frame is naturally occluded
   *              by surrounding geometry (Option C — hidden is acceptable when
   *              not interacting with the frame).
   *
   * @param {boolean} selected
   */
  setObjectSelected(selected) {
    const depthTest   = !selected
    const renderOrder =  selected ? 1 : 0

    for (const arrow of [this._arrowX, this._arrowY, this._arrowZ]) {
      arrow.line.material.depthTest = depthTest
      arrow.cone.material.depthTest = depthTest
      arrow.line.renderOrder        = renderOrder
      arrow.cone.renderOrder        = renderOrder
    }
    for (const label of [this._labelX, this._labelY, this._labelZ]) {
      label.material.depthTest = depthTest
      label.renderOrder        = renderOrder
    }
    this._originSphere.material.depthTest = depthTest
    this._originSphere.renderOrder        = renderOrder
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
        if (Array.isArray(obj.material)) {
          obj.material.forEach(m => { if (m.map) m.map.dispose(); m.dispose() })
        } else {
          if (obj.material.map) obj.material.map.dispose()
          obj.material.dispose()
        }
      }
    })
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
  showSnapLocked()        {}
  clearSnapLocked()       {}
  updateGeometry()        {}
  updateBoxHelper()       {}
}
