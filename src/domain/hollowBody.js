/**
 * hollowBody — a tray / bin / tote as ONE body: outer size + inner (cavity) size
 * (ADR-133 D1, ADR-155 D2). THREE-free; every consumer that needs the shell —
 * the obstacles sent to `core/` (`graspTargets.hollowBodyBoxes`), the mesh the
 * scene draws (`MeshView.setShell`), the layout validator — derives it here, so
 * the drawn tray and the judged tray cannot disagree (§1.1).
 *
 * ## The words (ADR-155 D4)
 *
 * | word | axis        | rule                          |
 * |------|-------------|-------------------------------|
 * | W    | local +x    | a tray declares W ≥ D         |
 * | D    | local +y    |                               |
 * | H    | local +z    | the top (open side) is +z     |
 *
 * Right-handed, as the world frame (REP-103). The WIRE keeps x / y / z — W/D/H
 * are the names people read, mapped in ONE table (`DIMENSION_WORDS`); a second
 * spelling of the same fact in the schema would be a second source.
 *
 * W ≥ D is the NORMAL FORM of a tray (原則 #28): without it one tray has two
 * spellings (200×150 unrotated, or 150×200 turned 90°), and the face words of
 * ADR-152 would mean different sides on different trays. With it `±x` is always
 * the short end and `±y` always the long side; orientation lives in `rotation`
 * alone. A square (W = D) is legitimate — its two spellings are the same shape.
 *
 * ## The shell
 *
 * One floor plate across the whole outer footprint, two walls across ±x that span
 * the full outer D, two walls across ±y fitted between them (no volume counted
 * twice). Thicknesses are DERIVED — wall = (outer − inner)/2 per horizontal axis,
 * floor = outer.H − inner.H — never declared, so they cannot disagree with the
 * two sizes a person actually measures. The top is open: a lid is another body.
 *
 * @module domain/hollowBody
 */

/** The dimension words and the local axis each names (ADR-155 D4). */
export const DIMENSION_WORDS = Object.freeze([
  Object.freeze({ word: 'W', axis: 'x' }),
  Object.freeze({ word: 'D', axis: 'y' }),
  Object.freeze({ word: 'H', axis: 'z' }),
])

/** The five parts of a shell, in the order every consumer emits them. */
export const SHELL_ROLES = Object.freeze(['floor', 'wall-x', 'wall+x', 'wall-y', 'wall+y'])

/** @typedef {{x:number, y:number, z:number}} Vec3 */

/** @param {unknown} n */
const finite = n => typeof n === 'number' && Number.isFinite(n)

/**
 * Is this body a CONTAINER — does it declare a cavity? The ONE predicate
 * (原則 #25) asked by the pick list (containers are not grasp targets — ADR-133
 * D4), the face picker and Edit Mode (a shell's faces are not the body's six).
 * Works on a scene `Solid` and on a resolved `GraspTarget` alike: both carry
 * `innerDimensions` (null / absent = solid).
 * @param {{innerDimensions?: unknown}|null|undefined} body
 * @returns {boolean}
 */
export function isContainer(body) {
  return isSize(body?.innerDimensions)
}

/**
 * Why a tray cannot enter Edit Mode — quest-phrased. Resizing a tray on screen is
 * 未実装 (DEF-055): it has to move outer and inner together, which is undecided.
 */
export const CONTAINER_EDIT_DEFERRED_REASON =
  'Edit Mode is not available for a tray yet: its faces are the shell, and resizing it means changing the outer and inner size together. Change "dimensions" / "innerDimensions" in the layout for now.'

/** @param {any} v */
export function isSize(v) {
  return !!v && finite(v.x) && finite(v.y) && finite(v.z)
}

/**
 * Full extents (max − min per axis) of a corner set — the one reading of "how big
 * is this box" from corners (the decompiler's `dimensions`, the outer size a
 * cavity is checked against). Body-frame corners give W/D/H.
 * @param {Vec3[]} corners
 * @returns {Vec3}
 */
export function sizeOfCorners(corners) {
  const span = a => Math.max(...corners.map(c => c[a])) - Math.min(...corners.map(c => c[a]))
  return { x: span('x'), y: span('y'), z: span('z') }
}

/** "W 200 × D 150 × H 150" — the one formatter of a size in the W/D/H words. */
export function sizeInWords(size) {
  return DIMENSION_WORDS.map(({ word, axis }) => `${word} ${+size[axis].toFixed(3)}`).join(' × ')
}

/**
 * Why `inner` cannot be the cavity of `outer`, or null when it can — the named
 * precondition (原則 #25). Every inner size must be positive and strictly smaller
 * than the outer one on every axis: equal would be a wall or floor of thickness
 * zero, which is not a thin wall but a declaration error.
 * @param {Vec3} outer
 * @param {Vec3} inner
 * @returns {string|null}
 */
