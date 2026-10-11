/**
 * graspRelation — the grasp as a relation row (ADR-164 D2).
 *
 * The population is the DOCUMENT's grasp declarations. Every assertion that a
 * relation is broken is made against that population, because a scene walk can
 * never show the declaration whose object is gone (原則 #31 / DEF-035).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  graspRelationsOf, GRASP_RELATION_STATE, relationHandGap, relationCensus,
  relationWordsFor, nameableTcpsOf,
} from './graspRelation.js'

const box = (ref, graspFeature) => ({
  ref, type: 'Solid', name: ref.toUpperCase(),
  position: { x: 0, y: 0, z: 0 }, dimensions: { x: 1, y: 1, z: 1 },
  ...(graspFeature === undefined ? {} : { graspFeature }),
})
const base = (ref) => ({ ref, type: 'CoordinateFrame', name: ref, robotRole: 'base', position: { x: 0, y: 0, z: 0 } })
const tcp  = (ref, parent) => ({ ref, type: 'CoordinateFrame', name: `${ref} tool`, robotRole: 'tcp', parent, position: { x: 0, y: 0, z: 0 } })
const frame = (ref) => ({ ref, type: 'CoordinateFrame', name: ref, position: { x: 0, y: 0, z: 0 } })

const ROBOTS = [base('ra'), tcp('tcp_a', 'ra'), base('rb'), tcp('tcp_b', 'rb'), frame('marker')]

test('N≥2 の把持: 文書の宣言 1 つにつき関係 1 行、文書順', () => {
  const doc = { entities: [
    box('cube', { kind: 'anywhere', tcp: 'tcp_a' }),
    box('plate'),
    box('cup', { kind: 'anywhere', tcp: 'tcp_b' }),
  ] }
  const rels = graspRelationsOf({ docDsl: doc, sceneDsl: { entities: [...doc.entities, ...ROBOTS] } })
  assert.deepEqual(rels.map(r => [r.objectRef, r.tcpRef, r.state]), [
    ['cube', 'tcp_a', GRASP_RELATION_STATE.OK],
    ['cup',  'tcp_b', GRASP_RELATION_STATE.OK],
  ], '宣言の無い plate は関係を持たない — 0 は宣言の不在')
  assert.equal(rels[0].tcpLabel, 'tcp_a tool')
})

test('欄の無い旧文書は「手が未宣言」— tcp が 1 本でも既定値で埋めない', () => {
  const doc = { entities: [box('cube', { kind: 'anywhere' })] }
  const scene = { entities: [box('cube'), base('ra'), tcp('tcp_a', 'ra')] }
  const [r] = graspRelationsOf({ docDsl: doc, sceneDsl: scene })
  assert.equal(r.state, GRASP_RELATION_STATE.HAND_UNDECLARED)
  assert.equal(r.tcpRef, null)
  assert.equal(r.tcpLabel, null)
  assert.equal(relationWordsFor(r.state).broken, false, '未宣言は壊れていない — 状態として言う')
})

test('ワークがシーンから消えた把持は落ちずに壊れた行として残る (DEF-035)', () => {
  const doc = { entities: [box('cube', { kind: 'anywhere', tcp: 'tcp_a' })] }
  const [r] = graspRelationsOf({ docDsl: doc, sceneDsl: { entities: ROBOTS } })
  assert.equal(r.state, GRASP_RELATION_STATE.BROKEN_OBJECT)
  assert.equal(r.objectLabel, 'CUBE', '名前は文書から読める')
  assert.deepEqual(relationCensus([r]), { total: 1, broken: 1 })
})

test('名指した tcp が無い / tcp でない実体を指す関係は壊れた行', () => {
  const doc = { entities: [
    box('cube', { kind: 'anywhere', tcp: 'gone' }),
    box('cup',  { kind: 'anywhere', tcp: 'marker' }),
  ] }
  const rels = graspRelationsOf({ docDsl: doc, sceneDsl: { entities: [...doc.entities, ...ROBOTS] } })
  assert.deepEqual(rels.map(r => r.state), [GRASP_RELATION_STATE.BROKEN_TCP, GRASP_RELATION_STATE.BROKEN_TCP])
  assert.equal(rels[0].tcpLabel, 'gone', '無い tcp は ref で言う')
})

test('両側が無いときはワークが勝つ (関係はワークに住む)', () => {
  const doc = { entities: [box('cube', { kind: 'anywhere', tcp: 'gone' })] }
  const [r] = graspRelationsOf({ docDsl: doc, sceneDsl: { entities: [] } })
  assert.equal(r.state, GRASP_RELATION_STATE.BROKEN_OBJECT)
})

test('宣言 0 個 / 文書なし は関係 0 個 (census も 0 を言う)', () => {
  assert.deepEqual(graspRelationsOf({ docDsl: null, sceneDsl: { entities: ROBOTS } }), [])
  assert.deepEqual(relationCensus([]), { total: 0, broken: 0 })
})

test('Run の gap: 宣言した手 ≠ 探索の主語の手 は gap、未宣言と一致は gap でない', () => {
  const ok = { objectRef: 'cube', tcpRef: 'tcp_b', state: GRASP_RELATION_STATE.OK, objectLabel: 'CUBE', tcpLabel: 'tcp_b tool' }
  assert.match(relationHandGap(ok, 'tcp_a'), /declared for tcp_b tool/)
  assert.equal(relationHandGap(ok, 'tcp_b'), null)
  assert.equal(relationHandGap({ ...ok, tcpRef: null, state: GRASP_RELATION_STATE.HAND_UNDECLARED }, 'tcp_a'), null)
  assert.equal(relationHandGap(null, 'tcp_a'), null)
  assert.match(relationHandGap({ ...ok, state: GRASP_RELATION_STATE.BROKEN_TCP }, 'tcp_a'), /not a robot tcp/)
})

test('名指せる tcp はシーンのロボット tcp だけ (ただのフレームは含まない)', () => {
  assert.deepEqual(nameableTcpsOf({ entities: ROBOTS }).map(t => t.ref), ['tcp_a', 'tcp_b'])
})

test('全状態が語を持つ — 未宣言の状態は throw する', () => {
  for (const s of Object.values(GRASP_RELATION_STATE)) assert.doesNotThrow(() => relationWordsFor(s))
  assert.throws(() => relationWordsFor('orphan'), /未宣言の関係の状態/)
})

// ── 引き上げは関係の欄 — 旧位置の引き上げも関係を持つ (ADR-164 D4) ────────────

test('旧位置の引き上げだけを持つワークも関係の行を持つ — 引き上げが画面から落ちない', () => {
  const legacy = { ...box('cube'), lift: { along: 'worldUp', distance: 50 } }
  const doc = { entities: [legacy, box('plate')] }
  const rels = graspRelationsOf({ docDsl: doc, sceneDsl: { entities: [...doc.entities, ...ROBOTS] } })
  assert.deepEqual(rels.map(r => [r.objectRef, r.state]), [['cube', GRASP_RELATION_STATE.HAND_UNDECLARED]])
})

test('where を言わず引き上げと手だけを言う関係は ok — kind は省略可', () => {
  const doc = { entities: [box('cube', { tcp: 'tcp_a', lift: { along: 'worldUp', distance: 50 } })] }
  const [r] = graspRelationsOf({ docDsl: doc, sceneDsl: { entities: [...doc.entities, ...ROBOTS] } })
  assert.equal(r.state, GRASP_RELATION_STATE.OK)
  assert.equal(r.tcpRef, 'tcp_a')
})
