/**
 * FloorContainerCensus.test.js — 「器を動かしたら回避策は書く理由を失ったか」を
 * 個数で問う (ADR-106 / 原則 #26 / 原則 #31 / ADR-102 の母集団規律)
 *
 * ## この検査が答える問い
 *
 * ADR-106 が閉じた欠陥は「右端 `right:0` を 3 者が要求し、**同じ 1 つの衝突に
 * 互いに知らない 3 つの回避策**が当たっていた」ことだった:
 *
 *   1. **ずらす** — `NPanel.jsx` の `right: inspectorOpen ? '280px' : '0'`
 *   2. **消す**   — `ContextController` の `setNPanelVisible(false)` × 3 /
 *                   `setForceHidden(true/false)` × 4
 *   3. **被せる** — `ContextLayer` の `zIndex:100` がギズモと投影トグルを隠す
 *
 * 3 つは独立に書かれ互いを知らないので、**1 つずつ直すと残り 2 つが生き残り、
 * しかも「直した」という緑が出る**。したがって数えるのは「直したか」ではなく
 * **回避策が書く理由を失ったか** — 住所を変えた結果として 0 個になったか、である。
 *
 * ## 5 つの問い (ADR-106 §Consequences「数える形」)
 *
 * 1. 右端 (`right:0`) を占有する常設 fixed 要素が **1 個** (N パネル)
 * 2. 場の開閉に反応して他パネルの可視性を書く入口が **0 個**
 * 3. `_updateGizmoOffset()` の項が **2 個** (16 + 200)、280 の項が **0 個**
 * 4. 退役した形 (タブ 5 値 / `inspectorOpen` / `context.loaded`) が **0 個**、
 *    かつ退役したタブは**行き先を持っている** (消えたのではなく着いた — 原則 #16)
 * 5. 下端の占有オフセットを計算する箇所が **1 個** (原則 #26 を右端で再演しない)
 *
 * ## 母集団はすべてコードから導出する (ADR-102)
 *
 * 「右端に居る要素」を手で並べた表は `place-list` であり、4 つ目の住人が生まれた
 * 日に黙って古びる。したがって母集団は**構文**から取る — `position:'fixed'` を持つ
 * スタイルオブジェクトを波括弧の釣り合いで切り出し、`right`/`bottom` の
 * アンカーで分類する。排他の母集団も同じで、`ContextController` の場の入口 3 本と
 * 退出経路の**呼び出し閉包**から導く: 4 つ目の入口が生まれても閉包に入る。
 *
 * ## この検査が構造的に見ないもの (宣言)
 *
 * 「場を開いた状態でギズモが実際に見えるか」は静的には見えない (z-index と
 * レイアウトの相互作用)。そこは e2e が焼く — 静的な側が問えるのは「場が右端を
 * 占有しない形になっているか」までであり、その境界は宣言であって推論ではない。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  collectSources, relPath, stripCommentsFlat, repoPath, readFileSync,
  methodsOf, callClosure,
} from './census/sources.js'
import { assertCoversPopulation, assertDeclarationsExist } from './census/partition.js'
import { FLOOR_TAB, FLOOR_TABS, RETIRED_FLOOR_TABS, floorTabOrThrow } from './view/FloorTabs.js'

// ── 形の宣言 ────────────────────────────────────────────────────────────────

/**
 * **退役した形**。`src/**` 全体での出現数が **0** でなければならない
 * (ADR-100 の `RETIRED_SELECTION_COLORS` / ADR-103 の `RETIRED_MODE_SHAPES` と同形)。
 *
 * 退役の腐敗は違反を*見逃す*のではなく **緑を出す** — `DS_PENDING` が廃止後も
 * 3 リリース enum に残り、その間ずっとテストは緑だった (ADR-103)。だから
 * 消したこと自体を数える。
 */
