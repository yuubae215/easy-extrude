/**
 * ReadableOutput.test.js — コマンドが当事者に出す報告・俯瞰が「リポジトリを見返さずに読める」形を
 * 指示し続けているか (当事者 2026-11-07: 見返さないと分からない語が突然出る / 見出しの意味が
 * 分かりづらく、項目に何の集合が並ぶのか頭に入らない)。形の正本 = `.claude/READABLE-OUTPUT.md`。
 *
 * 問うこと:
 *   - 正本が並び (要約が先)・「並ぶもの」・語の規律・言い換え表 (2 列) を持つ。
 *   - `.claude/commands/` の**全**コマンドが、正本を参照するか、免除を理由つきで宣言されている
 *     (母集団はディレクトリから取る — 新しいコマンドを足すと、どちらかを決めるまで落ちる。原則 #31)。
 *   - 指摘の様式に記号だけの「Rule violated: <checklist item letter>」が戻っていない。
 *   - /whiteboard の §0〜§6 がちょうど 7 節あり、各見出しの直後に「この節に並ぶもの」がある。
 *     他文書が名前で引く語 (「語彙の充足」「辞書を先に整備する」) も残っている。
 *
 * この証拠が構造的に見逃すもの (宣言): 実際に出された報告が語の規律を守ったか。それは会話の
 * 中の出力で、機械が問えるのはコマンドがそう指示しているところまで。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const COMMANDS = new URL('../.claude/commands/', import.meta.url)
const RULES = readFileSync(new URL('../.claude/READABLE-OUTPUT.md', import.meta.url), 'utf8')
const read = name => readFileSync(new URL(name, COMMANDS), 'utf8')

/** 報告を当事者に出さないコマンド — 理由を宣言する (推論させない)。 */
const EXEMPT = {
  'adr.md': 'adr skill への 7 行の入口。出力の形は ADR 本文の様式 (adr skill) が持つ',
  'scaffold-project.md': 'テンプレから CLAUDE.md を生成する。報告ではなくファイルを書く',
}

test('正本が並び・「並ぶもの」・語の規律・言い換え表を持つ', () => {
  for (const part of ['要約', '読み手が動くべきこと', 'この節に並ぶもの', '初出で言い換える', '番号を主語にしない', 'なぜ困るか']) {
    assert.ok(RULES.includes(part), `正本に「${part}」が無い`)
  }
  const rows = RULES.split('\n').filter(l => /^\| [^-|]/.test(l) && !l.startsWith('| 内部語'))
  assert.ok(rows.length >= 8, `言い換え表が ${rows.length} 行しかない`)
  for (const row of rows) {
    assert.equal(row.split('|').map(c => c.trim()).filter(Boolean).length, 2, `言い換え表の行が 2 列でない: ${row}`)
  }
})

test('全コマンドが正本を参照するか、免除を宣言している', () => {
  const names = readdirSync(COMMANDS).filter(n => n.endsWith('.md'))
  for (const name of Object.keys(EXEMPT)) assert.ok(names.includes(name), `免除表に実在しないコマンド: ${name}`)
  for (const name of names) {
    const refers = read(name).includes('.claude/READABLE-OUTPUT.md')
    if (name in EXEMPT) assert.ok(!refers, `${name} は正本を参照しているので免除表から外す`)
    else assert.ok(refers, `${name} が .claude/READABLE-OUTPUT.md を参照していない (参照するか、EXEMPT に理由を書く)`)
  }
})

test('指摘の様式が記号だけの「Rule violated」に戻っていない', () => {
  for (const name of readdirSync(COMMANDS).filter(n => n.endsWith('.md'))) {
    assert.doesNotMatch(read(name), /Rule violated: <checklist item letter>/, name)
  }
})

test('/whiteboard: §0〜§6 がちょうど 7 節あり、各見出しの直後に「この節に並ぶもの」がある', () => {
  const lines = read('whiteboard.md').split('\n')
  const headings = lines.map((l, i) => [l, i]).filter(([l]) => /^### [0-9]+\. /.test(l))
  assert.deepEqual(headings.map(([l]) => l.match(/^### ([0-9]+)\./)[1]), ['0', '1', '2', '3', '4', '5', '6'])
  for (const [line, i] of headings) {
    const next = lines.slice(i + 1).find(l => l.trim() !== '')
    assert.match(next, /^> この節に並ぶもの: \S/, `見出し「${line}」の直後に中身の宣言が無い`)
  }
  const src = read('whiteboard.md')
  assert.match(src, /^### 0\. .*語彙の充足/m)
  assert.ok(src.includes('辞書を先に整備する'))
  assert.ok(src.includes('決めてほしいこと'))
})
