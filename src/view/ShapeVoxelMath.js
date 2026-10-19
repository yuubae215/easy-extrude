/**
 * ShapeVoxelMath — the lifecycle voxels are cut FROM THE ENTITY'S OWN SHAPE
 * (ADR-166 M5, 2026-10-19). Pure and THREE-free (`node --test`).
 *
 * Why (stakeholder, watching the ADR-166 before/after walk): "the particles are
 * coarse, so it still looks old" and "when it converges, the voxels gather into
 * one point and a bigger cube is there — the cube seems to appear all at once".
 * Both came from one fact: the old `VoxelBurst` did not know the shape. It drew
 * 40 voxels sized `radius × 0.11` on a sphere around the centre, so a long Zone
 * got a few big blocks (coarse), and the materialize converged them onto the
 * centre point, where the additive overlap read as a white cube (the pop).
 *
 * Here each voxel IS a cell of the entity's surface: a dissolve breaks the
 * entity into its own cells, which leave from where they were; a materialize
 * flies every cell back to ITS place, so the shape is laid down piece by piece
 * and nothing ever gathers at a point. The cell size follows from the surface
 * area and a fixed cell budget, so a large entity gets more cells, not bigger
 * ones (原則 #27 — the same picture in mm and m scenes).
 *
 * Vocabulary (原則 #33): a `shape` is what the cells are cut from —
 *   { kind: 'surface', polygons, faceUp? } planar polygons (a Solid's 6 faces,
 *                                          one Zone / Profile sheet; `faceUp`
 *                                          turns a single sheet to face +Z)
 *   { kind: 'path', points }               a polyline (an annotated line)
 * Which entity has which shape is declared in `controller/lifecycleShape.js`.
 */
import { clamp01, easeInCubic, easeOutExpo, easeOutQuad } from './MotionMath.js'

/** Cells per entity — one InstancedMesh, one draw call, whatever the count. */
export const VOXEL_BUDGET = Object.freeze({ surface: 640, path: 160 })

/** Share of the timeline the radial wave spends crossing the entity. */
export const SHATTER_SPREAD = 0.45

/** Voxel edge as a share of the cell pitch — the gap is what reads as voxels. */
export const VOXEL_FILL = 0.82

const EPS = 1e-9
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
const scale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s })
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x })
const len = a => Math.sqrt(dot(a, a))
const unit = a => { const l = len(a); return l > EPS ? scale(a, 1 / l) : { x: 0, y: 0, z: 1 } }

/** Deterministic hash ∈ [0, 1) — replay-identical, no Math.random. */
export function cellHash(index, salt = 0) {
  const s = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453
  return s - Math.floor(s)
}

/** Newell normal (length = 2 × area) of a planar polygon. */
function newell(poly) {
  let n = { x: 0, y: 0, z: 0 }
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]
    n = add(n, { x: (a.y - b.y) * (a.z + b.z), y: (a.z - b.z) * (a.x + b.x), z: (a.x - b.x) * (a.y + b.y) })
  }
  return n
}

function insidePolygon2(pts, x, y) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function boundsOfPoints(points) {
  const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity }
  for (const p of points) {
    for (const k of ['x', 'y', 'z']) { if (p[k] < min[k]) min[k] = p[k]; if (p[k] > max[k]) max[k] = p[k] }
  }
  const center = scale(add(min, max), 0.5)
  return { center, reach: len(sub(max, min)) / 2 }
}

const finitePoint = p => p && [p.x, p.y, p.z].every(Number.isFinite)

/** Cells along a polyline at `pitch`, facing +Z. */
function pathCells(points, pitch) {
  const cells = []
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i], d = sub(points[i + 1], a), l = len(d)
    const n = Math.max(1, Math.round(l / pitch))
    for (let k = 0; k < n; k++) cells.push({ p: add(a, scale(d, (k + 0.5) / n)), n: { x: 0, y: 0, z: 1 } })
  }
  return cells
}

