/**
 * SemanticInferencer — what is offered after a move (ADR-041, ADR-168 S2-1).
 * The arrangement offers are read by the domain's closed form, carry no score,
 * and are made only in someone's name.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Vector3 } from 'three'
import { Solid } from '../domain/Solid.js'
import { Vertex } from '../graph/Vertex.js'
import { AnnotatedRegion } from '../domain/AnnotatedRegion.js'
import { inferSuggestions, bodyOfSolid, computeApproachWarmth } from './SemanticInferencer.js'

/** An axis-aligned box Solid (mm) from its min and max corners. */
function boxSolid(id, [x0, y0, z0], [x1, y1, z1]) {
  const pts = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ]
  return new Solid(id, id, pts.map((p, i) => new Vertex(`${id}v${i}`, new Vector3(...p))), null)
}

// The template's workbench and a bin standing on it.
const bench = boxSolid('bench', [-300, -250, 0], [300, 250, 800])
const bin = boxSolid('bin', [100, 75, 800], [300, 225, 950])
const refs = { bench: 'worktable', bin: 'part_bin' }
const ctx = (over = {}) => ({
  existingPairs: new Set(),
  refOf: (id) => refs[id] ?? null,
  speaker: 'operator',
  claimedPairs: new Set(),
  ...over,
})

test('a bin standing on the bench is offered as resting on its +z face, in the speaker\'s name', () => {
  const [s, ...rest] = inferSuggestions(bin, [bench, bin], ctx())
  assert.equal(rest.length, 0)
  assert.equal(s.kind, 'arrangement')
  assert.deepEqual(s.side, { of: 'worktable', contact: 'touching', toward: '+z' })
  assert.equal(s.cell, 'touching:+z')
  assert.equal(s.subjectRef, 'part_bin')
  assert.equal(s.partnerRef, 'worktable')
  assert.equal(s.label, 'Resting on', 'the combination\'s own name')
})

test('no score and no ranking: an offer carries no confidence', () => {
  const [s] = inferSuggestions(bin, [bench, bin], ctx())
  assert.equal('confidence' in s, false)
})

test('nobody speaking → no arrangement is offered (a claim needs a claimant — ADR-168 D5)', () => {
  assert.deepEqual(inferSuggestions(bin, [bench, bin], ctx({ speaker: null })), [])
})

test('a thing outside the document is never a subject or a partner', () => {
  assert.deepEqual(inferSuggestions(bin, [bench, bin], ctx({ refOf: (id) => (id === 'bin' ? 'part_bin' : null) })), [])
  assert.deepEqual(inferSuggestions(bin, [bench, bin], ctx({ refOf: (id) => (id === 'bench' ? 'worktable' : null) })), [])
})

test('a pair the speaker already claims, in either order, is not offered again', () => {
  assert.deepEqual(inferSuggestions(bin, [bench, bin], ctx({ claimedPairs: new Set(['part_bin|worktable']) })), [])
  assert.deepEqual(inferSuggestions(bin, [bench, bin], ctx({ claimedPairs: new Set(['worktable|part_bin']) })), [])
})

test('lifted 50 mm: apart, nothing offered (the old "above" no longer exists as an offer)', () => {
  const lifted = boxSolid('bin', [100, 75, 850], [300, 225, 1000])
  assert.deepEqual(inferSuggestions(lifted, [bench, lifted], ctx()), [])
})

test('side by side: touching the bench\'s +x face', () => {
  const beside = boxSolid('bin', [300, -50, 0], [400, 50, 100])
  const [s] = inferSuggestions(beside, [bench, beside], ctx())
  assert.deepEqual(s.side, { of: 'worktable', contact: 'touching', toward: '+x' })
  assert.equal(s.label, 'Touching +x')
})

test('on an edge two faces touch: contact only — saying either face would choose', () => {
  const corner = boxSolid('bin', [300, 250, 800], [400, 350, 900])
  const [s] = inferSuggestions(corner, [bench, corner], ctx())
  assert.deepEqual(s.side, { of: 'worktable', contact: 'touching' })
  assert.equal(s.cell, 'touching:_')
})

test('several touched partners come out in partner-ref order (deterministic, not ranked)', () => {
  const left = boxSolid('left', [-100, -50, 0], [0, 50, 100])
  const right = boxSolid('right', [100, -50, 0], [200, 50, 100])
  const mid = boxSolid('mid', [0, -50, 0], [100, 50, 100])
  const r = { left: 'z_left', right: 'a_right', mid: 'mid' }
  const out = inferSuggestions(mid, [left, right, mid], ctx({ refOf: (id) => r[id] }))
  assert.deepEqual(out.map(s => s.partnerRef), ['a_right', 'z_left'])
})

test('contains is still offered as a SpatialLink, after the arrangements', () => {
  const region = new AnnotatedRegion('zone', 'Zone', [
    new Vertex('r0', new Vector3(0, 0, 0)), new Vertex('r1', new Vector3(500, 0, 0)),
    new Vertex('r2', new Vector3(500, 500, 0)), new Vertex('r3', new Vector3(0, 500, 0)),
  ], null)
  const out = inferSuggestions(bin, [bench, region, bin], ctx())
  assert.deepEqual(out.map(s => s.kind), ['arrangement', 'link'])
  assert.equal(out[1].semanticType, 'contains')
  assert.equal(out[1].sourceId, 'zone')
})

test('bodyOfSolid reads the live pose in the shape the geometry takes', () => {
  const b = bodyOfSolid(bin)
  assert.deepEqual(b.center, { x: 200, y: 150, z: 875 })
  assert.deepEqual(b.size, { x: 200, y: 150, z: 150 })
})

test('approach warmth starts within 3 × the contact tolerance (mm), not the metre-era 0.45', () => {
  const near = boxSolid('bin', [100, 75, 802], [300, 225, 952])   // 2 mm above the bench
  const far = boxSolid('bin', [100, 75, 810], [300, 225, 960])    // 10 mm above
  assert.equal(computeApproachWarmth(near, [bench, near]).length, 1)
  assert.equal(computeApproachWarmth(far, [bench, far]).length, 0)
})

test('the offered side is complete: the domain accepts it as written (what is offered is what is claimed)', async () => {
  const { arrangementIssues } = await import('../domain/arrangement.js')
  const [s] = inferSuggestions(bin, [bench, bin], ctx())
  const issues = arrangementIssues(
    [{ ref: 'r', by: s.by, subject: s.subjectRef, sides: [s.side] }],
    { actorRefs: new Set(['operator']), solidRefs: new Set(['part_bin', 'worktable']), viewers: new Map(), kinematicLinks: [] },
  )
  assert.deepEqual(issues, [])
})
