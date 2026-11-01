/**
 * ADR-158 replay stage R2 — the replay is derived from the judged samples:
 * only a judged frame carries hits (G1), the time axis is the client's and is a
 * function of the clock (G2 / D3), the arm keeps the authority of who decided
 * it, and an unavailable replay says why.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { MOTION_PHASES, UNEVALUATED_REASON_TEXT } from './GraspPhaseMath.js'
import {
  phaseTimeline, replayFrame, replayFor, sampleStops, stepStop, playheadAt, armContinuous,
  struckObstacles, replayCaption, REPLAY_ARM_TEXT, UNJUDGED_SPAN, BRANCH_JUMP_RAD, SAMPLE_SNAP,
} from './GraspReplayMath.js'

const schema = JSON.parse(readFileSync(
  new URL('../../packages/grasp-contract/schema/grasp-search-response.schema.json', import.meta.url), 'utf8'))



const J0 = [0, -1, 1, 0, 1, 0]
const shift = (j, d) => j.map(q => q + d)
const measured = (joints, obstacles = []) => ({ kind: 'measured', joints, obstacles })
const judged = (joints, obstacles = []) => ({ kind: 'judged', joints, obstacles })
const sample = (s, arm, hits = [], tcp = [0.5, 0, 0.3 - 0.1 * s]) => ({ s, tcp, hits, arm })

/** A v11-shaped replay: approach (3 samples, ends on the judged pick pose), close (sweep), lift (2). */
function fixtureReplay() {
  return {
    rank: 1,
    phases: [
      { phase: 'approach', samples: [
        sample(0, measured(shift(J0, 0.2))),
        sample(0.5, measured(shift(J0, 0.1), [2])),
        sample(1, judged(J0)),
      ] },
      { phase: 'close', hits: [{ part: 'hand', obstacleIndex: 4 }] },
      { phase: 'lift', samples: [
        sample(0, judged(J0), [], [0.5, 0, 0.2]),
        sample(1, measured(shift(J0, 0.05)), [], [0.5, 0, 0.28]),
      ] },
    ],
  }
}
const fixtureRows = [
  { phase: 'transit', kind: 'unevaluated', reason: 'notYetDecided' },
  { phase: 'approach', kind: 'evaluated', rejected: 0 },
  { phase: 'close', kind: 'evaluated', rejected: 0 },
  { phase: 'lift', kind: 'evaluated', rejected: 0 },
  { phase: 'transport', kind: 'unevaluated', reason: 'notYetDecided' },
  { phase: 'place', kind: 'unevaluated', reason: 'notYetDecided' },
]

test('replay: the arm words cover the contract\'s replayArm kinds exactly (population = the schema)', () => {
  const kinds = schema.$defs.replayArm.oneOf.map(b => b.properties.kind.const).sort()
  assert.deepEqual(Object.keys(REPLAY_ARM_TEXT).sort(), kinds)
})

test('replay: the time line has every phase in motion order — judged = 1, not judged = a short stretch with its reason', () => {
  const tl = phaseTimeline(fixtureReplay(), fixtureRows)
  assert.deepEqual(tl.segments.map(s => s.phase), [...MOTION_PHASES])
  assert.deepEqual(tl.segments.map(s => s.kind), ['unjudged', 'path', 'sweep', 'path', 'unjudged', 'unjudged'])
  assert.equal(tl.total, 3 + 3 * UNJUDGED_SPAN)
  assert.equal(tl.segments[0].note, UNEVALUATED_REASON_TEXT.notYetDecided)
  // contiguous axis
  for (let i = 1; i < tl.segments.length; i++) {
    assert.equal(tl.segments[i].start, tl.segments[i - 1].start + tl.segments[i - 1].length)
  }
})

test('replay: a judged phase with no samples is a broken response, not a quiet gap (R1-4)', () => {
  const r = fixtureReplay()
  r.phases = r.phases.filter(p => p.phase !== 'lift')
  assert.throws(() => phaseTimeline(r, fixtureRows), /判定されたのに再生が無い/)
  assert.throws(() => phaseTimeline({ phases: [{ phase: 'teleport', samples: [] }] }, fixtureRows), /未宣言の/)
})

