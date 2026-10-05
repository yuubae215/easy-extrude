/**
 * ADR-159 / ADR-163 — 画面にだけ在る物を、宣言の押下で文書へ取り込む計画。
 *
 * 計画は純粋 (シーンの JSON・ref・文書の footprint → 書く実体と制約 + 差し替える id)。
 * ADR-163: シーン全体を逆変換してから、文書に無い物の連結成分を切り出す。拒否は
 * 「Layout の語で言えない物」(unconvertible) と「画面に無い物」だけ。
 *
 * 成分の N 個は N=1 の fixture では区別できない (原則 #31) — 成分の検査は 2 個以上で焼く。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compileLayout } from '../layout/LayoutCompiler.js'
import {
  planSceneAdoption, adoptionComponent, adoptionRefusalMessage, adoptionToast, ADOPTION_REFUSAL,
} from './sceneAdoption.js'

/**
 * Shift+A で置いた箱と同じ形のシーン — compileLayout の出力の id を `obj_…` に
 * 付け替える (コンパイラの id ではない物こそ取り込みの対象)。`table` は付け替えない
 * ので、文書が投影した物 (`solid_table`) として使える。
 */
function sceneWithBoxes({ withFrame = false, second = false } = {}) {
  const scene = compileLayout({
    version: 'layout/1.0', strategy: 'manual',
    entities: [
      { ref: 'box', type: 'Solid', name: 'ワーク 1', dimensions: { x: 80, y: 40, z: 60 },
        position: { x: 500, y: 0, z: 30 },
        ...(withFrame ? { frames: [{ ref: 'grip', name: 'grip', translation: { x: 0, y: 0, z: 30 } }] } : {}) },
      ...(second ? [{ ref: 'box2', type: 'Solid', name: 'ワーク 2', dimensions: { x: 40, y: 40, z: 40 },
        position: { x: 600, y: 0, z: 20 } }] : []),
      { ref: 'table', type: 'Solid', name: '作業台', dimensions: { x: 300, y: 300, z: 10 }, position: { x: 500, y: 0, z: -5 } },
    ],
  })
  const rename = new Map([
    ['solid_box', 'obj_1_100'], ['cf_origin_box', 'obj_1_100_origin'], ['cf_box_grip', 'obj_1_100_grip'],
    ['solid_box2', 'obj_2_100'], ['cf_origin_box2', 'obj_2_100_origin'],
  ])
  const re = id => rename.get(id) ?? id
  scene.objects = scene.objects.map(o => ({ ...o, id: re(o.id), ...(o.parentId ? { parentId: re(o.parentId) } : {}) }))
  return scene
}

/** 文書が `table` だけを投影している footprint (ADR-131) と、その ref の読み (compiler の map)。 */
const DOC_HOLDS_TABLE = {
  held: new Set(['solid_table', 'cf_origin_table']),
  docRefOf: id => ({ solid_table: 'table', cf_origin_table: 'table_origin' })[id] ?? null,
}

test('画面の箱は、その Origin と frame ごと 1 つの実体として取り込まれる', () => {
  const plan = planSceneAdoption(sceneWithBoxes({ withFrame: true }), 'obj_1_100', DOC_HOLDS_TABLE)
  assert.equal(plan.ok, true)
  assert.deepEqual(new Set(plan.sceneIds), new Set(['obj_1_100', 'obj_1_100_origin', 'obj_1_100_grip']))
  assert.equal(plan.entities.length, 1)
  const [e] = plan.entities
  assert.equal(e.ref, 'obj_1_100')
  assert.equal(e.type, 'Solid')
  assert.deepEqual(e.dimensions, { x: 80, y: 40, z: 60 })
  assert.deepEqual(e.position, { x: 500, y: 0, z: 30 })
  assert.equal(e.frames.length, 1, 'frame は実体に畳まれて運ばれる — 落ちない')
  assert.equal(plan.name, 'ワーク 1')
  assert.deepEqual(plan.constraints, [])
})

test('つながっていない物は入らない — 文書に無くても、頼まれていなければ (案 C の却下)', () => {
  const plan = planSceneAdoption(sceneWithBoxes({ second: true }), 'obj_1_100')
  assert.equal(plan.ok, true)
  assert.deepEqual(plan.entities.map(e => e.ref), ['obj_1_100'])
  assert.ok(!plan.sceneIds.some(id => id.startsWith('obj_2_100') || id.includes('table')))
})

