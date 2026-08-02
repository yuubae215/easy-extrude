/**
 * OwnershipProposalCensus.test.js — 所有権・提案・証憑の個数を機械に問わせる
 * (ADR-104 / 原則 #31)
 *
 * ## この検査が答える問い
 *
 * ADR-104 が置いた規律は 4 つとも「**在るもの**を読んでも見えない」形をしている:
 *
 *   1. `stale` は**状態として存在しない**。存在しないものは検査対象のノードを
 *      持たないので、実装を読んでも「無いこと」は確認できない。数えるしかない。
 *   2. 承認は主張更新と証憑追記を**分離できない**。分離した実装は落ちるのではなく
 *      *それらしく動く* — 証憑は「合意した」と言い、R6 は「まだ衝突している」と
 *      言う文書が出来上がるだけで、どちらのテストも緑になる。
 *   3. 所有者の **0 が 2 種類ある**。宣言済みの 0 と未宣言の 0 は、値としては
 *      どちらも「owner が無い」に見える。区別は型で持つしかない。
 *   4. 「当事者が 1 人だった時期の決定」は**正しい**が、正しさが文脈に依存する。
 *      文脈は保存しないと後から導出できない (D4)。
 *
 * どれも「規則を持つ経路」ではなく「**規則を持たない経路**」が欠陥になる形なので
 * (ADR-097 の pose、ADR-099 の選択と同型)、母集団を導出して未分類の個数を問う。
 *
 * ## 限界 (宣言しておく)
 *
 * 鍵はクライアント側の誤操作防止であって認証ではない (ADR-104 D6)。焼き込んだ
 * 基数も自己申告であり、この検査が数えるのは「**申告が残っているか**」であって
 * 「申告が真か」ではない。証明が要る要件が立ったらサーバ側 (BFF / `core`) の
 * 責務として別 ADR を起こす — フロントは宣言と表示のみ。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { collectSources, relPath, repoPath, stripComments } from './census/sources.js'
import { assertCoversPopulation, assertDeclarationsExist } from './census/partition.js'

import {
  EDIT_PERMISSION, TARGET_KIND, OWNER_NONE_DECLARED,
  editPermission, ownerOf, undeclaredOwners, readClaim, declareOwner,
} from './context/Ownership.js'
import {
  PROPOSAL_STATE, makeProposal, addProposal, approveProposal, withdrawProposal,
  unapproveProposal, findProposal, approvalGuards, isStale,
} from './context/Proposal.js'
import {
  AGENDA_STATE, tableConflict, settleAgendaItem, closeAgendaItemUndecided,
} from './context/Agenda.js'
import { emptyKeyring, keyringOf, keyCardinality } from './context/Keyring.js'
import { validateContext } from './context/ContextValidator.js'

// ── 母集団の種 ────────────────────────────────────────────────────────────────

/** 提案 1 本ぶんの最小文書。基数 1 の世界で規則を焼くための種。 */
const seedDoc = () => ({
  version: 'context/0.5',
  actors: [{ ref: 'vision', role: 'developer' }, { ref: 'mech', role: 'developer' }],
  variables: [{ ref: 'v_wd', unit: 'mm', domain: [0, 2000] }],
  requirements: [{
    ref: 'r_wd', by: 'vision', owner: 'vision', constrains: ['v_wd'],
    kpi: { name: 'reach', expr: 'v_wd', unit: 'mm' }, criterion: { op: '>=', value: 10 },
    admissible: { interval: [200, 350], source: 'stated' },
  }],
})

const target = { kind: TARGET_KIND.REQUIREMENT_ADMISSIBLE, ref: 'r_wd' }

const seedProposal = (over = {}) => makeProposal({
  ref: 'prop_1', by: 'mech', target,
  from: { interval: [200, 350], source: 'stated' },
  to:   { interval: [300, 450], source: 'stated' },
  rationale: 'レンズ f=16→25mm でワーキングディスタンスが伸びる',
  ...over,
})

// ── 1. 退役していない形 = 保存してはいけない導出値 (shape-census) ──────────────