test('replay G1: ONLY a judged frame carries hits — every frame between samples strikes nothing', () => {
  const tl = phaseTimeline(fixtureReplay(), fixtureRows)
  for (let k = 0; k <= 2000; k++) {
    const f = replayFrame(tl, (tl.total * k) / 2000)
    if (f.kind === 'between' || f.kind === 'unjudged') assert.deepEqual(f.hits, [], `${f.kind} at ${k}`)
  }
  const approach = tl.segments[1]
  const onSample = replayFrame(tl, approach.start + 0.5)
  assert.equal(onSample.kind, 'sample')
  assert.deepEqual(onSample.hits, [{ part: 'arm', obstacleIndex: 2, judged: false }])
  const justOff = replayFrame(tl, approach.start + 0.5 + SAMPLE_SNAP * 2)
  assert.equal(justOff.kind, 'between')
  assert.deepEqual(justOff.hits, [])
})

test('replay: the arm keeps the authority of who decided it — judged at its own TCP = solved, anything else = measured', () => {
  const tl = phaseTimeline(fixtureReplay(), fixtureRows)
  const a = tl.segments[1]
  assert.equal(replayFrame(tl, a.start + 1 - 1e-6).arm.authority, 'solved')       // the judged pick pose
  assert.equal(replayFrame(tl, a.start).arm.authority, 'measured')
  assert.equal(replayFrame(tl, a.start + 0.25).arm.authority, 'measured')         // interpolated
  // the sweep holds the pick pose at the pick TCP — still the judged pose
  const sweep = replayFrame(tl, tl.segments[2].start + 0.5)
  assert.equal(sweep.kind, 'sweep')
  assert.equal(sweep.arm.authority, 'solved')
  assert.deepEqual(sweep.hits, [{ part: 'hand', obstacleIndex: 4, judged: true }])
  assert.equal(sweep.closure, 0.5)
})

test('replay ①: across a branch jump the arm is HELD, never swept through a rotation nobody solved', () => {
  const r = fixtureReplay()
  r.phases[0].samples[0].arm = measured(shift(J0, 1.0))
  r.phases[0].samples[1].arm = measured(shift(J0, BRANCH_JUMP_RAD + 0.1))   // jumps to the judged J0
  assert.equal(armContinuous(r.phases[0].samples[0].arm, r.phases[0].samples[1].arm), true)
  assert.equal(armContinuous(r.phases[0].samples[1].arm, r.phases[0].samples[2].arm), false)
  const tl = phaseTimeline(r, fixtureRows)
  const f = replayFrame(tl, tl.segments[1].start + 0.75)
  assert.equal(f.kind, 'between')
  assert.equal(f.armHeld, true)
  assert.deepEqual([...f.arm.joints], r.phases[0].samples[1].arm.joints)
  // continuous neighbours interpolate
  const g = replayFrame(tl, tl.segments[1].start + 0.25)
  assert.equal(g.armHeld, false)
  assert.ok(Math.abs(g.arm.joints[0] - (1.0 + (BRANCH_JUMP_RAD + 0.1 - 1.0) * 0.5)) < 1e-9)
})

test('replay ③: a sample with no joint solution rests the arm; undeclared kinematics draw no arm anywhere', () => {
  const r = fixtureReplay()
  r.phases[0].samples[1].arm = { kind: 'noSolution' }
  const tl = phaseTimeline(r, fixtureRows)
  const f = replayFrame(tl, tl.segments[1].start + 0.5)
  assert.equal(f.arm, null)
  assert.equal(f.armNote, REPLAY_ARM_TEXT.noSolution)
  const und = fixtureReplay()
  for (const p of und.phases) for (const x of p.samples ?? []) x.arm = { kind: 'undeclared' }
  const tl2 = phaseTimeline(und, fixtureRows)
  for (let k = 0; k <= 100; k++) assert.equal(replayFrame(tl2, (tl2.total * k) / 100).arm, null)
})

test('replay: the TCP between samples is on the phase\'s straight line', () => {
  const tl = phaseTimeline(fixtureReplay(), fixtureRows)
  const f = replayFrame(tl, tl.segments[1].start + 0.25)
  assert.ok(Math.abs(f.tcp[2] - (0.3 - 0.1 * 0.25)) < 1e-12)
  // a phase nobody judged holds the nearest judged pose (transit → approach's first sample)
  assert.deepEqual(replayFrame(tl, 0.1).tcp, fixtureReplay().phases[0].samples[0].tcp)
  assert.deepEqual(replayFrame(tl, tl.total).tcp, [0.5, 0, 0.28])
})

