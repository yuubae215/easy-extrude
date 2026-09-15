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

/**
 * The COMPLETE rest-pose map for a chain: every movable joint named, including
 * the ones `ROBOT_REST_POSE` omits because they rest at 0 (ADR-135 D3).
 *
 * **Why completeness is the point.** `ROBOT_REST_POSE` lists only the four
 * joints that are bent; `shoulder_pan` and `wrist_3` are absent and read as 0.
 * That was harmless while the rest pose was the ONLY thing ever written. Once a
 * six-joint preview can be written, handing `ROBOT_REST_POSE` back writes only
 * those four — and the previewed `shoulder_pan` STAYS, so "return to rest"
 * silently leaves the arm in a pose that is neither the rest pose nor any
 * solution. The omitted joints are a 0 that does not look like a state
 * (原則 #31): they have no row in the constant, so reading the constant cannot
 * show you they were missed.
 *
 * @param {readonly string[]} jointNames  every movable joint, in chain order
 * @returns {Record<string, number>} name → angle, one entry per joint
 */
export function restPoseMap(jointNames) {
  const values = {}
  for (const name of jointNames) values[name] = ROBOT_REST_POSE[name] ?? 0
  return values
}

/**
 * Which joint angles to WRITE for a given `reachSolution` payload — the pure
 * core of `RobotStage.previewSolution` (原則 #3: the decision is separated from
 * the THREE-touching write).
 *
 * Every non-drawable case funnels to the rest pose rather than to a partial
 * write, because a half-applied vector renders as an arm no solver decided on,
 * and ADR-135's goal is precisely that a drawn arm is always a solved one.
 *
 * @param {readonly number[] | null | undefined} joints  angles in `jointNames`
 *   order (`reachSolution.kind === 'solved'`), or null/undefined for rest
 *   (`undeclared`, hover cleared, no candidate)
 * @param {readonly string[]} jointNames  every movable joint, in chain order
 * @returns {Record<string, number>} the complete map to write
 */
export function jointValuesFor(joints, jointNames) {
  if (!Array.isArray(joints) || joints.length !== jointNames.length) {
    return restPoseMap(jointNames)
  }
  const values = {}
  jointNames.forEach((name, i) => { values[name] = joints[i] })
  return values
}

/**
 * Which joint payload each robot's skeleton should draw, given the search
 * subject (ADR-135 D3, the N-robot half).
 *
 * The rule this function EXISTS to pin: previewing a candidate is a fact about
 * the whole set, not about one arm. The subject draws the solution and **every
 * other arm rests** — otherwise an arm previously previewed stays frozen in a
 * solution for a robot the search has moved off. At N=1 that bug is invisible
 * (the only stage is always the subject), so this is checked at N=2 (原則 #31:
 * `1` and `N` are different worlds and only one of them was designed).
 *
 * Pure, so the rule is checkable without THREE: `RobotStageSet` imports
 * `RobotStage` → `urdf-loader` → a Vite `?raw` URDF, none of which the
 * `node --test` lane can load.
 *
 * @param {Iterable<string>} stageIds  every robot with a skeleton
 * @param {string|null} subjectId  the robot the search is about, or null
 * @param {readonly number[]|null} joints  the subject's solution, or null
 * @returns {Array<[string, readonly number[]|null]>} id → what that arm draws
 */
export function previewAssignments(stageIds, subjectId, joints) {
  return [...stageIds].map(id => [id, id === subjectId ? joints ?? null : null])
}
