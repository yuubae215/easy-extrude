/**
 * WhiteboardReadability.test.js — /whiteboard の俯瞰が「リポジトリを見返さずに読める」形を
 * 指示し続けているか (当事者 2026-11-07: 見返さないと分からない語が突然出る / 見出しの意味が
 * 分かりづらく、項目に何の集合が並ぶのか頭に入らない)。
 *
 * 問うこと:
 *   - §0〜§6 の 7 節がちょうど在り、各見出しの直後に「この節に並ぶもの」の 1 行がある
 *     (見出しだけでは何の集合か分からない — 節の中身を先に宣言させる)。
 *   - 「読み手のために書く」節が在り、出力の並び (要約 → 決めてほしいこと → §0〜§6) と
 *     内部語の言い換え表を持つ。
 *   - 他文書が名前で引く語 (「語彙の充足」「辞書を先に整備する」) が見出し・本文に残っている
 *     (PHILOSOPHY / 10-principles / ADR-168 が `/whiteboard §0「語彙の充足」` と引く)。
 *
 * この証拠が構造的に見逃すもの (宣言): 実際に出された俯瞰が語の規律を守ったか。それは会話の
 * 中の出力で、機械が問えるのはコマンドがそう指示しているところまで。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SRC = readFileSync(new URL('../.claude/commands/whiteboard.md', import.meta.url), 'utf8')
const LINES = SRC.split('\n')

test('§0〜§6 がちょうど 7 節あり、各見出しの直後に「この節に並ぶもの」がある', () => {
  const headings = LINES.map((l, i) => [l, i]).filter(([l]) => /^### [0-9]+\. /.test(l))
  assert.deepEqual(headings.map(([l]) => l.match(/^### ([0-9]+)\./)[1]), ['0', '1', '2', '3', '4', '5', '6'])
  for (const [line, i] of headings) {
    const next = LINES.slice(i + 1).find(l => l.trim() !== '')
    assert.match(next, /^> この節に並ぶもの: \S/, `見出し「${line}」の直後に中身の宣言が無い`)
  }
})

test('「読み手のために書く」が出力の並びと内部語の言い換え表を持つ', () => {
  const at = SRC.indexOf('## 読み手のために書く')
  assert.ok(at >= 0, '読み手のために書く 節が無い')
  const section = SRC.slice(at, SRC.indexOf('## 出すもの'))
  for (const part of ['要約', '決めてほしいこと', '初出で言い換える', '番号を主語にしない']) {
    assert.ok(section.includes(part), `「${part}」が無い`)
  }
  const glossaryRows = section.split('\n').filter(l => /^\| [^-|]/.test(l) && !l.startsWith('| 内部語'))
  assert.ok(glossaryRows.length >= 8, `言い換え表が ${glossaryRows.length} 行しかない`)
  for (const row of glossaryRows) {
    const cells = row.split('|').map(c => c.trim()).filter(Boolean)
    assert.equal(cells.length, 2, `言い換え表の行が 2 列でない: ${row}`)
  }
})

test('他文書が名前で引く語が残っている', () => {
  assert.match(SRC, /^### 0\. .*語彙の充足/m)
  assert.ok(SRC.includes('辞書を先に整備する'))
})
