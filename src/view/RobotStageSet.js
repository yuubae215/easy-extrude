// @ts-nocheck
import { RobotStage } from './RobotStage.js'
import { previewAssignments } from '../domain/robotConfig.js'
import { ROBOT_RENDER_STYLE, assertRenderStyle } from '../domain/robotVisualStyle.js'
import { prefetchRealisticRobot } from './realisticRobotAsset.js'

/**
 * RobotStageSet — the N-robot seat for skeleton views (ADR-090).
 *
 * ADR-084 gave the viewport ONE `RobotStage`, which was correct while the scene
 * could hold exactly one robot. With 0 / 1 / N robots all legal, "the robot
 * skeleton" is no longer a single object: zero robots must draw nothing, and a
 * second robot must get its own skeleton rather than fighting the first one for a
 * single group's pose (last-write-wins — 原則 #4).
 *
 * This class owns one `RobotStage` PER ROBOT, keyed by the robot's stable id (its
 * base frame's entity id — ADR-090 Decision 1). It is a pure view container: it
 * renders poses handed to it and never solves one (IK / reach live in `core/`).
 *
 * OWNERSHIP + LIFECYCLE (原則 #9): constructed and disposed by `SceneView`, the
 * same seat the single stage had. `sync(ids)` is the ONE entry point that creates
 * and destroys stages — every create has its dispose in the same method, so a
 * deleted robot cannot leave an orphaned skeleton in the THREE scene. Callers pass
 * the roster ids (AppController._syncRobotStage, from the domain resolution) and
 * never construct a `RobotStage` themselves.
 */
export class RobotStageSet {
  /** @param {import('three').Scene} threeScene */
  constructor(threeScene) {
    this._scene = threeScene
    /** @type {Map<string, RobotStage>} robot id → its skeleton view */
    this._stages = new Map()
    /**
     * @type {'skeleton'|'realistic'} THE STYLE THIS SCENE DRAWS — the one
     * authority for a fact that belongs to the SET, not to any one stage
     * (ADR-148 D2). Each `RobotStage` owns "which style I draw" at cardinality
     * 1; nothing owned "which style the scene draws" at cardinality N, so
     * `setRenderStyle` was a fan-out over whichever stages happened to be
     * alive at the time and a robot added afterwards booted into the default
     * — two arms of the same UR5e, drawn differently, with no field saying
     * which was right (原則 #31: N has no column of its own).
     *
     * Legitimate at 0 stages: the declaration survives an empty scene and the
     * next stage created adopts it, which is exactly the case a fan-out
     * cannot express.
     *
     * Default is REALISTIC (ADR-149): the first look at the app shows the
     * real UR5e mesh with no user action. `RobotAppearanceToggle` gives an
     * always-reachable way back to the zero-network `skeleton` for users who
     * want it — this class's OWNERSHIP of the declaration (this field, this
     * setter) is unchanged, only the initial value and the number of callers
     * that can reach `setRenderStyle` moved.
     */
    this._renderStyle = ROBOT_RENDER_STYLE.REALISTIC
    /** @type {number} style loads in flight across all stages (ADR-150 D3) */
    this._loadsInFlight = 0
    /** @type {Set<(event: RobotStageSetEvent) => void>} */
    this._listeners = new Set()
    // Start the one shared mesh load now, not on the first spawn (ADR-150 D1):
    // by the time an arm is added, the asset is usually `ready` and the first
    // look costs a clone, not a fetch.
    if (this._renderStyle === ROBOT_RENDER_STYLE.REALISTIC) prefetchRealisticRobot()
  }

  /**
   * @typedef {{type: 'loading', loading: boolean}
   *         | {type: 'adoptFailed', id: string, style: string, error: unknown}} RobotStageSetEvent
   */

  /**
   * Subscribe to this set's load lifecycle (原則 #5 — the chrome listens, it
   * does not poll the set). `loading` fires on the 0→1 and 1→0 edges of "a
   * style load is in flight somewhere"; `adoptFailed` fires when a NEW stage
   * could not adopt the scene's style (its skeleton is shown instead — the
   * listener is how the user hears about it, 原則 #11).
   * @param {(event: RobotStageSetEvent) => void} listener
   * @returns {() => void} unsubscribe
   */
  subscribe(listener) {
    this._listeners.add(listener)
    return () => this._listeners.delete(listener)
  }

