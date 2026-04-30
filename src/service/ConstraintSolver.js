// @ts-nocheck — Wasm TypedArray variance not yet annotated.
/**
 * ConstraintSolver — main-thread Wasm singleton for per-frame constraint math (ADR-027)
 *
 * Unlike GeometryEngine (which offloads to a Web Worker), ConstraintSolver loads
 * the Wasm module directly on the main thread so that constraint math can be called
 * synchronously inside the animation loop without await.
 *
 * The two Wasm instances (Worker + main thread) each have independent linear memory
 * and static buffers — no sharing, no races.
 *
 * Public API:
 *
 *   await constraintSolver.init()
 *
 *   // Solve N fastened constraints in one shot
 *   const poses = constraintSolver.solveFastenedConstraints(inputFlat)
 *   // poses: Float32Array of N×7 [worldX,worldY,worldZ, worldQx,worldQy,worldQz,worldQw]
 *
 *   // Transform N local-space points by one pose
 *   const worldPts = constraintSolver.applyPoseToPoints(inputFlat)
 *   // worldPts: Float32Array of N×3 [wx,wy,wz]
 *
 * Input formats:
 *   solveFastenedConstraints — N × 14 f32 per constraint:
 *     [relOffX, relOffY, relOffZ,
 *      relQx, relQy, relQz, relQw,
 *      targetX, targetY, targetZ,
 *      targetQx, targetQy, targetQz, targetQw]
 *
 *   applyPoseToPoints — 7 + 3*N f32:
 *     [px, py, pz, qx, qy, qz, qw,  lx0, ly0, lz0, ...]
 */

import wasmUrl from '../engine/wasm/wasm_engine_bg.wasm?url'
import initWasm, {
  solve_fastened_constraints,
  apply_pose_to_points,
  get_constraints_ptr,
  get_constraints_len,
  get_transform_ptr,
  get_transform_len,
  wasm_memory,
} from '../engine/wasm/wasm_engine.js'

// ---------------------------------------------------------------------------
// ConstraintSolver class
// ---------------------------------------------------------------------------

export class ConstraintSolver {
  constructor() {
    /** @type {boolean} */
    this._ready = false
    /** @type {boolean} */
    this._usingFallback = false
    /** @type {Promise<void>|null} */
    this._initPromise = null
  }

  /**
   * Load and initialise the Wasm module on the main thread.
   * Safe to call multiple times — subsequent calls return the same Promise.
   *
   * @returns {Promise<void>}
   */
  init() {
    if (this._initPromise) return this._initPromise

    this._initPromise = initWasm(wasmUrl)
      .then(() => {
        this._ready = true
      })
      .catch((err) => {
        console.warn('[ConstraintSolver] Wasm unavailable, using JS fallback:', err)
        this._usingFallback = true
        this._ready = true
      })

    return this._initPromise
  }

  // ---------------------------------------------------------------------------
  // Public API — synchronous, safe to call inside requestAnimationFrame
  // ---------------------------------------------------------------------------

  /**
   * Solve world poses for N fastened CoordinateFrame constraints.
   *
   * @param {Float32Array} inputFlat  N × 14 f32 per constraint
   * @returns {Float32Array} N × 7 f32: [worldX, worldY, worldZ, worldQx, worldQy, worldQz, worldQw]
   */
  solveFastenedConstraints(inputFlat) {
    if (this._usingFallback || !this._ready) {
      return this._solveFastenedFallback(inputFlat)
    }

    const n = solve_fastened_constraints(inputFlat)
    if (!n) return new Float32Array(0)

    const mem = wasm_memory()
    const ptr = get_constraints_ptr()
    const len = get_constraints_len()
    // Slice copies the data out of Wasm memory before the next Wasm call overwrites it.
    return new Float32Array(mem.buffer, ptr, len).slice()
  }

