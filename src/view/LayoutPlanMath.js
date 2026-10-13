/**
 * LayoutPlanMath — the floor plan on a launch Home card (ADR-166 M4c).
 *
 * A Home card used to say what its cell is only in prose: a name and a
 * sentence the user had to read and imagine (recall). The plan says it the way
 * the scene will (recognition): seen from above, the Zone is a pool of floor
 * light, every Solid is its footprint, a robot base is a lit point, an Anchor
 * is a mark — the same light language as the annotations on the floor
 * (ADR-166 M3a) and the same ONE stage light (M2).
 *
 * THE FACT IS THE COMPILED SCENE (§1.1): the input is `compileLayout(dsl)` —
 * the very JSON a card's click loads — never the DSL re-read here. Positions a
 * strategy computes (the conveyor's `linear` stations carry none in the DSL)
 * therefore come from the one compiler, not from a second reading of it.
 *
 * Pure and THREE-free (bare `node --test` lane). `AppController` hands its
 * bundled template map to `layoutPlanOf` once and puts the plans in the store;
 * the card only draws what it is handed (the TemplateGallery precedent,
 * ADR-062 Phase 5). The compile happens HERE, not in the controller: ADR-162
 * retired AppController compiling a DSL (the compile-and-drop load), and a
 * preview is no reason to bring that shape back — the controller owns only the
 * import side effect, the projection is pure.
 */
import { COLOR } from '../theme/tokens.js'
import { compileLayout } from '../layout/LayoutCompiler.js'
import { PLACE_TYPE_MAP } from '../domain/PlaceTypeRegistry.js'
import { isRobotBaseFrame } from '../domain/robotFrames.js'
import { lightTint, phaseFor } from './MapVisualMath.js'
import { STAGE, STAGE_LIGHT } from './StageMath.js'

/**
 * The card's drawing frame (SVG user units). The plan is scaled UNIFORMLY to
 * fit inside `w × h` less `pad` — so a cell in mm and a site in m draw at the
 * same proportions (the M4b lesson: a fixed world size is invisible in a mm
 * scene, PHILOSOPHY #27).
 */
export const PLAN_FRAME = Object.freeze({ w: 120, h: 64, pad: 6 })

/**
 * What each compiled entity type becomes on the plan. Declared per type —
 * an undeclared type THROWS (PHILOSOPHY #31: a fall-through would make
 * "deliberately not drawn" and "a type nobody thought about" the same).
 *   zone   — a region: the pool of floor light
 *   line   — a route / boundary: a line of light
 *   body   — a Solid: its footprint
 *   frame  — a CoordinateFrame: drawn only if it is a robot base (a lit point);
 *            every other frame (Origin, mounting surfaces, TCP) is not on a plan
 *   mark   — an annotated point
 */
export const PLAN_ROLE_BY_TYPE = Object.freeze({
  AnnotatedRegion: 'zone',
  AnnotatedLine:   'line',
  Solid:           'body',
  CoordinateFrame: 'frame',
  AnnotatedPoint:  'mark',
})

/** How long the plan takes to light, centre → edge, after its card lands (ms). */
export const PLAN_LIGHT_SPREAD = 160

function planRole(type) {
  const role = Object.hasOwn(PLAN_ROLE_BY_TYPE, type) ? PLAN_ROLE_BY_TYPE[type] : undefined
  if (!role) throw new Error(`LayoutPlanMath: no plan role declared for entity type "${type}" — add a row to PLAN_ROLE_BY_TYPE`)
  return role
}

const hex = (n) => `#${(n >>> 0).toString(16).padStart(6, '0').slice(-6)}`

/** The light colour of a place type (its fact hue warmed by the stage light). */
function placeTone(placeType) {
  const entry = PLACE_TYPE_MAP.get(placeType)
  // An unclassified annotation is still lit — by the stage light itself.
  return entry ? hex(lightTint(parseInt(entry.color.slice(1), 16))) : STAGE_LIGHT.color
}

/**
 * Colours of the plan, all derived: place types through `lightTint`, bodies in
 * the neutral entity colour, the robot in the stage light. No literal here —
 * the plan cannot drift from the scene it previews.
 */
export function planTones() {
  return {
    light:  STAGE_LIGHT.color,
    body:   COLOR.entityDefault,
    ground: COLOR.backdropEdge,
    groundLit: COLOR.backdropCenter,
    place:  placeTone,
  }
}