  _emit(event) {
    for (const listener of this._listeners) listener(event)
  }

  /** Whether any style load is in flight (read-only mirror of the `loading` event). */
  get loading() { return this._loadsInFlight > 0 }

  /**
   * Count a stage's style load in and out of flight. The ONE place the
   * counter moves, so the 0→1 / 1→0 edges cannot be double-counted.
   * @template T
   * @param {Promise<T>} promise
   * @returns {Promise<T>}
   */
  _track(promise) {
    if (this._loadsInFlight++ === 0) this._emit({ type: 'loading', loading: true })
    const settle = () => {
      if (--this._loadsInFlight === 0) this._emit({ type: 'loading', loading: false })
    }
    promise.then(settle, settle)
    return promise
  }

  /** Number of live skeletons (the view-side cardinality). */
  get size() { return this._stages.size }

  /** @returns {string[]} ids of the live skeletons, in insertion order */
  ids() { return [...this._stages.keys()] }

  /**
   * Reconcile the live skeletons with the roster: create a stage for each id that
   * has none, dispose the ones whose robot is gone. Idempotent — an unchanged
   * roster does no work, so this is safe to call from the animation loop.
   *
   * A newly created skeleton is VISIBLE; whether it STAYS visible is decided by
   * its base frame's `explicit` visibility axis, which the caller adopts right
   * after sync() (AppController._syncRobotStage). The boot scene's hidden arm is
   * that axis' DECLARED default for a seeded robot (ADR-096 §Decision 3), not a
   * default chosen here — this class must not hold a second opinion about it.
   *
   * @param {Iterable<string>} ids  robot ids currently in the scene
   * @returns {boolean} true when the set changed (a stage was added or removed)
   */
  sync(ids) {
    const wanted = new Set(ids ?? [])
    let changed = false

    for (const id of wanted) {
      if (this._stages.has(id)) continue
      // The stage is told the scene's style AT BIRTH (ADR-150 D2), so it can
      // stay hidden until that style lands instead of flashing the skeleton.
      const stage = new RobotStage(this._scene, { declaredStyle: this._renderStyle })
      this._stages.set(id, stage)
      // The obligation "a new stage draws the style this scene declared" lives
      // HERE, on the event that creates the stage, not next to the declaration
      // (原則 #32). A `RobotStage` boots into the bundled skeleton by design
      // (zero network); adopting the scene's style is the set's business — no
      // second place encodes which style is the default (ADR-149: the
      // default is REALISTIC, so this call fetches the ~9 MB mesh for every
      // newly created stage unless the scene has switched to skeleton).
      const style = this._renderStyle
      this._track(stage.setRenderStyle(style)).catch(error => {
        console.error(`RobotStageSet.sync: "${id}" could not adopt the scene's "${style}" style.`, error)
        this._emit({ type: 'adoptFailed', id, style, error })
      })
      changed = true
    }
    for (const [id, stage] of [...this._stages]) {
      if (wanted.has(id)) continue
      stage.dispose()                 // symmetric teardown for the new above (#9)
      this._stages.delete(id)
      changed = true
    }
    return changed
  }

  /**
   * Place one robot's skeleton at a world pose. No-op for an unknown id (the
   * roster and the stage set converge on the next `sync`).
   * @param {string} id
   * @param {{x:number,y:number,z:number}} position
   * @param {{x:number,y:number,z:number,w:number}} [quaternion]
   */
  setPose(id, position, quaternion) {
    this._stages.get(id)?.setPose(position, quaternion)
  }

  /**
   * Hand one robot's tool mount (`tool0 → tcp`, ADR-151) to its stage, which
   * draws the tool and the TCP marker from it. Keyed by robot id like `setPose`,
   * so with N robots each arm carries its own tool. Idempotent per stage.
   * @param {string} id
   * @param {{translation:{x:number,y:number,z:number}, rotation:{x:number,y:number,z:number,w:number}}|null} mount
   */
  setToolMount(id, mount, hand = null) {
    this._stages.get(id)?.setToolMount(mount, hand)
  }

