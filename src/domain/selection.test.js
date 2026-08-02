/**
 * selection.test.js — 選択の値そのものを問う (ADR-107 D1 / D3)
 *
 * ここが問うのは **構築できない形が本当に構築できないか**である。ADR-099 は
 * 「選択を書く入口の個数」を数えた (`src/SelectionOwnership.test.js`)。それは
 * *誰が書くか*の検査で、*何を書けるか*は見ていない — `Set<string>` は種を持たない
 * ので、実体 id と文書 ref が混ざった集合は**書ける**形として最初から在った。
 *
 * したがってこの検査の母集団は「今日の呼び出し元」ではなく **union の枝** である:
 * 枝を足せば `SELECTION_KIND` に現れ、宣言表 (`view/SelectionKinds.js`) の
 * 覆いを問う `src/SelectionKindDeclarations.test.js` が落ちる。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SELECTION_KIND, SELECTABLE_KINDS, EMPTY_SELECTION,
  variableRef, isVariableRef, kindOfMember, makeSelection,
  selectionMembers, selectionSize, entityIdsOf, variableRefsOf,
  selectionHas, selectionSummary,
} from './selection.js'

test('0 個の表現はちょうど 1 通り — 空の entities も空の variables も作れない', () => {
  // 同じ事実に 2 つの表現を与える形 (§1.1) を、構築の側で閉じる。
  assert.equal(makeSelection([]),                 EMPTY_SELECTION)
  assert.equal(makeSelection(new Set()),          EMPTY_SELECTION)
  assert.equal(makeSelection([]).kind,            SELECTION_KIND.EMPTY)
  assert.equal(selectionSize(EMPTY_SELECTION),    0)
  assert.equal(selectionMembers(EMPTY_SELECTION).size, 0)
  // empty 枝は ids も refs も持たない — 「空の集合」を読める形が在ると、
  // そこから「空の entities」が復活する。
  assert.equal(EMPTY_SELECTION.ids,  undefined)
  assert.equal(EMPTY_SELECTION.refs, undefined)
})

test('混在した選択は構築できない (throw する) — 経路は makeSelection の 1 本だけ', () => {
  assert.throws(() => makeSelection(['solid_1', variableRef('v_d_ref')]), /cannot mix kinds/)
  assert.throws(() => makeSelection([variableRef('v_d_ref'), 'solid_1']), /cannot mix kinds/)
  // 3 つ以上でも同じ (最初の 2 つが同種でも混在は混在)。
  assert.throws(() => makeSelection(['a', 'b', variableRef('v')]), /cannot mix kinds/)
})

test('名前空間は形で区別する — 命名規約に頼らない (D3 / 原則 #21 の同型)', () => {
  // 文字列としては比較できてしまう 2 つ。同じ文字列でも種が違えば別物。
  const sel = makeSelection([variableRef('shared')])
  assert.equal(selectionHas(sel, variableRef('shared')), true)
  assert.equal(selectionHas(sel, 'shared'), false, '変数 ref が実体 id として当たっている')

  const ent = makeSelection(['shared'])
  assert.equal(selectionHas(ent, 'shared'), true)
  assert.equal(selectionHas(ent, variableRef('shared')), false)

  assert.equal(isVariableRef(variableRef('v')), true)
  assert.equal(isVariableRef('v'), false)
  assert.equal(isVariableRef({ ns: 'variable' }), false, 'ref を持たない偽トークンが通っている')
})

test('未知の名前空間は「実体」に落ちず throw する (原則 #31)', () => {
  // 既定へ黙って落ちる形は、「宣言された既定」と「誰も考えなかった種」を
  // 区別不能にする。実体 id が素の文字列である以上、ここが最も落ちやすい。
  assert.throws(() => kindOfMember(null),            /unknown namespace/)
  assert.throws(() => kindOfMember(42),              /unknown namespace/)
  assert.throws(() => kindOfMember({ ref: 'v' }),    /unknown namespace/)
  assert.throws(() => kindOfMember(''),              /unknown namespace/)
  assert.throws(() => variableRef(''),               /non-empty ref/)
})

test('読み手は種をまたいで嘘をつかない — 変数選択時、選択された実体は 0 個', () => {
  const vars = makeSelection([variableRef('v_a'), variableRef('v_b')])
  assert.equal(vars.kind, SELECTION_KIND.VARIABLES)
  assert.equal(selectionSize(vars), 2)
  assert.equal(entityIdsOf(vars).size, 0, '変数が実体として読めている')
  assert.deepEqual([...variableRefsOf(vars)].sort(), ['v_a', 'v_b'])

  const ents = makeSelection(['s1', 's2', 's1'])
  assert.equal(selectionSize(ents), 2, '重複が畳まれていない')
  assert.equal(variableRefsOf(ents).size, 0)
})

test('選択可能な種に empty は含まれない (種の無い状態は「選べるもの」ではない)', () => {
  assert.deepEqual([...SELECTABLE_KINDS].sort(),
    [SELECTION_KIND.ENTITIES, SELECTION_KIND.VARIABLES].sort())
  assert.equal(SELECTABLE_KINDS.includes(SELECTION_KIND.EMPTY), false)
})

test('表示用の写しは権威と別の形を持つ (§1.1 — 同名の写しは grep でも規則でも区別できない)', () => {
  const sel = makeSelection([variableRef('v_a')])
  assert.deepEqual(selectionSummary(sel), { kind: 'variables', members: ['v_a'] })
  assert.deepEqual(selectionSummary(EMPTY_SELECTION), { kind: 'empty', members: [] })
  // 写しは配列 — Set を渡すと View 側が権威を変異させられてしまう。
  assert.ok(Array.isArray(selectionSummary(sel).members))
})
