/**
 * ADR-159 / ADR-163 — 宣言の押下が、画面にだけ在る物を文書へ取り込む (1 つの undo で)。
 *
 * 本物の ContextController + ContextService を、id を保つ fake シーンの上で通す。
 * 問うこと:
 *   1. 文書 0 個で宣言 → 文書 1 個、宣言が書かれ、物は compiled id で 1 個だけ在る
 *      (二重に生えない)。他の物 (未宣言) はそのまま残る。
 *   2. undo 1 回で文書 0 個・元の id のシーンへ戻る。redo で同じ状態へ。
 *   3. 文書が在るが物が無い (Shift+A の箱) → 黙って消えずに取り込まれる (原則 #11)。
 *   4. 消去は取り込まない — 宣言の無い物から消すものは無い。
 *   5. (ADR-163) リンクでつながった画面の物 N 個はリンクごと入り、undo 1 回で戻る。
 *      文書の物へのリンクは制約として入り、文書の物の $fact / $decision は変わらない。
 *   6. (ADR-163) Layout の語で言えない物とつながっていれば理由つきで拒否、何も変わらない。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ContextController } from './controller/ContextController.js'
import { ContextService } from './service/ContextService.js'
import { compileLayout } from './layout/LayoutCompiler.js'
import { ON_SCREEN_FACT_REF } from './context/DocBuilder.js'
import { readFileSync } from 'node:fs'

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
        // SceneService._clearScene: a link survives only when BOTH ends do.
        links = links.filter(l => preserve?.has(l.sourceId) && preserve?.has(l.targetId))
      }
      for (const o of parsed.objects ?? []) objects.set(o.id, structuredClone(o))
      links.push(...structuredClone(parsed.links ?? []))
      return { imported: (parsed.objects ?? []).length, skipped: 0 }
    },
    /** 画面での操作 (Shift+A・Fasten) の代わり — 投影を通らずにシーンへ足す。 */
    place(objs, newLinks = []) {
      for (const o of objs) objects.set(o.id, structuredClone(o))
      links.push(...structuredClone(newLinks))
    },
    links: () => links,
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

const FASTEN = (id, sourceId, targetId) => ({ id, sourceId, targetId, jointType: 'fixed', semanticType: 'fastened', properties: {} })

test('Fasten で留めた画面の箱 2 個: 片方への宣言で 2 個とリンクが文書へ入り、undo 1 回で戻る (ADR-163)', async () => {
  const initial = screenOnly()
  initial.links = [FASTEN('l1', 'obj_a_1_origin', 'obj_b_1_origin')]
  const { scene, svc, cc, ctrl, stack, undo, redo } = setup(initial)
  const beforeIds = [...scene.objects.keys()].sort()

  await cc.setMassDeclaration('obj_a_1', 'mass', 1.5)

  assert.equal(svc.loaded, true)
  assert.equal(entity(svc, 'obj_a_1')?.mass, 1.5)
  assert.ok(entity(svc, 'obj_b_1'), 'つながった物が文書に入っていない')
  const layout = svc.getDoc().specification.layout
  assert.deepEqual(layout.constraints.map(c => [c.source, c.target]), [['obj_a_1_origin', 'obj_b_1_origin']])
  const trace = svc.getDoc().specification.trace.filter(t => t.from === ON_SCREEN_FACT_REF).map(t => t.to)
  assert.deepEqual(trace.sort(), ['constraint:obj_a_1_origin→obj_b_1_origin', 'obj_a_1', 'obj_b_1'],
    '入れた全実体と全制約に「誰が頼んだか」が張られていない (ADR-046 不変条件 1)')
  const ids = [...scene.objects.keys()]
  assert.ok(ids.includes('solid_obj_a_1') && ids.includes('solid_obj_b_1'))
  assert.ok(!ids.includes('obj_a_1') && !ids.includes('obj_b_1'), '元の物が残っている — 同じ物が 2 個に見える')
  assert.deepEqual(scene.links().map(l => [l.sourceId, l.targetId]), [['cf_origin_obj_a_1', 'cf_origin_obj_b_1']],
    'リンクが compiled id で 1 本だけ在るはず (古いリンクが残る / 落ちる)')
  assert.equal(stack.length, 1, 'N 個入っても undo 記録は 1 つ')
  assert.ok(ctrl._uiView.toasts.some(t => /together with 1 attached object and 1 link/.test(t.msg)),
    '頼んだ以外の物も入ったことを言っていない (原則 #11)')
  assert.ok(!ctrl._uiView.toasts.some(t => /DEF-060/.test(t.msg)))

  await undo()
  assert.equal(svc.loaded, false)
  assert.deepEqual([...scene.objects.keys()].sort(), beforeIds, 'undo で元の id のシーンに戻らない')
  assert.deepEqual(scene.links().map(l => l.id), ['l1'], 'undo で元のリンクが戻らない')

  await redo()
  assert.ok(entity(svc, 'obj_b_1') && scene.objects.has('solid_obj_b_1'))
})

