// @ts-nocheck
/**
 * RoboticsService — the measurement instrument's side-effect coordinator
 * (ADR-053 §2 / Phase 2).
 *
 * This is the receptacle the Phase-1 predicate layer was built to feed: it runs
 * a robotics compute job through an injected `ComputeBackend`, then folds the
 * measured operands into a **new** Context DSL document so the formal verifier
 * (`validateContext` / `PredicateEngine`) can collapse them to a boolean. It is
 * the only point where the measurement instrument touches the canonical doc.
 *
 * Boundary (ADR-053 §2, PHILOSOPHY #3): a side-effect coordinator with **no pure
 * logic** of its own. The heavy geometry is delegated to the pure robotics kernels
 * via the backend (`src/robotics/*`, THREE-free); doc surgery is immutable
 * structural plumbing (the same category as `ContextService._withDecisionStatus`).
 * The backend is *injected* (not imported) so unit tests run THREE-free with a
 * fake backend. Every measurement yields a **new document** (input-immutable —
 * PHILOSOPHY #6); the input doc is never mutated.
 *
 * Non-goals (ADR-053 §9.4/§11, deferred): producing `targets[].reachable` /
 * `contacts[].clearance` from a real KDL/BVH instrument (here the LocalComputeBackend
 * approximates with FK sampling + AABB), the RobotPoseGhost / CollisionHighlight
 * views, pending/computing UX, and the BFF `/compute` endpoint.
 *
 * Emits (ADR-013 lineage, PHILOSOPHY #5): `measured` — `{ ref, kind, result }`.
 *
 * @module service/RoboticsService
 */
import { EventEmitter } from '../core/EventEmitter.js'

export class RoboticsService extends EventEmitter {
  /**
   * @param {import('../robotics/ComputeBackend.js').ComputeBackend} backend —
   *   runs the compute jobs. Injected so tests can supply a fake.
   */
  constructor(backend) {
    super()
    if (!backend || typeof backend.run !== 'function') {
      throw new Error('RoboticsService requires a ComputeBackend with a run(job) method')
    }
    this._backend = backend
  }

  /**
   * Measure reachability of an acceptance check's taught targets and bake the
   * `{ ref, reachable, margin }` operands into its `robot_reach` predicate.
   *
   * @param {object} doc — the canonical document (never mutated)
   * @param {object} args
   * @param {string} args.acceptanceRef — the acceptance check carrying a robot_reach predicate
   * @param {object} args.chain — kinematic chain (see Kinematics.js)
   * @param {Array<object>} args.targets — taught TCP targets `{ ref, x, y, z }`
   * @param {object} [args.options] — `{ samples, tolerance }`
   * @returns {Promise<object>} a new document with the measured operands baked in
   */
  async measureReach(doc, { acceptanceRef, chain, targets, options }) {
    const result = await this._backend.run({ kind: 'reach', chain, targets, options })
    const newDoc = this._patchPredicate(doc, acceptanceRef, 'robot_reach', { targets: result.targets })
    this.emit('measured', { ref: acceptanceRef, kind: 'reach', result })
    return newDoc
  }

  /**
   * Measure interference for an acceptance check and bake the
   * `{ a, b, clearance }` contacts into its `collision_free` predicate.
   *
   * @param {object} doc — the canonical document (never mutated)
   * @param {object} args
   * @param {string} args.acceptanceRef — the acceptance check carrying a collision_free predicate
   * @param {'self'|'env'} [args.scope='self']
   * @param {Array<object>} args.links — `{ ref, box }` (robot links)
   * @param {Array<object>} [args.obstacles] — `{ ref, box }` (scope 'env')
   * @param {Array<[string,string]>} [args.ignore] — link pairs to skip
   * @returns {Promise<object>} a new document with the measured contacts baked in
   */
  async measureCollision(doc, { acceptanceRef, scope = 'self', links, obstacles, ignore }) {
    const result = await this._backend.run({ kind: 'collision', scope, links, obstacles, ignore })
    const newDoc = this._patchPredicate(doc, acceptanceRef, 'collision_free', { contacts: result.contacts })
    this.emit('measured', { ref: acceptanceRef, kind: 'collision', result })
    return newDoc
  }

  /**
   * Record a scalar measured value on a Fact (`status:'measured'`) — the
   * `numericFact` receptacle for KPI terms like `cycleTime` / `reachMargin`
   * (ADR-053 §2). A `measured` Fact does NOT block a dependent acceptance check
   * (only `assumed`/`unknown` do — ADR-046 invariant 3), so the term resolves and
   * its criterion can be evaluated. Input-immutable.
   *
   * @param {object} doc
   * @param {object} args
   * @param {string} args.factRef
   * @param {object} args.attrs — e.g. `{ cycleTime: { value: 8.2, unit: 's' } }`
   * @returns {object} a new document
   */
  applyMeasuredFact(doc, { factRef, attrs }) {
    const given = doc?.given
    if (!Array.isArray(given) || !given.some(f => f.ref === factRef)) {
      throw new Error(`RoboticsService.applyMeasuredFact: no given fact "${factRef}"`)
    }
    return {
      ...doc,
      given: given.map(f =>
        f.ref === factRef
          ? { ...f, status: 'measured', attrs: { ...f.attrs, ...attrs } }
          : f),
    }
  }

  // ── immutable doc surgery (PHILOSOPHY #6) ──────────────────────────────────

  /**
   * Return a new doc whose acceptance check `ref` has `patch` merged into its
   * predicate. Throws if the check is missing or its predicate kind mismatches
   * (a silent no-op would lose the measurement — PHILOSOPHY #11).
   */
  _patchPredicate(doc, ref, expectedKind, patch) {
    const acceptance = doc?.acceptance
    if (!Array.isArray(acceptance)) {
      throw new Error('RoboticsService: document has no acceptance array')
    }
    const check = acceptance.find(c => c.ref === ref)
    if (!check) {
      throw new Error(`RoboticsService: no acceptance check "${ref}"`)
    }
    if (check.predicate?.kind !== expectedKind) {
      throw new Error(`RoboticsService: acceptance "${ref}" is not a ${expectedKind} predicate`)
    }
    return {
      ...doc,
      acceptance: acceptance.map(c =>
        c.ref === ref
          ? { ...c, predicate: { ...c.predicate, ...patch } }
          : c),
    }
  }
}
