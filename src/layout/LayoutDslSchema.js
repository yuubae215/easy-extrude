/**
 * LayoutDslSchema — constants and type definitions for Layout DSL v1.1.
 *
 * Pure data: no I/O, no Three.js, no DOM.
 *
 * Layout DSL v1.0 encodes a 5W1H scene composition request (ADR-044):
 *   Why   → constraints (success conditions: clearance, fastening, adjacency)
 *   How   → strategy + strategyOptions (linear / grid / stack / radial / manual)
 *   What  → entities (Solid dimensions, frame offsets, annotation vertices)
 *
 * Output: SceneSerializer v1.4 compatible JSON, loadable via importFromJson().
 */
import { SEMANTIC_TYPES } from '../domain/SpatialLink.js'

export const LAYOUT_DSL_VERSION = 'layout/1.1'
export const SCENE_JSON_VERSION  = '1.4'

// layout/1.1 (ADR-168 S2-2): the semanticTypes `above` / `adjacent` are retired;
// what they said lives in `unclaimedRelations` (LegacyRelations.js). A
// layout/1.0 document is still read — it says nothing 1.1 cannot, once its
// retired words are moved (`migrateLayoutRelations`, run on load).
/** Layout versions a document may carry. Writers always write LAYOUT_DSL_VERSION. */
export const SUPPORTED_LAYOUT_VERSIONS = Object.freeze(['layout/1.0', LAYOUT_DSL_VERSION])

// Additive growth within layout/1.0 (no version bump — consistent with how
// `frames`, `placeType`, and `parentRef` were added):
//   • Solid entities may carry an optional `rotation: {x,y,z,w}` body-orientation
//     quaternion (default = identity). This closes the one geometry gap that
//     blocked a lossless scene⇄DSL round-trip (a rotated Solid). See ADR-055 and
//     LayoutDecompiler.js (the scene→DSL inverse).

/** Placement strategies for unpositioned entities. */
export const VALID_STRATEGIES = ['linear', 'grid', 'stack', 'radial', 'manual']

/** Axis tokens for linear/radial strategies. */
export const VALID_AXES = ['+X', '-X', '+Y', '-Y', '+Z', '-Z']

/** Entity types expressible in Layout DSL. */
export const VALID_ENTITY_TYPES = [
  'Solid', 'CoordinateFrame',
  'AnnotatedLine', 'AnnotatedRegion', 'AnnotatedPoint',
]

/** URDF kinematic joint types (ADR-038). */
export const VALID_JOINT_TYPES = ['fixed', 'revolute', 'continuous', 'prismatic', 'floating', 'planar']

/** Domain semantic types (ADR-038) — the domain's list, not a copy. */
export const VALID_SEMANTIC_TYPES = [...SEMANTIC_TYPES]

/** Default strategy options. */
export const DEFAULT_STRATEGY_OPTIONS = {
  axis:    '+X',
  spacing: 3000,   // mm
  cols:    3,
  baseZ:   0,
}
