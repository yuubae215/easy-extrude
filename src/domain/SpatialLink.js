/**
 * SpatialLink — domain entity for a typed constraint edge between two scene entities.
 *
 * SpatialLink is a pure relationship: it carries no geometry, no meshView,
 * no corners, and no move() method. It cannot be grabbed, extruded, edited,
 * or stacked. AppController must guard against these operations using
 * `instanceof SpatialLink`.
 *
 * A SpatialLink has two orthogonal fields:
 *
 *   jointType    — URDF-style kinematic type (determines DOF and constraint solver).
 *                  null = semantic/topological annotation only; no constraint solver.
 *
 *   semanticType — domain meaning annotation (always present).
 *
 * Example: a rigid structural bond between two frames is
 *   { jointType: 'fixed', semanticType: 'fastened' }
 *
 * @see ADR-038 (URDF-style link taxonomy, supersedes ADR-030 §2 vocabulary)
 * @see ADR-032 (geometric host binding — mounts constraint)
 */
export class SpatialLink {
  /**
   * @param {string} id
   * @param {string} sourceId
   * @param {string} targetId
   * @param {JointType|null}   jointType    URDF kinematic type, or null for annotation-only links
   * @param {SemanticType}     semanticType Domain meaning annotation
   * @param {object}           [properties] Optional domain-specific properties (e.g. clearance)
   */
  constructor(id, sourceId, targetId, jointType, semanticType, properties = {}) {
    this.id           = id
    this.sourceId     = sourceId
    this.targetId     = targetId
    /** @type {JointType|null} */
    this.jointType    = jointType ?? null
    /** @type {SemanticType} */
    this.semanticType = semanticType
    /** @type {object} */
    this.properties   = properties
    // Runtime validation state (not serialized)
    this.violated     = false
    this.errorMessage = ''
  }
}

// ── Type aliases ──────────────────────────────────────────────────────────────

/**
 * URDF-style kinematic joint types.
 * Determines the degrees of freedom (DOF) between the linked frames.
 * Mirrors the URDF <joint type="..."> attribute.
 *
 *   fixed      — 0 DOF; all 6 DOF locked (rigid constraint).
 *                Constraint solver drives source CF to maintain relative pose with target.
 *   revolute   — 1 DOF rotation around a defined axis, with angular limits.
 *   continuous — 1 DOF rotation around a defined axis, unlimited.
 *   prismatic  — 1 DOF translation along a defined axis, with limits.
 *   floating   — 6 DOF; initial pose recorded but no runtime constraint.
 *   planar     — 3 DOF; free translation in the XY plane + Z rotation.
 *
 * @typedef {'fixed'|'revolute'|'continuous'|'prismatic'|'floating'|'planar'} JointType
 */

/**
 * Semantic annotation types — domain meaning attached to a link.
 * Independent of kinematic DOF.
 *
 *   fastened   — Structurally joined / bolted / welded parts (maps to fixed joint)
 *   mounts     — Source vertices expressed in target's local coordinate space
 *   aligned    — Source axis aligned with target axis (orientation reference)
 *   contains   — Region source spatially contains entity target
 *   adjacent   — Source and target share a boundary or are neighbours
 *   above      — Source is vertically above target (Z-axis)
 *   connects   — A route logically connects source to target.
 *                When link.properties.deadline (s) and link.properties.speed (m/s) are set,
 *                evaluates as a tact-time constraint: routeLength_mm / 1000 / speed > deadline → violated.
 *   references — Source derives positional datum from target
 *   represents — Source entity depicts / represents target concept
 *   bounded_by — 2D map object (AnnotatedLine/Region) defines a clearance boundary for a 3D Solid;
 *                link.properties.clearance (mm) is the minimum required distance
 *
 * @typedef {'fastened'|'mounts'|'aligned'|'contains'|'adjacent'|'above'|'connects'|'references'|'represents'|'bounded_by'} SemanticType
 */

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * All valid kinematic joint types (URDF-style).
 * @see ADR-038
 */
export const JOINT_TYPES = /** @type {const} */ ([
  'fixed', 'revolute', 'continuous', 'prismatic', 'floating', 'planar',
])

/**
 * All valid semantic annotation types.
 * @see ADR-038
 */
export const SEMANTIC_TYPES = /** @type {const} */ ([
  'fastened', 'mounts', 'aligned',
  'contains', 'adjacent', 'above', 'connects',
  'references', 'represents',
  'bounded_by',
])

/**
 * semanticType values that imply a geometric coordinate-space binding.
 * SceneService applies a frame transform when computing world positions.
 * @see ADR-032
 */
export const GEOMETRIC_SEMANTIC_TYPES = /** @type {const} */ (['fastened', 'mounts', 'aligned'])

/**
 * semanticType values that describe topological / structural relationships.
 * No transform applied at runtime.
 */
export const TOPOLOGICAL_SEMANTIC_TYPES = /** @type {const} */ (['contains', 'adjacent', 'above', 'connects', 'bounded_by'])

/**
 * semanticType values that carry semantic meaning only.
 */
export const ANNOTATION_SEMANTIC_TYPES = /** @type {const} */ (['references', 'represents'])

// ── Migration helper ──────────────────────────────────────────────────────────

/**
 * Maps an old-format `linkType` string (scene v1.2 and earlier) to the new
 * two-layer [jointType, semanticType] representation (scene v1.3+).
 *
 * @param {string} linkType  Old single-field link type value
 * @returns {[JointType|null, SemanticType]}
 */
export function migrateLinkType(linkType) {
  /** @type {Record<string, [JointType|null, SemanticType]>} */
  const MAP = {
    fastened:   ['fixed',  'fastened'],
    mounts:     ['fixed',  'mounts'],
    aligned:    ['fixed',  'aligned'],
    contains:   [null,     'contains'],
    adjacent:   [null,     'adjacent'],
    above:      [null,     'above'],
    connects:   [null,     'connects'],
    references: [null,     'references'],
    represents: [null,     'represents'],
  }
  return MAP[linkType] ?? [null, /** @type {SemanticType} */ (linkType)]
}
