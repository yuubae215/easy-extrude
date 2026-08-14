/**
 * DeclaredPoseOwnership — 宣言された姿勢の**寿命**と、それを書く入口の個数 (ADR-129 D1/D5)。
 *
 * ## 値ではなく往復で問う (D5-1)
 *
 * 主張は「宣言は対象と同じ寿命を持つ」であって「値が一致する」ではない。値を比べる
 * 検査は *たまたま今のセッションで一致する* を緑にするので、この主張については何も
 * 言えない。だから問うのは **fixpoint** — 宣言する → 文書を書き出す → 新しい
 * セッションで読み直す → **同じ探索リクエストの入力が出る** (原則 #28)。
 *
 * ## 負の対照 (D5-2)
 *
 * 実体を消すと宣言も消える。宣言だけが取り残されないことを、*消えたこと*ではなく
 * **音**で問う — 宙に浮いた `ref` は書き込みが**黙って何もしない** (no-op clone) の
 * ではなく、そもそも書かれない。
 *
 * ## 入口の個数 (D5-3)
 *
 * `ref` を持つ実体の姿勢を書く入口はちょうど 1 つ。`MoveCommand` /
 * `FrameRotateCommand` は消えない (アドホック実体には要る) ので、数えるのは
 * 「消えたこと」ではなく**用途で分かれたこと**である。
 *
 * @see docs/adr/ADR-129-a-declaration-outlives-the-instance-it-was-written-on.md
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setEntityPose } from './context/DocBuilder.js'
import { declaredPoseOf, DECLARED_POSE_KINDS, POSE_ENTITY_KIND } from './domain/declaredPose.js'
import { compileContext } from './context/ContextCompiler.js'
import { compileLayout } from './layout/LayoutCompiler.js'
import { stripCommentsFlat, repoPath } from './census/sources.js'
import { assertDeclarationsExist } from './census/partition.js'

const here = dirname(fileURLToPath(import.meta.url))
const doc = () => JSON.parse(readFileSync(join(here, '../examples/cell_robotics_context.json'), 'utf8'))

/** その ref の Solid がコンパイル後にどこに居るか (探索リクエストが読む値そのもの)。 */
const compiledPositionOf = (d, ref) => {
  const compiled = compileContext(d)
  const id = compiled.layoutDsl.entities.find(e => e.ref === ref) && ref
  assert.ok(id, `${ref} が layout DSL に居ない`)
  const scene = compileLayout(compiled.layoutDsl)
  const obj = scene.objects.find(o => (o.name ?? '').length >= 0 && o.id.includes(ref))
  assert.ok(obj, `${ref} がコンパイル済みシーンに居ない`)
  return obj.position
}

// ── D5-1 往復 (fixpoint) ─────────────────────────────────────────────────────

test('宣言した配置は、書き出して読み直しても同じ探索入力を出す', () => {
  const before = doc()
  const moved  = setEntityPose(before, 'pick_table', { position: { x: 1020.88, y: -7.5, z: 175 } })

  // 書き出し = 文字列化。読み直し = 解析。往復のあいだに実行時インスタンスは 1 つも
  // 生きていない — それがこの検査の要点で、値が生き延びる場所が文書だけであることを言う。
  const roundTripped = JSON.parse(JSON.stringify(moved))

  assert.deepEqual(
    compiledPositionOf(roundTripped, 'pick_table'),
    compiledPositionOf(moved, 'pick_table'),
    '書き出し → 読み直しで探索入力が変わった — 宣言が文書に着いていない',
  )
  assert.deepEqual(compiledPositionOf(roundTripped, 'pick_table'),
    { x: 1020.88, y: -7.5, z: 175 })
  // 負の対照: 書き換える前の文書は古い位置のまま (往復が「何でも通す」ではないこと)。
  assert.deepEqual(compiledPositionOf(before, 'pick_table'), { x: 600, y: 0, z: 175 })
})

test('述べていない欄は書かれない — Grab が向きを恒等で埋めない', () => {
  const before = doc()
  const after  = setEntityPose(before, 'pick_table', { position: { x: 1, y: 2, z: 3 } })
  const entity = after.specification.layout.entities.find(e => e.ref === 'pick_table')
  assert.deepEqual(entity.position, { x: 1, y: 2, z: 3 })
  assert.equal('rotation' in entity, false,
    '向きを述べていないのに rotation が書かれた — 「向けていない」が「ゼロに向けた」に化ける (原則 #31)')
})

test('入力は変異しない — 変換は新しい文書を返す (原則 #6)', () => {
  const before = doc()
  const snapshot = JSON.stringify(before)
  setEntityPose(before, 'pick_table', { position: { x: 9, y: 9, z: 9 } })
  assert.equal(JSON.stringify(before), snapshot)
})

// ── D5-2 負の対照 ────────────────────────────────────────────────────────────

test('文書に居ない ref へは書かれない — 運び手のいない姿勢を捏造しない', () => {
  const before = doc()
  const after  = setEntityPose(before, 'ghost_entity', { position: { x: 1, y: 2, z: 3 } })
  assert.equal(after.specification.layout.entities.length,
    before.specification.layout.entities.length,
    '存在しない ref に対して実体が生えた (原則 #11 — 幾何の捏造)')
})

