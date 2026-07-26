/**
 * SelectionManager.test.js — the contextual visibility axis (THREE-free).
 *
 * Two things are asked here.
 *
 * 1. **Rooting** (the ADR-084/085 regression this file was born for):
 *    showFrameChain() must claim the whole CoordinateFrame tree whether it is
 *    rooted at a geometry Solid (ADR-037) or at a world-parented root frame —
 *    the robot TF tree (robot_base → tcp / user frames). The old walk bailed out
 *    on a parentless root, so selecting the robot showed nothing.
 *
 * 2. **What this manager owns** (ADR-096): it writes the `contextual` AXIS and
 *    nothing else. The assertions are therefore about the map it hands to
 *    `SceneService.setContextualFrames()`, not about mesh views — it no longer
 *    touches one. The old version of this file asserted `meshView.state ===
 *    'full'`, which is precisely the coupling that made this class a second
 *    writer of the pixels the Outliner eye also wrote. Connection lines moved
 *    with the composition for the same reason (a line belongs to the frame it
 *    hangs off, so it is drawn where the frame is drawn).
 *
 * The composition of the two axes belongs to `VisibilityAxes.test.js`; the
 * 症状-4 test below joins both ends with the REAL `composeVisibility`, so
 * "an explicitly shown frame survives a selection change" is proved without
 * re-implementing the rule here.
 *
 * Run with:  node --test src/controller/SelectionManager.test.js
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { SelectionManager } from './SelectionManager.js'
import { CoordinateFrame } from '../domain/CoordinateFrame.js'
import {
  CONTEXTUAL, VISIBILITY_KIND, composeVisibility, defaultExplicit,
} from '../view/VisibilityAxes.js'

/** Minimal CoordinateFrame stub: real prototype (for instanceof). */
function makeFrame(id, parentId) {
  const f = Object.create(CoordinateFrame.prototype)
  return Object.assign(f, { id, parentId, meshView: {} })
}

/** A plain (non-CoordinateFrame) geometry object stub. */
function makeSolid(id) {
  return { id, parentId: null, meshView: {} }
}

/** Fake scene backed by a Map; children resolved by parentId scan. */
function makeScene(objs) {
  const byId = new Map(objs.map(o => [o.id, o]))
  return {
    activeId: null,
    getObject: id => byId.get(id) ?? null,
    getChildren: pid => objs.filter(o => o.parentId === pid),
    isLinkEndpoint: () => false,
  }
}

/**
 * Records the contextual claim the manager hands over. Stands in for
 * SceneService as the axis' OWNER — it stores the claim, it does not decide
 * anything about it (the deciding is `composeVisibility`, imported for real).
 */
function makeCtrl(objs) {
  const contextual = new Map()
  return {
    _scene: makeScene(objs),
    _objSelected: true,
    _service: {
      setContextualFrames(frames) {
        contextual.clear()
        for (const [id, mode] of frames) contextual.set(id, mode)
      },
    },
    contextual,
  }
}

// ── 1. Rooting ───────────────────────────────────────────────────────────────

test('geometry-rooted tree: selecting a child frame claims the whole tree', () => {
  const solid  = makeSolid('solid')
  const origin = makeFrame('origin', 'solid')
  const child  = makeFrame('child', 'origin')
  const mgr = new SelectionManager(makeCtrl([solid, origin, child]))
  const ctrl = mgr._ctrl

  mgr.showFrameChain('child')

  assert.deepEqual([...ctrl.contextual.keys()].sort(), ['child', 'origin'])
  assert.equal(ctrl.contextual.get('child'),  CONTEXTUAL.FULL,   '選択された当人はフル')
  assert.equal(ctrl.contextual.get('origin'), CONTEXTUAL.DIMMED, '同じ木の他フレームは薄字')
})

test('robot tree: selecting robot_base (world-parented root) claims the whole TF tree', () => {
  const base = makeFrame('base', null)   // world-parented root (robot_base)
  const tcp  = makeFrame('tcp', 'base')
  const mgr = new SelectionManager(makeCtrl([base, tcp]))
  const ctrl = mgr._ctrl

  mgr.showFrameChain('base')

  assert.equal(ctrl.contextual.get('base'), CONTEXTUAL.FULL, '根フレーム自身がタップの手応え')
  assert.equal(ctrl.contextual.get('tcp'),  CONTEXTUAL.DIMMED)
})

test('robot tree: selecting a user frame added under robot_base claims it', () => {
  const base = makeFrame('base', null)
  const tcp  = makeFrame('tcp', 'base')
  const user = makeFrame('user', 'base')   // "Add Frame" on the robot
  const mgr = new SelectionManager(makeCtrl([base, tcp, user]))
  const ctrl = mgr._ctrl

  mgr.showFrameChain('user')

  assert.equal(ctrl.contextual.get('user'), CONTEXTUAL.FULL,
    '親のない根で打ち切ると、ロボットに足したフレームが選んでも出ない (ADR-084/085 の回帰)')
  assert.equal(ctrl.contextual.get('base'), CONTEXTUAL.DIMMED)
  assert.equal(ctrl.contextual.get('tcp'),  CONTEXTUAL.DIMMED)
})