test('リンクでつながった画面の物 2 個は、リンクごと一緒に入る (D2)', () => {
  const scene = sceneWithBoxes({ second: true })
  scene.links = [{ id: 'l1', sourceId: 'obj_1_100_origin', targetId: 'obj_2_100_origin', jointType: 'fixed', semanticType: 'fastened' }]
  const plan = planSceneAdoption(scene, 'obj_1_100', DOC_HOLDS_TABLE)
  assert.equal(plan.ok, true)
  assert.deepEqual(plan.entities.map(e => e.ref).sort(), ['obj_1_100', 'obj_2_100'])
  assert.deepEqual(new Set(plan.sceneIds), new Set(['obj_1_100', 'obj_1_100_origin', 'obj_2_100', 'obj_2_100_origin']))
  assert.deepEqual(plan.constraints, [{
    source: 'obj_1_100_origin', target: 'obj_2_100_origin',
    jointType: 'fixed', semanticType: 'fastened', properties: {},
  }])
  // 取り込んだ形は compiler がそのまま読める (φ(φ⁻¹) — 制約がリンクに戻る)。
  const back = compileLayout({ version: 'layout/1.0', strategy: 'manual', entities: plan.entities, constraints: plan.constraints })
  assert.deepEqual(back.links.map(l => [l.sourceId, l.targetId]), [['cf_origin_obj_1_100', 'cf_origin_obj_2_100']])
})

test('成分は推移的 — 子の先のリンクの先まで辿る', () => {
  const scene = sceneWithBoxes({ second: true })
  scene.objects.push({ id: 'obj_9', type: 'CoordinateFrame', name: 'stray', parentId: 'obj_1_100',
    translation: { x: 0, y: 0, z: 10 }, rotation: { x: 0, y: 0, z: 0, w: 1 } })
  scene.links = [{ id: 'l1', sourceId: 'obj_9', targetId: 'obj_2_100_origin', jointType: 'fixed', semanticType: 'fastened' }]
  const plan = planSceneAdoption(scene, 'obj_1_100', DOC_HOLDS_TABLE)
  assert.equal(plan.ok, true, plan.detail)
  assert.deepEqual(plan.entities.map(e => e.ref).sort(), ['obj_1_100', 'obj_2_100', 'obj_9'])
  const stray = plan.entities.find(e => e.ref === 'obj_9')
  assert.equal(stray.parentRef, 'obj_1_100', '子は親子の関係ごと入る — 宙に浮かない')
  assert.equal(plan.constraints.length, 1)
})

test('文書の物へのリンクは、文書の ref の制約として入り、文書の物は読み戻されない (D3)', () => {
  const scene = sceneWithBoxes({ second: true })
  scene.links = [
    { id: 'l1', sourceId: 'obj_1_100_origin', targetId: 'cf_origin_table', jointType: 'fixed', semanticType: 'fastened' },
    { id: 'l2', sourceId: 'obj_2_100_origin', targetId: 'cf_origin_table', jointType: 'fixed', semanticType: 'fastened' },
  ]
  const plan = planSceneAdoption(scene, 'obj_1_100', DOC_HOLDS_TABLE)
  assert.equal(plan.ok, true)
  assert.deepEqual(plan.entities.map(e => e.ref), ['obj_1_100'],
    '文書の物 (table) を経由して別の画面の物 (ワーク 2) へ広がってはいけない — 文書の物で歩みは止まる')
  assert.ok(!plan.sceneIds.includes('solid_table'))
  assert.deepEqual(plan.constraints.map(c => [c.source, c.target]), [['obj_1_100_origin', 'table_origin']])
})

test('文書の ref は文書の map から取る — 逆変換の ref (slug 済み) ではない', () => {
  const scene = sceneWithBoxes()
  scene.links = [{ id: 'l1', sourceId: 'obj_1_100_origin', targetId: 'cf_origin_table', jointType: 'fixed', semanticType: 'fastened' }]
  const plan = planSceneAdoption(scene, 'obj_1_100', {
    held: DOC_HOLDS_TABLE.held,
    docRefOf: id => ({ solid_table: 'table-1', cf_origin_table: 'table-1_origin' })[id] ?? null,
  })
  assert.equal(plan.ok, true)
  assert.equal(plan.constraints[0].target, 'table-1_origin')
})

