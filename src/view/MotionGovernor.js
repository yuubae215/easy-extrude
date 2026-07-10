// @ts-check
import { prefersReducedMotion } from '../theme/motion.js'

/**
 * MotionGovernor — the single owner of transient 3D effects in the animation
 * loop (ADR-065 Phase 1; named rule 2).
 *
 * Extends the ADR-064 Phase 4 reduced-motion boundary into the 3D tick loop:
 * every transient effect (RippleEffect lineage: constructor adds to scene,
 * `tick(t) → done`, `dispose()`) is spawned THROUGH the governor, which
 *   1. reads the reduced-motion preference from the ONE boundary
 *      (`src/theme/motion.js`) and hands it to the effect factory — under
 *      reduced motion the effect renders its terminal/static cue instead of
 *      animating (information preserved, movement dropped — PHILOSOPHY #11/#29;
 *      never a silent skip),
 *   2. enforces the transient budget: beyond `BUDGET` concurrent effects the
 *      oldest is evicted WITH `dispose()` (PHILOSOPHY #9 — the worst case,
 *      undo/redo mashing, is absorbed here, not at call sites),
 *   3. ticks and prunes finished effects each frame (`done → dispose`).
 *
 * Persistent animated views (GraspGhostView, UncertaintyGhostView, authoring
 * widgets) keep their existing owners — the governor owns only *transients*,
 * whose lifetime nobody else tracks.
 *
 * THREE-free: effects are opaque `{tick, dispose}` objects, so this class is
 * unit-tested in the bare `node --test` lane with fake effects.
 */
export class MotionGovernor {
  /** Maximum concurrent transient effects before oldest-first eviction. */
  static BUDGET = 8

  /**
   * @param {{reduced?: () => boolean}} [deps] injectable preference read
   *   (defaults to the single boundary; injected in tests)
   */
  constructor({ reduced = prefersReducedMotion } = {}) {
    this._reduced = reduced
    /** @type {Array<{tick(t: number): boolean, dispose(): void}>} */
    this._effects = []
  }

  /**
   * Spawn a transient effect. The factory receives the current reduced-motion
   * preference (read per spawn, so a mid-session OS toggle affects the next
   * effect without a subscription).
   * @template {{tick(t: number): boolean, dispose(): void}} E
   * @param {(reduced: boolean) => E} make
   * @returns {E}
   */
  spawn(make) {
    const fx = make(this._reduced())
    this._effects.push(fx)
    while (this._effects.length > MotionGovernor.BUDGET) {
      this._effects.shift()?.dispose()
    }
    return fx
  }

  /**
   * Advance all transient effects; dispose and drop the finished ones.
   * Called once per frame from `AppController._animate`.
   * @param {number} t seconds (performance.now() / 1000 — the loop clock)
   */
  tick(t) {
    if (this._effects.length === 0) return
    this._effects = this._effects.filter(fx => {
      const done = fx.tick(t)
      if (done) fx.dispose()
      return !done
    })
  }

  /** Number of live transient effects (budget/test observability). */
  get count() { return this._effects.length }

  /** Dispose every live effect (scene teardown — #9 symmetry). */
  disposeAll() {
    for (const fx of this._effects) fx.dispose()
    this._effects = []
  }
}
