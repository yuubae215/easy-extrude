#!/usr/bin/env node
/**
 * check-gsn-debt.mjs — GSN の**宣言された未支持**に母集団・満期・個数を与える (ADR-126)
 *
 * ## なぜ必要か
 *
 * 出発点はユーザーの提案である —「残しとかって GSN の要素として書いておいたら忘れずに
 * 管理されないですか? 散文にすると忘れるんですよね? GSN の構造の一部にしといて、
 * GSN 自体も hook にすれば良いのでは?」
 *
 * **半分は既にそうなっていた。** `docs/gsn/*.gsn` には `support-exploring` /
 * `support-unexplored` の goal が **30 個**あり、しかも中身が残しそのものだった:
 *
 * ```
 * goal AbsentCentreOfMassNeverBecomesTheCentroid
 * labels support-exploring
 *     assumption KeyAbsenceTestWillSettleIt
 *     summary "未着手。決着させる検査は、重心なしのリクエストで com_offset の鍵が出ないこと。…"
 * ```
 *
 * 残しと満期条件が、散文ではなく**型のあるノード**として書かれている。ADR-123 / ADR-124 で
 * 苦しんだ語彙・記法の問題がここには最初から無い。
 *
 * ## しかし hook は半分しか出来ていなかった
 *
 * `gsn_tool.py` の `check_goal_support` は支えが 0 で**未宣言**なら error にするが、
 * **宣言済み (`support-exploring` + 検査を名指しした assumption) なら永久に緑**である。
 * `check_artifacts` も、存在しない artifact パスを hard error にするのは `solution` の
 * 下だけで、`assumption` の下は意図的に warning (「planned but not yet written は正当」)。
 *
 * つまり **「宣言された未支持」に満期が無い**。名指しした検査が実在するようになっても
 * 何も落ちない — **ADR-109 力学 1 (満期が無言で過ぎる) が GSN レーンでそのまま
 * 再生産されている**。しかも 30 個ある。個数を数える ratchet も無く、`report` モードの
 * 集計は `pnpm test:gsn` が走らせないので**印字ですらない** (ADR-115)。
 *
 * ## 4 つの問い
 *
 *   G1 POPULATION — 木を持つべき ADR が木を持っている。**ADR-126 以降は必須**
 *                   (遡及しない — `Retires:` を ADR-125 以降に切ったのと同じ判断)。
 *                   cutoff 前の欠落は `DECLARED_TREELESS` に理由つきで宣言する。
 *   G2 DEBT       — 宣言された未支持 goal の個数を ratchet で縛る。**超えても下回っても**
 *                   fail。「宣言された未支持」に欄が無ければ、30 が 60 になっても
 *                   誰も気づかない (原則 #31 — 正当な非ゼロは 0 に見えない)。
 *   G3 REACH      — 満期 trigger を持たない未支持 goal の個数を ratchet で縛る。
 *                   Q5 と同じ形 — 「満期を書く欄が在る」ことと「その欄を読む機械が
 *                   在る」ことは別の事実である (ADR-109 D6)。
 *   G4 EXPIRY     — 満期の来た未支持 goal が 0 件。名指しした検査が実在するように
 *                   なったら落ちる = 「exploring を solution へ昇格させよ」。
 *
 * ## 満期の書き方
 *
 * exploring goal の子 `assumption` の `summary` に、登録簿と**同じ語彙**で書く:
 *
 *     assumption KeyAbsenceTestWillSettleIt
 *     summary "未着手。決着させる検査は … 満期=GREP:core/tests/test_engine.py::com_offset"
 *
 * 文法と評価器は `scripts/expiry-trigger.mjs` ただ 1 箇所 (§1.1)。ここに書き写さない —
 * それは ADR-123 §実装で分かったこと 2 で見つけた欠陥の再生産である。
 *
 * ## 限界 (宣言する — 推論させない)
 *
 * - **パーサは字下げベースの素朴なもの**である。`gsn_tool.py` が正本の文法を持ち、
 *   ここは「goal の labels と子 assumption の summary」しか読まない。文法が変わったら
 *   ここも落ちる (黙って 0 件になるより落ちるほうがよい — G2 が下回りでも fail する)。
 * - **`support-unexplored` には満期を求めない。** 「まだ何も名指ししていない」が
 *   その状態の定義なので、満期を書けというのは矛盾である。G3 の母集団は exploring のみ。
 *
 * 使い方: pnpm test:gsn-debt   (CI の gate ジョブからも実行)
 *
 * @see docs/adr/ADR-126-a-deferral-that-is-a-claim-belongs-to-the-argument.md
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { adrStatuses } from './adr-status.mjs'
import { hasExpiryTrigger, evaluateTriggers, TRIGGER_HELP } from './expiry-trigger.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GSN_DIR = join(ROOT, 'docs', 'gsn')
const ADR_DIR = join(ROOT, 'docs', 'adr')

/**
 * 木を持つべき ADR の cutoff。**ADR-126 以降は必須。**
 *
 * `.claude/skills/adr/SKILL.md` は「ADR を起票するなら GSN も起こす(無条件)」と既に
 * 規律を持っているが、**それを問う機械が無かった** — 規律が在ることと、守られたかを
 * 数える場所が在ることは別の事実である (ADR-115 と同じ形)。実測で ADR-115 / 116 / 117 に
 * 木が無く、逆に未実装の ADR-119 / 121 / 122 には在った。
 *
 * 遡及しない理由: 歴史 ADR 125 本に木を書くのは churn に対して得るものが無い
 * (`Retires:` を ADR-125 以降に切ったのと同じ判断)。
 */
