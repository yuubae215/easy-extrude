/**
 * CoordinateFrame - a named reference frame attached to a parent object's origin.
 *
 * Represents an SE(3) coordinate frame that is a child of a geometry object.
 * Its world pose is derived by SceneService._updateWorldPoses() each frame and
 * cached in SceneService._worldPoseCache — it does NOT live on this entity.
 *
 * Domain invariants (stored on entity): parentId, translation, rotation.
 * Derived state (service-owned): world position, world quaternion.
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
 *   Displayed in the N panel as intrinsic ZYX Euler = extrinsic XYZ = ROS RPY (degrees).
 *   "Intrinsic ZYX" means: first rotate around local Z (yaw), then local Y (pitch),
 *   then local X (roll). This is the ROS RPY convention.
 *   Equivalent Three.js order string: 'ZYX'.
 *   Conversion:
 *     display → storage:  new THREE.Euler(rx, ry, rz, 'ZYX')  → quaternion
 *     storage → display:  euler.setFromQuaternion(q, 'ZYX')   → degrees
 *
 * Translation representation:
 *   `this.translation` is a world-space offset from the parent centroid.
 *   Origin frame: translation = (0,0,0) always (locked in N panel).
 *   Non-origin frames: translation can be any Vector3; edited via G key or
 *   the N panel Location (Local) fields.
 *   World pose: SceneService._worldPoseCache[id].position = parentCentroid + translation
 *
 * ─── Grab / move mechanics ───────────────────────────────────────────────────
 *   `get localOffset()` returns `[this.translation]` — a single-element array.
 *   The grab system saves `[translation.clone()]` at grab-start; on cancel it
 *   restores `translation.copy(saved)`. SceneService._updateWorldPoses() then
 *   recomputes the correct world position from the restored translation.
 *
 *   NOTE: The drag plane center in AppController._startGrab() must use
 *   SceneService.worldPoseOf(frame.id).position (not translation) so the plane
 *   passes through the frame's actual world position.
 *
 *   NOTE: CoordinateFrame intentionally does NOT have a `corners` property.
 *   Geometry entities expose `corners` (WorldVector3[]); CoordinateFrame exposes
 *   `localOffset` (LocalVector3[]) — distinct names enforce the semantic
 *   distinction at the API level (PHILOSOPHY #21, Phase 3).
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
 * @see ADR-020, ADR-016, ADR-018
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
     * Updated by Grab (move()), N-panel edits, and world-pose back-derivation.
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
     * Provenance role that declared this frame (ADR-034 §8.1).
     * null  = no restriction — always editable.
     * 'modeller'   = only the geometry modeller role may edit.
     * 'integrator' = only the integrator role may edit.
     * @type {'modeller' | 'integrator' | null}
     */
    this.declaredBy = null
  }

  /** @param {string} name */
  rename(name) { this.name = name }

  /**
   * Returns [this.translation] — a single-element array holding a reference
   * to the frame's mutable translation vector.
   *
   * Used by the grab system for save/restore (cancel restores translation):
   *  - `startHandles = localOffset.map(c => c.clone())` saves [translation.clone()]
   *  - `move(startHandles, delta)` updates translation in-place
   *  - Cancel: `localOffset[0].copy(saved)` = `translation.copy(saved)` ✓
   *
   * NOTE: getCentroid(localOffset) = translation, NOT world position.
   * AppController._startGrab() uses SceneService.worldPoseOf(id).position
   * for the drag plane center.
   *
   * CONTRACT: returns LocalVector3 (local offset from parent), NOT WorldVector3.
   * Distinct property name (`localOffset`, not `corners`) enforces the semantic
   * distinction at the API level — accessing `.corners` on a CoordinateFrame
   * returns undefined (PHILOSOPHY #21 Phase 3, CODE_CONTRACTS architecture.md).
   *
   * @returns {[import('../types/spatial.js').LocalVector3]}
   */
  get localOffset() { return /** @type {[import('../types/spatial.js').LocalVector3]} */ ([this.translation]) }

  /**
   * Translates the frame by `delta` from its grab-start translation.
   * `translation` is a world-space offset from parent centroid, so adding a
   * world-space `delta` directly is correct.
   *
   * SceneService._updateWorldPoses() picks up the updated translation on the
   * next frame and recomputes the world pose in the cache.
   *
   * @param {[Vector3]} startLocalOffset  saved [translation] at grab start
   * @param {Vector3}   delta             world-space movement vector
   */
  move(startLocalOffset, delta) {
    this.translation.copy(startLocalOffset[0]).add(delta)
  }
}
