/**
 * gsn-attribution.mjs — 「ADR の木はどの項に吊られているか」の**唯一の読み手** (§1.1)
 *
 * ## なぜ切り出したか (2026-09-27 — ADR-154)
 *
 * 帰属の読み取りは ADR-153 で `check-gsn-debt.mjs` の G5 / G6 の中に生まれた。
 * 同じ日、登録簿の行 (DEF-NNN) も同じ帰属を辿る必要が出た — ticket の ADR → その木 →
 * 吊り先の項。ここで `check-deferrals.mjs` に同じ走査をもう一度書くと、事業木の構文を
 * 読むパーサが 2 つになり、片方だけが直される日が来る (`expiry-trigger.mjs` を切り出した
 * ADR-126 と同じ理由)。
 *
 * ## 何を返すか
 *
 * - `collectHungTrees()` — 木 → 事業木の **solution** の artifacts に現れた回数 (G5)。
 * - `collectHangSites()` — 木 → 吊った場所の goal・項 (`term-`)・受け入れる種類 (`admits-`)。
 *   項・admits は祖先 goal のうち最も近い宣言を継ぐ (G6 / 登録簿 Q8)。
 * - `treeOfAdr(n)` — ADR 番号 → `adr-NNN-*.gsn` (無ければ null)。**ADR と木の同一性は
 *   ファイル名の接頭辞**という規約をここ 1 か所で持つ。
 * - `topGoalLabels(file)` — 木の top goal の labels。
 *
 * @see docs/adr/ADR-153-every-investment-hangs-on-one-term-of-the-profit-formula.md
 * @see docs/adr/ADR-154-a-deferral-stalls-exactly-one-term.md
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const GSN_DIR = join(ROOT, 'docs', 'gsn')

/** 事業木。ここに solution として吊られた木だけが「帰属した投資」である。 */
export const BUSINESS_TREE = 'profit-growth.gsn'

export const TAG = (labels, prefix) => labels.filter(l => l.startsWith(prefix)).map(l => l.slice(prefix.length))

/** `docs/gsn` の ADR の木 (`adr-NNN-*.gsn`)。 */
export function adrTreeFiles() {
  if (!existsSync(GSN_DIR)) return []
  return readdirSync(GSN_DIR).filter(f => /^adr-\d{3}-.*\.gsn$/.test(f)).sort()
}

/** @param {string} n 3 桁の ADR 番号 @returns {string|null} */
export function treeOfAdr(n) {
  return adrTreeFiles().find(f => f.startsWith(`adr-${n}-`)) ?? null
}

/**
 * @returns {Map<string, number>} `docs/gsn/<file>` → 事業木の **solution** の
 *   artifacts に現れた回数。context / assumption からの参照は数えない —
 *   それは「接続予定」の散文であって帰属ではない。
 */
export function collectHungTrees() {
  const hung = new Map()
  const path = join(GSN_DIR, BUSINESS_TREE)
  if (!existsSync(path)) return hung
  let kind = null
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const text = raw.trim()
    const node = /^(goal|strategy|solution|context|assumption|justification)\s+\S+/.exec(text)
    if (node) { kind = node[1]; continue }
    const art = /^-\s+"docs\/gsn\/([^"]+\.gsn)"$/.exec(text)
    if (art && kind === 'solution') hung.set(art[1], (hung.get(art[1]) ?? 0) + 1)
  }
  return hung
}

/** 木の top goal の labels。 */
export function topGoalLabels(file) {
  const lines = readFileSync(join(GSN_DIR, file), 'utf8').split('\n')
  let inTop = false
  for (const raw of lines) {
    if (/^goal\s+\S+/.test(raw)) { if (inTop) break; inTop = true; continue }
    if (inTop && raw.trim() === '') break
    const m = /^labels\s+(.*)$/.exec(raw)
    if (inTop && m) return m[1].split(',').map(x => x.trim())
  }
  return []
}

/**
 * 事業木を走査し、木ごとに「吊った場所」の項と受け入れる変更の種類を返す。
 * 項・admits は祖先 goal のうち最も近い宣言を継ぐ (項の goal の下の小分けは項を継ぐ)。
 */
export function collectHangSites() {
  const sites = new Map()
  const terms = new Set()
  const kinds = new Set()
  const path = join(GSN_DIR, BUSINESS_TREE)
  if (!existsSync(path)) return { sites, terms, kinds }
  /** @type {{indent: number, kind: string, ident: string, labels: string[]}[]} */
  const stack = []
  let current = null
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const indent = raw.length - raw.trimStart().length
    const text = raw.trim()
    const node = /^(goal|strategy|solution|context|assumption|justification)\s+(\S+)/.exec(text)
    if (node) {
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
      current = { indent, kind: node[1], ident: node[2], labels: [] }
      stack.push(current)
      continue
    }
    const labels = /^labels\s+(.*)$/.exec(text)
    if (labels && current) {
      current.labels.push(...labels[1].split(',').map(x => x.trim()))
      for (const t of TAG(current.labels, 'term-')) terms.add(t)
      for (const k of TAG(current.labels, 'admits-')) kinds.add(k)
      continue
    }
    const art = /^-\s+"docs\/gsn\/([^"]+\.gsn)"$/.exec(text)
    if (art && current?.kind === 'solution') {
      const goals = stack.filter(n => n.kind === 'goal').reverse()
      const termGoal = goals.find(g => TAG(g.labels, 'term-').length > 0)
      const admitGoal = goals.find(g => TAG(g.labels, 'admits-').length > 0)
      sites.set(art[1], {
        goal: goals[0]?.ident,
        term: termGoal ? TAG(termGoal.labels, 'term-') : [],
        admits: admitGoal ? TAG(admitGoal.labels, 'admits-') : [],
      })
    }
  }
  return { sites, terms, kinds }
}
