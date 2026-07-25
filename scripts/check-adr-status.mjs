#!/usr/bin/env node
/**
 * check-adr-status.mjs — ADR ヘッダの機械可読性ガード
 *
 * なぜ必要か: ADR は 91 本あるが `Status:` 行が自由記述・複数行に折り返されており、
 * **パースできない**。パースできないヘッダの上には、鮮度チェックも
 * supersede グラフの検証も `/adr-validate` も載せられない — 統治の前提条件が
 * 欠けている状態だった。ここで文法を固定し、以後は機械が守る。
 *
 * 文法 (Status は 1 行で完結する):
 *
 *     - Status: <TOKEN>[ (注記)] | [— 注記]
 *
 *   TOKEN ∈ Proposed | Draft | Accepted | Rejected | Deprecated
 *         | Superseded by ADR-NNN | Partially superseded by ADR-NNN
 *
 * 追加の検査:
 *   - Superseded by ADR-NNN の参照先が実在すること。
 *   - **ADR-091 以降**は、状態・基数の語彙を持つ ADR が `STATE_LEDGER.md` を
 *     参照していること (既存 90 本は遡及適用しない — 遡及は大量修正になり、
 *     ガードの導入自体が止まるため。前向きにだけ効かせる)。
 *
 * 使い方: pnpm test:adr   (CI の gate ジョブからも実行)
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ADR_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'adr')

const TOKEN = String.raw`(?:Proposed|Draft|Accepted|Rejected|Deprecated|(?:Partially s|S)uperseded by ADR-\d{3})`
/**
 * 値部分の文法。1 行完結で、TOKEN の後ろは「無し」「(注記)」「— 注記」「, 注記」。
 */
const STATUS_VALUE = new RegExp(String.raw`^(${TOKEN})\s*(?:[（(].*|—.*|,.*)?$`)

/** Status 行の所在検出 (値が壊れていても行そのものは見つけたい)。 */
const STATUS_ANY = /^\s*(?:\|\s*)?[-*]?\s*\**\s*Status\s*\**\s*(?:[:：]|\|)/

/**
 * 見出しの *装飾* を落として値だけ取り出す (純粋関数)。
 *
 * 91 本のヘッダは 4 方言に分かれている — `- Status: X` / `**Status:** X` /
 * `- **Status**: X` / 表形式 `| **Status** | X |` — が、**すべて機械可読**である。
 * ここで縛るのは *読めるかどうか* であって書式の統一ではない: 歴史文書 59 本の
 * 見出しを一括改稿するのは churn に対して得るものが無い (§5 過剰モデリング禁止)。
 * 統一が要るなら別の変更として行い、その時この関数を狭めればよい。
 *
 * @param {string} line
 * @returns {string|null} 値部分。Status 行として解釈できなければ null。
 */
function statusValue(line) {
  const s = line.replaceAll('**', '').trim()
  if (s.startsWith('|')) {
    const cells = s.split('|').map(c => c.trim())        // ['', 'Status', 'Accepted', '']
    if (cells[1] !== 'Status') return null
    return cells[2] ?? null
  }
  const m = /^[-*]?\s*Status\s*[:：]\s*(.*)$/.exec(s)
  return m ? m[1].trim() : null
}

/** 状態・基数の語彙 (ADR-091 以降に台帳参照を求める判定用)。 */
const STATE_VOCAB = /状態機械|ステートマシン|\bFSM\b|状態遷移|基数|cardinality|0 台|N 台/

const errors = []
const files = readdirSync(ADR_DIR)
  .filter(f => /^ADR-\d{3}.*\.md$/.test(f))
  .sort()

const known = new Set(files.map(f => f.slice(0, 7)))   // 'ADR-090'

if (files.length === 0) {
  console.error('check-adr-status: docs/adr に ADR-NNN*.md が 1 本も無い — 走査に失敗している')
  process.exit(1)
}

for (const file of files) {
  const id = file.slice(0, 7)
  const num = Number(id.slice(4))
  const text = readFileSync(join(ADR_DIR, file), 'utf8')
  const lines = text.split('\n')

  const idx = lines.findIndex(l => STATUS_ANY.test(l))
  if (idx === -1) {
    errors.push(`${file}: Status 行が無い。'- Status: <TOKEN>' を追加すること。`)
    continue
  }

  const line = lines[idx]
  const value = statusValue(line)
  const m = value === null ? null : STATUS_VALUE.exec(value)
  if (!m) {
    const next = (lines[idx + 1] ?? '').trim()
    const wrapped = next !== '' && !/^[-*|#]/.test(next)
    errors.push(
      `${file}:${idx + 1}: Status の値が文法に合わない${wrapped ? ' (次行へ折り返している疑い)' : ''}。\n` +
      `    実際: ${line.trim()}\n` +
      (wrapped ? `    次行: ${next}\n` : '') +
      `    期待: Status の値 = <Proposed|Draft|Accepted|Rejected|Deprecated|Superseded by ADR-NNN>[ (注記)]  ← 1 行で完結`
    )
    continue
  }

  // 注記が次行へ折り返していないこと。折り返した Status は「1 行読めば状態が分かる」
  // という前提を壊し、行単位で走る後続ツール (grep / 鮮度チェック) を静かに誤らせる。
  const open = (value.match(/[（(]/g) ?? []).length
  const close = (value.match(/[）)]/g) ?? []).length
  if (open !== close) {
    errors.push(
      `${file}:${idx + 1}: Status の注記が次行へ折り返している (括弧が閉じていない)。\n` +
      `    実際: ${line.trim()}\n` +
      `    次行: ${(lines[idx + 1] ?? '').trim()}\n` +
      `    Status は 1 行で完結させること (注記が長いなら本文へ移す)。`
    )
    continue
  }

  const sup = /(?:S|s)uperseded by (ADR-\d{3})/.exec(m[1])
  if (sup && !known.has(sup[1])) {
    errors.push(`${file}:${idx + 1}: Superseded by ${sup[1]} の参照先が docs/adr に存在しない。`)
  }

  if (num >= 91 && STATE_VOCAB.test(text) && !text.includes('STATE_LEDGER')) {
    errors.push(
      `${file}: 状態・基数を扱う ADR なのに docs/STATE_LEDGER.md を参照していない。\n` +
      `    台帳の該当行 (状態集合・基数 0/1/N・権威) を同じ変更で更新し、ADR から名指しすること (核 §1.4)。`
    )
  }
}

if (errors.length) {
  console.error(`\ncheck-adr-status: ${errors.length} 件\n`)
  for (const e of errors) console.error(`  • ${e}\n`)
  process.exit(1)
}

console.log(`check-adr-status: ${files.length} 本すべて OK`)
