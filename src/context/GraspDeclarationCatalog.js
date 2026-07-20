/**
 * GraspDeclarationCatalog — camera / gripper declaration presets, their gap
 * predicates, and the viewport-camera capture conversion (ADR-081 Decision 5).
 *
 * SCOPE / GOVERNANCE:
 * - Everything here is DECLARATION-side provisioning for the request's open
 *   payload (`graspSearch.camera` / `graspSearch.gripper` — layoutVersion
 *   governance, no contractVersion bump; ADR-081 §2). Nothing here judges
 *   visibility or graspability — the solving stays in `core/` (AI 向けガード).
 * - Presets follow the ADR-063 selection-first premise (白紙入力不能): a card
 *   never opens on a blank numeric form — the first preset seeds it, and the
 *   active-preset chip is DERIVED by value equality (`matchingPresetId`), so
 *   editing a field is the fork (fork & tweak, ADR-058) with no second
 *   "customised" flag to drift (kernel §1.1).
 * - The `*Gaps()` lists are the single submit predicate for their card
 *   (disable the Run button AND print the reasons — no silent disabled,
 *   PHILOSOPHY #11; same discipline as IntakeAssist, ADR-058 UX rule).
 * - `visionFromViewportCamera` is the pure half of the "use current view"
 *   capture (ADR-081 §5): it maps a minimal camera snapshot (world position +
 *   matrixWorld elements + optional perspective fov) onto the wire declaration.
 *   The side-effect half (reading the live THREE camera) lives in
 *   GraspController.captureViewportCamera().
 *
 * Pure and THREE-free: runs in the bare `node --test` lane (test:context).
 */

/** Round to 0.1 mm so captured values read cleanly in the form fields (+0 normalises -0). */
const round4 = (v) => Math.round(v * 1e4) / 1e4 + 0

/**
 * Vision-camera presets (wire shape: `graspSearch.camera`). Units follow the
 * request geometry (metres in the bundled templates); angles are radians.
 * The first entry is the card's seed (selection-first premise).
 */
export const CAMERA_PRESETS = Object.freeze([
  Object.freeze({
    id: 'overhead',
    label: 'overhead (top-down)',
    params: Object.freeze({ position: Object.freeze([0, 0, 1.2]), viewAxis: Object.freeze([0, 0, -1]), fovHalfAngle: 0.6 }),
  }),
  Object.freeze({
    id: 'angled',
    label: 'angled (45°)',
    params: Object.freeze({ position: Object.freeze([0.9, 0, 1.0]), viewAxis: Object.freeze([-0.7071, 0, -0.7071]), fovHalfAngle: 0.5 }),
  }),
  Object.freeze({
    id: 'side',
    label: 'side (low)',
    params: Object.freeze({ position: Object.freeze([1.2, 0, 0.4]), viewAxis: Object.freeze([-1, 0, 0]), fovHalfAngle: 0.4 }),
  }),
])

/**
 * Parallel-jaw gripper presets (wire shape: `graspSearch.gripper`). Openings
 * span the common industrial range; clearance is the naive gate's finger
 * slide-in margin. The first entry is the card's seed.
 */
export const GRIPPER_PRESETS = Object.freeze([
  Object.freeze({
    id: 'standard-60',
    label: 'parallel 60 mm',
    params: Object.freeze({ maxOpening: 0.06, fingerClearance: 0.01 }),
  }),
  Object.freeze({
    id: 'wide-85',
    label: 'parallel 85 mm',
    params: Object.freeze({ maxOpening: 0.085, fingerClearance: 0.01 }),
  }),
  Object.freeze({
    id: 'micro-30',
    label: 'micro 30 mm',
    params: Object.freeze({ maxOpening: 0.03, fingerClearance: 0.005 }),
  }),
])

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v)
const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every(isFiniteNumber)

/**
 * Derived active-preset id: the preset whose every param equals the current
 * values (numeric equality; vectors element-wise), or null when the values
 * diverge (= the user forked). This keeps the chip state a derivation of the
 * values, never a second source (kernel §1.1).
 *
 * @param {ReadonlyArray<{id: string, params: object}>} presets
 * @param {object|null|undefined} params  current parsed values (same shape)
 * @returns {string|null}
 */
export function matchingPresetId(presets, params) {
  if (!params) return null
  const eq = (a, b) => (Array.isArray(a) && Array.isArray(b))
    ? a.length === b.length && a.every((v, i) => v === b[i])
    : a === b
  for (const p of presets) {
    const keys = Object.keys(p.params)
    if (keys.every(k => eq(p.params[k], params[k]))) return p.id
  }
  return null
}

