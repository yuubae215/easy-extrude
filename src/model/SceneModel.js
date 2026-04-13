/**
 * SceneModel - domain state for the 3D editor scene.
 *
 * Owns the collection of domain entities and the current editor mode.
 * Pure state container with no Three.js side-effects and no view calls.
 *
 * DDD note (Phase 1+): SceneObject is a union of typed domain entities
 * (Solid | Profile | ImportedMesh | MeasureLine | CoordinateFrame) defined
 * in src/domain/. SceneModel acts as the aggregate root / in-memory repository.
 *
 * @typedef {import('../domain/Solid.js').Solid | import('../domain/Profile.js').Profile | import('../domain/ImportedMesh.js').ImportedMesh | import('../domain/MeasureLine.js').MeasureLine | import('../domain/CoordinateFrame.js').CoordinateFrame} SceneObject
 */
export class SceneModel {
  constructor() {
    /** @type {Map<string, SceneObject>} */
    this._objects = new Map()

    /** @type {Map<string, import('../domain/SpatialLink.js').SpatialLink>} */
    this._links = new Map()

    /**
     * Reverse index for 'mounts' links: sourceId → linkId.
     * Enables O(1) lookup of "is entity X mounted, and to what host?".
     * Maintained in sync with _links by addLink / removeLink.
     * @type {Map<string, string>}
     */
    this._mountsIndex = new Map()

    /**
     * Reverse index for 'mounts' links: hostId → Set of sourceIds.
     * Enables O(1) lookup of "what Map elements are mounted on host X?".
     * Maintained in sync with _links by addLink / removeLink.
     * @type {Map<string, Set<string>>}
     */
    this._mountedByIndex = new Map()

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

  /** Full link map (do not mutate directly; use addLink / removeLink). */
  get links() { return this._links }

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

  /**
   * Returns the SpatialLink for the given id, or null if not found.
   * @param {string} id
   * @returns {import('../domain/SpatialLink.js').SpatialLink|null}
   */
  getLink(id) {
    return this._links.get(id) ?? null
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
   * Adds a SpatialLink to the scene. The link must have a unique `id`.
   * For 'mounts' links, also updates _mountsIndex and _mountedByIndex.
   * @param {import('../domain/SpatialLink.js').SpatialLink} link
   */
  addLink(link) {
    this._links.set(link.id, link)
    if (link.linkType === 'mounts') {
      this._mountsIndex.set(link.sourceId, link.id)
      if (!this._mountedByIndex.has(link.targetId)) {
        this._mountedByIndex.set(link.targetId, new Set())
      }
      this._mountedByIndex.get(link.targetId).add(link.sourceId)
    }
  }

  /**
   * Removes the SpatialLink with the given id from the scene.
   * For 'mounts' links, also cleans up _mountsIndex and _mountedByIndex.
   * @param {string} id
   */
  removeLink(id) {
    const link = this._links.get(id)
    if (link?.linkType === 'mounts') {
      this._mountsIndex.delete(link.sourceId)
      this._mountedByIndex.get(link.targetId)?.delete(link.sourceId)
    }
    this._links.delete(id)
  }

  /**
   * Returns the 'mounts' SpatialLink for which the given entity is the source,
   * or null if the entity is not mounted on any host.
   * O(1) via _mountsIndex.
   * @param {string} sourceId
   * @returns {import('../domain/SpatialLink.js').SpatialLink|null}
   */
  getMountsLink(sourceId) {
    const linkId = this._mountsIndex.get(sourceId)
    return linkId ? (this._links.get(linkId) ?? null) : null
  }

  /**
   * Returns all 'mounts' SpatialLinks for which the given entity is the host (target).
   * O(k) where k = number of mounted children.
   * @param {string} hostId
   * @returns {import('../domain/SpatialLink.js').SpatialLink[]}
   */
  getMountedLinks(hostId) {
    const sourceIds = this._mountedByIndex.get(hostId)
    if (!sourceIds || sourceIds.size === 0) return []
    return [...sourceIds]
      .map(sid => {
        const linkId = this._mountsIndex.get(sid)
        return linkId ? (this._links.get(linkId) ?? null) : null
      })
      .filter(Boolean)
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
