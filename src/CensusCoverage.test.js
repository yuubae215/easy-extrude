/**
 * CensusCoverage.test.js — 「列挙表そのものが古びていないか」を機械に問わせる
 * (ADR-102 / 原則 #31 の自己適用)
 *
 * ## この検査が答える問い
 *
 * 原則 #31 の道具は「必要な種別を**列挙**して個数を検査する」形をとる。この repo に
 * はその表が 6 ファイル・十数個ある (ADR-090/093/096/097/098/099/100/101)。
 * ところが *列挙する側*も表であり、表それ自体が古びる:
 *
 *   - ADR-098 は「8 つ目のプローブが増えたら表に足すまで数えられない」と自分で
 *     書いて出荷した。ADR-101 は同じ限界を writer 側で繰り返した。
 *   - 古びた表は**違反を見逃すのではなく、緑を出す**。落ちないので誰も気づかない。
 *
 * これは原則 #31 が名指しする失敗そのもの — *在るもの* (表の行) を辿る検査は、
 * 表に無いものを構造的に見ない — が、**原則 #31 の道具の側**で起きている形である。
 *
 * ## 塞ぎ方 (ADR-102 §Decision 1)
 *
 * 表を 4 つの種別に型付けし、**母集団を持たない種別 (`place-list`) の個数を 0** に
 * する。「母集団を持つ」とは、その表が覆うべき集合を**コードから導出**でき、
 * 未分類の個数を数えられること:
 *
 *   | kind                 | 母集団 | 鮮度の担保 |
 *   |----------------------|--------|-----------|
 *   | `shape-census`       | `src/**` 全体 (走査) | 構造的に新鮮 — 新しいファイルは自動で母集団に入る |
 *   | `derived-partition`  | コードから導出した集合 | 未分類 0 個 + 逆向き (宣言の空回り) を両方問う |
 *   | `declared-exception` | 宣言そのもの | 逆向きのみ — 宣言した形が実在するか |
 *   | `place-list`         | **無い** | ← これが欠陥。0 個でなければならない |
 *
 * ## この検査自身の母集団 (再帰は止まるのか)
 *
 * 止まる。表の母集団は**構文**から導出する: census 形の test ファイル
 * (`src/census/sources.js` を引くもの) に現れる `const 大文字 = [` / `= {`。
 * 手書きのファイル名リストも表名リストも持たない — 新しい census ファイルを
 * 足せばその日から母集団に入り、新しい表を足せば未登録として落ちる。
 *
 * **限界 (宣言しておく)**: census 形でない test ファイルに列挙表を作れば、この
 * 検査は見ない。母集団の定義を「全 test ファイルの大文字 const」まで広げると
 * fixture (`const SEED = {...}`) が大量に入り、無視される規則になる (希釈 —
 * 憲法 Q3)。狭く名指しした規則のほうが通る (原則 #20) ため、境界を
 * 「ソースを読む test」に置いた。境界は宣言であって推論ではない。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { collectTests, relPath, stripCommentsFlat } from './census/sources.js'
import { assertCoversPopulation } from './census/partition.js'

/** 表の種別 (原則 #31 — 種は列挙し、未宣言の種では throw する)。 */
const KIND = Object.freeze({
  /** 禁じられた *形* を並べ、`src/**` 全体を走査する。母集団は走査範囲そのもの。 */
  SHAPE_CENSUS: 'shape-census',
  /** コードから導出した母集団を、対象 / 対象外に分割する。未分類 0 個を問う。 */
  DERIVED_PARTITION: 'derived-partition',
  /** 例外・欠落の宣言。宣言した形が実在するかを逆向きに問う。 */
  DECLARED_EXCEPTION: 'declared-exception',
})

