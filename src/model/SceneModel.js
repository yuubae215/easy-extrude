/**
 * SceneModel - domain state for the 3D editor scene.
 *
 * Owns the collection of SceneObjects and the current editor mode.
 * Pure state container with no Three.js side-effects and no view calls.
 *
 * DDD note: This is the aggregate root for the scene. In future iterations,
 * SceneObject entries will evolve into rich domain entities (Cuboid, Sketch)
 * with their own behaviour methods, and SceneModel will become a proper
 * repository / application service boundary.
 *
 * @typedef {{
 *   id:          string,
 *   name:        string,
 *   description: string,
 *   dimension:   1|2|3,
 *   corners:     import('three').Vector3[],
 *   sketchRect:  {p1: import('three').Vector3, p2: import('three').Vector3}|null,
 *   meshView:    import('../view/MeshView.js').MeshView,
 * }} SceneObject
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

  /**
   * Returns the SceneObject for the given id, or null if not found.
   * @param {string} id
   * @returns {SceneObject|null}
   */
  getObject(id) {
    return this._objects.get(id) ?? null
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
   * Renames the SceneObject with the given id.
   * No-ops if the id is unknown or the name is empty.
   * @param {string} id
   * @param {string} name
   */
  renameObject(id, name) {
    const obj = this._objects.get(id)
    if (obj && name) obj.name = name
  }
}
