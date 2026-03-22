/**
 * MeasureLine — domain entity for a 1D measurement line.
 *
 * Stores two world-space endpoints and exposes a `distance` getter.
 * Immutable geometry after creation (endpoints are set during placement).
 * Editing endpoints via Edit Mode · 1D is a planned future extension.
 *
 * Type identity:
 *   `instanceof MeasureLine` → read-only 1D measurement; limited Edit Mode.
 *   `instanceof Cuboid`      → locally-editable deformable box.
 *   `instanceof Sketch`      → 2D sketch awaiting extrusion.
 *   `instanceof ImportedMesh`→ server-side read-only geometry.
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

  /** Renames the entity. */
  rename(name) {
    this.name = name
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
