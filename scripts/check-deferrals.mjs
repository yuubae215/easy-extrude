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
 * 5 つ目は**この検査を CI に載せる作業そのもの**が出した (2026-08-04、ADR-109 D6):
 * 初版は満期を機械化したつもりで、機械が読んでいたのはコード側の `PROVISIONAL_UNTIL`
 * だけだった。**登録簿の満期欄は 10 行すべてが散文**で、DEF-009 の「ADR-091 が
 * Accepted になったとき」が到来しても何も落ちない。力学 1 (満期が無言で過ぎる) が、
 * それを直すために作った成果物の中で再生産されていた — 満期を*書く欄*を作ったことと、
 * その欄を*読む機械*が在ることは別の事実である。Q5 はその差を数える。
 *
 * ## 7 つの問い (Q6 / Q7 は ADR-123 / ADR-124 で追加)
 *
 *   Q1 RATCHET   — 登録簿に覆われていない残しの箇所数。**超えても下回っても** fail。
 *                  下回りも落とすのは、債務を払ったのに baseline が古いままだと
 *                  「今いくつ残っているか」が再び記憶の中の数になるから (ADR-103)。
 *   Q2 EXPIRY    — 満期の過ぎた宣言が 0 件。**満期の宣言は 2 箇所に住む** —
 *                  コード側の `PROVISIONAL_UNTIL` と、登録簿の満期欄の `満期=ADR-NNN`。
 *                  どちらも指す ADR の Status を check-adr-status.mjs と**同じ文法**で
 *                  読む (第二のパーサを作らない)。
 *   Q3 TICKET    — 登録簿の全行が実在する ticket (ADR 番号 or 段) を持つ。空欄も、
 *                  実在しない参照も落とす (在るように見えて辿れないほうが空欄より悪い)。
 *   Q4 REVERSE   — 登録簿の行が指す所在に残しが実在する。実装済みの残しの宣言は消す。
 *   Q5 REACH     — 機械が読める満期 trigger を持たない行の個数を ratchet で縛る。
 *                  Q2 は「満期が来たか」を問うが、**満期が来たことを機械が知りうるか**は
 *                  問わない。散文だけの満期は Q2 にとって存在しないのと同じであり、
 *                  数えなければ「満期を機械が読む」は行ごとに静かに空洞化する
 *                  (正当な非ゼロは 0 に見えない — 原則 #31)。
 *   Q6 DRAFT     — Draft / Proposed の ADR に実装が先行している数。既定 0、非ゼロは
 *                  `DRAFT_WITH_IMPLEMENTATION` に理由つきで宣言 (ADR-123 D4)。
 *                  **gate ではなく census** — 実装して初めて設計が決まる探索的 MVP は
 *                  実在する (ADR-046)。**検査は数え、宣言が分類する**。
 *   Q7 NOTATION  — 別の記法で書かれた register が生えていない (ADR-124)。優先度表を
 *                  持つ文書は既定 0、正当なものは `DECLARED_PRIORITY_TABLES` に宣言。
 *                  ROADMAP は 29 行を持ちながら語彙ヒット 0 件で母集団の外に居た —
 *                  **語彙を 1 語ずつ足す経路では記法の違いに届かない**。
 *
 * ## 母集団の作り方 (ここが要点)
 *
 * **`docs/**` は「残りの作業を宣言する見出し」の配下だけ** (ADR-124 — 詳細は
 * collectHits の上)。`src/` `scripts/` は全行。
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
 * 加えて **記法**にも依存する (ADR-124)。Q7 が塞ぐのは観測された 1 つの記法
 * (絵文字の優先度表) だけで、次の register が `[P1]` や `TODO(high)` や外部ツールの
 * リンクで生えたら見えない。記法の集合を先回りで網羅することはできない — できるなら
 * そもそも ROADMAP の 29 行は見えていた。
 *
 * `docs/**` の節絞りには裏がある: **narrative の中に本物の残しを書くと見えない**。
 * 交換条件として受け入れている (見えなくなる代わりに数が 0 へ向かえる)。
 *
 * 使い方: pnpm test:deferrals   (CI の gate ジョブからも実行)
 *
 * @see docs/adr/ADR-109-a-deferral-is-a-declaration-not-a-memory.md
 * @see docs/DEFERRAL_LEDGER.md
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { adrStatuses } from './adr-status.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LEDGER = 'docs/DEFERRAL_LEDGER.md'
const ORDER = 'docs/ia-redesign/03-implementation-order.md'

/**
 * 残しの語彙。**ここに行を足すことが母集団を広げる唯一の経路**であり、足すたびに
 * Q1 の baseline が動く (= 意図的な行為になる)。
 *
 * **この表自身の母集団について (境界の宣言 — 推論させない):** 本ファイルの列挙表
 * (`DEFERRAL_VOCAB` / `EXCLUDED` / `SCAN_DIRS`) は `src/CensusCoverage.test.js` の
 * 登録簿には**載らない**。あちらの母集団は `src/census/sources.js` を引く test ファイル
 * に閉じており、ここは `scripts/` かつ test ではないからである
 * (`scripts/check-adr-status.mjs` の `PHASED_PLANS` が既に同じ境界を宣言済み)。
 * 同様に `src/IdentityContainment.test.js` の `IDENTITY_RULES` も `src/**` 走査に
 * 閉じているので、覆う鍵を決める `pathsIn()` はその母集団の外に在る。
 * **境界の外に在ることを、境界の外側から宣言しておく** — 黙って外れていると、
 * 「登録されていない」と「登録する必要が無い」が区別できなくなる (原則 #31)。
 */
const DEFERRAL_VOCAB = [
  '未着手', '未実装', '暫定', '申し送り', '後続 PR', '次セッション', '保留',
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
  ['docs/ROADMAP.md',
   '凍結アーカイブ (ADR-123 D1)。生きた残しは決定を所有する ADR 本文へ移し、機能要望は '
   + 'Issues へ委譲した。**数の上では何も変わらない** — 語彙ヒットは元から 0 件で、'
   + '29 行が絵文字の優先度表という別の記法で書かれていたために母集団の外に在った。'
   + '変わるのは外れていることが宣言になることである (黙って外れているあいだは'
   + '「登録されていない」と「登録する必要が無い」が区別できない — 原則 #31)'],
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

/**
 * **残りの作業を宣言する見出し** (ADR-124)。
 *
 * `docs/**` では、この見出しの配下だけを数える。理由は実測にある — 2026-08-12 の
 * 宣言外 99 件の内訳は **docs/adr 68 / docs その他 29 / src 1 / scripts 0** で、
 * コードに残っている残しは **1 件**だった。残り 98 件は「残しについて*述べている*散文」
 * であり、**残しを片付けても減らず、残しについて考えるほど増える**。ratchet が
 * 「ドキュメント量」を測っていて、0 へ向かえない数になっていた。
 *
 * **除外リストで消さない** (Yellow Cards の 1 例目がまさにそれを禁じている — 手書きの
 * 除外表は母集団を持たない表が一段下に生えたもの)。代わりに**文書構造で絞る**:
 * 残しは「残りの作業を宣言する節」に書く、という規則にし、その節の下だけを数える。
 * 見出しの文言から導出するので手書きの除外表にならず、副産物として「残しをどこに
 * 書くか」が入口 1 つに定まる (原則 #1)。
 *
 * `src/` `scripts/` は全行数える — コードに narrative は無いので、節で絞る意味がない。
 *
 * **限界 (宣言する — 推論させない):** narrative の中に本物の残しを書くと**見えない**。
 * これは交換条件であって事故ではない: 見えなくなる代わりに、数が 0 へ向かえるように
 * なる。反対側からは Q3 / Q4 (登録簿の行が実在を問う) と Q6 が押さえる。
 */
const DEFERRAL_KEYWORD =
  /(残し|未着手|引き受けなかった|申し送り|やらないこと|Deferred|Future Work|Out of scope|Open questions|未移管|Remaining|Backlog|TODO)/i

/**
 * キーワードは見出しの**先頭付近**に無ければならない。
 *
 * 初版は「見出しのどこかに含まれる」で判定し、ADR-110 の
 * `### 力学 4 — 実測: これは入口の個数を動かさない (申し送りの前提の訂正)` のような
 * **narrative の見出し**まで節を開いてしまった。見出しが何について*書かれている*かは
 * 先頭が決める — 後ろに現れる語は主題ではなく修飾である。
 */
const HEADING_LEAD = 12
const DEFERRAL_HEADING = (line) => {
  const text = line.replace(/^#{1,6}\s*/, '').replaceAll('*', '').trim()
  const m = DEFERRAL_KEYWORD.exec(text)
  return m !== null && m.index < HEADING_LEAD
}

/**
 * @returns {{file: string, line: number, marker: string}[]} 語彙のヒット全件
 *
 * `docs/**` は「残りの作業を宣言する見出し」の配下のみ。次の見出しが来たら節は閉じる
 * (同レベル以上でなく**任意の**見出しで閉じる — 入れ子の小節も宣言の一部なら
 * DEFERRAL_HEADING に一致するはずで、一致しないなら別の話題だからである)。
 */
function collectHits(files) {
  const hits = []
  for (const file of files) {
    const lines = readFileSync(join(ROOT, file), 'utf8').split('\n')
    const scoped = /^docs\//.test(file)
    let inDeferralSection = false
    lines.forEach((text, i) => {
      if (scoped && /^#{1,6}\s/.test(text)) inDeferralSection = DEFERRAL_HEADING(text)
      if (scoped && !inDeferralSection) return
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

// 文法は `scripts/adr-status.mjs` ただ 1 箇所 (§1.1)。ここに書き写していた旧実装は
// 4 方言のうち表形式を読めず、ADR-027 / ADR-032 がマップから丸ごと欠落していた —
// 「同じ文法で読む」と*コメントに書いてあること*と、実物がそうであることは別の
// 事実である。詳細は adr-status.mjs の冒頭。

// ── Q1 RATCHET ───────────────────────────────────────────────────────────────

/**
 * 登録簿に覆われていない残しの箇所数。**実測値**であり、目標値ではない。
 *
 * 0 から始めない理由: 遡及適用は 100 本超の ADR の一括改稿になり、検査の導入そのものが
 * 止まる (check-adr-status.mjs が台帳参照を ADR-091 以降にだけ効かせたのと同じ判断)。
 * 「宣言外は 0 であるべきだが今は N 件ある」を隠さず定数にするのが ADR-100 の ratchet の
 * 形であり、**超えても下回っても fail** させることで、この数が記憶ではなく事実であり
 * 続ける。
 *
 * **2026-08-05: 31 → 71 (上がった)。** 直感に反するが、これは片付けた*結果*である。
 * DEF-001 / 002 / 003 が片付いて行を消したとき、その行が覆っていた **ファイル全体**が
 * 母集団へ戻った — 覆う粒度はファイル単位だからである (登録簿 §覆えていないもの が
 * 既に宣言している限界)。戻ってきた箇所の大半は ADR-110 / 111 / 112 と順序表の中に
 * あり、いずれも**決着した残しを記述している散文**であって、今日の残しではない。
 *
 * ここで数を下げるために散文を書き換えるのは本末転倒 (検査に合わせて履歴を消すことに
 * なる) なので、**実測値をそのまま焼く**。ADR-100 の ratchet と同じ姿勢である:
 * 「宣言外は 0 であるべきだが今は N 件ある」を隠さない。この数を減らす正しい経路は、
 * 語彙の粒度か覆う粒度を上げる次の ADR であって、baseline の書き換えではない。
 *
 * **2026-08-12 (2 度動いた): 71 → 99 → 1。**
 *
 * まず ADR-123 で 71 → 99 に**上がった** — 語彙に `未実装` を足した分 (母集団を*広げる*
 * 行為なので上がるのが正しい) と、決着を*記述する*散文が増えた分である。
 *
 * その後 ADR-124 で **99 → 1 に落ちた**。上げた直後に落としたのは、99 の内訳を測って
 * この数が**指標として壊れている**と分かったからである: docs/adr 68 / docs その他 29 /
 * **src 1** / scripts 0 — コードに残っている残しは 1 件で、残り 98 件は「残しについて
 * *述べている*散文」だった。**残しを片付けても減らず、残しについて考えるほど増える**数、
 * つまりドキュメント量の指標になっていた。走査を「残りの作業を宣言する見出し」の配下へ
 * 絞ったことで、**0 へ向かえる数**に戻った (絞り方の詳細は collectHits の上)。
 *
 * 残る 1 件は `docs/ia-redesign/03-implementation-order.md` — Phase 6 の完了条件が
 * この検査自身を*記述している*文で、見出しは残しの節なので節絞りでは落ちない。
 * **既知の偽陽性として 1 を焼く** (散文を書き換えて 0 にするのは、検査に合わせて履歴を
 * 消す行為なのでしない)。
 *
 * ↓ 以下は 99 だった当時の記録。上の経緯を読む助けとして残す。
 *
 * **71 → 99 (上がった)。ADR-123 の実装そのものが原因で、内訳は 2 つ。**
 *
 * (a) **語彙に `未実装` を足した。** これは母集団を*広げる*行為なので、上がるのが
 *     正しい。ADR-119 / 121 / 122 は語彙ヒット 0 件で、宣言済みにも宣言外にも
 *     数えられていなかった — 「登録されていない」ではなく「そもそも見えていない」
 *     状態から、まず見える状態へ移した (そのうえで DEF-014〜016 として宣言した)。
 *
 * (b) **決着を*記述する*散文が増えた。** ADR-123 本文・登録簿の書き換え・各 ADR へ
 *     移設した残しの宣言。2026-08-05 に記録した粒度の欠陥 (言及と宣言を区別できない)
 *     の **2 例目**であり、下の失敗メッセージが「2 例目なら起票する」と指示している
 *     とおり、**ADR-123 §Consequences で引き受けなかったものとして宣言した**
 *     (Yellow Cards からの昇格判断は、この検査自身を作り直す次の ADR が持つ)。
 *
 * どちらも「新しい残しを黙って書いた」ではないが、**それを理由に数を下げない**。
 * 実測値が事実であり、事実が動いた理由をここに書くのが ratchet の作法である。
 */
const UNDECLARED_BASELINE = 1

/**
 * 満期欄に機械可読の trigger (`満期=ADR-NNN`) を持たない行の数。**実測値**。
 *
 * 0 にできない理由を宣言しておく (推論させない): **満期条件が ADR の採択に
 * 対応しない行が実在する**。DEF-004 (ADR-060) や DEF-008 (ADR-098) の ADR は
 * とうに `Accepted` で、残っているのは*その決定への追従*である — ここに
 * `満期=ADR-060` を書けば「満期は 2026-07-01 に過ぎた」と主張することになり、
 * 嘘の trigger は満期が無いことより悪い (辿れない参照は空欄より悪い、Q3 と同じ理由)。
 *
 * よって trigger を**強制せず、持たない行を数える**。散文の満期は Q2 にとって
 * 存在しないのと同じであり、数えなければ「満期を機械が読む」は行ごとに静かに
 * 空洞化する。上下どちらへ動いても fail するので、この数は記憶ではなく事実であり続ける。
 *
 * **2026-08-12: 8 → 10。分子と分母の両方が動いたので、内訳を書いておく** (でないと
 * 「悪化した」と読める)。登録簿は 9 → 18 行に増え、機械可読な満期は **1 → 8 件**に
 * 増えた (DEF-008 に `GONE:` / DEF-013 に `GREP:` / DEF-014〜016・022 に `ADR-NNN` /
 * DEF-021 に `GONE:`)。散文のみが 8 → 10 になったのは、ROADMAP から移設した
 * DEF-017〜020 の 4 件が**どれも外部条件**だからである:
 *
 *   · DEF-017 fastened の複数 source — 「constraint-solver が入ったとき」
 *   · DEF-018 Shared Wasm Memory   — 「**stable Rust** で atomics が通るとき」
 *   · DEF-019 Geometry Service     — 「着手が決まったとき」
 *   · DEF-020 Node Editor の DAG   — 「着手前 ADR が**起票**されたとき」(番号が未定)
 *
 * **2026-08-12 (2 度目): 12 → 13。** ADR-124 が足した DEF-026 (条件つき退役の検出) の
 * 満期が「その規則ができたとき」で、規則そのものが未設計なので指す先が無い。
 * **未設計のものを満期にすると trigger は書けない** — これも正当な散文である。
 *
 * 4 形の trigger をもってしても書けないものが在る、というのがこの 4 件の意味である。
 * 割合では 1/9 → 8/18 へ改善しているが、Q5 は**個数**で縛ると決めた以上ここも
 * 推論させず書いておく (原則 #31 — 正当な非ゼロは 0 に見えない)。
 */
const PROSE_EXPIRY_BASELINE = 13

/**
 * 登録簿の満期欄に置く機械可読な trigger。**3 形**ある (ADR-123 D5)。
 *
 * | 形 | 満期の意味 |
 * |---|---|
 * | `満期=ADR-NNN`              | その ADR が `Accepted` になったとき |
 * | `満期=PATH:<path>`          | そのパスが**存在するようになった**とき |
 * | `満期=GREP:<path>::<regex>` | そのファイルにパターンが**現れた**とき |
 * | `満期=GONE:<path>::<regex>` | そのファイルからパターンが**消えたとき** |
 *
 * **`GONE` は実装中に足りないと分かって足した 4 形目である** (ADR-123 D5 は 3 形で
 * 書かれている)。DEF-008 の満期は「`DECLARED_GAPS` が空になったとき」で、当の
 * `src/DanglingSelfCallCensus.test.js` 自身が「表が空になったら `DECLARED_GAPS` ごと
 * 消す」と書いている — つまり満期は**出現ではなく消滅**だった。「残しが片付いたとき」
 * という最も普通の満期の形が、出現を待つ 3 形では原理的に書けない。
 *
 * 正規表現に**リテラル空白と `|` を使えない**。登録簿は Markdown の表なので `|` は
 * セル区切りとして食われ、空白は token の終わりとして食われる。`\s` と `[^x]` は
 * 使えるので実用上は足りる (`DECLARED_GAPS\s*=\s*\[\]` は書ける)。
 *
 * **位置ではなく token で読む。** 満期欄の散文は履歴 (「元は ADR-108 を指していた」)
 * を含みうるので「最初に現れた ADR 番号」のような位置の規則は、散文を書き換えた日に
 * 黙って別の ADR を指し始める。token なら、trigger を動かす行為が編集として見える。
 *
 * **なぜ 2 形足したか。** DEF-013 の満期「`core/tests/test_engine.py` に検査が入ること」は
 * 条件としては完全に機械可読なのに、*文法が無い*という理由だけで散文に落ちていた。
 * 満期を**書く欄**を作ったことと、その欄を**読む機械**が在ることは別の事実である
 * (ADR-109 D6) — 同じ形が、条件の *種類* の側にもう一度居た。
 *
 * 「nightly Rust が安定化したとき」のような外部条件は依然として書けない。Q5 の予算は
 * その分だけ残る (書けないこと自体は正当。黙って 0 件に見えることを許さないだけ)。
 */
const EXPIRY_ADR = /満期=(ADR-\d{3})/
const EXPIRY_PATH = /満期=PATH:([^\s|`]+)/
const EXPIRY_GREP = /満期=GREP:([^\s:|`]+)::([^\s|`]+)/
const EXPIRY_GONE = /満期=GONE:([^\s:|`]+)::([^\s|`]+)/

/** @returns {boolean} 機械が読める満期 trigger を 1 つでも持つか。 */
function hasExpiryTrigger(expiry) {
  const s = expiry ?? ''
  return EXPIRY_ADR.test(s) || EXPIRY_PATH.test(s) ||
         EXPIRY_GREP.test(s) || EXPIRY_GONE.test(s)
}

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
    // ── 粒度の問い (2026-08-05 — この検査自身の既知の限界) ──────────────────
    //
    // baseline を上げようとしている今が、その判断が問われる唯一の瞬間である
    // (憲法 Q3 — 規則は「書く瞬間にどこで問われるか」で決まる。誰も開かない散文に
    // 書けば守られない)。だからここに置く。
    //
    // この検査は「ここに残しが在る」と「この文が残しについて**述べている**」を
    // 区別できない。覆う粒度がファイル単位なので、決着した残しを記述する散文は
    // 登録簿の行が消えた瞬間に母集団へ戻る。1 例目は 2026-08-05 (ADR-110/111/112 —
    // 3 件片付けたら宣言外が 31 → 71 へ*増えた*)。**2 例目が来たら起票する** —
    // 累積器は docs/PHILOSOPHY.md の Yellow Cards 表で、そこに 1 例目が在る。
    '\n    ⚠ 増えた理由が「決着した残しを**記述する**散文」なら、それは残しではなく\n' +
    '      この検査の粒度の問題である (言及と宣言を区別できない)。その場合:\n' +
    '        · 散文を書き換えて数を下げない — 検査に合わせて履歴を消すことになる\n' +
    '        · baseline を上げるのは正しい。ただし理由をこの定数の docstring に書く\n' +
    '        · **昇格の判定は「無関係な 2 つ目の文脈か」で行う** — 累積器は\n' +
    '          docs/PHILOSOPHY.md の Yellow Cards 表 (候補: 「除外は数えられねばならない」)。\n' +
    '          1 例目 2026-08-05 / 同じ文脈での再発 2026-08-12 (ADR-123) を記録済み。\n' +
    '          同じ検査・同じ機構での再発は 2 例目に**数えない** — 数えると 1 つの欠陥が\n' +
    '          それ自身で原則に昇格してしまう (CLAUDE.md Q2 は「2+ の無関係な文脈」)\n' +
    `    多い順:\n${worst}\n`)
}

// ── Q2 EXPIRY ────────────────────────────────────────────────────────────────

const statuses = adrStatuses(ADR_DIR)
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

// 満期の宣言のもう一方の住所 — 登録簿の満期欄。コード側 (`PROVISIONAL_UNTIL`) だけを
// 読んでいた初版は、満期を*書く欄*を作ったことと、その欄を*読む機械*が在ることを
// 取り違えていた (ADR-109 D6)。
/** 満期が来たときの共通の叱り方 (3 形で文面を分けない — 決着の仕方は同じ)。 */
const expired = (row, what) =>
  `Q2 EXPIRY: ${LEDGER} の ${row.id} の満期が過ぎている — ${what}\n` +
  '    満期の来た残しは**更新ではなく決着**で畳む — 片付いたなら行ごと消して\n' +
  '    UNDECLARED_BASELINE を実測値へ下げ、片付いていないなら「なぜ trigger が\n' +
  '    間違っていたか」を満期欄に書いて張り替える (延長は先送りであって決定ではない)。'

for (const row of ledger ?? []) {
  const s = row.expiry ?? ''

  const adr = EXPIRY_ADR.exec(s)
  if (adr) {
    const status = statuses.get(adr[1])
    if (status === undefined) {
      errors.push(`Q2 EXPIRY: ${LEDGER} の ${row.id} の満期 trigger ${adr[1]} が docs/adr に無い。`)
    } else if (ACCEPTED.test(status)) {
      errors.push(expired(row, `${adr[1]} は Accepted。\n    ${adr[1]}: ${status}`))
    }
  }

  // `満期=PATH:` — そのパスが**現れた**ら満期 (不在が残しの証拠なので、Q4 とは逆向き)。
  const p = EXPIRY_PATH.exec(s)
  if (p && existsSync(join(ROOT, p[1]))) {
    errors.push(expired(row, `${p[1]} が存在する。`))
  }

  // `満期=GREP:` — そのファイルにパターンが**現れた**ら満期。ファイルごと消えている
  // 場合は満期ではなく **trigger が壊れている** ので、黙って通さず落とす
  // (辿れない参照は空欄より悪い — Q3 と同じ理由)。
  // `満期=GREP:` — そのファイルにパターンが**現れた**ら満期。
  // `満期=GONE:` — そのファイルからパターンが**消えた**ら満期 (残しが片付いたとき)。
  // どちらもファイルごと消えている場合は満期ではなく **trigger が壊れている** ので、
  // 黙って通さず落とす (辿れない参照は空欄より悪い — Q3 と同じ理由)。
  for (const [re, kind] of [[EXPIRY_GREP, 'GREP'], [EXPIRY_GONE, 'GONE']]) {
    const m = re.exec(s)
    if (!m) continue
    const abs = join(ROOT, m[1])
    if (!existsSync(abs)) {
      errors.push(
        `Q2 EXPIRY: ${LEDGER} の ${row.id} の満期 trigger (${kind}) が指す ${m[1]} が存在しない。\n` +
        '    満期が来ないのではなく、満期を判定する場所が消えている。張り替えること。')
      continue
    }
    const found = new RegExp(m[2]).test(readFileSync(abs, 'utf8'))
    if (kind === 'GREP' && found) errors.push(expired(row, `${m[1]} に /${m[2]}/ が現れた。`))
    if (kind === 'GONE' && !found) errors.push(expired(row, `${m[1]} から /${m[2]}/ が消えた。`))
  }
}

// ── Q5 REACH ─────────────────────────────────────────────────────────────────

const proseExpiry = (ledger ?? []).filter(r => !hasExpiryTrigger(r.expiry))
if (ledger !== null && proseExpiry.length !== PROSE_EXPIRY_BASELINE) {
  const dir = proseExpiry.length > PROSE_EXPIRY_BASELINE ? '増えた' : '減った'
  errors.push(
    `Q5 REACH: 機械が読める満期 trigger を持たない行が ${proseExpiry.length} 件 ` +
    `(baseline ${PROSE_EXPIRY_BASELINE} から ${dir}) — ${proseExpiry.map(r => r.id).join(', ')}\n` +
    (proseExpiry.length > PROSE_EXPIRY_BASELINE
      ? '    満期欄に trigger を書けるなら書くこと — 4 形ある (ADR-123 D5):\n' +
        '      · `満期=ADR-NNN`              その ADR が Accepted になったとき\n' +
        '      · `満期=PATH:<path>`          そのパスが存在するようになったとき\n' +
        '      · `満期=GREP:<path>::<regex>` そのファイルにパターンが現れたとき\n' +
        '      · `満期=GONE:<path>::<regex>` そのファイルからパターンが消えたとき\n' +
        '    どれでも書けない満期 — 外部条件 (「nightly Rust が安定化したとき」等) — なら\n' +
        '    baseline を上げ、理由を登録簿に宣言すること。\n'
      : '    trigger を足したなら baseline をこの実測値へ下げること。下回りも落とすのは、\n' +
        '    「機械が読めない満期がいくつ在るか」が再び記憶の中の数になるから (ADR-103)。\n'))
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

// ── Q7 NOTATION ──────────────────────────────────────────────────────────────

/**
 * **別の記法で書かれた register が生えていないか** (ADR-124)。
 *
 * ADR-123 力学 1 の再発防止。`docs/ROADMAP.md` は 29 行の生きた残しを持ちながら
 * 残し語彙のヒットが 0 件で、母集団に一行も入っていなかった — **絵文字の優先度表**と
 * 英語の "Backlog" という別の記法で書かれていたからである。語彙を 1 語ずつ足す経路では
 * 原理的に届かない。
 *
 * だから語彙ではなく**記法そのもの**を数える。優先度マーカーを持つ文書は、それだけで
 * 「順序づけられた未完了項目の表」= register である。既定は 0 で、正当なものは
 * `DECLARED_PRIORITY_TABLES` に理由つきで宣言する。
 *
 * **数えるのは「表の行」であって「マーカーの出現」ではない。** 初版は文字列
 * `🔴|🟡|🟢` を数え、**9 件を誤検出した** — ADR-032 の「frontend backlog (🟡 Medium) に
 * 在ったものを移設」のような*言及*まで拾ったからである。**この検査を書く作業自身が、
 * この検査が防ごうとしている「言及と宣言の混同」を再生産した** (ADR-123 §力学 3 が
 * 3 度目)。賢い語彙ではなく**構造**で絞る: 表の行であり、かつ第 1 セルが実質
 * マーカーだけであること。散文にマーカーを書いても落ちない。
 *
 * **限界 (宣言する — 推論させない):** 捕まえるのは**この記法**だけである。次の register が
 * `[P1]` や `TODO(high)` や Notion のリンクで生えたら、この検査は見ない。記法の集合を
 * 先回りで網羅することはできない (できるならそもそも力学 1 は起きていない)。
 * これは「観測された記法を 1 つ塞ぐ」ものであって、一般解ではない。
 */
/** 表の行で、第 1 セルが実質 優先度マーカーだけ (`| 🟡 Medium |` / `| ~~🔴 High~~ |`)。 */
const PRIORITY_ROW = /^\|\s*~{0,2}\s*[🔴🟡🟢][^|]{0,12}\|/
const hasPriorityTable = (text) => text.split('\n').filter(l => PRIORITY_ROW.test(l)).length >= 2
const DECLARED_PRIORITY_TABLES = new Map([
  ['docs/ROADMAP.md',
   '凍結アーカイブ (ADR-123 D1)。優先度表は**完了記録**として残っており、生きた残しは '
   + '所有 ADR と登録簿へ移設済み。§未移管 の 14 件だけが Issues 移管待ちで、それは '
   + 'DEF-021 が覆っている'],
  ['docs/validation/2026-03-22-phase-c.md',
   '**ある時点の観測**であって register ではない (validation レポートは 2026-03-22 の '
   + 'BFF Phase C レビュー結果で、SESSION_LOG と同じ点の記録)。**Q7 が初回実行で見つけた '
   + '2 つ目の記法** — P1〜P4 の勧告表 6 行を 5 か月間だれも見ていなかった。凍結する前に '
   + '実体を確認した: 唯一のコード項目 P1 (`_applyGeometryUpdate` の objectId/positions '
   + 'ガード) は `src/service/SceneService.js:373` に実装済み。残る 5 件は文書・A11Y の '
   + 'P2/P3 で、生かすなら Issues レーンへ (この宣言は「見た」ことの記録であって '
   + '「全部済んだ」の主張ではない)'],
])

for (const file of collectFiles().concat([...EXCLUDED.keys()])) {
  const abs = join(ROOT, file)
  if (!existsSync(abs) || !/\.md$/.test(file)) continue
  const hit = hasPriorityTable(readFileSync(abs, 'utf8'))
  const declared = DECLARED_PRIORITY_TABLES.has(file)
  if (hit && !declared) {
    errors.push(
      `Q7 NOTATION: ${file} が優先度マーカーの**表**を持っている (行が 2 本以上)。\n` +
      '    優先度マーカーを持つ文書は「順序づけられた未完了項目の表」= **第二の残し register**\n' +
      '    である。ROADMAP がまさにこれで、29 行が語彙ヒット 0 件のまま母集団の外に居た\n' +
      '    (ADR-123 §力学 1)。残しは登録簿か Issues のどちらかに置くこと。\n' +
      '    完了記録として正当なら DECLARED_PRIORITY_TABLES に理由つきで宣言すること。')
  }
  if (!hit && declared) {
    errors.push(
      `Q7 NOTATION: ${file} は DECLARED_PRIORITY_TABLES に宣言されているのに優先度マーカーの\n` +
      '    表が無い。宣言が実物より古い — 行を消すこと (ADR-103)。')
  }
}

// ── Q6 DRAFT ─────────────────────────────────────────────────────────────────

/**
 * 実装が住むディレクトリ。**`docs/` を含めない** — ADR は互いを*参照*するので、
 * docs を数えると「ADR が引用された」だけで実装が在ることになる。
 */
const IMPL_DIRS = ['src', 'core', 'server']
const IMPL_EXT = /\.(js|jsx|mjs|ts|tsx|py)$/
const IMPL_SKIP = new Set(['node_modules', '.venv', 'dist', '__pycache__', 'vendor'])

/** @returns {string[]} 実装ファイル (repo 相対)。 */
function collectImplFiles() {
  const out = []
  const walk = (rel) => {
    const abs = join(ROOT, rel)
    if (!existsSync(abs)) return
    for (const name of readdirSync(abs)) {
      if (name.startsWith('.') || IMPL_SKIP.has(name)) continue
      const childRel = `${rel}/${name}`
      if (statSync(join(ROOT, childRel)).isDirectory()) walk(childRel)
      else if (IMPL_EXT.test(name)) out.push(childRel)
    }
  }
  IMPL_DIRS.forEach(walk)
  return out.sort()
}

/**
 * **実装が先行している Draft / Proposed の宣言表** (ADR-123 D4)。
 *
 * 既定は 0 — Draft は「判断が閉じていない」という意味なので、実装が在るのは既定では
 * 矛盾である。しかし**実在する正当な形が 1 つある**: 実装して初めて設計が決まる探索的
 * MVP (ADR-046 の Context DSL がまさにそれで、MVP を書いて初めて interval の確定方式が
 * worst-case 自動解決ではなく Decision エンティティ経由だと分かった)。
 *
 * **だから gate (マージ拒否) ではなく census にした。** gate が最初から在ったら
 * ADR-046 は書けなかった。加えて gate は今回見つかった 2 件を 1 件も防げない —
 * どちらも実装先行ではなく **Status の上げ忘れ**だからである。
 *
 * **検査は数え、この表が分類する。** 「ADR への言及」と「ADR の決定の実装」は grep で
 * 区別できない (ADR-123 §力学 3 — ADR-044 は 5 ファイルから*言及*されるが φ 準同型の
 * 実装は 1 行も無い)。より賢い正規表現で解こうとすると規則が ADR の数だけ要るので、
 * 個数は機械が数え、判断は人が 1 度だけここに書く。
 *
 * 宣言欄が無いと人は Status を `Accepted` に倒して緑にし、**台帳に嘘が入って今より
 * 悪化する**。逆向き (宣言したのに参照が 0) も落とす — 退役の腐敗は違反を*見逃す*の
 * ではなく緑を出す (ADR-103)。
 */
const DRAFT_WITH_IMPLEMENTATION = [
  { adr: 'ADR-044',
    why: '**言及であって実装ではない。** `LayoutDslSchema.js` / `LayoutCompiler.js` / '
       + '`ProvenanceTree.js` / `NlIntake.js` / `SynonymQuotient.js` が φ 準同型の *考え方* を '
       + '引用しているだけで、ADR-044 が名指しした `src/service/FunctionRegistry.js` / '
       + '`FunctionMatcher.js` / `SpatialCommandParser` は 1 つも存在しない。'
       + 'ADR-052 が φ を 5W1H 語彙全体へ一般化した結果、引用だけが増えた。'
       + 'この行が消えるのは ADR-044 の判断が閉じたとき (DEF-017)' },
]

if (ledger !== null) {
  const implFiles = collectImplFiles()
  const declared = new Map(DRAFT_WITH_IMPLEMENTATION.map(d => [d.adr, d]))
  const undecided = [...statuses.entries()]
    .filter(([, s]) => /^(Draft|Proposed)\b/.test(s))
    .map(([id]) => id)
    .sort()

  if (undecided.length === 0) {
    errors.push(
      'Q6 DRAFT: Draft / Proposed の ADR が 1 本も無い。0 は達成ではなく Status の\n' +
      '    読み取りが壊れた可能性が高い (原則 #31 — 正当な 0 は宣言させる)。')
  }

  const refCount = new Map(undecided.map(id => [id, []]))
  for (const file of implFiles) {
    const text = readFileSync(join(ROOT, file), 'utf8')
    for (const id of undecided) if (text.includes(id)) refCount.get(id).push(file)
  }

  for (const id of undecided) {
    const refs = refCount.get(id)
    const decl = declared.get(id)
    if (refs.length > 0 && !decl) {
      errors.push(
        `Q6 DRAFT: ${id} は ${statuses.get(id).split(/[（(—,]/)[0].trim()} なのに ` +
        `実装ディレクトリの ${refs.length} ファイルから参照されている。\n` +
        `${refs.slice(0, 6).map(f => `      · ${f}`).join('\n')}\n` +
        '    判断が閉じているなら Status を上げること (実装が台帳を追い越したまま放置すると、\n' +
        '    「まだ決めていない」という嘘を出し続ける — ADR-123 §力学 2)。\n' +
        '    参照が**言及であって実装ではない**なら、scripts/check-deferrals.mjs の\n' +
        '    DRAFT_WITH_IMPLEMENTATION に理由つきで宣言すること。検査は数え、宣言が分類する。')
    }
    if (refs.length === 0 && decl) {
      errors.push(
        `Q6 DRAFT: ${id} は DRAFT_WITH_IMPLEMENTATION に宣言されているのに、実装ディレクトリ\n` +
        '    からの参照が 0 件。宣言が実物より古い — 行を消すこと (ADR-103 — 退役の腐敗は\n' +
        '    違反を見逃すのではなく緑を出す)。')
    }
  }

  for (const d of DRAFT_WITH_IMPLEMENTATION) {
    if (!statuses.has(d.adr)) {
      errors.push(`Q6 DRAFT: DRAFT_WITH_IMPLEMENTATION の ${d.adr} が docs/adr に存在しない。`)
    } else if (!/^(Draft|Proposed)\b/.test(statuses.get(d.adr))) {
      errors.push(
        `Q6 DRAFT: DRAFT_WITH_IMPLEMENTATION の ${d.adr} はもう Draft / Proposed ではない ` +
        `(${statuses.get(d.adr).split(/[（(—,]/)[0].trim()})。\n` +
        '    判断が閉じたので、この宣言は役目を終えている。行を消すこと。')
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
  `(baseline ${UNDECLARED_BASELINE}) / 満期切れ 0 件 / ` +
  `満期が機械可読 ${ledger.length - proseExpiry.length} 件・散文のみ ${proseExpiry.length} 件 ` +
  `(baseline ${PROSE_EXPIRY_BASELINE})`)
