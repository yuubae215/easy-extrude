/**
 * arrangementGeometry (domain) — the STATE of a relation: what the layout itself
 * says about two bodies (ADR-168 D4 — 「state は対象の主張」).
 *
 * Derived, never stored: storing it would be a second copy of the poses (§1.1).
 * Pure and THREE-free (runs under bare `node --test`). Closed-form geometry only
 * — the interval of a box's corners on three axes and the sign of a coordinate
 * (CLAUDE.md §AI 向けガード axis 3). It decides no cost: how badly a relation is
 * broken is a graded quantity and belongs to `core/` (ADR-146 axis 1).
 *
 * ## The three readings (frames of reference — ADR-168 力学 3)
 *
 *   contact   touching | apart | overlapping, read in the PARTNER's body frame.
 *   face      when touching: which side of the partner's touched surface the
 *             subject is on, as the partner's local face word (ADR-152 `+x … -z`).
 *             A surface's word is the direction FROM it TO the subject, so the
 *             top of a workbench and the inner floor of a bin both say `+z` — the
 *             subject rests on the +z side of both. (Inside vs outside a cavity is
 *             a separate fact that has no word yet — docs/SPATIAL_RELATION_MODEL.md.)
 *   vertical  when apart: above | below in the WORLD (gravity, +Z), or null.
 *   relative  when apart: front | back | left | right as seen by a declared
 *             viewer (domain/viewerFrame.js), by the bodies' centres.
 *
 * ## Approximation, said not hidden
 *
 * A rotated subject is read through the bounding interval of its 8 corners in
 * the partner's frame. That interval contains the body, so the reading is
 * conservative toward `touching` near an edge: a corner gap smaller than the
 * box's own tilt may read as touching. Exact box-box distance is a search
 * (GJK), which this module does not do.
 *
 * Units: the scene's (mm — ADR-136).
 *
 * @module domain/arrangementGeometry
 */
import { rotateVec3 } from './rotateVec3.js'
import { isContainer, shellParts } from './hollowBody.js'

/**
 * Two surfaces this close (mm) are touching. The ONE contact tolerance of the
 * relation vocabulary (ADR-168 D1). Declared in mm on purpose: the older
 * `SemanticInferencer.CONTACT_THRESHOLD` (0.15 "units") predates the mm world
 * (ADR-136) and moves onto this constant in ADR-168 S2.
 */
export const CONTACT_TOLERANCE_MM = 1

/**
 * Two positions closer than this (mm) along an axis are neither in front nor
 * behind, neither left nor right, neither above nor below. A dead band, so a
 * relation does not flip sign on a rounding error.
 */
export const DIRECTION_DEADBAND_MM = 1

/** Observed contact values. `overlapping` is observable but not declarable. */
export const OBSERVED_CONTACT = Object.freeze({
  TOUCHING:    'touching',
  APART:       'apart',
  OVERLAPPING: 'overlapping',
})

const IDENTITY = Object.freeze({ x: 0, y: 0, z: 0, w: 1 })
const AXES = Object.freeze(['x', 'y', 'z'])

/**
 * @typedef {{x:number,y:number,z:number}} Vec3
 * @typedef {{x:number,y:number,z:number,w:number}} Quat
 * @typedef {{center: Vec3, size: Vec3, rotation?: Quat, inner?: Vec3|null}} Body
 *          A box body: centre and full size in mm, orientation, and (for a
 *          container — ADR-155) its cavity size.
 * @typedef {{position: Vec3, rotation?: Quat}} Viewer
 */

const conj = (q) => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w })
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })

/** The 8 world corners of a body. */
export function worldCorners(body) {
  const q = body.rotation ?? IDENTITY
  const corners = []
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const local = { x: sx * body.size.x / 2, y: sy * body.size.y / 2, z: sz * body.size.z / 2 }
    const r = rotateVec3(local, q)
    corners.push({ x: body.center.x + r.x, y: body.center.y + r.y, z: body.center.z + r.z })
  }
  return corners
}

/** Per-axis [min, max] of a set of points. */
function intervals(points) {
  const out = {}
  for (const a of AXES) {
    let lo = Infinity, hi = -Infinity
    for (const p of points) { lo = Math.min(lo, p[a]); hi = Math.max(hi, p[a]) }
    out[a] = { min: lo, max: hi }
  }
  return out
}

/**
 * The boxes a partner is made of, in its own body frame: one box for a solid,
 * the floor and four walls for a container (derived by `hollowBody.shellParts`
 * — the same shell the mesh draws and the solver judges, §1.1).
 */
