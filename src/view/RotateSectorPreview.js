import * as THREE from 'three'

const AXIS_COLOR = { x: 0xe05555, y: 0x50c060, z: 0x4d80e6 }
const FREE_COLOR = 0xaabbff

/**
 * Transient 3D sector (pie-slice) rendered in the viewport during R-key rotation.
 *
 * Lives entirely in the view layer — no domain state.
 * Lifecycle: show() → updateAngle() (per pointer move) → hide() on confirm/cancel.
 */
export class RotateSectorPreview {
  /** @param {import('three').Scene} scene */
  constructor(scene) {
    this._scene  = scene
    this._group  = null
    this._mesh   = null
    this._mat    = null
    this._radius = 1
  }

  /**
   * Creates the sector mesh at the pivot and adds it to the scene.
   * Safe to call repeatedly — tears down any previous sector first.
   *
   * @param {import('three').Vector3}   center - Pivot point in world space
   * @param {number}                    radius - Outer radius in world units
   * @param {'x'|'y'|'z'|null}         axis   - Constrained axis, or null for free (camera-facing)
   * @param {import('three').Camera}    camera - Required when axis is null (free rotation)
   */
  show(center, radius, axis, camera) {
    this.hide()

    this._radius = Math.max(radius, 0.25)

    this._mat = new THREE.MeshBasicMaterial({
      color:               axis ? (AXIS_COLOR[axis] ?? FREE_COLOR) : FREE_COLOR,
      side:                THREE.DoubleSide,
      transparent:         true,
      opacity:             0.25,
      depthWrite:          false,
      depthTest:           true,
      polygonOffset:       true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits:  -4,
    })

    // Start with an invisible zero-angle sector; updateAngle() gives it shape
    this._mesh = new THREE.Mesh(
      new THREE.RingGeometry(0, this._radius, 2, 1, 0, 0),
      this._mat,
    )

    this._group = new THREE.Group()
    this._group.position.copy(center)
    this._group.quaternion.copy(this._ringOrientation(axis, camera))
    this._group.add(this._mesh)
    this._scene.add(this._group)
  }

  /**
   * Rebuilds the sector geometry to match the given cumulative rotation angle.
   * Positive = counter-clockwise fan from 0; negative = clockwise fan toward 0.
   * @param {number} angle - Radians
   */
  updateAngle(angle) {
    if (!this._mesh) return
    this._mesh.geometry.dispose()

    const abs   = Math.abs(angle)
    const start = angle < 0 ? angle : 0
    const segs  = Math.max(3, Math.ceil(abs * 16))
    this._mesh.geometry = new THREE.RingGeometry(0, this._radius, segs, 1, start, abs)
  }

  /** Removes the sector from the scene and releases GPU resources. */
  hide() {
    if (!this._group) return
    this._scene.remove(this._group)
    this._mesh?.geometry.dispose()
    this._mat?.dispose()
    this._group = null
    this._mesh  = null
    this._mat   = null
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  /**
   * Returns the quaternion that orients the ring's +Z normal along the rotation axis.
   * THREE.RingGeometry lies in the XY plane by default (normal = +Z).
   *
   * @param {'x'|'y'|'z'|null}       axis
   * @param {import('three').Camera}  camera
   * @returns {import('three').Quaternion}
   */
  _ringOrientation(axis, camera) {
    const q = new THREE.Quaternion()
    if (axis === 'x') {
      // Ring in YZ plane: rotate around world Y by +90°
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
    } else if (axis === 'y') {
      // Ring in XZ plane: rotate around world X by −90°
      q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)
    } else if (axis !== 'z' && camera) {
      // Free rotation (screen-plane): ring faces the viewer.
      // The rotation axis in AppController is getWorldDirection().negate(),
      // so we orient the ring normal the same way (toward viewer).
      const fwd = new THREE.Vector3()
      camera.getWorldDirection(fwd)
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), fwd.negate())
    }
    // axis === 'z': ring is already in XY plane — identity quaternion (default)
    return q
  }
}
