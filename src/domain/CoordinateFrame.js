/**
 * CoordinateFrame - a named reference frame attached to a parent object's origin.
 *
 * Represents an SE(3) coordinate frame that is a child of a geometry object.
 * The frame's world position is derived from its parent object's centroid.
 * In the Outliner, CoordinateFrames appear indented under their parent object,
 * expressing the spatial hierarchy.
 *
 * Type guard: instanceof CoordinateFrame
 *
 * Capability matrix (Phase A):
 *   - Edit Mode:         blocked (no vertex graph)
 *   - Grab/Move (G key): blocked (position is parent-derived)
 *   - Pointer drag:      blocked (no cuboid raycasting surface)
 *   - Ctrl+drag rotate:  blocked
 *   - Rename:            allowed
 *   - Delete:            allowed (also deleted on parent deletion — cascade)
 *
 * This entity forms the first layer of the ADR-016 transform graph on the
 * frontend — a SceneObject hierarchy that parallels the TransformNode tree
 * managed by the Geometry Service.
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
     * Relative translation from parent origin (world units).
     * Default: zero vector (frame origin coincides with parent centroid).
     * @type {Vector3}
     */
    this.translation = new Vector3()

    /**
     * Relative rotation from parent orientation.
     * Default: identity quaternion (frame axes aligned with world axes).
     * @type {Quaternion}
     */
    this.rotation = new Quaternion()
  }

  /** @param {string} name */
  rename(name) { this.name = name }

  /**
   * CoordinateFrame has no geometric extent.
   * Returns an empty array so collectSnapTargets / corner-based ops skip it.
   * @returns {import('three').Vector3[]}
   */
  get corners() { return [] }

  /**
   * Position is managed by the parent object — move() is intentionally a no-op
   * in Phase A.  Phase B will allow relative-transform editing via the
   * Node Editor.
   */
  move() {}
}