/**
 * **保存が禁じられている導出値の形** (ADR-104 D4 / U2)。
 *
 * ADR-100 の `RETIRED_SELECTION_COLORS` と同形だが、こちらは「退役した形」では
 * なく「**最初から作らないと決めた形**」を数える。理由は同じ — 保存された導出値は
 * 違反を*見逃す*のではなく **緑を出す**。書いた瞬間は正しい値が入るので、ずれるのは
 * 誰かが別経路で主張を動かした後であり、そのときテストは何も言わない。
 */
const FORBIDDEN_STORAGE_SHAPES = [
  { pattern: /\bstale\s*:/,          was: '提案の陳腐化を保存する欄 (`from === 現在値` で毎回導出する — U2)' },
  { pattern: /\.stale\s*=/,          was: '同上 (代入形)' },
  { pattern: /\bisStale\s*:/,        was: '同上 (述語の結果を欄に固める形)' },
  { pattern: /\bstoredConflicts\b/,  was: '衝突の保存 (R6 が毎回導出する — D4)' },
  { pattern: /\bconflictCache\b/,    was: '同上 (キャッシュも閉路の辺 — 原則 #24)' },
]

test('保存が禁じられた導出値の形は src/** に 0 個 (ADR-104 D4 / U2)', () => {
  const hits = []
  for (const abs of collectSources()) {
    const lines = stripComments(readFileSync(abs, 'utf8'))
    lines.forEach((line, i) => {
      for (const rule of FORBIDDEN_STORAGE_SHAPES) {
        if (rule.pattern.test(line)) hits.push(`  ${relPath(abs)}:${i + 1}  ${rule.was}\n      ${line.trim()}`)
      }
    })
  }
  assert.deepEqual(hits, [],
    `\n導出できる事実が保存されている:\n${hits.join('\n')}\n\n` +
    '  導出値は保存しない。人の行為は保存する (ADR-104 D4)。\n' +
    '  保存された導出値は「違反」としてではなく「古い正解」として振る舞うので、\n' +
    '  検査は緑を出し続ける — だから *在るもの* ではなく **無いはずの形の個数**を数える。\n')
})

// ── 2. 状態遷移の母集団 = 全ペア (derived-partition) ──────────────────────────

/**
 * **合法な提案の遷移** — 母集団は enum から導出した 3×3 の全ペアで、
 * 表はその分割の宣言。`docs/STATE_TRANSITIONS.md` §提案 の図と 1:1。
 *
 * 「終端から戻れない」は *書かなかったこと*で表現されているので、実装を読んでも
 * 見えない。全ペアを実際に通し、通ったものと拒否されたものを数える。
 */
const LEGAL_PROPOSAL_TRANSITIONS = [
  `${PROPOSAL_STATE.PROPOSED}→${PROPOSAL_STATE.APPROVED}`,
  `${PROPOSAL_STATE.PROPOSED}→${PROPOSAL_STATE.WITHDRAWN}`,
]

