/**
 * VoxelModel - pure data model and side-effect-free functions for voxel shapes
 *
 * No side effects. Every function returns a value based solely on its arguments.
 *
 * Coordinate system: ROS world frame (+X forward, +Y left, +Z up).
 * Voxels live on an integer grid. VoxelShape adds a float offset for world placement.
 *
 * VoxelShape = { voxels: Map<"ix,iy,iz", {ix,iy,iz}>, offset: THREE.Vector3 }
 */
import * as THREE from 'three'

// ── Face definitions ──────────────────────────────────────────────────────────
// Each face: outward direction + 4 vertex offsets relative to voxel corner (ix,iy,iz).
// Offsets chosen so that (v1-v0) x (v2-v0) == outward normal (correct CCW winding).
export const VOXEL_FACE_DEFS = [
  { name: 'Front (+X)', dx:  1, dy:  0, dz:  0, offsets: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]] },
  { name: 'Back (-X)',  dx: -1, dy:  0, dz:  0, offsets: [[0,0,0],[0,0,1],[0,1,1],[0,1,0]] },
  { name: 'Left (+Y)',  dx:  0, dy:  1, dz:  0, offsets: [[0,1,0],[0,1,1],[1,1,1],[1,1,0]] },
  { name: 'Right (-Y)', dx:  0, dy: -1, dz:  0, offsets: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]] },
  { name: 'Top (+Z)',   dx:  0, dy:  0, dz:  1, offsets: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]] },
  { name: 'Bottom (-Z)',dx:  0, dy:  0, dz: -1, offsets: [[0,0,0],[0,1,0],[1,1,0],[1,0,0]] },
]

// ── Key encoding ──────────────────────────────────────────────────────────────

export const voxelKey = (ix, iy, iz) => `${ix},${iy},${iz}`

// ── Shape creation ────────────────────────────────────────────────────────────

/** Returns a new empty VoxelShape */
export function createVoxelShape() {
  return { voxels: new Map(), offset: new THREE.Vector3() }
}

/** Deep-clones a VoxelShape (voxels + offset) */
export function cloneVoxelShape(shape) {
  const c = createVoxelShape()
  c.offset.copy(shape.offset)
  for (const [k, v] of shape.voxels) c.voxels.set(k, { ...v })
  return c
}

export function addVoxel(shape, ix, iy, iz) {
  shape.voxels.set(voxelKey(ix, iy, iz), { ix, iy, iz })
}

export function removeVoxel(shape, ix, iy, iz) {
  shape.voxels.delete(voxelKey(ix, iy, iz))
}

/**
 * Creates a w x h x d box of voxels, centered at the world origin.
 * @param {number} w  width  (+X)
 * @param {number} h  height (+Y)
 * @param {number} d  depth  (+Z)
 */
export function createBoxVoxels(w, h, d) {
  const shape = createVoxelShape()
  for (let ix = 0; ix < w; ix++)
    for (let iy = 0; iy < h; iy++)
      for (let iz = 0; iz < d; iz++)
        addVoxel(shape, ix, iy, iz)
  shape.offset.set(-w / 2, -h / 2, -d / 2)
  return shape
}

// ── Geometry ──────────────────────────────────────────────────────────────────

/**
 * Returns voxels that have an exposed face in the given direction.
 * @param {{ voxels: Map }} shape
 * @param {{ dx: number, dy: number, dz: number }} dir
 */
export function getSurfaceVoxels(shape, dir) {
  const { dx, dy, dz } = dir
  const result = []
  for (const v of shape.voxels.values()) {
    if (!shape.voxels.has(voxelKey(v.ix + dx, v.iy + dy, v.iz + dz))) {
      result.push(v)
    }
  }
  return result
}

/**
 * Returns an array of exposed-face descriptors (faces with no adjacent voxel).
 * Vertex positions include shape.offset.
 *
 * FaceDescriptor = { name, dir:{dx,dy,dz}, voxel:{ix,iy,iz}, verts:[THREE.Vector3 x4] }
 *
 * Face index fi in this array == Math.floor(hit.face.a / 4) from Three.js raycasting
 * against the geometry built by buildGeometryFromVoxels().
 */
export function computeExposedFaces(shape) {
  const { x: ox, y: oy, z: oz } = shape.offset
  const result = []
  for (const { ix, iy, iz } of shape.voxels.values()) {
    for (const face of VOXEL_FACE_DEFS) {
      if (!shape.voxels.has(voxelKey(ix + face.dx, iy + face.dy, iz + face.dz))) {
        result.push({
          name:  face.name,
          dir:   { dx: face.dx, dy: face.dy, dz: face.dz },
          voxel: { ix, iy, iz },
          verts: face.offsets.map(([ox2, oy2, oz2]) =>
            new THREE.Vector3(ix + ox2 + ox, iy + oy2 + oy, iz + oz2 + oz)),
        })
      }
    }
  }
  return result
}

/**
 * Builds a BufferGeometry from the exposed faces of shape.
 * Quads are ordered: vertex 0..3 per face, two triangles (0,1,2) and (0,2,3).
 * This guarantees Math.floor(hit.face.a / 4) == face index.
 *
 * @returns {{ geometry: THREE.BufferGeometry, exposedFaces: FaceDescriptor[] }}
 */
