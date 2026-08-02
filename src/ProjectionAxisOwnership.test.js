/**
 * ProjectionAxisOwnership.test.js — 「視点はモードではない」を機械に問わせる
 * (ADR-103 / 原則 #4 / 原則 #31)
 *
 * ## この検査が答える問い
 *
 * 台帳 §既知の負債 1 は「モードの権威が二つある」だった: `SceneModel._selectionMode`
 * (2 値) と `MapModeController.state.active` (boolean) の直積で、`edit ∧
 * mapMode.active` が**型として表現可能**だった。ADR-103 はこれを畳んで禁止するの
 * ではなく、Map をモードから**降ろして**閉じた — カメラの向きはギズモ、投影は
 * ビュー設定、描画はツール、実体は通常オブジェクト。
 *
 * 消した状態は、消したことを誰も問わなければ戻ってくる。実際この repo には先例が
 * ある: `DS_PENDING` は ADR-073 で廃止されたのに 3 リリース分 enum に残り続けた
 * (台帳 §既知の負債 3)。**退役した状態が enum に残る**のは「見逃す」のではなく
 * 「緑を出す」形の腐敗で、落ちないので誰も気づかない。
 *
 * ## 二つの問い
 *
 * 1. **退役した形が 0 個か** (`RETIRED_MODE_SHAPES`) — `mapMode.active` /
 *    `useOrthoCamera` / `showMapToolbar` などが `src/**` のどこにも無いこと。
 *    「Map モードを復活させる」最小抵抗経路を塞ぐ。
 * 2. **投影を書く入口が 1 つか** (`PROJECTION_WRITE_RULES`) — 投影軸に触れるのは
 *    `SceneView` だけ。呼び出し側が `_projection` を直接書いたり、ortho カメラを
 *    自前で作ったりすれば、その瞬間に第二の権威が生まれる (原則 #4 / §1.1)。
 *
 * どちらも **形を並べて `src/**` 全体を走査する** shape-census で、母集団は走査
 * 範囲そのもの。新しいファイルは書いた日から母集団に入る (ADR-102)。
 *
 * ## この検査が構造的に見ないもの (宣言)
 *
 * 「トグルを押したときカメラが実際に切り替わるか」は静的には見えない
 * (controller / view は checkJs の外)。そこは e2e の `viewState()` が
 * **同じ操作を 2 回**通して往復で戻ることを焼く — 1 回だけの証拠は、
 * 1 フレーム古い状態を読む欠陥を隠す (ADR-098 → ADR-101 の先例)。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collectSources, stripComments, relPath, repoPath, readFileSync } from './census/sources.js'

/**
 * 退役した形。`src/**` 全体での出現数が **0** でなければならない
 * (ADR-100 の `RETIRED_SELECTION_COLORS` と同じ形)。
 */
