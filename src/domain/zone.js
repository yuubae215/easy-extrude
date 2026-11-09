/**
 * zone — the place a thing belongs to, and the one height it stands on (ADR-170).
 *
 * Vocabulary (docs/SPATIAL_RELATION_MODEL.md §6, dictionary category `place`):
 *
 *   zone       a Region whose placeType is 'Zone'. Only that kind is a place —
 *              an untyped Region is a note (ADR-170 S1, owner 2026-11-07).
 *   contains   `zone —contains→ thing`: the thing BELONGS to the zone. Declared,
 *              never derived; leaving the zone does not undo it (ADR-170 D3).
 *   elevation  the Z of the zone's plate = the floor its members stand on.
 *              Not a second field beside the geometry: a zone is a flat plate,
 *              its vertices share one Z, and that Z is the elevation (§1.1).
 *
 * The one rule this module answers (ADR-170 D5): **one thing stands on one
 * height.** The zones a thing belongs to must all share one elevation — two
 * would put the same thing on two floors. It can be broken from three sides,
 * and each has its own named question here, so no caller re-derives it:
 *
 *   declaring a contains link        → containsRefusal
 *   moving a zone to another height  → elevationChangeRefusal
 *   turning a Region into a Zone     → placeTypeRefusal
 *
 * (A loaded document is checked by `LayoutValidator` through `zoneElevationConflicts`
 * — a file is reported, never silently rewritten.)
 *
 * What the rule buys (S2): `floorOf` — the one floor a thing stands on.
 *
 * What S3 adds — `overlaps` (D1), derived and never stored: a footprint at the
 * zone's height that shares area with the zone. Asked between a thing and a zone
 * (`overlapsZone` — where belonging is offered) and between two zones
 * (`zoneOverlaps` — read with the two zones' owners, O2 / D2). Only convex plates
 * are decided; a concave one answers UNDECIDABLE rather than a guess (S3 Q5).
 *
 * Pure: no THREE, no DOM. Links and objects are read through the arguments.
 *
 * @see docs/adr/ADR-170-the-floor-comes-from-belonging-to-a-district.md
 */

import { AnnotatedRegion } from './AnnotatedRegion.js'
import { mm } from './worldUnits.js'
import { convexHullXY, convexOverlapAreaXY, isConvexXY } from './planar.js'

/** The placeType value that makes a Region a zone. */
export const ZONE_PLACE_TYPE = 'Zone'

/** Two elevations closer than this are the same floor. */
export const ELEVATION_TOLERANCE = mm(1)

/**
 * Whether a placeType value names a zone. The view styles by the placeType
 * string it is handed, so the value test is exported on its own — it is the
 * same fact as `isZone`, asked one step earlier.
 * @param {string|null|undefined} placeType
 */
export function isZonePlaceType(placeType) {
  return placeType === ZONE_PLACE_TYPE
}

/**
 * THE identity of a zone (IDENTITY_RULES — src/IdentityContainment.test.js).
 * @param {*} obj
 * @returns {boolean}
 */
export function isZone(obj) {
  return obj instanceof AnnotatedRegion && isZonePlaceType(obj.placeType)
}

/**
 * The elevation of a plate: the Z its vertices share, or `null` when they do
 * not share one (a tilted or broken plate stands nobody on a floor).
 * @param {ReadonlyArray<{z:number}>} corners
 * @returns {number|null}
 */
export function plateElevationOf(corners) {
  if (!corners || corners.length === 0) return null
  const z0 = corners[0].z
  if (!Number.isFinite(z0)) return null
  return corners.every(c => Number.isFinite(c.z) && Math.abs(c.z - z0) <= ELEVATION_TOLERANCE) ? z0 : null
}

/**
 * The zones a thing belongs to — the sources of `contains` links that point at
 * it and are zones. A `contains` from an untyped Region is not belonging.
 * @param {string} thingId
 * @param {Iterable<{sourceId:string, targetId:string, semanticType:string}>} links
 * @param {(id:string) => any} getObject
 * @returns {any[]}
 */
