/**
 * LayoutDslSchema — constants and type definitions for Layout DSL v1.0.
 *
 * Pure data: no I/O, no Three.js, no DOM.
 *
 * Layout DSL v1.0 encodes a 5W1H scene composition request (ADR-044):
 *   Why   → constraints (success conditions: clearance, fastening, adjacency)
 *   How   → strategy + strategyOptions (linear / grid / stack / radial / manual)
 *   What  → entities (Solid dimensions, frame offsets, annotation vertices)
 *
 * Output: SceneSerializer v1.3 compatible JSON, loadable via importFromJson().
 */

export const LAYOUT_DSL_VERSION = 'layout/1.0'
export const SCENE_JSON_VERSION  = '1.3'

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

/** Domain semantic types (ADR-038). */
export const VALID_SEMANTIC_TYPES = [
  'fastened', 'mounts', 'aligned',
  'contains', 'adjacent', 'above', 'connects',
  'references', 'represents', 'bounded_by',
]

/** Default strategy options. */
export const DEFAULT_STRATEGY_OPTIONS = {
  axis:    '+X',
  spacing: 3000,   // mm
  cols:    3,
  baseZ:   0,
}
