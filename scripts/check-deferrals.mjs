#!/usr/bin/env node
/**
 * check-deferrals.mjs — 残し (deferral) の母集団・満期・ticket を数える (ADR-109)
 *
 * ## なぜ必要か
 *
 * 「後でやる」は宣言されるが、**欄を持たない**。`status` や `mode` は値を持つ欄なので
 * 状態として認識されるのに対し、「まだやっていないこと」はそれ自体がノードを持たない。
 * だから *在るもの* を辿る読み方 — ADR を並べる / 段を並べる / コードを読む — は、
 * 定義上どれも残しを素通りする (原則 #31)。
 *
 * 2026-08-04 の棚卸しで実測した 4 つの失敗形 (詳細は ADR-109 §力学):
 *
 *   1. **満期が無言で過ぎる。** `PROVISIONAL_UNTIL = 'ADR-108'` は ADR-108 が
 *      Accepted・実装済みになった 2026-08-03 に満期を迎えたが、人が読む文字列で
 *      あって機械が読む期限ではないため何も落ちなかった (写しは 7 箇所)。
 *   2. **完了しても宣言が残る。** ADR-060 の「未着手」5 項目のうち 3 つは完了、
 *      1 つは ADR-082 が対象ごと吸収して消滅していた。宣言だけが「まだ残っている」と
 *      いう嘘を出し続けていた — 退役の腐敗は違反を*見逃す*のではなく緑を出す (ADR-103)。
 *   3. **段を持たない項目は誰も実装しない。** check-adr-status.mjs は ADR 単位で
 *      この病気を治療済みだが、粒度が ADR なので「ADR の中の 1 項目」は見えない。
 *   4. **宣言が散文にしか無い残しがある。** コメントに「別の変更として起票する」と
 *      書いてあっても、起票されたかどうかを問う場所が無い。
 *
 * ## 4 つの問い
 *
 *   Q1 RATCHET   — 登録簿に覆われていない残しの箇所数。**超えても下回っても** fail。
 *                  下回りも落とすのは、債務を払ったのに baseline が古いままだと
 *                  「今いくつ残っているか」が再び記憶の中の数になるから (ADR-103)。
 *   Q2 EXPIRY    — 満期の過ぎた `PROVISIONAL_UNTIL` が 0 件。満期が指す ADR の Status を
 *                  check-adr-status.mjs と**同じ文法**で読む (第二のパーサを作らない)。
 *   Q3 TICKET    — 登録簿の全行が実在する ticket (ADR 番号 or 段) を持つ。空欄も、
 *                  実在しない参照も落とす (在るように見えて辿れないほうが空欄より悪い)。
 *   Q4 REVERSE   — 登録簿の行が指す所在に残しが実在する。実装済みの残しの宣言は消す。
 *
 * ## 母集団の作り方 (ここが要点)
 *
 * **登録簿を分母にしない。** 分母は残しの*語彙*から導出する — 登録簿を母集団にすると、
 * それ自身が母集団を持たない表 (ADR-102 が語彙から消した `place-list`) になり、
 * 「登録簿に書き忘れた残し」が原理的に出てこなくなる。数えるべきは在る行ではなく
 * **表が覆えていない箇所**である。
 *
 * ## 限界 (宣言する — 推論させない)
 *
 * 語彙による導出は**日本語の慣用に依存する**。英語で `TODO` と書けば別の語彙で、
 * `// later` と書けばどの語彙にも入らない。この検査は「**宣言する気のある残し**」に
 * 対しては完全だが、黙って残す残しは捕まえられない。ADR-109 §Consequences に同文。
 *
 * 使い方: pnpm test:deferrals   (CI の gate ジョブからも実行)
 *
 * @see docs/adr/ADR-109-a-deferral-is-a-declaration-not-a-memory.md
 * @see docs/DEFERRAL_LEDGER.md
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LEDGER = 'docs/DEFERRAL_LEDGER.md'
const ORDER = 'docs/ia-redesign/03-implementation-order.md'

/**
 * 残しの語彙。**ここに行を足すことが母集団を広げる唯一の経路**であり、足すたびに
 * Q1 の baseline が動く (= 意図的な行為になる)。
 */
