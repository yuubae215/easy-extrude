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
import { deriveFlangeSeed } from '../robotics/UrdfChain.js'
import { kinematicsDeclarationFromUrdf } from '../domain/robotKinematics.js'

/** The skeleton URDF as a bundled string (no runtime fetch). */
export const ROBOT_URDF_TEXT = urdfText

/**
 * The tcp frame's default LOCAL translation: the URDF flange (tool0) position at
 * the shared rest pose, DERIVED — replacing ADR-084's hand-copied
 * `(-0.717,-0.133,0.346)` constant. Fed to `SceneService` (ensureRobotFrames) so
 * the tool point seeds at the skeleton's hand from the same source that draws it.
 * @type {{ x:number, y:number, z:number }}
 */
export const TCP_LOCAL_SEED = deriveFlangeSeed(ROBOT_URDF_TEXT, ROBOT_REST_POSE)

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
