/**
 * DiscoverySummary — 「発見の集約」の型 (ADR-105 D2 / D3)。
 *
 * ## この module が答える問い
 *
 * 画面に `0` が出たとき、それは **どの 0 か**。ADR-105 が実測した通り、ここには
 * 次の一手が全部違う 0 が 3 種類ある:
 *
 *   | 何が起きているか                     | 正しい見え方 | 次の一手     |
 *   |--------------------------------------|-------------|--------------|
 *   | 文書が無い / まだ検証を走らせていない | **未検証**   | 文書を採る    |
 *   | 文書は在るが検査を 1 つも宣言していない | **検査対象なし** | 検査を宣言する |
 *   | 検査が在り、全部通った                | **全部パス**  | 何もしなくてよい |
 *
 * 3 つが同じ `0` (ないし「何も出ない」) へ潰れるのは原則 #31 の典型 — 不在は
 * 検査対象のノードを持たないので、*在るもの*を辿る限り永久に見えない。
 *
 * ## 形 (なぜ union で、なぜ boolean でも null でもないか)
 *
 * `kind` 判別の**有界 union**。ADR-060 が契約の pose に課したのと同じ形を画面上の
 * 集約へ適用しただけで、新しい概念は足していない (原則 #2 — 能力の分岐は型で行う)。
 *
 * `null` / `undefined` / `0` で代用しない。それらは読み手に**推論させる**形であり、
 * ADR-105 が消そうとしているものそのものである。`hasDocument: boolean` を足す案も
 * 却下した — boolean は状態を暗黙化する形 (核 §1.4 が名指しで禁じる) で、かつ
 * 3 種のうち 2 種までしか割れない (「文書は在るが検査 0 件」が「全部パス」に潰れる)。
 *
 * ## 純粋性
 *
 * この module は**純粋**である (原則 #3)。ストアも DOM も時計も読まない。
 * ドメイン (`ContextValidator` / `agendaCounters()` / `projectChecks()`) は 1 行も
 * 変えていない — 中身は ADR-104 D4 で既に正しく、欠けていたのは **住所** と
 * **文書が無いときに何と言うか**だけだった (ADR-105 Context)。
 */

/** 発見の集約の種 (ADR-105 D2)。 */
export const DISCOVERY_KIND = Object.freeze({
  /** 文書をまだ採っていない = 数えていない。**失敗ではない**(起動直後の通常状態)。 */
  UNEXAMINED: 'unexamined',
  /** 文書を採って数えた。3 数は合算しない (ADR-104 D4)。 */
  EXAMINED:   'examined',
})

/** 共有 KPI (acceptance check) の集約の種 (ADR-105 D3)。 */
export const CHECKS_KIND = Object.freeze({
  /** 文書が無い = 検査が在るかどうかすら分かっていない。 */
  UNEXAMINED:    'unexamined',
  /** 文書は在るが `acceptance` が空 = 検査対象が宣言されていない。 */
  NONE_DECLARED: 'none-declared',
  /** 検査が在り、blocked も fail も 0 件。**ここだけが「✓ 全部パス」を名乗ってよい。** */
  ALL_PASS:      'all-pass',
  /** 検査が在り、通っていないものが在る。 */
  FAILING:       'failing',
})

/**
 * 発見の集約を組み立てる (ADR-105 D2)。
 *
 * `loaded` は `ctx.active` (場が開いているか) では**ない** — 場の開閉は集約が
 * 変わる理由ではないからである (D4)。依存する軸は「文書を採ったか」ただ 1 つ。
 *
 * @param {object} input
 * @param {boolean} input.loaded  文書を採ったか (`ContextService.loaded`)
 * @param {{conflicts:number, agenda:number, unowned:number}} [input.counters]
 *        `agendaCounters()` の返り値。`loaded` のとき**必須**。
 * @returns {{kind:'unexamined'} | {kind:'examined', conflicts:number, agenda:number, unowned:number}}
 */
export function discoverySummary({ loaded = false, counters = null } = {}) {
  if (!loaded) return { kind: DISCOVERY_KIND.UNEXAMINED }
  // 数えたと言うなら数が要る。ここで 0 を埋めると「ドメインが数えた 0」と
  // 「配線が来ていない 0」が区別不能になる — それが本 module の存在理由である。
  if (!counters) {
    throw new Error(
      'discoverySummary: loaded なのに counters が無い。0 で埋めない — ' +
      '未検証なら loaded:false を渡すこと (ADR-105 D2)。',
    )
  }
  return {
    kind:      DISCOVERY_KIND.EXAMINED,
    conflicts: counters.conflicts ?? 0,
    agenda:    counters.agenda    ?? 0,
    unowned:   counters.unowned   ?? 0,
  }
}