// ── 種ごとの読み方 (未宣言の種で throw) ──────────────────────────────────────

test('姿勢の読み方は種ごとに宣言され、未宣言の種では throw する', () => {
  assert.deepEqual(DECLARED_POSE_KINDS, ['Solid', 'CoordinateFrame', 'AnnotatedPoint'])
  assert.throws(() => declaredPoseOf('Profile', {}), /未宣言の実体種/)

  // Solid は世界座標の重心、CF は (親を持つなら) 局所オフセット。同じ値を同じ欄に
  // 書くわけではないことを、読み口の違いとして焼く。
  const solid = { _position: { x: 1, y: 2, z: 3 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }
  assert.deepEqual(declaredPoseOf(POSE_ENTITY_KIND.SOLID, solid),
    { position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0, w: 1 } })

  const frame = { translation: { x: 0, y: 0, z: 300 }, rotation: { x: 0, y: 0.7071, z: 0, w: 0.7071 } }
  assert.deepEqual(declaredPoseOf(POSE_ENTITY_KIND.COORDINATE_FRAME, frame).position,
    { x: 0, y: 0, z: 300 })

  // 点は向きを持たない — 欄が無いものは書かない。
  const point = { position: { x: 5, y: 6, z: 7 } }
  assert.equal('rotation' in declaredPoseOf(POSE_ENTITY_KIND.ANNOTATED_POINT, point), false)
})

// ── D5-3 入口の個数 ──────────────────────────────────────────────────────────

/**
 * 宣言された姿勢を書く入口の宣言。**在る経路ではなく、規則を持たない経路**を
 * 数えるための表 (ADR-097 が pose で見つけた形)。
 */
const DECLARED_POSE_WRITERS = [
  { key: 'setEntityPose',        why: '文書側の唯一の writer (DocBuilder)' },
  { key: 'recordConfirmedPoses', why: 'ジェスチャ確定から doc-edit へ渡す唯一の入口 (ContextController)' },
]

test('文書の姿勢欄を書く関数は 1 つだけ', () => {
  const src = stripCommentsFlat(readFileSync(repoPath('src/context/DocBuilder.js'), 'utf8'))
  const writers = [...src.matchAll(/entities\[i\]\.(position|rotation)\s*=/g)].length
  assert.equal(writers, 2, 'position / rotation を書く行が setEntityPose の 2 行だけでない')
})

test('宣言された入口はすべて実在する — 消えた入口が緑を出さない', () => {
  // 逆向き (ADR-102): 名前を変えた・畳んだのに宣言が残っていると、空回りする規則が
  // 「守られている」ように見える。入口の在処ごと問う。
  const sources = {
    setEntityPose:        repoPath('src/context/DocBuilder.js'),
    recordConfirmedPoses: repoPath('src/controller/ContextController.js'),
  }
  assertDeclarationsExist({
    what:         '宣言された姿勢を書く入口',
    declarations: DECLARED_POSE_WRITERS,
    exists:       key => new RegExp(`\\b${key}\\s*\\(`).test(
      stripCommentsFlat(readFileSync(sources[key], 'utf8'))),
    onStale:      '入口を消したなら宣言も消すこと (空回りする規則は緑を出し続ける)',
  })
})

test('ジェスチャ確定は、宣言済み実体に対して CommandStack を使わない', () => {
  // 両方が生きていると同じ姿勢に書き手が 2 つできる (原則 #4)。確定ハンドラが
  // 「宣言済みは除いた集合」に対してだけ MoveCommand を作ることを構文で問う。
  const grab = stripCommentsFlat(readFileSync(
    repoPath('src/controller/handler/GrabOperationHandler.js'), 'utf8'))
  assert.match(grab, /declarablePoseIds/,
    'grab confirm が宣言済み実体を分類していない — 文書とシーンに書き手が 2 つできる')
  assert.match(grab, /createMoveCommand\(label, s\.allStartCorners, undeclared/,
    'MoveCommand が選択全体に対して作られている — 宣言済みぶんが二重に書かれる')

  const rot = stripCommentsFlat(readFileSync(
    repoPath('src/controller/handler/RotationHandler.js'), 'utf8'))
  assert.match(rot, /declarablePoseIds/,
    'rotate confirm が宣言済み実体を分類していない')
})

test('書き込みはジェスチャの後片付けより後に呼ばれる', () => {
  // 書き込みは再インポートを**同期的に**起こす (`_clearScene` は最初の await の前)。
  // 途中で呼ぶと、後片付けが破棄済みの view を触って落ちる — 実測で
  // `Cannot read properties of null (reading 'clearPivotDisplay')` が出た。
  const grab = stripCommentsFlat(readFileSync(
    repoPath('src/controller/handler/GrabOperationHandler.js'), 'utf8'))
  const cleanup = grab.indexOf('clearPivotDisplay')
  const write   = grab.indexOf('recordConfirmedPoses')
  assert.ok(cleanup > 0 && write > cleanup,
    '\n`recordConfirmedPoses` が後片付けより前に呼ばれている。\n' +
    '  書き込みは再インポートを同期的に起こすので、直後の後片付けは破棄済みの\n' +
    '  view を触る (ADR-129 D1 実装時に実測で出た落ち方)。\n')
})
