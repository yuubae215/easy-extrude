/**
 * SceneModel - domain state for the 3D editor scene.
 *
 * Owns the collection of domain entities and the current editor mode.
 * Pure state container with no Three.js side-effects and no view calls.
 *
 * DDD note (Phase 1): SceneObject is now a union of typed domain entities
 * (Cuboid | Sketch) defined in src/domain/. SceneModel acts as the aggregate
 * root / in-memory repository. Phase 3 will formalize this boundary.
 *
 * @typedef {import('../domain/Cuboid.js').Cuboid | import('../domain/Sketch.js').Sketch} SceneObject
 */
export class SceneModel {
  constructor() {
    /** @type {Map<string, SceneObject>} */
    this._objects = new Map()

    /** @type {string|null} */
    this._activeId = null

    /** @type {'object'|'edit'} */
    this._selectionMode = 'object'

    /** @type {null|'3d'|'2d-sketch'|'2d-extrude'} */
    this._editSubstate = null

    /**
     * Unified selection set for Edit Mode.
     * Contains the currently selected Vertex, Edge, and/or Face objects.
     * @type {Set<import('../graph/Vertex.js').Vertex | import('../graph/Edge.js').Edge | import('../graph/Face.js').Face>}
     */
    this._editSelection = new Set()
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  /** Full object map (do not mutate directly; use addObject / removeObject). */
  get objects() { return this._objects }

  /** ID of the currently active object, or null if none. */
  get activeId() { return this._activeId }

  /** The active SceneObject, or null if none is selected. */
  get activeObject() {
    return this._activeId ? (this._objects.get(this._activeId) ?? null) : null
  }

  /** Current selection mode: 'object' or 'edit'. */
  get selectionMode() { return this._selectionMode }

  /** Current edit substate: null | '3d' | '2d-sketch' | '2d-extrude'. */
  get editSubstate() { return this._editSubstate }

  /** Current unified edit selection (Vertex | Edge | Face objects). */
  get editSelection() { return this._editSelection }

  /**
   * Returns the SceneObject for the given id, or null if not found.
   * @param {string} id
   * @returns {SceneObject|null}
   */
  getObject(id) {
    return this._objects.get(id) ?? null
  }

  /**
   * Returns all objects whose `parentId` matches the given id.
   * Used to find child CoordinateFrames of a geometry object.
   * @param {string} parentId
   * @returns {SceneObject[]}
   */
  getChildren(parentId) {
    return [...this._objects.values()].filter(o => o.parentId === parentId)
  }

  /**
   * Returns all objects that have no parent (parentId is falsy).
   * Root objects sit at the top level of the scene hierarchy.
   * @returns {SceneObject[]}
   */
  getRoots() {
    return [...this._objects.values()].filter(o => !o.parentId)
  }

  // ── Commands ───────────────────────────────────────────────────────────────

  /**
   * Adds a SceneObject to the scene. The object must have a unique `id`.
   * @param {SceneObject} obj
   */
  addObject(obj) {
    this._objects.set(obj.id, obj)
  }

  /**
   * Removes the SceneObject with the given id from the scene.
   * Does not dispose the meshView — caller is responsible.
   * @param {string} id
   */
  removeObject(id) {
    this._objects.delete(id)
  }

  /**
   * Sets the active object id. Pass null to deselect.
   * @param {string|null} id
   */
  setActiveId(id) {
    this._activeId = id
  }

  /**
   * Updates the editor mode.
   * @param {'object'|'edit'} mode
   */
  setSelectionMode(mode) {
    this._selectionMode = mode
  }

  /**
   * Updates the edit substate.
   * @param {null|'3d'|'2d-sketch'|'2d-extrude'} substate
   */
  setEditSubstate(substate) {
    this._editSubstate = substate
  }

  /**
   * Replaces the edit selection with a new Set.
   * @param {Set} set
   */
  setEditSelection(set) {
    this._editSelection = set
  }

  /** Clears all items from the edit selection. */
  clearEditSelection() {
    this._editSelection.clear()
  }

}
