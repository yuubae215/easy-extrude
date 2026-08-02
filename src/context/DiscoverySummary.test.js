/**
 * DiscoverySummary.test.js — 3 種類の 0 が別々の値であることを焼く (ADR-105 D2 / D3)
 *
 * GSN goal `ThreeZerosAreDistinctValues` の証拠。問いは「4 入力が 4 通りの異なる値を
 * 返すか」と「未宣言の種で throw するか」で、どちらも *在るもの*を辿っては出てこない
 * 形をしている — `0` は在るが、「どの 0 か」は値を持っていなかった。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DISCOVERY_KIND, CHECKS_KIND,
  discoverySummary, checksSummary,
  discoveryDeclaration, checksDeclaration,
  DECLARED_DISCOVERY_KINDS, DECLARED_CHECKS_KINDS,
} from './DiscoverySummary.js'

// ── 発見の集約 (D2) ─────────────────────────────────────────────────────────

test('文書を採っていなければ未検証 — 0 ではない', () => {
  assert.deepEqual(discoverySummary({ loaded: false }), { kind: DISCOVERY_KIND.UNEXAMINED })
  // 既定引数でも同じ。配線が来ていない状態は「未検証」であって「問題なし」ではない。
  assert.deepEqual(discoverySummary(), { kind: DISCOVERY_KIND.UNEXAMINED })
})

test('文書を採って全部 0 の集約は、未検証と別の値である', () => {
  const examined = discoverySummary({ loaded: true, counters: { conflicts: 0, agenda: 0, unowned: 0 } })
  assert.equal(examined.kind, DISCOVERY_KIND.EXAMINED)
  assert.notDeepEqual(examined, discoverySummary({ loaded: false }))
  // 数えた 0 は隠さず出す (原則 #15 / ADR-104 D4)。
  assert.deepEqual(examined, { kind: 'examined', conflicts: 0, agenda: 0, unowned: 0 })
})

test('3 数は合算されない — 独立した 3 欄として運ばれる', () => {
  const s = discoverySummary({ loaded: true, counters: { conflicts: 3, agenda: 1, unowned: 2 } })
  assert.equal(s.conflicts, 3)
  assert.equal(s.agenda, 1)
  assert.equal(s.unowned, 2)
  assert.equal(s.total, undefined, '合計欄が生えたら D4 の「合算しない」が破れている')
})

test('loaded なのに counters が無ければ throw — 0 で埋めない', () => {
  assert.throws(() => discoverySummary({ loaded: true }), /counters/)
})

// ── 共有 KPI の集約 (D3) ────────────────────────────────────────────────────

test('4 つの入力が 4 通りの異なる kind を返す', () => {
  const kinds = [
    checksSummary({ loaded: false }),
    checksSummary({ loaded: true, checks: [] }),
    checksSummary({ loaded: true, checks: [{ status: 'pass' }, { status: 'pass' }] }),
    checksSummary({ loaded: true, checks: [{ status: 'pass' }, { status: 'fail' }] }),
  ].map(s => s.kind)

  assert.deepEqual(kinds, [
    CHECKS_KIND.UNEXAMINED,
    CHECKS_KIND.NONE_DECLARED,
    CHECKS_KIND.ALL_PASS,
    CHECKS_KIND.FAILING,
  ])
  assert.equal(new Set(kinds).size, 4, '4 入力が 4 通りに割れていない = 0 が潰れている')
})

test('blocked は「通っていない」側 — 全部パスを名乗らせない', () => {
  const s = checksSummary({ loaded: true, checks: [{ status: 'pass' }, { status: 'blocked' }] })
  assert.equal(s.kind, CHECKS_KIND.FAILING)
  assert.deepEqual(
    { failed: s.failed, blocked: s.blocked, passed: s.passed, total: s.total },
    { failed: 0, blocked: 1, passed: 1, total: 2 },
  )
})

test('loaded なのに checks が配列でなければ throw — 空配列と未検証は別物', () => {
  assert.throws(() => checksSummary({ loaded: true }), /配列/)
  assert.throws(() => checksSummary({ loaded: true, checks: null }), /配列/)
})

// ── 宣言表 (未宣言の種で throw する既定表の規律) ─────────────────────────────

test('宣言表は全ての種を覆う — 覆っていなければ throw で落ちる', () => {
  for (const kind of DECLARED_DISCOVERY_KINDS) {
    const decl = discoveryDeclaration({ kind })
    assert.ok(decl.headline, `${kind} に見出しが無い`)
  }
  for (const kind of DECLARED_CHECKS_KINDS) {
    const decl = checksDeclaration({ kind })
    assert.ok(decl.headline, `${kind} に見出しが無い`)
  }
  // 種の集合そのものが宣言表と一致する (片方が増えたら落ちる)。
  assert.deepEqual([...DECLARED_DISCOVERY_KINDS].sort(), Object.values(DISCOVERY_KIND).sort())
  assert.deepEqual([...DECLARED_CHECKS_KINDS].sort(), Object.values(CHECKS_KIND).sort())
})

test('未宣言の種で throw する — fall-through で既定を返さない', () => {
  assert.throws(() => discoveryDeclaration({ kind: 'probably-fine' }), /未宣言の種/)
  assert.throws(() => checksDeclaration({ kind: 'probably-fine' }), /未宣言の種/)
  // `undefined` も種ではない。推論させないことが要点。
  assert.throws(() => discoveryDeclaration(undefined), /未宣言の種/)
  assert.throws(() => checksDeclaration({}), /未宣言の種/)
})

test('出口が無いのは「全部パス」だけ — 他の種は次の一手を名指しする', () => {
  const withoutExit = DECLARED_CHECKS_KINDS.filter(k => !checksDeclaration({ kind: k }).exit)
  assert.deepEqual(withoutExit, [CHECKS_KIND.ALL_PASS],
    '「何もしなくてよい」以外の種が出口を持たないのは原則 #11 (無言の no-op) 側の欠陥')
})
