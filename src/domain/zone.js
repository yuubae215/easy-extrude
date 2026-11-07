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
 * Pure: no THREE, no DOM. Links and objects are read through the arguments.
 *
 * @see docs/adr/ADR-170-the-floor-comes-from-belonging-to-a-district.md
 */

import { AnnotatedRegion } from './AnnotatedRegion.js'
import { mm } from './worldUnits.js'

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
