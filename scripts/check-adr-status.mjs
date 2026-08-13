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
 *   - **段を持たない IA 再設計 ADR が 0 本**であること (下の PHASED_PLANS 参照)。
 *
 * 使い方: pnpm test:adr   (CI の gate ジョブからも実行)
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = join(SCRIPTS_DIR, '..')
const ADR_DIR = join(SCRIPTS_DIR, '..', 'docs', 'adr')

// Status の文法は `scripts/adr-status.mjs` ただ 1 箇所 (§1.1)。2026-08-12 に
// check-deferrals.mjs が同じ文法を*書き写して*いた (しかも 4 方言のうち 1 つしか
// 読めない狭い写し) ことが分かったので、両者が同じモジュールを引く形へ直した。
import { TOKEN, STATUS_VALUE, STATUS_ANY, statusValue, retiresValue, adrStatuses } from './adr-status.mjs'

/** 状態・基数の語彙 (ADR-091 以降に台帳参照を求める判定用)。 */
const STATE_VOCAB = /状態機械|ステートマシン|\bFSM\b|状態遷移|基数|cardinality|0 台|N 台/

/**
 * 段階計画を持つ設計群と、その順序表の所在。
 *
 * **なぜ必要か (原則 #31 / ADR-102):** ADR は「起票された」だけでは実装されない。
 * 実装の順序表に段を持たない ADR は「順序の外」ではなく **誰も実装しない ADR** に
 * なる。実際 ADR-107 は ADR-106 の*帰結*として起票されたのに、順序表にも依存図にも
 * 現れないまま 1 度 commit された — 起票済み ADR を辿る読み方でも、順序表の段を
 * 辿る読み方でも、**無い段は出てこない**。数えるべきは在る段ではなく *段が覆えて
 * いない ADR* である。
 *
 * **母集団は導出する。** 手書きの ADR 番号リストは、それ自身が母集団を持たない表に
 * なる (ADR-102 の `place-list`)。ここでは「順序表と同じディレクトリを参照している
 * ADR」= その設計群に属する、という構文から導く — 新しい ADR は書いた日から母集団に
 * 入り、人の記憶が権威でなくなる。
 *
 * **限界 (宣言しておく — 推論させない):** 個々の ADR の母集団は導出されるが、
 * *設計群そのもの*の一覧であるこの配列は手書きである。二つ目の段階計画が別の
 * ディレクトリに生まれ、ここへ登録されなければこの検査は見ない — ADR-102 が
 * 名指しした `place-list` の形が一段上に残っている。今日それを導出へ広げない
 * (段階計画は 1 つしか無く、母集団を導出する規則 = 「順序表とは何か」を先回りで
 * 定義することになる — §5 過剰モデリング禁止)。二つ目が生まれた日が、
 * この配列を導出へ差し替えるトリガである。
 *
 * この表は `src/CensusCoverage.test.js` の登録簿には載らない。あちらの母集団は
 * `src/census/sources.js` を引く test ファイルに閉じており (境界はあちらが宣言済み)、
 * ここは `scripts/` かつ test ではない。境界の外に在ることを、ここで宣言しておく。
 */
const PHASED_PLANS = [
  {
    /** 順序表の所在 (repo ルートからの相対パス)。 */
    order: 'docs/ia-redesign/03-implementation-order.md',
    /** この文字列を参照する ADR が母集団。順序表自身のディレクトリで導出する。 */
    belongs: 'docs/ia-redesign/',
    label: 'IA 再設計',
  },
  {
    // 2026-08-12 追加 (ADR-123 §Consequences)。grasp レーンには段が無く、
    // ADR-119 / 121 / 122 は「段を持たない ADR」の母集団の外に居た。しかし依存は
    // 実在する (ADR-120 D1 → ADR-121) のに、その順序は ADR 本文の散文にしか
    // 無かった — ADR-109 が名指しした「段を持たない項目は誰も実装しない」形である。
    order: 'docs/grasp/implementation-order.md',
    belongs: 'docs/grasp/',
    label: 'grasp',
  },
]