const DEFERRAL_VOCAB = [
  '未着手', '暫定', '申し送り', '後続 PR', '次セッション', '保留',
  '引き受けなかった', 'PROVISIONAL_UNTIL', 'DECLARED_GAPS',
]
const VOCAB_RE = new RegExp(DEFERRAL_VOCAB.map(v => v.replace(/ /g, '\\s')).join('|'))

/**
 * 走査対象と、**理由つきの対象外**。
 *
 * `SESSION_LOG.md` は凍結アーカイブ (CLAUDE.md が「追記しない」と宣言済み) なので、
 * そこに書かれた「未着手」は当時の記録であって今日の残しではない。対象外は推論させず
 * ここで宣言する — 黙って除くと、除いたこと自体が次の人に見えない (原則 #31)。
 */
const SCAN_DIRS = ['docs', 'src', 'scripts']
const EXCLUDED = new Map([
  ['docs/SESSION_LOG.md', '凍結アーカイブ (追記しない — 当時の記録であって今日の残しではない)'],
  [LEDGER, '登録簿自身 (宣言の置き場所であって残しの所在ではない)'],
  ['scripts/check-deferrals.mjs', 'この検査自身 (語彙の定義がヒットする)'],
  ['docs/adr/ADR-109-a-deferral-is-a-declaration-not-a-memory.md',
   '残しの語彙を定義する正本 (登録簿と同じ理由 — 語彙について述べる文は残しではない)'],
])
const SCAN_EXT = /\.(md|js|jsx|mjs)$/

/** @returns {string[]} 走査対象ファイル (repo 相対) */
function collectFiles() {
  const out = []
  const walk = (rel) => {
    const abs = join(ROOT, rel)
    if (!existsSync(abs)) return
    for (const name of readdirSync(abs)) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const childRel = `${rel}/${name}`
      const st = statSync(join(ROOT, childRel))
      if (st.isDirectory()) walk(childRel)
      else if (SCAN_EXT.test(name) && !EXCLUDED.has(childRel)) out.push(childRel)
    }
  }
  SCAN_DIRS.forEach(walk)
  return out.sort()
}

/** @returns {{file: string, line: number, marker: string}[]} 語彙のヒット全件 */
function collectHits(files) {
  const hits = []
  for (const file of files) {
    const lines = readFileSync(join(ROOT, file), 'utf8').split('\n')
    lines.forEach((text, i) => {
      const m = VOCAB_RE.exec(text)
      if (m) hits.push({ file, line: i + 1, marker: m[0] })
    })
  }
  return hits
}

// ── 登録簿のパース ────────────────────────────────────────────────────────────

/**
 * 登録簿の行。表の書式は `| DEF-NNN | 所在 | 満期 | ticket | lane |`。
 * @returns {{id: string, where: string, expiry: string, ticket: string, lane: string}[]}
 */
function parseLedger() {
  const path = join(ROOT, LEDGER)
  if (!existsSync(path)) return null
  const rows = []
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line.startsWith('| DEF-')) continue
    const cells = line.split('|').map(c => c.trim())
    rows.push({ id: cells[1], where: cells[2], expiry: cells[3], ticket: cells[4], lane: cells[5] })
  }
  return rows
}

