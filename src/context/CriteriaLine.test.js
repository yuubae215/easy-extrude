/**
 * CriteriaLine — the agreed line moves only by approved proposal (ADR-165 D4 / D5, PR2).
 *
 * This file is the maturity PATH of the GSN goal
 * TheAgreedLineMovesOnlyByApprovedProposal (docs/gsn/adr-165-…gsn).
 *
 * The fixtures are built so that "count what is there" and "count what is
 * required" disagree: N=1 (zero approvers is legitimate and recorded), N=3
 * (one approval is not enough), the same key pressed twice (a set, not a
 * tally), a newcomer after agreement (re-hearing), and a frozen field edited
 * in the file without a proposal (drift).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  LINE_STATUS, LINE_CHANGE, currentLine, lineStatus, lineVersion, agreeToLine,
  agreementGuards, isFrozenLineTarget, isLineProposal, lineDrift, lineHistory,
  lineTargets, requiredApprovers, lineFieldOf,
} from './CriteriaLine.js'
import {
  makeProposal, addProposal, approveProposal, unapproveProposal, approvalGuards,
  rejectProposal, rejectionGuards, withdrawProposal, PROPOSAL_STATE,
} from './Proposal.js'
import { editPermission, EDIT_PERMISSION, TARGET_KIND } from './Ownership.js'
import { CRITERIA_ELEMENTS } from './CriteriaCatalog.js'
import { validateContext } from './ContextValidator.js'
import { applyQuestionAnswer } from './FormApplication.js'
import { projectForm, ANSWER_KIND } from './FormProjection.js'
import { CONTEXT_DSL_VERSION } from './ContextDslSchema.js'

const fullMix = () => ({ D: 3, Q: 2, C: 1, S: 4 })
const answer = (owner, e) => ({
  ref: `crit_${owner}_${e.key}`, by: owner, owner,
  kpi: { name: e.key, unit: e.unit }, criterion: { op: e.op, value: 10 }, weight: 1,
})
const endUser = (ref) => ({ ref, role: 'maintainer', endUser: true, mix: fullMix() })
const heard = (refs) => ({
  version: CONTEXT_DSL_VERSION,
  actors: refs.map(endUser),
  requirements: refs.flatMap(r => CRITERIA_ELEMENTS.map(e => answer(r, e))),
})
const agreedBy = (doc, refs) => refs.reduce((d, r) => agreeToLine(d, r), doc)

const takt = (owner) => ({ kind: TARGET_KIND.REQUIREMENT_CRITERION, ref: `crit_${owner}_takt` })
const clearance = (owner) => ({ kind: TARGET_KIND.REQUIREMENT_CRITERION, ref: `crit_${owner}_humanClearance` })
const propose = (doc, { ref = 'prop_1', by, target, to, from }) => addProposal(doc, makeProposal({
  ref, by, target, from: from ?? { op: '<=', value: 10 }, to, rationale: 'need the takt',
}))
const sig = (decidedBy) => ({ decidedBy, keyCardinality: decidedBy.length })

// ── hearing → agreed ──────────────────────────────────────────────────────────

test('the line cannot be agreed while anything is unheard, and the reason is named', () => {
  const doc = heard(['a'])
  doc.requirements = doc.requirements.filter(r => r.kpi.name !== 'humanClearance')
  const g = agreementGuards(doc, 'a', ['a'])
  assert.equal(g.ok, false)
  assert.match(g.reasons.join(' '), /2 criteria answers are still unheard/)
  assert.throws(() => agreeToLine(doc, 'a'), /cannot agree/)
})

test('agreeing needs the person\'s own key (the act is theirs)', () => {
  const g = agreementGuards(heard(['a', 'b']), 'a', ['b'])
  assert.equal(g.ok, false)
  assert.match(g.reasons.join(' '), /hold their key/)
})

test('N=2: one agreement leaves the line hearing; the second makes it agreed v1', () => {
  const one = agreeToLine(heard(['a', 'b']), 'a')
  assert.equal(lineStatus(one).status, LINE_STATUS.HEARING)
  assert.deepEqual(lineStatus(one).agreedBy, ['a'])
  assert.deepEqual(lineStatus(one).awaiting, ['b'])
  assert.equal(lineVersion(one), null, '合意前に版は無い')

  const both = agreeToLine(one, 'b')
  const s = lineStatus(both)
  assert.equal(s.status, LINE_STATUS.AGREED)
  assert.equal(s.version, 1)
  assert.deepEqual(both.criteriaAgreement.agreed.line, currentLine(both))
  assert.equal(both.criteriaAgreement.pending, undefined)
})

test('an agreement given to an earlier line does not carry over to a changed one', () => {
  const one = agreeToLine(heard(['a', 'b']), 'a')
  // b edits their own answer before agreeing (still hearing — direct edit is legal)
  const edited = { ...one, requirements: one.requirements.map(r => r.ref === 'crit_b_takt' ? { ...r, weight: 5 } : r) }
  assert.equal(lineStatus(edited).pendingStale, true)
  assert.deepEqual(lineStatus(edited).agreedBy, [], '古い線への合意は数えない')
  const after = agreeToLine(edited, 'b')
  assert.deepEqual(after.criteriaAgreement.pending.by, ['b'], '集め直しは今の人から')
  assert.equal(lineStatus(after).status, LINE_STATUS.HEARING)
})

test('agreeing twice, or after agreement, is refused', () => {
  const one = agreeToLine(heard(['a', 'b']), 'a')
  assert.match(agreementGuards(one, 'a').reasons.join(' '), /already agreed/)
  const both = agreeToLine(one, 'b')
  assert.match(agreementGuards(both, 'a').reasons.join(' '), /already agreed \(v1\)/)
})

test('the agreement is reachable through the form alone, and the form then empties', () => {
  let doc = heard(['a'])
  const q = projectForm(validateContext(doc)).find(x => x.answerKind === ANSWER_KIND.AGREEMENT)
  assert.ok(q, 'heard in full → the agreement is asked')
  doc = applyQuestionAnswer(doc, q, { actorRef: 'a' })
  const result = validateContext(doc)
  assert.deepEqual(projectForm(result).filter(x => x.raisedBy.startsWith('R12')), [])
  assert.deepEqual(result.errors, [])
  assert.equal(lineStatus(doc).status, LINE_STATUS.AGREED)
})

// ── the frozen line ───────────────────────────────────────────────────────────

test('after agreement even the owner\'s key gives PROPOSE_ONLY on a line field', () => {
  const doc = agreedBy(heard(['a', 'b']), ['a', 'b'])
  for (const target of [takt('a'), { kind: TARGET_KIND.REQUIREMENT_WEIGHT, ref: 'crit_a_takt' }, { kind: TARGET_KIND.ACTOR_MIX, ref: 'a' }]) {
    const p = editPermission(['a'], doc, target)
    assert.equal(p.permission, EDIT_PERMISSION.PROPOSE_ONLY, target.kind)
    assert.match(p.reason, /agreed criteria line \(v1\)/)
  }
  // before agreement the owner edits directly
  assert.equal(editPermission(['a'], heard(['a', 'b']), takt('a')).permission, EDIT_PERMISSION.DIRECT)
})

test('a frozen field written in the file without a proposal is an error (drift)', () => {
  const doc = agreedBy(heard(['a', 'b']), ['a', 'b'])
  const tampered = { ...doc, requirements: doc.requirements.map(r => r.ref === 'crit_a_humanClearance' ? { ...r, criterion: { op: '>=', value: 1 } } : r) }
  const drift = lineDrift(tampered)
  assert.equal(drift.length, 1)
  assert.equal(drift[0].element, 'humanClearance')
  assert.ok(validateContext(tampered).errors.some(e => /moves only by a proposal/.test(e)))
  assert.deepEqual(lineDrift(doc), [])
})

test('the form refuses to write a frozen field (no silent skip)', () => {
  const doc = agreedBy(heard(['a']), ['a'])
  assert.throws(() => applyQuestionAnswer(doc, { answerKind: 'criteria', target: 'a' },
    { elements: { takt: { weight: 9 } } }), /agreed criteria line/)
})

// ── approval: every other end user ────────────────────────────────────────────

test('N=3: approvers are the other two; one approval does not move the line', () => {
  let doc = agreedBy(heard(['a', 'b', 'c']), ['a', 'b', 'c'])
  doc = propose(doc, { by: 'a', target: takt('a'), to: { op: '<=', value: 12 } })
  const p = doc.proposals[0]
  assert.equal(isLineProposal(doc, p), true)
  assert.deepEqual(requiredApprovers(doc, p), ['b', 'c'])
  assert.equal(lineStatus(doc).status, LINE_STATUS.CHANGE_PROPOSED)

  // the proposer's own key cannot approve
  assert.equal(approvalGuards(doc, p, ['a']).ok, false)

  doc = approveProposal(doc, 'prop_1', sig(['b']))
  assert.equal(doc.proposals[0].state, PROPOSAL_STATE.PROPOSED, '欠けた承認では版は上がらない')
  assert.deepEqual(doc.proposals[0].approvals, ['b'])
  assert.equal(doc.requirements.find(r => r.ref === 'crit_a_takt').criterion.value, 10)
  assert.equal(lineVersion(doc), 1)

  doc = approveProposal(doc, 'prop_1', sig(['c']))
  assert.equal(doc.proposals[0].state, PROPOSAL_STATE.APPROVED)
  assert.equal(doc.proposals[0].lineVersion, 2)
  assert.deepEqual(doc.proposals[0].approversRequired, ['b', 'c'])
  assert.equal(doc.requirements.find(r => r.ref === 'crit_a_takt').criterion.value, 12)
  assert.equal(lineStatus(doc).status, LINE_STATUS.AGREED)
  assert.equal(lineVersion(doc), 2)
  assert.deepEqual(lineDrift(doc), [], '承認済みの提案は線の正当な動き')
  assert.deepEqual(validateContext(doc).errors, [])
})

test('the same key pressed twice counts once (approvals are a set)', () => {
  let doc = agreedBy(heard(['a', 'b', 'c']), ['a', 'b', 'c'])
  doc = propose(doc, { by: 'a', target: takt('a'), to: { op: '<=', value: 12 } })
  doc = approveProposal(doc, 'prop_1', sig(['b']))
  const again = approvalGuards(doc, doc.proposals[0], ['b'])
  assert.equal(again.ok, false)
  assert.match(again.reasons.join(' '), /already approved as b.*waiting on c/)
  assert.throws(() => approveProposal(doc, 'prop_1', sig(['b'])))
})

test('N=1: no approvers — the change passes recorded as such', () => {
  let doc = agreedBy(heard(['a']), ['a'])
  doc = propose(doc, { by: 'a', target: takt('a'), to: { op: '<=', value: 12 } })
  const g = approvalGuards(doc, doc.proposals[0], ['a'])
  assert.equal(g.ok, true)
  assert.deepEqual(g.required, [])
  doc = approveProposal(doc, 'prop_1', sig([]))
  assert.equal(doc.proposals[0].state, PROPOSAL_STATE.APPROVED)
  assert.deepEqual(doc.proposals[0].approversRequired, [])
  assert.match(doc.decisions[0].rationale, /no other end user — recorded only/)
  assert.deepEqual(validateContext(doc).errors, [])
})

test('an approved line change missing a required approver is an error', () => {
  let doc = agreedBy(heard(['a', 'b']), ['a', 'b'])
  doc = propose(doc, { by: 'a', target: takt('a'), to: { op: '<=', value: 12 } })
  doc = approveProposal(doc, 'prop_1', sig(['b']))
  const forged = { ...doc, proposals: doc.proposals.map(p => ({ ...p, decidedBy: [] })) }
  assert.ok(validateContext(forged).errors.some(e => /approved without b/.test(e)))
})

test('undo of the completing approval unwinds claim, state, receipt and its approver', () => {
  let doc = agreedBy(heard(['a', 'b', 'c']), ['a', 'b', 'c'])
  doc = propose(doc, { by: 'a', target: takt('a'), to: { op: '<=', value: 12 } })
  const partial = approveProposal(doc, 'prop_1', sig(['b']))
  const done = approveProposal(partial, 'prop_1', sig(['c']))
  const undone = unapproveProposal(done, 'prop_1', sig(['c']))
  assert.deepEqual(undone.proposals, partial.proposals)
  assert.deepEqual(undone.requirements, partial.requirements)
  assert.deepEqual(undone.decisions ?? [], partial.decisions ?? [])
  assert.deepEqual(unapproveProposal(partial, 'prop_1', sig(['b'])).proposals[0].approvals, [])
})

test('the outside-margin gate makes each approver read the offerings first (G3)', () => {
  let doc = agreedBy(heard(['a', 'b']), ['a', 'b'])
  doc = propose(doc, { by: 'a', target: takt('a'), to: { op: '<=', value: 12 } })
  const withOfferings = { ...doc, proposals: doc.proposals.map(p => ({ ...p, offerings: ['b: 2 mm of position accuracy'] })) }
  assert.match(approvalGuards(withOfferings, withOfferings.proposals[0], ['b']).reasons.join(' '), /must read what it gives up/)
  const read = { ...withOfferings, proposals: withOfferings.proposals.map(p => ({ ...p, offeringsReadBy: ['b'] })) }
  assert.equal(approvalGuards(read, read.proposals[0], ['b']).ok, true)
})

// ── rejection / withdrawal keep the version ───────────────────────────────────

test('one other end user may reject; the version and the claim stay', () => {
  let doc = agreedBy(heard(['a', 'b', 'c']), ['a', 'b', 'c'])
  doc = propose(doc, { by: 'a', target: takt('a'), to: { op: '<=', value: 12 } })
  assert.equal(rejectionGuards(doc, doc.proposals[0], ['a']).ok, false, '提案者は却下できない')
  const g = rejectionGuards(doc, doc.proposals[0], ['c'])
  assert.deepEqual(g.by, ['c'])
  const rejected = rejectProposal(doc, 'prop_1', g.by)
  assert.equal(rejected.proposals[0].state, PROPOSAL_STATE.REJECTED)
  assert.equal(lineVersion(rejected), 1)
  assert.equal(lineStatus(rejected).status, LINE_STATUS.AGREED)
  assert.deepEqual(validateContext(rejected).errors, [])

  const withdrawn = withdrawProposal(doc, 'prop_1')
  assert.equal(lineVersion(withdrawn), 1)
})

test('an ordinary (ADR-104) proposal is rejected by its owner\'s key', () => {
  const doc = {
    version: CONTEXT_DSL_VERSION,
    actors: [{ ref: 'o', role: 'developer' }, { ref: 'x', role: 'developer' }],
    requirements: [{ ref: 'r1', by: 'o', owner: 'o', constrains: ['v'], criterion: { op: '<=', value: 1 } }],
    proposals: [makeProposal({ ref: 'prop_9', by: 'x', target: { kind: TARGET_KIND.REQUIREMENT_CRITERION, ref: 'r1' }, from: { op: '<=', value: 1 }, to: { op: '<=', value: 2 }, rationale: 'r' })],
  }
  assert.equal(rejectionGuards(doc, doc.proposals[0], ['x']).ok, false)
  assert.deepEqual(rejectionGuards(doc, doc.proposals[0], ['o']).by, ['o'])
})

// ── re-hearing: the end users changed ─────────────────────────────────────────

test('a newcomer drops the line to hearing; old rows stay frozen; re-agreement keeps the version', () => {
  let doc = agreedBy(heard(['a', 'b']), ['a', 'b'])
  doc = propose(doc, { by: 'a', target: takt('a'), to: { op: '<=', value: 12 } })
  doc = approveProposal(doc, 'prop_1', sig(['b']))
  assert.equal(lineVersion(doc), 2)

  // c joins and answers everything
  const c = heard(['c'])
  doc = { ...doc, actors: [...doc.actors, ...c.actors], requirements: [...doc.requirements, ...c.requirements] }
  const s = lineStatus(doc)
  assert.equal(s.status, LINE_STATUS.HEARING)
  assert.equal(s.rehearing, true)
  assert.equal(isFrozenLineTarget(doc, takt('a')), true, '再聴取中も合意済みの行は凍ったまま')
  assert.equal(isFrozenLineTarget(doc, takt('c')), false, '新しい人の行はまだ答えの途中')
  assert.ok(validateContext(doc).openQuestions.some(q => q.raisedBy === 'R12:unagreed-criteria' && /re-agrees/.test(q.summary)))

  doc = agreedBy(doc, ['a', 'b', 'c'])
  assert.equal(lineStatus(doc).status, LINE_STATUS.AGREED)
  assert.equal(lineVersion(doc), 2, '版は保ったまま')
  assert.deepEqual(lineDrift(doc), [])
  assert.deepEqual(validateContext(doc).errors, [])
})

// ── history (D4 — after agreement) ────────────────────────────────────────────

test('history says who loosened what, and marks a safety cut', () => {
  let doc = agreedBy(heard(['a', 'b']), ['a', 'b'])
  doc = propose(doc, { by: 'a', target: clearance('a'), from: { op: '>=', value: 10 }, to: { op: '>=', value: 5 } })
  doc = approveProposal(doc, 'prop_1', sig(['b']))
  doc = propose(doc, { ref: 'prop_2', by: 'b', target: takt('b'), to: { op: '<=', value: 8 } })
  const h = lineHistory(doc)
  assert.equal(h.length, 2)
  assert.equal(h[0].change, LINE_CHANGE.LOOSENED)
  assert.equal(h[0].safetyCut, true, '安全を緩めた組には「安全を削った」が付く')
  assert.equal(h[0].version, 2)
  assert.deepEqual(h[0].approvals, ['b'])
  assert.equal(h[1].change, LINE_CHANGE.TIGHTENED)
  assert.equal(h[1].safetyCut, false)
  assert.equal(h[1].state, PROPOSAL_STATE.PROPOSED)
})

test('the menu of proposable fields is exactly the frozen line (3 per end user × 7 + mix)', () => {
  const before = heard(['a', 'b'])
  assert.deepEqual(lineTargets(before), [], '合意前は直接答える')
  const doc = agreedBy(before, ['a', 'b'])
  assert.equal(lineTargets(doc).length, 2 * (1 + 2 * CRITERIA_ELEMENTS.length))
  assert.ok(lineTargets(doc).every(t => lineFieldOf(doc, t.target)))
})

test('a design requirement is never a line field', () => {
  const doc = agreedBy(heard(['a']), ['a'])
  doc.requirements.push({ ref: 'r_design', by: 'a', owner: 'a', kpi: { name: 'cycleTime' }, criterion: { op: '<=', value: 1 }, constrains: ['v'] })
  assert.equal(lineFieldOf(doc, { kind: TARGET_KIND.REQUIREMENT_CRITERION, ref: 'r_design' }), null)
  assert.equal(editPermission(['a'], doc, { kind: TARGET_KIND.REQUIREMENT_CRITERION, ref: 'r_design' }).permission, EDIT_PERMISSION.DIRECT)
})
