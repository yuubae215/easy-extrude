/**
 * ADR-159 — 宣言の押下が、画面にだけ在る物を文書へ取り込む (1 つの undo で)。
 *
 * 本物の ContextController + ContextService を、id を保つ fake シーンの上で通す。
 * 問うこと:
 *   1. 文書 0 個で宣言 → 文書 1 個、宣言が書かれ、物は compiled id で 1 個だけ在る
 *      (二重に生えない)。他の物 (未宣言) はそのまま残る。
 *   2. undo 1 回で文書 0 個・元の id のシーンへ戻る。redo で同じ状態へ。
 *   3. 文書が在るが物が無い (Shift+A の箱) → 黙って消えずに取り込まれる (原則 #11)。
 *   4. 消去は取り込まない — 宣言の無い物から消すものは無い。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ContextController } from './controller/ContextController.js'
import { ContextService } from './service/ContextService.js'
import { compileLayout } from './layout/LayoutCompiler.js'
import { ON_SCREEN_FACT_REF } from './context/DocBuilder.js'

/** importFromJson が id を保つ fake (SceneService の clear+preserve 意味論と同じ)。 */
function fakeScene(initial) {
  const objects = new Map()
  for (const o of initial.objects) objects.set(o.id, structuredClone(o))
  let links = structuredClone(initial.links ?? [])
  return {
    scene: { objects },
    objects,
    async importFromJson(parsed, _vc, { clear = true, preserve = null } = {}) {
      if (clear) {
        for (const id of [...objects.keys()]) if (!preserve?.has(id)) objects.delete(id)
        links = []
      }
      for (const o of parsed.objects ?? []) objects.set(o.id, structuredClone(o))
      links.push(...structuredClone(parsed.links ?? []))
      return { imported: (parsed.objects ?? []).length, skipped: 0 }
    },
    snapshotJson() {
      return { version: '1.3', objects: [...objects.values()].map(o => structuredClone(o)), links: structuredClone(links) }
    },
  }
}

/** Shift+A で置いた箱 2 つ (コンパイラの id ではない) のシーン。 */
function screenOnly() {
  const scene = compileLayout({
    version: 'layout/1.0', strategy: 'manual',
    entities: [
      { ref: 'a', type: 'Solid', name: 'ワーク 1', dimensions: { x: 80, y: 40, z: 60 }, position: { x: 500, y: 0, z: 30 } },
      { ref: 'b', type: 'Solid', name: '作業台',   dimensions: { x: 300, y: 300, z: 10 }, position: { x: 500, y: 0, z: -5 } },
    ],
  })
  const rename = id => id.replace(/^solid_(\w)$/, 'obj_$1_1').replace(/^cf_origin_(\w)$/, 'obj_$1_1_origin')
  scene.objects = scene.objects.map(o => ({ ...o, id: rename(o.id), ...(o.parentId ? { parentId: rename(o.parentId) } : {}) }))
  return scene
}

function setup(initial = screenOnly()) {
  const scene = fakeScene(initial)
  const svc = new ContextService(scene)
  const stack = []
  const redo = []
  const ctrl = {
    _ctxService: svc,
    _service: scene,
    _commandStack: { push: c => stack.push(c) },
    _refreshUndoRedoState() {},
    _uiView: { toasts: [], showToast(msg, opt) { this.toasts.push({ msg, opt }) } },
  }
  const cc = new ContextController(ctrl)
  cc._viewContext = () => ({})
  const undo = async () => { const c = stack.pop(); await c.undo(); redo.push(c) }
  const redoOne = async () => { const c = redo.pop(); await c.execute(); stack.push(c) }
  return { scene, svc, cc, ctrl, stack, undo, redo: redoOne }
}

const entity = (svc, ref) => svc.getDoc()?.specification?.layout?.entities?.find(e => e.ref === ref)

