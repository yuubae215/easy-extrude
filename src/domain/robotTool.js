/**
 * robotTool (domain) — the tool rigidly mounted on the arm's flange (ADR-150 D4).
 *
 * ## Why this exists
 *
 * Until ADR-150 nothing in the app knew the arm carried a tool. `core/`'s IK put
 * the FLANGE on the grasp point, and the gripper the viewer saw was a screen-size
 * glyph floating at that point — attached to nothing. The dogfooder's report
 * ("ツールがフランジに取り付いてない") was right on both counts: the drawn tool was
 * not on the flange, and the solved arm had no tool to put there.
 *
 * ## One fact, three readers (§1.1)
 *
 * The fact is the tool MOUNT — the edge `tool0 → tcp`. Since ADR-151 it is
 * stored once per robot, as the transform of that robot's `tcp` frame (the
 * interface the robot and the gripper share), and read by:
 *
 *   - the grasp request, as `robot.toolLength` (GraspController —
 *     `core/` then puts the flange this far back from the TCP and sweeps the
 *     flange→TCP segment for interference);
 *   - the client-side closed form (ADR-147), through the same declaration, so
 *     the unverified preview lands the tool tip where `core/` would;
 *   - `RobotStage`, which draws the tool AND the TCP marker on `wrist_3_link`
 *     from this mount, so what the viewer sees is the tool that was solved.
 *
 * It is a property of the MOUNT, not of the hand kind: the parallel jaw and the
 * suction cup share one TCP for now (dogfooder decision, 2026-09-23), and the
 * tool is declared whether or not the `gripper` graspability gate is switched on
 * — turning the gate off does not unbolt the tool.
 *
 * Pure module (no THREE) so `node --test` and the view read the same number.
 *
 * @module domain/robotTool
 */

import { mToMM, mmToM } from './worldUnits.js'
import { isFlangeMountedTcp } from './robotFrames.js'

/**
 * The DEFAULT flange (tool0) → TCP distance along the flange +Z, in METERS (the
 * wire unit — `robot.toolLength`). 150 mm: a typical parallel-jaw gripper's
 * length, agreed with the dogfooder for both hand kinds.
 *
 * Since ADR-151 this is a default, not the source: the source is each robot's
 * `tcp` frame, whose stored transform IS the tool mount (`tool0 → tcp`). This
 * number only seeds that transform when a robot is added (`DEFAULT_TOOL_MOUNT`).
 */
export const TOOL_LENGTH_M = 0.15

/**
 * The tool mount a newly added robot's `tcp` frame is born with (ADR-151): the
 * `tool0 → tcp` edge, in the SCENE's units (mm, ADR-136) and the flange frame.
 * Straight out of the flange face, no rotation.
 */
export const DEFAULT_TOOL_MOUNT = Object.freeze({
  translation: Object.freeze({ x: 0, y: 0, z: mToMM(TOOL_LENGTH_M) }),
  rotation:    Object.freeze({ x: 0, y: 0, z: 0, w: 1 }),
})

/** Tolerance for "this mount is straight along +Z" (mm for offsets, unitless for the quaternion). */
const AXIAL_EPS = 1e-6

/**
 * The tool length a mount declares, in METERS — or `null` when the mount is not
 * straight along the flange +Z (an offset TCP, or a rotated one).
 *
 * WHY null rather than a projection (ADR-151 stage 1): the request can only say
 * `robot.toolLength` today, and `core/` places the flange at `TCP − z·L`. A
 * sideways or rotated mount would be SOLVED as if it were straight, and the arm
 * would put the wrong point on the grasp — silently. So a non-axial mount is a
 * state the caller must REFUSE with a reason until the wire and `core/` learn
 * the full 6-DOF mount — 未実装 (stage 2, DEF-045).
 *
 * @param {{translation:{x:number,y:number,z:number}, rotation:{x:number,y:number,z:number,w:number}}|null|undefined} mount  mm
 * @returns {number|null}
 */