test('提案の遷移は宣言された 2 本だけ — 終端からの復帰は表現不能 (ADR-104 D3)', () => {
  const states = Object.values(PROPOSAL_STATE)
  const population = []
  const passed = []

  for (const from of states) {
    for (const to of states) {
      if (from === to) continue
      population.push(`${from}→${to}`)

      // その `from` 状態の文書を作る (undo 用の復元経路は使わず、正規の道で運ぶ)
      let doc = addProposal(seedDoc(), seedProposal())
      if (from === PROPOSAL_STATE.APPROVED) {
        doc = approveProposal(doc, 'prop_1', { decidedBy: ['vision'], keyCardinality: 1 })
      } else if (from === PROPOSAL_STATE.WITHDRAWN) {
        doc = withdrawProposal(doc, 'prop_1')
      }

      try {
        if (to === PROPOSAL_STATE.APPROVED) {
          approveProposal(doc, 'prop_1', { decidedBy: ['vision'], keyCardinality: 1 })
        } else if (to === PROPOSAL_STATE.WITHDRAWN) {
          withdrawProposal(doc, 'prop_1')
        } else {
          // proposed へ「戻す」正規の道は存在しない。存在しないことがこの検査。
          continue
        }
        passed.push(`${from}→${to}`)
      } catch { /* 拒否された = 期待どおり */ }
    }
  }

  assertCoversPopulation({
    what: '提案の状態遷移',
    population,
    declared: LEGAL_PROPOSAL_TRANSITIONS,
    excluded: population.filter(p => !LEGAL_PROPOSAL_TRANSITIONS.includes(p))
      .map(key => ({ key, why: '終端からの復帰、または正規の入口を持たない遷移 (再度動かしたいときは新しい提案 — ADR-104 D3 / U3)' })),
    howDerived: 'PROPOSAL_STATE の全ペア (from ≠ to)',
    onNew: '状態を足したなら docs/STATE_TRANSITIONS.md §提案 の図と PROPOSAL_TRANSITIONS を同じコミットで更新すること',
  })

  assert.deepEqual(passed.sort(), [...LEGAL_PROPOSAL_TRANSITIONS].sort(),
    '実際に通った遷移が宣言と一致しない — 図とコードのどちらかが古い')
})

/** **合法な議題の遷移** — 同じ形を議題側にも当てる (`§議題` の図と 1:1)。 */
const LEGAL_AGENDA_TRANSITIONS = [
  `${AGENDA_STATE.OPEN}→${AGENDA_STATE.SETTLED}`,
  `${AGENDA_STATE.OPEN}→${AGENDA_STATE.CLOSED_UNDECIDED}`,
]

test('議題の遷移は宣言された 2 本だけ — 再燃は新しい議題 (ADR-104 U3)', () => {
  const states = Object.values(AGENDA_STATE)
  const population = []
  const passed = []

  for (const from of states) {
    for (const to of states) {
      if (from === to) continue
      population.push(`${from}→${to}`)

      let doc = tableConflict(seedDoc(), 'ag_1', 'conflict_v_wd', 'mech')
      if (from === AGENDA_STATE.SETTLED) {
        doc = settleAgendaItem(doc, 'ag_1', { decidedBy: ['vision'], keyCardinality: 1 })
      } else if (from === AGENDA_STATE.CLOSED_UNDECIDED) {
        doc = closeAgendaItemUndecided(doc, 'ag_1', { by: 'mech' })
      }

      try {
        if (to === AGENDA_STATE.SETTLED) {
          settleAgendaItem(doc, 'ag_1', { decidedBy: ['vision'], keyCardinality: 1 })
        } else if (to === AGENDA_STATE.CLOSED_UNDECIDED) {
          closeAgendaItemUndecided(doc, 'ag_1', { by: 'mech' })
        } else {
          continue
        }
        passed.push(`${from}→${to}`)
      } catch { /* 拒否された = 期待どおり */ }
    }
  }

  assertCoversPopulation({
    what: '議題の状態遷移',
    population,
    declared: LEGAL_AGENDA_TRANSITIONS,
    excluded: population.filter(p => !LEGAL_AGENDA_TRANSITIONS.includes(p))
      .map(key => ({ key, why: '終端からの復帰。再燃は supersedes を持つ新規行として起こす (ADR-104 U3)' })),
    howDerived: 'AGENDA_STATE の全ペア (from ≠ to)',
    onNew: '状態を足したなら docs/STATE_TRANSITIONS.md §議題 の図と AGENDA_TRANSITIONS を同じコミットで更新すること',
  })

  assert.deepEqual(passed.sort(), [...LEGAL_AGENDA_TRANSITIONS].sort(),
    '実際に通った遷移が宣言と一致しない — 図とコードのどちらかが古い')
})

// ── 3. 権限 3 状態の母集団 = 「鍵 × 所有者」の全組合せ (derived-partition) ────

