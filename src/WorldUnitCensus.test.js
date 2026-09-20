/**
 * WorldUnitCensus.test.js — 「単位を名乗っていない尺度依存量」の個数を数える
 * (ADR-138 D4 / 原則 #31)
 *
 * ## この検査が答える問い
 *
 * ADR-136 は world-unit を mm へ寄せ、変換点を**ちょうど 4 箇所**に閉じた。その 4
 * 箇所は正しい。しかし 4 は「ロボティクスがシーン境界を跨ぐ点」の個数であって、
 * **world-unit を単位に持つ定数**の個数ではない。両者は別の種で、前者を辿る数え方
 * では後者は定義上出てこない — 実際、変換が正しく入った状態で
 * `SceneView` の `far = 100` が 100 mm を意味し、カメラが 50 mm の starter cube の
 * 内側 (距離 √61 ≈ 7.81) に入ったまま出荷された。
 *
 * 裸の数値リテラルは型でも命名でも自分の単位を名乗らない = **欄を持たない**。
 * だから *在る定数*を辿る検査は素通りする。数えるのは定数ではなく、
 * **world 空間の sink にリテラルが直接届いている箇所**である。
 *
 * ## 三種 (ADR-137 D1) — 第四の種は存在しない
 *
 *   | 種 | 何に比例するか | 書き方 |
 *   |----|---------------|--------|
 *   | 画面空間 | 画面 px (シーン尺度に不変) | `*_PX` |
 *   | シーン由来 | シーンの bounding radius | radius を引数に取る関数 |
 *   | 宣言された物理長 | 実世界の長さ | `mm(…)` 経由 |
 *
 * ## 限界 (宣言しておく — 推論させない)
 *
 * 個々の定数の母集団は `WORLD_SPACE_SINKS` の**構文**から `src/**` 全体を走査して
 * 導出するので、新しいファイルは書いた日から母集団に入る。しかし **sink の一覧
 * そのものは手書き**であり、新しい種類の world 空間 API (別の view が独自に
 * `near` を書く等) はこの表に登録されるまで見えない — ADR-102 が名指しした
 * `place-list` の形が**一段上に残る**。今日これを導出へ広げないのは、sink の導出が
 * 「world 座標とは何か」を型で持つこと = ADR-137 が却下した Option B そのものだから
 * (核 §5)。**この限界が耐えられなくなった日が Option B へ差し替えるトリガである。**
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { collectSources, relPath, stripComments } from './census/sources.js'

/**
 * **登録簿** — world 空間の量を受け取る呼び出しの形。
 *
 * ここに並ぶのは *定数* ではなく **sink** である。数えるべきは「宣言されていない
 * 定数」で、それは定義上どの定数リストにも載らないので、母集団は受け取る側から
 * 導出するほかない (原則 #31)。
 */
/*
 * **初回実行がこの表自身の誤りを出した** (記録しておく — ADR-102 の 3 例と同じ形)。
 * 最初の版は `.scale.setScalar(…)` を sink に数えており、`AnnotatedRegionView` /
 * `CoordinateFrameView` / `RippleEffect` / `SelectPulse` の 8 箇所を「単位を名乗って
 * いない」と報告した。しかし `.scale` は**比率**であって長さではない — 無次元なので
 * どの単位系でも同じ値であり、単位を名乗る欄を持たないのが正しい。唯一意味を持つ
 * `RobotStage` の `setScalar(MM_PER_METER)` は単位**変換**で、ADR-136 の 4 変換点
 * として既に別の場所で守られている。category error だったのは表のほうなので、
 * 行を消した。母集団を導出させた初回の実行でしか気づけない種類の誤りである。
 */
const WORLD_SPACE_SINKS = [
  { name: 'camera near plane',   pattern: /\.near\s*=\s*([^\n;]+)/g },
  { name: 'camera far plane',    pattern: /\.far\s*=\s*([^\n;]+)/g },
  { name: 'camera position',     pattern: /camera\.position\.set\(([^)]*)\)/g },
  { name: 'ground grid',         pattern: /new THREE\.GridHelper\(([^)]*)\)/g },
  { name: 'scene framing radius', pattern: /fitCameraToSphere\([^,]+,\s*([^)]+)\)/g },
]

/**
 * 三種の**いずれかを名乗っている**と認める形。どれにも当たらない引数が
 * 「第四の種」= 数える対象である。
 */