/** Accepted 判定 (check-deferrals.mjs の Q2 と同じ形)。 */
const ACCEPTED_RE = /^Accepted\b/

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

// 段を持たない ADR の**個数**を問う (PHASED_PLANS の JSDoc 参照)。
// 在る段を並べるのではなく、母集団のうち順序表が名指ししていないものを数える。
for (const plan of PHASED_PLANS) {
  const orderPath = join(ADR_DIR, '..', '..', plan.order)
  let order
  try {
    order = readFileSync(orderPath, 'utf8')
  } catch {
    errors.push(
      `${plan.order}: 順序表が読めない。PHASED_PLANS が指す先が消えた/移動したなら、` +
      `検査ごと畳むか行き先を名指しすること (無言で通すと段の欠落が検出できなくなる)。`
    )
    continue
  }

  const members = files.filter(f => readFileSync(join(ADR_DIR, f), 'utf8').includes(plan.belongs))
  if (members.length === 0) {
    errors.push(
      `${plan.order}: 母集団が 0 本。'${plan.belongs}' を参照する ADR が 1 本も無いのは` +
      `導出の失敗であって、達成ではない (0 は宣言させる — 原則 #31)。`
    )
    continue
  }

  const unphased = members.map(f => f.slice(0, 7)).filter(id => !order.includes(id))
  if (unphased.length > 0) {
    errors.push(
      `${plan.label}: 順序表に段を持たない ADR が ${unphased.length} 本 — ${unphased.join(', ')}\n` +
      `    ${plan.order} に段 (チェックリスト + 完了条件) を起こし、正本リストと依存図にも載せること。\n` +
      `    段の無い ADR は「順序の外」ではなく、誰も実装しない ADR になる (原則 #31)。`
    )
  }
}

// ── 索引と header の突き合わせ (2026-08-12 — ADR-124) ────────────────────────
//
// **なぜ必要か。** ADR-032 は header `Proposed` / 索引 `Accepted` / 実装 13 ファイルの
// 三様ずれを 4 か月続けていた。どちらの読み方でも見えない — header だけ読めば
// 「まだ提案中」で筋が通り、索引だけ読めば「採択済み」で筋が通る。**2 つを突き合わせる
// 者が居なかった**だけである。ADR-123 で表形式の方言が読めるようになって初めて出た。
//
// 比較するのは **TOKEN 部分だけ**。注記 (実装済みの内訳など) は索引のほうが厚いのが
// 正常で、そこまで一致を求めると索引が header の複製になる (§1.1 — 索引は導出物)。
const INDEX = join(ADR_DIR, 'README.md')
const indexStatuses = new Map()
for (const line of readFileSync(INDEX, 'utf8').split('\n')) {
  const m = /^\|\s*\[(ADR-\d{3})\]\([^)]*\)\s*\|[^|]*\|([^|]*)\|/.exec(line)
  if (m) indexStatuses.set(m[1], m[2].trim())
}

/** @returns {string|null} 値から TOKEN 部分だけを取り出す (注記は捨てる)。 */
const tokenOf = (value) => new RegExp(`^(${TOKEN})`).exec((value ?? '').replaceAll('*', '').trim())?.[1] ?? null

if (indexStatuses.size === 0) {
  errors.push(
    `${INDEX}: 索引から ADR の行を 1 つも読めない。0 は達成ではなく導出の失敗である ` +
    '(原則 #31)。表の書式が変わったならこのパーサを合わせること。')
}

