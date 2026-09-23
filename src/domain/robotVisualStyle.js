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

/**
 * The two geometries a stage can draw for the app's one UR5e. Closed vocabulary
 * (原則 #31). Which one `RobotStageSet` declares as the SCENE'S default lives at
 * `RobotStageSet._renderStyle`'s initializer, not here (原則 #1.1 — this module
 * only names the values, it does not choose between them).
 */
export const ROBOT_RENDER_STYLE = Object.freeze({
  SKELETON:  'skeleton',   // primitive-<geometry> bones, bundled, zero network — the explicit lightweight opt-out (`RobotAppearanceToggle`, ADR-149)
  REALISTIC: 'realistic',  // Universal Robots' own visual meshes, fetched on demand — the scene's default since ADR-149
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

/**
 * Throws for a style nobody declared, rather than falling through to the
 * default (原則 #31 — a fall-through default makes "the declared default" and
 * "a kind nobody thought about" indistinguishable; the same shape as
 * `EXPLICIT_DEFAULTS` / `PLACEMENT_BY_KIND` / `SUPPORT_SURFACE_BY_KIND`).
 *
 * Before this existed, `RobotStage.setRenderStyle` branched on
 * `style === REALISTIC ? … : buildSkeleton()`, so a typo (`'realstic'`) drew
 * the SKELETON and then recorded `_renderStyle = 'realstic'` — a stage
 * claiming a style that is not in the vocabulary, silently.
 *
 * `unknown` on purpose: this IS the boundary check, so it has to be callable
 * with whatever a console/UI/test actually hands it — narrowing the parameter
 * to the very union it exists to establish would make the typo case
 * untypecheckable at every real call site.
 *
 * @param {unknown} style
 * @returns {'skeleton'|'realistic'}
 */
export function assertRenderStyle(style) {
  const declared = /** @type {string[]} */ (Object.values(ROBOT_RENDER_STYLE))
  if (typeof style !== 'string' || !declared.includes(style)) {
    throw new Error(
      `robotVisualStyle: undeclared render style ${JSON.stringify(style)} ` +
      `(declared: ${declared.join(' | ')})`)
  }
  return /** @type {'skeleton'|'realistic'} */ (style)
}

/**
 * The style a stage will be SHOWING once everything already asked of it has
 * landed: the pending request when a load is in flight, otherwise whatever is
 * committed. `pending` is `null` when nothing is in flight.
 *
 * Exists because switching to `realistic` is asynchronous (~9 MB of meshes),
 * so "the style this stage has" and "the style this stage is heading for" are
 * two different facts and only the second one can answer "is this request
 * redundant?".
 *
 * @param {'skeleton'|'realistic'} committed
 * @param {'skeleton'|'realistic'|null} pending
 */
export function settledStyle(committed, pending) {
  return pending ?? committed
}

/**
 * Is this request asking for the style the stage is ALREADY heading for?
 *
 * The one rule this function exists to keep correct: compare the request to
 * the SETTLED style, never to the committed one. Comparing against the
 * committed style makes a no-op out of the request that is supposed to CANCEL
 * an in-flight load —
 *
 *   skeleton → setRenderStyle('realistic')  // in flight, nothing committed yet
 *             → setRenderStyle('skeleton')  // 'skeleton' === committed ⇒ returns
 *                                           // early WITHOUT bumping the
 *                                           // supersession token …
 *             → the realistic load lands and wins
 *
 * — so the arm ends up in the style of the request that LOST. A single
 * request per check is green either way (the two readings agree whenever
 * nothing is in flight), which is why this is pinned as a pure rule here and
 * as a two-request e2e rather than left inside the async method (ADR-148).
 *
 * @param {'skeleton'|'realistic'} requested
 * @param {'skeleton'|'realistic'} committed
 * @param {'skeleton'|'realistic'|null} pending
 */
export function isRedundantStyleRequest(requested, committed, pending) {
  return requested === settledStyle(committed, pending)
}

/**
 * Lifecycle of the ONE shared realistic asset (ADR-150 D1). Closed vocabulary.
 * Before ADR-150 every `RobotStage` fetched and parsed its own ~9 MB copy, so
 * each spawned arm spent a second as a skeleton before swapping — the asset had
 * no identity of its own, only N private loads. It now has exactly one, and
 * four states (§1.4 threshold → `docs/STATE_TRANSITIONS.md` §Realistic asset).
 */
export const ASSET_STATE = Object.freeze({
  IDLE:    'idle',     // nobody has asked yet — legal, and costs no network
  LOADING: 'loading',  // exactly one fetch in flight, shared by every requester
  READY:   'ready',    // parsed template cached; every later request is synchronous-in-effect
  FAILED:  'failed',   // the last fetch failed; the NEXT request retries (it is not sticky)
})

/**
 * The asset's transition table. An event not listed for a state THROWS instead
 * of being ignored — `resolve` while `idle` means a load nobody started landed,
 * which is a bug to surface, not a no-op to swallow (原則 #11 / #31).
 */
const ASSET_TRANSITIONS = Object.freeze({
  [ASSET_STATE.IDLE]:    { request: ASSET_STATE.LOADING },
  [ASSET_STATE.LOADING]: { resolve: ASSET_STATE.READY, reject: ASSET_STATE.FAILED },
  [ASSET_STATE.READY]:   {},
  [ASSET_STATE.FAILED]:  { request: ASSET_STATE.LOADING },
})

/**
 * @param {string} state  one of ASSET_STATE
 * @param {'request'|'resolve'|'reject'} event
 * @returns {string} the next state
 */
export function nextAssetState(state, event) {
  const row = ASSET_TRANSITIONS[state]
  if (!row) throw new Error(`robotVisualStyle: undeclared asset state ${JSON.stringify(state)}`)
  const next = row[event]
  if (!next) throw new Error(`robotVisualStyle: illegal asset transition ${state} --${event}-->`)
  return next
}

/**
 * One load shared by every requester (ADR-150 D1). `load` runs at most once per
 * `loading` episode however many stages ask — N arms, one fetch. A failure is
 * not cached: the next `request()` retries, so one bad network moment does not
 * condemn every arm spawned afterwards to the skeleton.
 *
 * Pure of THREE / DOM on purpose: the claim "N requests, 1 fetch" is exactly the
 * one the browser-only `RobotStage` could never be asked about under `node
 * --test` (ADR-148 §なぜ緑だったか). Here it can.
 *
 * @template T
 * @param {() => Promise<T>} load
 * @returns {{ request: () => Promise<T>, readonly state: string }}
 */
export function createSharedAsset(load) {
  /** @type {string} one of ASSET_STATE */
  let state = ASSET_STATE.IDLE
  /** @type {Promise<T>|null} */
  let inFlight = null
  /** @type {T|undefined} */
  let value
  return {
    get state() { return state },
    request() {
      if (state === ASSET_STATE.READY) return Promise.resolve(/** @type {T} */ (value))
      if (state === ASSET_STATE.LOADING) return /** @type {Promise<T>} */ (inFlight)
      state = nextAssetState(state, 'request')
      inFlight = Promise.resolve().then(load).then(
        v => { value = v; state = nextAssetState(state, 'resolve'); inFlight = null; return v },
        err => { state = nextAssetState(state, 'reject'); inFlight = null; throw err },
      )
      return inFlight
    },
  }
}