const RETIRED_MODE_SHAPES = [
  { pattern: /\bmapMode\b\s*[.[]/,          was: 'Map モードの状態オブジェクト参照 (mapMode.active ほか)' },
  { pattern: /\b_mapModeCtrl\b/,            was: 'AppController が持っていた Map モード controller' },
  { pattern: /\bMapModeController\b/,       was: 'Map モードの controller クラス' },
  { pattern: /\buseOrthoCamera\s*\(/,       was: 'モード用の ortho カメラ切替 (投影は setProjection へ)' },
  { pattern: /\bsetOrthoZoom\s*\(/,         was: 'ortho 専用ズーム (dolly は OrbitControls が持つ)' },
  { pattern: /\bpanOrthoCamera\s*\(/,       was: 'ortho 専用パン (pan は OrbitControls が持つ)' },
  { pattern: /\b(show|hide)MapToolbar\s*\(/, was: 'Map モード専用の左ツールバー' },
  { pattern: /\bonMapModeClick\b/,          was: 'ヘッダの Map ボタンの入口' },
  { pattern: /\bsetFogSuspended\s*\(/,      was: 'ortho カメラの固定高度に合わせた fog 退避' },
  { pattern: /\bDS_PENDING\b/,              was: 'ADR-073 で廃止された描画状態 (台帳 §既知の負債 3)' },
]

/**
 * 投影軸を書く形と、その唯一の所有者。
 *
 * 所有者の**外**でこの形が現れたら、投影の権威が二つになっている。ADR-103 が閉じた
 * のは「視点のパラメータをモードとしてモデル化したこと」なので、そのパラメータの
 * 書き手が散れば同じ誤分類が別の名前で戻る。
 */
const PROJECTION_WRITE_RULES = [
  {
    name: '投影軸への代入 (_projection)',
    owners: ['src/view/SceneView.js'],
    use: "sceneView.setProjection(PROJECTION.PERSPECTIVE | PROJECTION.ORTHOGRAPHIC)",
    all: [/_projection\s*=[^=]/],
    why: '投影の権威が二つあると「今どちらで描いているか」が場所によって食い違い、'
       + 'ピック (activeCamera) と描画が別のカメラを見る (原則 #4)',
  },
  {
    name: 'ortho カメラの生成',
    owners: ['src/view/SceneView.js'],
    use: "sceneView.activeCamera を読む (ortho は透視カメラからの導出であって別の姿勢源ではない)",
    all: [/new\s+THREE\.OrthographicCamera\s*\(/],
    why: '2 つ目の ortho カメラは 2 つ目の姿勢源であり、透視カメラとの間に'
       + '同期の閉路が生まれる (原則 #24 — 導出値を入力に戻さない)',
  },
]

test('退役した Map モードの形は src/** に 0 個 (ADR-103)', () => {
  const files = collectSources()
  assert.ok(files.length > 50, `src/ の走査に失敗している (${files.length} files)`)

  /** @type {string[]} */
  const found = []
  for (const abs of files) {
    const rel = relPath(abs)
    const lines = stripComments(readFileSync(abs, 'utf8'))
    lines.forEach((line, i) => {
      for (const shape of RETIRED_MODE_SHAPES) {
        if (shape.pattern.test(line)) {
          found.push(`${rel}:${i + 1}  ${shape.was}\n      該当行: ${line.trim()}`)
        }
      }
    })
  }

  assert.deepEqual(found, [],
    '退役した Map モードの形が復活している:\n\n' +
    found.map(v => `  • ${v}`).join('\n\n') +
    '\n\n  Map はモードではなく、向き (ギズモ) / 投影 (setProjection) / ツール ' +
    '(PlaceToolController) / 通常オブジェクト の 4 つに分解されている (ADR-103)。\n')
})

test('投影を書くのは SceneView ただ 1 箇所 (原則 #4 / §1.1)', () => {
  const files = collectSources()

  /** @type {string[]} */
  const violations = []
  for (const rule of PROJECTION_WRITE_RULES) {
    const owners = new Set(rule.owners)
    for (const abs of files) {
      const rel = relPath(abs)
      if (owners.has(rel)) continue
      const lines = stripComments(readFileSync(abs, 'utf8'))
      lines.forEach((line, i) => {
        if (rule.all.every(re => re.test(line))) {
          violations.push(
            `${rel}:${i + 1}\n` +
            `      規則「${rule.name}」が所有者の外で書かれている。\n` +
            `      → ${rule.use}\n` +
            `      なぜ: ${rule.why}\n` +
            `      該当行: ${line.trim()}`)
        }
      })
    }
  }

  assert.deepEqual(violations, [],
    `投影軸の書き手が所有者の外に居る:\n\n` +
    violations.map(v => `  • ${v}`).join('\n\n') + '\n')
})

test('所有者自身が規則を実装している (ガードが空振りしていない)', () => {
  // 対象が 0 個であることは、規則が守られていることと区別がつかない (原則 #31)。
  for (const rule of PROJECTION_WRITE_RULES) {
    const found = rule.owners.some(owner => {
      const lines = stripComments(readFileSync(repoPath(owner), 'utf8'))
      return lines.some(line => rule.all.every(re => re.test(line)))
    })
    assert.ok(found,
      `規則「${rule.name}」が所有モジュール (${rule.owners.join(', ')}) に見つからない — ` +
      'ガードが検査対象を失っている。PROJECTION_WRITE_RULES の match か owners を更新すること。')
  }
})

test('トップレベルモードは 2 値 — 投影とツールは別の軸に居る (ADR-103 の完了条件)', () => {
  // ADR-103 の完了条件そのもの。ここが 3 値に戻るなら、また何かがモードに昇格して
  // いる。JS に enum は無いので、モード語彙の宣言は SceneModel の型注釈である
  // (checkJs が model/ を見ているので、この注釈は散文ではなく検査される宣言)。
  // ゆえにここではコメントを **落とさずに** 読む。
  const src = readFileSync(repoPath('src/model/SceneModel.js'), 'utf8')
  const unions = [...src.matchAll(/\{('(?:object|edit|map)'(?:\s*\|\s*'(?:object|edit|map)')*)\}/g)]
    .map(m => [...new Set(m[1].split('|').map(v => v.trim().replace(/'/g, '')))].sort().join('|'))

  assert.ok(unions.length >= 2,
    `SceneModel からモード語彙を ${unions.length} 個しか読めていない — 検査が空回りしている`)
  assert.deepEqual([...new Set(unions)], ['edit|object'],
    'トップレベルモードが 2 値でなくなっている (または宣言が箇所ごとにズレている)。' +
    '視点・投影・ツールはモードではない (ADR-103)')
})