/**
 * **権限の全事例** — 母集団は「所有者の 3 種 (未宣言 / 宣言済みの 0 / 実在) ×
 * 鍵の 3 種 (0 個 / 別人 / 本人)」から導出し、表はその分割の宣言。
 *
 * 手で「この場合はこう」を並べると、**誰も考えなかった組合せ**が表の外に残る —
 * それが原則 #31 の欠陥そのものなので、組合せは機械に作らせる。
 */
const PERMISSION_BY_CASE = {
  'owner=未宣言, keys=0':      EDIT_PERMISSION.PROPOSE_ONLY,
  'owner=未宣言, keys=別人':    EDIT_PERMISSION.PROPOSE_ONLY,
  'owner=未宣言, keys=本人':    EDIT_PERMISSION.PROPOSE_ONLY,
  'owner=宣言済み0, keys=0':    EDIT_PERMISSION.DIRECT,
  'owner=宣言済み0, keys=別人':  EDIT_PERMISSION.DIRECT,
  'owner=宣言済み0, keys=本人':  EDIT_PERMISSION.DIRECT,
  'owner=実在, keys=0':         EDIT_PERMISSION.PROPOSE_ONLY,
  'owner=実在, keys=別人':      EDIT_PERMISSION.PROPOSE_ONLY,
  'owner=実在, keys=本人':      EDIT_PERMISSION.DIRECT,
}

test('権限は「鍵 × 所有者」の全 9 通りが宣言されている — 既定値で埋めない (ADR-104 D2/D3)', () => {
  const owners = {
    '未宣言':     null,
    '宣言済み0':  OWNER_NONE_DECLARED,
    '実在':       'vision',
  }
  const keyrings = {
    '0':    emptyKeyring(),
    '別人':  keyringOf(['mech']),
    '本人':  keyringOf(['vision']),
  }

  const population = []
  const observed = {}
  for (const [ownerName, owner] of Object.entries(owners)) {
    const doc = declareOwner(seedDoc(), 'r_wd', owner)
    for (const [keyName, keyring] of Object.entries(keyrings)) {
      const key = `owner=${ownerName}, keys=${keyName}`
      population.push(key)
      const { permission, reason } = editPermission(keyring, doc, target)
      observed[key] = permission
      assert.ok(reason?.trim(),
        `${key}: 判定は返ったが理由が空 — 無効フラグとその理由は同じ述語の返り値から来る (原則 #11)`)
    }
  }

  assertCoversPopulation({
    what: '権限の判定事例',
    population,
    declared: Object.keys(PERMISSION_BY_CASE),
    howDerived: '所有者 3 種 × 鍵 3 種 の直積',
    onNew: 'PERMISSION_BY_CASE に期待値を宣言すること。「たぶんこうだろう」で既定に落とすと、'
         + '「全員書ける」か「誰も書けない」のどちらかが黙って既定になる (ADR-104 D1)',
  })
  assert.deepEqual(observed, PERMISSION_BY_CASE)
})

test('READ_ONLY には実在の住人がいる — 3 状態目が理論上の存在にならない', () => {
  // 状態を型で持っても、その値を返す経路が無ければ「2 値 + 死んだ枝」になる。
  const { permission } = editPermission(emptyKeyring(), seedDoc(), { kind: TARGET_KIND.CONFLICT, ref: 'conflict_v_wd' })
  assert.equal(permission, EDIT_PERMISSION.READ_ONLY)
  assert.equal(new Set(Object.values(PERMISSION_BY_CASE)).size, 2,
    '書ける claim の側は 2 値。3 つ目 (READ_ONLY) は導出値のためにある — '
    + 'この非対称が崩れたら EDIT_PERMISSION の分割を見直すこと')
})

test('未宣言の種は throw する — fall-through は「決定の不在」を隠す (原則 #31)', () => {
  assert.throws(() => editPermission(emptyKeyring(), seedDoc(), { kind: 'requirement.colour', ref: 'r_wd' }),
    /undeclared target kind/)
  assert.throws(() => readClaim(seedDoc(), { kind: 'requirement.colour', ref: 'r_wd' }),
    /undeclared target kind/)
  assert.throws(() => ownerOf(seedDoc(), { kind: 'requirement.colour', ref: 'r_wd' }),
    /undeclared target kind/)
})

