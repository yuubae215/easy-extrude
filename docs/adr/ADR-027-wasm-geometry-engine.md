# ADR-027 — Wasm Geometry Engine: Three-Layer Architecture with Zero-Copy Data Path

| Field | Value |
|-------|-------|
| **Status** | Accepted |
| **Date** | 2026-04-05 |
| **Deciders** | yuubae215 |
| **Related** | ADR-007 (Cuboid geometry), ADR-012 (Graph-based geometry), ADR-017 (WebSocket geometry service) |

---

## Context

As the number of objects in a scene grows, Three.js draw calls become the primary
performance bottleneck.  The current pure-JavaScript implementation in
`CuboidModel.buildGeometry()` runs on the main thread and directly competes with
Three.js rendering.  Complex operations (future: Boolean solids, Monte Carlo
simulations, large mesh generation) will stall the render loop if left on the
main thread.

The goal of this ADR is to:

1. Keep Three.js rendering unblocked at all times.
2. Enable Rust-speed geometry computation in the browser.
3. Minimise memory overhead by avoiding redundant data copies.
4. Design an upgrade path to true zero-copy via `SharedArrayBuffer`.

---

## Decision

Adopt a **three-layer architecture** with a **zero-copy data path**:

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 1 — Main Thread  (Three.js rendering + UI)               │
│  GeometryEngine.js  →  THREE.BufferGeometry                     │
│  No computation.  Receives transferred ArrayBuffers.            │
└─────────────────────────────┬───────────────────────────────────┘
                              │ postMessage / transfer
┌─────────────────────────────▼───────────────────────────────────┐
│  Layer 2 — Web Worker  (async bridge)                           │
│  geometry.worker.js                                             │
│  Loads Wasm, dispatches commands, reads pointers, slices once,  │
│  then transfers ArrayBuffer to main thread.                     │
└─────────────────────────────┬───────────────────────────────────┘
                              │ wasm-bindgen calls
┌─────────────────────────────▼───────────────────────────────────┐
│  Layer 3 — Rust / WebAssembly  (computation engine)             │
│  wasm-engine/src/lib.rs                                         │
│  Writes positions, normals, indices into static Vecs in         │
│  Wasm linear memory.  Returns pointer + length to JS.           │
└─────────────────────────────────────────────────────────────────┘
```

### Data flow (zero-copy)

```
① JS sends params to Worker
   main → postMessage({ corners: Float32Array }, [corners.buffer])
   ArrayBuffer is *transferred* (zero-copy, Worker owns it now)

② Rust computes in Wasm linear memory
   build_cuboid_geometry(corners) → fills static Vec<f32> POSITIONS, NORMALS, INDICES

③ Worker reads pointer (zero-copy view over Wasm heap)
   const posView = new Float32Array(wasmMemory.buffer, posPtr, posLen)
   // posView is a *view*, not a copy

④ Worker slices once into a transferable buffer
   const positions = posView.slice()
   // One copy: Wasm heap → standalone ArrayBuffer

⑤ Worker transfers to main thread (zero-copy)
   postMessage({ positions, … }, [positions.buffer, normals.buffer, indices.buffer])
   // ArrayBuffers are *transferred*, not copied

⑥ Main thread builds THREE.BufferGeometry (zero-copy)
   geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
   // BufferAttribute holds the exact same ArrayBuffer — no copy
```

### File structure

```
wasm-engine/                      # Rust crate (Cargo workspace)
├── Cargo.toml
└── src/lib.rs                    # build_cuboid_geometry() + pointer getters

src/
├── engine/wasm/                  # wasm-pack output (generated, gitignored)
│   ├── wasm_engine.js            # wasm-bindgen JS bindings
│   └── wasm_engine_bg.wasm       # compiled Wasm binary
├── workers/
│   └── geometry.worker.js        # Web Worker bridge
└── service/
    └── GeometryEngine.js         # Main-thread facade (Promise API)
```

### API (main thread)

```javascript
import { geometryEngine } from './service/GeometryEngine.js'

// One-time setup (starts Worker, loads Wasm)
await geometryEngine.init()

// Per-object computation
const { positions, normals, indices } = await geometryEngine.computeCuboid(corners)
const geo = new THREE.BufferGeometry()
geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
geo.setAttribute('normal',   new THREE.BufferAttribute(normals,   3))
geo.setIndex(new THREE.BufferAttribute(indices, 1))
```

### Build

```bash
# Compile Rust → Wasm + JS bindings
pnpm build:wasm
# wasm-pack build wasm-engine --target bundler --out-dir ../src/engine/wasm

# Full production build (runs build:wasm first)
pnpm build

