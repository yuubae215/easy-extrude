import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'

// Minimal DOM: EntityLabel only creates one div and appends it.
globalThis.document ??= {
  createElement: () => ({ style: {}, set textContent(v) { this._t = v }, get textContent() { return this._t } }),
}
const { EntityLabel } = await import('./EntityLabel.js')

function setup() {
  const container = { appendChild() {} }
  const renderer = {
    domElement: {
      clientWidth: 200, clientHeight: 100,
      getBoundingClientRect: () => ({ width: 200, height: 100, left: 0, top: 0 }),
    },
  }
  const label = new EntityLabel(renderer, container)
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
  cam.position.set(0, 0, 5)
  cam.updateMatrixWorld()
  label.setWanted(true)
  label.updatePosition(cam, new THREE.Vector3(0, 0, 0))
  return { label, cam }
}

test('highlighting a label keeps its position (ADR-166 M3b — one writer of transform)', () => {
  // The defect: setHighlighted wrote `transform: scale(1.18)` and erased the
  // translate3d — the label jumped to the corner, and with a still camera the
  // dead-zone filter never rewrote it.
  const { label, cam } = setup()
  const placed = label._el.style.transform
  assert.match(placed, /^translate3d\(/)
  label.setHighlighted(true)
  assert.match(label._el.style.transform, /^translate3d\(106px,34px,0\) scale\(1\.18\)$/)
  // A still camera: the dead-zone filter skips the rewrite — the position must survive.
  label.updatePosition(cam, new THREE.Vector3(0, 0, 0))
  assert.match(label._el.style.transform, /^translate3d\(106px,34px,0\) scale/)
  label.setHighlighted(false)
  assert.equal(label._el.style.transform, placed)
})

test('highlighting before the first projection writes no transform', () => {
  const label = new EntityLabel({ domElement: {} }, { appendChild() {} })
  label.setHighlighted(true)
  assert.equal(label._el.style.transform, undefined)
})