// ── 4. 承認の不可分性 (ADR-104 U1) ────────────────────────────────────────────

test('承認は主張・状態・証憑を 1 つの文書で動かす — 分けた状態は書けない (U1)', () => {
  const doc = addProposal(seedDoc(), seedProposal())
  const after = approveProposal(doc, 'prop_1', { decidedBy: ['vision'], keyCardinality: 2 })

  assert.deepEqual(after.requirements[0].admissible, { interval: [300, 450], source: 'stated' },
    '主張が希望値へ動いていない')
  assert.equal(findProposal(after, 'prop_1').state, PROPOSAL_STATE.APPROVED)
  const receipt = after.decisions.find(d => d.resolves === 'prop_1')
  assert.ok(receipt, '証憑が追記されていない')
  assert.equal(receipt.rationale, doc.proposals[0].rationale, '理由がそのまま証憑へ渡っていない')

  // 元の文書は変わらない (PHILOSOPHY #6) — undo が自然に成立する前提
  assert.equal(doc.requirements[0].admissible.interval[0], 200)
})

test('「証憑だけ残して主張を戻す」形は validator が拒否する (U1 の逆向き)', () => {
  const doc = addProposal(seedDoc(), seedProposal())
  const approved = approveProposal(doc, 'prop_1', { decidedBy: ['vision'], keyCardinality: 2 })

  // 手で引き剥がす — 証憑は残し、主張と提案状態だけ戻す
  const torn = {
    ...approved,
    requirements: doc.requirements,
    proposals: doc.proposals,
  }
  const result = validateContext(torn)
  assert.ok(result.errors.some(e => /resolves proposal "prop_1", which is "proposed"/.test(e)),
    `引き剥がした文書が通ってしまう — 実際のエラー: ${JSON.stringify(result.errors)}`)
})

test('undo も 3 つまとめて巻き戻す — 片方だけ戻る経路が無い (U1)', () => {
  const doc = addProposal(seedDoc(), seedProposal())
  const approved = approveProposal(doc, 'prop_1', { decidedBy: ['vision'], keyCardinality: 2 })
  const undone = unapproveProposal(approved, 'prop_1')

  assert.deepEqual(undone.requirements[0].admissible, doc.requirements[0].admissible)
  assert.equal(findProposal(undone, 'prop_1').state, PROPOSAL_STATE.PROPOSED)
  assert.equal((undone.decisions ?? []).filter(d => d.resolves === 'prop_1').length, 0)
  assert.equal(findProposal(undone, 'prop_1').decidedBy, undefined,
    '署名が残ったまま proposed に戻ると、次の承認が古い署名を引き継ぐ')
})

// ── 5. 楽観ロック — 同じ要求を 2 回通す (ADR-104 U2 / ADR-101 の教訓) ─────────

test('承認の guard は「同じ要求を 2 回」で焼く — 1 回では 1 フレーム古い読みが隠れる (U2)', () => {
  // ADR-098 の e2e が緑のまま振動を出荷したのと同じ穴を避ける形。1 手順では
  // 「approve が通った」しか見えず、*その間に主張が動いた* 場合を通らない。
  const keys = keyringOf(['vision'])
  const doc = addProposal(seedDoc(), seedProposal())

  // 1 手目: 通る
  assert.equal(approvalGuards(doc, findProposal(doc, 'prop_1'), keys).ok, true)

  // 2 手目: 別経路で主張が動く (別の提案が承認された、直接編集された、など)
  const moved = {
    ...doc,
    requirements: [{ ...doc.requirements[0], admissible: { interval: [250, 400], source: 'stated' } }],
  }

  // 3 手目: 同じ要求をもう一度通す — 今度は拒否され、理由が出る
  const guards = approvalGuards(moved, findProposal(moved, 'prop_1'), keys)
  assert.equal(guards.ok, false)
  assert.ok(guards.reasons.some(r => /has moved since this proposal was written/.test(r)),
    `拒否理由が出ていない: ${JSON.stringify(guards.reasons)}`)
  assert.equal(isStale(moved, findProposal(moved, 'prop_1')), true)

  // guard に落ちても状態は変わらない (`stale` という 4 つ目を作らない — U2)
  assert.equal(findProposal(moved, 'prop_1').state, PROPOSAL_STATE.PROPOSED)
})