const RETIRED_FLOOR_SHAPES = [
  { pattern: /\binspectorOpen\s*\?/,              was: '右端 280px を避ける N パネルのシフト (回避策「ずらす」)' },
  { pattern: /right:\s*['"`]280px['"`]/,          was: '右端 280px スロットへの位置合わせ' },
  { pattern: /\+\s*\(\s*inspectorOpen\s*\?\s*280/, was: '_updateGizmoOffset の 280 項 (出所はチュートリアル Inspector)' },
  { pattern: /\bcontext\.loaded\b/,               was: '文書の有無の写し。権威は ContextService.loaded ただ 1 つ (D4)' },
  { pattern: /\bcontextSetTab\s*\(\s*['"`](?:checks|grasp|assets|wizard|intake)['"`]/,
    was: '退役した場のタブの選択 (行き先は FloorTabs.RETIRED_FLOOR_TABS)' },
  { pattern: /\binspectorTab\s*===\s*['"`](?:checks|grasp|assets|wizard|intake)['"`]/,
    was: '退役した場のタブの描画分岐' },
]

/**
 * 「他パネルの可視性を書いている」と認める形。**場の入口の呼び出し閉包の中**での
 * 出現数が 0 でなければならない。
 *
 * `src/**` 全体で禁じるのではないことに注意 — N パネルのトグル
 * (`UIViewBridge`) も grasp の入口も同じ API を正当に呼ぶ。禁じられているのは
 * **場の開閉がそれを呼ぶこと**であり、そこが「住所の衝突を回避するために
 * 書かれた辺」だった。辺を切るのではなく、辺が引かれた理由を消す。
 */
const EXCLUSION_WRITES = [
  { pattern: /\bsetNPanelVisible\s*\(\s*(?:false|true)\s*\)/, what: 'N パネルの可視性' },
  { pattern: /\bsetForceHidden\s*\(/,                         what: 'LINK NETWORK の強制非表示' },
]

/**
 * 右端 (`right:0`) を占有する常設要素の**宣言**。
 *
 * 母集団は構文から導出する (下の `rightEdgeOccupants()`)。ここに宣言されない
 * 住人が生まれたら落ちる = 右端が再び共有資源の奪い合いになった瞬間である。
 */
const RIGHT_EDGE_RESIDENTS = [
  { key: 'src/components/NPanel/NPanel.jsx',
    why: '選んだものを見る・直す 200px ドック。ADR-106 D2 の後、右端の常設はこれ 1 つ' },
]

/**
 * 下端に張り付くのに占有計算の所有者を引いていないファイルの**対象外宣言**。
 *
 * 理由の無い除外は忘れられた除外と区別がつかない (原則 #31)。逆向きも問うので、
 * 除外先が母集団から消えたらここも落ちる。
 */
const BOTTOM_EDGE_EXEMPT = [
  { key: 'src/components/InfoBar/InfoBar.jsx',
    why: '下端の**基準**そのもの (bottom:0, h:26px)。場が開いても位置も高さも変えない '
       + '(ADR-106 D1 / 原則 #15) ので、占有量を引く側ではなく占有量を構成する側' },
  { key: 'src/view/OutlinerView.js',
    why: 'React の Outliner に置き換わった DOM view で、どこからも new されていない '
       + '(この除外は下のテストが `new OutlinerView` の出現数 0 を確認したうえで成立する)' },
]

// ── 母集団の導出 ────────────────────────────────────────────────────────────

const SOURCES = collectSources().map(abs => ({
  file: relPath(abs),
  body: stripCommentsFlat(readFileSync(abs, 'utf8')),
}))

/**
 * `position:'fixed'` を持つスタイルオブジェクトを、波括弧の釣り合いで切り出す。
 *
 * 行ではなくブロックを単位にするのが要点: `right` と `left` が同じオブジェクトに
 * 在るか (= 全幅なので下端/上端の住人) を判定できないと、下部の場が「右端の住人」
 * として数えられてしまう。
 *
 * @param {string} body
 * @returns {string[]}
 */
function fixedStyleBlocks(body) {
  const out = []
  const re = /position:\s*['"`]fixed['"`]/g
  let m
  while ((m = re.exec(body))) {
    let depth = 0
    let start = 0
    for (let i = m.index; i >= 0; i--) {
      const c = body[i]
      if (c === '}') depth++
      else if (c === '{') { if (depth === 0) { start = i; break } depth-- }
    }
    let end = body.length
    let d2 = 0
    for (let i = start + 1; i < body.length; i++) {
      const c = body[i]
      if (c === '{') d2++
      else if (c === '}') { if (d2 === 0) { end = i; break } d2-- }
    }
    out.push(body.slice(start, end + 1))
  }
  return out
}

const ANCHOR_RIGHT_0 = /\bright:\s*['"`]?0(?:px)?['"`]?\s*,/
const ANCHOR_LEFT_0  = /\bleft:\s*['"`]?0(?:px)?['"`]?\s*,/
const HAS_INSET      = /\binset:/
const HAS_BOTTOM     = /\bbottom:/

/** 右端に**張り付く**要素 (全幅の帯は上端/下端の住人なので除く)。 */
function rightEdgeOccupants() {
  const out = []
  for (const { file, body } of SOURCES) {
    for (const block of fixedStyleBlocks(body)) {
      if (HAS_INSET.test(block)) continue                    // inset:0 = 全面モーダル
      if (!ANCHOR_RIGHT_0.test(block)) continue
      if (ANCHOR_LEFT_0.test(block)) continue                // 左右両端 = 全幅の帯
      if (!out.includes(file)) out.push(file)
    }
  }
  return out
}

/** 下端に張り付く要素を持つファイル (占有計算の所有者を引くべき側)。 */
function bottomEdgeOccupants() {
  const out = []
  for (const { file, body } of SOURCES) {
    const inStyle = fixedStyleBlocks(body).some(b => HAS_BOTTOM.test(b) && !HAS_INSET.test(b))
    const inDom   = /\.style\.bottom\s*=/.test(body)
    if ((inStyle || inDom) && !out.includes(file)) out.push(file)
  }
  return out
}

// ── 問い 1: 右端の住人は 1 個 ───────────────────────────────────────────────

test('右端 (right:0) を占有する常設 fixed 要素が 1 個 (ADR-106 D2)', () => {
  const population = rightEdgeOccupants()

  assertCoversPopulation({
    what:       '右端に張り付く fixed 要素',
    population,
    declared:   RIGHT_EDGE_RESIDENTS.map(r => r.key),
    excluded:   [],
    howDerived: "src/** の position:'fixed' スタイルオブジェクトのうち、"
              + 'right が 0 相当で left が 0 相当でないもの (左右両端 = 全幅の帯は下端/上端の住人)',
    onNew:      '右端に 2 人目が住もうとしている。ADR-106 D2 が閉じたのは「同じ端を 3 者が要求し、'
              + '互いに知らない回避策が 3 つ書かれた」ことなので、住所を分けるか、'
              + '占有計算の所有者に項として参加させること (原則 #26)',
  })

  assert.equal(population.length, 1,
    `右端の常設が ${population.length} 個ある (期待 1 = N パネル):\n${population.map(f => `  ${f}`).join('\n')}`)
})

test('下部の器は右端の住人として数えられない — 全幅の帯である (導出の liveness)', () => {
  // 検出そのものが空回りしていないことを名指しで固定する。場が `left:0; right:0`
  // を持つのは事実なので、全幅を除く規則が壊れると場が「右端の住人」として
  // 現れ、問い 1 が別の理由で落ちる (誤検知は誤緑と同じくらい規則を殺す)。
  const floor = SOURCES.find(s => s.file === 'src/components/Context/ContextLayer.jsx')
  assert.ok(floor, '場のファイルが母集団から消えている')
  const blocks = fixedStyleBlocks(floor.body)
  assert.ok(blocks.some(b => ANCHOR_RIGHT_0.test(b) && ANCHOR_LEFT_0.test(b)),
    '場が left/right 両端に張る全幅の帯ではなくなっている — 器の住所を確認すること')
  assert.ok(!rightEdgeOccupants().includes(floor.file))
})

// ── 問い 2: 排他の入口は 0 個 ───────────────────────────────────────────────

test('場の開閉に反応して他パネルの可視性を書く入口が 0 個 (ADR-106 D2)', () => {
  const src     = readFileSync(repoPath('src/controller/ContextController.js'), 'utf8')
  const methods = methodsOf(src)

  // 母集団は**閉包**であって名前のリストではない。起点すら手で並べない:
  // 「場の入口」とは *場を開閉するストア入口を呼ぶメソッド* のことなので、
  // `contextStart(` / `contextEnd(` の呼び出しから導出する。4 本目の入口
  // (`_startWhatever`) が生まれた日に、誰も表を更新しなくても閉包に入る
  // — 起点を手で書けば、それ自体が ADR-102 の消した place-list になる。
  const entries = [...methods.values()]
    .filter(m => m.body.some(l => /\bcontext(Start|End)\s*\(/.test(l)))
    .map(m => m.name)
  assert.ok(entries.length >= 4,
    `場の入口が ${entries.length} 本しか導出できていない (${entries.join(', ')}) — ` +
    'contextStart / contextEnd の呼び出しから起点を取る導出が壊れている')

  const reachable = new Set()
  for (const entry of entries) {
    for (const name of callClosure(methods, entry)) reachable.add(name)
  }
  assert.ok(reachable.size >= entries.length,
    `閉包が ${reachable.size} 個しか取れていない — 導出が壊れている`)

  const found = []
  for (const name of reachable) {
    const method = methods.get(name)
    if (!method) continue
    method.body.forEach((line, i) => {
      for (const shape of EXCLUSION_WRITES) {
        if (shape.pattern.test(line)) {
          found.push(`ContextController.${name}():${method.start + i + 1}  ${shape.what}\n` +
                     `      該当行: ${line.trim()}`)
        }
      }
    })
  }

  assert.deepEqual(found, [],
    '\n場の入口の閉包の中で、他パネルの可視性が書かれている:\n\n' +
    found.map(v => `  • ${v}`).join('\n\n') +
    '\n\n  母集団の導出: ContextController の場の入口 3 本 + 退出経路の呼び出し閉包。\n' +
    '  ADR-106 D2: 排他は「方針」の顔をしていたが、実際には住所の衝突を回避するために\n' +
    '  書かれた。住所は下端へ移ったので守るべき衝突は無い — 交渉している対象 (N パネル) と\n' +
    '  関係グラフ (LINK NETWORK) は、場が開いているあいだも見えていなければならない。\n')
})

// ── 問い 3: 右端の占有計算の項 ──────────────────────────────────────────────

test('_updateGizmoOffset() の項が 2 個 — 280 の項は 0 個 (ADR-106 D2)', () => {
  const lines = stripCommentsFlat(
    readFileSync(repoPath('src/controller/AppController.js'), 'utf8')).split('\n')
  const offsetLine = lines.find(l => /const\s+offset\s*=/.test(l))
  assert.ok(offsetLine, '_updateGizmoOffset の占有式が見つからない — 所有者が移動した？')

  // `0` は三項の else 枝 (`nPanelOpen ? 200 : 0`) — 「占有していない」を書いた
  // だけで項ではない。数えるのは占有量を持ち込む係数である。
  const terms = (offsetLine.match(/\b\d+\b/g) ?? []).map(Number).filter(n => n !== 0)
  assert.deepEqual(terms, [16, 200],
    `右端の占有式の項が ${JSON.stringify(terms)} になっている (期待 [16, 200] = 余白 + N パネル)。\n` +
    '  280 が戻っているなら右端 280px スロットが復活している。その項の出所は\n' +
    '  production の場ではなく**チュートリアルの Inspector** で、production の場は\n' +
    '  そもそも占有計算に参加していなかった (だから被せて回避できた) — ADR-106 力学 2。')
})

// ── 問い 4: 退役した形と、その行き先 ────────────────────────────────────────

test('退役した器の形が src/** に 0 個 (ADR-106 D2/D4/D5)', () => {
  const found = []
  for (const abs of collectSources()) {
    const rel = relPath(abs)
    const lines = stripCommentsFlat(readFileSync(abs, 'utf8')).split('\n')
    lines.forEach((line, i) => {
      for (const shape of RETIRED_FLOOR_SHAPES) {
        if (shape.pattern.test(line)) {
          found.push(`${rel}:${i + 1}  ${shape.was}\n      該当行: ${line.trim()}`)
        }
      }
    })
  }
  assert.deepEqual(found, [],
    '退役した器の形が復活している:\n\n' + found.map(v => `  • ${v}`).join('\n\n') +
    '\n\n  退役の腐敗は違反を「見逃す」のではなく「緑を出す」 — DS_PENDING は廃止後も\n' +
    '  3 リリース enum に残り、その間ずっとテストは緑だった (ADR-103)。\n')
})

test('場のタブの値域は有界で、退役した値は throw する (ADR-106 D5)', () => {
  // 値域が宣言として存在すること自体が前提。ADR-106 の GSN はこの反証形
  // (「inspectorTab は文字列でオープンな値域なので宣言が存在しない」) を先に
  // 書いており、実測するとそちらが正しかった — 数えられない形は数える前に直す。
  assert.deepEqual(Object.values(FLOOR_TAB).sort(),
    ['agenda', 'cluster', 'conflicts', 'matrix', 'questions', 'tree', 'why'])

  for (const retired of RETIRED_FLOOR_TABS) {
    assert.throws(() => floorTabOrThrow(retired.id), /未宣言の場のタブ/,
      `退役したタブ "${retired.id}" が値域に戻っている`)
  }
  assert.throws(() => floorTabOrThrow('something-new'), /未宣言の場のタブ/)
})

test('器に残る責務は「解消」と「その記録」の 2 種だけ (ADR-106 D3)', () => {
  const duties = [...new Set(FLOOR_TABS.map(t => t.duty))].sort()
  assert.deepEqual(duties, ['record', 'resolve'],
    '器に 3 種目の責務が入っている。ADR-106 D3 の行き先表で住所を決めること — ' +
    '4 種の同居の理由は歴史であって設計ではなかった')
})

test('退役したタブは消えたのではなく着いている — 行き先が実在する (原則 #16)', () => {
  // 移設の証拠は「消えたこと」ではなく **「着いたこと」**である。行き先を
  // 名指ししない退役は無言の削除であり、機能は到達不能になる (原則 #11)。
  const files = new Set(SOURCES.map(s => s.file))
  assertDeclarationsExist({
    what:         'ADR-106 D3 が名指しした移設先',
    declarations: RETIRED_FLOOR_TABS.map(t => ({ key: t.movedTo, why: `${t.id}: ${t.why}` })),
    exists:       key => files.has(key),
    onStale:      '移設先のファイルが存在しない = 機能が無言で到達不能になっている。'
                + 'FloorTabs.RETIRED_FLOOR_TABS の行き先を実在する住所に直すこと',
  })
})

// ── 問い 5: 下端の所有者は 1 個 ─────────────────────────────────────────────

test('下端の占有オフセットを計算する箇所が 1 個 (原則 #26 / ADR-106 D6)', () => {
  // 計算そのものが 1 箇所であること。呼び出しは何箇所あってもよい —
  // 禁じているのは所有者が複数あることではなく、**同じ端の占有量が複数箇所で
  // 計算される**ことである。
  const owners = SOURCES.filter(s => /export function bottomEdgeOffset\s*\(/.test(s.body))
  assert.deepEqual(owners.map(s => s.file), ['src/view/EdgeOccupancy.js'],
    `下端の占有計算の所有者が ${owners.length} 個ある (期待 1)`)
})

test('下端に張り付く要素はすべて所有者から offset を引いている', () => {
  // ADR-106 の GSN は「Toast の bottom:96px が今その形で書かれているかは実装時に
  // 確認する — 書かれていなければそれ自体がパッチ 1 個目」と予告していた。実測すると
  // パッチは 2 個あった: Toast (desktop と mobile で同じ 96px という literal) と
  // TourCard (原則 #26 をコメントで引用しながら left/bottom を literal で書いていた)。
  const population = bottomEdgeOccupants()
  const bodies = new Map(SOURCES.map(s => [s.file, s.body]))
  const declared = population.filter(f => /\bbottomEdgeOffset\s*\(/.test(bodies.get(f)))

  assertCoversPopulation({
    what:       '下端に張り付く fixed 要素',
    population,
    declared,
    excluded:   BOTTOM_EDGE_EXEMPT,
    howDerived: "src/** の position:'fixed' スタイルオブジェクトのうち bottom を持つもの、"
              + 'および `.style.bottom =` を書く DOM view',
    onNew:      'bottom に literal を書くのは原則 #26 違反 (下端は共有資源)。'
              + 'EdgeOccupancy の bottomEdgeOffset({ isMobile, tier, floorOpen }) を引くこと — '
              + '名乗れる段が無いなら BOTTOM_TIER に段を足す (既定へ落とさない — 原則 #31)',
  })
})

test('OutlinerView の除外が成立している — どこからも new されていない', () => {
  // 除外は宣言だが、その**根拠は導出**する。React の Outliner に置き換わった
  // はずの DOM view が再び mount されたら、除外の理由が消えるのでここが落ちる。
  const mounts = SOURCES.filter(s => /\bnew OutlinerView\s*\(/.test(s.body)).map(s => s.file)
  assert.deepEqual(mounts, [],
    'OutlinerView が再び mount されている — BOTTOM_EDGE_EXEMPT の除外理由が失効した。' +
    '下端の占有量を所有者から引くよう直すこと')
})

// ── 導出そのものの liveness ─────────────────────────────────────────────────

test('走査が空回りしていない (母数の liveness)', () => {
  // 対象が 0 個であることは、規則が守られていることと区別がつかない (原則 #31)。
  assert.ok(SOURCES.length > 50, `src/ の走査に失敗している (${SOURCES.length} files)`)
  const bottom = bottomEdgeOccupants()
  assert.ok(bottom.length >= 6,
    `下端の住人が ${bottom.length} 個しか見つからない — fixed ブロックの切り出しが壊れている`)
  assert.ok(bottom.includes('src/components/InfoBar/InfoBar.jsx'),
    '既知の下端の住人 (InfoBar) を検出できていない')
})
