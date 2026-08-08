#!/usr/bin/env node
/**
 * check-commit-trailers.mjs — 観測トレーラの**欠測を数える** (ADR-115)
 *
 * ## なぜ必要か
 *
 * ADR-092 §4 は「塞げない穴は**数える**」と宣言し、取りこぼしは
 * `commit-meta.mjs report` の `with Model-Effort: N / 総数` として
 * 「母数に現れる」と書いた。ところが `report` を読む機械はどこにも居なかった —
 * CI が走らせていたのは導出規則の単体テスト (`test:commit-meta`) だけで、
 * 被覆率そのものは**印字されるが誰も見ない数**だった。
 *
 * 結果、`git commit && git push` の連鎖で 14 コミットが無言で母集団から落ちた
 * (2026-08-08 の棚卸しで発見。`claude/ia-redesign-1xzsxz` は 1 本目だけ刻まれ、
 * 以降 10 本が 26 時間にわたって連続欠測)。欠測は**コミット単位**で起きるのに、
 * 抑止 (PreToolUse の助言) は**セッション単位で 1 回**だったため、一度その形を
 * 採ったセッションは警告を 1 度受けたあと以降すべてを静かに落とす。
 *
 * これは ADR-109 D6 と同じ形である: 「数える」と*宣言したこと*と、
 * その数を*読む機械が在ること*は別の事実。観測装置そのものが原則 #31 を踏んだ。
 *
 * ## 4 つの問い
 *
 *   Q1 RATCHET    — 母集団のうちトレーラを持たないコミットの個数。
 *                   **超えても下回っても** fail (下回ったらベースラインを下げる)。
 *   Q2 POPULATION — 母集団の境界を実際に決定できたか。決定できなければ fail。
 *                   shallow clone では境界コミットが履歴に無く、母集団が空になる —
 *                   そして**空の母集団は「全件 OK」と見分けがつかない**。この検査が
 *                   自分自身に原則 #31 を当てる欄がここ。
 *   Q3 DEGRADED   — 刻まれてはいるが中身が空 (`unknown/unknown`) / 片翼だけ
 *                   (`Model-Effort` はあるが `Task-Class` が無い) の個数。baseline 0。
 *                   transcript が読めなくなっても被覆率は 100% のままなので、
 *                   被覆だけを見ていると**緑のまま空洞化**する。
 *   Q4 DRIFT      — 根拠 (transcript 由来の `Model-Effort`) と申告
 *                   (`Co-Authored-By`) が食い違う個数。baseline 0。
 *
 * ## 母集団は導出する — 人の記憶を権威にしない (ADR-102)
 *
 * 境界は日付やハードコードした SHA ではなく、**書き手が実在し始めたコミット**
 * = `.claude/hooks/commit-trailers.sh` を追加したコミットを git 自身から引く。
 * それ以前のコミットは「刻めなかった」のではなく「刻む主体が居なかった」ので、
 * 母集団の外に在るのが正しい (正当な 0 は推論させず境界として宣言する)。
 *
 * 著者が Claude でないコミットも母集団の外。hook は人間のコミットに**意図的に**
 * 刻まない (帰属が壊れるため — ADR-092 §2)。ゆえに人間のコミットを欠測として
 * 数えるのは偽陽性になる。
 *
 * 純粋 / 副作用の分離 (原則 #3): 上段の export は文字列 → 値の純粋関数でテスト対象。
 * 下段の CLI だけが git を触る。
 *
 * CLI:
 *   node scripts/check-commit-trailers.mjs            → 検査 (CI gate)
 *   node scripts/check-commit-trailers.mjs --list     → 欠測コミットを列挙
 */

import { execFileSync } from 'node:child_process'

// ---------------------------------------------------------------------------
// 宣言された予算 (ratchet — ADR-100 と同形)
// ---------------------------------------------------------------------------