/** 種別ごとに要求する「その表が本当にその種別で使われている」機械的な痕跡。 */
const KIND_FINGERPRINT = Object.freeze({
  [KIND.SHAPE_CENSUS]:       { needs: 'collectSources(',        what: 'src/** 全体の走査' },
  [KIND.DERIVED_PARTITION]:  { needs: 'assertCoversPopulation(', what: '母集団分割の検査' },
  [KIND.DECLARED_EXCEPTION]: { needs: 'assertDeclarationsExist(', what: '宣言の実在検査' },
})

/**
 * **登録簿** — この repo に在る原則 #31 の列挙表と、その種別。
 *
 * `place-list` (母集団を持たない表) は種別として**存在しない** — 書けないことが
 * 検査である。ADR-102 以前は 3 つ在った:
 *
 *   - `PROBE_METHODS` — 支持プローブを名前で並べていた。実測すると 1 行は
 *     プローブではなく、逆に `highestSurfaceAt` が漏れていた (種の門つきで)。
 *   - `POSE_COMPUTING_METHODS` — writer 4 本。1 hop 内側の 2 本を数えていなかった。
 *   - `SELECTION_PAINTERS` — 描き手 9 種。`SelectPulse` が漏れていた。
 *
 * 3 つとも「書いた日の理解の写し」であり、書いた本人が気づける形ではなかった
 * (気づいたのは母集団を導出させた初回の実行である)。
 */
