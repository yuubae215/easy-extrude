// @ts-nocheck
import { RobotStage } from './RobotStage.js'

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
