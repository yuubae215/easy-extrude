/* tslint:disable */
/* eslint-disable */

/**
 * Build BufferGeometry arrays for a cuboid defined by 8 corners.
 *
 * `corners_flat`: flat f32 slice of length 24 (8 corners × x,y,z),
 *                 ordered to match `createInitialCorners()` in CuboidModel.js.
 *
 * After this call:
 *   - `get_positions_ptr()` / `get_positions_len()` → 72 f32 values (6 faces × 4 verts × 3)
 *   - `get_normals_ptr()`   / `get_normals_len()`   → 72 f32 values
 *   - `get_indices_ptr()`   / `get_indices_len()`   → 36 u32 values (6 × 2 triangles × 3)
 *
 * Returns 1 on success, 0 on bad input.
 */
export function build_cuboid_geometry(corners_flat: Float32Array): number;

/**
 * Build BufferGeometry arrays for a prism extruded from a 2D polygon profile.
 *
 * `profile_flat`: flat f32 slice of length 2*n (n ≥ 3), ordered as
 *                 [x0, y0, x1, y1, …, x(n-1), y(n-1)].
 *                 Accepts both CCW and CW winding — outward normals are
 *                 determined via a centroid test, mirroring `build_cuboid_geometry`.
 * `height`:       extrusion height in world Z units (may be negative).
 *                 The profile sits at z = min(0, height);
 *                 the extruded cap is at z = max(0, height).
 *
 * Geometry layout (same static Vecs as `build_cuboid_geometry`):
 *   - `n` side quads:    4 verts × n quads, outward side normals
 *   - 1 bottom cap:      n verts, normal (0, 0, −1)
 *   - 1 top cap:         n verts, normal (0, 0, +1)
 *   Total positions/normals: (4n + 2n) × 3 = 6n × 3 f32 values
 *   Total indices:           (2n + 2(n−2)) × 3 = (4n−4) × 3 u32 values
 *
 * For n = 4 (rectangle): 72 f32 positions and 36 u32 indices —
 * identical counts to `build_cuboid_geometry`.
 *
 * Returns the vertex count (6n) on success, 0 on bad input.
 */
export function build_extruded_profile(profile_flat: Float32Array, height: number): number;

/**
 * Compute column-major 4×4 instance matrices from compact TRS transforms.
 *
 * Produces the exact layout expected by `THREE.InstancedMesh.instanceMatrix`
 * (same as `THREE.Matrix4.compose()` column-major element order).
 *
 * `transforms_flat`: flat f32 slice of length 10*n (n ≥ 1), where each
 *                    transform is 10 values:
 *                    [px, py, pz,  qx, qy, qz, qw,  sx, sy, sz]
 *                     ↑ position   ↑ quaternion      ↑ scale
 *
 * Output stored in `INSTANCE_MATRICES`: n × 16 f32 values (column-major).
 * Read via `get_matrices_ptr()` / `get_matrices_len()`.
 *
 * Returns n (instance count) on success, 0 on bad input.
 */
export function build_instance_matrices(transforms_flat: Float32Array): number;

/**
 * Number of u32 elements in the indices buffer.
 */
export function get_indices_len(): number;

/**
 * Pointer to the start of the indices buffer in Wasm linear memory.
 */
export function get_indices_ptr(): number;

/**
 * Number of f32 elements in the instance-matrix buffer (n × 16).
 */
export function get_matrices_len(): number;

/**
 * Pointer to the start of the instance-matrix buffer in Wasm linear memory.
 */
export function get_matrices_ptr(): number;

/**
 * Number of f32 elements in the normals buffer.
 */
export function get_normals_len(): number;

/**
 * Pointer to the start of the normals buffer in Wasm linear memory.
 */
export function get_normals_ptr(): number;

/**
 * Number of f32 elements in the positions buffer.
 */
export function get_positions_len(): number;

/**
 * Pointer to the start of the positions buffer in Wasm linear memory.
 */
export function get_positions_ptr(): number;

/**
 * Returns the `WebAssembly.Memory` object so JS can construct typed-array
 * views directly over the Wasm heap (zero-copy read after `build_*`).
 *
 * ```js
 * const memory = wasm_memory();          // WebAssembly.Memory
 * const positions = new Float32Array(memory.buffer, posPtr, posLen);
 * ```
 */
export function wasm_memory(): any;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly build_cuboid_geometry: (a: number, b: number) => number;
    readonly build_extruded_profile: (a: number, b: number, c: number) => number;
    readonly build_instance_matrices: (a: number, b: number) => number;
    readonly get_indices_len: () => number;
    readonly get_indices_ptr: () => number;
    readonly get_matrices_len: () => number;
    readonly get_matrices_ptr: () => number;
    readonly get_normals_len: () => number;
    readonly get_normals_ptr: () => number;
    readonly get_positions_len: () => number;
    readonly get_positions_ptr: () => number;
    readonly wasm_memory: () => any;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