const CENSUS_REGISTRY = [
  // ── pose の入口と方針 (ADR-097 / ADR-098 / ADR-101 / ADR-102) ──
  { file: 'src/PosePolicyOwnership.test.js', table: 'POSE_WRITE_RULES',            kind: KIND.SHAPE_CENSUS,
    why: 'pose を書く呼び出しの形を並べ、所有者の外の個数を src/** 全体で数える' },
  { file: 'src/PosePolicyOwnership.test.js', table: 'LIVE_PROBES',                 kind: KIND.SHAPE_CENSUS,
    why: '「描画済みの状態を読む」形の一覧。母集団の導出 (閉包 ∩ この形) に使う' },
  { file: 'src/PosePolicyOwnership.test.js', table: 'PROBE_METHODS',               kind: KIND.DERIVED_PARTITION,
    why: '母集団 = 宣言表を引くメソッド。両方向に一致を問う' },
  { file: 'src/PosePolicyOwnership.test.js', table: 'DECLARED_TYPE_DISPATCH',      kind: KIND.DERIVED_PARTITION,
    why: '母集団 = pose 決定の閉包 ∩ 実体種の分岐。宣言外は 0 個' },
  { file: 'src/PosePolicyOwnership.test.js', table: 'DECLARED_LIVE_PROBE_READERS', kind: KIND.DERIVED_PARTITION,
    why: '母集団 = pose 決定の閉包 ∩ live プローブの読み。宣言外は 0 個' },
  { file: 'src/PosePolicyOwnership.test.js', table: 'POSE_COMPUTING_METHODS',      kind: KIND.DECLARED_EXCEPTION,
    why: '人が名前で読む writer の一覧。閉包の中に実在するかを逆向きに問う' },
  { file: 'src/PosePolicyOwnership.test.js', table: 'DECLARED_EXCEPTIONS',         kind: KIND.DECLARED_EXCEPTION,
    why: 'undo/cancel による復元。宣言した形が実在するかを逆向きに問う' },

  // ── 選択 (ADR-099) ──
  { file: 'src/SelectionOwnership.test.js',  table: 'SELECTION_WRITE_RULES',       kind: KIND.SHAPE_CENSUS,
    why: '選択を書く呼び出しの形。所有者の外の個数を src/** 全体で数える' },
  { file: 'src/SelectionOwnership.test.js',  table: 'DECLARED_EXCEPTIONS',         kind: KIND.DECLARED_EXCEPTION,
    why: '今日は空。空であることの宣言も宣言である (原則 #31)' },

  // ── 可視性 (ADR-096) ──
  { file: 'src/VisibilityOwnership.test.js', table: 'OWNERSHIP_RULES',             kind: KIND.SHAPE_CENSUS,
    why: '2 軸の合成・各軸の書き込みの形。所有者の外の個数を src/** 全体で数える' },

  // ── 同一性 (ADR-090 / ADR-094) ──
  { file: 'src/IdentityContainment.test.js', table: 'IDENTITY_RULES',              kind: KIND.SHAPE_CENSUS,
    why: '同一性の再導出の形。所有モジュールの外の個数を src/** 全体で数える' },

  // ── 呼び先の不在 (原則 #11) ──
  { file: 'src/DanglingSelfCallCensus.test.js', table: 'DECLARED_GAPS',            kind: KIND.DECLARED_EXCEPTION,
    why: '実在する欠落の宣言。埋めたら宣言も消す (逆向き)。母集団側は走査が導出する' },

  // ── 色 (ADR-100 / ADR-102) ──
  { file: 'src/theme/tokens.test.js',        table: 'SELECTION_PAINTERS',          kind: KIND.DERIVED_PARTITION,
    why: '母集団 = COLOR.accent を引くファイル。描き手か「別の意味」かに分割する' },
  { file: 'src/theme/tokens.test.js',        table: 'ACCENT_NON_PAINTERS',         kind: KIND.DERIVED_PARTITION,
    why: '同上の対象外側 (focus / mode / step / 誘目)' },
  { file: 'src/theme/tokens.test.js',        table: 'RETIRED_SELECTION_COLORS',    kind: KIND.SHAPE_CENSUS,
    why: '退役した色の形。src/** 全体での出現数が 0 であることを数える' },
  { file: 'src/theme/tokens.test.js',        table: 'DECLARED_VOCABULARIES',       kind: KIND.DECLARED_EXCEPTION,
    why: 'ratchet の分母から外す語彙。除外先に実際に色が在るかを逆向きに問う' },
  { file: 'src/theme/tokens.test.js',        table: 'EXCLUDED_WITH_REASON',        kind: KIND.DERIVED_PARTITION,
    why: '母集団 = Object.keys(COLOR)。STATE_TOKENS との和が全トークンを覆う (ADR-102 以前からの手本)' },

  // ── 投影軸 (ADR-103) ──
  { file: 'src/ProjectionAxisOwnership.test.js', table: 'RETIRED_MODE_SHAPES',   kind: KIND.SHAPE_CENSUS,
    why: '退役した Map モードの形。src/** 全体での出現数が 0 であることを数える '
       + '(ADR-100 の RETIRED_SELECTION_COLORS と同形 — 退役した状態が enum に残る腐敗は緑を出す)' },
  { file: 'src/ProjectionAxisOwnership.test.js', table: 'PROJECTION_WRITE_RULES', kind: KIND.SHAPE_CENSUS,
    why: '投影軸を書く形。所有者 (SceneView) の外の個数を src/** 全体で数える' },

  // ── 所有権・提案・証憑 (ADR-104) ──
  { file: 'src/OwnershipProposalCensus.test.js', table: 'FORBIDDEN_STORAGE_SHAPES', kind: KIND.SHAPE_CENSUS,
    why: '保存が禁じられた導出値 (stale / 衝突) の形。src/** 全体での出現数が 0 であることを数える。'
       + 'ADR-100 の RETIRED_SELECTION_COLORS と同形だが、退役ではなく「最初から作らないと決めた形」を数える '
       + '— 保存された導出値は違反を見逃すのではなく「古い正解」として緑を出す' },
  { file: 'src/OwnershipProposalCensus.test.js', table: 'LEGAL_PROPOSAL_TRANSITIONS', kind: KIND.DERIVED_PARTITION,
    why: '母集団 = PROPOSAL_STATE の全ペア。「終端から戻れない」は*書かなかったこと*で表現されるので、'
       + '実装を読んでも見えない — 全ペアを実際に通して分割を問う' },
  { file: 'src/OwnershipProposalCensus.test.js', table: 'LEGAL_AGENDA_TRANSITIONS', kind: KIND.DERIVED_PARTITION,
    why: '同上を議題側へ。再燃が「新しい議題」であることは、復帰の辺が無いことでしか表せない (ADR-104 U3)' },
  { file: 'src/OwnershipProposalCensus.test.js', table: 'PERMISSION_BY_CASE', kind: KIND.DERIVED_PARTITION,
    why: '母集団 = 所有者 3 種 × 鍵 3 種 の直積。手で並べると「誰も考えなかった組合せ」が表の外に残り、'
       + 'そこで「全員書ける」か「誰も書けない」が黙って既定になる (ADR-104 D1)' },
  { file: 'src/OwnershipProposalCensus.test.js', table: 'RETIRED_VOCABULARY', kind: KIND.DECLARED_EXCEPTION,
    why: '作らないと決めた状態語 (stale / expired / reopened)。宣言の向きが逆 '
       + '— 「実在する」= 状態語として存在しないこと' },

  // ── 発見の集約 (ADR-105) ──
  { file: 'src/DiscoveryOutsideTheFloor.test.js', table: 'AGGREGATE_READS', kind: KIND.SHAPE_CENSUS,
    why: '「集約を読んでいる」と認める形。src/** 全体を走査して母集団そのものを切り出す '
       + '— 在る描き手のファイル名リストを持たないための道具' },
  { file: 'src/DiscoveryOutsideTheFloor.test.js', table: 'FLOOR_GATES', kind: KIND.SHAPE_CENSUS,
    why: '「場が開いているか」を読む形。母集団との交わりが 0 個であることを src/** 全体で数える' },
  { file: 'src/DiscoveryOutsideTheFloor.test.js', table: 'AGGREGATE_WRITES', kind: KIND.SHAPE_CENSUS,
    why: '集約スライスへ代入する形。uiStore の行を走査して書き手が 1 個であることを数える' },
  { file: 'src/DiscoveryOutsideTheFloor.test.js', table: 'NOT_A_RENDERER', kind: KIND.DERIVED_PARTITION,
    why: '母集団 = 集約を読むファイル。描き手 / 描き手でない に分割し、未分類 0 個と '
       + '宣言の空回りを両方向に問う (初回実行で uiStore の空回りを実際に検出した)' },
  { file: 'src/DiscoveryOutsideTheFloor.test.js', table: 'RETIRED_FORMS', kind: KIND.DECLARED_EXCEPTION,
    why: 'ADR-105 が退役させた形 (agendaCounters スライス / 場に相乗りする集約更新)。'
       + '退役の腐敗は違反を見逃すのではなく緑を出すので、消したこと自体を逆向きに問う' },

  // ── 登録簿そのもの (自己適用) ──
  { file: 'src/CensusCoverage.test.js',      table: 'CENSUS_REGISTRY',             kind: KIND.DERIVED_PARTITION,
    why: '登録簿も表であり、同じ問いを免れない。母集団 = census 形 test ファイルに現れる表の構文。'
       + 'ここに自分の行が無ければ「表を数える表」だけが数えられない状態になり、'
       + 'それは ADR-102 が閉じている欠陥そのものになる' },
]

