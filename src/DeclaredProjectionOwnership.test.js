/**
 * DeclaredProjectionOwnership — 再生成が**消してよい実体の個数** (ADR-131)。
 *
 * ## 数えるのは「消えたもの」ではなく「消えてよかったもの」
 *
 * 文書を 1 つ書き換えるたび、`applyContextDoc(regenerate:true)` は
 * `importFromJson(..., {clear:true})` を呼び、`_clearScene()` が**全実体を dispose**
 * していた。戻ってくるのは文書が宣言した実体だけなので、`ref` を持たない実体
 * (Shift+A の箱・輸入メッシュ・計測線) は**毎回消えていた**。
 *
 * この消滅には状態が無い。削除は正当な削除とまったく同じイベントを出すので、
 * *在るもの*を辿る検査は緑を出す (原則 #31)。だから数えるのは「消えたもの」ではなく
 * **投影の footprint** — 文書が作った実体の集合 — で、その外側が 1 つでも消えたら落ちる。
 *
 * ## なぜ「ref を持つか」で判定しないか
 *
 * `ref` を持つのは文書に書かれた実体だけで、そこから**派生して生えたもの**
 * (Solid の Origin CF、`ensureRobotFrames` の upgrade) は持たない。`ref` で判定すると
 * 派生を「未宣言」として保存してしまい、次の投影が同じ id を作って衝突する。
 * 投影が自分で作ったものを覚えるほうが、母集団の取り方として正しい。
 *
 * @see docs/adr/ADR-131-a-regeneration-swaps-the-projection-not-the-scene.md
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ContextService } from './service/ContextService.js'
import { stripCommentsFlat, repoPath } from './census/sources.js'

const here = dirname(fileURLToPath(import.meta.url))
const load = name => JSON.parse(readFileSync(join(here, '../examples', name), 'utf8'))

/**
 * A fake SceneService that actually MODELS a scene — ids in a Map, and the same
 * `clear` / `preserve` contract the real one implements. A fake that only records
 * calls cannot answer this ADR's question (what survived?), and a test whose fake
 * cannot express the failure is a test that cannot fail.
 */
function fakeScene() {
  const objects = new Map()
  return {
    scene: { objects },
    objects,
    async importFromJson(parsed, _vc, { clear = true, preserve = null } = {}) {
      if (clear) {
        for (const id of [...objects.keys()]) {
          if (preserve?.has(id)) continue
          objects.delete(id)
        }
      }
      for (const o of parsed.objects ?? []) objects.set(o.id, o)
      return { imported: (parsed.objects ?? []).length, skipped: 0 }
    },
    /** 実行時に生えた未宣言の実体 (Shift+A 相当)。 */
    addAdHoc(id) { objects.set(id, { id, type: 'Solid', name: id }) },
  }
}

const viewContext = {}

test('文書の書き換えを跨いで、未宣言の実体が消えない', async () => {
  const scene = fakeScene()
  const svc   = new ContextService(scene)
  await svc.loadContext(load('cell_robotics_context.json'), viewContext)

  const projected = [...scene.objects.keys()]
  assert.ok(projected.length > 0, '投影が空 — fixture が壊れている')

  scene.addAdHoc('adhoc_box_1')
  scene.addAdHoc('adhoc_box_2')

  // 掴む場所の宣言 = 実際に起きる doc-edit の 1 つ (ADR-128)。
  const doc  = svc.getDoc()
  const next = structuredClone(doc)
  next.specification.layout.entities.find(e => e.ref === 'pick_table').graspFeature =
    { kind: 'faces', faces: [{ face: '+z' }] }
  await svc.applyContextDoc(next, viewContext, { regenerate: true })

  assert.ok(scene.objects.has('adhoc_box_1'), '未宣言の実体が再生成で消えた (ADR-131)')
  assert.ok(scene.objects.has('adhoc_box_2'), '未宣言の実体が再生成で消えた (ADR-131)')
  for (const id of projected) {
    assert.ok(scene.objects.has(id), `投影された実体 ${id} が戻ってきていない`)
  }
})

test('投影された実体は差し替えられる — 保存の規則が投影まで守ってしまわない', async () => {
  // 逆向き: 未宣言を保存する規則が広がりすぎると、消えた実体が古いまま残り続ける。
  // 「保存された個数」ではなく「投影の外側だけが保存されたこと」を問う。
  const scene = fakeScene()
  const svc   = new ContextService(scene)
  await svc.loadContext(load('cell_robotics_context.json'), viewContext)
  scene.addAdHoc('adhoc_box')

  const doc  = svc.getDoc()
  const next = structuredClone(doc)
  const removed = next.specification.layout.entities.pop()   // 実体を 1 つ文書から消す
  await svc.applyContextDoc(next, viewContext, { regenerate: true })

  const survivors = [...scene.objects.keys()]
  assert.ok(survivors.includes('adhoc_box'), '未宣言は残る')
  assert.ok(!survivors.some(id => id.includes(removed.ref)),
    `文書から消した実体 (${removed.ref}) がシーンに残っている — 保存の規則が投影まで覆っている`)
})

test('文書の読み込みは投影の差し替えではなく入れ替え — 未宣言も消える', async () => {
  // loadContext は「別の文書を採る」ので、前の文書の周りに生えたものも一緒に去る。
  // これは消えてよい 0 であって、宣言しておく (推論させない — 原則 #31)。
  const scene = fakeScene()
  const svc   = new ContextService(scene)
  await svc.loadContext(load('cell_robotics_context.json'), viewContext)
  scene.addAdHoc('adhoc_box')

  await svc.loadContext(load('cell_region_context.json'), viewContext)
  assert.ok(!scene.objects.has('adhoc_box'),
    'loadContext は全消しである — ここで保存すると、別プロジェクトの残骸が新しい文書に混ざる')
})

test('再生成の入口は 1 つ — importFromJson の直接呼びが ContextService に無い', () => {
  // 保存の規則を持つ経路と持たない経路が並ぶと、欠陥は**持たない経路**に住む
  // (ADR-097 が pose で見つけた形)。呼びを 1 本に畳んだことを個数で問う。
  const src = stripCommentsFlat(readFileSync(repoPath('src/service/ContextService.js'), 'utf8'))
  const direct = [...src.matchAll(/this\._scene\.importFromJson\s*\(/g)].length
  assert.equal(direct, 1,
    '\n`ContextService` から `importFromJson` を直接呼ぶ箇所が 1 つでない。\n' +
    '  再生成は `_projectScene` ただ 1 つを通ること (原則 #1) — 直接呼びは\n' +
    '  preserve を渡し忘れる経路になり、忘れた側が黙って実体を消す。\n')
})

test('シーンの実体を列挙するアクセサ名が実物と合っている', () => {
  // `_sceneObjectIds` が空を返すと「未宣言 0 個」に退化し、全消しへ黙って戻る。
  // 読まない欄は無い欄と区別がつかないので、結合そのものを問う (原則 #31)。
  const svcSrc = stripCommentsFlat(readFileSync(repoPath('src/service/SceneService.js'), 'utf8'))
  assert.match(svcSrc, /get scene\(\)\s*\{\s*return this\._model\s*\}/,
    'SceneService.scene (集約アクセサ) が無い — ContextService._sceneObjectIds が空振りする')
  assert.match(svcSrc, /_clearScene\(preserve = null\)/,
    'SceneService._clearScene が preserve を受けない — 部分的な取り壊しができない')
})
