/**
 * ProposalCommands.test.js — ADR-104 Phase 4 の縫い目 (service + command)。
 *
 * 純粋層の規律は `src/OwnershipProposalCensus.test.js` が個数で焼いている。
 * ここで問うのはその**外側**、つまり「文書の唯一の書き手を通ったか」:
 *
 *   - 承認は 1 コマンドで主張・状態・証憑を動かし、undo が 3 つとも巻き戻すか
 *   - 署名を service が作り、guard に落ちたら `null` を返して**コマンドが
 *     組み立てられない**か (原則 #1 — 入口を迂回して承認できない)
 *   - 「鍵ゼロで他人のものを触る → 提案」「鍵を全部持つ → 単独決定、証憑は
 *     増えない」という ADR-104 Phase 4 の完了条件そのもの
 *
 * THREE-free — importFromJson はモック。
 *
 * Run with:  pnpm test:context
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { ContextService } from '../service/ContextService.js'
import { createProposeChangeCommand } from './ProposeChangeCommand.js'
import { createApproveProposalCommand } from './ApproveProposalCommand.js'
import { createWithdrawProposalCommand } from './WithdrawProposalCommand.js'
import { createTableConflictCommand } from './TableConflictCommand.js'
import { createSettleAgendaCommand, createCloseUndecidedCommand } from './CloseAgendaCommand.js'
import { makeProposal, PROPOSAL_STATE } from '../context/Proposal.js'
import { AGENDA_STATE, AGENDA_SOURCE } from '../context/Agenda.js'
import { TARGET_KIND, EDIT_PERMISSION, OWNER_NONE_DECLARED } from '../context/Ownership.js'
import { keyringOf, emptyKeyring } from '../context/Keyring.js'

const VC = { camera: null, renderer: null, container: null }

function fakeScene() {
  const calls = []
  return {
    calls,
    async importFromJson(scene, vc, opts) {
      calls.push({ scene, vc, opts })
      return { imported: 0, skipped: 0 }
    },
  }
}

/**
 * 同梱の衝突シナリオ (ADR-049) を 0.5 へ上げ、所有者を宣言した文書。
 *
 * 手書きの最小文書にしないのは、KPI が閉形式だと stated→derived 昇格が働いて
 * 区間が動き、R6 が衝突を出さなくなるため — 検査の前提が実装の都合で崩れる。
 * 実在のフィクスチャを使えば「衝突が在る」ことは他のスイートが既に保証している。
 * 所有者は `by` から**明示的に写す** (validator は写さない — 由来は権限ではない)。
 */
const here = dirname(fileURLToPath(import.meta.url))
const doc = () => {
  const base = JSON.parse(readFileSync(join(here, '../../examples/cell_conflict_context.json'), 'utf8'))
  return {
    ...base,
    version: 'context/0.5',
    requirements: base.requirements.map(r => ({ ...r, owner: r.by })),
  }
}

const camTarget = { kind: TARGET_KIND.REQUIREMENT_ADMISSIBLE, ref: 'r_cam_resolution' }

const proposal = () => makeProposal({
  ref: 'prop_wd', by: 'robot_engineer', target: camTarget,
  from: { interval: [200, 350], source: 'stated' },
  to:   { interval: [220, 380], source: 'stated' },
  // 区間は robot 側 ([500,900]) と重ならないままにしてある。承認で衝突が
  // *消える* と、その衝突を resolves している既存 Decision が孤児になり
  // compileContext が投げる (ADR-049 invariant 7) — それは既存の正しい振る舞い
  // なので、ここでは踏まない差分を選ぶ。
  rationale: 'レンズ f=16→25mm で WD を少し伸ばしても 10px/mm を確保できる',
})

async function loaded() {
  const svc = new ContextService(fakeScene())
  await svc.loadContext(doc(), VC)
  return svc
}

// ── 完了条件 1: 鍵ゼロで他人のものを触ると提案になる ─────────────────────────