/**
 * 共有 KPI の集約を組み立てる (ADR-105 D3)。
 *
 * 「検査対象なし」と「全部パス」を**別の値**にする。前者に「✓ 全部パス」と出すのは
 * 嘘であり、何も出さないのは原則 #15 (Fixed Slots) 違反である。
 *
 * @param {object} input
 * @param {boolean} input.loaded
 * @param {{status:'pass'|'fail'|'blocked'}[]} [input.checks]  `projectChecks()` の返り値
 * @returns {{kind:'unexamined'} | {kind:'none-declared'} |
 *           {kind:'all-pass', total:number} |
 *           {kind:'failing', failed:number, blocked:number, passed:number, total:number}}
 */
export function checksSummary({ loaded = false, checks = null } = {}) {
  if (!loaded) return { kind: CHECKS_KIND.UNEXAMINED }
  if (!Array.isArray(checks)) {
    throw new Error(
      'checksSummary: loaded なのに checks が配列でない。空配列と「未検証」は別物なので ' +
      '既定値で埋めない (ADR-105 D3)。',
    )
  }
  if (checks.length === 0) return { kind: CHECKS_KIND.NONE_DECLARED }

  const failed  = checks.filter(c => c.status === 'fail').length
  const blocked = checks.filter(c => c.status === 'blocked').length
  if (failed + blocked === 0) return { kind: CHECKS_KIND.ALL_PASS, total: checks.length }
  return {
    kind:    CHECKS_KIND.FAILING,
    failed,
    blocked,
    passed:  checks.length - failed - blocked,
    total:   checks.length,
  }
}

/**
 * 種ごとの**宣言表** — 見出し・説明・出口 (何をすれば次へ進むか)。
 *
 * `EXPLICIT_DEFAULTS` (ADR-096) / `PLACEMENT_BY_KIND` (ADR-097) /
 * `SUPPORT_SURFACE_BY_KIND` (ADR-102) と同じ既定表の規律に従う: **未宣言の種で throw** する。
 * fall-through は「宣言された既定」と「誰も考えなかった種」を区別不能にする =
 * *決定*の不在 (原則 #31)。
 */
const DISCOVERY_DECLARATION = Object.freeze({
  [DISCOVERY_KIND.UNEXAMINED]: Object.freeze({
    headline: 'Unexamined',
    // 未検証は失敗ではない (ADR-105 D2) ので、色の役割は caution ではなく secondary。
    tone:     'quiet',
    detail:   'No document adopted yet — nothing has been counted.',
    exit:     'Adopt one from Layouts / New Project / Import.',
  }),
  [DISCOVERY_KIND.EXAMINED]: Object.freeze({
    headline: 'Counted',
    tone:     'live',
    detail:   'Three numbers, never summed (ADR-104 D4).',
    exit:     'Open the floor to settle what is open.',
  }),
})

const CHECKS_DECLARATION = Object.freeze({
  [CHECKS_KIND.UNEXAMINED]: Object.freeze({
    headline: 'Unexamined',
    tone:     'quiet',
    detail:   'No document adopted — whether checks exist is unknown.',
    exit:     'Adopt a context document.',
  }),
  [CHECKS_KIND.NONE_DECLARED]: Object.freeze({
    headline: 'No checks declared',
    tone:     'quiet',
    detail:   'The document declares no acceptance checks, so nothing was judged.',
    exit:     'Declare one in Intake / Wizard.',
  }),
  [CHECKS_KIND.ALL_PASS]: Object.freeze({
    headline: 'All pass',
    tone:     'settled',
    detail:   'Every declared check was judged and passed.',
    exit:     null,   // 出口が無いのが正しい唯一の種 — 何もしなくてよい
  }),
  [CHECKS_KIND.FAILING]: Object.freeze({
    headline: 'Not clear',
    tone:     'caution',
    detail:   'Some declared checks did not pass.',
    exit:     'Open the floor → Checks.',
  }),
})

/**
 * 発見の集約の宣言を引く。**未宣言の種で throw** する。
 * @param {{kind:string}} summary
 */
export function discoveryDeclaration(summary) {
  const decl = DISCOVERY_DECLARATION[summary?.kind]
  if (!decl) {
    throw new Error(
      `discoveryDeclaration: 未宣言の種 "${summary?.kind}"。種を足したなら ` +
      'DISCOVERY_DECLARATION にも行を足すこと — fall-through は「宣言された既定」と ' +
      '「誰も考えなかった種」を区別不能にする (原則 #31)。',
    )
  }
  return decl
}

/**
 * 共有 KPI の集約の宣言を引く。**未宣言の種で throw** する。
 * @param {{kind:string}} summary
 */
export function checksDeclaration(summary) {
  const decl = CHECKS_DECLARATION[summary?.kind]
  if (!decl) {
    throw new Error(
      `checksDeclaration: 未宣言の種 "${summary?.kind}"。CHECKS_DECLARATION に行を足すこと (原則 #31)。`,
    )
  }
  return decl
}

/** 宣言表が覆っている種 (検査が母集団として引く)。 */
export const DECLARED_DISCOVERY_KINDS = Object.freeze(Object.keys(DISCOVERY_DECLARATION))
/** 宣言表が覆っている種 (検査が母集団として引く)。 */
export const DECLARED_CHECKS_KINDS = Object.freeze(Object.keys(CHECKS_DECLARATION))
