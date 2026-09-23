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
 *   - the grasp request declares it as `robot.toolLength` (GraspController —
 *     `core/` then puts the flange this far back from the TCP and sweeps the
 *     flange→TCP segment for interference);
 *   - the client-side closed form (ADR-147) solves with the same length, so the
 *     unverified preview lands the tool tip where `core/` would;
 *   - `RobotStage` draws the tool on `wrist_3_link` at this length, so what the
 *     viewer sees is the tool that was solved.
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

/**
 * Flange (tool0) → TCP distance along the flange +Z, in METERS (the wire unit —
 * `robot.toolLength`). 150 mm: a typical parallel-jaw gripper's length, agreed
 * with the dogfooder for both hand kinds.
 */
export const TOOL_LENGTH_M = 0.15

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