  /**
   * World position of one robot's TCP marker, or null (no such robot / no
   * mount) — read-only, for the e2e that checks the marker rides the tool tip.
   * @param {string} id
   * @returns {{x:number,y:number,z:number}|null}
   */
  tcpMarkerWorldPosition(id) {
    return this._stages.get(id)?.tcpMarkerWorldPosition() ?? null
  }

  /**
   * **The one entry point deciding which arm is posed into a candidate's
   * solution** (ADR-135 D3, extended to the N-robot seat).
   *
   * `RobotStage.previewSolution` alone would be the N=1 design. With a stage per
   * robot, "preview candidate C" is not a fact about one arm but about the WHOLE
   * SET: the search subject (`GraspController._selectedRobotId`, ADR-130) shows
   * the solution, and **every other arm must be at rest**. Writing only the
   * subject's stage leaves the previously-previewed arm frozen in a solution for
   * a robot the search is no longer about — the same shape as ADR-093, where the
   * design was written for one annotation and N were assumed to follow. Because
   * `1` and `N` agree at N=1, a single-robot fixture cannot tell the two apart;
   * `RobotStageSet.test.js` pins N=2 for that reason.
   *
   * Idempotent, so the caller may call it on every hover without diffing.
   *
   * @param {string|null} id  the robot whose arm shows the solution; `null`
   *   rests every arm (no candidate hovered/selected, or no search subject)
   * @param {{authority: 'solved'|'unverified', joints: readonly number[]}|null}
   *   preview  what the subject draws and on whose authority — the contract's
   *   solved configuration, or the client's unverified approximation of a
   *   candidate `core/` left `undeclared` (ADR-144 D4 widened this argument
   *   rather than adding a second entry point, so the number of writers is
   *   unchanged). `null` rests the subject too, rather than posing it into a
   *   configuration nobody produced.
   */
  previewSolution(id, preview) {
    // The rule (subject draws, everyone else rests) is pure and pinned at N=2 in
    // `domain/robotConfig.test.js`; this loop only performs the writes.
    for (const [stageId, payload] of previewAssignments(this._stages.keys(), id, preview)) {
      this._stages.get(stageId)?.previewSolution(payload)
    }
  }

  /**
   * Show / hide ONE robot's skeleton — driven by that robot's base-frame Outliner
   * eye (ADR-087's single visibility owner, now per robot).
   * @param {string} id
   * @param {boolean} visible
   */
  setVisible(id, visible) {
    this._stages.get(id)?.setVisible(visible)
  }

  /** @param {string} id @returns {boolean} */
  has(id) { return this._stages.has(id) }

  /** The style this scene DECLARES (原則 #4 — only `setRenderStyle` writes it). */
  get renderStyle() { return this._renderStyle }

  /**
   * What each live stage is actually HEADING FOR, keyed by robot id — read
   * back off the stages, not off the declaration.
   *
   * Exists because the defect ADR-148 closes was precisely "declared and drawn
   * disagree, and nothing prints either number". A snapshot of the intent
   * would have been green while the scene showed two different arms, so the
   * declaration and the measurement are kept as SEPARATE lanes (ADR-114).
   * @returns {Record<string, 'skeleton'|'realistic'>}
   */
  renderStyles() {
    /** @type {Record<string, 'skeleton'|'realistic'>} */
    const out = {}
    for (const [id, stage] of this._stages) out[id] = stage.settledRenderStyle
    return out
  }