export function axialToolLengthM(mount) {
  if (!mount) return null
  const { translation: t, rotation: q } = mount
  if (Math.abs(t.x) > AXIAL_EPS || Math.abs(t.y) > AXIAL_EPS || !(t.z > 0)) return null
  // q and −q are the same rotation.
  if (Math.abs(q.x) > AXIAL_EPS || Math.abs(q.y) > AXIAL_EPS || Math.abs(q.z) > AXIAL_EPS ||
      Math.abs(Math.abs(q.w) - 1) > AXIAL_EPS) return null
  return mmToM(t.z)
}

/**
 * Why a flange-mounted TCP cannot be moved, rotated or re-parented by hand
 * (ADR-151 stage 1). The mount is the gripper's geometry, and editing it is only
 * worth offering once every reader can take a full 6-DOF mount (stage 2).
 * Quest-phrased — the reason names what WILL move it, not only the refusal.
 */
export const TOOL_MOUNT_EDIT_DEFERRED_REASON =
  'The TCP is set by the tool mount (tool0 → tcp). Editing the mount is not supported yet — the TCP moves with the arm.'

/** Why a grasp cannot be solved for a mount that is not straight along the flange +Z (stage 1). */
export const TOOL_MOUNT_NOT_AXIAL_REASON =
  'The TCP is offset or rotated from the flange axis. Grasp search supports only a tool mounted straight along the flange +Z for now.'

/**
 * The drawn tool, as pure primitive specs in the FLANGE frame (`wrist_3_link`,
 * meters: +Z out of the flange face, jaws closing along ±X — the candidate
 * frame's x, which ADR-150 D5 fixed to the flange). `RobotStage` turns these
 * into meshes; nothing here knows THREE.
 *
 * Every dimension is a fraction of `toolLength`, so the one claim that matters
 * holds by construction and is asserted by `robotTool.test.js`: **the fingertips
 * end exactly at z = toolLength, the TCP the solver was given.** A tool drawn a
 * few centimetres shorter than the one solved would put the jaws visibly above
 * the part while the search says they close on it.
 *
 * @param {number} toolLength  meters, > 0
 * @returns {Array<{part: 'body'|'palm'|'finger', shape: 'cylinder'|'box',
 *   size: number[], center: [number, number, number]}>}
 *   cylinder size = [radius, length] along +Z; box size = [x, y, z].
 */
export function toolParts(toolLength) {
  if (!(toolLength > 0) || !Number.isFinite(toolLength)) {
    throw new Error(`robotTool: toolLength must be a finite number > 0 (got ${toolLength})`)
  }
  const L = toolLength
  const bodyLen = 0.4 * L
  const palmLen = 0.12 * L
  const fingerLen = L - bodyLen - palmLen
  const palmZ = bodyLen + palmLen / 2
  const fingerZ = bodyLen + palmLen + fingerLen / 2
  return [
    { part: 'body',   shape: 'cylinder', size: [0.21 * L, bodyLen],                center: [0, 0, bodyLen / 2] },
    { part: 'palm',   shape: 'box',      size: [0.6 * L, 0.2 * L, palmLen],       center: [0, 0, palmZ] },
    { part: 'finger', shape: 'box',      size: [0.08 * L, 0.14 * L, fingerLen],   center: [-0.2 * L, 0, fingerZ] },
    { part: 'finger', shape: 'box',      size: [0.08 * L, 0.14 * L, fingerLen],   center: [0.2 * L, 0, fingerZ] },
  ]
}

/**
 * Why this entity's transform cannot be edited by hand, or null when it can —
 * the ONE predicate (原則 #25) behind every CF edit entrance: grab, drag, rotate,
 * the N-panel fields, re-parent and the mobile toolbar gate. A flange-mounted
 * tcp's transform IS the tool mount (`tool0 → tcp`, ADR-151); editing it is
 * stage 2 (DEF-045). The disable and its reason come from this one return value,
 * so an entrance cannot refuse without saying why (原則 #11).
 * @param {object|null|undefined} obj
 * @returns {string|null}
 */
export function toolMountEditBlockedReason(obj) {
  return isFlangeMountedTcp(obj) ? TOOL_MOUNT_EDIT_DEFERRED_REASON : null
}