const TREE_REQUIRED_FROM = 126

/**
 * cutoff より前で木を持たない ADR のうち、**書かないと決めたもの**。
 *
 * 空にしない — cutoff 前は「木が無い」が既定なので、ここに並ぶのは「将来書くつもりが
 * あるか、無いと決めたか」を人が判断した分だけである。今日は 0 件 (誰も判断していない)
 * ことを宣言しておく: **判断していないことと、判断して不要としたことは違う**。
 */
const DECLARED_TREELESS = new Map([])

/**
 * **support ラベルの種の宣言** — prefix で推論しない。
 *
 * 初版は `startsWith('support-')` で数え、**57 個**を報告した (実測は 30)。原因は
 * **第 3 のラベル `support-verified`** で、これは「支えが在る」= *逆の意味*である。
 * prefix は「support について何か言っている」しか意味せず、その符号を持たない。
 * 未宣言の種で throw する形にすれば、4 つ目のラベルが生まれた日に落ちる
 * (`EXPLICIT_DEFAULTS` / `PLACEMENT_BY_KIND` と同じ形 — 原則 #31)。
 */
const SUPPORT_LABELS = new Map([
  ['support-exploring', 'unsupported'],    // 探索中 — 決着させる検査を名指し済み
  ['support-unexplored', 'unsupported'],   // 未探索 — まだ何も名指ししていない
  ['support-verified', 'supported'],       // 証拠あり (逆の意味 — 債務ではない)
])

/**
 * G2 — 宣言された未支持 goal の個数 (実測値。目標値ではない)。
 *
 * **30 であって 31 ではない。** 前段の棚卸しで grep が 31 と数えたのは、adr-105 の
 * summary が散文の中で `support-unexplored` に**言及**していたからである — 言及と
 * 宣言を区別できないという ADR-124 の欠陥が、その ADR を書いた本人の計測にも出た。
 * ラベルを構造として読む本パーサが正しい。
 */