test('文書の物へ留めた画面の箱: 制約が文書の ref で入り、文書の物の $fact / $decision は変わらない (ADR-163 D3)', async () => {
  const doc = JSON.parse(readFileSync(new URL('../examples/factory_context.json', import.meta.url), 'utf8'))
  const { scene, svc, cc, stack, undo } = setup({ objects: [], links: [] })
  await svc.loadContext(doc, {})
  const bench = structuredClone(entity(svc, 'workbench'))
  assert.match(JSON.stringify(bench), /\$fact/, 'fixture の前提: workbench は $fact で寸法を持つ')
  assert.ok(scene.objects.has('cf_origin_workbench'), 'fixture の前提: workbench の Origin が投影されている')

  const box = screenOnly().objects.filter(o => o.id.startsWith('obj_a_1'))
  scene.place(box, [FASTEN('l9', 'obj_a_1_origin', 'cf_origin_workbench')])
  const beforeIds = [...scene.objects.keys()].sort()
  const beforeDoc = JSON.stringify(svc.getDoc())

  await cc.setMassDeclaration('obj_a_1', 'mass', 2)

  assert.equal(entity(svc, 'obj_a_1')?.mass, 2)
  assert.deepEqual(entity(svc, 'workbench'), bench, '文書の物が逆変換の数値で上書きされた')
  const added = svc.getDoc().specification.layout.constraints.filter(c => c.source === 'obj_a_1_origin')
  assert.deepEqual(added.map(c => c.target), ['workbench_origin'])
  assert.ok(scene.links().some(l => l.sourceId === 'cf_origin_obj_a_1' && l.targetId === 'cf_origin_workbench'))
  assert.equal(stack.length, 1)

  await undo()
  assert.equal(JSON.stringify(svc.getDoc()), beforeDoc, 'undo で前の文書に戻らない')
  assert.deepEqual([...scene.objects.keys()].sort(), beforeIds)
})

test('Layout の語で言えない物とつながっていれば理由つきで拒否 — 文書もシーンも変わらない (ADR-163 D4)', async () => {
  const initial = screenOnly()
  initial.objects.push({ id: 'mesh_1', type: 'ImportedMesh', name: 'scan' })
  initial.links = [FASTEN('l1', 'obj_a_1_origin', 'mesh_1')]
  const { scene, svc, cc, ctrl, stack } = setup(initial)
  const before = [...scene.objects.keys()].sort()
  await cc.setMassDeclaration('obj_a_1', 'mass', 1)
  assert.equal(svc.loaded, false)
  assert.equal(stack.length, 0)
  assert.deepEqual([...scene.objects.keys()].sort(), before)
  assert.ok(ctrl._uiView.toasts.some(t => t.opt?.type === 'warn' && /"scan".*ImportedMesh/.test(t.msg)))
  assert.ok(!ctrl._uiView.toasts.some(t => /DEF-060/.test(t.msg)))
})
