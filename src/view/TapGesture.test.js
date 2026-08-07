/**
 * TapGesture.test.js — double-tap の誤爆 (ADR-114 D3)
 *
 * 述語を純粋にした理由がここに出る: ブラウザ無しで「12px ずれた 2 タップ」
 * 「オービットを挟んだ 2 タップ」「空振り」を表として焼ける。
 *
 * **この証拠が構造的に見逃すもの (宣言)**: これは述語が正しいことしか示さない。
 * *ブラウザがいつ `dblclick` を合成するか* は示さないし、示せない (Playwright の
 * 合成タッチでは `dblclick` が出ないことを実測で確認した)。したがって「実機で
 * 誤爆が減ったか」の最終確認は人間の 1 回に残る — 隠さず書く。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { acceptDoubleTap, DOUBLE_TAP_SLOP_PX } from './TapGesture.js'

const base = {
  firstTap:  { x: 100, y: 100 },
  secondTap: { x: 100, y: 100 },
  cameraMovedBetween: false,
  hitSomething: true,
  hasSelection: false,
}

test('同じ場所を 2 回叩いて実体に当たった — 受理する', () => {
  assert.deepEqual(acceptDoubleTap(base), { accept: true, reason: null })
})

test('指の滑り (slop 以内) は受理する — タッチは必ず数 px 動く', () => {
  const slipped = { ...base, secondTap: { x: 100 + DOUBLE_TAP_SLOP_PX - 1, y: 100 } }
  assert.equal(acceptDoubleTap(slipped).accept, true)
})

test('離れた 2 タップは double-tap ではない — 別々の選択のつもりだった', () => {
  const apart = { ...base, secondTap: { x: 100 + DOUBLE_TAP_SLOP_PX + 1, y: 100 } }
  const v = acceptDoubleTap(apart)
  assert.equal(v.accept, false)
  assert.match(v.reason, /離れている/)
  // 斜めも同じ (距離であって軸ごとの差ではない)。
  const diagonal = { ...base, secondTap: { x: 120, y: 120 } }
  assert.equal(acceptDoubleTap(diagonal).accept, false)
})

test('あいだにカメラが動いた 2 タップは受理しない — オービット→タップの誤爆', () => {
  const orbited = { ...base, cameraMovedBetween: true }
  const v = acceptDoubleTap(orbited)
  assert.equal(v.accept, false)
  assert.match(v.reason, /カメラが動いた/)
})

test('カメラの判定は距離より先に効く (回してから同じ場所を叩いても受理しない)', () => {
  // 1 本指ドラッグでオービットしてから指を離し、同じ座標をもう一度叩く経路。
  // 距離だけを見ていると通ってしまうので、順序に意味がある。
  const v = acceptDoubleTap({ ...base, cameraMovedBetween: true, secondTap: { x: 100, y: 100 } })
  assert.equal(v.accept, false)
  assert.match(v.reason, /カメラが動いた/)
})

test('当たりも選択も無い空振りは受理しない — フィット先がシーン全体になる', () => {
  const v = acceptDoubleTap({ ...base, hitSomething: false, hasSelection: false })
  assert.equal(v.accept, false)
  assert.match(v.reason, /シーン全体/)
})

test('選択があるなら空を叩いてそこへ戻すのは意図として読める', () => {
  assert.equal(acceptDoubleTap({ ...base, hitSomething: false, hasSelection: true }).accept, true)
})

test('1 回目のタップが記録されていない場合、距離は問わない (比較する相手が無い)', () => {
  // 2 タップの片方がキャンバス外だったときに起きる。「記録が無い」を
  // 「距離 0」で埋めない — 埋めると、canvas 外→canvas 内の組が常に受理される。
  const v = acceptDoubleTap({ ...base, firstTap: null, secondTap: { x: 900, y: 900 } })
  assert.equal(v.accept, true)
})

test('落とすときは必ず理由を持つ — 無言で捨てる枝は 0 個 (原則 #11)', () => {
  const rejections = [
    { ...base, cameraMovedBetween: true },
    { ...base, secondTap: { x: 400, y: 400 } },
    { ...base, hitSomething: false, hasSelection: false },
  ]
  for (const input of rejections) {
    const v = acceptDoubleTap(input)
    assert.equal(v.accept, false)
    assert.ok(v.reason && v.reason.length > 5, `理由の無い却下がある: ${JSON.stringify(input)}`)
  }
})