test('画面の frame が文書の物にぶら下がっていれば、parentRef は文書の ref (D3)', () => {
  const scene = sceneWithBoxes()
  scene.objects.push({ id: 'obj_9', type: 'CoordinateFrame', name: 'marker', parentId: 'solid_table',
    translation: { x: 0, y: 0, z: 10 }, rotation: { x: 0, y: 0, z: 0, w: 1 } })
  scene.links = [{ id: 'l1', sourceId: 'obj_1_100_origin', targetId: 'obj_9', jointType: 'fixed', semanticType: 'fastened' }]
  const plan = planSceneAdoption(scene, 'obj_1_100', DOC_HOLDS_TABLE)
  assert.equal(plan.ok, true, plan.detail)
  assert.equal(plan.entities.find(e => e.ref === 'obj_9')?.parentRef, 'table')
})

test('Layout の語で言えない物が成分に居れば、理由つきで拒否 (D4 unconvertible)', () => {
  const scene = sceneWithBoxes()
  scene.objects.push({ id: 'mesh_1', type: 'ImportedMesh', name: 'scan', parentId: 'obj_1_100' })
  const plan = planSceneAdoption(scene, 'obj_1_100', DOC_HOLDS_TABLE)
  assert.equal(plan.ok, false)
  assert.equal(plan.reason, ADOPTION_REFUSAL.UNCONVERTIBLE)
  assert.match(adoptionRefusalMessage(plan), /"ワーク 1".*"scan".*ImportedMesh/)
})

test('言えない物でも、つながっていなければ取り込みを止めない', () => {
  const scene = sceneWithBoxes()
  scene.objects.push({ id: 'mesh_1', type: 'ImportedMesh', name: 'scan' })
  assert.equal(planSceneAdoption(scene, 'obj_1_100', DOC_HOLDS_TABLE).ok, true)
})

test('文書の物の Origin の下の frame とつながる物は拒否 — 入れるには文書の物を書き換えるしかない', () => {
  const scene = sceneWithBoxes()
  scene.objects.push({ id: 'obj_9', type: 'CoordinateFrame', name: 'tab', parentId: 'cf_origin_table',
    translation: { x: 0, y: 0, z: 10 }, rotation: { x: 0, y: 0, z: 0, w: 1 } })
  scene.links = [{ id: 'l1', sourceId: 'obj_1_100_origin', targetId: 'obj_9', jointType: 'fixed', semanticType: 'fastened' }]
  const plan = planSceneAdoption(scene, 'obj_1_100', DOC_HOLDS_TABLE)
  assert.equal(plan.ok, false)
  assert.equal(plan.reason, ADOPTION_REFUSAL.UNCONVERTIBLE)
  assert.match(plan.detail, /"tab".*already in the document/)
})

test('画面に無い ref は拒否 (理由つき)', () => {
  const plan = planSceneAdoption(sceneWithBoxes(), 'ghost')
  assert.equal(plan.ok, false)
  assert.equal(plan.reason, ADOPTION_REFUSAL.NOT_ON_SCREEN)
})

test('退役した拒否理由 (has-children / linked) は語彙に無い (ADR-163 Retires)', () => {
  assert.deepEqual(Object.values(ADOPTION_REFUSAL).sort(), ['not-on-screen', 'unconvertible'])
})

test('未宣言の拒否理由は throw — 文言を undefined で出さない (原則 #31)', () => {
  assert.throws(() => adoptionRefusalMessage({ reason: 'mystery', name: 'x', detail: '' }), /未宣言/)
  assert.throws(() => adoptionRefusalMessage({ reason: 'has-children', name: 'x', detail: '' }), /未宣言/)
})

test('adoptionComponent: 文書の物 (held) で歩みが止まる', () => {
  const objects = [{ id: 'a' }, { id: 'b' }, { id: 'd' }, { id: 'c' }]
  const links = [{ sourceId: 'a', targetId: 'd' }, { sourceId: 'd', targetId: 'c' }, { sourceId: 'a', targetId: 'b' }]
  assert.deepEqual(adoptionComponent(objects, links, new Set(['d']), 'a'), new Set(['a', 'b']))
  assert.deepEqual(adoptionComponent(objects, links, new Set(), 'a'), new Set(['a', 'b', 'c', 'd']))
})

test('トーストは一緒に入った数を言う (N≥2) — 1 個のときは ADR-159 の文のまま', () => {
  assert.equal(adoptionToast({ name: 'A', entities: [{}], constraints: [] }, true),
    '"A" was added to the document from the screen.')
  assert.equal(adoptionToast({ name: 'A', entities: [{}, {}], constraints: [{}] }, false),
    'Started a document from the screen — "A" is now declared in it together with 1 attached object and 1 link.')
  assert.equal(adoptionToast({ name: 'A', entities: [{}], constraints: [{}] }, true),
    '"A" was added to the document from the screen with 1 link.')
})
