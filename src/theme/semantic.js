/**
 * semantic.js — colours that carry DATA meaning, declared explicitly out of
 * scope for the state palette (ADR-100 Decision 5).
 *
 * ## Why this file exists at all
 *
 * `tokens.js` governs "what state is this?" — selection, caution, danger. These
 * vocabularies answer a different question: "which KIND of thing is this?" A
 * link's `mounts` green and a persona's blue are properties of the data, not
 * reports about the UI's state, so ADR-100's rules (neutral defaults, one
 * accent, hue separation from state tones) do not apply to them and must not be
 * applied by accident.
 *
 * Being out of scope is a DECLARATION, not an omission (原則 #29 — every wire
 * is either governed or explicitly excluded; 原則 #31 — a legitimate exception
 * must be declared rather than inferred). Without this module the ratchet in
 * `tokens.test.js` would count these ~25 hexes as undeclared literals, the
 * baseline would absorb them, and the count would stop meaning anything.
 *
 * ## What belongs here
 *
 * A colour belongs here when removing it would lose information the user needs
 * to tell two DATA items apart. A colour belongs in `tokens.js` when removing
 * it would lose information about what the APP is doing.
 *
 * `src/domain/IFCClassRegistry.js` holds a fourth such vocabulary (IFC class
 * tints) and is declared out of scope where it lives: the domain owns its own
 * classification colours, and importing them up into `theme/` would point a
 * domain module at a view concern (核 §1.1 dependency direction). The exclusion
 * is listed in `tokens.test.js` next to this module's.
 */

/**
 * Link colour by `semanticType` (ADR-038). Numeric — THREE material consumers.
 *
 * Moved here from `SpatialLinkView.js` by ADR-100: a view was the source for a
 * vocabulary two other views imported, which made "where do link colours live?"
 * answerable only by grep.
 */
export const LINK_TYPE_COLORS = Object.freeze({
  // Category A — Geometric
  mounts:     0x22C55E,  // green
  fastened:   0x10B981,  // emerald
  aligned:    0x14B8A6,  // teal
  // Category B — Topological
  contains:   0x8B5CF6,  // violet
  above:      0x6366F1,  // indigo
  adjacent:   0x64748B,  // slate
  connects:   0x06B6D4,  // cyan
  // Category C — Semantic
  references: 0xF59E0B,  // amber
  represents: 0xF43F5E,  // rose
  // Category D — Safety constraint
  bounded_by: 0xFB923C,  // orange
})

/**
 * Persona palette — distinct hues mapped by actor index (`ctx.actors` order).
 * Moved here from `RegionGhostView.js` (ADR-100).
 */
export const PERSONA_PALETTE = Object.freeze([0x3a7bd5, 0xe0b030, 0x10b981, 0xc05cd0, 0xe06650])

/**
 * Node fill colour by entity type in the LINK NETWORK panel (ADR-094).
 * Moved here from `LinkNetworkView.js` (ADR-100).
 */
export const NODE_TYPE_COLORS = Object.freeze({
  cuboid:         '#60A5FA',
  frame:          '#FB923C',
  measure:        '#A78BFA',
  imported:       '#94A3B8',
  sketch:         '#FCD34D',
  'annot-line':   '#34D399',
  'annot-region': '#34D399',
  'annot-point':  '#34D399',
  default:        '#9CA3AF',
})

/**
 * Sub-element kind colour: which PART of a solid a marker refers to
 * (ADR-024 edit mode, snapping, pivot picking).
 *
 * A data-meaning vocabulary, not a state one: green does not mean "good" here,
 * it means "vertex". Declared out of scope for ADR-100's hue rules for exactly
 * that reason — `face` shares cyan with the retired indicator and that is fine,
 * because it never claimed to say "active".
 *
 * It lives here because the same three-entry table was written out verbatim in
 * `EditModeSelectionHandler`, `GrabOperationHandler` and `MeshView._SNAP_COLOR`
 * — one fact with three authorities (§1.1). `world` has no sub-element to name
 * and is the absence marker, white.
 */
export const SUBELEMENT_COLORS = Object.freeze({
  vertex: '#69f0ae',
  edge:   '#ffd740',
  face:   '#4fc3f7',
  world:  '#ffffff',
})
