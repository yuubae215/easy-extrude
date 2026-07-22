/**
 * Robot frame naming convention (ADR-084 §2).
 *
 * The robot's placement geometry is a first-class part of the scene: two
 * world-parented CoordinateFrame entities carry the single source of truth
 * (§1.1) that grasp-search declares against — replacing the ad-hoc
 * `uiStore.robotBase` raw coordinates that ADR-083 introduced.
 *
 *   ROBOT_BASE_FRAME_NAME — position only (where the arm stands). Orientation
 *     is not used by reach evaluation (§1).
 *   TCP_FRAME_NAME        — position + orientation (how the gripper is aimed).
 *     Its world quaternion becomes `robot.tcpOrientation` on the wire and
 *     drives the wrist-cone reference axis in core/ (ADR-084 §3).
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
 * Default world placement of the auto-seeded robot frames (ADR-084 §2, silent
 * auto-generation per ADR-073). `robot_base` keeps ADR-083's default
 * `[-2, 2, 0]` so existing behaviour (and RobotStage's default pose) is
 * unchanged. `tcp` seeds at the same spot with identity orientation; the user
 * re-aims it through the existing CoordinateFrame edit UI (G / R / N-panel).
 */
export const ROBOT_FRAME_DEFAULTS = Object.freeze({
  [ROBOT_BASE_FRAME_NAME]: Object.freeze({
    position: Object.freeze({ x: -2, y: 2, z: 0 }),
    rotation: Object.freeze({ x: 0, y: 0, z: 0, w: 1 }),
  }),
  [TCP_FRAME_NAME]: Object.freeze({
    position: Object.freeze({ x: -2, y: 2, z: 0 }),
    rotation: Object.freeze({ x: 0, y: 0, z: 0, w: 1 }),
  }),
})
