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
static mut POSITIONS:        Vec<f32> = Vec::new();
static mut NORMALS:          Vec<f32> = Vec::new();
static mut INDICES:          Vec<u32> = Vec::new();
/// Instance matrix buffer — separate from geometry buffers; used by
/// `build_instance_matrices()` only. Does not clobber POSITIONS/NORMALS/INDICES.
static mut INSTANCE_MATRICES: Vec<f32> = Vec::new();

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
// build_extruded_profile — arbitrary n-gon prism geometry
// ---------------------------------------------------------------------------

/// Build BufferGeometry arrays for a prism extruded from a 2D polygon profile.
///
/// `profile_flat`: flat f32 slice of length 2*n (n ≥ 3), ordered as
///                 [x0, y0, x1, y1, …, x(n-1), y(n-1)].
///                 Accepts both CCW and CW winding — outward normals are
///                 determined via a centroid test, mirroring `build_cuboid_geometry`.
/// `height`:       extrusion height in world Z units (may be negative).
///                 The profile sits at z = min(0, height);
///                 the extruded cap is at z = max(0, height).
///
/// Geometry layout (same static Vecs as `build_cuboid_geometry`):
///   - `n` side quads:    4 verts × n quads, outward side normals
///   - 1 bottom cap:      n verts, normal (0, 0, −1)
///   - 1 top cap:         n verts, normal (0, 0, +1)
///   Total positions/normals: (4n + 2n) × 3 = 6n × 3 f32 values
///   Total indices:           (2n + 2(n−2)) × 3 = (4n−4) × 3 u32 values
///
/// For n = 4 (rectangle): 72 f32 positions and 36 u32 indices —
/// identical counts to `build_cuboid_geometry`.
///
/// Returns the vertex count (6n) on success, 0 on bad input.
#[wasm_bindgen]
pub fn build_extruded_profile(profile_flat: &[f32], height: f32) -> u32 {
    if profile_flat.len() < 6 || profile_flat.len() % 2 != 0 {
        return 0;
    }
    let n = profile_flat.len() / 2;

    // Unpack 2-D profile vertices.
    let mut xs = vec![0.0f32; n];
    let mut ys = vec![0.0f32; n];
    for i in 0..n {
        xs[i] = profile_flat[i * 2];
        ys[i] = profile_flat[i * 2 + 1];
    }

    // Z extents — always put the lower cap at z_low, upper at z_high.
    let z_low  = height.min(0.0);
    let z_high = height.max(0.0);

    // Polygon centroid in XY — used for outward-normal verification.
    let cx: f32 = xs.iter().sum::<f32>() / n as f32;
    let cy: f32 = ys.iter().sum::<f32>() / n as f32;

    // SAFETY: single-threaded Wasm — no concurrent access.
    unsafe {
        POSITIONS.clear();
        NORMALS.clear();
        INDICES.clear();

        // ── Side faces ─────────────────────────────────────────────────────
        // One quad per edge (i → next_i).  Each quad: 4 verts, 2 triangles.
        let mut vertex_offset: u32 = 0;
        for i in 0..n {
            let j = (i + 1) % n;
            let x0 = xs[i]; let y0 = ys[i];
            let x1 = xs[j]; let y1 = ys[j];

            // Candidate outward normal = edge rotated 90° CW (for CCW polygon).
            let dx = x1 - x0;
            let dy = y1 - y0;
            let len = (dx * dx + dy * dy).sqrt();
            if len < 1e-10 { continue; }
            let (mut nx, mut ny) = (dy / len, -dx / len);

            // Centroid check: flip if normal points inward.
            let mid_x = (x0 + x1) * 0.5;
            let mid_y = (y0 + y1) * 0.5;
            let dir_x = mid_x - cx;
            let dir_y = mid_y - cy;
            let inverted = dir_x * nx + dir_y * ny < 0.0;
            if inverted { nx = -nx; ny = -ny; }

            // 4 vertices: BL, BR, TR, TL (bottom-left, bottom-right, top-right, top-left)
            // BL = (x0, y0, z_low)   BR = (x1, y1, z_low)
            // TR = (x1, y1, z_high)  TL = (x0, y0, z_high)
            let verts = [
                [x0, y0, z_low],
                [x1, y1, z_low],
                [x1, y1, z_high],
                [x0, y0, z_high],
            ];
            for v in &verts {
                POSITIONS.extend_from_slice(v);
                NORMALS.extend_from_slice(&[nx, ny, 0.0]);
            }

            let b = vertex_offset;
            if inverted {
                // Winding was flipped above, so reverse triangle order to keep front-face.
                INDICES.extend_from_slice(&[b, b + 2, b + 1, b, b + 3, b + 2]);
            } else {
                INDICES.extend_from_slice(&[b, b + 1, b + 2, b, b + 2, b + 3]);
            }
            vertex_offset += 4;
        }

        // ── Bottom cap (z = z_low, normal = (0, 0, −1)) ───────────────────
        // Fan triangulation from vertex 0: triangles (0, i+1, i) for reversed winding.
        let bottom_base = vertex_offset;
        for i in 0..n {
            POSITIONS.extend_from_slice(&[xs[i], ys[i], z_low]);
            NORMALS.extend_from_slice(&[0.0, 0.0, -1.0]);
        }
        for i in 1..(n as u32 - 1) {
            INDICES.extend_from_slice(&[bottom_base, bottom_base + i + 1, bottom_base + i]);
        }
        vertex_offset += n as u32;

        // ── Top cap (z = z_high, normal = (0, 0, +1)) ────────────────────
        // Fan triangulation from vertex 0: triangles (0, i, i+1).
        let top_base = vertex_offset;
        for i in 0..n {
            POSITIONS.extend_from_slice(&[xs[i], ys[i], z_high]);
            NORMALS.extend_from_slice(&[0.0, 0.0, 1.0]);
        }
        for i in 1..(n as u32 - 1) {
            INDICES.extend_from_slice(&[top_base, top_base + i, top_base + i + 1]);
        }
    }

    // Return vertex count as a success indicator (always > 0 for valid input).
    (6 * n) as u32
}