  /**
   * Apply one rigid-body pose to N local-space points.
   *
   * @param {Float32Array} inputFlat  7 + 3*N f32: [px,py,pz, qx,qy,qz,qw, lx0,ly0,lz0, ...]
   * @returns {Float32Array} N × 3 f32 world-space points
   */
  applyPoseToPoints(inputFlat) {
    if (this._usingFallback || !this._ready) {
      return this._applyPoseFallback(inputFlat)
    }

    const n = apply_pose_to_points(inputFlat)
    if (!n) return new Float32Array(0)

    const mem = wasm_memory()
    const ptr = get_transform_ptr()
    const len = get_transform_len()
    return new Float32Array(mem.buffer, ptr, len).slice()
  }

  // ---------------------------------------------------------------------------
  // Pure-JS fallback (mirrors exact Rust logic — keeps output identical)
  // ---------------------------------------------------------------------------

  /**
   * @param {Float32Array} inputFlat
   * @returns {Float32Array}
   */
  _solveFastenedFallback(inputFlat) {
    const n = (inputFlat.length / 14) | 0
    const out = new Float32Array(n * 7)
    for (let i = 0; i < n; i++) {
      const b = i * 14
      const rox = inputFlat[b],     roy = inputFlat[b + 1], roz = inputFlat[b + 2]
      const rqx = inputFlat[b + 3], rqy = inputFlat[b + 4], rqz = inputFlat[b + 5], rqw = inputFlat[b + 6]
      const tpx = inputFlat[b + 7], tpy = inputFlat[b + 8], tpz = inputFlat[b + 9]
      const tqx = inputFlat[b + 10], tqy = inputFlat[b + 11], tqz = inputFlat[b + 12], tqw = inputFlat[b + 13]

      // worldPos = applyQuat(relativeOffset, targetQuat) + targetPos
      const tx = 2 * (tqy * roz - tqz * roy)
      const ty = 2 * (tqz * rox - tqx * roz)
      const tz = 2 * (tqx * roy - tqy * rox)
      const wpx = rox + tqw * tx + tqy * tz - tqz * ty + tpx
      const wpy = roy + tqw * ty + tqz * tx - tqx * tz + tpy
      const wpz = roz + tqw * tz + tqx * ty - tqy * tx + tpz

      // worldQuat = targetQuat × relativeQuat  (Hamilton product)
      const wqx = tqw * rqx + tqx * rqw + tqy * rqz - tqz * rqy
      const wqy = tqw * rqy - tqx * rqz + tqy * rqw + tqz * rqx
      const wqz = tqw * rqz + tqx * rqy - tqy * rqx + tqz * rqw
      const wqw = tqw * rqw - tqx * rqx - tqy * rqy - tqz * rqz

      const o = i * 7
      out[o] = wpx; out[o + 1] = wpy; out[o + 2] = wpz
      out[o + 3] = wqx; out[o + 4] = wqy; out[o + 5] = wqz; out[o + 6] = wqw
    }
    return out
  }

  /**
   * @param {Float32Array} inputFlat
   * @returns {Float32Array}
   */
  _applyPoseFallback(inputFlat) {
    const px = inputFlat[0], py = inputFlat[1], pz = inputFlat[2]
    const qx = inputFlat[3], qy = inputFlat[4], qz = inputFlat[5], qw = inputFlat[6]
    const n = ((inputFlat.length - 7) / 3) | 0
    const out = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const lx = inputFlat[7 + i * 3], ly = inputFlat[8 + i * 3], lz = inputFlat[9 + i * 3]
      const tx = 2 * (qy * lz - qz * ly)
      const ty = 2 * (qz * lx - qx * lz)
      const tz = 2 * (qx * ly - qy * lx)
      out[i * 3]     = lx + qw * tx + qy * tz - qz * ty + px
      out[i * 3 + 1] = ly + qw * ty + qz * tx - qx * tz + py
      out[i * 3 + 2] = lz + qw * tz + qx * ty - qy * tx + pz
    }
    return out
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** True if the Wasm module is active and ready. */
  get isWasmActive() {
    return this._ready && !this._usingFallback
  }
}

// ---------------------------------------------------------------------------
// Singleton — one solver per application
// ---------------------------------------------------------------------------

export const constraintSolver = new ConstraintSolver()