test('鍵ゼロ: 他人の主張は PROPOSE_ONLY で、理由が一緒に返る (ADR-104 D1/D3)', async () => {
  const svc = await loaded()
  const { permission, reason } = svc.editPermission(emptyKeyring(), camTarget)
  assert.equal(permission, EDIT_PERMISSION.PROPOSE_ONLY)
  assert.match(reason, /you hold no keys/)
})

test('提案は誰の鍵も要らず、主張を動かさない (D3)', async () => {
  const svc = await loaded()
  const cmd = createProposeChangeCommand(svc, proposal(), VC)
  await cmd.execute()

  assert.equal(svc.getDoc().proposals.length, 1)
  assert.deepEqual(svc.getDoc().requirements.find(r => r.ref === 'r_cam_resolution').admissible.interval, [200, 350],
    '提案は主張を動かしてはいけない — 動かすなら承認が要らなくなる')
  // 場に上がっている (議題 = 議題化された衝突 ∪ 提案)
  const rows = svc.projectAgenda()
  assert.equal(rows.filter(r => r.source === AGENDA_SOURCE.PROPOSAL).length, 1)
})

test('提案の undo は取り下げではなく削除 — 履歴の巻き戻しは記録を残さない', async () => {
  const svc = await loaded()
  const cmd = createProposeChangeCommand(svc, proposal(), VC)
  await cmd.execute()
  await cmd.undo()
  assert.equal(svc.getDoc().proposals.length, 0)
})

test('取り下げは記録に残る — 人の行為は保存する (D4)', async () => {
  const svc = await loaded()
  await createProposeChangeCommand(svc, proposal(), VC).execute()
  await createWithdrawProposalCommand(svc, 'prop_wd', VC).execute()

  const p = svc.getDoc().proposals[0]
  assert.equal(p.state, PROPOSAL_STATE.WITHDRAWN)
  // 場からは消えるが、文書には在る
  assert.equal(svc.projectAgenda().filter(r => r.ref === 'prop_wd').length, 0)
})

// ── 完了条件 2: 証憑が読める形で残る ──────────────────────────────────────────

test('承認は主張・状態・証憑を 1 コマンドで動かす (U1)', async () => {
  const svc = await loaded()
  await createProposeChangeCommand(svc, proposal(), VC).execute()

  const signature = svc.signatureForProposal('prop_wd', keyringOf(['vision_engineer']))
  assert.deepEqual(signature, { decidedBy: ['vision_engineer'], keyCardinality: 1 })

  const cmd = createApproveProposalCommand(svc, 'prop_wd', signature, VC)
  await cmd.execute()

  const after = svc.getDoc()
  assert.deepEqual(after.requirements.find(r => r.ref === 'r_cam_resolution').admissible.interval, [220, 380])
  assert.equal(after.proposals[0].state, PROPOSAL_STATE.APPROVED)
  const receipt = after.decisions.find(d => d.resolves === 'prop_wd')
  assert.ok(receipt, '証憑が無い')
  assert.equal(receipt.rationale, proposal().rationale)
  assert.equal(receipt.keyCardinalityAtDecision, 1, '決定時点の鍵の基数が焼かれていない (U4)')

  // 承認は主張を動かす = 幾何が変わりうるので再生成する
  assert.ok(svc.getValidatorResult().valid !== undefined)
})

test('承認の undo は 3 つまとめて戻る (U1 の逆向き)', async () => {
  const svc = await loaded()
  await createProposeChangeCommand(svc, proposal(), VC).execute()
  const signature = svc.signatureForProposal('prop_wd', keyringOf(['vision_engineer']))
  const cmd = createApproveProposalCommand(svc, 'prop_wd', signature, VC)
  await cmd.execute()
  await cmd.undo()

  const after = svc.getDoc()
  assert.deepEqual(after.requirements.find(r => r.ref === 'r_cam_resolution').admissible.interval, [200, 350])
  assert.equal(after.proposals[0].state, PROPOSAL_STATE.PROPOSED)
  assert.equal(after.decisions?.filter(d => d.resolves === 'prop_wd').length ?? 0, 0)
})

