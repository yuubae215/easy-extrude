/**
 * zone.test.js — the place vocabulary and "one thing stands on one height"
 * (ADR-170 S1 — D3 / D5 / D6).
 *
 * The rule can be broken from three sides (declare a belonging, move a zone,
 * make a Region a zone) plus a loaded file; each side has its own case here.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Vector3 } from 'three'
import { Vertex } from '../graph/Vertex.js'
import { AnnotatedRegion } from './AnnotatedRegion.js'
import {
  isZone, isZonePlaceType, plateElevationOf, zonesOf, distinctElevations,
  containsRefusal, elevationChangeRefusal, placeTypeRefusal, zoneElevationConflicts,
} from './zone.js'

function region(id, z, placeType = 'Zone', name = id) {
  const pts = [[0, 0], [1000, 0], [1000, 1000], [0, 1000]]
  const r = new AnnotatedRegion(id, name, pts.map(([x, y], i) => new Vertex(`${id}v${i}`, new Vector3(x, y, z))), [], null)
  r.placeType = placeType
  return r
}
const thing = (id) => ({ id, name: id })
const contains = (sourceId, targetId) => ({ sourceId, targetId, semanticType: 'contains' })

function world(objects, links) {
  const byId = new Map(objects.map(o => [o.id, o]))
  return { links, getObject: id => byId.get(id) }
}

test('a zone is a Region whose placeType is Zone — an untyped Region is a note', () => {
  assert.equal(isZone(region('a', 0)), true)
  assert.equal(isZone(region('b', 0, null)), false)
  assert.equal(isZone(region('c', 0, 'Route')), false)
  assert.equal(isZone({ placeType: 'Zone' }), false, 'a look-alike plain object is not a zone')
  assert.equal(isZonePlaceType('Zone'), true)
  assert.equal(isZonePlaceType('zone'), false)
})

test('the elevation is the Z the plate shares; a plate that is not level has none', () => {
  assert.equal(plateElevationOf(region('a', 4000).corners), 4000)
  assert.equal(plateElevationOf(region('a', -3000).corners), -3000, 'a basement is a negative elevation')
  assert.equal(plateElevationOf([{ z: 0 }, { z: 0.5 }]), 0, 'within 1 mm is level')
  assert.equal(plateElevationOf([{ z: 0 }, { z: 10 }]), null)
  assert.equal(plateElevationOf([]), null)
})

test('belonging is a contains from a zone; a contains from a note is not belonging', () => {
  const z1 = region('z1', 0), note = region('n', 0, null), w = thing('w')
  const { links, getObject } = world([z1, note, w], [contains('z1', 'w'), contains('n', 'w')])
  assert.deepEqual(zonesOf('w', links, getObject).map(z => z.id), ['z1'])
})

test('D5 — belonging to a second zone at the same height is allowed, at another height refused with the reason', () => {
  const z0 = region('z0', 0, 'Zone', 'Assembly'), zSame = region('zs', 0, 'Zone', 'Inspection'), z2F = region('z2', 4000, 'Zone', 'Mezzanine')
  const w = thing('w')
  const { links, getObject } = world([z0, zSame, z2F, w], [contains('z0', 'w')])
  assert.equal(containsRefusal({ zone: zSame, thing: w, links, getObject }), null)
  const why = containsRefusal({ zone: z2F, thing: w, links, getObject })
  assert.match(why, /"w" already belongs to "Assembly" at Z = 0 mm/)
  assert.match(why, /"Mezzanine" is at Z = 4000 mm/)
  assert.match(why, /one thing stands on one floor/)
  // A contains from something that is not a zone is not governed.
  assert.equal(containsRefusal({ zone: region('n', 4000, null), thing: w, links, getObject }), null)
})

test('D5 — moving a zone to another height is refused when a member also belongs elsewhere', () => {
  const a = region('a', 0, 'Zone', 'A'), b = region('b', 0, 'Zone', 'B'), w = thing('w'), v = thing('v')
  const { links, getObject } = world([a, b, w, v], [contains('a', 'w'), contains('b', 'w'), contains('a', 'v')])
  assert.match(elevationChangeRefusal({ zone: a, newZ: 4000, links, getObject }),
    /"w" also belongs to "B" at Z = 0 mm; moving "A" to Z = 4000 mm would put it on two floors/)
  assert.equal(elevationChangeRefusal({ zone: a, newZ: 0.4, links, getObject }), null, 'within tolerance is the same floor')
  // A zone whose members belong nowhere else may go to any height — even below ground.
  const solo = world([a, v], [contains('a', 'v')])
  assert.equal(elevationChangeRefusal({ zone: a, newZ: -3000, ...solo }), null)
})

test('D5 — turning a Region into a zone is refused when what it contains already stands on another floor', () => {
  const note = region('n', 4000, null, 'Shelf'), z0 = region('z0', 0, 'Zone', 'Floor'), w = thing('w')
  const { links, getObject } = world([note, z0, w], [contains('n', 'w'), contains('z0', 'w')])
  assert.match(placeTypeRefusal({ region: note, newPlaceType: 'Zone', links, getObject }),
    /"w" belongs to "Floor" at Z = 0 mm; making "Shelf" \(Z = 4000 mm\) a zone would put it on two floors/)
  assert.equal(placeTypeRefusal({ region: note, newPlaceType: 'Route', links, getObject }), null)
  assert.equal(placeTypeRefusal({ region: region('n2', 0, null), newPlaceType: 'Zone', ...world([z0, w], [contains('n2', 'w'), contains('z0', 'w')]) }), null)
})

test('a plate that is not level never agrees with a floor', () => {
  assert.deepEqual(distinctElevations([0, 0.2, 4000]), [0, 4000])
  assert.deepEqual(distinctElevations([null, 0]), [null, 0])
  assert.deepEqual(distinctElevations([null, null]), [null])
})

test('a whole document — every thing whose zones disagree, and nothing else', () => {
  const got = zoneElevationConflicts({
    zones: [{ id: 'a', elevation: 0 }, { id: 'b', elevation: 0 }, { id: 'c', elevation: 4000 }],
    contains: [
      { zoneId: 'a', thingId: 'w1' }, { zoneId: 'b', thingId: 'w1' },   // same floor
      { zoneId: 'a', thingId: 'w2' }, { zoneId: 'c', thingId: 'w2' },   // two floors
      { zoneId: 'note', thingId: 'w2' },                                // not a zone — ignored
    ],
  })
  assert.deepEqual(got.map(g => g.thingId), ['w2'])
})
