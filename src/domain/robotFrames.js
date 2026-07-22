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
 * Default placement of the auto-seeded robot frames (ADR-084 §2, silent
 * auto-generation per ADR-073).
 *
 * `robot_base` keeps ADR-083's default WORLD position `[-2, 2, 0]` so existing
 * behaviour (and RobotStage's default pose) is unchanged — offset from the
 * origin so the arm does not spawn buried inside the origin-centred starter
 * cube. It stays world-parented (the same world frame the world gizmo and the
 * starter cube share).
 *
 * `tcp` seeds as a CHILD of robot_base, so its pose here is LOCAL to the base:
 * `[0, 0, 0]` / identity places it coincident with the base with axes aligned;
 * the user re-aims it through the existing CoordinateFrame edit UI (G / R /
 * N-panel), and because it is parented, moving/rotating the base carries it
 * along (TF tree world → robot_base → tcp).
 */
export const ROBOT_FRAME_DEFAULTS = Object.freeze({
  [ROBOT_BASE_FRAME_NAME]: Object.freeze({
    position: Object.freeze({ x: -2, y: 2, z: 0 }),
    rotation: Object.freeze({ x: 0, y: 0, z: 0, w: 1 }),
  }),
  [TCP_FRAME_NAME]: Object.freeze({
    position: Object.freeze({ x: 0, y: 0, z: 0 }),
    rotation: Object.freeze({ x: 0, y: 0, z: 0, w: 1 }),
  }),
})