  /**
   * Declare which geometry this scene draws (bundled skeleton ↔ Universal
   * Robots' own visual meshes) and apply it to every live stage.
   * `window.__easyExtrude.setRobotAppearance` is the console entry point;
   * ADR-141's "which arm" axis is untouched by this (see
   * `RobotStage.setRenderStyle`).
   *
   * The DECLARATION is written first and outlives the fan-out, so a robot
   * added later adopts it in `sync()` rather than booting into the default
   * (ADR-148 D2). Per-stage async supersession stays each `RobotStage`'s own
   * concern and is not duplicated here.
   *
   * FAILURE: rejects if any stage could not switch (原則 #11 — the caller is
   * told). When NO stage switched, the declaration is rolled back too: a scene
   * claiming a style that not one arm draws is the same "declared ≠ drawn"
   * defect in a different place. A partial failure keeps the declaration, so
   * the next stage created retries it.
   *
   * @param {'skeleton'|'realistic'} style
   * @returns {Promise<void>} REJECTS when at least one stage failed to switch,
   *   and also for a style outside the declared vocabulary (an `async` method
   *   surfaces `assertRenderStyle`'s throw as a rejection, not a synchronous
   *   one). An undeclared style rejects BEFORE the declaration is written, so
   *   a typo cannot become the scene's recorded style.
   */
  async setRenderStyle(style) {
    assertRenderStyle(style)   // no fall-through to the default (原則 #31)
    const previous = this._renderStyle
    this._renderStyle = style
    const results = await Promise.allSettled(
      [...this._stages.values()].map(stage => this._track(stage.setRenderStyle(style))))
    const failed = results.filter(r => r.status === 'rejected')
    if (failed.length === 0) return
    if (failed.length === results.length) this._renderStyle = previous
    throw failed[0].reason
  }

  /**
   * World-space bounding-box size of every live skeleton, keyed by robot id
   * (ADR-137 scale-parity guard — see `RobotStage.worldSpan`). Skeletons whose
   * URDF has not resolved yet report `null` rather than being omitted: a
   * missing key and an unloaded arm are different facts (原則 #31).
   * @returns {Record<string, {x:number,y:number,z:number}|null>}
   */
  worldSpans() {
    /** @type {Record<string, {x:number,y:number,z:number}|null>} */
    const out = {}
    for (const [id, stage] of this._stages) out[id] = stage.worldSpan()
    return out
  }

  /**
   * What every live skeleton is drawing right now, keyed by robot id (ADR-144).
   * Read-only observation surface for the browser lane — see
   * `RobotStage.previewState`. Stages whose URDF has not resolved report `null`
   * rather than being omitted: a missing key and an unloaded arm are different
   * facts (原則 #31), the same rule `worldSpans()` follows.
   * @returns {Record<string, {unverified: boolean, joints: Record<string, number>}|null>}
   */
  previewStates() {
    /** @type {Record<string, object|null>} */
    const out = {}
    for (const [id, stage] of this._stages) out[id] = stage.previewState()
    return out
  }

  /**
   * Whether one robot's skeleton is currently drawn; null when it has no stage.
   * Read-only — the visibility OWNER is the base frame's Outliner eye (ADR-087);
   * this exists so tests and the console can observe what was actually applied.
   * @param {string} id
   * @returns {boolean|null}
   */
  isVisible(id) {
    const stage = this._stages.get(id)
    return stage ? stage.visible : null
  }

  /**
   * Nearest skeleton hit across all robots, with the id of the robot it belongs
   * to — so a click on an arm selects THAT arm's base frame, not whichever robot
   * the scene happens to list first (the bug a single shared stage could not even
   * express).
   * @param {import('three').Raycaster} raycaster  already aimed from the pointer
   * @returns {{ id: string, hit: import('three').Intersection }|null}
   */
  raycast(raycaster) {
    let best = null
    for (const [id, stage] of this._stages) {
      const hit = stage.raycast(raycaster)
      if (!hit) continue
      if (!best || hit.distance < best.hit.distance) best = { id, hit }
    }
    return best
  }

  /**
   * What the viewer SEES on each arm, keyed by robot id (`null` = hidden while
   * its first look loads). See `RobotStage.shownStyle` (ADR-150).
   * @returns {Record<string, 'skeleton'|'realistic'|null>}
   */
  shownStyles() {
    const out = {}
    for (const [id, stage] of this._stages) out[id] = stage.shownStyle
    return out
  }

  /** Ids whose arm is still hidden waiting for its first look (ADR-150; e2e observation surface). */
  awaitingFirstLook() {
    return [...this._stages].filter(([, stage]) => stage.awaitingFirstLook).map(([id]) => id)
  }

  /** Symmetric teardown of every stage created by sync() (原則 #9). */
  dispose() {
    this._listeners.clear()
    for (const stage of this._stages.values()) stage.dispose()
    this._stages.clear()
  }
}
