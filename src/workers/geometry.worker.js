/**
 * geometry.worker.js — Web Worker bridge for the Wasm geometry engine
 *
 * Architecture (ADR-027):
 *   Main thread → postMessage(cmd) → [this Worker] → Wasm compute → postMessage(result)
 *
 * Zero-copy path within the worker:
 *   1. Rust writes geometry into static Vecs in Wasm linear memory.
 *   2. `wasm_memory()` returns the WebAssembly.Memory object.
 *   3. JS creates a Float32Array *view* over the Wasm heap (no copy).
 *   4. `.slice()` copies once from Wasm memory into a transferable ArrayBuffer.
 *   5. postMessage transferList transfers that buffer to the main thread (zero-copy).
 *
 * Build target: `--target web` (see package.json build:wasm script).
 * Vite detects `new URL('wasm_engine_bg.wasm', import.meta.url)` inside
 * wasm_engine.js and emits the .wasm binary as a hashed asset in dist/.
 *
 * Note on SharedArrayBuffer upgrade:
 *   If the server sets COOP/COEP headers, the WebAssembly.Memory can be
 *   declared shared, enabling true zero-copy across threads (no step 4).
 *   See ADR-027 §Future Work.
 *
 * Message protocol:
 *   IN  { type: 'init' }
 *   OUT { type: 'ready' }
 *
 *   IN  { type: 'compute_cuboid', id: number, payload: { corners: Float32Array } }
 *   OUT { type: 'result',  id, positions: Float32Array, normals: Float32Array, indices: Uint32Array }
 *   OUT { type: 'error',   id, message: string }
 *
 *   IN  { type: 'compute_extruded_profile', id, payload: { profile: Float32Array, height: number } }
 *   OUT { type: 'result',  id, positions, normals, indices }
 *
 *   IN  { type: 'compute_instance_matrices', id, payload: { transforms: Float32Array } }
 *   OUT { type: 'result',  id, matrices: Float32Array }
 */

// `--target web` exports an async `init(url?)` default plus named function exports.
// The `?url` import below makes Vite emit the .wasm binary as a hashed asset in
// dist/ and gives us the correct runtime URL to pass to init().
// Without this explicit import, Vite does not emit the binary from within a worker chunk.
import wasmUrl from '../engine/wasm/wasm_engine_bg.wasm?url'
import initWasm, {
  build_cuboid_geometry,
  build_extruded_profile,
  build_instance_matrices,
  get_positions_ptr,
  get_positions_len,
  get_normals_ptr,
  get_normals_len,
  get_indices_ptr,
  get_indices_len,
  get_matrices_ptr,
  get_matrices_len,
  wasm_memory,
} from '../engine/wasm/wasm_engine.js'

let ready = false

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

async function initEngine() {
  // Pass the Vite-resolved URL so init() can fetch the binary both in dev
  // (served from src/engine/wasm/) and in production (from dist/assets/).
  await initWasm(wasmUrl)
  ready = true
}

// ---------------------------------------------------------------------------
// Geometry computations
// ---------------------------------------------------------------------------

/**
 * Compute BufferGeometry arrays for a cuboid.
 *
 * @param {Float32Array} corners — 24 f32 values (8 corners × xyz)
 * @returns {{ positions: Float32Array, normals: Float32Array, indices: Uint32Array }}
 */
function computeCuboid(corners) {
  const ok = build_cuboid_geometry(corners)
  if (!ok) throw new Error('build_cuboid_geometry: invalid input (expected 24 f32 values)')

  // Get the WebAssembly.Memory object — its `.buffer` is the raw ArrayBuffer
  // backing the entire Wasm heap.
  const memory = wasm_memory()
  const buf = memory.buffer

  // --- Zero-copy views over Wasm linear memory ---
  const posPtr  = get_positions_ptr()
  const posLen  = get_positions_len()
  const normPtr = get_normals_ptr()
  const normLen = get_normals_len()
  const idxPtr  = get_indices_ptr()
  const idxLen  = get_indices_len()

  // Create typed-array *views* (zero-copy within this worker).
  // `.slice()` copies once into a fresh, standalone ArrayBuffer that can
  // be *transferred* (not copied again) to the main thread via postMessage.
  const positions = new Float32Array(buf, posPtr, posLen).slice()
  const normals   = new Float32Array(buf, normPtr, normLen).slice()
  const indices   = new Uint32Array(buf, idxPtr, idxLen).slice()

  return { positions, normals, indices }
}

