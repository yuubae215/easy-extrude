/**
 * SelectionManager.test.js — frame-chain visibility rooting (THREE-free).
 *
 * Focus: showFrameChain() must make a CoordinateFrame tree visible whether the
 * tree is rooted at a geometry Solid (ADR-037) OR at a world-parented root
 * CoordinateFrame — the robot TF tree (robot_base → tcp / user frames,
 * ADR-084/085). The regression: selecting the robot or any robot-attached frame
 * showed nothing because the root walk bailed out on a parentless root frame.
 *
 * Run with:  node --test src/controller/SelectionManager.test.js
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { SelectionManager } from './SelectionManager.js'
import { CoordinateFrame } from '../domain/CoordinateFrame.js'

/** Minimal CoordinateFrame stub: real prototype (for instanceof), recording view. */
function makeFrame(id, parentId) {
  const meshView = {
    state: 'hidden',
    connection: null,
    showFull()      { this.state = 'full' },
    showDimmed()    { this.state = 'dimmed' },
    hide()          { this.state = 'hidden' },
    showConnection(dimmed) { this.connection = dimmed ? 'dimmed' : 'full' },
    hideConnection()       { this.connection = null },
    setObjectSelected() {},
  }
  const f = Object.create(CoordinateFrame.prototype)
  return Object.assign(f, { id, parentId, meshView })
}

/** A plain (non-CoordinateFrame) geometry object stub. */
function makeSolid(id) {
  return { id, parentId: null, meshView: { showFull() {}, hide() {} } }
}

/** Fake scene backed by a Map; children resolved by parentId scan. */
function makeScene(objs) {
  const byId = new Map(objs.map(o => [o.id, o]))
  return {
    getObject: id => byId.get(id) ?? null,
    getChildren: pid => objs.filter(o => o.parentId === pid),
    isLinkEndpoint: () => false,
  }
}

function makeCtrl(objs) {
  return { _scene: makeScene(objs), _activeFrameChain: new Set() }
}

test('geometry-rooted tree: selecting a child frame shows the whole tree', () => {
  const solid = makeSolid('solid')
  const origin = makeFrame('origin', 'solid')
  const child  = makeFrame('child', 'origin')
  const ctrl = makeCtrl([solid, origin, child])
  const mgr = new SelectionManager(ctrl)

  mgr.showFrameChain('child')

  assert.equal(child.meshView.state, 'full')
  assert.equal(origin.meshView.state, 'dimmed')
  assert.equal(child.meshView.connection, 'full')     // selected → full line
  assert.equal(origin.meshView.connection, 'dimmed')  // non-selected → dimmed line
  assert.deepEqual([...ctrl._activeFrameChain].sort(), ['child', 'origin'])
})

test('robot tree: selecting robot_base (world-parented root) shows the whole TF tree', () => {
  const base = makeFrame('base', null)   // world-parented root (robot_base)
  const tcp  = makeFrame('tcp', 'base')
  const ctrl = makeCtrl([base, tcp])
  const mgr = new SelectionManager(ctrl)

  mgr.showFrameChain('base')

  // The root frame itself must be visible — this is the tap feedback (#2).
  assert.equal(base.meshView.state, 'full')
  assert.equal(tcp.meshView.state, 'dimmed')
  // The root frame has no CF parent → no degenerate connection line.
  assert.equal(base.meshView.connection, null)
  // tcp hangs off robot_base → connection line, dimmed (not the selected frame).
  assert.equal(tcp.meshView.connection, 'dimmed')
  assert.deepEqual([...ctrl._activeFrameChain].sort(), ['base', 'tcp'])
})

test('robot tree: selecting a user frame added under robot_base shows it (#1)', () => {
  const base = makeFrame('base', null)
  const tcp  = makeFrame('tcp', 'base')
  const user = makeFrame('user', 'base')   // "Add Frame" on the robot
  const ctrl = makeCtrl([base, tcp, user])
  const mgr = new SelectionManager(ctrl)

  mgr.showFrameChain('user')

  assert.equal(user.meshView.state, 'full')   // the newly added frame is visible
  assert.equal(base.meshView.state, 'dimmed')
  assert.equal(tcp.meshView.state, 'dimmed')
  assert.equal(user.meshView.connection, 'full')
  assert.equal(base.meshView.connection, null)  // root frame: still no line
  assert.deepEqual([...ctrl._activeFrameChain].sort(), ['base', 'tcp', 'user'])
})
