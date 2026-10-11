/**
 * MotionInventoryCoverage.test.js — 「演出の採点表から漏れているファイルは何個あるか」を
 * 機械に数えさせる (ADR-166 M1 / 原則 #31 / ADR-102)
 *
 * ## なぜ数えるのか
 *
 * `docs/motion/inventory.md` は演出を採点した表で、ADR-166 の M2〜M4 はこの表の判定
 * (A / B / C) から作り直す順を決める。表が「採点した日に在ったファイル」の写しのままだと、
 * 明日足された演出は判定を持たないまま作り直しの外に落ちる — 古びた表は違反を見逃すのでは
 * なく、**緑を出す**。
 *
 * ## 母集団と宣言
 *
 *   - **母集団** = `src/**` の非テストファイルのうち、モーション基盤 (`theme/motion` /
 *     `MotionMath` / `MotionGovernor`) か reduced-motion の境界 (`prefersReducedMotion` /
 *     `useReducedMotion`) を参照するもの (構文で導出 — 新しい演出は書いた日から入る)
 *   - **宣言**   = 採点表の 1 列目に書かれたファイルパス
 *
 * 両方向に問う: 表に無い母集団 0 個 (表が古びていない) / 母集団に無い表の行 0 個
 * (消えたファイルを指したままの行が無い)。同じファイルが 2 行に現れることも禁じる
 * (判定が 2 つあるのは判定が無いのと同じ)。
 *
 * ## この証拠が構造的に見逃すもの (宣言)
 *
 * 母集団の定義は「基盤を参照する」ことなので、基盤を通らずに CSS の `transition` だけで
 * 動く部品は入らない。それは基盤 (曲線の語彙・reduced motion の境界) の外で動いている
 * ということで、それ自体が M2 で数えるべき別の欠陥である — ここで母集団を CSS まで
 * 広げると、静的なスタイルの大半が入り表が読めなくなる (原則 #20)。
 *
 * @see docs/adr/ADR-166-motion-is-renewed-to-the-current-standard-and-map-annotations-become-light-on-the-floor.md
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collectSources, relPath, repoPath, readFileSync } from './census/sources.js'
import { assertCoversPopulation } from './census/partition.js'

const INVENTORY = 'docs/motion/inventory.md'
const TABLE_HEADING = '## 採点表'
const MOTION_REFERENCE = /theme\/motion|MotionMath|MotionGovernor|prefersReducedMotion|useReducedMotion/

/** 母集団: モーション基盤を参照する非テストファイル (構文で導出)。 */
function motionSources() {
  return collectSources()
    .map(abs => relPath(abs))
    .filter(rel => !/\.test\.jsx?$/.test(rel))
    .filter(rel => MOTION_REFERENCE.test(readFileSync(repoPath(rel), 'utf8')))
    .sort()
}

/** 採点表の行 → その行の 1 列目に書かれたファイルパスの配列。 */
function tableRows() {
  const source = readFileSync(repoPath(INVENTORY), 'utf8')
  const start = source.indexOf(TABLE_HEADING)
  assert.notEqual(start, -1,
    `${INVENTORY} に「${TABLE_HEADING}」が無い。見出しを変えたならこの検査の入口も同じコミットで ` +
    '変えること — 母集団を読めなくなった検査は緑のまま黙る。')
  const body = source.slice(start + TABLE_HEADING.length)
  const end = body.indexOf('\n## ')
  const rows = []
  for (const line of (end === -1 ? body : body.slice(0, end)).split('\n')) {
    if (!line.startsWith('| `src/')) continue
    const firstCell = line.split('|')[1]
    rows.push([...firstCell.matchAll(/`(src\/[^`]+)`/g)].map(m => m[1]))
  }
  return rows
}

test('the motion inventory table is found and not empty', () => {
  assert.ok(tableRows().length > 0, '採点表の行を 1 つも読めていない (パーサが壊れている)')
  assert.ok(motionSources().length > 0, '母集団が 0 — 導出の正規表現が壊れている')
})

test('every motion source is scored in the inventory — unscored files are 0', () => {
  assertCoversPopulation({
    what:       '演出の採点表',
    population: motionSources(),
    declared:   tableRows().flat(),
    howDerived: 'src/** の非テストファイルのうち、モーション基盤か reduced-motion の境界を参照するもの',
    onNew:      `${INVENTORY} の採点表に行を足し、判定 (A / B / C / 対象外) を付けること。`
              + '対象外も理由つきの判定であり、空欄で通さない (原則 #31)。',
  })
})

test('no inventory row points at a file that no longer touches motion', () => {
  const population = new Set(motionSources())
  const stale = tableRows().flat().filter(p => !population.has(p))
  assert.deepEqual(stale, [],
    `\n採点表が母集団に無いファイルを指している: ${stale.join(', ')}\n` +
    '  ファイルが消えたか、基盤を参照しなくなった。行を消すか、判定を書き直すこと。\n')
})

test('no file is scored twice', () => {
  const seen = new Set()
  const dup = []
  for (const p of tableRows().flat()) { if (seen.has(p)) dup.push(p); seen.add(p) }
  assert.deepEqual(dup, [], `\n同じファイルが 2 行で採点されている: ${dup.join(', ')}\n`)
})