// 2026-08-14: ADR-119 D1 (target の契約宣言 + 両端の準拠テスト) が決着し 30 → 29。
// 同日 ADR-127 (UR の解析解 IK) が木を起こし +1 で 30。増えた 1 個は
// `TheFlangeConventionMatchesWhatTheFrontDraws` — **core/ 内では原理的に決着しない**
// 主張である (自己整合な誤った規約も往復検査を通る) ため、証拠はフロント配線と同時。
// 満期は機械可読なので G3 の分子には乗らない。
// 2026-08-14 (同日 3 度目): ADR-128 が 2 件決着させて 30 → 28。ADR-119 の
// `UnstatedAndStatedAnywhereAreDistinguishable` (D2/D3 の純粋層 + 文書往復) と、
// ADR-127 の `TheFlangeConventionMatchesWhatTheFrontDraws` — 後者は上のコメントが
// 予告したとおり**フロント配線と同時**に決着した (満期 trigger が実際に発火し、
// G4 が「exploring を solution へ昇格させよ」と言ってきた)。ADR-128 自身の木は
// 未支持 goal を 1 つも持たない (3 つとも solution が在る) ので +0。
// 2026-08-14 (同日 4 度目): ADR-129 (Proposed・未実装) の木が **4 goal** を足して 32。
// 起票と同時に木を起こす規律 (adr skill §GSN 併設) の帰結で、Proposed の ADR は
// 定義上ほぼ全部の goal が exploring になる — この 4 件は「借金が増えた」のではなく
// **借金が可視化された**ぶんである。4 件とも機械可読な満期を持つので分子 (G3) は動かない。
// 2026-08-14: 32 → 28。ADR-129 の 4 goal に証拠が付いた (D1/D2/D3 が実装され、
// 往復・対照・入口の個数を焼いた検査が実在する) ので exploring から solution へ昇格した。
// 下げるのも意図的な行為である — 債務を払ったのに baseline が古いままだと、
// 「いま いくつ未支持か」が再び記憶の中の数になる (ADR-103)。
// 2026-08-14 (同日 5 度目): 28 → 29。ADR-132 の木が 1 goal を足した
// (`TheJoinIsExercisedOnMovedRealGeometry` — 文書を読み込んだ状態で Solid を動かし、
// 掴む場所の宣言が動いた先に付いてくることを実機で通していない)。**ADR 本文が
// 「この証拠が構造的に見逃すもの」として自分で名指しした限界**を、散文ではなく
// 数えられる場所へ降ろしたぶんである — 散文の限界は誰も数えないので、宣言した
// 瞬間から静かに消える。機械可読な満期 (GREP) を持つので分子 (G3) は動かない。
const DEBT_BASELINE = 29

/**
 * G3 — 満期 trigger を持たない exploring goal の個数 (実測値)。
 *
 * 0 にできない理由を宣言しておく: 決着させる検査が**まだ設計されていない**ことがある。
 * 「何が決着させるか」を名指しできても、それが repo 内のどの番地に現れるかは
 * 決まっていない段階が実在する。嘘の trigger を書くより、書けないことを数える。
 */
// 2026-08-14: 上と同じ 1 件。決着した goal の assumption は散文満期だったので分子も下がる。
// 2026-08-14 (同日 3 度目): ADR-128 の決着 2 件のうち、ADR-119 側の assumption は
// 散文満期だったので 25 → 24。ADR-127 側は機械可読な満期を持っていたので分子には
// もともと乗っておらず、ここは 1 しか下がらない。
const PROSE_DEBT_BASELINE = 24

const errors = []

// ── .gsn の素朴なパース (字下げベース) ───────────────────────────────────────

/**
 * @returns {{file: string, ident: string, line: number, labels: string[],
 *            assumptions: {ident: string, summary: string}[]}[]}
 *   goal ノードのうち support ラベルを持つものだけ。
 */
