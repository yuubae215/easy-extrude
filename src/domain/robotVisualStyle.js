/**
 * robotVisualStyle (domain) — pure facts about the two geometries a
 * `RobotStage` can draw for the app's one UR5e chain. No THREE, no DOM, no
 * `import.meta.env` — safe for the `node --test` lane. Browser-only concerns
 * (resolving these against Vite's `BASE_URL`) live in `view/robotVisualStyle.js`,
 * which imports from here — the same split `domain/robotModel.js` /
 * `view/robotSkeleton.js` already use.
 *
 * @module domain/robotVisualStyle
 */

/** The two geometries a stage can draw for the app's one UR5e. Closed vocabulary (原則 #31). */
export const ROBOT_RENDER_STYLE = Object.freeze({
  SKELETON:  'skeleton',   // primitive-<geometry> bones, bundled, zero network (default)
  REALISTIC: 'realistic',  // Universal Robots' own visual meshes, fetched on demand
})

/** `public/`-relative directory the realistic assets live under. */
export const REALISTIC_ASSET_DIR = 'robot/ur5e_visual'

/**
 * The rotation about +Z that `RobotStage` must apply to the LOADED REALISTIC
 * ROOT to cancel a frame convention baked into the official URDF — otherwise
 * the drawn arm ends up yawed 180° from where the TCP marker (derived solely
 * from `skeleton_arm.urdf`, unaware of this) actually sits.
 *
 * The official `ur5e.urdf` inserts a FIXED joint, `base_link-base_link_inertia`
 * (rpy `0 0 π`), between its root `base_link` and `base_link_inertia` — the
 * actual parent of `shoulder_pan_joint`. The file's own comment explains why:
 * "'base_link' is REP-103 aligned (so X+ forward)... while the internal
 * frames of the robot/controller have X+ pointing backwards." `RobotStage`'s
 * `skeleton_arm.urdf` has no such intermediate frame — `shoulder_pan_joint`
 * sits directly under `base_link` — so loading the realistic URDF as-is
 * yaws the whole chain 180° relative to what `deriveFlangeSeed` (the
 * skeleton's own FK) placed the TCP marker at. Composing this SAME rotation
 * on the loaded root cancels the internal one (both are pure-Z, zero-
 * translation rotations, so they commute) and realigns the two — verified
 * numerically (not just by inspection) in `RobotVisualStyleAgreement.test.js`,
 * which runs `forwardKinematics` on both chains with this correction applied
 * and asserts the resulting flange pose actually agrees with the skeleton's,
 * plus asserts the official file still declares exactly this fixed-joint
 * value so an upstream change to it is caught rather than silently drawing
 * the arm 180° off from its own TCP marker again.
 */
export const REALISTIC_BASE_YAW_CORRECTION = Math.PI
