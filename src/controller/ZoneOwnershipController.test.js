/**
 * ZoneOwnershipController.test.js — live plates × the document's owners →
 * the lit plates and the zone's panel (ADR-170 S3). THREE-free: fake views.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Vector3 } from 'three'
import { Vertex } from '../graph/Vertex.js'
import { AnnotatedRegion } from '../domain/AnnotatedRegion.js'
import { ZoneOwnershipController } from './ZoneOwnershipController.js'
import { ZONE_OVERLAP_KIND } from '../domain/zone.js'

function zone(id, x0, z = 0) {
  const pts = [[x0, 0], [x0 + 1000, 0], [x0 + 1000, 1000], [x0, 1000]]
  const r = new AnnotatedRegion(id, id, pts.map(([x, y], i) => new Vertex(`${id}v${i}`, new Vector3(x, y, z))), [], null)
  r.placeType = 'Zone'
  r.meshView = { lit: null, setOwnerConflict(on) { this.lit = on } }
  return r
}

function setup({ owners = [], doc = true, refs = { a: 'za', b: 'zb', c: 'zc' }, speaker = 'ann' } = {}) {
  const zones = [zone('a', 0), zone('b', 500), zone('c', 3000)]
  const theDoc = doc ? { actors: [{ ref: 'ann' }, { ref: 'bo' }], owners } : null
  const ctrl = new ZoneOwnershipController({
    objects: () => zones,
    ctxService: { getDoc: () => theDoc, refForSceneId: (id) => refs[id] ?? null },
    speaker: () => speaker,
  })
  return { zones, ctrl }
}

test('two declared, different owners → both plates lit, the third untouched', () => {
  const { zones, ctrl } = setup({ owners: [{ of: 'za', owner: 'ann' }, { of: 'zb', owner: 'bo' }] })
  ctrl.refresh()
  assert.deepEqual(zones.map(z => z.meshView.lit), [true, true, false])
  const panel = ctrl.panelFor('a')
  assert.equal(panel.owner.text, 'ann')
  assert.deepEqual(panel.overlaps.map(o => o.kind), [ZONE_OVERLAP_KIND.CONFLICT])
  assert.equal(panel.conflicts, 1)
  assert.match(panel.overlaps[0].text, /^Conflict — overlaps "b"/)
})

test('same owner, ownerless, undeclared → nothing lit; undeclared is counted', () => {
  for (const [owners, kind] of [
    [[{ of: 'za', owner: 'ann' }, { of: 'zb', owner: 'ann' }], ZONE_OVERLAP_KIND.SAME_OWNER],
    [[{ of: 'za', owner: 'ann' }, { of: 'zb', owner: 'none' }], ZONE_OVERLAP_KIND.OWNERLESS],
    [[{ of: 'za', owner: 'ann' }], ZONE_OVERLAP_KIND.UNDECLARED],
  ]) {
    const { zones, ctrl } = setup({ owners })
    ctrl.refresh()
    assert.deepEqual(zones.map(z => z.meshView.lit), [false, false, false], kind)
    assert.deepEqual(ctrl.panelFor('a').overlaps.map(o => o.kind), [kind])
  }
  const { ctrl } = setup({ owners: [{ of: 'za', owner: 'ann' }] })
  assert.equal(ctrl.panelFor('a').undeclared, 1)
})

test('a re-lit zone is told again — a re-projected view under the same id is not skipped', () => {
  const { zones, ctrl } = setup({ owners: [{ of: 'za', owner: 'ann' }, { of: 'zb', owner: 'bo' }] })
  ctrl.refresh()
  zones[0].meshView = { lit: null, setOwnerConflict(on) { this.lit = on } }
  ctrl.refresh()
  assert.equal(zones[0].meshView.lit, true)
})

test('declaring is offered in the speaker\'s name only while undeclared; otherwise the note says why', () => {
  let p = setup().ctrl.panelFor('a')
  assert.deepEqual(p.actions.map(a => a.label), ['Own as ann', 'No owner'])
  assert.equal(p.owner.text, 'not declared')
  p = setup({ owners: [{ of: 'za', owner: 'ann' }] }).ctrl.panelFor('a')
  assert.deepEqual(p.actions, [])
  assert.match(p.note, /not decided yet \(DEF-077\)/)
  p = setup({ speaker: null }).ctrl.panelFor('a')
  assert.deepEqual(p.actions, [])
  assert.match(p.note, /Choose who is speaking/)
  p = setup({ doc: false }).ctrl.panelFor('a')
  assert.match(p.note, /Open a document/)
  p = setup({ refs: {} }).ctrl.panelFor('a')
  assert.match(p.note, /not in the document/)
})

test('no document: every zone is undeclared — overlaps are counted, nothing is lit (G2)', () => {
  const { zones, ctrl } = setup({ doc: false })
  ctrl.refresh()
  assert.deepEqual(zones.map(z => z.meshView.lit), [false, false, false])
  assert.equal(ctrl.panelFor('b').undeclared, 1)
})
