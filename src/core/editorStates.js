/**
 * Named constants for all FSM state strings used in the editor.
 * Replaces magic string literals throughout AppController and SceneModel.
 *
 * See docs/STATE_TRANSITIONS.md §Formal FSM Specification for the full state diagrams.
 * Runtime instance: AppController._opState (StateMachine from src/core/StateMachine.js)
 */

// ── Object Mode primary operation FSM (AppController._opState) ───────────────
export const S_OBJECT_IDLE     = 'S_OBJECT_IDLE'
export const S_GRAB_ACTIVE     = 'S_GRAB_ACTIVE'
export const S_ROTATE_ACTIVE   = 'S_ROTATE_ACTIVE'
export const S_FACE_EXTRUDE    = 'S_FACE_EXTRUDE'
export const S_MEASURE_PLACING = 'S_MEASURE_PLACING'
export const S_LINK_MODE       = 'S_LINK_MODE'

// ── Edit Mode substates (SceneModel._editSubstate) ───────────────────────────
export const ES_3D         = '3d'
export const ES_2D_SKETCH  = '2d-sketch'
export const ES_2D_EXTRUDE = '2d-extrude'
export const ES_1D         = '1d'

// ── Map Mode draw states (_mapMode.drawState) ────────────────────────────────
export const DS_IDLE    = 'idle'
export const DS_DRAWING = 'drawing'
export const DS_PENDING = 'pending'