test('同一変数への提案は併存する — 後勝ちで上書きしない (U2)', () => {
  let doc = addProposal(seedDoc(), seedProposal())
  doc = addProposal(doc, seedProposal({ ref: 'prop_2', by: 'vision', to: { interval: [220, 360], source: 'stated' } }))
  assert.equal(doc.proposals.length, 2)

  // 片方を承認すると、もう片方は「残るが承認できない」— 消さずに理由で止める
  const approved = approveProposal(doc, 'prop_1', { decidedBy: ['vision'], keyCardinality: 1 })
  assert.equal(approved.proposals.length, 2)
  const second = approvalGuards(approved, findProposal(approved, 'prop_2'), keyringOf(['vision']))
  assert.equal(second.ok, false)
  assert.ok(second.reasons.some(r => /has moved since/.test(r)))
})

// ── 6. 差分と理由の無い提案は作れない (D3) ────────────────────────────────────

test('差分の無い提案・理由の無い提案は構築できない (D3)', () => {
  assert.throws(() => seedProposal({ to: { interval: [200, 350], source: 'stated' } }), /must carry a diff/)
  assert.throws(() => seedProposal({ rationale: '   ' }), /must carry a rationale/)
})

// ── 7. 署名の宣言 (ADR-104 U4) ────────────────────────────────────────────────

test('署名は鍵集合の部分集合 — 持っていない鍵で決めた形は書けない (U4)', () => {
  const doc = addProposal(seedDoc(), seedProposal())
  assert.throws(() => approveProposal(doc, 'prop_1', { decidedBy: [], keyCardinality: 0 }),
    /needs at least one held key/)
  const approved = approveProposal(doc, 'prop_1', { decidedBy: ['vision'], keyCardinality: 1 })
  assert.equal(approved.decisions.at(-1).keyCardinalityAtDecision, 1)
})

/**
 * **当事者が 1 人だった時期の決定** の予算 (ADR-100 の ratchet と同形)。
 *
 * 止めるための数ではない — 単独決定で証憑が増えないのは**正しい姿** (D5) であり、
 * その正しさは「そのとき当事者が 1 人だった」という文脈に依存する。隠さず数える。
 */
const LONE_PARTY_DECISION_BUDGET = 0

test('同梱例の「当事者 1 人」決定は予算どおり (ADR-104 U4 の ratchet)', () => {
  const docs = ['cell_conflict_context.json', 'cell_phase2_context.json',
    'cell_region_context.json', 'cell_robotics_context.json', 'factory_context.json']
  let lone = 0
  for (const f of docs) {
    const doc = JSON.parse(readFileSync(repoPath(`examples/${f}`), 'utf8'))
    for (const d of doc.decisions ?? []) {
      if (d.keyCardinalityAtDecision === 1) lone++
    }
  }
  assert.equal(lone, LONE_PARTY_DECISION_BUDGET,
    `当事者 1 人での決定が ${lone} 件 (予算 ${LONE_PARTY_DECISION_BUDGET})。` +
    '増えたなら予算を上げて意図を書く。減ったなら予算を下げる — ratchet が回らない予算は空回りする。')
})

/**
 * **未宣言の所有者**の予算 (ADR-100 の ratchet と同形)。
 *
 * 「宣言外は 0 であるべきだが今は N ある」を隠さず定数にする。同梱例は 0.2〜0.4 の
 * 文書で、所有権の語彙より前に書かれている — その負債を 0 に見せかけず、
 * **上回っても下回っても落ちる**形で持つ。
 */
const UNDECLARED_OWNER_BUDGET = 12