export function zonesOf(thingId, links, getObject) {
  const zones = []
  for (const link of links) {
    if (link.semanticType !== 'contains' || link.targetId !== thingId) continue
    const zone = getObject(link.sourceId)
    if (isZone(zone)) zones.push(zone)
  }
  return zones
}

/**
 * The distinct elevations in a list (within ELEVATION_TOLERANCE), in first-seen
 * order. `null` (a plate that is not level) is kept as its own value — it is not
 * a floor, and it must not be mistaken for agreeing with one.
 * @param {ReadonlyArray<number|null>} elevations
 * @returns {Array<number|null>}
 */
export function distinctElevations(elevations) {
  const out = []
  for (const e of elevations) {
    const same = out.some(o => (o === null || e === null) ? o === e : Math.abs(o - e) <= ELEVATION_TOLERANCE)
    if (!same) out.push(e)
  }
  return out
}

/**
 * **THE floor of a thing** (ADR-170 D4 / S2) — the elevation of the zones it
 * belongs to, or `null` when it has no floor. The only place the floor is
 * decided: the placement policy no longer gives one by kind, and a caller that
 * assembles `zonesOf` + `plateElevationOf` itself is a second source
 * (`src/PosePolicyOwnership.test.js` counts them).
 *
 *   belongs to nothing                      → null (no floor — D4; a scene with 0 zones)
 *   belongs to zones that share one height  → that height
 *   belongs to zones at two heights         → null — unreachable through the
 *     guarded entries (D5), and picking one would make the same thing stand
 *     higher or lower by the order the zones were drawn (rejected in the ADR).
 *     A loaded file in that state is reported by LayoutValidator, not read.
 *   a zone whose plate is not level         → gives no floor
 *
 * `elevationOf` lets a caller read a zone that is moving in the same gesture
 * from its segment start + the request (PHILOSOPHY #24 — never from the plate
 * this very gesture is writing).
 *
 * @param {{ thing:any, links:Iterable<any>, getObject:(id:string)=>any,
 *           elevationOf?:(zone:any)=>number|null }} p
 * @returns {number|null}
 */
export function floorOf({ thing, links, getObject, elevationOf = (z) => plateElevationOf(z.corners) }) {
  if (!thing) return null
  const heights = distinctElevations(zonesOf(thing.id, links, getObject).map(elevationOf))
    .filter(e => e !== null)
  return heights.length === 1 ? heights[0] : null
}

const fmt = (e) => (e === null ? 'a plate that is not level' : `Z = ${Math.round(e)} mm`)
const nameOf = (o) => (o?.name ? `"${o.name}"` : 'this thing')

/**
 * May `zone —contains→ thing` be declared? `null` = yes; otherwise the reason,
 * worded for the person who asked (PHILOSOPHY #11 — a refusal is never silent).
 * A `contains` from something that is not a zone is not belonging and is not
 * governed here.
 * @param {{ zone:any, thing:any, links:Iterable<any>, getObject:(id:string)=>any }} p
 * @returns {string|null}
 */
export function containsRefusal({ zone, thing, links, getObject }) {
  if (!isZone(zone) || !thing) return null
  const others = zonesOf(thing.id, links, getObject).filter(z => z !== zone)
  if (others.length === 0) return null
  const all = distinctElevations([plateElevationOf(zone.corners), ...others.map(z => plateElevationOf(z.corners))])
  if (all.length <= 1) return null
  const other = others.find(z => distinctElevations([plateElevationOf(zone.corners), plateElevationOf(z.corners)]).length > 1)
  return `${nameOf(thing)} already belongs to ${nameOf(other)} at ${fmt(plateElevationOf(other.corners))}; `
       + `${nameOf(zone)} is at ${fmt(plateElevationOf(zone.corners))} — one thing stands on one floor`
}

/**
 * May `zone` move to elevation `newZ`? `null` = yes; otherwise the reason. The
 * zone's members are the things it contains; each must still stand on one height.
 * @param {{ zone:any, newZ:number, links:Iterable<any>, getObject:(id:string)=>any }} p
 * @returns {string|null}
 */
