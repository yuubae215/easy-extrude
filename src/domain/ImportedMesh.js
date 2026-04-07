/**
 * ImportedMesh — domain entity for STEP / server-side geometry imports (Phase C).
 *
 * Thin-client entity: geometry is computed on the server and streamed via the
 * Geometry Service WebSocket. The entity itself carries only identity + display
 * state — no local vertex/edge/face graph.
 *
 * Movement is supported via a synthetic 8-corner AABB (initialised from the
 * imported geometry's bounding box). The corners are updated by move() and
 * reflected to the view via AppController's standard updateGeometry() call.
 *
 * Type identity:
 *   `instanceof ImportedMesh` → imported geometry; move OK, no Edit Mode.
 *   `instanceof Solid`        → locally-editable deformable 3D solid.
 *   `instanceof Profile`      → 2D cross-section awaiting extrusion.
 */
import * as THREE from 'three'

export class ImportedMesh {
  /**
   * @param {string} id
   * @param {string} name
   * @param {import('../view/ImportedMeshView.js').ImportedMeshView} meshView
   */
  constructor(id, name, meshView) {
    this.id       = id
    this.name     = name
    this.meshView = meshView
    /** @type {string|null} IFC4 class name (e.g. 'IfcWall'); null = unclassified. @see ADR-025 */
    this.ifcClass = null
    /** @type {import('../types/spatial.js').WorldVector3[]} synthetic 8 AABB corners for grab/drag — set by initCorners() */
    this._corners8 = []
  }

  /** Returns the 8 synthetic bounding-box corners (world space).
   * @returns {import('../types/spatial.js').WorldVector3[]}
   */
  get corners() { return this._corners8 }

  /** Renames the entity. */
  rename(name) {
    this.name = name
  }

  /**
   * Initialises the 8 corner positions from the imported geometry's bounding box.
   * Called by SceneService after updateGeometryBuffers().
   * @param {THREE.Vector3[]} corners8
   */
  initCorners(corners8) {
    this._corners8 = /** @type {import('../types/spatial.js').WorldVector3[]} */ (corners8.map(c => c.clone()))
  }

  /**
   * Translates the mesh by delta (same API as Cuboid.move).
   * Mutates _corners8 in place; AppController calls meshView.updateGeometry() afterward.
   * @param {THREE.Vector3[]} startCorners  snapshot taken at grab/drag start
   * @param {THREE.Vector3}   delta         displacement from start position
   */
  move(startCorners, delta) {
    startCorners.forEach((c, i) => { this._corners8[i].copy(c).add(delta) })
  }
}
