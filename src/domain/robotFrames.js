/**
 * Robot frame naming convention (ADR-084 §2, TF tree revised 2026-07-22).
 *
 * The robot's placement geometry is a first-class part of the scene: two
 * CoordinateFrame entities carry the single source of truth (§1.1) that
 * grasp-search declares against — replacing the ad-hoc `uiStore.robotBase` raw
 * coordinates that ADR-083 introduced.
 *
 * They form the canonical robotics TF tree  world → robot_base → tcp  (revising
 * ADR-084 §2's original "two independent world-parented frames" simplification):
 *
 *   ROBOT_BASE_FRAME_NAME — world-parented (root). Position only (where the arm
 *     stands). Orientation is not used by reach evaluation (§1).
 *   TCP_FRAME_NAME        — a CHILD of robot_base (the tool point is expressed in
 *     the robot's own frame, so moving/rotating the base carries the TCP with
 *     it). Its *world* quaternion (composed through robot_base by
 *     SceneService._updateWorldPoses) becomes `robot.tcpOrientation` on the wire
 *     and drives the wrist-cone reference axis in core/ (ADR-084 §3). Its
 *     translation/rotation are stored LOCAL to robot_base.
 *
 * Resolution is a plain name lookup on `scene.objects` (1-robot scope — no
 * `refs` field, no selection UI; ADR-084 §2/§4). Pure module (no THREE / no
 * DOM) so both SceneService (view side) and GraspController (THREE-free test
 * lane) import the same canonical names — one source of truth for the strings.
 */

/** @type {'robot_base'} */
export const ROBOT_BASE_FRAME_NAME = 'robot_base'

/** @type {'tcp'} */
export const TCP_FRAME_NAME = 'tcp'

/**
 * True when `obj` is the world-parented root robot_base frame — the entity whose
 * geometry is the robot skeleton and whose Outliner eye owns the skeleton's
 * visibility (ADR-087). Duck-typed on name + null parent, matching this module's
 * name-based resolution contract (the byName lookup in SceneService.ensureRobotFrames
 * identifies robot_base the same way); callers that need a hard type guard pair it
 * with `instanceof CoordinateFrame`. THREE-free so the grasp-search test lane can
 * import it.
 * @param {{name?: string, parentId?: string|null}|null|undefined} obj
 * @returns {boolean}
 */
export function isRobotBaseFrame(obj) {
  return !!obj && obj.parentId === null && obj.name === ROBOT_BASE_FRAME_NAME
}

/**
 * Default placement of the auto-seeded robot frames (ADR-084 §2, silent
 * auto-generation per ADR-073).
 *
 * `robot_base` keeps ADR-083's default WORLD position `[-2, 2, 0]` so existing
 * behaviour (and RobotStage's default pose) is unchanged — offset from the
 * origin so the arm does not spawn buried inside the origin-centred starter
 * cube. It stays world-parented (the same world frame the world gizmo and the
 * starter cube share).
 *
 * The `tcp` frame's default LOCAL translation is NO LONGER a constant here
 * (ADR-088): it is the UR5e flange (tool0) position at the shared rest pose,
 * DERIVED by forward kinematics of `public/robot/skeleton_arm.urdf` and injected
 * into `SceneService` (see `view/robotSkeleton.js` → `TCP_LOCAL_SEED`). The
 * flange fact now has one authority — the URDF + `ROBOT_REST_POSE` — so it can no
 * longer silently drift from a hand-copied number when either input changes.
 * (The tcp seed's orientation stays identity, keeping the `tcpOrientation` wire
 * contract unchanged until the user re-aims it through the CF edit UI.)
 */
export const ROBOT_FRAME_DEFAULTS = Object.freeze({
  [ROBOT_BASE_FRAME_NAME]: Object.freeze({
    position: Object.freeze({ x: -2, y: 2, z: 0 }),
    rotation: Object.freeze({ x: 0, y: 0, z: 0, w: 1 }),
  }),
})