for (const file of files) {
  const id = file.slice(0, 7)
  const headerValue = readFileSync(join(ADR_DIR, file), 'utf8')
    .split('\n').map(statusValue).find(v => v !== null && v !== '')
  const indexValue = indexStatuses.get(id)

  if (indexValue === undefined) {
    errors.push(
      `${id}: 索引 (docs/adr/README.md) に行が無い。ADR を足したら索引も同じコミットで ` +
      '更新すること — 索引に無い ADR は、索引を辿る読み方からは存在しない。')
    continue
  }
  const h = tokenOf(headerValue)
  const i = tokenOf(indexValue)
  if (i === null) {
    errors.push(
      `${id}: 索引の Status が TOKEN で始まっていない ("${indexValue.slice(0, 60)}")。\n` +
      '    索引も機械可読にすること (header と突き合わせられない値は、ずれても検出できない)。')
  } else if (h !== null && h !== i) {
    errors.push(
      `${id}: header と索引の Status が食い違う — header "${h}" / 索引 "${i}"。\n` +
      `    header: ${(headerValue ?? '').slice(0, 80)}\n` +
      `    索引:   ${indexValue.slice(0, 80)}\n` +
      '    どちらが実物に合っているかを**コードを見て**決めること。ADR-032 は 4 か月\n' +
      '    この状態で、header だけ読んでも索引だけ読んでも筋が通っていた (ADR-124)。')
  }
}

for (const id of indexStatuses.keys()) {
  if (!known.has(id)) {
    errors.push(`${INDEX}: 索引の ${id} に対応する ADR ファイルが docs/adr に無い。`)
  }
}

// ── Status を読む文法が 1 つであること (2026-08-12 — ADR-124) ────────────────
//
// ADR-123 の実装中、check-deferrals.mjs が「同じ文法で読む」とコメントしながら
// 実物は狭い写しを持っていた。写しは 4 方言のうち表形式を読めず、ADR がマップから
// **丸ごと欠落**していた (欠落は「Status 不明」ではなく「その ADR は存在しない」
// として現れる)。CODE_CONTRACTS に規則を書いたが、散文は誰も開かない (原則 #19 Q3) —
// **数えるべきは在るパーサではなく、adr-status.mjs の外に在るパーサの個数**である。
const STATUS_PARSER = /Status\s*\\s\*\s*\[:：\]|Status\s*\[:：\]|cells\[1\]\s*!==\s*'Status'/
const parserOwners = readdirSync(SCRIPTS_DIR)
  .filter(f => f.endsWith('.mjs') && f !== 'adr-status.mjs' && !f.endsWith('.test.mjs'))
  .filter(f => STATUS_PARSER.test(readFileSync(join(SCRIPTS_DIR, f), 'utf8')))

if (parserOwners.length > 0) {
  errors.push(
    `Status を自前でパースしているファイルが adr-status.mjs の外に ${parserOwners.length} 件 — ` +
    `${parserOwners.join(', ')}\n` +
    '    文法は scripts/adr-status.mjs ただ 1 箇所 (§1.1)。書き写すと、書いた人が知っている\n' +
    '    方言しか読めない写しになる — 4 方言のうち表形式を落とした先例が ADR-123 で出た。\n' +
    '    `import { adrStatuses, statusValue } from "./adr-status.mjs"` を使うこと。')
}

// ── 条件つき退役 (2026-08-12 — ADR-125) ──────────────────────────────────────
//
// **なぜ ADR の欄なのか。** 観測した条件つき退役はすべて「A が起きたら B を消す」の形で、
// **A はほぼ常に ADR のライフサイクル事象**だった (ADR-108 が Accepted になったら仮の住所を
// 畳む / Phase S-4 が完成したら BFF Phase D 表の行を消す / ADR-103 が実装されたら
// `DS_PENDING` を消す)。にもかかわらず宣言は**消される側**の隣に散文で置かれ、
// 条件が来た瞬間に誰もそこを読み返さなかった。
//
// だから義務を**原因の側**に移す。原因 = その ADR であり、ADR の Status 遷移は
// **既に機械が読んでいる**。`Retires:` に書いた番地は、その ADR が Accepted になった
// 日から「消えていること」を毎 PR 問われる。
//
// **この検査は新しい発明ではない。** 同じ検査は既に 2 回、手で書かれている —
// `src/ProjectionAxisOwnership.test.js` の `RETIRED_MODE_SHAPES` (ADR-103) と
// `src/theme/tokens.test.js` の `RETIRED_SELECTION_COLORS` (ADR-100)。仕組みは在るのに、
// **思い出した人だけが書いていた**。欄にすれば思い出さなくても効く。
//
// 退役の腐敗は違反を*見逃す*のではなく**緑を出す** (ADR-103) ので、逆向きも問う:
// まだ Accepted でない ADR の `Retires:` が指す先は**在らねばならない**
// (もう無いなら、その宣言は嘘である)。
const statuses = adrStatuses(ADR_DIR)
const RETIRES_REQUIRED_FROM = 125
const RETIRES_NONE = /^(なし|none|—|-)\b|^(なし|none|—|-)$/i
const RETIRES_TARGET = /(PATH|GREP):([^\s：|`]+?)(?:::([^\s|`]+))?(?=[\s、,·]|$)/g

