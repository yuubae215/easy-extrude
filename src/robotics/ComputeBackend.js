/**
 * ComputeBackend — the dual-target compute seam for robotics measurement jobs
 * (ADR-053 §3).
 *
 * A `ComputeBackend` runs an idempotent job value object and returns a result
 * value object. The single interface lets the caller (`RoboticsService`) stay
 * oblivious to *where* the heavy compute happens:
 *
 *   caller ── backend.run(job) ──▶ { backend: 'local' | 'server' }
 *                                   ├─ local  → (this module) pure-JS / Worker → WASM
 *                                   └─ server → fetch(BFF /compute) → worker_threads → WASM
 *
 * Phase 2 ships only `LocalComputeBackend`, the "初期形" §3 blesses: a pure-JS
 * synchronous kernel (FK-sampling reach + AABB collision) wrapped in the async
 * `run` contract so it is swap-compatible with the future Worker/WASM and BFF
 * backends. `ServerComputeBackend` (BFF `/compute`) and the KDL/ruckig-WASM and
 * three-mesh-bvh kernels swap in behind this same `run(job)` seam later
 * (ADR-053 §4/§11, deferred); the caller never changes.
 *
 * Job shapes (idempotent value objects — cacheable on a hash of the job):
 *   { kind: 'reach',     chain, targets, options? }
 *   { kind: 'collision', links, obstacles?, scope?, ignore? }
 *
 * @module robotics/ComputeBackend
 */

import { reachTargets } from './Kinematics.js'
import { bakeContacts } from './Collision.js'

/** Thrown for an unrecognised job kind. */
export class UnknownJob extends Error {
  constructor(kind) {
    super(`ComputeBackend: unknown job kind "${kind}"`)
    this.name = 'UnknownJob'
  }
}

/**
 * @typedef {object} ComputeBackend
 * @property {(job: object) => Promise<object>} run — execute a job, resolve a result.
 */

/**
 * Local backend — runs the pure-JS measurement kernels in-process. Async by
 * contract (so it is interchangeable with Worker/BFF backends) even though the
 * kernels are synchronous in Phase 2.
 *
 * @implements {ComputeBackend}
 */
export class LocalComputeBackend {
  /**
   * @param {object} job — see module doc for per-kind shape
   * @returns {Promise<object>} result value object tagged `backend:'local'`
   */
  async run(job) {
    if (!job || typeof job !== 'object') throw new UnknownJob(String(job))
    switch (job.kind) {
      case 'reach':
        return {
          backend: 'local',
          kind: 'reach',
          targets: reachTargets(job.chain, job.targets, job.options),
        }
      case 'collision':
        return {
          backend: 'local',
          kind: 'collision',
          contacts: bakeContacts(job),
        }
      default:
        throw new UnknownJob(job.kind)
    }
  }
}