// ---------------------------------------------------------------------------
// build_instance_matrices — batch TRS → column-major 4×4 matrices
// ---------------------------------------------------------------------------

/// Compute column-major 4×4 instance matrices from compact TRS transforms.
///
/// Produces the exact layout expected by `THREE.InstancedMesh.instanceMatrix`
/// (same as `THREE.Matrix4.compose()` column-major element order).
///
/// `transforms_flat`: flat f32 slice of length 10*n (n ≥ 1), where each
///                    transform is 10 values:
///                    [px, py, pz,  qx, qy, qz, qw,  sx, sy, sz]
///                     ↑ position   ↑ quaternion      ↑ scale
///
/// Output stored in `INSTANCE_MATRICES`: n × 16 f32 values (column-major).
/// Read via `get_matrices_ptr()` / `get_matrices_len()`.
///
/// Returns n (instance count) on success, 0 on bad input.
#[wasm_bindgen]
pub fn build_instance_matrices(transforms_flat: &[f32]) -> u32 {
    if transforms_flat.len() < 10 || transforms_flat.len() % 10 != 0 {
        return 0;
    }
    let n = transforms_flat.len() / 10;

    // SAFETY: single-threaded Wasm — no concurrent access.
    unsafe {
        INSTANCE_MATRICES.clear();
        INSTANCE_MATRICES.reserve(n * 16);

        for i in 0..n {
            let base = i * 10;
            let (px, py, pz) = (transforms_flat[base],     transforms_flat[base + 1], transforms_flat[base + 2]);
            let (qx, qy, qz, qw) = (transforms_flat[base + 3], transforms_flat[base + 4],
                                    transforms_flat[base + 5], transforms_flat[base + 6]);
            let (sx, sy, sz) = (transforms_flat[base + 7], transforms_flat[base + 8], transforms_flat[base + 9]);

            // Quaternion → rotation terms (same as THREE.Matrix4.compose).
            let x2 = qx + qx; let y2 = qy + qy; let z2 = qz + qz;
            let xx = qx * x2; let xy = qx * y2; let xz = qx * z2;
            let yy = qy * y2; let yz = qy * z2; let zz = qz * z2;
            let wx = qw * x2; let wy = qw * y2; let wz = qw * z2;

            // Column-major 4×4 matrix (matches THREE.Matrix4.elements layout):
            //   col 0: [te0, te1, te2, 0]
            //   col 1: [te4, te5, te6, 0]
            //   col 2: [te8, te9, te10, 0]
            //   col 3: [tx,  ty,  tz,  1]
            let mat: [f32; 16] = [
                (1.0 - (yy + zz)) * sx,  // te[0]  col0 row0
                (xy + wz)         * sx,  // te[1]  col0 row1
                (xz - wy)         * sx,  // te[2]  col0 row2
                0.0,                     // te[3]
                (xy - wz)         * sy,  // te[4]  col1 row0
                (1.0 - (xx + zz)) * sy,  // te[5]  col1 row1
                (yz + wx)         * sy,  // te[6]  col1 row2
                0.0,                     // te[7]
                (xz + wy)         * sz,  // te[8]  col2 row0
                (yz - wx)         * sz,  // te[9]  col2 row1
                (1.0 - (xx + yy)) * sz,  // te[10] col2 row2
                0.0,                     // te[11]
                px,                      // te[12] col3 row0  (translation x)
                py,                      // te[13] col3 row1  (translation y)
                pz,                      // te[14] col3 row2  (translation z)
                1.0,                     // te[15]
            ];
            INSTANCE_MATRICES.extend_from_slice(&mat);
        }
    }

    n as u32
}

