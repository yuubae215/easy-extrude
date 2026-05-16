/* @ts-self-types="./wasm_engine.d.ts" */

/**
 * Apply a single rigid-body pose to N local-space points, producing world-space points.
 *
 * `input_flat`: 7 + 3*N f32:
 *   [0..2] pose.position.xyz
 *   [3..6] pose.quaternion.xyzw   (Three.js order: x, y, z, w)
 *   [7..]  N × (lx, ly, lz)  local-space points
 *
 * Equivalent JS (per point):
 *   worldPoint = localPoint.clone().applyQuaternion(pose.quaternion).add(pose.position)
 *
 * Output stored in TRANSFORM_BUFFER: N × 3 f32 world-space points.
 *
 * Returns N on success, 0 on bad input.
 * @param {Float32Array} input_flat
 * @returns {number}
 */
export function apply_pose_to_points(input_flat) {
    const ptr0 = passArrayF32ToWasm0(input_flat, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.apply_pose_to_points(ptr0, len0);
    return ret >>> 0;
}

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
 * @param {Float32Array} profile_flat
 * @param {number} height
 * @returns {number}
 */
export function build_extruded_profile(profile_flat, height) {
    const ptr0 = passArrayF32ToWasm0(profile_flat, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.build_extruded_profile(ptr0, len0, height);
    return ret >>> 0;
}

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
 * @param {Float32Array} transforms_flat
 * @returns {number}
 */
export function build_instance_matrices(transforms_flat) {
    const ptr0 = passArrayF32ToWasm0(transforms_flat, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.build_instance_matrices(ptr0, len0);
    return ret >>> 0;
}

/**
 * Number of f32 elements in the constraint-poses buffer (N × 7).
 * @returns {number}
 */
export function get_constraints_len() {
    const ret = wasm.get_constraints_len();
    return ret >>> 0;
}

/**
 * Pointer to the constraint-poses output buffer.
 * @returns {number}
 */
export function get_constraints_ptr() {
    const ret = wasm.get_constraints_ptr();
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
 * Number of f32 elements in the instance-matrix buffer (n × 16).
 * @returns {number}
 */
export function get_matrices_len() {
    const ret = wasm.get_matrices_len();
    return ret >>> 0;
}

/**
 * Pointer to the start of the instance-matrix buffer in Wasm linear memory.
 * @returns {number}
 */
export function get_matrices_ptr() {
    const ret = wasm.get_matrices_ptr();
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
 * Number of f32 elements in the transform output buffer (N × 3).
 * @returns {number}
 */
export function get_transform_len() {
    const ret = wasm.get_transform_len();
    return ret >>> 0;
}

/**
 * Pointer to the transform output buffer.
 * @returns {number}
 */
export function get_transform_ptr() {
    const ret = wasm.get_transform_ptr();
    return ret >>> 0;
}

/**
 * Batch-solve world poses for N fixed-joint CoordinateFrame constraints.
 *
 * Operates on kinematic jointType='fixed' links (0 DOF).
 * Domain semanticType (fastened, aligned, …) is irrelevant at this layer.
 *
 * `input_flat`: N × 14 f32, one block per constraint:
 *   [0..2]   relativeOffset.xyz       — offset in target's local frame
 *   [3..6]   relativeQuat.xyzw        — rotation relative to target (Three.js order)
 *   [7..9]   targetPos.xyz            — target world position
 *   [10..13] targetQuat.xyzw          — target world quaternion
 *
 * Equivalent JS (per constraint):
 *   worldPos  = relativeOffset.clone().applyQuaternion(targetQuat).add(targetPos)
 *   worldQuat = targetQuat.clone().multiply(relativeQuat)
 *
 * Output stored in CONSTRAINT_POSES: N × 7 f32:
 *   [0..2] worldPos.xyz
 *   [3..6] worldQuat.xyzw
 *
 * Returns N on success, 0 on bad input (non-multiple of 14 or empty).
 * @param {Float32Array} input_flat
 * @returns {number}
 */
export function solve_fixed_joints(input_flat) {
    const ptr0 = passArrayF32ToWasm0(input_flat, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    // Wasm binary symbol is still `solve_fastened_constraints` (pending next wasm-pack rebuild).
    const ret = wasm.solve_fastened_constraints(ptr0, len0);
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

function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_memory_73fdd881ebd2e7a3: function() {
            const ret = wasm.memory;
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./wasm_engine_bg.js": import0,
    };
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

let wasmModule, wasm;
function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    wasmModule = module;
    cachedFloat32ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('wasm_engine_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