// ── geometry ────────────────────────────────────────────────────────────────

function rotate(q, p) {
  if (!q) return p
  const { x: qx = 0, y: qy = 0, z: qz = 0, w: qw = 1 } = q
  // v' = v + 2w(q×v) + 2 q×(q×v)
  const tx = 2 * (qy * p.z - qz * p.y)
  const ty = 2 * (qz * p.x - qx * p.z)
  const tz = 2 * (qx * p.y - qy * p.x)
  return {
    x: p.x + qw * tx + (qy * tz - qz * ty),
    y: p.y + qw * ty + (qz * tx - qx * tz),
    z: p.z + qw * tz + (qx * ty - qy * tx),
  }
}

const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: (a.z ?? 0) + (b.z ?? 0) })

/** Convex hull (monotone chain) of 2D points, counter-clockwise. */
function hull(points) {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (p.length < 3) return p
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower = []
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop()
    lower.push(q)
  }
  const upper = []
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop()
    upper.push(q)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

/**
 * World position of a frame: its translation composed up the parent chain
 * (a parent Solid contributes position + orientation, a parent frame its own
 * world pose). A broken chain (missing parent, cycle) → null: the frame is not
 * drawn rather than drawn somewhere guessed (#11).
 */
function frameWorld(obj, byId, seen = new Set()) {
  if (seen.has(obj.id)) return null
  seen.add(obj.id)
  const local = obj.translation ?? { x: 0, y: 0, z: 0 }
  if (obj.parentId == null) return { p: local, q: obj.rotation ?? null }
  const parent = byId.get(obj.parentId)
  if (!parent) return null
  let base
  if (parent.type === 'Solid') base = { p: parent.position, q: parent.orientation ?? null }
  else if (parent.type === 'CoordinateFrame') base = frameWorld(parent, byId, seen)
  else return null
  if (!base || !base.p) return null
  return { p: add(base.p, rotate(base.q, local)), q: base.q }
}

// ── the plan ────────────────────────────────────────────────────────────────

/**
 * The floor plan of a compiled layout scene, fitted into `PLAN_FRAME`.
 *
 * Seen from above in the ROS world frame: +X to the right, +Y UP the card
 * (SVG y grows downward, so y is negated). Every item carries `order` ∈ [0,1]:
 * its distance from the plan's centre over the farthest item's — the light
 * comes on from the middle of the cell outward (choreography is radial, from
 * where the light falls — CLAUDE.md motion identity).
 *
 * @param {{objects?: object[]}|null|undefined} scene `compileLayout(dsl)` output
 * @returns {null | {
 *   zones:  Array<{key:string, points:string, tone:string, order:number}>,
 *   lines:  Array<{key:string, points:string, tone:string, order:number}>,
 *   bodies: Array<{key:string, points:string, order:number}>,
 *   robots: Array<{key:string, x:number, y:number, order:number}>,
 *   marks:  Array<{key:string, x:number, y:number, tone:string, order:number}>,
 *   pool:   {x:number, y:number, r:number},
 * }} null when the scene has nothing to draw (never a guessed plan — #11)
 * @throws {Error} for an entity type with no declared plan role
 */
