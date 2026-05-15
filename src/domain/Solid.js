/**
 * Solid — domain entity representing a 3D deformable solid body.
 *
 * Renamed from `Cuboid` (ADR-020): the entity is not necessarily box-shaped;
 * it is a general 3D solid body with a boundary graph (vertices / edges / faces).
 *
 * DDD Phase 2: behaviour methods own the mutation logic that previously
 * lived in AppController.
 *
 * Graph model (ADR-012):
 *   Phase 5-1: geometry stored as Vertex[8]; `get corners()` provides backward compat.
 *   Phase 5-3: explicit Face[6] and Edge[12] objects; `dimension` field removed —
 *              entity type (instanceof Solid) now carries the dimensional identity.
 *
 * Data model (ADR-040, supersedes ADR-036 "known limitation"):
 *   Primary triple: _position (body-frame origin), orientation (Quaternion), localCorners (8 local Vector3s).
 *   World corners = _position + orientation.apply(localCorners[i]).
 *   vertices[i].position = world corners (kept in sync by _rebuildWorldCorners).
 *   get corners() is unchanged — still returns vertices.map(v => v.position).
 *   get bodyRotation() is a zero-cost alias for orientation (backward compat).
 *
 * Note: `meshView` is co-located on the entity for now.
 *
 * @see ADR-040, ADR-020, ADR-012, ADR-009, ADR-025
 */
import { FACES }                from '../model/CuboidModel.js'
import { Face }                 from '../graph/Face.js'
import { Edge }                 from '../graph/Edge.js'
import { Vector3, Quaternion }  from 'three'

// 12 unique edges of a cuboid (vertex index pairs).
// Order: 4 bottom ring, 4 top ring, 4 vertical pillars.
const EDGE_PAIRS = [
  [0, 1], [1, 2], [2, 3], [3, 0],  // bottom ring
  [4, 5], [5, 6], [6, 7], [7, 4],  // top ring
  [0, 4], [1, 5], [2, 6], [3, 7],  // vertical
]

export class Solid {
  /**
   * @param {string} id
   * @param {string} name
   * @param {import('../graph/Vertex.js').Vertex[]} vertices  8 vertex objects whose positions are world coords
   * @param {import('../view/MeshView.js').MeshView} meshView
   */
  constructor(id, name, vertices, meshView) {
    this.id          = id
    this.name        = name
    this.description = ''
    /** @type {string|null} IFC4 class name (e.g. 'IfcWall'); null = unclassified. @see ADR-025 */
    this.ifcClass    = null
    /** @type {import('../graph/Vertex.js').Vertex[]} */
    this.vertices    = vertices

    /** @type {import('../graph/Face.js').Face[]}  6 faces in FACES order */
    this.faces = FACES.map((f, fi) =>
      new Face(`${id}_f${fi}`, f.corners.map(ci => vertices[ci]), f.name, fi)
    )

    /** @type {import('../graph/Edge.js').Edge[]}  12 edges */
    this.edges = EDGE_PAIRS.map(([a, b], ei) =>
      new Edge(`${id}_e${ei}`, vertices[a], vertices[b])
    )

    /** @type {import('../view/MeshView.js').MeshView} */
    this.meshView    = meshView

    // ── ADR-040 primary state ────────────────────────────────────────────
    /**
     * Body-frame origin in world space.
     * Initialised to the centroid of the passed world corners.
     * Not guaranteed to equal the current centroid after face extrude.
     * @type {Vector3}
     */
    this._position = new Vector3()

    /**
     * Authoritative cumulative world orientation (ROS TF style).
     * Replaces bodyRotation as the Single Source of Truth (ADR-040).
     * Child CoordinateFrames derive their world pose via:
     *   worldPos = getCentroid(corners) + orientation × localTranslation
     * @type {Quaternion}
     */
    this.orientation = new Quaternion()

    /**
     * Corner positions in body frame (persistent shape definition).
     * worldCorner[i] = _position + orientation.apply(localCorners[i]).
     * @type {import('../types/spatial.js').LocalVector3[]}
     */
    this.localCorners = /** @type {import('../types/spatial.js').LocalVector3[]} */ (vertices.map(() => new Vector3()))

    // Initialise pose from passed world corners (identity orientation, centroid as origin).
    this._initFromWorldCorners(vertices.map(v => v.position))
  }

  // ── Backward compat ───────────────────────────────────────────────────
  /**
   * Alias for `orientation` — all in-place callers (.copy, .premultiply, .set) still work.
   * @returns {Quaternion}
   */
  get bodyRotation() { return this.orientation }