// ---------------------------------------------------------------------------
// Pointer getters for instance matrices
// ---------------------------------------------------------------------------

/// Pointer to the start of the instance-matrix buffer in Wasm linear memory.
#[wasm_bindgen]
pub fn get_matrices_ptr() -> *const f32 {
    unsafe { INSTANCE_MATRICES.as_ptr() }
}

/// Number of f32 elements in the instance-matrix buffer (n × 16).
#[wasm_bindgen]
pub fn get_matrices_len() -> usize {
    unsafe { INSTANCE_MATRICES.len() }
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

    // ── build_extruded_profile ─────────────────────────────────────────────

    /// Unit square profile (CCW, n=4), positive height.
    /// Counts must match build_cuboid_geometry for the same shape.
    #[test]
    fn test_extruded_square_profile_counts() {
        // CCW unit square: (0,0), (1,0), (1,1), (0,1)
        let profile: [f32; 8] = [0.0, 0.0,  1.0, 0.0,  1.0, 1.0,  0.0, 1.0];
        let count = build_extruded_profile(&profile, 1.0);
        assert_eq!(count, 24); // 6n = 6*4

        unsafe {
            assert_eq!(POSITIONS.len(), 72); // 6n*3 = 72
            assert_eq!(NORMALS.len(),   72);
            assert_eq!(INDICES.len(),   36); // (4n-4)*3 = 36
        }
    }

    /// Negative height must produce same counts (z_low/z_high swap).
    #[test]
    fn test_extruded_profile_negative_height_counts() {
        let profile: [f32; 8] = [0.0, 0.0,  1.0, 0.0,  1.0, 1.0,  0.0, 1.0];
        let count = build_extruded_profile(&profile, -1.0);
        assert_eq!(count, 24);

        unsafe {
            assert_eq!(POSITIONS.len(), 72);
            assert_eq!(INDICES.len(),   36);
        }
    }

    /// Triangle profile (n=3): minimal valid polygon.
    #[test]
    fn test_extruded_triangle_profile_counts() {
        // Equilateral-ish triangle: (0,0), (1,0), (0.5, 1)
        let profile: [f32; 6] = [0.0, 0.0,  1.0, 0.0,  0.5, 1.0];
        let count = build_extruded_profile(&profile, 2.0);
        assert_eq!(count, 18); // 6*3

        // sides: 3 quads × 6 idx = 18; top cap: 1 tri × 3 = 3; bottom cap: 1 tri × 3 = 3 → 24
        unsafe {
            assert_eq!(POSITIONS.len(), 54); // 6*3 verts × 3 coords
            assert_eq!(INDICES.len(),   24);
        }
    }

    /// Side normals of a CCW square must be axis-aligned outward.
    #[test]
    fn test_extruded_square_side_normals() {
        // CCW unit square: (0,0)→(1,0)→(1,1)→(0,1)
        // Edge 0→1 (going +X): outward normal should be (0, -1, 0)
        // Edge 1→2 (going +Y): outward normal should be (1,  0, 0)
        let profile: [f32; 8] = [0.0, 0.0,  1.0, 0.0,  1.0, 1.0,  0.0, 1.0];
        build_extruded_profile(&profile, 1.0);

        unsafe {
            // Side face 0 — first vertex normal
            let nx0 = NORMALS[0];
            let ny0 = NORMALS[1];
            let nz0 = NORMALS[2];
            assert!(nx0.abs() < 1e-5,        "edge0 nx={}", nx0);
            assert!((ny0 + 1.0).abs() < 1e-5, "edge0 ny={}", ny0);
            assert!(nz0.abs() < 1e-5,         "edge0 nz={}", nz0);

            // Side face 1 — first vertex normal (offset by 4 verts × 3 floats = 12)
            let nx1 = NORMALS[12];
            let ny1 = NORMALS[13];
            let nz1 = NORMALS[14];
            assert!((nx1 - 1.0).abs() < 1e-5, "edge1 nx={}", nx1);
            assert!(ny1.abs() < 1e-5,          "edge1 ny={}", ny1);
            assert!(nz1.abs() < 1e-5,          "edge1 nz={}", nz1);
        }
    }

    /// Rejects empty / odd-length input.
    #[test]
    fn test_extruded_profile_rejects_bad_input() {
        assert_eq!(build_extruded_profile(&[], 1.0), 0);
        assert_eq!(build_extruded_profile(&[0.0; 5], 1.0), 0); // odd
        assert_eq!(build_extruded_profile(&[0.0; 4], 1.0), 0); // n=2 < 3
    }

    // ── build_instance_matrices ────────────────────────────────────────────

    /// Identity transform → identity matrix.
    #[test]
    fn test_instance_matrices_identity() {
        // position=(0,0,0), quaternion=(0,0,0,1), scale=(1,1,1)
        let t: [f32; 10] = [0.0, 0.0, 0.0,  0.0, 0.0, 0.0, 1.0,  1.0, 1.0, 1.0];
        let n = build_instance_matrices(&t);
        assert_eq!(n, 1);

        unsafe {
            assert_eq!(INSTANCE_MATRICES.len(), 16);
            // Column-major identity: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]
            let expected: [f32; 16] = [
                1.0, 0.0, 0.0, 0.0,
                0.0, 1.0, 0.0, 0.0,
                0.0, 0.0, 1.0, 0.0,
                0.0, 0.0, 0.0, 1.0,
            ];
            for (i, &v) in INSTANCE_MATRICES.iter().enumerate() {
                assert!((v - expected[i]).abs() < 1e-5, "mat[{}]={} expected {}", i, v, expected[i]);
            }
        }
    }

    /// Pure translation → only last column differs from identity.
    #[test]
    fn test_instance_matrices_translation() {
        let t: [f32; 10] = [3.0, 4.0, 5.0,  0.0, 0.0, 0.0, 1.0,  1.0, 1.0, 1.0];
        build_instance_matrices(&t);

        unsafe {
            assert!((INSTANCE_MATRICES[12] - 3.0).abs() < 1e-5);
            assert!((INSTANCE_MATRICES[13] - 4.0).abs() < 1e-5);
            assert!((INSTANCE_MATRICES[14] - 5.0).abs() < 1e-5);
            assert!((INSTANCE_MATRICES[15] - 1.0).abs() < 1e-5);
        }
    }

    /// Uniform scale 2 → diagonal = 2.
    #[test]
    fn test_instance_matrices_scale() {
        let t: [f32; 10] = [0.0, 0.0, 0.0,  0.0, 0.0, 0.0, 1.0,  2.0, 2.0, 2.0];
        build_instance_matrices(&t);

        unsafe {
            assert!((INSTANCE_MATRICES[0]  - 2.0).abs() < 1e-5); // te[0]
            assert!((INSTANCE_MATRICES[5]  - 2.0).abs() < 1e-5); // te[5]
            assert!((INSTANCE_MATRICES[10] - 2.0).abs() < 1e-5); // te[10]
        }
    }

    /// Batch: two transforms → 32 matrix elements.
    #[test]
    fn test_instance_matrices_batch_count() {
        let t: [f32; 20] = [
            0.0, 0.0, 0.0,  0.0, 0.0, 0.0, 1.0,  1.0, 1.0, 1.0,
            1.0, 2.0, 3.0,  0.0, 0.0, 0.0, 1.0,  1.0, 1.0, 1.0,
        ];
        let n = build_instance_matrices(&t);
        assert_eq!(n, 2);
        unsafe { assert_eq!(INSTANCE_MATRICES.len(), 32); }
    }

    /// Rejects bad input (not multiple of 10, or empty).
    #[test]
    fn test_instance_matrices_rejects_bad_input() {
        assert_eq!(build_instance_matrices(&[]), 0);
        assert_eq!(build_instance_matrices(&[0.0; 9]), 0);
        assert_eq!(build_instance_matrices(&[0.0; 11]), 0);
    }
}
