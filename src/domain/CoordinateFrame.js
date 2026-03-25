/**
 * CoordinateFrame - a named reference frame attached to a parent object's origin.
 *
 * Represents an SE(3) coordinate frame that is a child of a geometry object.
 * The frame's world position is derived from its parent object's centroid plus
 * a relative `translation` offset.  In the Outliner, CoordinateFrames appear
 * indented under their parent, expressing the spatial hierarchy.
 *
 * Type guard: instanceof CoordinateFrame
 *
 * ─── Coordinate system conventions ──────────────────────────────────────────
 *
 * World frame (ROS REP-103, right-handed):
 *   +X  forward
 *   +Y  left
 *   +Z  up
 *   Ground plane = XY plane (Z = 0)
 *   camera.up = (0, 0, 1)  (Three.js)
 *
 * Rotation representation:
 *   Stored internally as a unit quaternion (`this.rotation: THREE.Quaternion`).
 *   Right-handed convention — positive angle = counter-clockwise when the
 *   thumb points along the positive axis.
 *
 *   Displayed in the N panel as intrinsic Euler XYZ (degrees).
 *   "Intrinsic XYZ" means: first rotate around local X, then local Y, then
 *   local Z.  Equivalent Three.js order string: 'XYZ'.
 *   Conversion:
 *     display → storage:  new THREE.Euler(rx, ry, rz, 'XYZ')  → quaternion
 *     storage → display:  euler.setFromQuaternion(q, 'XYZ')   → degrees
 *
 * Translation representation:
 *   `this.translation` is a world-space offset from the parent centroid.
 *   Origin frame: translation = (0,0,0) always (locked in N panel).
 *   Non-origin frames: translation can be any Vector3; edited via G key or
 *   the N panel Location (Local) fields.
 *   Local-to-world: worldPos = parentCentroid + translation
 *   N panel shows localPos = translation rotated into the parent's local frame
 *   (i.e. applyQuaternion(parentRot.conjugate())).
 *
 * ─── Capability matrix ───────────────────────────────────────────────────────
 *   Edit Mode:         blocked (no vertex graph)
 *   Grab/Move (G key): allowed — moves the translation offset relative to parent
 *   Rotate  (R key):   allowed — modifies rotation quaternion around chosen axis
 *   Pointer drag:      blocked (no cuboid raycasting surface)
 *   Ctrl+drag rotate:  blocked
 *   Rename:            allowed
 *   Delete:            allowed (also deleted on parent deletion — cascade)
 *
 * ─── Position model ──────────────────────────────────────────────────────────
 *   _worldPos  = parentCentroid + translation   (kept in sync by animation loop)
 *   translation = _worldPos − parentCentroid    (updated after each Grab move)
 *
 * The animation loop always recomputes `_worldPos` so the frame follows its
 * parent when the parent is grabbed/moved.  When the user grabs the frame
 * itself, `move()` updates `_worldPos`; the next animation-loop tick derives
 * the new `translation` from the difference, preserving the offset for
 * subsequent parent moves.
 *
 * @see ADR-016, ADR-018
 */
import { Vector3, Quaternion } from 'three'

export class CoordinateFrame {
  /**
   * @param {string} id
   * @param {string} name
   * @param {string} parentId  ID of the parent SceneObject (geometry object)
   * @param {import('../view/CoordinateFrameView.js').CoordinateFrameView} meshView
   */
  constructor(id, name, parentId, meshView) {
    this.id       = id
    this.name     = name
    /** ID of the parent geometry object. Never null for a CoordinateFrame. */
    this.parentId = parentId
    this.meshView = meshView

    /**
     * Relative translation from parent centroid (world units).
     * Default: zero vector (frame origin coincides with parent centroid).
     * Updated by the animation loop after each Grab move.
     * @type {Vector3}
     */
    this.translation = new Vector3()

    /**
     * Relative rotation from parent orientation.
     * Default: identity quaternion (frame axes aligned with world axes).
     * Phase B: exposed for Node-Editor editing.
     * @type {Quaternion}
     */
    this.rotation = new Quaternion()

    /**
     * Cached world-space position.  Mutated directly by `move()` and
     * recomputed by the AppController animation loop.  Returned by `corners`
     * so the standard Grab machinery works without modification.
     * @type {Vector3}
     */
    this._worldPos = new Vector3()
  }

  /** @param {string} name */
  rename(name) { this.name = name }

  /**
   * Returns [_worldPos] — a single-element array holding a reference to the
   * frame's mutable world-position vector.
   *
   * Conventions shared with the Grab system:
   *  - `startCorners = corners.map(c => c.clone())` saves [_worldPos.clone()]
   *  - `move(startCorners, delta)` updates _worldPos in-place
   *  - Cancel: `corners[0].copy(saved)` = `_worldPos.copy(saved)` ✓
   *  - `getCentroid(corners)` = _worldPos, which is world-space ✓ (correct drag plane)
   *
   * @returns {[Vector3]}
   */
  get corners() { return [this._worldPos] }

  /**
   * Translates the frame by `delta` from its grab-start position.
   * `_worldPos` is updated in-place; the animation loop derives the new
   * `translation` offset from `_worldPos − parentCentroid` on the next tick.
   *
   * @param {[Vector3]} startCorners  saved [_worldPos] at grab start
   * @param {Vector3}   delta         world-space movement vector
   */
  move(startCorners, delta) {
    this._worldPos.copy(startCorners[0]).add(delta)
  }
}
