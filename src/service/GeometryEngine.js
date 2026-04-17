// @ts-nocheck — Wasm worker TypedArray variance and ?worker import not yet annotated.
/**
 * GeometryEngine — main-thread facade for the Wasm geometry worker (ADR-027)
 *
 * Provides a Promise-based API that hides the Worker + Wasm details from the
 * rest of the application.  Falls back to the pure-JS implementation in
 * CuboidModel.js if the Worker fails to initialise.
 *
 * Usage (one-time setup in main.js or AppController constructor):
 *
 *   import { geometryEngine } from './service/GeometryEngine.js'
 *   await geometryEngine.init()           // starts worker, loads Wasm
 *
 * Usage (geometry computation — returns typed arrays ready for BufferGeometry):
 *
 *   const { positions, normals, indices } = await geometryEngine.computeCuboid(corners)
 *   const geo = new THREE.BufferGeometry()
 *   geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
 *   geo.setAttribute('normal',   new THREE.BufferAttribute(normals, 3))
 *   geo.setIndex(new THREE.BufferAttribute(indices, 1))
 *
 * Architecture guarantees (ADR-027):
 *   - Computation never blocks the main thread — it runs in the Worker.
 *   - Data crosses the thread boundary via ArrayBuffer transfer (zero-copy).
 *   - If Wasm is unavailable, fallback to synchronous JS implementation.
 */

import * as THREE from 'three'
import { buildGeometry, buildCuboidFromRect } from '../model/CuboidModel.js'

// ---------------------------------------------------------------------------
// Worker import — `?worker` tells Vite to bundle the worker and all its
// imports (including the .wasm binary) into separate dist chunks.
// This is the canonical Vite pattern for Web Workers; it handles the WASM
// binary asset emission that plain `new Worker(new URL(...))` misses.
// ---------------------------------------------------------------------------
import GeometryWorker from '../workers/geometry.worker.js?worker'

// ---------------------------------------------------------------------------
// GeometryEngine class
// ---------------------------------------------------------------------------

export class GeometryEngine {
  constructor() {
    /** @type {Worker|null} */
    this._worker = null
    /** @type {Map<number, { resolve: Function, reject: Function }>} */
    this._pending = new Map()
    /** @type {number} */
    this._nextId = 0
    /** @type {boolean} */
    this._ready = false
    /** @type {boolean} */
    this._usingFallback = false
    /** @type {Promise<void>|null} */
    this._initPromise = null
  }

  /**
   * Start the Web Worker and load the Wasm module.
   * Safe to call multiple times — subsequent calls return the same Promise.
   *
   * @returns {Promise<void>}
   */
  init() {
    if (this._initPromise) return this._initPromise

    this._initPromise = new Promise((resolve) => {
      let settled = false
      let timeout

      const settle = (err) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (err) {
          console.warn('[GeometryEngine] Wasm worker unavailable, using JS fallback:', err)
          this._usingFallback = true
          this._ready = true
        }
        resolve()
      }

      try {
        this._worker = new GeometryWorker()

        this._worker.addEventListener('message', (e) => {
          const { type, id, ...data } = e.data

          if (type === 'ready') {
            this._ready = true
            settle(null)
            return
          }

          if (type === 'error' && id === null) {
            // Init-level error from the worker
            settle(new Error(data.message))
            return
          }

          const pending = this._pending.get(id)
          if (!pending) return
          this._pending.delete(id)

          if (type === 'result') {
            pending.resolve(data)
          } else if (type === 'error') {
            pending.reject(new Error(data.message))
          }
        })

        this._worker.addEventListener('error', (e) => {
          settle(new Error(e.message || 'Worker load error'))
        })

        // Timeout: if the worker does not become ready within 10 s, fall back.
        timeout = setTimeout(() => {
          settle(new Error('Worker init timeout'))
        }, 10_000)

        this._worker.postMessage({ type: 'init' })
      } catch (err) {
        settle(err)
      }
    })

