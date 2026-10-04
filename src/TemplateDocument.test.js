/**
 * ADR-162 — Home テンプレの読み込みは、その Layout DSL を持つ文書を開く。
 *
 * 問うこと:
 *   1. 全テンプレ (母集団は LAYOUT_TEMPLATE_CATALOG — 列挙は機械が導く): `docFromLayout`
 *      が妥当な文書を作り、その文書は DSL そのものと**同じシーン**へコンパイルされる
 *      (源が 1 つ — 文書を挟んでも絵は変わらない)。
 *   2. シングルアームのワーク 1 (箱の床へ fastened) に質量を宣言 → 警告なしの普通の
 *      doc edit。シーン id もリンクも変わらない (DEF-060 へ迷い込まない)。
 *   3. 先に別の文書が開いていても、テンプレの読み込み後の文書はテンプレのもの
 *      (古い文書が新しいシーンの横に残らない — 基数 1 の不正な組)。
 *   4. 確定した移動の書き手 (`recordConfirmedPoses` — Grab と Aim が共有) は、固定
 *      ジョイントで運ばれた物の姿勢も同じ doc edit で書く (ADR-162 D3)。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { ContextController } from './controller/ContextController.js'
import { ContextService } from './service/ContextService.js'
import { compileLayout } from './layout/LayoutCompiler.js'
import { compileContext } from './context/ContextCompiler.js'
import { validateContext } from './context/ContextValidator.js'
import { docFromLayout, TEMPLATE_FACT_REF } from './context/DocBuilder.js'
import { LAYOUT_TEMPLATE_CATALOG } from './layout/LayoutTemplateCatalog.js'
import { Solid } from './domain/Solid.js'

const readExample = file =>
  JSON.parse(fs.readFileSync(new URL(`../examples/${file}`, import.meta.url), 'utf8'))

const exampleTemplates = LAYOUT_TEMPLATE_CATALOG.filter(t => t.source.kind === 'example')

/** importFromJson が id を保つ fake (SceneService の clear+preserve 意味論と同じ)。 */
function fakeScene() {
  const objects = new Map()
  let links = []
  return {
    scene: { objects },
    objects,
    get links() { return links },
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

function setup() {
  const scene = fakeScene()
  const svc = new ContextService(scene)
  const ctrl = {
    _ctxService: svc,
    _service: scene,
    _commandStack: { push() {} },
    _refreshUndoRedoState() {},
    _uiView: { toasts: [], showToast(msg, opt) { this.toasts.push({ msg, opt }) } },
  }
  const cc = new ContextController(ctrl)
  cc._viewContext = () => ({})
  return { scene, svc, cc, ctrl }
}

test('テンプレの母集団は空でない (空なら下の検査は何も問わずに緑になる — 原則 #31)', () => {
  assert.ok(exampleTemplates.length >= 1)
})

for (const t of exampleTemplates) {
  test(`${t.id}: 文書は妥当で、DSL そのものと同じシーンへコンパイルされる`, () => {
    const dsl = readExample(t.source.file)
    const doc = docFromLayout(dsl, t.name)
    const v = validateContext(doc)
    assert.ok(v.valid, `文書が妥当でない:\n  ${v.errors.join('\n  ')}`)
    assert.equal(doc.meta.name, t.name)
    assert.deepEqual(compileLayout(compileContext(doc).layoutDsl), compileLayout(dsl),
      '文書を挟むと絵が変わる — 源が 2 つになっている')
    assert.notStrictEqual(doc.specification.layout, dsl, '入力の DSL を共有している (原則 #6)')
  })
}

test('シングルアームのワーク 1 に質量を宣言 → 普通の doc edit (警告なし・id もリンクも不変)', async () => {
  const { scene, svc, cc, ctrl } = setup()
  const dsl = readExample('layout_pick_place_cell.json')
  await svc.loadContext(docFromLayout(dsl), {})

  const before = [...scene.objects.keys()].sort()
  const linksBefore = structuredClone(scene.links)
  assert.ok(linksBefore.some(l => l.sourceId === 'cf_origin_work_1'),
    'fixture の前提: ワーク 1 は箱の床へリンクで留まっている (これが DEF-060 の拒否理由だった)')

  await cc.setMassDeclaration('work_1', 'mass', 0.12)

  const work1 = svc.getDoc().specification.layout.entities.find(e => e.ref === 'work_1')
  assert.equal(work1?.mass, 0.12, '宣言が文書に書かれていない')
  assert.deepEqual(ctrl._uiView.toasts.filter(t => t.opt?.type !== 'info'), [],
    '警告・エラーが出た — 画面からの取り込み (ADR-159) へ迷い込んでいる')
  assert.deepEqual([...scene.objects.keys()].sort(), before, 'シーン id が変わった')
  assert.deepEqual(scene.links, linksBefore, 'リンクが変わった')
  assert.ok(svc.getDoc().specification.trace.some(t => t.from === TEMPLATE_FACT_REF && t.to === 'work_1'))
})

test('先に別の文書が開いていても、テンプレ読み込み後の文書はテンプレのもの', async () => {
  const { svc } = setup()
  const other = docFromLayout({
    version: 'layout/1.0', strategy: 'manual',
    entities: [{ ref: 'old', type: 'Solid', name: 'Old', dimensions: { x: 1, y: 1, z: 1 }, position: { x: 0, y: 0, z: 0 } }],
  }, 'Old project')
  await svc.loadContext(other, {})
  await svc.loadContext(docFromLayout(readExample('layout_pick_place_cell.json'), 'Pick'), {})
  assert.equal(svc.getDoc().meta.name, 'Pick')
  assert.ok(!svc.getDoc().specification.layout.entities.some(e => e.ref === 'old'), '古い文書が残っている')
})

test('確定移動の書き手は、運ばれた物 (N=2) の姿勢も同じ doc edit で書く (D3 — Grab と Aim が共有)', async () => {
  const { scene, svc, cc, ctrl } = setup()
  await svc.loadContext(docFromLayout(readExample('layout_pick_place_cell.json')), {})

  // 確定直後の live 姿勢: ビンを +100 x 動かし、ワーク 2 個が付いてきた。
  const solidAt = (x, y, z) => Object.assign(Object.create(Solid.prototype),
    { _position: { x, y, z }, orientation: { x: 0, y: 0, z: 0, w: 1 } })
  const live = {
    solid_part_bin: solidAt(300, 150, 875),
    solid_work_1:   solidAt(250, 115, 822.5),
    solid_work_2:   solidAt(330, 190, 822.5),
  }
  ctrl._scene = { getObject: id => live[id] }
  let askedFor = null
  scene.fixedJointFollowersOf = ids => { askedFor = [...ids]; return new Set(['solid_work_1', 'solid_work_2']) }

  await cc.recordConfirmedPoses(['solid_part_bin'], 'Move')

  assert.deepEqual(askedFor, ['solid_part_bin'], '運ばれた物を、動かした物について問うていない')
  const pos = ref => svc.getDoc().specification.layout.entities.find(e => e.ref === ref)?.position
  assert.deepEqual(pos('part_bin'), { x: 300, y: 150, z: 875 })
  assert.deepEqual(pos('work_1'), { x: 250, y: 115, z: 822.5 }, 'ワーク 1 が古い姿勢のまま — 再生成で戻る')
  assert.deepEqual(pos('work_2'), { x: 330, y: 190, z: 822.5 }, 'ワーク 2 が古い姿勢のまま (N=2)')
  assert.deepEqual(pos('work_3'), { x: 240, y: 125, z: 822.5 }, '運ばれていない物まで書いた')
})