/**
 * Gap list for a parsed camera declaration ([] = valid). The list is the
 * submit predicate for the vision card: non-empty disables Run and every
 * reason is printed (PHILOSOPHY #11).
 *
 * A declared fovHalfAngle without a viewAxis is a gap on purpose: the solver
 * applies the FOV cone only when BOTH are declared (schema wording), so the
 * combination would be silently inert — an input consumed with no effect is
 * the failure shape #11 forbids.
 *
 * @param {{ position?: unknown, viewAxis?: unknown, fovHalfAngle?: unknown }|null|undefined} cam
 * @returns {string[]}
 */
export function cameraDeclarationGaps(cam) {
  if (!cam || typeof cam !== 'object') return ['camera declaration is empty']
  const gaps = []
  if (!isVec3(cam.position)) gaps.push('camera position needs 3 finite numbers')
  if (cam.viewAxis != null) {
    if (!isVec3(cam.viewAxis)) {
      gaps.push('view axis needs 3 finite numbers (or leave it out)')
    } else if (cam.viewAxis.every(v => v === 0)) {
      gaps.push('view axis must not be the zero vector')
    }
  }
  if (cam.fovHalfAngle != null) {
    if (!isFiniteNumber(cam.fovHalfAngle) || cam.fovHalfAngle < 0) {
      gaps.push('FOV half angle must be a number ≥ 0 (radians)')
    }
    if (cam.viewAxis == null) {
      gaps.push('FOV half angle applies only with a view axis — declare one or clear the FOV')
    }
  }
  return gaps
}

/**
 * Gap list for a parsed gripper declaration ([] = valid) — the grasp card's
 * submit predicate, same discipline as `cameraDeclarationGaps`.
 *
 * @param {{ maxOpening?: unknown, fingerClearance?: unknown }|null|undefined} g
 * @returns {string[]}
 */
export function gripperDeclarationGaps(g) {
  if (!g || typeof g !== 'object') return ['gripper declaration is empty']
  const gaps = []
  if (!isFiniteNumber(g.maxOpening) || g.maxOpening < 0) {
    gaps.push('max opening must be a number ≥ 0 (geometry unit)')
  }
  if (g.fingerClearance != null && (!isFiniteNumber(g.fingerClearance) || g.fingerClearance < 0)) {
    gaps.push('finger clearance must be a number ≥ 0 (geometry unit)')
  }
  return gaps
}

/**
 * Pure half of the "use current view" capture (ADR-081 §5): derive the wire
 * camera declaration from a minimal snapshot of the active viewport camera.
 *
 * - `position` maps directly — the scene already lives in the ROS world frame
 *   (+Z up, `camera.up = (0,0,1)`), the same frame the contract declares.
 * - `viewAxis` is the camera's look direction = the negated third column of
 *   matrixWorld (column-major elements 8..10), normalised. This avoids calling
 *   THREE's `getWorldDirection` so the caller stays THREE-free.
 * - `fovHalfAngle` derives from a perspective camera's VERTICAL fov (degrees →
 *   half angle in radians). The naive solver cone is symmetric around the view
 *   axis, so the vertical half-angle is the conservative choice (poses inside
 *   it are visible on screen regardless of aspect). An ortho camera (Map Mode)
 *   has no fov → null, and the form keeps its previous value.
 *
 * Malformed snapshots return null — the capture button then reports it
 * instead of writing a guessed declaration (PHILOSOPHY #11).
 *
 * @param {{ position?: {x:number,y:number,z:number}|null, matrixWorldElements?: ArrayLike<number>|null, fovDeg?: number|null }} snap
 * @returns {{ position: number[], viewAxis: number[], fovHalfAngle: number|null }|null}
 */
export function visionFromViewportCamera(snap) {
  const p = snap?.position
  const e = snap?.matrixWorldElements
  if (!p || !isFiniteNumber(p.x) || !isFiniteNumber(p.y) || !isFiniteNumber(p.z)) return null
  if (!e || e.length !== 16) return null
  const dx = -e[8], dy = -e[9], dz = -e[10]
  if (![dx, dy, dz].every(isFiniteNumber)) return null
  const len = Math.hypot(dx, dy, dz)
  if (!(len > 0)) return null
  const fov = snap.fovDeg
  return {
    position: [round4(p.x), round4(p.y), round4(p.z)],
    viewAxis: [round4(dx / len), round4(dy / len), round4(dz / len)],
    fovHalfAngle: isFiniteNumber(fov) && fov > 0 ? round4((fov * Math.PI / 180) / 2) : null,
  }
}
