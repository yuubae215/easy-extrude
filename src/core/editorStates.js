/**
 * Named constants for all FSM state strings used in the editor.
 * Replaces magic string literals throughout AppController and SceneModel.
 *
 * See docs/STATE_TRANSITIONS.md §Formal FSM Specification for the full state diagrams.
 * Runtime instances:
 *   AppController._opState     (Object Mode operations — StateMachine)
 *   AppController._editOpState (Edit Mode operations — StateMachine)
 */

// ── Object Mode primary operation FSM (AppController._opState) ───────────────
export const S_OBJECT_IDLE      = 'S_OBJECT_IDLE'
export const S_GRAB_ACTIVE      = 'S_GRAB_ACTIVE'
export const S_ROTATE_ACTIVE    = 'S_ROTATE_ACTIVE'
export const S_FACE_EXTRUDE     = 'S_FACE_EXTRUDE'
export const S_MEASURE_PLACING  = 'S_MEASURE_PLACING'
export const S_LINK_MODE        = 'S_LINK_MODE'
export const S_FRAME_PLACEMENT  = 'S_FRAME_PLACEMENT'
export const S_MOUNT_PICKING    = 'S_MOUNT_PICKING'

// ── Edit Mode substates (SceneModel._editSubstate) ───────────────────────────
export const ES_3D         = '3d'
export const ES_2D_SKETCH  = '2d-sketch'
export const ES_2D_EXTRUDE = '2d-extrude'
export const ES_1D         = '1d'

// ── Edit Mode operation FSM (AppController._editOpState) ─────────────────────
// Parallel to _opState but scoped to operations within Edit Mode.
// Currently covers 1D endpoint drag; structured for future Edit ops (vertex grab, etc.).
export const EO_IDLE    = 'EO_IDLE'    // no edit operation in progress
export const EO_1D_DRAG = 'EO_1D_DRAG' // endpoint drag (MeasureLine 1D Edit Mode)

// ── Map Mode draw states (_mapMode.drawState) ────────────────────────────────
export const DS_IDLE    = 'idle'
export const DS_DRAWING = 'drawing'
export const DS_PENDING = 'pending'
