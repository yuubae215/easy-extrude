/**
 * searchGeometry.test.js — 探索の幾何がどの源から来るかを機械に問わせる (ADR-132)
 *
 * ここが問うのは値ではなく **源** である。ADR-132 以前、ロボットは live scene から、
 * 掴む対象は文書から来ていた。同じリクエストの 2 つの主語が別の源を持つことは、
 * どちらの側を読んでも見えない — 各々は自分の源から正しく解決されており、
 * **食い違いは 2 つを並べたときにしか現れない**。だから検査も並べて書く。
 *
 * 数え方の注意 (原則 #31): 失われた宣言には欄が無い。文書が宣言したのにシーンに
 * 実体が無い ref は、join の出力から**消える**だけで、出てきたものを辿る検査は
 * 定義上それを見ない。だから母集団は join の結果ではなく**文書の宣言**で取る
 * (`declarationJoinCensus`)。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSearchLayout, declarationJoinCensus, sourceLabel, SOURCE } from './searchGeometry.js'

/** 同じ ref を両側が持つ最小構成: シーンは「今どこに在るか」、文書は「どこを掴むか」。 */
const SCENE = {
  version: 'layout/1.0',
  entities: [
    { ref: 'widget', type: 'Solid', name: 'Widget',
      position: { x: 900, y: 0, z: 400 }, dimensions: { x: 60, y: 60, z: 40 } },
    { ref: 'scratch', type: 'Solid', name: 'Shift+A で足した箱',
      position: { x: 0, y: 0, z: 100 }, dimensions: { x: 50, y: 50, z: 50 } },
  ],
}

const FEATURE = { kind: 'faces', faces: [{ face: '+x' }, { face: '-x' }] }

const DOC = {
  version: 'layout/1.0',
  entities: [
    { ref: 'widget', type: 'Solid', name: 'Widget',
      position: { x: 600, y: 0, z: 400 }, dimensions: { x: 60, y: 60, z: 40 },
      graspFeature: FEATURE },
  ],
}

// ── 源の解決 ────────────────────────────────────────────────────────────────

test('シーンが在れば幾何はシーンから来る (文書は古いかもしれない)', () => {
  const r = resolveSearchLayout({ sceneDsl: SCENE, docDsl: DOC })
  assert.equal(r.geometrySource, SOURCE.SCENE)
  assert.equal(r.dsl.entities.find(e => e.ref === 'widget').position.x, 900,
    '文書の 600 ではなくシーンの 900 — 動かしたのに答えが変わらない (ADR-129) の幾何側')
})

test('文書の宣言は ref で join されて生き延びる (ADR-119 D3 の嘘を作らない)', () => {
  const r = resolveSearchLayout({ sceneDsl: SCENE, docDsl: DOC })
  assert.deepEqual(r.dsl.entities.find(e => e.ref === 'widget').graspFeature, FEATURE)
  assert.equal(r.declarationSource, SOURCE.DOCUMENT)
})

test('シーンにしか居ない実体は宣言を持たない — それは欠落ではなく状態 (ADR-129 D1)', () => {
  const r = resolveSearchLayout({ sceneDsl: SCENE, docDsl: DOC })
  const scratch = r.dsl.entities.find(e => e.ref === 'scratch')
  assert.equal(scratch.graspFeature, undefined,
    '未宣言の物に宣言を捏造しない。「この物は宣言されていない」と出せることが要件')
})

test('文書が無いときの declarationSource は none — 「誰も言っていない」は答えである', () => {
  const r = resolveSearchLayout({ sceneDsl: SCENE, docDsl: null })
  assert.equal(r.geometrySource, SOURCE.SCENE)
  assert.equal(r.declarationSource, SOURCE.NONE)
  assert.ok(r.dsl.entities.length > 0, 'シーンだけで探索できる — これが quick-start を不要にした条件')
})

test('シーンが無いときは文書へ倒れる — ただし黙ってではなく source を名乗って', () => {
  const r = resolveSearchLayout({ sceneDsl: null, docDsl: DOC })
  assert.equal(r.geometrySource, SOURCE.DOCUMENT)
  assert.equal(r.declarationSource, SOURCE.DOCUMENT)
  assert.equal(r.dsl, DOC)
})

test('どちらの源も無ければ dsl は null — 呼び手は理由を出して止まる', () => {
  const r = resolveSearchLayout({})
  assert.equal(r.dsl, null)
  assert.equal(r.geometrySource, SOURCE.NONE)
  assert.equal(r.declarationSource, SOURCE.NONE)
})

test('空の layout は小さな layout ではない — 実体 0 個は「探すものが無い」', () => {
  const r = resolveSearchLayout({ sceneDsl: { version: 'layout/1.0', entities: [] }, docDsl: null })
  assert.equal(r.dsl, null)
})

// ── 入力を変異させない (§1.1 / 原則 #6) ──────────────────────────────────────

test('join は入力を書き換えない — シーンの投影が第二の源にならない', () => {
  const sceneCopy = JSON.parse(JSON.stringify(SCENE))
  resolveSearchLayout({ sceneDsl: sceneCopy, docDsl: DOC })
  assert.deepEqual(sceneCopy, SCENE, '入力 DSL は不変でなければならない')
})

// ── 数えるのは「出てきたもの」ではなく「出てこなかったもの」(原則 #31) ─────────

test('シーンに実体が無い宣言は孤児として数えられる — 出力を辿っても見えない', () => {
  const docWithGhost = {
    version: 'layout/1.0',
    entities: [
      ...DOC.entities,
      { ref: 'deleted_pallet', type: 'Solid', name: '消されたパレット',
        position: { x: 0, y: 0, z: 0 }, dimensions: { x: 10, y: 10, z: 10 },
        graspFeature: FEATURE },
    ],
  }
  const census = declarationJoinCensus(SCENE, docWithGhost)
  assert.equal(census.joined, 1)
  assert.deepEqual(census.orphaned, ['deleted_pallet'],
    '母集団は文書の宣言。join の結果を数えると、失われた宣言は永久に 0 件に見える')

  // 逆向き — 全部 join できたときに孤児が 0 であること (検査が空回りしていない)
  const ok = declarationJoinCensus(SCENE, DOC)
  assert.equal(ok.joined, 1)
  assert.deepEqual(ok.orphaned, [])
})

// ── 画面へ出す語 (原則 #31 — 未宣言の種で throw する表) ─────────────────────

test('源の種はすべて画面の語を持ち、未宣言の種では throw する', () => {
  // 母集団は SOURCE の全メンバー — *在るラベル*を辿るのではなく、
  // 覆うべき種を列挙して個数を検査する。
  for (const source of Object.values(SOURCE)) {
    assert.equal(typeof sourceLabel(source), 'string', `${source} に画面の語が無い`)
  }
  assert.throws(() => sourceLabel('embedding'), /未宣言の源/,
    '既定へ倒すと「文書を読んでいない」と「文書が何も言っていない」が同じ表示になる')
})

test('宣言を持たない文書実体は join の母集団に入らない (「宣言しなかった」は孤児ではない)', () => {
  const docNoFeature = { version: 'layout/1.0', entities: [{ ref: 'nowhere', type: 'Solid' }] }
  const census = declarationJoinCensus(SCENE, docNoFeature)
  assert.equal(census.joined, 0)
  assert.deepEqual(census.orphaned, [])
})
