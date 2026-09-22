// @ts-nocheck
/**
 * robotVisualStyle — WHICH GEOMETRY a `RobotStage` draws for the one UR5e
 * kinematic chain this app has (view-layer only; never a second source of
 * kinematics).
 *
 * `RobotStage` always derives its joints from `ROBOT_URDF_TEXT`
 * (`robotSkeleton.js`, ADR-088) — that does not change here. `REALISTIC`
 * swaps only the drawn GEOMETRY for a URDF that ships Universal Robots' own
 * visual meshes (Apache-2.0, ros-industrial `ur_description` — see
 * `public/robot/ur5e_visual/NOTICE.md`), fetched lazily at runtime:
 * `public/robot/ur5e_visual/` is ~9 MB of COLLADA meshes, too heavy to bundle
 * and unneeded unless a viewer actually asks for this style. The bundled
 * skeleton stays the default (zero network, GitHub-Pages-friendly, matches
 * `RobotStage`'s behaviour before this module existed).
 *
 * The realistic URDF's joint origins are asserted to numerically AGREE with
 * `skeleton_arm.urdf`'s in `src/RobotVisualStyleAgreement.test.js` — this is
 * a SECOND ASSET of the same arm, not a second arm (ADR-141's "which arm"
 * axis is untouched: `ROBOT_MODELS` still has exactly one row).
 *
 * BROWSER-ONLY MODULE (`import.meta.env.BASE_URL`) — imported only by
 * `RobotStage.js`, never by a `node --test` file, same discipline
 * `robotSkeleton.js` follows for its own browser-only import (ADR-088 §header).
 */

/** The two geometries a stage can draw for the app's one UR5e. Closed vocabulary (原則 #31). */
export const ROBOT_RENDER_STYLE = Object.freeze({
  SKELETON:  'skeleton',   // primitive-<geometry> bones, bundled, zero network (default)
  REALISTIC: 'realistic',  // Universal Robots' own visual meshes, fetched on demand
})

const REALISTIC_ASSET_DIR = 'robot/ur5e_visual'

/**
 * Resolves a `public/`-relative path against Vite's configured base
 * (`base: '/easy-extrude/'` — GitHub Pages serves this app from a
 * subdirectory, not `/`). This is the first RUNTIME fetch of a `public/`
 * asset in this app (everything else is bundled via `?raw`), so nothing
 * upstream already carries this concern.
 * @param {string} relativePath
 */
function assetUrl(relativePath) {
  return `${import.meta.env.BASE_URL}${relativePath}`
}

/** URL of the realistic URDF text (fetch, not `?raw` — see module header). */
export function realisticUrdfUrl() {
  return assetUrl(`${REALISTIC_ASSET_DIR}/urdf/ur5e.urdf`)
}

/** `URDFLoader.packages` mapping resolving this URDF's `package://ur_description/…` mesh refs. */
export function realisticPackages() {
  return { ur_description: assetUrl(REALISTIC_ASSET_DIR) }
}
