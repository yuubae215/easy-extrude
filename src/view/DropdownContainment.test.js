/**
 * DropdownContainment.test.js — 「パネル内の click を外側と読まない」の回帰
 *
 * 出荷された欠陥は述語が **surface を引数に持っていなかった**ことなので、
 * ここで問うのは真理値だけでなく **呼び出しの形**でもある: 片方だけ渡す呼び方が
 * 通ってしまうなら、次の呼び出し側が同じ欠陥を再生産できる。
 *
 * DOM は使わない — `contains` を持つ最小の偽ノードで足りる (原則 #3)。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isInsideDropdown } from './DropdownContainment.js'

/** `contains` だけを持つ最小ノード。 */
const node = (...owned) => ({ contains: t => owned.includes(t) })

test('パネル内の click は「内側」— これが出荷された欠陥の回帰', () => {
  const row     = Symbol('menu row')
  const trigger = node()
  const surface = node(row)
  assert.equal(isInsideDropdown(row, { trigger, surface }), true)
})

test('引金の click も内側', () => {
  const icon    = Symbol('trigger icon')
  const trigger = node(icon)
  assert.equal(isInsideDropdown(icon, { trigger, surface: null }), true)
})

test('どちらにも属さない click は外側', () => {
  const elsewhere = Symbol('canvas')
  assert.equal(
    isInsideDropdown(elsewhere, { trigger: node(), surface: node() }),
    false,
  )
})

test('閉じている (surface が未マウント) 間の外側 click は throw せず false', () => {
  const elsewhere = Symbol('canvas')
  assert.equal(isInsideDropdown(elsewhere, { trigger: node(), surface: null }), false)
})

test('target が無いとき false (イベントの形に依存しない)', () => {
  assert.equal(isInsideDropdown(null, { trigger: node(), surface: node() }), false)
})

test('片方だけ渡す呼び方は禁止 — 欠陥の再生産経路を閉じる', () => {
  const row = Symbol('menu row')
  assert.throws(() => isInsideDropdown(row, { trigger: node(row) }), /両方の欄を渡すこと/)
  assert.throws(() => isInsideDropdown(row, { surface: node(row) }), /両方の欄を渡すこと/)
  assert.throws(() => isInsideDropdown(row, undefined), /両方の欄を渡すこと/)
})