/**
 * 母集団のうちトレーラを持たないコミットの個数。
 *
 * 「宣言外は 0 であるべきだが今は 14 ある」を隠さず定数にする。0 に見せかけるより
 * 正当な非ゼロを宣言するほうが、次の 1 件が見える (ADR-100)。
 *
 * 内訳 (2026-08-08 時点、すべて `git commit && git push` 連鎖による):
 *   claude/ia-redesign-1xzsxz               10  (1 本目だけ刻印、以降 26 時間連続欠測)
 *   claude/gsn-implementation-order-xbshq1   1
 *   claude/link-network-layout-physics-...   1
 *   claude/adr-unimplemented-design-97b30n   1
 *   claude/unimplemented-adr-design-vsar1k   1
 */
export const MISSING_BASELINE = 14

/** Q3/Q4 は「在ってはならない」ので予算はゼロ。 */
export const DEGRADED_BASELINE = 0
export const DRIFT_BASELINE = 0

/** hook が刻む主体。これ以外の著者は母集団の外 (帰属 — ADR-092 §2)。 */
export const CLAUDE_AUTHOR_EMAIL = 'noreply@anthropic.com'

/** 母集団の境界を定義するファイル = 書き手そのもの。 */
export const WRITER_PATH = '.claude/hooks/commit-trailers.sh'

// ---------------------------------------------------------------------------
// 純粋計算
// ---------------------------------------------------------------------------

/**
 * コミット 1 個の判定。
 *
 * 返す種別は 4 つで、**`missing` と `foreign` を混ぜない**のが要点。
 * 「刻まれていない」と「刻む対象ではない」を同じバケツに入れると、人間が
 * コミットするたびに欠測が増えて ratchet が意味を失う。
 */
export function classifyCommit({ authorEmail, modelEffort, taskClass }) {
  if (String(authorEmail ?? '').trim() !== CLAUDE_AUTHOR_EMAIL) return 'foreign'

  const me = String(modelEffort ?? '').trim()
  const tc = String(taskClass ?? '').trim()
  if (!me && !tc) return 'missing'

  // 片翼だけ / 中身が空。被覆率の上では「刻印済」に見えるので、別に数える。
  if (!me || !tc) return 'degraded'
  if (/^unknown\/unknown$/.test(me)) return 'degraded'
  if (!/^[^/\s]+\/[^/\s]+$/.test(me)) return 'degraded'

  return 'stamped'
}

/**
 * 母集団の境界が**信用できるか**の判定 (Q2)。
 *
 * 境界が「見つかった」ことは、境界が**正しい**ことを意味しない。切り詰められた履歴
 * (shallow clone) では、そこに在る最古のコミットが親を持たないため、あらゆるファイルが
 * そのコミットで**追加された**ように見える。`--diff-filter=A` はそれを素直に返す。
 *
 * この検査を書いたとき、初版はまさにこれを踏んだ: `--depth 1` のクローンで境界が
 * HEAD 自身に化け、母集団 1 件・欠測 0 件になり、**Q1 が「baseline を 0 に下げろ」と
 * 指示した**。従えば検査は永久に無力化される — 落ちてはいるが、落ち方が嘘だった。
 * 「見つからない」より「間違ったものが見つかる」ほうが静かに危険である (ADR-103 の
 * 退役の腐敗と同じで、緑ではなく**もっともらしい赤**を出す)。
 */
export function populationVerdict({ shallow, boundary, hasParent, isRoot }) {
  if (shallow) {
    return { ok: false, reason: 'shallow', detail: '履歴が切り詰められている (shallow clone)。' }
  }
  if (!boundary) {
    return { ok: false, reason: 'not-found', detail: `${WRITER_PATH} を追加したコミットが履歴に無い。` }
  }
  // 親を持たない境界が正当なのは、それが**本物の root コミット**のときだけ。
  if (!hasParent && !isRoot) {
    return { ok: false, reason: 'truncated', detail: '境界コミットに親が無く、root コミットでもない (履歴が部分的)。' }
  }
  return { ok: true, reason: 'ok', detail: '' }
}

/** `Co-Authored-By: Claude Opus 5 <...>` の表示名と `claude-opus-5` を突き合わせる。 */
export function declarationAgrees(coAuthor, modelEffort) {
  const declared = String(coAuthor ?? '').replace(/\s*<.*/, '').trim()
  const model = String(modelEffort ?? '').split('/')[0].trim()
  if (!declared || !model) return true // 申告が無いこと自体は drift ではない
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  return norm(declared).includes(norm(model).replace(/^claude/, ''))
}