const DECLARED_KINDS = [
  { kind: 'declared-mm',    pattern: /\bmm\s*\(/ },
  { kind: 'screen-space',   pattern: /_PX\b/ },
  { kind: 'scene-derived',  pattern: /\b(radius|r|dist|sphere|box|seed|seedClip|pose|clip|extent|halfHeight)\b/ },
  { kind: 'named-constant', pattern: /\b[A-Z][A-Z0-9_]{2,}\b/ },
]

/** 引数の中の「自明に単位を持たない」項 (0 は原点・無次元なのでどの単位でも同じ)。 */
const UNITLESS = /^\s*(0|0\.0|-0|null|undefined|true|false)\s*$/

/**
 * 「三種のどれでもない量」の個数。**0 でなければならない** — ADR-137 D1 が第四の
 * 種を禁じ、同 PR で既存の違反をすべて三種へ寄せたので、ここは色 (ADR-100) の
 * ような「宣言外だが今は N ある」予算を持たない。上げるのは意図的な行為である。
 */
const UNDECLARED_BASELINE = 0

/** 実引数をカンマで割る (括弧の入れ子を潰さない粗い分割で足りる)。 */
function splitArgs(argText) {
  const out = []
  let depth = 0, cur = ''
  for (const ch of argText) {
    if (ch === '(' || ch === '[' || ch === '{') depth++
    if (ch === ')' || ch === ']' || ch === '}') depth--
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue }
    cur += ch
  }
  if (cur.trim() !== '') out.push(cur)
  return out
}

/** 引数が三種のいずれかを名乗っているか。 */
function declaresItsKind(arg) {
  if (UNITLESS.test(arg)) return true
  if (!/[0-9]/.test(arg)) return true          // 変数のみ = リテラルが届いていない
  return DECLARED_KINDS.some(k => k.pattern.test(arg))
}

function scanUndeclared() {
  const found = []
  for (const abs of collectSources()) {
    const file = relPath(abs)
    if (file === 'src/domain/worldUnits.js') continue   // 単位の権威そのもの
    const src = stripComments(readFileSync(abs, 'utf8')).join('\n')
    for (const sink of WORLD_SPACE_SINKS) {
      for (const m of src.matchAll(new RegExp(sink.pattern.source, 'g'))) {
        for (const arg of splitArgs(m[1] ?? '')) {
          if (!declaresItsKind(arg)) found.push({ file, sink: sink.name, arg: arg.trim() })
        }
      }
    }
  }
  return found
}

test('world 空間の sink に、単位を名乗らないリテラルが届いていない (ADR-138 D4)', () => {
  const undeclared = scanUndeclared()
  assert.equal(undeclared.length, UNDECLARED_BASELINE,
    `単位を名乗らない尺度依存量が ${undeclared.length} 箇所ある (baseline ${UNDECLARED_BASELINE})。\n` +
    undeclared.map(u => `  ${u.file}  [${u.sink}]  → ${u.arg}`).join('\n') +
    '\n\n三種のいずれかとして宣言すること (ADR-138 D1):\n' +
    '  画面空間 = *_PX / シーン由来 = radius から導出 / 物理長 = mm(…)\n' +
    'retune ではなく種を選ぶ — 数値を今日の尺度に合わせ直すのは、明日別の尺度の\n' +
    'アセットを読んだ日に同じ欠陥へ戻る (ADR-136 がそうなった)。')
})

test('退役した meter-scale 定数が復活していない (ADR-138 Retires)', () => {
  // 退役の腐敗は違反を*見逃す*のではなく**緑を出す** (ADR-103) ので、消したこと
  // 自体を数える。ADR-137 の `Retires:` 欄と同じ 4 番地 — `pnpm test:adr` は ADR が
  // Accepted であることを問い、ここは src/** 側から同じ形の不在を問う。
  // ADR-137 (boot framing) と ADR-138 (三種の語彙) が退役させた形の合併。
  // **この表の上 2 行は ADR-137 のもの**で、うち clip 定数のほうは ADR-137 の時点で
  // 消えておらず (散文で「placeholder」と宣言されたまま残っていた)、この census の
  // main に対する初回実行が見つけた — 人が数え直す方式の取りこぼしが、機械に
  // 変えた初日に 1 件出たことの記録である。
  const RETIRED = [
    { pattern: /0\.1,\s*100/,                     was: 'SceneView のカメラ clip 定数 (near 0.1 / far 100 = 100 mm)' },
    { pattern: /position\.set\(6,\s*-4,\s*3\)/,   was: 'SceneView のカメラ既定 pose (原点から 7.81 mm)' },
    { pattern: /GridHelper\(20,\s*20/,            was: '地面グリッドの裸の基底幅 (20 = メートル時代の 20 m)' },
    { pattern: /SNAP_THRESHOLD\s*=\s*0\.15/,      was: '面押し出しスナップ半径 (0.15 mm = 事実上無効)' },
    { pattern: /SUPPORT_TOLERANCE\s*=\s*0\.001/,  was: '接地判定の許容 (0.001 mm = 1 µm)' },
  ]
  const hits = []
  for (const abs of collectSources()) {
    const src = stripComments(readFileSync(abs, 'utf8')).join('\n')
    for (const { pattern, was } of RETIRED) {
      if (pattern.test(src)) hits.push(`${relPath(abs)}: ${was}`)
    }
  }
  assert.deepEqual(hits, [],
    '退役させた meter-scale 定数が src/** に再出現している:\n' + hits.map(h => `  ${h}`).join('\n'))
})
