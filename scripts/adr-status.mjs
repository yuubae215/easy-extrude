/**
 * adr-status.mjs — ADR の Status ヘッダを読む**唯一の文法** (§1.1 真実の源は一つ)
 *
 * ## なぜ切り出したか (2026-08-12 — ADR-123 の実装が出した)
 *
 * `check-deferrals.mjs` は Q2 の満期判定について「指す ADR の Status を
 * check-adr-status.mjs と**同じ文法**で読む (第二のパーサを作らない)」と
 * コメントに書いていた。**しかし実物は書いていなかった。**
 *
 * ```js
 * // check-deferrals.mjs の旧 adrStatuses() — 4 方言のうち 1 つしか読めない
 * const m = /^[-*]?\s*Status\s*[:：]\s*(.*)$/.exec(s)
 * ```
 *
 * ADR のヘッダは 4 方言ある — `- Status: X` / `**Status:** X` / `- **Status**: X` /
 * 表形式 `| **Status** | X |`。旧 `adrStatuses()` は最後の**表形式を読めず**、
 * ADR-027 / ADR-032 などがマップから丸ごと欠落していた。欠落は「Status が不明」では
 * なく **「その ADR は存在しない」** として現れる — Q3 が「ticket ADR-027 が docs/adr に
 * 存在しない」と報告した (実在するのに)。
 *
 * **意図の宣言と、実物が一致していることは別の事実である。** ADR-115 が
 * 「印字は検査ではない」で数えたのと同じ形が、ここでは「コメントはパーサではない」
 * として出た。露見したのは、初めて表形式の ADR を ticket に持つ行 (DEF-017 / DEF-018)
 * を登録簿へ足した日である — それまでは 2 つのパーサの差が誰にも当たらなかった。
 *
 * 以後、Status を読む場所はここだけ。方言を足すならここを広げる (= 1 箇所で済む)。
 *
 * @see docs/adr/ADR-123-a-deferral-is-not-written-in-one-notation.md
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Status 値として認める token。 */
export const TOKEN =
  String.raw`(?:Proposed|Draft|Accepted|Rejected|Deprecated|(?:Partially s|S)uperseded by ADR-\d{3})`

/** 値部分の文法。1 行完結で、TOKEN の後ろは「無し」「(注記)」「— 注記」「, 注記」。 */
export const STATUS_VALUE = new RegExp(String.raw`^(${TOKEN})\s*(?:[（(].*|—.*|,.*)?$`)

/** Status 行の所在検出 (値が壊れていても行そのものは見つけたい)。 */
export const STATUS_ANY = /^\s*(?:\|\s*)?[-*]?\s*\**\s*Status\s*\**\s*(?:[:：]|\|)/

/**
 * 見出しの *装飾* を落として値だけ取り出す (純粋関数)。
 *
 * ヘッダは 4 方言に分かれている — `- Status: X` / `**Status:** X` /
 * `- **Status**: X` / 表形式 `| **Status** | X |` — が、**すべて機械可読**である。
 * ここで縛るのは *読めるかどうか* であって書式の統一ではない: 歴史文書の見出しを
 * 一括改稿するのは churn に対して得るものが無い (§5 過剰モデリング禁止)。
 * 統一が要るなら別の変更として行い、その時この関数を狭めればよい。
 *
 * @param {string} line
 * @returns {string|null} 値部分。Status 行として解釈できなければ null。
 */
export function statusValue(line) {
  const s = line.replaceAll('**', '').trim()
  if (s.startsWith('|')) {
    const cells = s.split('|').map(c => c.trim())        // ['', 'Status', 'Accepted', '']
    if (cells[1] !== 'Status') return null
    return cells[2] ?? null
  }
  const m = /^[-*]?\s*Status\s*[:：]\s*(.*)$/.exec(s)
  return m ? m[1].trim() : null
}

/**
 * `Retires:` 欄の値を取り出す (純粋関数)。Status と**同じ 4 方言**を受ける。
 *
 * この欄は「この ADR が Accepted になったら消えていなければならないもの」を書く
 * (ADR-125)。番地の書き方は登録簿の満期 trigger と**同じ語彙**にする —
 * `PATH:<path>` / `GREP:<path>::<regex>` — ので、repo 内の何かを指す書き方は
 * 統治全体で 1 つになる。
 *
 * @param {string} line
 * @returns {string|null} 値部分。Retires 行として解釈できなければ null。
 */
export function retiresValue(line) {
  const s = line.replaceAll('**', '').trim()
  if (s.startsWith('|')) {
    const cells = s.split('|').map(c => c.trim())
    if (cells[1] !== 'Retires') return null
    return cells[2] ?? null
  }
  const m = /^[-*]?\s*Retires\s*[:：]\s*(.*)$/.exec(s)
  return m ? m[1].trim() : null
}

/**
 * ADR ディレクトリ全体を読み、`'ADR-108' → Status 値` の対応を作る。
 *
 * 各ファイルで**最初に**解釈できた Status 行を採る (本文が Status について*述べる*
 * 行に後から乗っ取られないため)。
 *
 * @param {string} adrDir
 * @returns {Map<string, string>}
 */
export function adrStatuses(adrDir) {
  const map = new Map()
  for (const file of readdirSync(adrDir).filter(f => /^ADR-\d{3}.*\.md$/.test(f))) {
    for (const line of readFileSync(join(adrDir, file), 'utf8').split('\n')) {
      const v = statusValue(line)
      if (v === null || v === '') continue
      map.set(file.slice(0, 7), v)
      break
    }
  }
  return map
}