export function buildGeometryFromVoxels(shape) {
  const faces = computeExposedFaces(shape)
  const n     = faces.length
  const pos   = new Float32Array(n * 4 * 3)
  const norm  = new Float32Array(n * 4 * 3)
  const idx   = []

  faces.forEach((face, fi) => {
    const { dx, dy, dz } = face.dir
    face.verts.forEach((v, vi) => {
      const i = (fi * 4 + vi) * 3
      pos[i]  = v.x; pos[i+1]  = v.y; pos[i+2]  = v.z
      norm[i] = dx;  norm[i+1] = dy;  norm[i+2] = dz
    })
    const b = fi * 4
    idx.push(b, b+1, b+2,  b, b+2, b+3)
  })

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('normal',   new THREE.BufferAttribute(norm, 3))
  geo.setIndex(idx)
  return { geometry: geo, exposedFaces: faces }
}

// ── Extrude / retract ─────────────────────────────────────────────────────────

/**
 * Returns a new VoxelShape with the face in `dir` extruded/retracted by `steps` voxels.
 *   steps > 0 : add layers outward
 *   steps < 0 : remove layers inward (stops before the shape would become empty)
 *   steps = 0 : returns a clone with no change
 */
export function extrudeVoxelFace(baseShape, dir, steps) {
  const newShape = cloneVoxelShape(baseShape)
  if (steps === 0) return newShape

  if (steps > 0) {
    // Iteratively push the surface outward, one layer at a time.
    let surface = getSurfaceVoxels(baseShape, dir)
    for (let s = 0; s < steps; s++) {
      surface = surface.map(v => ({
        ix: v.ix + dir.dx,
        iy: v.iy + dir.dy,
        iz: v.iz + dir.dz,
      }))
      surface.forEach(v => addVoxel(newShape, v.ix, v.iy, v.iz))
    }
  } else {
    // Iteratively remove the surface layer inward, keeping at least 1 voxel.
    for (let s = 0; s < -steps; s++) {
      const surface = getSurfaceVoxels(newShape, dir)
      if (surface.length === 0 || newShape.voxels.size <= surface.length) break
      surface.forEach(v => removeVoxel(newShape, v.ix, v.iy, v.iz))
    }
  }

  return newShape
}

// ── Bounding box / centroid ───────────────────────────────────────────────────

/**
 * Returns the axis-aligned bounding box of the voxel shape in world space.
 * Accounts for shape.offset. Min/max are the outer corners (voxel extends +1 from ix/iy/iz).
 */
export function getVoxelBoundingBox(shape) {
  if (shape.voxels.size === 0) {
    const o = shape.offset.clone()
    return { min: o.clone(), max: o.clone() }
  }
  const { x: ox, y: oy, z: oz } = shape.offset
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (const { ix, iy, iz } of shape.voxels.values()) {
    if (ix     < minX) minX = ix
    if (ix + 1 > maxX) maxX = ix + 1
    if (iy     < minY) minY = iy
    if (iy + 1 > maxY) maxY = iy + 1
    if (iz     < minZ) minZ = iz
    if (iz + 1 > maxZ) maxZ = iz + 1
  }
  return {
    min: new THREE.Vector3(minX + ox, minY + oy, minZ + oz),
    max: new THREE.Vector3(maxX + ox, maxY + oy, maxZ + oz),
  }
}

/** Returns the centroid (center of the bounding box) of the voxel shape in world space. */
export function getVoxelCentroid(shape) {
  const { min, max } = getVoxelBoundingBox(shape)
  return new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5)
}

/**
 * Returns pivot point candidates for grab: bounding-box corners, face centers,
 * centroid, and world origin.
 */
export function getVoxelPivotCandidates(shape) {
  const { min, max } = getVoxelBoundingBox(shape)
  const cx = (min.x + max.x) / 2
  const cy = (min.y + max.y) / 2
  const cz = (min.z + max.z) / 2
  const candidates = []

  for (const x of [min.x, max.x])
    for (const y of [min.y, max.y])
      for (const z of [min.z, max.z])
        candidates.push({ label: 'Corner', position: new THREE.Vector3(x, y, z) })

  candidates.push(
    { label: 'Front (+X)', position: new THREE.Vector3(max.x, cy,    cz)    },
    { label: 'Back (-X)',  position: new THREE.Vector3(min.x, cy,    cz)    },
    { label: 'Left (+Y)',  position: new THREE.Vector3(cx,    max.y, cz)    },
    { label: 'Right (-Y)', position: new THREE.Vector3(cx,    min.y, cz)    },
    { label: 'Top (+Z)',   position: new THREE.Vector3(cx,    cy,    max.z) },
    { label: 'Bottom (-Z)',position: new THREE.Vector3(cx,    cy,    min.z) },
    { label: 'Centroid',   position: new THREE.Vector3(cx,    cy,    cz)    },
    { label: 'World Origin', position: new THREE.Vector3(0, 0, 0) },
  )

  return candidates
}

// ── Utility (shared with other modules) ──────────────────────────────────────

/** Converts mouse client coordinates to NDC. */
export function toNDC(clientX, clientY, width, height) {
  return new THREE.Vector2(
    (clientX / width)  *  2 - 1,
    (clientY / height) * -2 + 1,
  )
}
