// @ts-nocheck
/**
 * robotVisualStyle (view) — resolves the pure facts in `domain/robotVisualStyle.js`
 * against Vite's runtime `BASE_URL`. Split from the domain module the same way
 * `view/robotSkeleton.js` is split from `domain/robotModel.js`: the pure facts
 * (closed vocabulary, the yaw correction) stay importable by `node --test`;
 * only the URL-building here needs a browser.
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

export { ROBOT_RENDER_STYLE, REALISTIC_BASE_YAW_CORRECTION } from '../domain/robotVisualStyle.js'
import { REALISTIC_ASSET_DIR } from '../domain/robotVisualStyle.js'

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