/**
 * The tool mount a robot declares — its tcp frame's stored transform, read as
 * `tool0 → tcp` (ADR-151) — or null when the robot has no flange-mounted tcp
 * (the robot/gripper interface is undeclared). The ONE reader of "which mount
 * does this robot carry", shared by the grasp declaration and the stage sync so
 * the solved tool and the drawn tool cannot come from different places (§1.1).
 * Returns plain numbers (mm / unit quaternion), a snapshot the caller owns.
 *
 * @param {{tcpFrame?: {name?: string, robotRole?: string|null, mountedOn?: string|null,
 *   translation:{x:number,y:number,z:number}, rotation:{x:number,y:number,z:number,w:number}}|null}|null|undefined} robot
 * @returns {{translation:{x:number,y:number,z:number}, rotation:{x:number,y:number,z:number,w:number}}|null}
 */
export function toolMountOf(robot) {
  const tcp = robot?.tcpFrame ?? null
  if (!isFlangeMountedTcp(tcp)) return null
  const t = tcp.translation, q = tcp.rotation
  return {
    translation: { x: t.x, y: t.y, z: t.z },
    rotation:    { x: q.x, y: q.y, z: q.z, w: q.w },
  }
}

/** Why a grasp cannot be solved for a robot with no tcp (ADR-151 D7). */
export const TOOL_MOUNT_UNDECLARED_REASON =
  'This robot has no TCP, so its tool mount (tool0 → tcp) is undeclared. Undo the deletion, or add a robot (Shift+A → Robot) — a new robot comes with its TCP.'

/**
 * Why this robot's tool mount cannot be sent with a grasp request, or null when
 * it can — the named precondition (原則 #25) the grasp gate asks before any
 * request leaves (ADR-151 D7). Two gaps, two reasons:
 *   - no flange-mounted tcp → the interface is undeclared;
 *   - a mount that is not straight along the flange +Z → stage 1 cannot say it
 *     on the wire (DEF-045).
 * @param {{label?: string, tcpFrame?: object|null}|null|undefined} robot
 * @returns {string|null}
 */
export function toolMountGap(robot) {
  const mount = toolMountOf(robot)
  if (!mount) return TOOL_MOUNT_UNDECLARED_REASON
  if (axialToolLengthM(mount) === null) return TOOL_MOUNT_NOT_AXIAL_REASON
  return null
}

/** The TCP marker's axis length as a fraction of the mount's reach (ADR-151). */
const TCP_MARKER_FRACTION = 0.4

/**
 * Where and how big the TCP marker is drawn, in the FLANGE frame (`wrist_3_link`,
 * METERS — the URDF units `RobotStage` draws in), or null when there is no mount.
 *
 * The marker IS the mount made visible: its origin is the mount's translation
 * and its axes are the mount's rotation, so on the arm it stands at the TCP by
 * construction — at rest, in a preview, in either drawing style — with no code
 * comparing it to anything (ADR-151 D2).
 *
 * Its size is WORLD-fixed (dogfooder decision b, 2026-09-23): a fraction of the
 * mount's reach, so it scales with the tool on screen like the tool does. It is
 * part of the arm, not a screen overlay, which is why 原則 #27's screen-px target
 * is deliberately not applied here.
 *
 * @param {{translation:{x:number,y:number,z:number}, rotation:{x:number,y:number,z:number,w:number}}|null} mount  mm
 * @returns {{position:[number,number,number], quaternion:{x:number,y:number,z:number,w:number}, axisLength:number}|null}
 */
export function tcpMarkerPose(mount) {
  if (!mount) return null
  const t = mount.translation
  const position = /** @type {[number,number,number]} */ ([mmToM(t.x), mmToM(t.y), mmToM(t.z)])
  const reach = Math.hypot(...position)
  return {
    position,
    quaternion: { ...mount.rotation },
    // A mount with no reach (tcp ON the flange face) still gets a legible marker.
    axisLength: TCP_MARKER_FRACTION * (reach > 0 ? reach : TOOL_LENGTH_M),
  }
}