test('文書 0 個で質量を宣言 → 文書が起き、宣言が書かれ、物は 1 個だけ在る', async () => {
  const { scene, svc, cc, ctrl, stack } = setup()
  assert.equal(svc.loaded, false)

  await cc.setMassDeclaration('obj_a_1', 'mass', 1.5)

  assert.equal(svc.loaded, true, '文書が起きていない')
  assert.equal(entity(svc, 'obj_a_1')?.mass, 1.5, '宣言が文書に書かれていない')
  assert.ok(svc.getDoc().specification.trace.some(t => t.from === ON_SCREEN_FACT_REF && t.to === 'obj_a_1'),
    '取り込んだ実体に「誰が頼んだか」の trace が無い (ADR-046 不変条件 1)')
  const ids = [...scene.objects.keys()]
  assert.ok(ids.includes('solid_obj_a_1'), '投影された物が無い')
  assert.ok(!ids.includes('obj_a_1'), '元の物が残っている — 同じ物が 2 個に見える')
  assert.ok(ids.includes('obj_b_1'), '宣言していない物 (作業台) が消えた (ADR-131)')
  assert.equal(entity(svc, 'obj_b_1'), undefined, '頼んでいない物まで文書に入れている')
  assert.equal(stack.length, 1, 'undo 記録が 1 つでない')
  assert.ok(ctrl._uiView.toasts.some(t => /Started a document from the screen/.test(t.msg)),
    '起きたことが画面に出ていない (原則 #11)')
})

test('undo 1 回で文書 0 個・元の id のシーンへ戻り、redo で同じ状態へ', async () => {
  const { scene, svc, cc, undo, redo } = setup()
  const before = [...scene.objects.keys()].sort()

  await cc.setGraspFeature('obj_a_1', { kind: 'anywhere' })
  assert.deepEqual(entity(svc, 'obj_a_1')?.graspFeature, { kind: 'anywhere' })

  await undo()
  assert.equal(svc.loaded, false, 'undo で文書が残った')
  assert.deepEqual([...scene.objects.keys()].sort(), before, 'undo で元のシーン (元の id) に戻らない')

  await redo()
  assert.equal(svc.loaded, true)
  assert.deepEqual(entity(svc, 'obj_a_1')?.graspFeature, { kind: 'anywhere' })
  assert.ok(scene.objects.has('solid_obj_a_1') && !scene.objects.has('obj_a_1'))
})

test('文書が在っても物が無ければ取り込む — 黙って消えない (原則 #11)', async () => {
  const { scene, svc, cc, ctrl } = setup()
  await cc.setMassDeclaration('obj_a_1', 'mass', 1)          // 文書が起きる
  await cc.setMassDeclaration('obj_b_1', 'mass', 20)         // 既存の文書へ追加
  assert.equal(entity(svc, 'obj_b_1')?.mass, 20)
  assert.equal(entity(svc, 'obj_a_1')?.mass, 1, '先の宣言が失われた')
  assert.ok(scene.objects.has('solid_obj_b_1') && !scene.objects.has('obj_b_1'))
  assert.ok(ctrl._uiView.toasts.some(t => /added to the document from the screen/.test(t.msg)))

  // 文書に在る物への 2 度目の宣言は普通の doc edit (取り込み直さない)。
  await cc.setMassDeclaration('obj_a_1', 'mass', 2)
  assert.equal(entity(svc, 'obj_a_1')?.mass, 2)
  assert.equal(svc.getDoc().specification.layout.entities.filter(e => e.ref === 'obj_a_1').length, 1)
})

test('消去は取り込まない — 宣言の無い物から消すものは無い', async () => {
  const { svc, cc, stack } = setup()
  await cc.setMassDeclaration('obj_a_1', 'centerOfMass', null)
  assert.equal(svc.loaded, false)
  assert.equal(stack.length, 0)
})

test('取り込めない物は理由つきで拒否 — 文書もシーンも変わらない', async () => {
  const initial = screenOnly()
  initial.links = [{ id: 'l1', sourceId: 'obj_a_1', targetId: 'obj_b_1', semanticType: 'mounts' }]
  const { scene, svc, cc, ctrl, stack } = setup(initial)
  const before = [...scene.objects.keys()].sort()
  await cc.setMassDeclaration('obj_a_1', 'mass', 1)
  assert.equal(svc.loaded, false)
  assert.equal(stack.length, 0)
  assert.deepEqual([...scene.objects.keys()].sort(), before)
  assert.ok(ctrl._uiView.toasts.some(t => t.opt?.type === 'warn' && /link/.test(t.msg)))
})
