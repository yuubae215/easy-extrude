/*!
 * wasm-engine — Geometry Computation Engine
 *
 * Runs inside a Web Worker as a WebAssembly module.
 * Writes typed-array geometry directly into Wasm linear memory so that
 * the JavaScript side can read it via a pointer without an extra copy.
 *
 * Data flow (ADR-027):
 *   JS (Worker) ──params──► Rust computes ──writes to Vec──► static buffer
 *                                                              │
 *   JS reads pointer+len ◄──────────────────────────────────┘
 *   JS creates Float32Array view (zero-copy within worker)
 *   JS transfers ArrayBuffer to main thread (zero-copy across threads)
 *
 * Coordinate system: ROS REP-103 (+X forward, +Y left, +Z up, right-handed)
 * Matches the Three.js camera.up = (0,0,1) setting in SceneView.js.
 */

// Wasm runs on a single thread, so mutable static Vecs are safe here.
// The lint warns about the general multi-threaded case; suppress it explicitly.
#![allow(static_mut_refs)]

use wasm_bindgen::prelude::*;

// ---------------------------------------------------------------------------
// Face layout — must match src/model/CuboidModel.js `FACES` exactly
//
//       6─────7
//      /|    /|    +Z up
//     5─────4 |    +Y left
//     | 2───|─3    +X front (toward viewer)
//     |/    |/
//     1─────0
//
// Each row: 4 corner indices in CCW order as seen from outside the cuboid.
// ---------------------------------------------------------------------------
const FACES: [[usize; 4]; 6] = [
    [1, 2, 6, 5], // 0 Front  (+X)
    [0, 4, 7, 3], // 1 Back   (-X)
    [4, 5, 6, 7], // 2 Top    (+Z)
    [1, 0, 3, 2], // 3 Bottom (-Z)
    [2, 3, 7, 6], // 4 Left   (+Y)
    [1, 5, 4, 0], // 5 Right  (-Y)
];

// ---------------------------------------------------------------------------
// Static output buffers
// Persisted in Wasm linear memory across calls so JS can read them via pointer
// without allocation. Cleared at the start of each computation call.
// ---------------------------------------------------------------------------
static mut POSITIONS: Vec<f32> = Vec::new();
static mut NORMALS:   Vec<f32> = Vec::new();
static mut INDICES:   Vec<u32> = Vec::new();

// ---------------------------------------------------------------------------
// Internal vector math (no dependencies)
// ---------------------------------------------------------------------------