export function elevationChangeRefusal({ zone, newZ, links, getObject }) {
  if (!isZone(zone)) return null
  const list = [...links]
  for (const link of list) {
    if (link.semanticType !== 'contains' || link.sourceId !== zone.id) continue
    const thing = getObject(link.targetId)
    if (!thing) continue
    const others = zonesOf(thing.id, list, getObject).filter(z => z !== zone)
    const other = others.find(z => distinctElevations([newZ, plateElevationOf(z.corners)]).length > 1)
    if (other) {
      return `${nameOf(thing)} also belongs to ${nameOf(other)} at ${fmt(plateElevationOf(other.corners))}; `
           + `moving ${nameOf(zone)} to ${fmt(newZ)} would put it on two floors`
    }
  }
  return null
}

/**
 * May `region` take placeType `newPlaceType`? Only becoming a zone can break the
 * rule: what the region already contains starts to belong to it. `null` = yes.
 * @param {{ region:any, newPlaceType:string|null, links:Iterable<any>, getObject:(id:string)=>any }} p
 * @returns {string|null}
 */
export function placeTypeRefusal({ region, newPlaceType, links, getObject }) {
  if (!(region instanceof AnnotatedRegion) || !isZonePlaceType(newPlaceType) || isZone(region)) return null
  const list = [...links]
  const elevation = plateElevationOf(region.corners)
  for (const link of list) {
    if (link.semanticType !== 'contains' || link.sourceId !== region.id) continue
    const thing = getObject(link.targetId)
    if (!thing) continue
    const other = zonesOf(thing.id, list, getObject)
      .find(z => distinctElevations([elevation, plateElevationOf(z.corners)]).length > 1)
    if (other) {
      return `${nameOf(thing)} belongs to ${nameOf(other)} at ${fmt(plateElevationOf(other.corners))}; `
           + `making ${nameOf(region)} (${fmt(elevation)}) a zone would put it on two floors`
    }
  }
  return null
}

/**
 * Every thing whose zones disagree on height, for a whole document — the check
 * a loaded file goes through (it is reported, never rewritten — ADR-097 §Consequences).
 * Plain records, so the Layout DSL can be checked before it becomes a scene.
 * @param {{ zones: Array<{id:string, name?:string, elevation:number|null}>,
 *           contains: Array<{zoneId:string, thingId:string}> }} p
 * @returns {Array<{thingId:string, zones:Array<{id:string, name?:string, elevation:number|null}>}>}
 */
export function zoneElevationConflicts({ zones, contains }) {
  const byId = new Map(zones.map(z => [z.id, z]))
  const perThing = new Map()
  for (const { zoneId, thingId } of contains) {
    const zone = byId.get(zoneId)
    if (!zone) continue
    if (!perThing.has(thingId)) perThing.set(thingId, [])
    perThing.get(thingId).push(zone)
  }
  const out = []
  for (const [thingId, zs] of perThing) {
    if (distinctElevations(zs.map(z => z.elevation)).length > 1) out.push({ thingId, zones: zs })
  }
  return out
}

// ── Overlaps (ADR-170 D1 / S3) ───────────────────────────────────────────────

/** Two plan areas sharing less than this (mm²) only touch — an edge is not an overlap. */
export const OVERLAP_AREA_TOLERANCE = mm(1) * mm(1)

/** The three answers to "do these overlap?" — UNDECIDABLE is said, never folded into NO. */
export const OVERLAP = Object.freeze({
  YES:         'overlaps',
  NO:          'apart',
  /** a plate is concave — S3 decides convex plates only (Q5) */
  UNDECIDABLE: 'undecidable',
})

/**
 * How two plates at the SAME height stand on the plan: same rules as below,
 * without the height question.
 */
function planOverlap(a, b) {
  if (a.length < 3 || b.length < 3) return OVERLAP.NO
  if (!isConvexXY(a) || !isConvexXY(b)) return OVERLAP.UNDECIDABLE
  return convexOverlapAreaXY(a, b) > OVERLAP_AREA_TOLERANCE ? OVERLAP.YES : OVERLAP.NO
}

/**
 * Does a thing overlap a zone (D1)? Its footprint is the plan hull of its corners
 * and it stands at its lowest corner; it overlaps when that height is the zone's
 * elevation and the two share area. A thing stacked on another thing in the zone
 * stands higher and does not overlap — D1 says the footprint at the zone's height.
 *
 * @param {{ thing:{corners?:ReadonlyArray<{x:number,y:number,z:number}>}|null, zone:any }} p
 * @returns {string} an OVERLAP value
 */