// ── 入口の唯一性 (原則 #1) ────────────────────────────────────────────────────

test('guard に落ちた承認は署名が作られず、コマンドが組み立てられない (原則 #1/#11)', async () => {
  const svc = await loaded()
  await createProposeChangeCommand(svc, proposal(), VC).execute()

  // 所有者 (vision_engineer) の鍵を持っていない
  const keys = keyringOf(['robot_engineer'])
  assert.equal(svc.signatureForProposal('prop_wd', keys), null)

  const { ok, reasons } = svc.approvalGuards('prop_wd', keys)
  assert.equal(ok, false)
  assert.ok(reasons.some(r => /Only a holder of "vision_engineer"'s key/.test(r)),
    `理由が出ていない: ${JSON.stringify(reasons)}`)

  // 署名を迂回してコマンドを作ることもできない
  assert.throws(() => createApproveProposalCommand(svc, 'prop_wd', null, VC),
    /refusing to build an approval/)
})

test('楽観ロック: 承認までに主張が動いていたら拒否され、提案は残る (U2)', async () => {
  const svc = await loaded()
  await createProposeChangeCommand(svc, proposal(), VC).execute()

  // 所有者が自分で直接編集した (鍵を持つので DIRECT)
  await svc.applyAdmissible('r_cam_resolution', { interval: [210, 360] }, VC)

  const keys = keyringOf(['vision_engineer'])
  assert.equal(svc.signatureForProposal('prop_wd', keys), null)
  assert.ok(svc.approvalGuards('prop_wd', keys).reasons.some(r => /has moved since/.test(r)))
  // 4 つ目の状態は作らない — 提案は提案のまま
  assert.equal(svc.getDoc().proposals[0].state, PROPOSAL_STATE.PROPOSED)
})

// ── 完了条件 3: 鍵を全部持つと単独決定になり、証憑は増えない (D5) ─────────────

test('鍵を全部持つと直接編集になり、証憑は 1 件も増えない (D5)', async () => {
  const svc = await loaded()
  const all = keyringOf(['vision_engineer', 'robot_engineer'])

  assert.equal(svc.editPermission(all, camTarget).permission, EDIT_PERMISSION.DIRECT)
  assert.equal(svc.editPermission(all, { kind: TARGET_KIND.REQUIREMENT_ADMISSIBLE, ref: 'r_wrist_singularity' }).permission,
    EDIT_PERMISSION.DIRECT)

  const before = (svc.getDoc().decisions ?? []).length
  await svc.applyAdmissible('r_cam_resolution', { interval: [220, 380] }, VC)
  assert.equal((svc.getDoc().decisions ?? []).length, before,
    '単独決定で証憑が増えないのは欠落ではなく正しい姿 (ADR-104 D5) — '
    + '通常の編集は CommandStack が扱い、文書には残らない')
  assert.equal((svc.getDoc().proposals ?? []).length, 0, '提案も生まれない')
})

test('所有者なしと宣言された主張は誰でも直接編集できる — 宣言済みの 0 (D2)', async () => {
  const svc = await loaded()
  await svc.declareOwner('r_cam_resolution', OWNER_NONE_DECLARED, VC)
  assert.equal(svc.editPermission(emptyKeyring(), camTarget).permission, EDIT_PERMISSION.DIRECT)
})

// ── 議題 (ADR-104 D4 / U3) ────────────────────────────────────────────────────

test('衝突は議題化されるまで記録されない — 見ているだけでは何も残らない (D4)', async () => {
  const svc = await loaded()
  assert.ok(svc.getValidatorResult().conflicts.length > 0, 'R6 が衝突を出していない (前提が壊れている)')
  assert.equal(svc.getDoc().agenda, undefined, '衝突が勝手に保存されている')
  assert.equal(svc.projectAgenda().length, 0)
  assert.equal(svc.agendaCounters().conflicts, svc.getValidatorResult().conflicts.length)
  assert.equal(svc.agendaCounters().agenda, 0, '0 は正当 — 隠さず出す')
})

test('議題化 → 決着は関与者全員の鍵を要る (D5 / n-ary)', async () => {
  const svc = await loaded()
  const conflictRef = svc.getValidatorResult().conflicts[0].ref
  await createTableConflictCommand(svc, 'ag_1', conflictRef, 'vision_engineer', {}, VC).execute()

  assert.equal(svc.projectAgenda().length, 1)
  assert.equal(svc.agendaCounters().agenda, 1)

  // 片方の鍵だけでは足りない
  const half = keyringOf(['vision_engineer'])
  assert.equal(svc.signatureForSettlement('ag_1', half), null)
  assert.ok(svc.settlementGuards('ag_1', half).reasons.some(r => /missing robot_engineer/.test(r)))

  // 全員ぶんの鍵で決着
  const all = keyringOf(['vision_engineer', 'robot_engineer'])
  const signature = svc.signatureForSettlement('ag_1', all)
  assert.deepEqual(signature.decidedBy.sort(), ['robot_engineer', 'vision_engineer'])
  await createSettleAgendaCommand(svc, 'ag_1', signature, VC).execute()

  const item = svc.getDoc().agenda[0]
  assert.equal(item.state, AGENDA_STATE.SETTLED)
  assert.equal(item.keyCardinalityAtDecision, 2)
})

test('未決のまま閉会も証憑として残る (D4)', async () => {
  const svc = await loaded()
  const conflictRef = svc.getValidatorResult().conflicts[0].ref
  await createTableConflictCommand(svc, 'ag_1', conflictRef, 'vision_engineer', {}, VC).execute()
  await createCloseUndecidedCommand(svc, 'ag_1', { by: 'vision_engineer', note: '来週の実測待ち' }, VC).execute()

  const item = svc.getDoc().agenda[0]
  assert.equal(item.state, AGENDA_STATE.CLOSED_UNDECIDED)
  assert.equal(item.closedBy, 'vision_engineer')
  assert.equal(item.note, '来週の実測待ち')
})

test('再燃は supersedes を持つ新しい議題 — 証憑は追記のみの線形列 (U3)', async () => {
  const svc = await loaded()
  const conflictRef = svc.getValidatorResult().conflicts[0].ref
  await createTableConflictCommand(svc, 'ag_1', conflictRef, 'vision_engineer', {}, VC).execute()
  await createCloseUndecidedCommand(svc, 'ag_1', { by: 'vision_engineer' }, VC).execute()
  await createTableConflictCommand(svc, 'ag_2', conflictRef, 'robot_engineer', { supersedes: 'ag_1' }, VC).execute()

  const agenda = svc.getDoc().agenda
  assert.equal(agenda.length, 2, '古い行を書き換えず、新しい行として追記されること')
  assert.equal(agenda[1].supersedes, 'ag_1')
  assert.equal(svc.getValidatorResult().errors.length, 0,
    `再燃の形が validator に拒否された: ${JSON.stringify(svc.getValidatorResult().errors)}`)
})

test('まだ開いている議題を supersede しようとすると拒否される (U3)', async () => {
  const svc = await loaded()
  const conflictRef = svc.getValidatorResult().conflicts[0].ref
  await createTableConflictCommand(svc, 'ag_1', conflictRef, 'vision_engineer', {}, VC).execute()
  await createTableConflictCommand(svc, 'ag_2', conflictRef, 'robot_engineer', { supersedes: 'ag_1' }, VC).execute()

  assert.ok(svc.getValidatorResult().errors.some(e => /still open/.test(e)),
    '同じ問いが場に 2 つ在る状態が通ってしまう')
})
