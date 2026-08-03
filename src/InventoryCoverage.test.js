/**
 * InventoryCoverage.test.js — 「機能インベントリの 48 行のうち、どこにも属さない行は
 * 何個あるか」を機械に数えさせる (ADR-108 D4 / 原則 #31 / ADR-102)
 *
 * ## なぜドキュメントに census を当てるのか
 *
 * `01-inventory.md` は 48 行ある。ところが `02-grouping-criteria.md` が物差しを
 * 当てたのは 25-37 と 38-48 で、**40 (Geometry DAG / Node Editor) はどちらの
 * 適用結果にも Phase 群にも現れなかった**。表に在るのに誰も触れていない行が
 * あったということは、グルーピングの母集団は 48 ではなく実質 47 だったということ
 * である (ADR-108 §力学 3)。
 *
 * これは `CensusCoverage.test.js` が *列挙表そのもの*について問うたのと同じ形を、
 * **散文の表**に当てたものである。人が「全部見た」と思ったかどうかは母集団の
 * 権威ではない — *在る行*を辿る読み方では、**触れられていない行**は目に入らない。
 *
 * ## 母集団と宣言
 *
 *   - **母集団** = `01-inventory.md` の表の行番号 (構文で導出。行を足せばその日から入る)
 *   - **宣言**   = `02-grouping-criteria.md` §被覆表 の `#` 列 (範囲 `1–6` を展開)
 *
 * 両方向に問う。未分類 0 個 (= 表が古びていない) と、宣言の空回り 0 個
 * (= 消えた機能を指したままの行が無い)。
 *
 * ## この証拠が構造的に見逃すもの (宣言)
 *
 * インベントリは**実装から抽出した時点のスナップショット**である。機能が増えても
 * この検査は落ちない — 増えた機能は inventory に行が無いので母集団に入らない。
 * つまりこの検査が守るのは「表の中の被覆」であって「実装の被覆」ではない。
 * そこを守りたくなった日の答えは検査を緩めることではなく、**インベントリを
 * 導出物として再生成可能にする**ことであり、それ自体が別の設計判断になる
 * (GSN `InventoryCoverageCensusIsPlanned` が反証形として名指ししてある)。
 *
 * @see docs/adr/ADR-108-entrances-are-verbs-not-objects.md
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { repoPath, readFileSync } from './census/sources.js'
import { assertCoversPopulation } from './census/partition.js'

const INVENTORY = 'docs/ia-redesign/01-inventory.md'
const GROUPING  = 'docs/ia-redesign/02-grouping-criteria.md'
const COVERAGE_HEADING = '## 被覆表: 48 行はどこへ行ったか'

const read = rel => readFileSync(repoPath(rel), 'utf8')

/** `01-inventory.md` の機能表の行番号 (母集団)。 */
function inventoryRows() {
  const rows = []
  for (const line of read(INVENTORY).split('\n')) {
    const m = line.match(/^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|/)
    if (m) rows.push({ n: Number(m[1]), label: m[2] })
  }
  return rows
}

/** `1–6` / `25–27, 30` / `11` を展開する。en dash と hyphen の両方を受ける。 */
function expandRange(cell) {
  const out = []
  for (const part of cell.split(',')) {
    const m = part.trim().match(/^(\d+)\s*[–-]\s*(\d+)$/)
    if (m) { for (let i = Number(m[1]); i <= Number(m[2]); i++) out.push(i) }
    else if (/^\d+$/.test(part.trim())) out.push(Number(part.trim()))
    else if (part.trim()) return null   // 数でも範囲でもないセル
  }
  return out
}

/** §被覆表 の行 → `{ numbers, group, resolution }`。 */
function coverageRows() {
  const source = read(GROUPING)
  const start  = source.indexOf(COVERAGE_HEADING)
  assert.notEqual(start, -1,
    `${GROUPING} に「${COVERAGE_HEADING}」が無い。見出しを変えたならこの検査の入口も同じ ` +
    'コミットで変えること — 母集団を読めなくなった検査は緑のまま黙る (ADR-103 §負債 3)。')
  const rows = []
  for (const line of source.slice(start).split('\n')) {
    const cells = line.split('|').map(c => c.trim())
    if (cells.length < 4) continue
    const numbers = expandRange(cells[1])
    if (!numbers || numbers.length === 0) continue
    rows.push({ numbers, group: cells[2], resolution: cells[3] })
  }
  return rows
}

test('the inventory is not empty and the coverage table was found', () => {
  assert.equal(inventoryRows().length, 48,
    'インベントリの行数が 48 でない。増減させたなら §被覆表 も同じコミットで更新すること。')
  assert.ok(coverageRows().length > 0, '§被覆表 の行を 1 つも読めていない (パーサが壊れている)')
})

test('every inventory row belongs to a declared group — unaccounted rows are 0', () => {
  const population = inventoryRows().map(r => String(r.n))
  const declared   = coverageRows().flatMap(r => r.numbers).map(String)

  assertCoversPopulation({
    what:       '機能インベントリの 48 行',
    population,
    declared,
    howDerived: `${INVENTORY} の機能表の行番号 (構文で導出)`,
    onNew:      `${GROUPING} の §被覆表 に行を足すこと。`
              + '「対象外 (住所は変わらない)」も立派な決着なので、空欄にせず宣言する — '
              + '正当な非対象を空欄で通すと、忘れられた行と区別がつかない (原則 #31)。',
  })
})

test('no coverage row points at a feature the inventory no longer has', () => {
  const inventory = new Set(inventoryRows().map(r => r.n))
  const orphans = coverageRows()
    .flatMap(r => r.numbers)
    .filter(n => !inventory.has(n))
  assert.deepEqual(orphans, [],
    `\n§被覆表 が inventory に無い番号を指している: ${orphans.join(', ')}\n` +
    '  逆向きが要るのは、機能が消えたことと表が正しいことが区別できないため。\n')
})

test('no inventory row is claimed by two different groups', () => {
  const seen = new Map()
  const dup  = []
  for (const row of coverageRows()) {
    for (const n of row.numbers) {
      if (seen.has(n)) dup.push(`${n} (${seen.get(n)} / ${row.group})`)
      else seen.set(n, row.group)
    }
  }
  assert.deepEqual(dup, [],
    `\n同じ機能が 2 つのグループに属している: ${dup.join(', ')}\n` +
    '  住所が 2 つあるのは住所が無いのと同じ (§1.1 — 真実の源は一つ)。\n')
})

test('every coverage row carries a resolution, not just a group name', () => {
  const empty = coverageRows()
    .filter(r => !r.resolution || r.resolution.length < 4)
    .map(r => r.numbers.join(','))
  assert.deepEqual(empty, [],
    `\n決着の書かれていない被覆行がある: ${empty.join(' / ')}\n` +
    '  グループ名だけの表は母集団を持たない place-list — ADR-102 が語彙から消した形。\n')
})

test('feature 40 (Node Editor) — the row that no grouping covered — now has an address', () => {
  // ADR-108 §力学 3 の当事者。1 行だけ名指しで焼くのは、この検査が生まれた理由が
  // 「40 が落ちていた」ことだからである (回帰の対象は総数ではなく、この具体例)。
  const row = coverageRows().find(r => r.numbers.includes(40))
  assert.ok(row, '機能 40 が §被覆表 に無い — この検査が生まれた原因そのもの')
  assert.match(row.resolution, /toggle-surface|編集器/,
    '40 の決着が「第二の編集器 = toggle-surface」になっていない。' +
    '表示条件の一致 (BFF 接続時のみ) を住所の根拠に戻してはならない (ADR-108 D4)。')
})