/** 判定済みの行 → 集計。 */
export function summarize(rows) {
  const counts = { stamped: 0, missing: 0, degraded: 0, foreign: 0 }
  const missing = []
  const degraded = []
  const drift = []

  for (const r of rows) {
    const kind = classifyCommit(r)
    counts[kind] += 1
    if (kind === 'missing') missing.push(r)
    if (kind === 'degraded') degraded.push(r)
    if (kind === 'stamped' && !declarationAgrees(r.coAuthor, r.modelEffort)) drift.push(r)
  }

  return { counts, missing, degraded, drift, population: counts.stamped + counts.missing + counts.degraded }
}

// ---------------------------------------------------------------------------
// 副作用 (CLI)
// ---------------------------------------------------------------------------

const ROOT = new URL('..', import.meta.url).pathname
const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })

const RS = '\x1e'
const US = '\x1f'

/** 書き手が実在し始めたコミット。見つからなければ null (= 母集団を決定できない)。 */
function findWriterBoundary() {
  try {
    const out = git(['log', '--diff-filter=A', '--reverse', '--format=%H', '--', WRITER_PATH])
    return out.split('\n').map((s) => s.trim()).filter(Boolean)[0] ?? null
  } catch {
    return null
  }
}

function revExists(rev) {
  try { git(['rev-parse', '--verify', '--quiet', rev]); return true } catch { return false }
}

function rootCommits() {
  return git(['rev-list', '--max-parents=0', 'HEAD']).split('\n').map((s) => s.trim()).filter(Boolean)
}

function readPopulation(boundary) {
  // 境界コミット**自身**も母集団に入る (そのコミットで書き手が実在した)。
  // 親の不在は Q2 が既に検証済みなので、ここに来た時点で root は本物。
  const range = revExists(`${boundary}~1`) ? `${boundary}~1..HEAD` : 'HEAD'

  const tr = (key) => `%(trailers:key=${key},valueonly,separator=%x2c)`
  const raw = git([
    'log', '--no-merges', range,
    `--format=${RS}%H${US}%ae${US}%s${US}${tr('Model-Effort')}${US}${tr('Task-Class')}${US}${tr('Co-Authored-By')}`,
  ])

  const rows = []
  for (const chunk of raw.split(RS)) {
    if (!chunk.trim()) continue
    const [sha, authorEmail, subject, modelEffort, taskClass, coAuthor] = chunk.split(US)
    rows.push({
      sha: sha.trim().slice(0, 8),
      authorEmail: authorEmail.trim(),
      subject: (subject ?? '').trim(),
      modelEffort,
      taskClass,
      coAuthor: (coAuthor ?? '').split(',')[0],
    })
  }
  return rows
}

