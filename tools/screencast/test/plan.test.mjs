import { test } from 'node:test'
import assert from 'node:assert/strict'
import { plan, frameState, pointerAt, cameraAt } from '../src/plan.mjs'
import { CORE_ACTIONS, arcPoint, keyCaps } from '../src/actions.mjs'
import { DEFAULTS } from '../src/dsl.mjs'
import { expectedSeconds, ffmpegPasses, outputHeight } from '../src/encode.mjs'

const style = DEFAULTS.style
const vp = { width: 1000, height: 500 }
const home = { x: 500, y: 300 }
const steps = (...s) => s.map((x, i) => ({ ...x, origin: [i] }))

test('blocking steps queue, async steps overlap, untilMs links same kinds', () => {
  const p = plan(steps(
    { do: 'caption', text: 'a' },
    { do: 'wait', duration: 300 },
    { do: 'focus', zoom: 2, duration: 1000 },
    { do: 'wait', duration: 200 },
    { do: 'caption', text: 'b' },
  ), CORE_ACTIONS, style)
  assert.deepEqual(p.items.map(i => i.start), [0, 0, 300, 300, 500])
  assert.equal(p.items[0].untilMs, 500)
  assert.equal(p.totalMs, 1300)       // the async focus outlives the last blocking step
})

test('pace scales every duration', () => {
  const p = plan(steps({ do: 'wait', duration: 1000 }), CORE_ACTIONS, style, 0.5)
  assert.equal(p.totalMs, 500)
})

test('click: travels on a curve, presses once, on the target', () => {
  const p = plan(steps({ do: 'click', target: { viewport: [0, 0] } }), CORE_ACTIONS, style)
  const resolved = new Map([[0, { from: { x: 0, y: 0 }, to: { x: 100, y: 50 } }]])
  const samples = Array.from({ length: 71 }, (_, i) => pointerAt(i * 10, p, resolved, home))
  const downs = samples.filter(s => s.down)
  assert.ok(downs.length >= 8 && downs.length <= 10)
  for (const d of downs) assert.deepEqual([Math.round(d.x), Math.round(d.y)], [100, 50])
  const mid = arcPoint({ x: 0, y: 0 }, { x: 100, y: 50 }, 0.5)
  assert.notDeepEqual([mid.x, mid.y], [50, 25])            // bowed, not a ruler line
})

test('drag: button is held only through the stroke and released after it settles', () => {
  const p = plan(steps({ do: 'drag', to: { viewport: [1, 1] }, duration: 1000 }), CORE_ACTIONS, style)
  const r = new Map([[0, { here: { x: 0, y: 0 }, from: { x: 0, y: 0 }, to: { x: 200, y: 0 }, approach: 0 }]])
  assert.equal(pointerAt(0, p, r, home).down, false)
  assert.equal(pointerAt(500, p, r, home).down, true)
  const end = pointerAt(960, p, r, home)
  assert.equal(Math.round(end.x), 200)                  // already at the goal while still held
  assert.equal(pointerAt(1000, p, r, home).down, false)
})

test('idle drift is continuous at the end of a gesture and stays tiny', () => {
  const p = plan(steps({ do: 'move', to: { viewport: [0, 0] }, duration: 400 }), CORE_ACTIONS, style)
  const r = new Map([[0, { from: { x: 0, y: 0 }, to: { x: 10, y: 10 } }]])
  const a = pointerAt(400, p, r, home), b = pointerAt(433, p, r, home)
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 0.5)
  for (let t = 400; t < 20000; t += 250) {
    const q = pointerAt(t, p, r, home)
    assert.ok(Math.hypot(q.x - 10, q.y - 10) < 6)
  }
})

test('camera folds focus steps: zoom in, then back out from wherever it was', () => {
  const p = plan(steps(
    { do: 'focus', zoom: 2, duration: 100 },
    { do: 'wait', duration: 200 },
    { do: 'focus', zoom: 1, duration: 100 },
  ), CORE_ACTIONS, style)
  const r = new Map([[0, { center: { x: 500, y: 250 } }], [2, { center: null }]])
  assert.deepEqual(cameraAt(150, p, r, vp), { x: 250, y: 125, w: 500, h: 250 })
  assert.deepEqual(cameraAt(400, p, r, vp), { x: 0, y: 0, w: 1000, h: 500 })
  const c = cameraAt(250, p, r, vp)              // mid-way out: starts from the zoomed clip, not from full
  assert.ok(c.w > 500 && c.w < 1000)
})

test('focus near an edge clamps inside the frame instead of showing void', () => {
  const p = plan(steps({ do: 'focus', zoom: 2, duration: 0 }), CORE_ACTIONS, style)
  const c = cameraAt(10, p, new Map([[0, { center: { x: 10, y: 490 } }]]), vp)
  assert.deepEqual(c, { x: 0, y: 250, w: 500, h: 250 })
})

test('a newer key chip retires the older one at once', () => {
  const p = plan(steps({ do: 'key', keys: 'Shift+A' }, { do: 'key', keys: 'Enter' }), CORE_ACTIONS, style)
  const r = new Map([[0, {}], [1, {}]])
  const s = frameState(800, p, r, { style, viewport: vp, home })
  assert.deepEqual(s.chips.map(c => c.caps), [['↵ Enter']])
  assert.deepEqual(keyCaps('Shift+A'), ['⇧ Shift', 'A'])
})

test('frameState is a pure function of its inputs', () => {
  const p = plan(steps({ do: 'title', text: 'hi' }, { do: 'click', target: { viewport: [0, 0] } }), CORE_ACTIONS, style)
  const r = new Map([[0, {}], [1, { from: { x: 0, y: 0 }, to: { x: 9, y: 9 } }]])
  for (const t of [0, 1000, 2400, 2650]) {
    assert.deepEqual(frameState(t, p, r, { style, viewport: vp, home }), frameState(t, p, r, { style, viewport: vp, home }))
  }
})

test('gif lane: normalise to a fixed size first, then palette passes that never see a size change', () => {
  const info = { framesDir: '/f', ext: 'png', fps: 30, srcWidth: 1280, srcHeight: 720 }
  const gif = ffmpegPasses({ format: 'gif', path: 'o.gif', width: 880, fps: 15 }, info).map(a => a.join(' '))
  // captured frames drift to 1279×719 under the zoom camera; a size change rebuilds the graph and
  // paletteuse on ffmpeg 6.1 then truncates silently (23 of 238 frames) — so only pass 0 reads the PNGs
  assert.equal(gif.length, 3)
  assert.match(gif[0], /%05d\.png.*fps=15,scale=880:496:/)
  for (const pass of gif.slice(1)) { assert.doesNotMatch(pass, /%05d|scale=|split/); assert.match(pass, /o\.gif\.norm\.mkv/) }
  assert.match(gif[1], /palettegen/); assert.match(gif[2], /paletteuse/)
  const [mp4] = ffmpegPasses({ format: 'mp4', path: 'o.mp4' }, info).map(a => a.join(' '))
  assert.match(mp4, /libx264/); assert.match(mp4, /scale=1280:720:.*yuv420p/)
})

test('output height is explicit and even — never `-2`, which drifts with the captured size', () => {
  assert.equal(outputHeight(880, 1280, 720), 496)
  assert.equal(outputHeight(1280, 1280, 720), 720)
})

test('an output must last as long as the capture (GIF folds duplicate frames, so count is not the measure)', () => {
  assert.equal(expectedSeconds(475, 30), 475 / 30)
})
