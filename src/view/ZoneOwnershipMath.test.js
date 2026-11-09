/** ZoneOwnershipMath.test.js — every overlap kind has its sentence and tone; an undeclared kind throws (原則 #31). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { overlapLine, OVERLAP_TONE, conflictedZoneIds } from './ZoneOwnershipMath.js'
import { ZONE_OVERLAP_KIND } from '../domain/zone.js'

test('each kind the domain declares has a line and a tone; only a conflict is cautioned', () => {
  for (const kind of Object.values(ZONE_OVERLAP_KIND)) {
    assert.equal(typeof overlapLine(kind, 'x'), 'string', kind)
    assert.ok(OVERLAP_TONE[kind], kind)
  }
  const cautioned = Object.entries(OVERLAP_TONE).filter(([, t]) => t === 'cautionTone').map(([k]) => k)
  assert.deepEqual(cautioned, [ZONE_OVERLAP_KIND.CONFLICT])
  assert.throws(() => overlapLine('rival', 'x'), /no line declared/)
})

test('lit zones are exactly the two sides of each conflict', () => {
  const p = (a, b, kind) => ({ a: { id: a }, b: { id: b }, kind })
  assert.deepEqual([...conflictedZoneIds([p('a', 'b', 'conflict'), p('b', 'c', 'undeclared')])].sort(), ['a', 'b'])
})
