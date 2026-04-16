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

/**
 * All valid linkType values, organised as a spatial preposition vocabulary.
 *
 * Category A — Geometric (SceneService applies coordinate transforms):
 *   mounts   : on / at          — source vertices in target frame's local space
 *   fastened : attached to      — rigid 6-DOF binding between frames
 *   aligned  : aligned with     — rotation-only constraint
 *
 * Category B — Topological (structural relationship, no transform):
 *   contains : in / inside      — source region contains target entity
 *   adjacent : beside / next to — shared boundary or neighbouring
 *   above    : above / over     — source is vertically above target (Z-axis)
 *   connects : between / along  — source path connects source to target
 *
 * Category C — Semantic (meaning only, no geometric processing):
 *   references : derived from   — source derives positional datum from target
 *   represents : depicts        — source entity represents target concept
 *
 * @see ADR-030 (original 4-type vocabulary)
 * @see ADR-032 (extended preposition vocabulary + geometric constraint solver)
 */
export const LINK_TYPES = /** @type {const} */ ([
  'mounts', 'fastened', 'aligned',
  'contains', 'adjacent', 'above', 'connects',
  'references', 'represents',
])

/**
 * linkType values that imply a geometric coordinate-space binding.
 * SceneService applies a frame transform when computing world positions
 * for entities whose sourceId participates in one of these link types.
 * @see ADR-032 Sec.2 Category A
 */
export const GEOMETRIC_LINK_TYPES = /** @type {const} */ (['mounts', 'fastened', 'aligned'])

/**
 * linkType values that describe topological / structural relationships.
 * Recorded in the scene graph for queries and analytics; no transform applied.
 * @see ADR-032 Sec.2 Category B
 */
export const TOPOLOGICAL_LINK_TYPES = /** @type {const} */ (['contains', 'adjacent', 'above', 'connects'])

/**
 * linkType values that carry semantic meaning only.
 * Used for visualisation and documentation; no geometric processing.
 * @see ADR-032 Sec.2 Category C
 */
export const SEMANTIC_LINK_TYPES = /** @type {const} */ (['references', 'represents'])