#[inline]
fn sub(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

#[inline]
fn cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

#[inline]
fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

#[inline]
fn normalize(v: [f32; 3]) -> [f32; 3] {
    let len = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    if len < 1e-10 {
        return [0.0, 0.0, 1.0];
    }
    [v[0] / len, v[1] / len, v[2] / len]
}

/// Raw face normal (not yet corrected for outward direction).
fn compute_face_normal(corners: &[[f32; 3]; 8], fi: usize) -> [f32; 3] {
    let [a, b, _, d] = FACES[fi];
    let ab = sub(corners[b], corners[a]);
    let ad = sub(corners[d], corners[a]);
    normalize(cross(ab, ad))
}

/// Outward-facing face normal — flips sign if the raw normal points inward.
/// Mirrors computeOutwardFaceNormal() in CuboidModel.js.
fn compute_outward_face_normal(corners: &[[f32; 3]; 8], fi: usize) -> [f32; 3] {
    let n = compute_face_normal(corners, fi);
    let face_ci = FACES[fi];

    // Face center
    let mut fc = [0.0f32; 3];
    for &ci in &face_ci {
        fc[0] += corners[ci][0];
        fc[1] += corners[ci][1];
        fc[2] += corners[ci][2];
    }
    fc[0] /= 4.0;
    fc[1] /= 4.0;
    fc[2] /= 4.0;

    // Object centroid
    let mut cen = [0.0f32; 3];
    for c in corners {
        cen[0] += c[0];
        cen[1] += c[1];
        cen[2] += c[2];
    }
    cen[0] /= 8.0;
    cen[1] /= 8.0;
    cen[2] /= 8.0;

    let dir = sub(fc, cen);
    if dot(dir, n) < 0.0 {
        [-n[0], -n[1], -n[2]]
    } else {
        n
    }
}

// ---------------------------------------------------------------------------
// Public API — called from the Web Worker (geometry.worker.js)
// ---------------------------------------------------------------------------

/// Build BufferGeometry arrays for a cuboid defined by 8 corners.
///
/// `corners_flat`: flat f32 slice of length 24 (8 corners × x,y,z),
///                 ordered to match `createInitialCorners()` in CuboidModel.js.
///
/// After this call:
///   - `get_positions_ptr()` / `get_positions_len()` → 72 f32 values (6 faces × 4 verts × 3)
///   - `get_normals_ptr()`   / `get_normals_len()`   → 72 f32 values
///   - `get_indices_ptr()`   / `get_indices_len()`   → 36 u32 values (6 × 2 triangles × 3)
///
/// Returns 1 on success, 0 on bad input.
#[wasm_bindgen]
pub fn build_cuboid_geometry(corners_flat: &[f32]) -> u32 {
    if corners_flat.len() != 24 {
        return 0;
    }

    let mut corners = [[0.0f32; 3]; 8];
    for i in 0..8 {
        corners[i] = [
            corners_flat[i * 3],
            corners_flat[i * 3 + 1],
            corners_flat[i * 3 + 2],
        ];
    }

    // SAFETY: single-threaded Wasm — no concurrent access to these statics.
    unsafe {
        POSITIONS.clear();
        NORMALS.clear();
        INDICES.clear();

        for fi in 0..6usize {
            let raw_n = compute_face_normal(&corners, fi);
            let n = compute_outward_face_normal(&corners, fi);
            // If the outward normal is opposite to the raw normal, winding is inverted.
            // Flip the index order to keep gl_FrontFacing=true (matches JS buildGeometry()).
            let inverted = dot(n, raw_n) < 0.0;

            for vi in 0..4usize {
                let ci = FACES[fi][vi];
                let v = corners[ci];
                POSITIONS.extend_from_slice(&v);
                NORMALS.extend_from_slice(&n);
            }

            let b = (fi * 4) as u32;
            if inverted {
                INDICES.extend_from_slice(&[b, b + 2, b + 1, b, b + 3, b + 2]);
            } else {
                INDICES.extend_from_slice(&[b, b + 1, b + 2, b, b + 2, b + 3]);
            }
        }
    }

    1
}

// ---------------------------------------------------------------------------
// Memory handle — JS needs this to build typed-array views over Wasm heap
// ---------------------------------------------------------------------------

/// Returns the `WebAssembly.Memory` object so JS can construct typed-array
/// views directly over the Wasm heap (zero-copy read after `build_*`).
///
/// ```js
/// const memory = wasm_memory();          // WebAssembly.Memory
/// const positions = new Float32Array(memory.buffer, posPtr, posLen);
/// ```
#[wasm_bindgen]
pub fn wasm_memory() -> wasm_bindgen::JsValue {
    wasm_bindgen::memory()
}

// ---------------------------------------------------------------------------
// Pointer getters — JS reads these to view output data without copying
// ---------------------------------------------------------------------------

/// Pointer to the start of the positions buffer in Wasm linear memory.
#[wasm_bindgen]
pub fn get_positions_ptr() -> *const f32 {
    unsafe { POSITIONS.as_ptr() }
}

/// Number of f32 elements in the positions buffer.
#[wasm_bindgen]
pub fn get_positions_len() -> usize {
    unsafe { POSITIONS.len() }
}

/// Pointer to the start of the normals buffer in Wasm linear memory.
#[wasm_bindgen]
pub fn get_normals_ptr() -> *const f32 {
    unsafe { NORMALS.as_ptr() }
}

/// Number of f32 elements in the normals buffer.
#[wasm_bindgen]
pub fn get_normals_len() -> usize {
    unsafe { NORMALS.len() }
}

/// Pointer to the start of the indices buffer in Wasm linear memory.
#[wasm_bindgen]
pub fn get_indices_ptr() -> *const u32 {
    unsafe { INDICES.as_ptr() }
}

/// Number of u32 elements in the indices buffer.
#[wasm_bindgen]
pub fn get_indices_len() -> usize {
    unsafe { INDICES.len() }
}

// ---------------------------------------------------------------------------
// Tests (run with: cargo test)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn unit_corners() -> [f32; 24] {
        [
            -1.0, -1.0, -1.0, // 0
             1.0, -1.0, -1.0, // 1
             1.0,  1.0, -1.0, // 2
            -1.0,  1.0, -1.0, // 3
            -1.0, -1.0,  1.0, // 4
             1.0, -1.0,  1.0, // 5
             1.0,  1.0,  1.0, // 6
            -1.0,  1.0,  1.0, // 7
        ]
    }

    #[test]
    fn test_build_unit_cuboid() {
        let corners = unit_corners();
        let ok = build_cuboid_geometry(&corners);
        assert_eq!(ok, 1);

        unsafe {
            assert_eq!(POSITIONS.len(), 72); // 6 faces × 4 verts × 3
            assert_eq!(NORMALS.len(), 72);
            assert_eq!(INDICES.len(), 36);   // 6 faces × 2 tris × 3
        }
    }

    #[test]
    fn test_rejects_bad_input() {
        let ok = build_cuboid_geometry(&[0.0; 10]);
        assert_eq!(ok, 0);
    }

    #[test]
    fn test_front_face_normal_is_plus_x() {
        let corners = unit_corners();
        build_cuboid_geometry(&corners);

        // Face 0 (Front +X): first vertex normal should be [1, 0, 0]
        unsafe {
            let nx = NORMALS[0];
            let ny = NORMALS[1];
            let nz = NORMALS[2];
            assert!((nx - 1.0).abs() < 1e-5, "nx={}", nx);
            assert!(ny.abs() < 1e-5, "ny={}", ny);
            assert!(nz.abs() < 1e-5, "nz={}", nz);
        }
    }
}