export function overlapsZone({ thing, zone }) {
  if (!isZone(zone) || !thing?.corners?.length) return OVERLAP.NO
  const elevation = plateElevationOf(zone.corners)
  if (elevation === null) return OVERLAP.NO
  const bottom = Math.min(...thing.corners.map(c => c.z))
  if (Math.abs(bottom - elevation) > ELEVATION_TOLERANCE) return OVERLAP.NO
  if (zone.corners.length >= 3 && !isConvexXY(zone.corners)) return OVERLAP.UNDECIDABLE
  return planOverlap(convexHullXY(thing.corners), zone.corners)
}

/** The owner of a zone as the overlap reading needs it (O2). The context side maps its value onto these. */
export const ZONE_OWNER_KIND = Object.freeze({
  ACTOR:      'actor',
  /** declared to belong to nobody — a legitimate zero */
  NONE:       'none',
  /** nobody has said — the counted zero */
  UNDECLARED: 'undeclared',
})

/** How two overlapping zones read, by their owners (D2 as decided before S3). */
export const ZONE_OVERLAP_KIND = Object.freeze({
  /** one actor owns both — nothing to talk about */
  SAME_OWNER: 'same-owner',
  /** two declared, different actors — a conflict, shown */
  CONFLICT:   'conflict',
  /** one is declared to belong to nobody — no one to talk to */
  OWNERLESS:  'ownerless',
  /** one owner is undeclared — counted, not negotiated */
  UNDECLARED: 'undeclared',
  /** a plate is concave — whether they overlap is not decided */
  UNDECIDABLE: 'undecidable',
})

const OWNER_KINDS = new Set(/** @type {string[]} */ (Object.values(ZONE_OWNER_KIND)))

/**
 * Read a pair by its owners. Throws on an owner kind nobody declared (原則 #31 —
 * a fall-through would make "a kind nobody thought about" read as one of these).
 * @param {{kind:string, ref?:string}} a
 * @param {{kind:string, ref?:string}} b
 * @returns {string} a ZONE_OVERLAP_KIND value other than UNDECIDABLE
 */
export function overlapKindOf(a, b) {
  for (const o of [a, b]) {
    if (!OWNER_KINDS.has(o?.kind)) throw new Error(`zone: unknown owner kind "${o?.kind}"`)
  }
  if (a.kind === ZONE_OWNER_KIND.UNDECLARED || b.kind === ZONE_OWNER_KIND.UNDECLARED) return ZONE_OVERLAP_KIND.UNDECLARED
  if (a.kind === ZONE_OWNER_KIND.NONE || b.kind === ZONE_OWNER_KIND.NONE) return ZONE_OVERLAP_KIND.OWNERLESS
  return a.ref === b.ref ? ZONE_OVERLAP_KIND.SAME_OWNER : ZONE_OVERLAP_KIND.CONFLICT
}

/**
 * Every pair of zones that overlap (or cannot be told apart from overlapping) at
 * one height, each read by its owners. Pairs are ordered by id so a pair is one
 * record whatever order the zones were drawn in. Zones at different heights never
 * pair — two floors do not share area.
 *
 * @param {{ zones: ReadonlyArray<any>, ownerOf: (zone:any) => {kind:string, ref?:string} }} p
 * @returns {Array<{a:any, b:any, kind:string}>}
 */
export function zoneOverlaps({ zones, ownerOf }) {
  const list = zones.filter(isZone).slice().sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
  const out = []
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j]
      const ea = plateElevationOf(a.corners), eb = plateElevationOf(b.corners)
      if (ea === null || eb === null || Math.abs(ea - eb) > ELEVATION_TOLERANCE) continue
      const plan = planOverlap(a.corners, b.corners)
      if (plan === OVERLAP.NO) continue
      const kind = plan === OVERLAP.UNDECIDABLE ? ZONE_OVERLAP_KIND.UNDECIDABLE : overlapKindOf(ownerOf(a), ownerOf(b))
      out.push({ a, b, kind })
    }
  }
  return out
}
