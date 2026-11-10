/**
 * ZoneOwner.test.js — a zone's owner is declared, never filled in (ADR-170 O2 / S3).
 *
 * The three values (actor / "none" / no row) and the one rule of S3: an
 * undeclared zone may be declared; a declared one is not changed here (DEF-077).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import { zoneOwnerOf, zoneOwnerKind, declareZoneOwner, OWNER_NONE_DECLARED } from './Ownership.js'
import { validateContext, zoneOwnerIssues } from './ContextValidator.js'
import { ZONE_OWNER_KIND } from '../domain/zone.js'

const zone = (ref) => ({ ref, type: 'AnnotatedRegion', placeType: 'Zone', vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] })
const doc = (over = {}) => ({
  version: 'context/0.7',
  actors: [{ ref: 'ann', role: 'mech_engineer' }, { ref: 'bo', role: 'robot_engineer' }],
  specification: { layout: { version: 'layout/1.1', entities: [zone('assy'), zone('qa'), { ref: 'bench', type: 'Solid' }] } },
  ...over,
})

test('no row is undeclared — the zero is counted, not defaulted', () => {
  assert.equal(zoneOwnerOf(doc(), 'assy'), undefined)
  assert.deepEqual(zoneOwnerKind(undefined), { kind: ZONE_OWNER_KIND.UNDECLARED })
})

test('declaring writes one row, without touching the input; "none" is a declaration of its own', () => {
  const before = doc()
  const after = declareZoneOwner(before, 'assy', 'ann')
  assert.equal(before.owners, undefined, 'input not mutated')
  assert.equal(zoneOwnerOf(after, 'assy'), 'ann')
  assert.deepEqual(zoneOwnerKind('ann'), { kind: ZONE_OWNER_KIND.ACTOR, ref: 'ann' })
  const none = declareZoneOwner(after, 'qa', OWNER_NONE_DECLARED)
  assert.deepEqual(zoneOwnerKind(zoneOwnerOf(none, 'qa')), { kind: ZONE_OWNER_KIND.NONE })
})

test('a declared owner is not changed here, and a non-actor is refused — each with its reason', () => {
  const owned = declareZoneOwner(doc(), 'assy', 'ann')
  assert.throws(() => declareZoneOwner(owned, 'assy', 'bo'), /already has an owner \(ann\)/)
  assert.throws(() => declareZoneOwner(doc(), 'assy', 'zed'), /not an actor/)
})

test('R16: a row names a zone of the layout, an actor or "none", once per zone', () => {
  assert.deepEqual(zoneOwnerIssues(doc({ owners: [{ of: 'assy', owner: 'ann' }, { of: 'qa', owner: 'none' }] })), [])
  const issues = zoneOwnerIssues(doc({ owners: [
    { of: 'bench', owner: 'ann' },
    { of: 'ghost', owner: 'ann' },
    { of: 'assy', owner: 'zed' },
    { of: 'qa', owner: 'ann' }, { of: 'qa', owner: 'bo' },
  ] }))
  assert.equal(issues.length, 4)
  assert.match(issues[0], /not a zone — only a zone may carry an owner yet/)
  assert.match(issues[1], /not an entity of specification.layout/)
  assert.match(issues[2], /neither an actor/)
  assert.match(issues[3], /more than one owner row/)
  assert.equal(validateContext(doc({ owners: [{ of: 'bench', owner: 'ann' }] })).valid, false, 'the validator asks R16')
})

test('the schema takes owners[] closed: {of, owner} and nothing else', () => {
  const schema = JSON.parse(readFileSync(new URL('../../schema/context-0.7.schema.json', import.meta.url), 'utf8'))
  const validate = new Ajv2020({ strict: false }).compile(schema)
  assert.equal(validate({ version: 'context/0.7', owners: [{ of: 'assy', owner: 'ann' }] }), true)
  assert.equal(validate({ version: 'context/0.7', owners: [{ of: 'assy' }] }), false, 'owner is required — absence is the missing row, not an empty one')
  assert.equal(validate({ version: 'context/0.7', owners: [{ of: 'assy', owner: 'ann', by: 'bo' }] }), false)
})