export function hollowBodyGap(outer, inner) {
  if (!isSize(outer) || !isSize(inner)) return 'outer and inner sizes must both be finite {x, y, z}'
  for (const { word, axis } of DIMENSION_WORDS) {
    if (!(inner[axis] > 0)) return `inner ${word} must be > 0 (got ${inner[axis]})`
    if (!(inner[axis] < outer[axis])) {
      return `inner ${word} (${inner[axis]}) must be smaller than outer ${word} (${outer[axis]}) — ` +
        `a wall or floor of thickness 0 is a declaration error, not a thin wall`
    }
  }
  return null
}

/**
 * Why `outer` is not in a tray's normal form (W ≥ D), or null when it is.
 * @param {Vec3} outer
 * @returns {string|null}
 */
export function trayNormalFormGap(outer) {
  if (!isSize(outer)) return 'outer size must be finite {x, y, z}'
  if (outer.x < outer.y) {
    return `a tray declares W ≥ D (long side on local +x): got W ${outer.x} < D ${outer.y} — ` +
      `swap x and y and turn it 90° about +z with "rotation"`
  }
  return null
}

/**
 * The shell's parts in the BODY frame (origin = body centre, mm): each a box
 * given by centre and half extents. Throws on a declaration `hollowBodyGap`
 * rejects — callers ask the predicate first.
 * @param {Vec3} outer
 * @param {Vec3} inner
 * @returns {{role:string, center:Vec3, half:Vec3}[]}
 */
export function shellParts(outer, inner) {
  const gap = hollowBodyGap(outer, inner)
  if (gap) throw new Error(`hollowBody: ${gap}`)
  const ho = { x: outer.x / 2, y: outer.y / 2, z: outer.z / 2 }
  const hi = { x: inner.x / 2, y: inner.y / 2, z: inner.z / 2 }
  const wallX = ho.x - hi.x
  const wallY = ho.y - hi.y
  const floor = outer.z - inner.z
  const cavityZ = -ho.z + floor + hi.z   // the cavity's centre height
  return [
    { role: 'floor',  center: { x: 0, y: 0, z: -ho.z + floor / 2 },          half: { x: ho.x, y: ho.y, z: floor / 2 } },
    { role: 'wall-x', center: { x: -(hi.x + wallX / 2), y: 0, z: cavityZ },  half: { x: wallX / 2, y: ho.y, z: hi.z } },
    { role: 'wall+x', center: { x: +(hi.x + wallX / 2), y: 0, z: cavityZ },  half: { x: wallX / 2, y: ho.y, z: hi.z } },
    { role: 'wall-y', center: { x: 0, y: -(hi.y + wallY / 2), z: cavityZ },  half: { x: hi.x, y: wallY / 2, z: hi.z } },
    { role: 'wall+y', center: { x: 0, y: +(hi.y + wallY / 2), z: cavityZ },  half: { x: hi.x, y: wallY / 2, z: hi.z } },
  ]
}

/**
 * The shell's parts as corner sets in whatever frame `corners` is in (world,
 * usually) — 5 arrays of 8 corners in the Solid corner order (index bits:
 * 1 = +x, 3 = +y, 4 = +z; see `CuboidModel`). Each part corner is the trilinear
 * point `c0 + u·ex + v·ey + w·ez` of the OUTER box, so a moved or rotated body
 * carries its shell with no second transform to keep in step.
 * @param {Vec3[]} corners  the outer body's 8 corners
 * @param {Vec3} outer
 * @param {Vec3} inner
 * @returns {Vec3[][]}
 */
export function shellCornerSets(corners, outer, inner) {
  const c0 = corners[0]
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
  const ex = sub(corners[1], c0), ey = sub(corners[3], c0), ez = sub(corners[4], c0)
  const at = (u, v, w) => ({
    x: c0.x + u * ex.x + v * ey.x + w * ez.x,
    y: c0.y + u * ex.y + v * ey.y + w * ez.y,
    z: c0.z + u * ex.z + v * ey.z + w * ez.z,
  })
  return shellParts(outer, inner).map(({ center: c, half: h }) => {
    const u0 = (c.x - h.x) / outer.x + 0.5, u1 = (c.x + h.x) / outer.x + 0.5
    const v0 = (c.y - h.y) / outer.y + 0.5, v1 = (c.y + h.y) / outer.y + 0.5
    const w0 = (c.z - h.z) / outer.z + 0.5, w1 = (c.z + h.z) / outer.z + 0.5
    return [
      at(u0, v0, w0), at(u1, v0, w0), at(u1, v1, w0), at(u0, v1, w0),
      at(u0, v0, w1), at(u1, v0, w1), at(u1, v1, w1), at(u0, v1, w1),
    ]
  })
}
