/**
 * robotSkeleton — the single bundled source of the robot skeleton (ADR-088).
 *
 * BROWSER-ONLY MODULE. It is the *only* place the URDF text is imported (via
 * Vite `?raw`), so `import.meta`/`?raw` never leaks into a module the
 * `node --test` lane executes (SceneService is imported by node tests; this
 * module must stay out of that graph — it is imported only by main.js/view).
 *
 * WHY (ADR-088 §1.1): the URDF is the single authority for the arm's
 * kinematics. Bundling it once and having BOTH the render path (`RobotStage`
 * parses `ROBOT_URDF_TEXT`) and the seed path (`TCP_LOCAL_SEED` = its forward
 * kinematics at the shared rest pose) read that one string means the drawn
 * flange and the tcp seed can never disagree. No runtime fetch; the file rides
 * the bundle.
 */

import urdfText from '../../public/robot/skeleton_arm.urdf?raw'
import { ROBOT_REST_POSE } from '../domain/robotConfig.js'
import { deriveFlangeSeed, parseUrdfChain } from '../robotics/UrdfChain.js'
import { kinematicsDeclarationFromUrdf } from '../domain/robotKinematics.js'
import { movableJoints } from '../robotics/Kinematics.js'
import { mToMM } from '../domain/worldUnits.js'
import { reachEnvelopeFor, robotModelById, SHIPPED_ROBOT_MODEL_ID } from '../domain/robotModel.js'

/** The skeleton URDF as a bundled string (no runtime fetch). */
export const ROBOT_URDF_TEXT = urdfText

/**
 * The tcp frame's default LOCAL translation: the URDF flange (tool0) position at
 * the shared rest pose, DERIVED — replacing ADR-084's hand-copied
 * `(-0.717,-0.133,0.346)` constant. Fed to `SceneService` (ensureRobotFrames) so
 * the tool point seeds at the skeleton's hand from the same source that draws it.
 * The URDF's forward kinematics is in meters (ROS standard); this local CF
 * translation lives in the mm-scale scene (ADR-136), so it is converted once here.
 * @type {{ x:number, y:number, z:number }}
 */
const _flangeSeedMeters = deriveFlangeSeed(ROBOT_URDF_TEXT, ROBOT_REST_POSE)
export const TCP_LOCAL_SEED = {
  x: mToMM(_flangeSeedMeters.x),
  y: mToMM(_flangeSeedMeters.y),
  z: mToMM(_flangeSeedMeters.z),
}

/**
 * The wire-shaped `robot.kinematics` declaration for this skeleton (ADR-127 /
 * DEF-030), DERIVED from the very string `RobotStage` parses to draw the arm.
 *
 * The third consumer of the one URDF, joining the render path and the tcp seed:
 * what the solver is told about the arm and what the user sees on screen cannot
 * be different arms, because there is only one set of numbers. `null` when the
 * bundled URDF stops being UR-shaped — which keeps ADR-127 D3's safe default
 * (naive cone judgement) rather than declaring a structure that is not there.
 *
 * @type {{kind: string, dh: object, jointLimits?: {min:number,max:number}[]}|null}
 */
export const ROBOT_KINEMATICS = kinematicsDeclarationFromUrdf(ROBOT_URDF_TEXT)

/**
 * The movable joints' names in CHAIN ORDER (base → flange), read out of the very
 * URDF that draws the arm (ADR-135 D3).
 *
 * **Why derived and not written down**: the wire carries `reachSolution.joints`
 * as a bare array of six numbers, positionally. Turning that array back into
 * `RobotStage.setJointValues`' `{name: value}` map needs an ORDER, and an order
 * hand-copied here would be a second source that drifts the day someone reorders
 * the URDF — silently, because a permuted arm still renders as *an* arm. Reading
 * it from the same string `ROBOT_KINEMATICS` derives its six DH lengths from
 * means the order the solver was told about and the order we draw back cannot
 * disagree.
 *
 * Same list, same order the solver's `joints` are in: `kinematicsDeclarationFromUrdf`
 * builds the DH parameters from `movableJoints(parseUrdfChain(...))`, and so does
 * this.
 *
 * @type {readonly string[]}
 */
export const ROBOT_JOINT_NAMES = Object.freeze(
  movableJoints(parseUrdfChain(ROBOT_URDF_TEXT)).map(j => j.name)
)

/**
 * The reach envelope of the arm this module draws (ADR-141) — the FOURTH
 * consumer of the one URDF, after the render path, the tcp seed and
 * `ROBOT_KINEMATICS`.
 *
 * Before ADR-141 the envelope was picked from a catalog of three hand-written
 * arms that had no connection to the skeleton on screen, so "declare reach
 * envelope" could describe a robot the user was not looking at. Deriving it here
 * means the arm that is drawn, the arm the solver is told about, and the arm the
 * envelope describes are the same arm by construction.
 *
 * `null` when the bundled URDF no longer agrees with the shipped model's
 * declared envelope — an undeclared envelope is a legitimate state, a wrong one
 * is not (ADR-120).
 *
 * @type {{reachMin: number, reachMax: number, wristConeHalfAngle: number}|null}
 */
export const ROBOT_REACH_ENVELOPE = reachEnvelopeFor(ROBOT_KINEMATICS)

/** Which shipped model the drawn skeleton is (ADR-141) — a label for the panel. */
export const ROBOT_MODEL_LABEL = robotModelById(SHIPPED_ROBOT_MODEL_ID).label
