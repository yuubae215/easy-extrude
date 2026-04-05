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
 * @param {Float32Array} corners_flat
 * @returns {number}
 */
export function build_cuboid_geometry(corners_flat) {
    const ptr0 = passArrayF32ToWasm0(corners_flat, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.build_cuboid_geometry(ptr0, len0);
    return ret >>> 0;
}

/**
 * Number of u32 elements in the indices buffer.
 * @returns {number}
 */
export function get_indices_len() {
    const ret = wasm.get_indices_len();
    return ret >>> 0;
}

/**
 * Pointer to the start of the indices buffer in Wasm linear memory.
 * @returns {number}
 */
export function get_indices_ptr() {
    const ret = wasm.get_indices_ptr();
    return ret >>> 0;
}

/**
 * Number of f32 elements in the normals buffer.
 * @returns {number}
 */
export function get_normals_len() {
    const ret = wasm.get_normals_len();
    return ret >>> 0;
}

/**
 * Pointer to the start of the normals buffer in Wasm linear memory.
 * @returns {number}
 */
export function get_normals_ptr() {
    const ret = wasm.get_normals_ptr();
    return ret >>> 0;
}

/**
 * Number of f32 elements in the positions buffer.
 * @returns {number}
 */
export function get_positions_len() {
    const ret = wasm.get_positions_len();
    return ret >>> 0;
}

/**
 * Pointer to the start of the positions buffer in Wasm linear memory.
 * @returns {number}
 */
export function get_positions_ptr() {
    const ret = wasm.get_positions_ptr();
    return ret >>> 0;
}

/**
 * Returns the `WebAssembly.Memory` object so JS can construct typed-array
 * views directly over the Wasm heap (zero-copy read after `build_*`).
 *
 * ```js
 * const memory = wasm_memory();          // WebAssembly.Memory
 * const positions = new Float32Array(memory.buffer, posPtr, posLen);
 * ```
 * @returns {any}
 */
export function wasm_memory() {
    const ret = wasm.wasm_memory();
    return ret;
}
export function __wbg___wbindgen_memory_73fdd881ebd2e7a3() {
    const ret = wasm.memory;
    return ret;
}
export function __wbindgen_init_externref_table() {
    const table = wasm.__wbindgen_externrefs;
    const offset = table.grow(4);
    table.set(0, undefined);
    table.set(offset + 0, undefined);
    table.set(offset + 1, null);
    table.set(offset + 2, true);
    table.set(offset + 3, false);
}
let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

let WASM_VECTOR_LEN = 0;


let wasm;
export function __wbg_set_wasm(val) {
    wasm = val;
}
