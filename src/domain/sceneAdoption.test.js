/**
 * ADR-159 — 画面にだけ在る物を、宣言の押下で文書へ取り込む計画。
 *
 * 計画は純粋 (シーンの JSON と ref → 書く実体 + 差し替える id)。拒否するのは
 * 「新しい id で作り直すと他の何かが宙に浮く」ときだけで、黙って浮かせない (原則 #11)。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compileLayout } from '../layout/LayoutCompiler.js'
import { planSceneAdoption, adoptionRefusalMessage, ADOPTION_REFUSAL } from './sceneAdoption.js'

/**
 * Shift+A で置いた箱と同じ形のシーン — compileLayout の出力の id を `obj_…` に
 * 付け替える (コンパイラの id ではない物こそ取り込みの対象)。
 */
function sceneWithBox({ withFrame = false } = {}) {
  const scene = compileLayout({
    version: 'layout/1.0', strategy: 'manual',
    entities: [
      { ref: 'box', type: 'Solid', name: 'ワーク 1', dimensions: { x: 80, y: 40, z: 60 },
        position: { x: 500, y: 0, z: 30 },
        ...(withFrame ? { frames: [{ ref: 'grip', name: 'grip', translation: { x: 0, y: 0, z: 30 } }] } : {}) },
      { ref: 'table', type: 'Solid', name: '作業台', dimensions: { x: 300, y: 300, z: 10 }, position: { x: 500, y: 0, z: -5 } },
    ],
  })
  const rename = new Map([['solid_box', 'obj_1_100'], ['cf_origin_box', 'obj_1_100_origin'], ['cf_box_grip', 'obj_1_100_grip']])
  const re = id => rename.get(id) ?? id
  scene.objects = scene.objects.map(o => ({ ...o, id: re(o.id), ...(o.parentId ? { parentId: re(o.parentId) } : {}) }))
  return scene
}

test('画面の箱は、その Origin と frame ごと 1 つの実体として取り込まれる', () => {
  const plan = planSceneAdoption(sceneWithBox({ withFrame: true }), 'obj_1_100')
  assert.equal(plan.ok, true)
  assert.deepEqual(new Set(plan.sceneIds), new Set(['obj_1_100', 'obj_1_100_origin', 'obj_1_100_grip']))
  assert.equal(plan.entity.ref, 'obj_1_100')
  assert.equal(plan.entity.type, 'Solid')
  assert.deepEqual(plan.entity.dimensions, { x: 80, y: 40, z: 60 })
  assert.deepEqual(plan.entity.position, { x: 500, y: 0, z: 30 })
  assert.equal(plan.entity.frames.length, 1, 'frame は実体に畳まれて運ばれる — 落ちない')
  assert.equal(plan.name, 'ワーク 1')
})

test('他の物 (作業台) は計画に入らない — 取り込むのは宣言した 1 つだけ', () => {
  const plan = planSceneAdoption(sceneWithBox(), 'obj_1_100')
  assert.ok(!plan.sceneIds.some(id => id.includes('table')))
})

test('画面に無い ref は拒否 (理由つき)', () => {
  const plan = planSceneAdoption(sceneWithBox(), 'ghost')
  assert.equal(plan.ok, false)
  assert.equal(plan.reason, ADOPTION_REFUSAL.NOT_ON_SCREEN)
})

test('自分の一部でない子を持つ物は拒否 — 作り直すと子が宙に浮く', () => {
  const scene = sceneWithBox()
  scene.objects.push({ id: 'obj_9', type: 'CoordinateFrame', name: 'stray', parentId: 'obj_1_100', translation: { x: 0, y: 0, z: 0 } })
  const plan = planSceneAdoption(scene, 'obj_1_100')
  assert.equal(plan.ok, false)
  assert.equal(plan.reason, ADOPTION_REFUSAL.HAS_CHILDREN)
  assert.match(adoptionRefusalMessage(plan), /"ワーク 1".*stray.*DEF-060/)
})

test('リンクでつながった物は拒否 — 作り直すとリンクが切れる', () => {
  const scene = sceneWithBox()
  scene.links = [{ id: 'l1', sourceId: 'obj_1_100', targetId: 'solid_table', semanticType: 'mounts' }]
  const plan = planSceneAdoption(scene, 'obj_1_100')
  assert.equal(plan.ok, false)
  assert.equal(plan.reason, ADOPTION_REFUSAL.LINKED)
})

test('未宣言の拒否理由は throw — 文言を undefined で出さない (原則 #31)', () => {
  assert.throws(() => adoptionRefusalMessage({ reason: 'mystery', name: 'x', detail: '' }), /未宣言/)
})