    return this._initPromise
  }

  /**
   * Compute BufferGeometry data for a cuboid defined by 8 THREE.Vector3 corners.
   *
   * @param {THREE.Vector3[]} corners — length-8 array matching createInitialCorners() order
   * @returns {Promise<{ positions: Float32Array, normals: Float32Array, indices: Uint32Array }>}
   */
  computeCuboid(corners) {
    if (!this._ready) {
      return Promise.reject(new Error('GeometryEngine.init() has not completed'))
    }

    if (this._usingFallback || !this._worker) {
      return this._computeCuboidFallback(corners)
    }

    return this._computeCuboidWasm(corners)
  }

  /**
   * Compute BufferGeometry data for a prism extruded from a 2D polygon profile.
   *
   * Accepts either:
   *   - An array of {x, y} objects (or THREE.Vector2 / THREE.Vector3 with x,y used)
   *   - A Float32Array of 2*n values [x0, y0, x1, y1, ...]
   *
   * Falls back to `buildCuboidFromRect` + `buildGeometry` when n === 4 and the
   * worker is unavailable (rectangular profile only).
   *
   * @param {Array<{x: number, y: number}>|Float32Array} vertices2d  n ≥ 3 profile vertices
   * @param {number} height  signed extrusion height in world Z units
   * @returns {Promise<{ positions: Float32Array, normals: Float32Array, indices: Uint32Array }>}
   */
  computeExtrudedProfile(vertices2d, height) {
    if (!this._ready) {
      return Promise.reject(new Error('GeometryEngine.init() has not completed'))
    }

    const profile = vertices2d instanceof Float32Array
      ? vertices2d
      : (() => {
          const flat = new Float32Array(vertices2d.length * 2)
          vertices2d.forEach((v, i) => { flat[i * 2] = v.x; flat[i * 2 + 1] = v.y })
          return flat
        })()

    if (this._usingFallback || !this._worker) {
      return this._computeExtrudedProfileFallback(profile, height)
    }

    return new Promise((resolve, reject) => {
      const id = this._nextId++
      this._pending.set(id, { resolve, reject })
      this._worker.postMessage(
        { type: 'compute_extruded_profile', id, payload: { profile, height } },
        [profile.buffer],
      )
    })
  }

  /**
   * Compute n column-major 4×4 instance matrices from compact TRS transforms.
   *
   * Each transform is 10 floats: [px, py, pz, qx, qy, qz, qw, sx, sy, sz].
   * The returned `matrices` Float32Array has n × 16 values matching the layout
   * of `THREE.Matrix4.compose()` / `THREE.InstancedMesh.instanceMatrix`.
   *
   * @param {Float32Array} transforms  n × 10 f32 values
   * @returns {Promise<{ matrices: Float32Array }>}
   */
  computeInstanceMatrices(transforms) {
    if (!this._ready) {
      return Promise.reject(new Error('GeometryEngine.init() has not completed'))
    }

    if (this._usingFallback || !this._worker) {
      return this._computeInstanceMatricesFallback(transforms)
    }

    return new Promise((resolve, reject) => {
      const id = this._nextId++
      this._pending.set(id, { resolve, reject })
      this._worker.postMessage(
        { type: 'compute_instance_matrices', id, payload: { transforms } },
        [transforms.buffer],
      )
    })
  }

  // ---------------------------------------------------------------------------
  // Private — Wasm path
  // ---------------------------------------------------------------------------

  _computeCuboidWasm(corners) {
    const flat = new Float32Array(24)
    corners.forEach((v, i) => {
      flat[i * 3]     = v.x
      flat[i * 3 + 1] = v.y
      flat[i * 3 + 2] = v.z
    })

    return new Promise((resolve, reject) => {
      const id = this._nextId++
      this._pending.set(id, { resolve, reject })

      // Transfer the input Float32Array to avoid a copy on the way in as well.
      this._worker.postMessage(
        { type: 'compute_cuboid', id, payload: { corners: flat } },
        [flat.buffer],
      )
    })
  }

  // ---------------------------------------------------------------------------
  // Private — Pure-JS fallback path
  // ---------------------------------------------------------------------------

  _computeCuboidFallback(corners) {
    try {
      const geo = buildGeometry(corners)

      // Extract the typed arrays that THREE.BufferGeometry already holds.
      const positions = geo.getAttribute('position').array
      const normals   = geo.getAttribute('normal').array
      const rawIndex  = geo.index.array
      const indices   = rawIndex instanceof Uint32Array
        ? rawIndex
        : new Uint32Array(rawIndex)

      return Promise.resolve({ positions, normals, indices })
    } catch (err) {
      return Promise.reject(err)
    }
  }

  /**
   * Fallback for computeExtrudedProfile when Wasm is unavailable.
   * Handles rectangular profiles only (n === 4); rejects for other shapes.
   * @param {Float32Array} profile
   * @param {number} height
   */
  _computeExtrudedProfileFallback(profile, height) {
    try {
      const n = profile.length / 2
      if (n !== 4) {
        return Promise.reject(new Error(
          'GeometryEngine fallback only supports rectangular profiles (n=4); Wasm required for n≠4',
        ))
      }
      // Reconstruct p1/p2 from the profile flat array.
      const p1 = new THREE.Vector3(profile[0], profile[1], 0)
      const p2 = new THREE.Vector3(profile[4], profile[5], 0)
      const corners = buildCuboidFromRect(p1, p2, height)
      return this._computeCuboidFallback(corners)
    } catch (err) {
      return Promise.reject(err)
    }
  }

  /**
   * Fallback for computeInstanceMatrices when Wasm is unavailable.
   * Computes matrices on the main thread via Three.js Matrix4.compose().
   * @param {Float32Array} transforms  n × 10 f32 values
   */
  _computeInstanceMatricesFallback(transforms) {
    try {
      const n = transforms.length / 10
      if (transforms.length % 10 !== 0 || n < 1) {
        return Promise.reject(new Error('computeInstanceMatrices: transforms must be a multiple of 10'))
      }
      const matrices = new Float32Array(n * 16)
      const pos  = new THREE.Vector3()
      const quat = new THREE.Quaternion()
      const scl  = new THREE.Vector3()
      const mat  = new THREE.Matrix4()

      for (let i = 0; i < n; i++) {
        const b = i * 10
        pos.set(transforms[b],     transforms[b + 1], transforms[b + 2])
        quat.set(transforms[b + 3], transforms[b + 4], transforms[b + 5], transforms[b + 6])
        scl.set(transforms[b + 7], transforms[b + 8], transforms[b + 9])
        mat.compose(pos, quat, scl)
        matrices.set(mat.elements, i * 16)
      }
      return Promise.resolve({ matrices })
    } catch (err) {
      return Promise.reject(err)
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Terminate the background worker.
   * After calling this, init() must be called again before computeCuboid().
   */
  terminate() {
    this._worker?.terminate()
    this._worker    = null
    this._ready     = false
    this._initPromise = null
    this._pending.forEach(({ reject }) => reject(new Error('GeometryEngine terminated')))
    this._pending.clear()
  }

  /** True if the Wasm worker is active and ready. */
  get isWasmActive() {
    return this._ready && !this._usingFallback
  }
}

// ---------------------------------------------------------------------------
// Singleton — one engine per application
// ---------------------------------------------------------------------------

export const geometryEngine = new GeometryEngine()