/** 所在セルから repo 相対のファイルパスを取り出す (`` `src/x.js:12` `` → `src/x.js`)。 */
function pathsIn(where) {
  return [...where.matchAll(/`([^`]+)`/g)]
    .map(m => m[1].split(':')[0])
    .filter(p => /\.(md|js|jsx|mjs)$/.test(p))
}

// ── Status の読み取り (check-adr-status.mjs と同じ文法を使う) ─────────────────

const ADR_DIR = join(ROOT, 'docs', 'adr')

/** @returns {Map<string, string>} 'ADR-108' → Status の TOKEN 部分 */
function adrStatuses() {
  const map = new Map()
  for (const file of readdirSync(ADR_DIR).filter(f => /^ADR-\d{3}.*\.md$/.test(f))) {
    const text = readFileSync(join(ADR_DIR, file), 'utf8')
    for (const raw of text.split('\n')) {
      const s = raw.replaceAll('**', '').trim()
      const m = /^[-*]?\s*Status\s*[:：]\s*(.*)$/.exec(s)
      if (!m) continue
      map.set(file.slice(0, 7), m[1].trim())
      break
    }
  }
  return map
}

// ── Q1 RATCHET ───────────────────────────────────────────────────────────────

/**
 * 登録簿に覆われていない残しの箇所数。**実測値**であり、目標値ではない。
 *
 * 0 から始めない理由: 遡及適用は 100 本超の ADR の一括改稿になり、検査の導入そのものが
 * 止まる (check-adr-status.mjs が台帳参照を ADR-091 以降にだけ効かせたのと同じ判断)。
 * 「宣言外は 0 であるべきだが今は N 件ある」を隠さず定数にするのが ADR-100 の ratchet の
 * 形であり、**超えても下回っても fail** させることで、この数が記憶ではなく事実であり
 * 続ける。
 */
const UNDECLARED_BASELINE = 31

const errors = []
const ledger = parseLedger()

if (ledger === null) {
  errors.push(`${LEDGER} が無い。ADR-109 D1 の登録簿を作ること (残しの宣言の置き場所)。`)
} else if (ledger.length === 0) {
  errors.push(
    `${LEDGER} に DEF- 行が 1 本も無い。0 は達成ではなく導出の失敗の可能性が高い — ` +
    '正当な 0 なら理由を本文に宣言すること (原則 #31)。')
}

const files = collectFiles()
const hits = collectHits(files)
const covered = new Set((ledger ?? []).flatMap(r => pathsIn(r.where)))
const undeclared = hits.filter(h => !covered.has(h.file))

if (undeclared.length !== UNDECLARED_BASELINE) {
  const byFile = new Map()
  for (const h of undeclared) byFile.set(h.file, (byFile.get(h.file) ?? 0) + 1)
  const worst = [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([f, n]) => `      ${String(n).padStart(3)}  ${f}`).join('\n')
  const dir = undeclared.length > UNDECLARED_BASELINE ? '増えた' : '減った'
  errors.push(
    `Q1 RATCHET: 登録簿に覆われていない残しが ${undeclared.length} 箇所 ` +
    `(baseline ${UNDECLARED_BASELINE} から ${dir})。\n` +
    (undeclared.length > UNDECLARED_BASELINE
      ? '    新しい残しを宣言せずに書いた可能性がある。docs/DEFERRAL_LEDGER.md に行を足すこと\n' +
        '    (id / 所在 / 満期条件 / ticket / lane — どの欄も空にできない)。\n'
      : '    債務を払ったなら baseline をこの実測値へ下げること。下回りも落とすのは、\n' +
        '    baseline が古いままだと「今いくつ残っているか」が再び記憶の中の数になるから。\n') +
    `    多い順:\n${worst}\n`)
}

// ── Q2 EXPIRY ────────────────────────────────────────────────────────────────

const statuses = adrStatuses()
const ACCEPTED = /^Accepted\b/

// 満期の宣言は**コードに住む**。ADR は満期について*述べる*ので、散文の引用を満期の
// 宣言と取り違えないよう走査を実装ファイルに限る (取り違えると、決着を書いた ADR 自身が
// 満期切れとして落ちる — 実際に落ちた)。
for (const file of files.filter(f => /\.(js|jsx|mjs)$/.test(f))) {
  const text = readFileSync(join(ROOT, file), 'utf8')
  const m = /PROVISIONAL_UNTIL\s*=\s*['"`]([^'"`]+)['"`]/.exec(text)
  if (!m) continue
  const adr = /ADR-\d{3}/.exec(m[1])
  if (!adr) {
    errors.push(
      `Q2 EXPIRY: ${file} の PROVISIONAL_UNTIL が ADR を名指ししていない ("${m[1]}")。\n` +
      '    満期は日付でも「次の段」でもなく、**この問いを決着させる ADR** で書くこと\n' +
      '    (他人の判断に相乗りした満期は空振りする — ADR-112 §力学 2)。')
    continue
  }
  const status = statuses.get(adr[0])
  if (status === undefined) {
    errors.push(`Q2 EXPIRY: ${file} の PROVISIONAL_UNTIL が指す ${adr[0]} が docs/adr に無い。`)
  } else if (ACCEPTED.test(status)) {
    errors.push(
      `Q2 EXPIRY: ${file} の暫定の満期が過ぎている — ${adr[0]} は Accepted。\n` +
      `    ${adr[0]}: ${status}\n` +
      '    満期の来た暫定は**更新ではなく決着**で畳む (延長は先送りであって決定ではない)。\n' +
      '    決着したなら PROVISIONAL_UNTIL ごと削除すること — 宣言を残すと「まだ残っている」\n' +
      '    という嘘を出し続ける (ADR-109 §力学 2)。')
  }
}

// ── Q3 TICKET / Q4 REVERSE ───────────────────────────────────────────────────

const orderText = existsSync(join(ROOT, ORDER)) ? readFileSync(join(ROOT, ORDER), 'utf8') : ''

for (const row of ledger ?? []) {
  const where = `${LEDGER} の ${row.id}`

  for (const col of [['所在', row.where], ['満期', row.expiry], ['ticket', row.ticket], ['lane', row.lane]]) {
    if (!col[1] || col[1] === '—' || col[1] === '-') {
      errors.push(
        `Q3 TICKET: ${where} の ${col[0]} 欄が空。段を持たない項目は誰も実装しない — ` +
        'どの欄も空にできない (ADR-109 D1)。')
    }
  }

  // ticket は ADR 番号か段。どちらも**実在**を問う (辿れない参照は空欄より悪い)。
  const adrRef = /ADR-\d{3}/.exec(row.ticket ?? '')
  const phaseRef = /Phase\s[\d.]+/.exec(row.ticket ?? '')
  if (adrRef && !statuses.has(adrRef[0])) {
    errors.push(`Q3 TICKET: ${where} の ticket ${adrRef[0]} が docs/adr に存在しない。`)
  }
  if (phaseRef && orderText && !orderText.includes(phaseRef[0])) {
    errors.push(`Q3 TICKET: ${where} の ticket "${phaseRef[0]}" が ${ORDER} に段として存在しない。`)
  }
  if (!adrRef && !phaseRef && row.ticket && row.ticket !== '—') {
    errors.push(
      `Q3 TICKET: ${where} の ticket "${row.ticket}" が ADR 番号でも段でもない。` +
      '辿れる形で書くこと。')
  }

  // Q4 — 宣言が指す所在に、残しが実在するか (逆向き)。
  for (const p of pathsIn(row.where ?? '')) {
    if (!existsSync(join(ROOT, p))) {
      errors.push(
        `Q4 REVERSE: ${where} が指す ${p} が存在しない。\n` +
        '    対象ごと消えた残しは、宣言も消すか「消滅」として決着を書くこと。')
      continue
    }
    // 残しの実在の証拠は 2 形ある。語彙によるもの (大半) と、**ADR が決着していない
    // こと自体**によるもの (Proposed / Draft の ADR は語彙を 1 語も使わずに残しである)。
    // 後者を認めないと、未採択の ADR を指す行が「実装済み」と誤って名指しされる。
    const adrId = /ADR-\d{3}/.exec(p)
    const undecided = adrId && /^(Proposed|Draft)\b/.test(statuses.get(adrId[0]) ?? '')
    if (!undecided && !VOCAB_RE.test(readFileSync(join(ROOT, p), 'utf8'))) {
      errors.push(
        `Q4 REVERSE: ${where} が指す ${p} に残しの語彙が 1 つも無く、未採択の ADR でもない。\n` +
        '    実装されたなら登録簿の行を消すこと — 完了した残しの宣言が居座ると、\n' +
        '    「まだ残っている」という嘘を誰も落とさないまま出し続ける (ADR-109 D4)。')
    }
  }
}

// ── 出力 ─────────────────────────────────────────────────────────────────────

if (errors.length > 0) {
  console.error(`check-deferrals: ${errors.length} 件\n`)
  for (const e of errors) console.error(`  • ${e}\n`)
  process.exit(1)
}

console.error(
  `check-deferrals: OK — 宣言済み ${ledger.length} 件 / 宣言外 ${undeclared.length} 箇所 ` +
  `(baseline ${UNDECLARED_BASELINE}) / 満期切れ 0 件`)
