/**
 * SpatialLink — domain entity for a typed constraint edge between two scene entities.
 *
 * SpatialLink is a pure relationship: it carries no geometry, no meshView,
 * no corners, and no move() method. It cannot be grabbed, extruded, edited,
 * or stacked. AppController must guard against these operations using
 * `instanceof SpatialLink`.
 *
 * Valid linkType values:
 *   - 'references' : directed — source derives positional datum from target
 *   - 'connects'   : undirected — a route logically connects source to target
 *   - 'contains'   : directed — region source spatially contains entity target
 *   - 'adjacent'   : undirected — source and target share a boundary or are neighbouring
 *   - 'mounts'     : directed — source's vertices are expressed in target's local
 *                    coordinate space; SceneService computes world positions by
 *                    composing the host's worldPose each frame. Whether an entity's
 *                    vertices are in world space or host-local space is determined
 *                    solely by the presence of a 'mounts' link in the graph —
 *                    no additional flag is stored on the entity. @see ADR-032
 *
 * Dangling links: deleting a source or target entity does NOT auto-delete the link.
 * The link becomes broken but persists; future UI may show a "broken link" indicator.
 *
 * @see ADR-030
 * @see ADR-032
 */
export class SpatialLink {
  /**
   * @param {string} id
   * @param {string} sourceId
   * @param {string} targetId
   * @param {'references'|'connects'|'contains'|'adjacent'|'mounts'} linkType
   */
  constructor(id, sourceId, targetId, linkType) {
    this.id       = id
    this.sourceId = sourceId
    this.targetId = targetId
    /**
     * Constraint relationship type.
     * @type {'references'|'connects'|'contains'|'adjacent'|'mounts'}
     */
    this.linkType = linkType
  }
}

/** All valid linkType values. */
export const LINK_TYPES = /** @type {const} */ (['references', 'connects', 'contains', 'adjacent', 'mounts'])

/**
 * linkType values that imply a geometric coordinate-space binding.
 * SceneService applies a transform for these types when computing world positions.
 * @see ADR-032
 */
export const GEOMETRIC_LINK_TYPES = /** @type {const} */ (['mounts'])