# Rust unit tests
pnpm test:wasm
```

### Graceful fallback

`GeometryEngine.js` catches Worker/Wasm load failures and falls back to the
synchronous `CuboidModel.buildGeometry()` implementation.  The application
is never broken by Wasm unavailability; it simply runs slower.

---

## Consequences

### Positive

- **Main thread never blocked**: geometry computation runs in a separate OS thread.
- **Rust performance**: SIMD-capable, no GC pauses, predictable latency.
- **Minimal copying**: one copy from Wasm heap → transferable buffer; zero
  copies after that (Worker→main thread and into THREE.BufferGeometry).
- **Composable**: new Rust functions (Boolean ops, extrude, Monte Carlo) are
  added to `lib.rs` without touching the JS architecture.
- **Safe fallback**: Wasm failure degrades to JS, not a crash.

### Negative / Trade-offs

- **Build step added**: `pnpm build:wasm` must run before `pnpm dev` or `pnpm build`
  when the Rust code changes.  CI must install `wasm-pack` and the `wasm32-unknown-unknown`
  Rust target.
- **One copy still exists**: step ④ above (Wasm heap → slice).  This is unavoidable
  without `SharedArrayBuffer` (see §Future Work).
- **Async API**: callers of `computeCuboid()` must `await`.  The existing
  synchronous `buildGeometry()` is still available directly for low-level use.

---

## Alternatives considered

| Option | Why rejected |
|--------|-------------|
| Run Wasm on main thread (no Worker) | Zero-copy but blocks render loop on expensive ops |
| Node.js BFF for geometry computation | Network RTT (≥5 ms) unacceptable for interactive dragging |
| AssemblyScript instead of Rust | Weaker type system, slower, harder to maintain correctness |
| OffscreenCanvas + GPU compute | Much higher complexity; Rust Wasm covers our current needs |

---

## Future Work

### True zero-copy with SharedArrayBuffer

If the hosting environment sets the required COOP/COEP HTTP headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

then `WebAssembly.Memory` can be declared as `shared: true`:

```rust
// In a future init path
let memory = WebAssembly::Memory::new_with_descriptor(
    &MemoryDescriptor::new().initial(16).maximum(256).shared(true)
)?;
```

The Worker and main thread would then both hold a view over the **same**
`SharedArrayBuffer`, eliminating step ④ entirely.  The vite.config.js dev
server already sets these headers; production deployment is the remaining step.

### Phase 3: Expanded Rust compute surface (2026-04-05)

Two new functions added to `lib.rs`:

#### `build_extruded_profile(profile_flat: &[f32], height: f32) -> u32`

Generates a prism from an arbitrary 2D polygon profile extruded along Z.

- Input: 2*n f32 values `[x0, y0, x1, y1, …]` (n ≥ 3) + signed height
- Output: positions / normals / indices in the same POSITIONS/NORMALS/INDICES Vecs
- Centroid-based outward-normal test on each side face — handles both CW and CCW polygon winding
- For n = 4 (rectangle): produces 72 f32 + 36 u32, same counts as `build_cuboid_geometry`
- Enables future non-rectangular Profile shapes (L-shape, T-shape, …)

**JS integration**: `GeometryEngine.computeExtrudedProfile(vertices2d, height)` ·
`MeshView.rebuildExtrudedProfile(vertices2d, height)`.
AppController fires async Wasm rebuild after sync `updateGeometry()` on extrude confirm.

#### `build_instance_matrices(transforms_flat: &[f32]) -> u32`

Batch-computes column-major 4×4 matrices from compact TRS transforms.

- Input: n×10 f32 values `[px, py, pz, qx, qy, qz, qw, sx, sy, sz]` per instance
- Output: n×16 f32 values in `INSTANCE_MATRICES` (separate buffer, does not clobber geometry Vecs)
- Layout matches `THREE.Matrix4.compose()` / `THREE.InstancedMesh.instanceMatrix.array` exactly
- JS fallback via `THREE.Matrix4.compose()` on main thread

**JS integration**: `GeometryEngine.computeInstanceMatrices(transforms)` → returns
`{ matrices: Float32Array }` ready for `new THREE.InstancedBufferAttribute(matrices, 16)`.

### Extending the compute API

Remaining future work in `lib.rs`:

| Function | Description |
|----------|-------------|
| `run_monte_carlo(params)` | Simulation engine for urban analysis (ADR-026) |
| `build_boolean_union(a, b)` | CSG union (replaces server-side BFF round-trip) |

---

## References

- ADR-007: Cuboid geometry representation
- ADR-012: Graph-based geometry model (Vertex/Edge/Face)
- ADR-017: WebSocket geometry service (server-side heavy ops)
- `wasm-engine/src/lib.rs` — Rust implementation
- `src/workers/geometry.worker.js` — Worker bridge
- `src/service/GeometryEngine.js` — Main-thread facade