  // ── Derived geometry ──────────────────────────────────────────────────
  /**
   * Returns the vertex positions as a plain Vector3 array (world space).
   * Same objects as vertices[i].position — mutations are visible immediately.
   * @returns {import('../types/spatial.js').WorldVector3[]}
   */
  get corners() {
    return /** @type {import('../types/spatial.js').WorldVector3[]} */ (this.vertices.map(v => v.position))
  }

  // ── Internal helpers ──────────────────────────────────────────────────

  /** Compute initial pose (identity orientation, centroid as origin) from world corners. */
  _initFromWorldCorners(worldCorners) {
    // _position = centroid
    this._position.set(0, 0, 0)
    for (const c of worldCorners) this._position.add(c)
    this._position.divideScalar(worldCorners.length)
    // localCorners[i] = worldCorner[i] - centroid  (identity orientation)
    for (let i = 0; i < 8; i++) {
      this.localCorners[i].copy(worldCorners[i]).sub(this._position)
    }
    // orientation already identity; vertices already have world positions.
  }

  /**
   * Recomputes vertices[i].position from the primary triple (_position, orientation, localCorners).
   * Must be called after every mutation to _position, orientation, or localCorners.
   * Uses in-place operations — zero allocation (GC-friendly for per-frame calls).
   */
  _rebuildWorldCorners() {
    for (let i = 0; i < 8; i++) {
      this.vertices[i].position
        .copy(this.localCorners[i])
        .applyQuaternion(this.orientation)
        .add(this._position)
    }
  }

  // ── Public mutation API ───────────────────────────────────────────────

  /** Renames the entity. */
  rename(name) {
    this.name = name
  }

  /**
   * Bulk-sets the primary triple from explicit values (used by deserialisation and setPose paths).
   * @param {Vector3}    position
   * @param {Quaternion} orient
   * @param {Vector3[]}  localCornersArr  8 local-space Vector3s
   */
  setPose(position, orient, localCornersArr) {
    this._position.copy(position)
    this.orientation.copy(orient)
    for (let i = 0; i < 8; i++) this.localCorners[i].copy(localCornersArr[i])
    this._rebuildWorldCorners()
  }

  /**
   * Decomposes 8 world corners back into the primary triple.
   * Uses the centroid of the given worldCorners as the new _position.
   * Called by MoveCommand.apply() to restore from legacy world-corner snapshots.
   * @param {Vector3[]} worldCorners  8 world-space positions (snapshot from before the move)
   */
  setWorldCorners(worldCorners) {
    // New _position = centroid of snapshot
    this._position.set(0, 0, 0)
    for (const c of worldCorners) this._position.add(c)
    this._position.divideScalar(worldCorners.length)
    // localCorners[i] = Q⁻¹ × (worldCorner - centroid)
    const invQ = this.orientation.clone().invert()
    for (let i = 0; i < 8; i++) {
      this.localCorners[i].copy(worldCorners[i]).sub(this._position).applyQuaternion(invQ)
    }
    this._rebuildWorldCorners()
  }

  /**
   * Translates the solid from `segStartPos` by `delta`.
   * Snapshot-based (reapplyable from the same start each pointer-move event).
   * @param {Vector3} segStartPos  _position snapshot taken at segment start
   * @param {Vector3} delta        world-space displacement
   */
  move(segStartPos, delta) {
    this._position.copy(segStartPos).add(delta)
    this._rebuildWorldCorners()
  }

  /**
   * Rotates the solid around `pivot` by `quat`, starting from the given orientation snapshot.
   * Snapshot-based (reapplyable) — ensures no accumulation error during drag.
   * @param {Quaternion} segStartOrientation  orientation snapshot at segment start
   * @param {Vector3}    segStartPos          _position snapshot at segment start
   * @param {Vector3}    pivot                world-space rotation pivot
   * @param {Quaternion} quat                 rotation to apply
   */
  rotate(segStartOrientation, segStartPos, pivot, quat) {
    this.orientation.copy(segStartOrientation).premultiply(quat)
    this._position.copy(segStartPos).sub(pivot).applyQuaternion(quat).add(pivot)
    this._rebuildWorldCorners()
  }

  /**
   * Applies a face extrusion offset in body-frame space.
   * Snapshot-based — restores local face corners from `savedLocalFaceCorners` each call.
   * @param {import('../graph/Face.js').Face} face
   * @param {Vector3[]}  savedLocalFaceCorners  4 local-space corner snapshots before drag
   * @param {Vector3}    localNormal            face normal in body frame (unit vector)
   * @param {number}     dist                   signed extrusion distance
   */
  extrudeFace(face, savedLocalFaceCorners, localNormal, dist) {
    const offset = localNormal.clone().multiplyScalar(dist)
    face.vertices.forEach((v, k) => {
      const i = this.vertices.indexOf(v)
      this.localCorners[i].copy(savedLocalFaceCorners[k]).add(offset)
    })
    this._rebuildWorldCorners()
  }
}
