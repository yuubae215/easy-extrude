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
import { buildGeometry } from '../model/CuboidModel.js'

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

      const settle = (err) => {
        if (settled) return
        settled = true
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
        const timeout = setTimeout(() => {
          settle(new Error('Worker init timeout'))
        }, 10_000)

        // When settled (either way), cancel the timeout.
        this._initPromise.then(() => clearTimeout(timeout))

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
   * If the Wasm worker is available, computation runs off the main thread and
   * the result is transferred (zero-copy) back.
   *
   * If the worker is unavailable, falls back to the synchronous JS implementation
   * in CuboidModel.buildGeometry() and extracts the typed arrays.
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