function partnerParts(partner) {
  if (isContainer({ innerDimensions: partner.inner })) {
    return shellParts(partner.size, partner.inner).map(p => ({ center: p.center, half: p.half }))
  }
  return [{ center: { x: 0, y: 0, z: 0 },
            half: { x: partner.size.x / 2, y: partner.size.y / 2, z: partner.size.z / 2 } }]
}

/**
 * Contact between `subject` and `partner`, read in the partner's frame.
 *
 * Per partner box and axis a, the signed separation is
 *   d_a = max(s_a.min − (c_a + h_a),  (c_a − h_a) − s_a.max)
 * (> 0: a gap along a; < 0: the intervals overlap along a). The box is touched
 * when max_a d_a ∈ [−ε, ε], penetrated when max_a d_a < −ε, and apart otherwise.
 * The touched faces are the axes with |d_a| ≤ ε, signed by which side the
 * subject lies on.
 *
 * @param {Body} subject
 * @param {Body} partner
 * @returns {{contact: 'touching'|'apart'|'overlapping', faces: string[], gap: number|null}}
 *          `gap` (mm) when apart: the largest separation along one of the
 *          partner's axes — a LOWER bound of the true distance. Declaring a
 *          gap is 未実装 until the true distance is measured (DEF-072).
 */
export function observeContact(subject, partner) {
  const inv = conj(partner.rotation ?? IDENTITY)
  const local = worldCorners(subject).map(c => rotateVec3(sub(c, partner.center), inv))
  const s = intervals(local)
  const eps = CONTACT_TOLERANCE_MM

  let overlapping = false
  let gap = Infinity
  const faces = new Set()
  for (const part of partnerParts(partner)) {
    const d = {}
    const side = {}
    for (const a of AXES) {
      const above = s[a].min - (part.center[a] + part.half[a])
      const below = (part.center[a] - part.half[a]) - s[a].max
      d[a] = Math.max(above, below)
      side[a] = above >= below ? '+' : '-'
    }
    const worst = Math.max(d.x, d.y, d.z)
    if (worst < -eps) { overlapping = true; continue }
    if (worst > eps) { gap = Math.min(gap, worst); continue }
    for (const a of AXES) if (Math.abs(d[a]) <= eps) faces.add(`${side[a]}${a}`)
  }
  if (overlapping) return { contact: OBSERVED_CONTACT.OVERLAPPING, faces: [], gap: null }
  if (faces.size > 0) return { contact: OBSERVED_CONTACT.TOUCHING, faces: [...faces].sort(), gap: null }
  return { contact: OBSERVED_CONTACT.APART, faces: [], gap }
}

/**
 * Above / below in the world (gravity — the absolute frame), or null when the
 * two bodies' height ranges are not separated by more than the dead band.
 * @param {Body} subject
 * @param {Body} partner
 * @returns {'above'|'below'|null}
 */
export function observeVertical(subject, partner) {
  const s = intervals(worldCorners(subject)).z
  const p = intervals(worldCorners(partner)).z
  if (s.min - p.max > DIRECTION_DEADBAND_MM) return 'above'
  if (p.min - s.max > DIRECTION_DEADBAND_MM) return 'below'
  return null
}

/**
 * The relative directions that hold for `subject` against `partner`, as seen
 * by `viewer` (+X the way the viewer faces, +Y the viewer's left — REP-103).
 * Read by the bodies' centres in the viewer's frame: `front` = nearer to the
 * viewer, `back` = farther, `left` / `right` = the viewer's sides. Several can
 * hold at once (front AND left); none holds inside the dead band.
 *
 * @param {Body} subject
 * @param {Body} partner
 * @param {Viewer} viewer
 * @returns {Array<'front'|'back'|'left'|'right'>}
 */
export function observeRelative(subject, partner, viewer) {
  const inv = conj(viewer.rotation ?? IDENTITY)
  const s = rotateVec3(sub(subject.center, viewer.position), inv)
  const p = rotateVec3(sub(partner.center, viewer.position), inv)
  /** @type {Array<'front'|'back'|'left'|'right'>} */
  const out = []
  const db = DIRECTION_DEADBAND_MM
  if (s.x < p.x - db) out.push('front')
  if (s.x > p.x + db) out.push('back')
  if (s.y > p.y + db) out.push('left')
  if (s.y < p.y - db) out.push('right')
  return out
}