function collectDeclaredUnsupported() {
  const out = []
  if (!existsSync(GSN_DIR)) return out

  for (const file of readdirSync(GSN_DIR).filter(f => f.endsWith('.gsn')).sort()) {
    const lines = readFileSync(join(GSN_DIR, file), 'utf8').split('\n')
    /** @type {{ident: string, indent: number, line: number, labels: string[], assumptions: any[]}|null} */
    let current = null
    /** @type {{indent: number, summary: string}|null} */
    let pendingAssumption = null

    const flush = () => {
      if (current) {
        const support = current.labels.filter(l => l.startsWith('support-'))
        for (const l of support) {
          if (!SUPPORT_LABELS.has(l)) {
            errors.push(
              `G2 DEBT: docs/gsn/${file}:${current.line} の goal ${current.ident} が未宣言の ` +
              `support ラベル "${l}" を持っている。\n` +
              '    SUPPORT_LABELS に種と**符号** (supported / unsupported) を宣言すること — ' +
              'prefix は符号を持たない。\n' +
              '    実際 support-verified は「支えが在る」= 逆の意味で、prefix で数えた初版は ' +
              '30 を 57 と報告した。')
          }
        }
        if (support.some(l => SUPPORT_LABELS.get(l) === 'unsupported')) {
          out.push({ file: `docs/gsn/${file}`, ...current })
        }
      }
      current = null
    }

    lines.forEach((raw, i) => {
      const indent = raw.length - raw.trimStart().length
      const text = raw.trim()
      const node = /^(goal|strategy|solution|context|assumption|justification)\s+(\S+)/.exec(text)

      if (node) {
        const [, kind, ident] = node
        if (kind === 'goal') {
          flush()
          current = { ident, indent, line: i + 1, labels: [], assumptions: [] }
          pendingAssumption = null
          return
        }
        // goal より深い assumption はその goal の子。同じか浅ければ goal は閉じる。
        if (current && indent <= current.indent) flush()
        pendingAssumption = (kind === 'assumption' && current)
          ? { ident, indent, summary: '' }
          : null
        if (pendingAssumption) current.assumptions.push(pendingAssumption)
        return
      }

      if (!current) return
      const labels = /^labels\s+(.*)$/.exec(text)
      if (labels && !pendingAssumption) {
        current.labels.push(...labels[1].split(',').map(s => s.trim()))
        return
      }
      const summary = /^summary\s+"([\s\S]*)"?$/.exec(text)
      if (summary && pendingAssumption) pendingAssumption.summary += summary[1]
    })
    flush()
  }
  return out
}

// ── 実行 ─────────────────────────────────────────────────────────────────────

const statuses = adrStatuses(ADR_DIR)

// ── G1 POPULATION ────────────────────────────────────────────────────────────

const trees = existsSync(GSN_DIR)
  ? readdirSync(GSN_DIR).filter(f => f.endsWith('.gsn'))
  : []
if (trees.length === 0) {
  errors.push('G1 POPULATION: docs/gsn に .gsn が 1 本も無い — 走査に失敗している (0 は達成ではない)。')
}

const adrFiles = readdirSync(ADR_DIR).filter(f => /^ADR-\d{3}.*\.md$/.test(f)).sort()
for (const file of adrFiles) {
  const id = file.slice(0, 7)
  const num = Number(id.slice(4))
  const slug = `adr-${id.slice(4)}-`
  const hasTree = trees.some(t => t.startsWith(slug))

  if (hasTree) {
    if (DECLARED_TREELESS.has(id)) {
      errors.push(
        `G1 POPULATION: ${id} は DECLARED_TREELESS に宣言されているのに木が在る。\n` +
        '    宣言が実物より古い — 行を消すこと (ADR-103 — 退役の腐敗は緑を出す)。')
    }
    continue
  }
  if (num >= TREE_REQUIRED_FROM) {
    errors.push(
      `G1 POPULATION: ${id} に \`.gsn\` が無い。ADR-${TREE_REQUIRED_FROM} 以降は必須 (ADR-126)。\n` +
      `    docs/gsn/${slug}<slug>.gsn を同じ PR で起こすこと。\n` +
      '    .claude/skills/adr/SKILL.md §GSN 併設 が「無条件」と既に宣言しているが、\n' +
      '    **それを問う機械が無かった** — 規律が在ることと、守られたかを数える場所が\n' +
      '    在ることは別の事実である (ADR-115 と同じ形)。')
  }
}

