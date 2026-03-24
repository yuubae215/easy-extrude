/**
 * MeasureLine — domain entity for a 1D measurement line.
 *
 * Stores two world-space endpoints and exposes a `distance` getter.
 * The line can be moved as a whole via Grab (G key); the distance is preserved.
 * Editing individual endpoints via Edit Mode · 1D is a planned future extension.
 *
 * Type identity:
 *   `instanceof MeasureLine` → 1D measurement; move OK, no Edit Mode.
 *   `instanceof Cuboid`      → locally-editable deformable box.
 *   `instanceof Sketch`      → 2D sketch awaiting extrusion.
 *   `instanceof ImportedMesh`→ server-side geometry; move OK, no Edit Mode.
 */
import * as THREE from 'three'

export class MeasureLine {
  /**
   * @param {string}        id
   * @param {string}        name
   * @param {THREE.Vector3} p1   start endpoint (world space)
   * @param {THREE.Vector3} p2   end endpoint (world space)
   * @param {import('../view/MeasureLineView.js').MeasureLineView} meshView
   */
  constructor(id, name, p1, p2, meshView) {
    this.id       = id
    this.name     = name
    /** @type {THREE.Vector3} */
    this.p1       = p1.clone()
    /** @type {THREE.Vector3} */
    this.p2       = p2.clone()
    this.meshView = meshView
  }

  /** World-space distance between the two endpoints (metres). */
  get distance() {
    return this.p1.distanceTo(this.p2)
  }

  /**
   * Returns [p1, p2] as the canonical "corners" used by the grab/drag system.
   * p1 and p2 are the actual mutable Vector3 instances (not copies), so the
   * cancel-grab restore path (`corners[i].copy(saved)`) works correctly.
   * @returns {THREE.Vector3[]}
   */
  get corners() { return [this.p1, this.p2] }

  /** Renames the entity. */
  rename(name) {
    this.name = name
  }

  /**
   * Translates both endpoints by delta (same API as Cuboid.move).
   * AppController calls meshView.updateGeometry() separately after this.
   * @param {THREE.Vector3[]} startCorners  [p1_snap, p2_snap] taken at drag start
   * @param {THREE.Vector3}   delta         displacement from start
   */
  move(startCorners, delta) {
    this.p1.copy(startCorners[0]).add(delta)
    this.p2.copy(startCorners[1]).add(delta)
  }

  /**
   * Updates both endpoints and refreshes the view.
   * @param {THREE.Vector3} p1
   * @param {THREE.Vector3} p2
   */
  setEndpoints(p1, p2) {
    this.p1.copy(p1)
    this.p2.copy(p2)
    this.meshView?.update(this.p1, this.p2)
  }
}
