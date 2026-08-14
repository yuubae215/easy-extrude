/**
 * expiry-trigger.mjs — 満期 trigger の**唯一の文法と評価器** (§1.1)
 *
 * ## なぜ切り出したか (2026-08-12 — ADR-126)
 *
 * 満期 trigger は 2026-08-12 に `check-deferrals.mjs` の中で生まれた (ADR-123 D5 + 4 形目)。
 * 同じ日、GSN の未支持ゴールにも満期が要ると分かった (ADR-126) — そこで**同じ文法を
 * もう一度書きそうになった**。それは ADR-123 §実装で分かったこと 2 で見つけたばかりの
 * 欠陥 (「同じ文法で読む」とコメントに書いて実物は写しだった) の再生産である。
 *
 * **満期の意味も 1 か所に置く:** trigger が発火する = **検査が落ちる** であって
 * 「片付く」ではない (ADR-124 §力学 3)。「片付いたかを問うべき時が来た」を機械が言う。
 *
 * ## 4 形
 *
 * | 形 | 満期の意味 |
 * |---|---|
 * | `満期=ADR-NNN`              | その ADR が `Accepted` になったとき |
 * | `満期=PATH:<path>`          | そのパスが**存在するようになった**とき |
 * | `満期=GREP:<path>::<regex>` | そのファイルにパターンが**現れた**とき |
 * | `満期=GONE:<path>::<regex>` | そのファイルからパターンが**消えた**とき |
 *
 * 正規表現に**リテラル空白と `|` を書けない** — 登録簿は Markdown の表なので `|` は
 * セル区切りとして食われ、空白は token の終わりとして食われる。`\s` と `[^x]` は
 * 使えるので実用上は足りる (`DECLARED_GAPS\s*=\s*\[\]` は書ける)。
 *
 * @see docs/adr/ADR-123-a-deferral-is-not-written-in-one-notation.md (D5 — 3 形)
 * @see docs/adr/ADR-126-... (GSN の未支持ゴールへ満期を持たせる)
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export const EXPIRY_ADR = /満期=(ADR-\d{3})/
export const EXPIRY_PATH = /満期=PATH:([^\s|`]+)/
export const EXPIRY_GREP = /満期=GREP:([^\s:|`]+)::([^\s|`]+)/
export const EXPIRY_GONE = /満期=GONE:([^\s:|`]+)::([^\s|`]+)/

/** @returns {boolean} 機械が読める満期 trigger を 1 つでも持つか。 */
export function hasExpiryTrigger(text) {
  const s = text ?? ''
  return EXPIRY_ADR.test(s) || EXPIRY_PATH.test(s) ||
         EXPIRY_GREP.test(s) || EXPIRY_GONE.test(s)
}

/**
 * trigger を評価する (純粋計算 + ファイル読みだけ。判定文は呼び手が書く)。
 *
 * @param {string} text  満期欄 / assumption の summary など、trigger を含みうる文字列
 * @param {{root: string, statuses: Map<string, string>}} env
 * @returns {{kind: string, what: string, fired: boolean, broken: string|null}[]}
 *   `fired` = 満期が来た。`broken` = trigger 自体が壊れている理由 (指す先が無い等)。
 */
export function evaluateTriggers(text, { root, statuses }) {
  const s = text ?? ''
  const out = []

  const adr = EXPIRY_ADR.exec(s)
  if (adr) {
    const status = statuses?.get(adr[1])
    out.push({
      kind: 'ADR',
      what: adr[1],
      fired: status !== undefined && /^Accepted\b/.test(status),
      broken: status === undefined ? `${adr[1]} が docs/adr に無い` : null,
    })
  }

  const p = EXPIRY_PATH.exec(s)
  if (p) {
    // 不在が残しの証拠なので、**現れたら**満期 (Q4 の逆向き)。壊れようが無い。
    out.push({ kind: 'PATH', what: p[1], fired: existsSync(join(root, p[1])), broken: null })
  }

  for (const [re, kind] of [[EXPIRY_GREP, 'GREP'], [EXPIRY_GONE, 'GONE']]) {
    const m = re.exec(s)
    if (!m) continue
    const abs = join(root, m[1])
    const what = `${m[1]}::${m[2]}`
    if (!existsSync(abs)) {
      // ファイルごと消えている場合は満期ではなく **trigger が壊れている**。
      // 黙って通さない (辿れない参照は空欄より悪い)。
      out.push({ kind, what, fired: false, broken: `${m[1]} が存在しない` })
      continue
    }
    const found = new RegExp(m[2]).test(readFileSync(abs, 'utf8'))
    out.push({ kind, what, fired: kind === 'GREP' ? found : !found, broken: null })
  }

  return out
}

/** 失敗メッセージで使う 4 形の案内 (文面も 1 か所)。 */
export const TRIGGER_HELP =
  '      · `満期=ADR-NNN`              その ADR が Accepted になったとき\n' +
  '      · `満期=PATH:<path>`          そのパスが存在するようになったとき\n' +
  '      · `満期=GREP:<path>::<regex>` そのファイルにパターンが現れたとき\n' +
  '      · `満期=GONE:<path>::<regex>` そのファイルからパターンが消えたとき\n'
