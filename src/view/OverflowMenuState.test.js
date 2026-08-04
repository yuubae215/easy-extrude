/**
 * OverflowMenuState.test.js — 「閉じた状態は段を持てない」を機械に問わせる
 *
 * 出荷された欠陥は 1 回の操作では見えない形だった: `Export ›` を押した瞬間は
 * 「メニューが閉じた」だけに見え、**次にもう一度 `⋯` を開いたとき**に初めて
 * 違うものが出る。したがって 1 手ずつ確かめる検査は緑のまま素通りする —
 * ADR-098 の e2e が数値 Grab で書かれていたために振動を出荷し ADR-101 で
 * 別途起票することになったのと同じ形である。
 *
 * ここでは **同じ要求を 2 回通す** (開く → 潜る → 閉じる → もう一度開く) 形を
 * 焼く。閉じ方は 3 通り (外側 click / 行の選択 / 引金の再押下) あるので、
 * 3 通りすべてから再度開いて一段目に戻ることを問う: 「閉じるときに戻す」規律で
 * 実装されていたら、3 つのうち書き忘れた 1 つで落ちる。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CLOSED, MENU_LEVEL, DECLARED_MENU_LEVELS, levelDeclaration,
  isValidMenuState, isMenuOpen, openMenu, closeMenu, toggleMenu,
  descendTo, ascend, verbOf,
} from './OverflowMenuState.js'

// ─── 不変条件: 閉は段を持たない ──────────────────────────────────────────────

test('閉じた状態は階層を持てない (不正状態が表現不能)', () => {
  assert.equal(CLOSED, null)
  assert.equal(isMenuOpen(CLOSED), false)
  assert.equal(verbOf(CLOSED), null)

  // 出荷された欠陥そのものの形。型として妥当でないことを述語が言う。
  assert.equal(isValidMenuState({ level: null, verb: 'export' }), false)
  assert.equal(isValidMenuState({ verb: 'export' }), false)
  // 一段目が verb を持つのも不正 — 「どの動詞の中に居るか」は段が決める。
  assert.equal(isValidMenuState({ level: MENU_LEVEL.VERBS, verb: 'export' }), false)
  // 二段目が verb を持たないのも不正 (既定で埋めない — 原則 #31)。
  assert.equal(isValidMenuState({ level: MENU_LEVEL.OBJECTS }), false)

  assert.equal(isValidMenuState(CLOSED), true)
  assert.equal(isValidMenuState(openMenu()), true)
  assert.equal(isValidMenuState(descendTo(openMenu(), 'export')), true)
})

// ─── 回帰: 同じ要求を 2 回通す (1 手では見えない) ────────────────────────────

test('閉じ方が何であれ、次に開くと必ず一段目 (報告された症状の回帰)', () => {
  const closers = [
    { name: '外側 click',   close: () => closeMenu() },
    { name: '行の選択',     close: () => closeMenu() },
    { name: '引金の再押下', close: (s) => toggleMenu(s) },
  ]

  for (const { name, close } of closers) {
    // 1 周目: 開いて Export へ潜る
    let s = openMenu()
    assert.equal(s.level, MENU_LEVEL.VERBS, `${name}: 開いた直後は一段目`)
    s = descendTo(s, 'export')
    assert.equal(verbOf(s), 'export')

    // 閉じる
    s = close(s)
    assert.equal(isMenuOpen(s), false, `${name}: 閉じている`)
    assert.equal(verbOf(s), null, `${name}: 閉に段は残らない`)

    // 2 周目: **ここが出荷された欠陥の現れる場所**
    s = toggleMenu(s)
    assert.equal(s.level, MENU_LEVEL.VERBS,
      `${name} で閉じたあと ⋯ を再度開いたら動詞一覧に戻ること (前回潜った段を持ち越さない)`)
    assert.equal(verbOf(s), null)
  }
})

test('戻る (ascend) は一段目へ戻し、冪等', () => {
  const deep = descendTo(openMenu(), 'import')
  const up   = ascend(deep)
  assert.equal(up.level, MENU_LEVEL.VERBS)
  assert.equal(verbOf(up), null)
  assert.deepEqual(ascend(up), up)
})

// ─── 経路の禁止 (閉から潜れない) ────────────────────────────────────────────

test('閉じた状態から潜る / 戻る経路は存在しない', () => {
  assert.throws(() => descendTo(CLOSED, 'export'), /called while closed/)
  assert.throws(() => ascend(CLOSED), /called while closed/)
})

test('対象の段は verb を既定で埋めない', () => {
  assert.throws(() => descendTo(openMenu(), ''), /needs a verb/)
  assert.throws(() => descendTo(openMenu(), undefined), /needs a verb/)
})

// ─── 宣言表 (未宣言の段で throw) ────────────────────────────────────────────

test('段の宣言表は未宣言の値で throw する', () => {
  for (const level of DECLARED_MENU_LEVELS) {
    assert.equal(typeof levelDeclaration(level).carriesVerb, 'boolean')
    assert.ok(levelDeclaration(level).why.length > 0, `${level} に why が要る`)
  }
  assert.throws(() => levelDeclaration('objects-with-preview'), /undeclared level/)
})

test('宣言表は MENU_LEVEL の全枝を覆う (母集団は enum から導出)', () => {
  assert.deepEqual(
    [...DECLARED_MENU_LEVELS].sort(),
    Object.values(MENU_LEVEL).sort(),
    'MENU_LEVEL に枝を足したら LEVEL_DECLARATION にも行を足すこと',
  )
})