test('a geometry selection claims its frame tree at full opacity', () => {
  const solid  = makeSolid('solid')
  const origin = makeFrame('origin', 'solid')
  const child  = makeFrame('child', 'origin')
  const mgr = new SelectionManager(makeCtrl([solid, origin, child]))
  const ctrl = mgr._ctrl

  mgr.showGeometryFrameTree('solid')

  assert.deepEqual([...ctrl.contextual.keys()].sort(), ['child', 'origin'])
  assert.deepEqual([...new Set(ctrl.contextual.values())], [CONTEXTUAL.FULL])
})

// ── 2. The claim is replaced wholesale ───────────────────────────────────────

test('releasing the claim replaces the whole map — no stale ids survive', () => {
  const base = makeFrame('base', null)
  const tcp  = makeFrame('tcp', 'base')
  const mgr = new SelectionManager(makeCtrl([base, tcp]))
  const ctrl = mgr._ctrl

  mgr.showFrameChain('tcp')
  assert.equal(ctrl.contextual.size, 2)
  mgr.hideFrameChain()
  assert.equal(ctrl.contextual.size, 0,
    '主張は丸ごと置き換わる — 個別の取り消しを積み上げないので「1 つ消し忘れた」が書けない')
})

test('switching selection replaces the claim rather than accumulating it', () => {
  const solid  = makeSolid('solid')
  const origin = makeFrame('origin', 'solid')
  const base   = makeFrame('base', null)
  const tcp    = makeFrame('tcp', 'base')
  const mgr = new SelectionManager(makeCtrl([solid, origin, base, tcp]))
  const ctrl = mgr._ctrl

  mgr.showGeometryFrameTree('solid')
  mgr.showFrameChain('tcp')

  assert.deepEqual([...ctrl.contextual.keys()].sort(), ['base', 'tcp'],
    '前の選択の主張が残ると、選択を変えるたび画面に軸が溜まる')
})

// ── 症状 4: the eye survives a selection change ──────────────────────────────

test('明示表示した CF は選択が別実体へ移っても描かれ続ける (症状 4 — 合成まで通す)', () => {
  const solid  = makeSolid('solid')
  const origin = makeFrame('origin', 'solid')
  const base   = makeFrame('base', null)
  const mgr = new SelectionManager(makeCtrl([solid, origin, base]))
  const ctrl = mgr._ctrl

  assert.equal(defaultExplicit(VISIBILITY_KIND.COORDINATE_FRAME), false,
    '既定は伏せる — 開いているのはユーザーがそう言ったからである')

  // 別の実体 (Solid) を選択 → 文脈軸は base を主張しない。
  mgr.showGeometryFrameTree('solid')
  assert.equal(ctrl.contextual.has('base'), false)

  const composed = composeVisibility({
    explicit:   true,                                  // ユーザーが base の eye を開いた
    contextual: ctrl.contextual.get('base') ?? null,
  })
  assert.deepEqual(composed, { visible: true, dimmed: false },
    '文脈が手放しても explicit が支える — 旧 hideFrameChain は eye を読まずに消していた')
})

test('文脈だけで出ているフレームは、文脈が消えれば消える (対称性)', () => {
  const solid  = makeSolid('solid')
  const origin = makeFrame('origin', 'solid')
  const mgr = new SelectionManager(makeCtrl([solid, origin]))
  const ctrl = mgr._ctrl
  const explicit = defaultExplicit(VISIBILITY_KIND.COORDINATE_FRAME)

  mgr.showGeometryFrameTree('solid')
  assert.equal(
    composeVisibility({ explicit, contextual: ctrl.contextual.get('origin') ?? null }).visible,
    true)

  mgr.hideFrameChain()
  assert.equal(
    composeVisibility({ explicit, contextual: ctrl.contextual.get('origin') ?? null }).visible,
    false)
})

// ── Handing the axis back (link creation borrows it) ─────────────────────────

test('refreshFrameContext recomputes the claim from the current selection', () => {
  const solid  = makeSolid('solid')
  const origin = makeFrame('origin', 'solid')
  const mgr = new SelectionManager(makeCtrl([solid, origin]))
  const ctrl = mgr._ctrl
  ctrl._scene.activeId = 'solid'

  // Link mode borrowed the axis and claimed every frame…
  ctrl._service.setContextualFrames([['origin', CONTEXTUAL.FULL], ['other', CONTEXTUAL.FULL]])
  // …then hands it back.
  mgr.refreshFrameContext()

  assert.deepEqual([...ctrl.contextual.keys()], ['origin'],
    '返却は所有者の再計算であって、呼び出し側での再実装ではない')
})

test('refreshFrameContext with nothing selected releases the claim', () => {
  const solid = makeSolid('solid')
  const mgr = new SelectionManager(makeCtrl([solid]))
  const ctrl = mgr._ctrl
  ctrl._scene.activeId = 'solid'
  ctrl._objSelected = false

  ctrl._service.setContextualFrames([['solid', CONTEXTUAL.FULL]])
  mgr.refreshFrameContext()

  assert.equal(ctrl.contextual.size, 0)
})
