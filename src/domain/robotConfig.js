/**
 * robotConfig — shared robot-arm configuration data (ADR-088).
 *
 * Pure module (no THREE / no DOM) so both the render side (`RobotStage`) and the
 * seed-derivation side (`view/robotSkeleton.js` → `SceneService`) read ONE
 * definition of the rest pose. Before ADR-088 the rest pose lived only in
 * `RobotStage._applyRestPose`, and the tcp seed was a hand-copied constant of its
 * forward kinematics — two places encoding one fact (§1.1 violation). Lifting the
 * pose here makes the flange's two inputs each single-source:
 *
 *   kinematics  ← public/robot/skeleton_arm.urdf   (the URDF, one source)
 *   rest pose   ← ROBOT_REST_POSE                   (this constant, one source)
 *
 * The tcp default seed is then DERIVED from the pair (deriveFlangeSeed), never
 * written down, so changing either input carries the tcp along automatically.
 */

/**
 * The legible bent-elbow UR rest pose (radians), keyed by URDF joint name. Not a
 * straight totem pole — a recognizable arm silhouette. Joints omitted here rest
 * at 0. Changing this now moves BOTH the rendered skeleton and the derived tcp
 * seed together (that coupling is the whole point of ADR-088).
 *
 * @type {Readonly<Record<string, number>>}
 */
export const ROBOT_REST_POSE = Object.freeze({
  shoulder_lift_joint: -1.0,
  elbow_joint: 1.2,
  wrist_1_joint: -1.8,
  wrist_2_joint: -1.5708,
})