function main(argv) {
  const errors = []

  // ── Q2 POPULATION ────────────────────────────────────────────────────────
  // 母集団を決定できないまま先に進むと、この検査は「0 件の欠測」を報告して緑を出す。
  // 空の母集団と完璧な被覆は数字の上で区別できない — だから境界の不在は fail。
  const shallow = git(['rev-parse', '--is-shallow-repository']).trim() === 'true'
  const boundary = findWriterBoundary()
  const verdict = populationVerdict({
    shallow,
    boundary,
    hasParent: Boolean(boundary) && revExists(`${boundary}^1`),
    isRoot: Boolean(boundary) && rootCommits().includes(boundary),
  })

  if (!verdict.ok) {
    console.error(
      'check-commit-trailers: Q2 POPULATION — 母集団の境界を決定できない。\n\n' +
      `  ${verdict.detail}\n` +
      '  空の母集団は「全件 OK」と見分けがつかないので、ここで落とす (原則 #31)。\n' +
      '  切り詰められた履歴では、そこに在る最古のコミットが親を持たないため、\n' +
      '  あらゆるファイルがそこで「追加された」ように見える — 境界が見つかった\n' +
      '  ことは境界が正しいことを意味しない。\n' +
      '  CI では checkout に fetch-depth: 0 が要る。手元では git fetch --unshallow。')
    process.exit(1)
  }

  const rows = readPopulation(boundary)
  const { counts, missing, degraded, drift, population } = summarize(rows)

  if (argv.includes('--list')) {
    for (const r of missing) console.log(`MISSING  ${r.sha}  ${r.subject}`)
    for (const r of degraded) console.log(`DEGRADED ${r.sha}  ${r.subject}`)
    for (const r of drift) console.log(`DRIFT    ${r.sha}  ${r.coAuthor.trim()} vs ${r.modelEffort.trim()}`)
  }

  // ── Q1 RATCHET ───────────────────────────────────────────────────────────
  if (counts.missing > MISSING_BASELINE) {
    errors.push(
      `Q1 RATCHET: トレーラの無いコミットが ${counts.missing} 件に増えた ` +
      `(baseline ${MISSING_BASELINE})。\n` +
      '    直近の欠測:\n' +
      missing.slice(0, 5).map((r) => `      ${r.sha}  ${r.subject}`).join('\n') + '\n' +
      '    ほぼ確実に `git commit && git push` を 1 コマンドに連鎖させている。\n' +
      '    hook は PostToolUse で発火するので、その形では push 済みコミットに\n' +
      '    なっており amend できない (ADR-092 §4 / ADR-115)。commit と push を\n' +
      '    別々の呼び出しに分け、`git commit --amend` で刻み直すこと。\n' +
      '    意図的に諦めるなら MISSING_BASELINE を上げる — それは宣言する行為。')
  } else if (counts.missing < MISSING_BASELINE) {
    errors.push(
      `Q1 RATCHET: 欠測が ${counts.missing} 件に減った (baseline ${MISSING_BASELINE})。\n` +
      `    同じコミットで MISSING_BASELINE を ${counts.missing} に下げること。\n` +
      '    下げないと、次に増えた 1 件がベースラインの余白に隠れる (ADR-100)。')
  }

  // ── Q3 DEGRADED ──────────────────────────────────────────────────────────
  if (counts.degraded > DEGRADED_BASELINE) {
    errors.push(
      `Q3 DEGRADED: 刻まれているが中身の無いコミットが ${counts.degraded} 件 ` +
      `(baseline ${DEGRADED_BASELINE})。\n` +
      degraded.slice(0, 5).map((r) => `      ${r.sha}  [${(r.modelEffort ?? '').trim()}] ${r.subject}`).join('\n') + '\n' +
      '    transcript が読めていない可能性が高い。被覆率は 100% のままなので、\n' +
      '    被覆だけを見ていると緑のまま空洞化する。')
  }

  // ── Q4 DRIFT ─────────────────────────────────────────────────────────────
  if (drift.length > DRIFT_BASELINE) {
    errors.push(
      `Q4 DRIFT: 根拠 (transcript) と申告 (Co-Authored-By) が食い違うコミットが ` +
      `${drift.length} 件 (baseline ${DRIFT_BASELINE})。\n` +
      drift.slice(0, 5).map((r) => `      ${r.sha}  ${r.coAuthor.trim()} vs ${(r.modelEffort ?? '').trim()}`).join('\n') + '\n' +
      '    母集団の信頼性そのものに関わるので黙らせない。')
  }

  if (errors.length > 0) {
    console.error(`check-commit-trailers: ${errors.length} 件\n`)
    for (const e of errors) console.error(`  • ${e}\n`)
    process.exit(1)
  }

  console.error(
    `check-commit-trailers: OK — 母集団 ${population} 件 ` +
    `(境界 ${boundary.slice(0, 8)} = ${WRITER_PATH} 追加、対象外の著者 ${counts.foreign} 件) / ` +
    `刻印済 ${counts.stamped} 件 / 欠測 ${counts.missing} 件 (baseline ${MISSING_BASELINE}) / ` +
    `空洞 ${counts.degraded} 件 / 申告ズレ ${drift.length} 件`)
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`
if (isMain) main(process.argv.slice(2))