test('同梱例の未宣言所有者は予算どおり — 正当な 0 は宣言、未宣言は個数 (ADR-104 D2)', () => {
  const docs = ['cell_conflict_context.json', 'cell_phase2_context.json',
    'cell_region_context.json', 'cell_robotics_context.json', 'factory_context.json']
  let undeclared = 0
  for (const f of docs) {
    const doc = JSON.parse(readFileSync(repoPath(`examples/${f}`), 'utf8'))
    undeclared += undeclaredOwners(doc).length
  }
  assert.equal(undeclared, UNDECLARED_OWNER_BUDGET,
    `未宣言の所有者が ${undeclared} 件 (予算 ${UNDECLARED_OWNER_BUDGET})。\n` +
    '  宣言すれば減る。減ったら予算も同じコミットで下げること — 下がらない予算は\n' +
    '  「守られている」と「対象が消えた」を区別できない (原則 #31 の同型)。')
})

test('R10 は未宣言の所有者を 1 件 1 問として出す — 0 は黙って埋めない', () => {
  const doc = declareOwner(seedDoc(), 'r_wd', null)
  const result = validateContext(doc)
  const owners = result.openQuestions.filter(q => q.raisedBy === 'R10:undeclared-owner')
  assert.equal(owners.length, 1)
  assert.equal(owners[0].about, 'r_wd')

  // 宣言済みの 0 は問われない — 「本当にいない」は答えであって欠落ではない
  const declared = declareOwner(seedDoc(), 'r_wd', OWNER_NONE_DECLARED)
  assert.equal(validateContext(declared).openQuestions.filter(q => q.raisedBy === 'R10:undeclared-owner').length, 0)
})

// ── 8. 鍵の基数 (ADR-104 D1) ─────────────────────────────────────────────────

test('鍵の基数 0 / 1 / N はすべて正当で、0 は既定で埋まらない (D1)', () => {
  assert.equal(keyCardinality(emptyKeyring()), 0)
  assert.equal(keyCardinality(keyringOf(['vision'])), 1)
  assert.equal(keyCardinality(keyringOf(['vision', 'mech'])), 2, '兼務は正当 — 警告しない')

  // 鍵 0 で「全部書ける」にも「何も書けない」にもならないこと (D1 の核心)
  const doc = seedDoc()
  const { permission } = editPermission(emptyKeyring(), doc, target)
  assert.equal(permission, EDIT_PERMISSION.PROPOSE_ONLY)
})

// ── 9. 宣言の実在 (declared-exception) ────────────────────────────────────────

/**
 * ADR-104 が「作らない」と決めた語彙。**語彙に無いことが検査**なので、
 * 逆向き (宣言した形が実在するか) ではなく *不在* を問う点で他と非対称 —
 * だから前半 (FORBIDDEN_STORAGE_SHAPES) が個数を数え、ここは enum の中身を問う。
 */
const RETIRED_VOCABULARY = [
  { key: 'stale',    why: '提案の 4 つ目の状態。古びているかは毎回 from === 現在値 で導出する (U2)' },
  { key: 'expired',  why: '同上の別名' },
  { key: 'reopened', why: '議題の復帰状態。再燃は supersedes を持つ新しい議題 (U3)' },
]

test('退役した語彙は enum に存在しない — 緑を出す腐敗を止める (ADR-103 と同形)', () => {
  const live = [...Object.values(PROPOSAL_STATE), ...Object.values(AGENDA_STATE)]
  assertDeclarationsExist({
    what: 'ADR-104 が作らないと決めた状態語',
    declarations: RETIRED_VOCABULARY,
    // 「実在する」= *状態語として存在しない* こと。他の宣言と向きが逆なのは、
    // ここで宣言しているのが「在るもの」ではなく「作らないと決めたもの」だから。
    exists: name => !live.includes(name),
    onStale: 'その語が状態として復活している。導出できる事実を状態にすると、'
           + '「古い提案」と「まだ有効な提案」を*保存された値*で区別することになる (ADR-104 U2 / D4)',
  })
})