for (const file of files) {
  const id = file.slice(0, 7)
  const num = Number(id.slice(4))
  const text = readFileSync(join(ADR_DIR, file), 'utf8')
  const value = text.split('\n').map(retiresValue).find(v => v !== null)

  if (value === undefined || value === '') {
    if (num >= RETIRES_REQUIRED_FROM) {
      errors.push(
        `${id}: \`Retires:\` 欄が無い。ADR-${RETIRES_REQUIRED_FROM} 以降は必須 (ADR-125)。\n` +
        '    この ADR が Accepted になったとき **消えていなければならないもの** を書く:\n' +
        '      - Retires: なし — <理由>\n' +
        '      - Retires: GREP:src/store/uiStore.js::mapMode · PATH:src/view/OldThing.js\n' +
        '    「消すものが無い」も**宣言**である (既定値で埋めない — 原則 #31)。\n' +
        '    遡及はしない — 歴史 ADR の一括改稿は churn に対して得るものが無いので、\n' +
        `    ADR-091 以降に台帳参照を効かせたのと同じ形で ${RETIRES_REQUIRED_FROM} 以降に切った。`)
    }
    continue
  }
  if (RETIRES_NONE.test(value)) continue

  const targets = [...value.matchAll(RETIRES_TARGET)]
  if (targets.length === 0) {
    errors.push(
      `${id}: \`Retires:\` の値が番地になっていない ("${value.slice(0, 70)}")。\n` +
      '    `PATH:<path>` か `GREP:<path>::<regex>` で書くこと (登録簿の満期 trigger と同じ語彙)。\n' +
      '    散文で書いた退役は、条件が来た日に誰も読み返さない — それがこの欄の存在理由である。')
    continue
  }

  const isAccepted = ACCEPTED_RE.test(statuses.get(id) ?? '')
  const isLive = /^(Proposed|Draft)\b/.test(statuses.get(id) ?? '')
  if (!isAccepted && !isLive) continue   // Rejected / Superseded — 決定が効いていない

  for (const [, kind, path, pattern] of targets) {
    const abs = join(ROOT_DIR, path)
    const exists = existsSync(abs)
    let present = exists
    if (kind === 'GREP') {
      if (!pattern) {
        errors.push(`${id}: \`Retires:\` の GREP に ::<regex> が無い ("${path}")。`)
        continue
      }
      present = exists && new RegExp(pattern).test(readFileSync(abs, 'utf8'))
    }

    if (isAccepted && present) {
      errors.push(
        `${id} は Accepted なのに、退役させると宣言した ${kind}:${path}` +
        `${pattern ? `::${pattern}` : ''} が**まだ在る**。\n` +
        '    退役の腐敗は違反を*見逃す*のではなく緑を出す (ADR-103) — 消すか、\n' +
        '    まだ消せない理由があるなら `docs/DEFERRAL_LEDGER.md` の行へ降ろして\n' +
        '    `Retires:` からは外すこと (残しは残しとして数える)。')
    }
    if (isLive && !present) {
      errors.push(
        `${id} は ${statuses.get(id).split(/[（(—,]/)[0].trim()} なのに、退役させると宣言した ` +
        `${kind}:${path} が**もう無い**。\n` +
        '    宣言が実物より古い (退役は済んでいる)。Status を進めるか、行を消すこと。')
    }
  }
}

if (errors.length) {
  console.error(`\ncheck-adr-status: ${errors.length} 件\n`)
  for (const e of errors) console.error(`  • ${e}\n`)
  process.exit(1)
}

console.log(`check-adr-status: ${files.length} 本すべて OK`)