function pathLength(points) {
  let l = 0
  for (let i = 0; i + 1 < points.length; i++) l += len(sub(points[i + 1], points[i]))
  return l
}

/**
 * Cut a shape into voxel cells.
 *
 * @param {{kind:'surface', polygons:Array<Array<{x,y,z}>>, faceUp?:boolean}
 *        |{kind:'path', points:Array<{x,y,z}>}} shape
 * @returns {{pitch:number, center:{x,y,z}, reach:number,
 *            cells:Array<{p:{x,y,z}, n:{x,y,z}}>}|null}
 *   `null` when the shape has no extent to cut (#11: the caller spawns nothing,
 *   it does not invent a cloud).
 */
export function voxelCells(shape) {
  if (!shape) return null
  if (shape.kind === 'path') {
    const pts = (shape.points ?? []).filter(finitePoint)
    const L = pts.length >= 2 ? pathLength(pts) : 0
    if (!(L > EPS)) return null
    const pitch = L / VOXEL_BUDGET.path
    return { pitch, ...boundsOfPoints(pts), cells: pathCells(pts, pitch) }
  }
  if (shape.kind !== 'surface') throw new Error(`voxelCells: undeclared shape kind ${shape.kind}`)

  const polys = (shape.polygons ?? []).filter(p => Array.isArray(p) && p.length >= 3 && p.every(finitePoint))
  if (polys.length === 0) return null
  const all = polys.flat()
  const box = boundsOfPoints(all)
  const area = polys.reduce((s, p) => s + len(newell(p)) / 2, 0)
  if (!(area > EPS * Math.max(1, box.reach * box.reach))) {
    // A sheet with no area (all points on a line) still has an outline to break.
    const outline = polys.flatMap(p => [...p, p[0]])
    const L = pathLength(outline)
    if (!(L > EPS)) return null
    const pitch = L / VOXEL_BUDGET.path
    return { pitch, ...box, cells: pathCells(outline, pitch) }
  }

  const pitch = Math.sqrt(area / VOXEL_BUDGET.surface)
  const cells = []
  for (const poly of polys) {
    let n = unit(newell(poly))
    if (shape.faceUp && n.z < 0) n = scale(n, -1)
    const u = unit(sub(poly[1], poly[0]))
    const v = cross(n, u)
    const o = poly[0]
    const pts2 = poly.map(p => { const d = sub(p, o); return [dot(d, u), dot(d, v)] })
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
    for (const [a, b] of pts2) { minU = Math.min(minU, a); maxU = Math.max(maxU, a); minV = Math.min(minV, b); maxV = Math.max(maxV, b) }
    // Centre the grid on the face so the margin is even on both sides.
    const nu = Math.max(1, Math.floor((maxU - minU) / pitch)), nv = Math.max(1, Math.floor((maxV - minV) / pitch))
    const su = (maxU - minU) / nu, sv = (maxV - minV) / nv
    // Cells sit on the outside of the face, half a voxel out, so they cover it.
    const lift = scale(n, pitch * VOXEL_FILL * 0.5)
    const before = cells.length
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const a = minU + (i + 0.5) * su, b = minV + (j + 0.5) * sv
        if (!insidePolygon2(pts2, a, b)) continue
        cells.push({ p: add(add(add(o, scale(u, a)), scale(v, b)), lift), n })
      }
    }
    if (cells.length === before) {
      // A face narrower than one cell still gets one, at its centroid.
      const c = scale(poly.reduce((s, p) => add(s, p), { x: 0, y: 0, z: 0 }), 1 / poly.length)
      cells.push({ p: add(c, lift), n })
    }
  }
  return { pitch, ...box, cells }
}

/**
 * Where a cell starts in the timeline ∈ [0, SHATTER_SPREAD]: a radial wave from
 * the entity's centre (the motion identity's "stagger by distance" — there is
 * no touched point for a delete or an undo, so the wave starts where the
 * entity's weight is), roughened by a per-cell hash so the front is not a ring.
 */