test('replay: stepping visits every judged sample (and the sweep once), in order, both ways', () => {
  const tl = phaseTimeline(fixtureReplay(), fixtureRows)
  const stops = sampleStops(tl)
  assert.equal(stops.length, 3 + 1 + 2)
  let at = -1; const seen = []
  for (let i = 0; i < stops.length; i++) { at = stepStop(tl, at, 1); seen.push(at) }
  assert.deepEqual(seen, stops)
  assert.equal(stepStop(tl, stops.at(-1), 1), stops.at(-1))     // clamps at the end
  assert.equal(stepStop(tl, stops[2], -1), stops[1])
  // every stop shows the thing stepped onto: a judged sample (each one, including
  // the s = 1 sample on the segment boundary) or the sweep
  const kinds = stops.map(s => replayFrame(tl, s).kind)
  assert.deepEqual(kinds, ['sample', 'sample', 'sample', 'sweep', 'sample', 'sample'])
  assert.deepEqual(stops.slice(0, 3).map(s => replayFrame(tl, s).sampleIndex), [0, 1, 2])
  assert.equal(replayFrame(tl, stops[2]).arm.authority, 'solved', 'the judged pick pose is reachable by stepping')
})

test('replay D3/G2: the playhead is a function of the clock — the same instant gives the same place, at any frame rate', () => {
  const anchor = { t0: 1000, at0: 0.5 }
  const at30 = []; const at60 = []
  for (let t = 1000; t <= 3000; t += 1000 / 30) at30.push([t, playheadAt(anchor, t, 4).at])
  for (let t = 1000; t <= 3000; t += 1000 / 60) at60.push([t, playheadAt(anchor, t, 4).at])
  const at = (t) => playheadAt(anchor, t, 4).at
  for (const [t, x] of at30) assert.equal(x, at(t))
  assert.equal(playheadAt(anchor, 1000 + 10 * 1200, 4).at, 4)
  assert.equal(playheadAt(anchor, 1000 + 10 * 1200, 4).ended, true)
  // calling twice at the same time is the same answer (no accumulator)
  assert.equal(at(1500), at(1500))
  assert.ok(at60.length > at30.length)
})

test('replay: unavailable says why — never a silent empty player', () => {
  const grasp = { status: 'results', request: {}, selectedRank: 1 }
  assert.match(replayFor(null, grasp, 1).reason, /Analyse all phases/)
  assert.match(replayFor({ status: 'done', request: {}, analysis: { replays: [] } }, grasp, 1).reason, /earlier search/)
  const st = { status: 'done', request: grasp.request, analysis: { replays: [{ rank: 2, phases: [] }] } }
  assert.match(replayFor(st, grasp, null).reason, /Select a candidate/)
  assert.match(replayFor(st, grasp, 1).reason, /#1/)
  assert.equal(replayFor(st, grasp, 2).kind, 'ready')
})

test('replay: struck obstacles are the request\'s own shapes, judged if any hit on it was judged', () => {
  const obstacles = [{ kind: 'box', center: [0, 0, 0], halfExtents: [1, 1, 1], orientation: [0, 0, 0, 1] },
    { kind: 'sphere', center: [1, 1, 1], radius: 0.1 }]
  const out = struckObstacles({ hits: [
    { part: 'arm', obstacleIndex: 1, judged: false }, { part: 'hand', obstacleIndex: 1, judged: true },
    { part: 'arm', obstacleIndex: 0, judged: false },
  ] }, obstacles)
  assert.deepEqual(out.map(o => [o.obstacleIndex, o.judged]), [[0, false], [1, true]])
  assert.equal(out[1].shape, obstacles[1])
  const tl = phaseTimeline(fixtureReplay(), fixtureRows)
  assert.match(replayCaption(replayFrame(tl, tl.segments[1].start + 0.5), tl), /sample 2\/3 .* judged/)
  assert.match(replayCaption(replayFrame(tl, tl.segments[1].start + 0.25), tl), /not judged/)
})

test('replay D3: no seconds / fps / speed travel on the wire — the time axis is the client\'s', () => {
  const text = JSON.stringify(schema.$defs.candidateReplay) + JSON.stringify(schema.$defs.replayPhase) + JSON.stringify(schema.$defs.replaySample)
  for (const k of ['"t"', 'fps', 'seconds', 'speed', 'durationMs']) assert.ok(!text.includes(`${k}":`) && !text.includes(`"${k}"`), k)
})
