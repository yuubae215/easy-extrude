// @ts-nocheck
import { RobotStage } from './RobotStage.js'
import { previewAssignments } from '../domain/robotConfig.js'

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
      this._stages.set(id, new RobotStage(this._scene))
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

  /**
   * Swaps drawn geometry (bundled skeleton ↔ Universal Robots' own visual
   * meshes) on EVERY live stage — a console/debug-level convenience
   * (`window.__easyExtrude.setRobotAppearance`, ADR-141's "which arm" axis is
   * untouched by this; see `RobotStage.setRenderStyle`). Per-stage async
   * supersession is each `RobotStage`'s own concern, not duplicated here.
   * @param {'skeleton'|'realistic'} style
   * @returns {Promise<void>}
   */
  async setRenderStyle(style) {
    await Promise.all([...this._stages.values()].map(stage => stage.setRenderStyle(style)))
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

  /** Symmetric teardown of every stage created by sync() (原則 #9). */
  dispose() {
    for (const stage of this._stages.values()) stage.dispose()
    this._stages.clear()
  }
}
