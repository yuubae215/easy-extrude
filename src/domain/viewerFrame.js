/**
 * viewerFrame (domain) — the declared VIEWER of a relative direction (ADR-168 D2).
 *
 * ## What a viewer is
 *
 * A CoordinateFrame whose `frameRole` is `'viewer'`: a person's standpoint in
 * the cell (an operator's place, a reviewer's spot). Its pose is the frame's own
 * pose, read in the ROS body convention (REP-103): **+X is the way the viewer
 * faces, +Y is the viewer's left**, +Z is up. "Left of the bin" is only a fact
 * once it says *whose* left — 「前後左右はかなり主観的」(当事者 2026-10-21) — so a
 * relative direction always names one of these frames.
 *
 * ## Why not the camera, and why not `robotRole`
 *
 *   - The VIEWPORT camera is not a viewer: orbiting it would change every "left"
 *     written in the document, a second source next to the scene (§1.1). What the
 *     camera sees may be shown, never written (原則 #29).
 *   - A vision camera (ADR-164 `camera`) is a frame of the ROS OPTICAL convention
 *     (+Z is the line of sight). A viewer is a body frame (+X forward). One frame
 *     cannot be both without one of the two words meaning a different axis.
 *   - `robotRole` names a role in a robot's TF tree. Riding it would make one
 *     field carry two facts (原則 #33-1). `frameRole` is its own field.
 *
 * ## Cardinality (原則 #31)
 *
 * `0..N` viewers. 0 is legal — then no relative direction can be declared (the
 * validator says so; nothing falls back to the camera). 1 is NOT used implicitly:
 * a relative direction names its viewer even in a one-person scene, because the
 * claimant and the viewer are two facts (ADR-168 D5) and pairing them is a choice
 * nobody made. N viewers are told apart by ref.
 *
 * Only this module interprets `frameRole` (IDENTITY_RULES — src/IdentityContainment.test.js).
 *
 * @module domain/viewerFrame
 */
import { isCameraFrame } from './visionCamera.js'

/** Declared roles a CoordinateFrame may carry through `frameRole` (closed). */
export const FRAME_ROLE = Object.freeze({ VIEWER: 'viewer' })

/** Every declarable `frameRole` value (the schema's enum). @type {readonly string[]} */
export const FRAME_ROLES = Object.freeze(Object.values(FRAME_ROLE))

/**
 * Is `value` a declared frame role? Unknown values are not roles — a reader
 * leaves them unset rather than guessing (原則 #31).
 * @param {unknown} value
 * @returns {boolean}
 */
export function isFrameRole(value) {
  return FRAME_ROLES.includes(/** @type {string} */ (value))
}

/**
 * Is this entity a declared viewer? Works on a Layout DSL entity and on a scene
 * CoordinateFrame alike (both carry `type` + `frameRole`).
 * @param {{type?: string, frameRole?: unknown}|null|undefined} obj
 * @returns {boolean}
 */
export function isViewerFrame(obj) {
  return obj?.type === 'CoordinateFrame' && obj.frameRole === FRAME_ROLE.VIEWER
}

/**
 * Why a frame cannot be a viewer as declared, or null when it can — the named
 * precondition (原則 #25). Three shapes are refused, each for a stated reason:
 * a viewer is not a robot frame, not a vision camera (different axis
 * convention), and — for now — not a TF child: a viewer under a moving parent
 * would make "left" change when the parent moves, and whether that is wanted is
 * まだ決めていない (ADR-168 S1).
 *
 * @param {{ref?: string, type?: string, frameRole?: unknown, robotRole?: unknown,
 *          camera?: unknown, parentRef?: unknown}} entity
 * @returns {string|null}
 */
export function viewerFrameGap(entity) {
  if (entity?.frameRole == null) return null
  const ref = entity.ref ?? '?'
  if (!isFrameRole(entity.frameRole)) {
    return `entity "${ref}": frameRole "${entity.frameRole}" is not one of ${FRAME_ROLES.join(', ')}`
  }
  if (entity.type !== 'CoordinateFrame') {
    return `entity "${ref}": frameRole is declared on a ${entity.type} — only a CoordinateFrame can be a viewer (ADR-168 D2)`
  }
  if (entity.robotRole != null) {
    return `entity "${ref}": a viewer cannot also be a robot frame (robotRole "${entity.robotRole}") — one field per fact (ADR-168 D2)`
  }
  if (isCameraFrame(entity)) {
    return `entity "${ref}": a viewer cannot also be a vision camera — a camera reads +Z as its line of sight, a viewer +X as its front (ADR-168 D2)`
  }
  if (entity.parentRef != null) {
    return `entity "${ref}": a viewer under a parent frame is not decided yet — declare it world-parented (ADR-168 S1)`
  }
  return null
}