export function layoutPlan(scene) {
  const objects = Array.isArray(scene?.objects) ? scene.objects : []
  const byId = new Map(objects.map(o => [o.id, o]))
  const raw = []   // { kind, key, pts: [{x,y}], tone? }

  for (const o of objects) {
    const role = planRole(o.type)
    if (role === 'zone' || role === 'line') {
      const pts = (o.vertices ?? []).filter(v => Number.isFinite(v?.x) && Number.isFinite(v?.y))
      if (pts.length >= (role === 'zone' ? 3 : 2)) raw.push({ kind: role, key: o.id, pts, tone: placeTone(o.placeType) })
    } else if (role === 'body') {
      if (!o.position || !Array.isArray(o.localCorners) || o.localCorners.length === 0) continue
      const pts = hull(o.localCorners.map(c => add(o.position, rotate(o.orientation, c))))
      if (pts.length >= 3) raw.push({ kind: 'body', key: o.id, pts })
    } else if (role === 'frame') {
      if (!isRobotBaseFrame(o)) continue
      const w = frameWorld(o, byId)
      if (w && Number.isFinite(w.p.x) && Number.isFinite(w.p.y)) raw.push({ kind: 'robot', key: o.id, pts: [w.p] })
    } else if (role === 'mark') {
      const p = o.vertex
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) raw.push({ kind: 'mark', key: o.id, pts: [p], tone: placeTone(o.placeType) })
    }
  }
  if (raw.length === 0) return null

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const r of raw) for (const p of r.pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
  }
  const { w, h, pad } = PLAN_FRAME
  const spanX = Math.max(maxX - minX, 1e-9)
  const spanY = Math.max(maxY - minY, 1e-9)
  // A single point (span 0 on both axes) still lands in the middle.
  const s = (minX === maxX && minY === maxY) ? 1 : Math.min((w - 2 * pad) / spanX, (h - 2 * pad) / spanY)
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
  const map = (p) => ({ x: round(w / 2 + (p.x - cx) * s), y: round(h / 2 - (p.y - cy) * s) })

  const centroid = (pts) => {
    const m = pts.map(map)
    return { x: m.reduce((a, p) => a + p.x, 0) / m.length, y: m.reduce((a, p) => a + p.y, 0) / m.length }
  }
  // The light falls where the work is: on the (first) robot base if there is
  // one, else on the middle of the cell — and comes on outward from there.
  const firstRobot = raw.find(r => r.kind === 'robot')
  const focus = firstRobot ? map(firstRobot.pts[0]) : { x: w / 2, y: h / 2 }
  const dist = raw.map(r => { const c = centroid(r.pts); return Math.hypot(c.x - focus.x, c.y - focus.y) })
  const far = Math.max(...dist, 1e-9)
  const pointsOf = (pts) => pts.map(map).map(p => `${p.x},${p.y}`).join(' ')

  const plan = { zones: [], lines: [], bodies: [], robots: [], marks: [], pool: { x: focus.x, y: focus.y, r: round(Math.max(w, h) * 0.45) } }
  raw.forEach((r, i) => {
    const order = round(dist[i] / far)
    if (r.kind === 'zone')  plan.zones.push({ key: r.key, points: pointsOf(r.pts), tone: r.tone, order })
    if (r.kind === 'line')  plan.lines.push({ key: r.key, points: pointsOf(r.pts), tone: r.tone, order })
    if (r.kind === 'body')  plan.bodies.push({ key: r.key, points: pointsOf(r.pts), order })
    if (r.kind === 'robot') plan.robots.push({ key: r.key, ...map(r.pts[0]), order })
    if (r.kind === 'mark')  plan.marks.push({ key: r.key, ...map(r.pts[0]), tone: r.tone, order })
  })
  return plan
}

/**
 * The plan of a Layout DSL document: compile it (the same compiler as the load
 * path) and project. Throws what the compiler throws (an invalid DSL) — the
 * caller decides how a card without a plan degrades.
 *
 * @param {object} dsl Layout DSL (layout/1.0)
 */
export function layoutPlanOf(dsl) {
  return layoutPlan(compileLayout(dsl))
}

function round(v) { return Math.round(v * 100) / 100 }

/**
 * When one plan item lights, in ms after its card starts entering: the card's
 * own entrance, then centre → edge across `PLAN_LIGHT_SPREAD`.
 *
 * @param {number} cardDelayMs the card's stagger delay
 * @param {number} order ∈ [0,1] from `layoutPlan`
 * @returns {number} ms
 */
export function planLightDelay(cardDelayMs, order) {
  const base = Number.isFinite(cardDelayMs) && cardDelayMs > 0 ? cardDelayMs : 0
  const o = Number.isFinite(order) ? Math.min(Math.max(order, 0), 1) : 0
  return Math.round(base + o * PLAN_LIGHT_SPREAD)
}

/**
 * The idle breath of a card's light pool: the stage's own breath (same period,
 * same curve family) phased by the template's identity, so N cards never
 * breathe in lockstep (ADR-093 D1). A negative delay starts the CSS cycle
 * part-way through. Reduced motion is the caller's to honour (no animation).
 *
 * @param {string} templateId
 * @returns {{periodMs:number, delayMs:number}}
 */
export function poolBreathTiming(templateId) {
  const periodMs = STAGE.breath.period * 1000
  return { periodMs, delayMs: -Math.round(phaseFor(templateId) * periodMs) }
}