export function shatterDelay(cell, center, reach, index) {
  const d = reach > EPS ? Math.min(len(sub(cell.p, center)) / reach, 1) : 0
  return SHATTER_SPREAD * (0.75 * d + 0.25 * cellHash(index, 1))
}

/** Local progress of one cell given its delay (lands by global 1). */
export function cellProgress(progress, delay) {
  const d = Math.min(Math.max(Number.isFinite(delay) ? delay : 0, 0), SHATTER_SPREAD)
  return clamp01((clamp01(progress) - d) / (1 - SHATTER_SPREAD))
}

/**
 * Where a cell flies to (dissolve) or comes from (materialize), as a world
 * offset from its place: off its own face, away from the centre, a little up,
 * each by its own amount — so the cloud keeps the entity's silhouette as it
 * leaves instead of turning into a sphere.
 */
export function scatterOffset(cell, center, reach, pitch, index) {
  const radial = sub(cell.p, center)
  radial.z = 0
  const jitter = { x: cellHash(index, 2) - 0.5, y: cellHash(index, 3) - 0.5, z: cellHash(index, 4) - 0.5 }
  const dir = unit(add(add(add(scale(cell.n, 1), scale(unit(radial), len(radial) > EPS ? 0.7 : 0)), { x: 0, y: 0, z: 0.5 }), scale(jitter, 0.9)))
  const dist = Math.max(reach * 0.55, pitch * 8) * (0.55 + 0.45 * cellHash(index, 5))
  return scale(dir, dist)
}

/**
 * One cell at its own local progress. Roles from the motion identity:
 * position = `land` (outExpo), leaving size = `exit` (inCubic), the light and
 * the melt = `fade` (outQuad). No `spring` — the overshoot belongs to presses
 * and popovers only (the old materialize popped on outBack).
 *
 *   dissolve:    the cell cracks in place (flash toward the stage light), flies
 *                off on `land`, tumbles, and leaves on `exit`.
 *   materialize: the cell flies in to its place on `land`, its tumble unwinds
 *                to zero so it lands square in the grid, lights as it lands,
 *                then melts into the surface on `fade`.
 * Reduced motion: every cell held in place at half size — "this entity just
 * (dis)appeared" is still said, nothing moves (#30/#11).
 *
 * @param {'dissolve'|'materialize'} kind
 * @param {number} lp local progress ∈ [0,1]
 * @param {boolean} [reduced]
 * @returns {{travel:number, size:number, spin:number, flash:number}}
 *   `travel` ∈ [0,1] multiplies `scatterOffset`; `size` multiplies the voxel edge.
 */
export function shatterFrame(kind, lp, reduced = false) {
  if (reduced) return { travel: 0, size: 0.5, spin: 0, flash: 0 }
  const p = clamp01(lp)
  if (kind === 'dissolve') {
    return {
      travel: easeOutExpo(p),
      size:   1 - easeInCubic(p),
      spin:   2.6 * easeOutExpo(p),
      flash:  p < 0.2 ? 1 - easeOutQuad(p / 0.2) : 0,
    }
  }
  if (kind !== 'materialize') throw new Error(`shatterFrame: undeclared kind ${kind}`)
  const LAND = 0.68
  if (p < LAND) {
    const a = p / LAND
    return {
      travel: 1 - easeOutExpo(a),
      size:   0.3 + 0.7 * easeOutExpo(a),
      spin:   -1.6 * (1 - easeOutExpo(a)),
      flash:  a > 0.8 ? easeOutQuad((a - 0.8) / 0.2) : 0,
    }
  }
  const m = (p - LAND) / (1 - LAND)
  return { travel: 0, size: 1 - easeOutQuad(m), spin: 0, flash: 1 - easeOutQuad(m) }
}