for (const id of DECLARED_TREELESS.keys()) {
  if (!statuses.has(id)) {
    errors.push(`G1 POPULATION: DECLARED_TREELESS の ${id} が docs/adr に無い。`)
  }
}

// ── G2 DEBT / G3 REACH / G4 EXPIRY ───────────────────────────────────────────

const unsupported = collectDeclaredUnsupported()

if (unsupported.length !== DEBT_BASELINE) {
  const dir = unsupported.length > DEBT_BASELINE ? '増えた' : '減った'
  const byFile = new Map()
  for (const g of unsupported) byFile.set(g.file, (byFile.get(g.file) ?? 0) + 1)
  errors.push(
    `G2 DEBT: 宣言された未支持 goal が ${unsupported.length} 個 (baseline ${DEBT_BASELINE} から ${dir})。\n` +
    (unsupported.length > DEBT_BASELINE
      ? '    証拠の無い主張が増えた。正当なら baseline を上げ、理由をこの定数の docstring に書くこと。\n'
      : '    証拠が付いたなら baseline をこの実測値へ下げること。下回りも落とすのは、\n' +
        '    baseline が古いままだと「今いくつ未支持か」が再び記憶の中の数になるから (ADR-103)。\n') +
    [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([f, n]) => `      ${String(n).padStart(3)}  ${f}`).join('\n') + '\n')
}

const exploring = unsupported.filter(g => g.labels.includes('support-exploring'))
const proseOnly = exploring.filter(g => !g.assumptions.some(a => hasExpiryTrigger(a.summary)))

if (proseOnly.length !== PROSE_DEBT_BASELINE) {
  const dir = proseOnly.length > PROSE_DEBT_BASELINE ? '増えた' : '減った'
  errors.push(
    `G3 REACH: 満期 trigger を持たない exploring goal が ${proseOnly.length} 個 ` +
    `(baseline ${PROSE_DEBT_BASELINE} から ${dir})。\n` +
    '    決着させる検査の**番地**が分かるなら、assumption の summary に書くこと:\n' +
    TRIGGER_HELP +
    '    書けない (検査がまだ設計されていない) なら baseline を動かし、理由を宣言すること。\n' +
    '    数えなければ「満期を機械が読む」は goal ごとに静かに空洞化する (原則 #31)。\n')
}

for (const g of exploring) {
  for (const a of g.assumptions) {
    for (const t of evaluateTriggers(a.summary, { root: ROOT, statuses })) {
      if (t.broken) {
        errors.push(
          `G4 EXPIRY: ${g.file} の goal ${g.ident} (assumption ${a.ident}) の満期 trigger ` +
          `(${t.kind}) が壊れている — ${t.broken}。\n` +
          '    満期が来ないのではなく、満期を判定する場所が消えている。張り替えること。')
        continue
      }
      if (t.fired) {
        errors.push(
          `G4 EXPIRY: ${g.file}:${g.line} の goal ${g.ident} は満期を迎えている — ` +
          `${t.kind}:${t.what}。\n` +
          '    名指しした検査が実在するようになった。**exploring を solution へ昇格させる**\n' +
          '    (証拠が在るのに support-exploring のままだと、論証木は実際より弱く見える —\n' +
          '    退役の腐敗の鏡像で、こちらは*過少申告*として緑を出す)。')
      }
    }
  }
}

// ── 出力 ─────────────────────────────────────────────────────────────────────

if (errors.length > 0) {
  console.error(`check-gsn-debt: ${errors.length} 件\n`)
  for (const e of errors) console.error(`  • ${e}\n`)
  process.exit(1)
}

console.error(
  `check-gsn-debt: OK — 木 ${trees.length} 本 / 宣言された未支持 ${unsupported.length} 個 ` +
  `(baseline ${DEBT_BASELINE}) / うち exploring ${exploring.length} 個 · ` +
  `満期が機械可読 ${exploring.length - proseOnly.length} 個・散文のみ ${proseOnly.length} 個 ` +
  `(baseline ${PROSE_DEBT_BASELINE}) / 満期切れ 0 件`)