/**
 * Compute BufferGeometry arrays for a prism extruded from a 2D polygon.
 *
 * @param {Float32Array} profile  2*n f32 values (xi, yi per vertex, n ≥ 3)
 * @param {number} height         extrusion height in world Z units
 * @returns {{ positions: Float32Array, normals: Float32Array, indices: Uint32Array }}
 */
function computeExtrudedProfile(profile, height) {
  const count = build_extruded_profile(profile, height)
  if (!count) throw new Error('build_extruded_profile: invalid input')

  const memory = wasm_memory()
  const buf = memory.buffer

  const posPtr  = get_positions_ptr()
  const posLen  = get_positions_len()
  const normPtr = get_normals_ptr()
  const normLen = get_normals_len()
  const idxPtr  = get_indices_ptr()
  const idxLen  = get_indices_len()

  const positions = new Float32Array(buf, posPtr, posLen).slice()
  const normals   = new Float32Array(buf, normPtr, normLen).slice()
  const indices   = new Uint32Array(buf, idxPtr, idxLen).slice()

  return { positions, normals, indices }
}

/**
 * Compute column-major 4×4 instance matrices from compact TRS transforms.
 *
 * @param {Float32Array} transforms  10*n f32 values [px,py,pz, qx,qy,qz,qw, sx,sy,sz] per instance
 * @returns {{ matrices: Float32Array }}  n × 16 f32 values
 */
function computeInstanceMatrices(transforms) {
  const n = build_instance_matrices(transforms)
  if (!n) throw new Error('build_instance_matrices: invalid input')

  const memory  = wasm_memory()
  const buf     = memory.buffer
  const matPtr  = get_matrices_ptr()
  const matLen  = get_matrices_len()

  const matrices = new Float32Array(buf, matPtr, matLen).slice()
  return { matrices }
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

self.addEventListener('message', async (e) => {
  const { type, id, payload } = e.data

  // ── Init ──────────────────────────────────────────────────────────────────
  if (type === 'init') {
    try {
      await initEngine()
      self.postMessage({ type: 'ready' })
    } catch (err) {
      self.postMessage({ type: 'error', id: null, message: `Wasm init failed: ${err.message}` })
    }
    return
  }

  // ── Guard ─────────────────────────────────────────────────────────────────
  if (!ready) {
    self.postMessage({ type: 'error', id, message: 'GeometryEngine not ready — call init first' })
    return
  }

  // ── compute_cuboid ────────────────────────────────────────────────────────
  if (type === 'compute_cuboid') {
    try {
      const { corners } = payload            // Float32Array transferred from main thread
      const { positions, normals, indices } = computeCuboid(corners)

      // Transfer ArrayBuffers to main thread — zero-copy across thread boundary.
      self.postMessage(
        { type: 'result', id, positions, normals, indices },
        [positions.buffer, normals.buffer, indices.buffer],
      )
    } catch (err) {
      self.postMessage({ type: 'error', id, message: err.message })
    }
    return
  }

  // ── compute_extruded_profile ──────────────────────────────────────────────
  if (type === 'compute_extruded_profile') {
    try {
      const { profile, height } = payload
      const { positions, normals, indices } = computeExtrudedProfile(profile, height)
      self.postMessage(
        { type: 'result', id, positions, normals, indices },
        [positions.buffer, normals.buffer, indices.buffer],
      )
    } catch (err) {
      self.postMessage({ type: 'error', id, message: err.message })
    }
    return
  }

  // ── compute_instance_matrices ─────────────────────────────────────────────
  if (type === 'compute_instance_matrices') {
    try {
      const { transforms } = payload
      const { matrices } = computeInstanceMatrices(transforms)
      self.postMessage(
        { type: 'result', id, matrices },
        [matrices.buffer],
      )
    } catch (err) {
      self.postMessage({ type: 'error', id, message: err.message })
    }
    return
  }

  self.postMessage({ type: 'error', id, message: `Unknown command: ${type}` })
})
