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
 * Number of u32 elements in the indices buffer.
 */
export function get_indices_len(): number;

/**
 * Pointer to the start of the indices buffer in Wasm linear memory.
 */
export function get_indices_ptr(): number;

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
    readonly get_indices_len: () => number;
    readonly get_indices_ptr: () => number;
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
