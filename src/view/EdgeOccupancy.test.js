/**
 * EdgeOccupancy.test.js — 画面端の占有計算 (原則 #26 / ADR-105 D6 / ADR-106 D6)
 *
 * 「所有者が 1 個か」は `FloorContainerCensus.test.js` が構文から数える。
 * こちらが問うのは**所有者の中身**: 段が宣言であって推論でないこと、未宣言の段で
 * throw すること、場が開いたときに下端の住人が退く量が段ごとに一貫していること。
 *
 * 下端が右端と違うのは占有物が**積み重なる**ことである。1 つの数では表せないので
 * 段の関数にした — そして段を関数の引数にすると「誰も考えなかった段」が既定へ
 * 落ちる経路が生まれるので、既定表は未宣言の種で throw する (原則 #31。
 * `EXPLICIT_DEFAULTS` / `PLACEMENT_BY_KIND` / `SUPPORT_SURFACE_BY_KIND` と同じ規律)。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  leftEdgeOffset, belowHeaderOffset,
  BOTTOM_TIER, bottomEdgeOffset, floorHeight,
  TOP_EDGE_OCCUPANTS, HEADER_METRICS, topEdgeWidth, topEdgeFits,
} from './EdgeOccupancy.js'
import { MIN_SUPPORTED_WIDTH } from './Viewport.js'

test('未宣言の下端の段では throw する — 既定へ落ちない (原則 #31)', () => {
  assert.throws(() => bottomEdgeOffset({ isMobile: false, tier: 'somewhere-new' }),
    /未宣言の下端の段/)
  // 段を渡し忘れた場合も同じ。undefined は「既定でよい」の意味ではない。
  assert.throws(() => bottomEdgeOffset({ isMobile: false }), /未宣言の下端の段/)
})

test('宣言された段はすべて計算できる (宣言と実装が揃っている)', () => {
  for (const tier of Object.values(BOTTOM_TIER)) {
    for (const isMobile of [false, true]) {
      const px = bottomEdgeOffset({ isMobile, tier })
      assert.ok(Number.isFinite(px) && px >= 0, `段 ${tier} (mobile=${isMobile}) が数を返さない`)
    }
  }
})

test('InfoBar は場が開いても動かない — 下端の基準である (ADR-106 D1 / 原則 #15)', () => {
  // モバイルツールバーは InfoBar の直上に座り、場はその**上に**開く。したがって
  // この段だけは場の開閉に反応しない。キーヒントを読む位置が場の開閉で変わると、
  // 「使えない操作は消さない」を守っている意味が無くなる。
  for (const isMobile of [false, true]) {
    const closed = bottomEdgeOffset({ isMobile, tier: BOTTOM_TIER.ABOVE_INFOBAR, floorOpen: false })
    const open   = bottomEdgeOffset({ isMobile, tier: BOTTOM_TIER.ABOVE_INFOBAR, floorOpen: true })
    assert.equal(closed, open, 'モバイルツールバーの住所が場の開閉で動いている')
    assert.equal(closed, 26, 'InfoBar の高さが下端の基準になっていない')
  }
})

test('場自身は自分の高さの上に立たない (段 FLOOR は場を項に含まない)', () => {
  const closed = bottomEdgeOffset({ isMobile: false, tier: BOTTOM_TIER.FLOOR, floorOpen: false })
  const open   = bottomEdgeOffset({ isMobile: false, tier: BOTTOM_TIER.FLOOR, floorOpen: true })
  assert.equal(closed, open)
  assert.equal(closed, 26)
  // mobile では InfoBar + ツールバーの上に開く。
  assert.equal(bottomEdgeOffset({ isMobile: true, tier: BOTTOM_TIER.FLOOR }), 26 + 60)
})

test('場が開くと下端の住人はちょうど場の高さだけ退く — 覆われも消されもしない', () => {
  // 右端で起きた「ずらす / 消す / 被せる」を下端で再演しないことの、算術側の表明。
  for (const tier of [BOTTOM_TIER.DOCK, BOTTOM_TIER.FLOATING, BOTTOM_TIER.TOAST]) {
    for (const isMobile of [false, true]) {
      const closed = bottomEdgeOffset({ isMobile, tier, floorOpen: false })
      const open   = bottomEdgeOffset({ isMobile, tier, floorOpen: true })
      assert.equal(open - closed, floorHeight({ isMobile }),
        `段 ${tier} (mobile=${isMobile}) の退き量が場の高さと一致しない`)
    }
  }
})

test('段は単調 — 上の段ほど高い (重なりを算術で禁じる)', () => {
  const order = [
    BOTTOM_TIER.ABOVE_INFOBAR,
    BOTTOM_TIER.DOCK,
    BOTTOM_TIER.FLOATING,
    BOTTOM_TIER.TOAST,
  ]
  for (const isMobile of [false, true]) {
    for (const floorOpen of [false, true]) {
      const px = order.map(tier => bottomEdgeOffset({ isMobile, tier, floorOpen }))
      for (let i = 1; i < px.length; i++) {
        assert.ok(px[i] >= px[i - 1],
          `段の順序が崩れている (mobile=${isMobile}, floorOpen=${floorOpen}): ${JSON.stringify(px)}`)
      }
    }
  }
  // Toast は StoryBar / 場のヘッダを跨ぐので、浮遊段より明確に高い —
  // どちらも画面中央下なので、同じ段に置くと必ず重なる。
  assert.ok(bottomEdgeOffset({ isMobile: false, tier: BOTTOM_TIER.TOAST })
          > bottomEdgeOffset({ isMobile: false, tier: BOTTOM_TIER.FLOATING }) + 40)
})

test('場は 3D を覆い切らない高さである (ADR-106 D1 の禁止事項)', () => {
  // 覆うなら場ではなくモーダルであり、それは v1 で却下されている。ここで問えるのは
  // 「器の高さがビューポートに対して支配的でない」ことまで — 実際に 3D が読めるかは
  // e2e の側 (境界は宣言であって推論ではない)。
  for (const isMobile of [false, true]) {
    const h = floorHeight({ isMobile })
    assert.ok(h >= 180, `場が低すぎて actor × variable の表が読めない (${h}px)`)
    assert.ok(h <= 320, `場が高すぎる — 3D を覆い切る器はモーダルであって場ではない (${h}px)`)
  }
})

test('左端と上端は場の開閉に反応しない (端ごとに所有者は 1 つ / ADR-105 D6)', () => {
  assert.equal(leftEdgeOffset({ isMobile: false }), 188)   // Outliner 180 + 余白
  assert.equal(leftEdgeOffset({ isMobile: true }), 8)      // mobile はドロワー = 端が空く
  assert.equal(belowHeaderOffset(), 46)
})

// ─── 上端の**幅** (ADR-114 D1) ───────────────────────────────────────────────

test('mobile ヘッダの住人は最小対応幅に収まる — 切り落とされる入口は 0 個', () => {
  const { fits, width, overflowBy } = topEdgeFits({ viewportWidth: MIN_SUPPORTED_WIDTH })
  assert.ok(fits,
    `\nmobile ヘッダが宣言幅 ${width}px を要求し、最小対応幅 ${MIN_SUPPORTED_WIDTH}px を ${overflowBy}px 超えている。\n\n` +
    '  ヘッダは overflow:hidden なので、超過分は**右端の入口から無言で消える** — DOM には\n' +
    '  在り続けるので HeaderEntranceCensus は数え続け、緑のまま出荷される (ADR-114 の欠陥)。\n' +
    '  直し方は 3 つのどれか: 住人の語を短くする / 入口を ⋯ へ畳んで TOP_EDGE_OCCUPANTS から\n' +
    '  外す / 最小対応幅そのものを意図的に上げる (= 約束を下げる宣言)。\n' +
    '  「入るはずだから」で予算を上げるのは禁止 — 予算は実測の上界である。\n')
})

test('数えるのは*在る入口*ではなく*入らなかった入口* — 予算は住人が 1 人増えれば必ず動く', () => {
  // 母集団は宣言表なので、幅を書かずに住人を足すと throw する (原則 #31)。
  assert.throws(() => topEdgeWidth({ keys: ['IconBtn:Something New'] }),
    /未宣言の上端の住人/)
  // 表に在る住人を 1 人足すと合計は必ず増える (予算が空回りしていない)。
  const keys = Object.keys(TOP_EDGE_OCCUPANTS)
  const all  = topEdgeWidth({ keys })
  const less = topEdgeWidth({ keys: keys.slice(0, -1) })
  assert.ok(all > less, '住人を減らしても合計が変わらない — 予算が入力を読んでいない')
})

test('狭レイアウトの寸法は広いレイアウトより詰まっている (詰めが実際に効いている)', () => {
  assert.ok(HEADER_METRICS.gap.narrow < HEADER_METRICS.gap.wide)
  assert.ok(HEADER_METRICS.iconPadX.narrow < HEADER_METRICS.iconPadX.wide)
  assert.ok(topEdgeWidth({ narrow: true }) < topEdgeWidth({ narrow: false }),
    '狭レイアウトの合計が広いレイアウトより小さくない — 詰めた寸法が計算に入っていない')
})

test('幅を宣言した住人はすべて理由を持つ (理由なしの数は次の人が動かせない)', () => {
  for (const [key, decl] of Object.entries(TOP_EDGE_OCCUPANTS)) {
    assert.ok(Number.isFinite(decl.minWidth) && decl.minWidth >= 0, `${key} の minWidth が数でない`)
    assert.ok(decl.why && decl.why.length > 10,
      `${key} が幅の理由を持たない — 由来の無い定数は、次に狭くする人が「削ってよい 4px」を判断できない`)
  }
})
