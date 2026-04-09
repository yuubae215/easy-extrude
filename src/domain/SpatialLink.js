/**
 * SpatialLink — domain entity for a typed semantic edge between two scene entities.
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
 *
 * Dangling links: deleting a source or target entity does NOT auto-delete the link.
 * The link becomes broken but persists; future UI may show a "broken link" indicator.
 *
 * @see ADR-030
 */
export class SpatialLink {
  /**
   * @param {string} id
   * @param {string} sourceId
   * @param {string} targetId
   * @param {'references'|'connects'|'contains'|'adjacent'} linkType
   */
  constructor(id, sourceId, targetId, linkType) {
    this.id       = id
    this.sourceId = sourceId
    this.targetId = targetId
    /**
     * Semantic relationship type.
     * @type {'references'|'connects'|'contains'|'adjacent'}
     */
    this.linkType = linkType
  }
}

/** All valid linkType values. */
export const LINK_TYPES = /** @type {const} */ (['references', 'connects', 'contains', 'adjacent'])