/** census 形の test ファイル = 共有の走査道具を引くもの (母集団の導出)。 */
function censusTestFiles() {
  const files = collectTests().filter(abs =>
    /from '\.{1,2}(?:\/\.\.)*\/census\/sources\.js'/.test(readFileSync(abs, 'utf8')))
  assert.ok(files.length >= 5,
    `census 形の test ファイルが ${files.length} 個しか見つからない — 導出が壊れている`)
  return files
}

/** そのファイルに現れる列挙表の名前 (`const 大文字 = [` / `= {`)。 */
function tablesIn(abs) {
  const src = stripCommentsFlat(readFileSync(abs, 'utf8'))
  return [...src.matchAll(/^\s*const ([A-Z][A-Z0-9_]{2,})\s*=\s*[[{]/gm)].map(m => m[1])
}

test('原則 #31 の列挙表はすべて登録されている — 未登録は 0 個 (ADR-102)', () => {
  // 母集団は構文から導出する。表を 1 つ足せば、登録するまでここで落ちる。
  const population = []
  for (const abs of censusTestFiles()) {
    for (const table of tablesIn(abs)) population.push(`${relPath(abs)}::${table}`)
  }

  assertCoversPopulation({
    what: '原則 #31 の列挙表',
    population,
    declared: CENSUS_REGISTRY.map(e => `${e.file}::${e.table}`),
    howDerived: 'census/sources.js を引く test ファイルに現れる `const 大文字 = [` / `= {`',
    onNew: 'CENSUS_REGISTRY に行を足し、kind を宣言すること。'
         + '母集団を持たない表 (場所を並べただけの表) は書けない — '
         + 'その表が覆うべき集合をコードから導出し、未分類の個数を 0 に保つ形へ直す (ADR-102 §Decision 1)',
  })
})

test('登録された表はすべて既知の種別を持ち、その種別の痕跡が同じファイルに在る', () => {
  // 種別を名乗るだけなら嘘がつける。種別ごとに「その使われ方をしていれば必ず
  // 在る呼び出し」を要求し、宣言と実装の距離を詰める。
  const violations = []
  for (const entry of CENSUS_REGISTRY) {
    const fingerprint = KIND_FINGERPRINT[entry.kind]
    if (!fingerprint) {
      // 未宣言の種で throw する (原則 #31) — fall-through は「宣言された既定」と
      // 「誰も考えなかった種」を区別不能にする。
      throw new Error(
        `[census] 未知の kind "${entry.kind}" (${entry.file}::${entry.table})。` +
        `KIND に無い種別は使えない — 母集団を持たない表 (place-list) を登録しようとしていないか確認すること。`)
    }
    const src = readFileSync(entry.file, 'utf8')
    if (!src.includes(fingerprint.needs)) {
      violations.push(
        `${entry.file}::${entry.table}\n` +
        `      kind "${entry.kind}" を名乗っているが、${fingerprint.what} (${fingerprint.needs}) が同じファイルに無い。\n` +
        `      → その種別で実際に検査するか、正しい kind へ直すこと。\n` +
        `      登録の理由: ${entry.why}`)
    }
    if (!entry.why?.trim()) violations.push(`${entry.file}::${entry.table}: 登録に理由が無い`)
  }
  assert.deepEqual(violations, [], `\n${violations.join('\n\n')}\n`)
})

test('母集団を持たない表 (place-list) は種別として存在しない', () => {
  // ADR-102 の決定そのもの。「場所を並べただけの表」を登録する方法が無いことを、
  // 語彙の側で固定する — 種別を足せる限り、次の place-list は必ず生まれる。
  assert.ok(!Object.values(KIND).includes('place-list'),
    'place-list が種別として復活している — 母集団を持たない表は原則 #31 の道具ではない')
  assert.deepEqual(Object.keys(KIND_FINGERPRINT).sort(), Object.values(KIND).sort(),
    'KIND と KIND_FINGERPRINT がずれている — 痕跡を要求されない種別が生まれると、'
    + 'その種別を名乗るだけで検査を素通りできる')
})

test('走査そのものが空回りしていない (母数の liveness)', () => {
  // 対象が 0 個であることは、規則が守られていることと区別がつかない (原則 #31)。
  const files = censusTestFiles()
  const total = files.reduce((n, abs) => n + tablesIn(abs).length, 0)
  assert.ok(total >= 12,
    `列挙表が ${total} 個しか見つからない — 表の検出 (const 大文字 = [ / {) が壊れている`)

  // 既知の表を名指しで 1 つ拾えることを固定する (正規表現の腐敗検知)。
  const pose = files.find(abs => relPath(abs) === 'src/PosePolicyOwnership.test.js')
  assert.ok(pose, 'pose の census ファイルが母集団から消えている')
  assert.ok(tablesIn(pose).includes('POSE_WRITE_RULES'), '既知の表を検出できていない')
})
