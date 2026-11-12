/**
 * GraspReplayMath — the replay of the JUDGED samples, derived (ADR-158 replay
 * stage R2).
 *
 * The wire carries the samples the solver judged once (contract v11,
 * `interferenceAnalysis.replays`). Everything that makes them a motion — the
 * time axis (`phaseTimeline`), where the playhead is (`playheadAt`), the frame
 * at a position (`replayFrame`), the pose between two samples — is derived
 * here, client-side (原則 #29). A derived frame never carries a hit: nobody
 * judged that pose (ADR-158 G1).
 *
 * The phase words come from `GraspPhaseMath` (read, never copied — §1.1).
 * Pure (no THREE / no DOM / no store).
 *
 * @module view/GraspReplayMath
 */
import {
  MOTION_PHASES, PHASE_LABEL, UNEVALUATED_REASON_TEXT, analysisFreshness,
} from './GraspPhaseMath.js'

function lookup(table, key, name) {
  if (!Object.prototype.hasOwnProperty.call(table, key)) {
    throw new Error(`GraspReplayMath: 未宣言の${name} "${key}" — 表に行を足すこと (ADR-158 / 原則 #31)`)
  }
  return table[key]
}

/**
 * How long a phase nobody judged occupies on the time line, relative to a judged
 * phase's 1 (当事者合意 2026-11-01 ④). Short so the judged phases fill the bar,
 * never 0 so the reason has a place to be read (原則 #15).
 */
export const UNJUDGED_SPAN = 0.25

/**
 * The joint change between two neighbouring samples beyond which the arm is
 * treated as having JUMPED to another solution branch (当事者合意 2026-11-01 ①).
 * A display threshold, not a judgement: past it, a straight line in joint space
 * would sweep the arm through a rotation nobody solved, so the frames between
 * hold the earlier sample's arm and it switches at the next sample.
 */
export const BRANCH_JUMP_RAD = Math.PI / 2

/**
 * How close (in s) the playhead must be to a sample to show THAT sample — the
 * judged frame — rather than a frame between. Stepping lands exactly; playing
 * passes through each sample for a few frames.
 */
export const SAMPLE_SNAP = 0.02

/** Real-time length of one judged phase at the default speed. */
export const REPLAY_PHASE_MS = 1200

/** The arm kinds the wire carries at a sample (`replayArm.kind`), and how each is drawn. */
export const REPLAY_ARM_TEXT = Object.freeze({
  judged:     'arm: the pose the search judged',
  measured:   'arm: measured only (not used to reject)',
  noSolution: 'arm: no joint solution here — shown at rest',
  undeclared: 'arm: not placed — declare the robot\'s kinematics',
})

/**
 * What a replay is OF — a returned candidate, or the representative of an
 * interference rejection (ADR-158 R3). A closed kind: the subject is matched by
 * `sameSubject`, never by comparing ranks (a rejected representative has no rank).
 */
export const REPLAY_SUBJECT = Object.freeze({
  RETURNED: 'returned',
  REJECTED: 'rejected',
})

/** The subject of a returned candidate's replay. */
export const returnedSubject = (rank) => ({ kind: REPLAY_SUBJECT.RETURNED, rank })

/** The subject of a rejected group's representative: the group IS its identity (phase × obstacle). */
export const rejectedSubject = (phase, obstacleIndex) => ({ kind: REPLAY_SUBJECT.REJECTED, phase, obstacleIndex })

/** Whether two subjects name the same replay. Throws on an undeclared kind (原則 #31). */
export function sameSubject(a, b) {
  if (!a || !b || a.kind !== b.kind) return false
  switch (a.kind) {
    case REPLAY_SUBJECT.RETURNED: return a.rank === b.rank
    case REPLAY_SUBJECT.REJECTED: return a.phase === b.phase && a.obstacleIndex === b.obstacleIndex
    default: throw new Error(`GraspReplayMath: 未宣言の再生の対象 "${a.kind}" (ADR-158 R3)`)
  }
}

/**
 * Why there is no fresh all-phase analysis to replay from, or null when there is.
 * Shared by both kinds of subject — they are replayed from the same analysis.
 */
function analysisUnavailable(analysisState, grasp) {
  if (analysisState?.status !== 'done') return 'Analyse all phases first — the replay draws what that analysis judged.'
  if (analysisFreshness(analysisState, grasp) !== 'fresh') return 'The analysis is of an earlier search — run it again to replay this one.'
  return null
}

/**
 * The replay for one subject, or why there is none. Fresh analysis only: an
 * analysis of an earlier search would replay a request the screen no longer
 * shows (鮮度は分析と同じ導出 — ADR-158 D4 / 原則 #23). Returns the pose the
 * replay is of, so the caller never looks it up a second way.
 *
 * A bare number is read as a returned candidate's rank (the R2 call shape).
 *
 * @param {object|null} analysisState  `context.graspAnalysis`
 * @param {object|null} grasp          `context.grasp`
 * @param {{kind:string}|number|null} subject
 * @returns {{kind:'ready', replay:object, pose:object|null}|{kind:'unavailable', reason:string}}
 */
export function replayFor(analysisState, grasp, subject) {
  const no = (reason) => ({ kind: 'unavailable', reason })
  const stale = analysisUnavailable(analysisState, grasp)
  if (stale) return no(stale)
  const s = typeof subject === 'number' ? returnedSubject(subject) : subject
  if (s == null || (s.kind === REPLAY_SUBJECT.RETURNED && s.rank == null)) return no('Select a candidate to replay its motion.')
  switch (s.kind) {
    case REPLAY_SUBJECT.RETURNED: {
      const replays = analysisState.analysis?.replays
      if (!Array.isArray(replays)) return no('This backend returns no replay samples (contract before v11).')
      const replay = replays.find(r => r.rank === s.rank)
      if (!replay) return no(`The analysis returned no samples for candidate #${s.rank}.`)
      const pose = (grasp?.candidates ?? []).find(c => c.rank === s.rank)?.pose ?? null
      return { kind: 'ready', replay, pose }
    }
    case REPLAY_SUBJECT.REJECTED: {
      const list = rejectedReplayList(analysisState, grasp)
      if (list.kind !== 'ready') return no(list.reason)
      const item = list.items.find(r => sameSubject(rejectedSubject(r.phase, r.obstacleIndex), s))
      if (!item) return no('That rejection is not among the ones this analysis returned.')
      return { kind: 'ready', replay: item, pose: item.pose ?? null }
    }
    default: throw new Error(`GraspReplayMath: 未宣言の再生の対象 "${s.kind}" (ADR-158 R3)`)
  }
}

/**
 * The short name of a replay's subject, for the ghost's caption and the panel:
 * `#3` for a returned candidate, `rejected · Lift × shelf` for a rejected
 * group's representative (the obstacle named by the sender's labels, or by its
 * index — names never ride the wire).
 */
export function subjectLabel(subject, obstacleLabels = []) {
  switch (subject?.kind) {
    case REPLAY_SUBJECT.RETURNED: return `#${subject.rank}`
    case REPLAY_SUBJECT.REJECTED:
      return `rejected · ${lookup(PHASE_LABEL, subject.phase, 'phase')} × ${obstacleLabels[subject.obstacleIndex] ?? `obstacle #${subject.obstacleIndex}`}`
    default: throw new Error(`GraspReplayMath: 未宣言の再生の対象 "${subject?.kind}" (ADR-158 R3)`)
  }
}

/**
 * The interference rejections the analysis returned a representative for
 * (ADR-158 R3, contract v12): one per (phase × obstacle), most-rejected first,
 * as the solver ordered them, with how many groups were left out. The client
 * neither picks nor re-orders them — the choice is core/'s (ADR-146 axis 1).
 *
 * @returns {{kind:'ready', items:object[], omitted:number}|{kind:'unavailable', reason:string}}
 */
export function rejectedReplayList(analysisState, grasp) {
  const stale = analysisUnavailable(analysisState, grasp)
  if (stale) return { kind: 'unavailable', reason: stale }
  const rr = analysisState.analysis?.rejectedReplays
  if (!rr || !Array.isArray(rr.items)) {
    return { kind: 'unavailable', reason: 'This backend returns no rejected candidates to replay (contract before v12).' }
  }
  return { kind: 'ready', items: rr.items, omitted: Number(rr.omitted) || 0 }
}

/**
 * The time line of one replay: every motion phase in motion order, each a
 * segment of the shared axis. A judged path phase (approach / lift) carries its
 * samples, closing the hand is ONE swept volume (its hits belong to the whole
 * segment — no instants are invented inside it), and a phase nobody judged is a
 * short segment carrying the reason from the phase rows (ADR-157).
 *
 * The axis is unitless (a judged phase = 1) and is NOT seconds (ADR-158 D3):
 * speed and frame rate are the player's, never facts.
 *
 * @param {{phases:object[]}} replay           one `replays[]` entry
 * @param {object[]|null} interferencePhases   the wire's `diagnostics.interferencePhases`
 * @returns {{total:number, segments:{phase:string, label:string, start:number, length:number,
 *            kind:'path'|'sweep'|'unjudged', samples?:object[], hits?:object[], note?:string}[]}}
 */
export function phaseTimeline(replay, interferencePhases) {
  const byPhase = new Map((replay?.phases ?? []).map(p => [p.phase, p]))
  const rowOf = new Map((interferencePhases ?? []).map(r => [r.phase, r]))
  for (const phase of byPhase.keys()) lookup(PHASE_LABEL, phase, 'phase')
  const segments = []
  let start = 0
  for (const phase of MOTION_PHASES) {
    const label = PHASE_LABEL[phase]
    const p = byPhase.get(phase)
    let seg
    if (p && Array.isArray(p.samples)) {
      seg = { phase, label, start, length: 1, kind: 'path', samples: p.samples }
    } else if (p && Array.isArray(p.hits)) {
      seg = { phase, label, start, length: 1, kind: 'sweep', hits: p.hits }
    } else if (p) {
      throw new Error(`GraspReplayMath: 再生の相 "${phase}" の形が宣言されていない (samples でも hits でもない — ADR-158)`)
    } else {
      const row = rowOf.get(phase)
      if (row?.kind === 'evaluated') {
        // The contract returns a replay for every evaluated phase (R1-4); a judged
        // phase with no samples is a broken response, never a quiet gap.
        throw new Error(`GraspReplayMath: 相 "${phase}" は判定されたのに再生が無い (ADR-158 R1-4)`)
      }
      const note = row?.kind === 'unevaluated'
        ? lookup(UNEVALUATED_REASON_TEXT, row.reason, 'unevaluated reason')
        : 'not judged'
      seg = { phase, label, start, length: UNJUDGED_SPAN, kind: 'unjudged', note }
    }
    segments.push(seg)
    start += seg.length
  }
  return { total: start, segments }
}

/** The axis positions of every judged sample, in order — the stops of a frame-by-frame step. */
export function sampleStops(timeline) {
  const stops = []
  for (const seg of timeline.segments) {
    if (seg.kind === 'path') for (const x of seg.samples) stops.push(seg.start + x.s * seg.length)
    else if (seg.kind === 'sweep') stops.push(seg.start + seg.length / 2)
  }
  return stops
}

/**
 * The next stop strictly after (dir = +1) or before (dir = −1) `at` — stepping
 * one judged sample at a time (the reduced-motion and on-site default, S5).
 */
export function stepStop(timeline, at, dir) {
  const stops = sampleStops(timeline)
  const eps = 1e-9
  if (dir > 0) return stops.find(s => s > at + eps) ?? stops.at(-1) ?? 0
  return [...stops].reverse().find(s => s < at - eps) ?? stops[0] ?? 0
}

/**
 * Where the playhead is at loop time `t` (ms) for a play started at `t0` from
 * `at0` — a FUNCTION of the clock, not an accumulator (ADR-166 M7 discipline),
 * so a dropped frame cannot drift the position. Ends at the line's end.
 */
export function playheadAt({ t0, at0 }, t, total, phaseMs = REPLAY_PHASE_MS) {
  const at = at0 + Math.max(0, t - t0) / phaseMs
  return { at: Math.min(total, at), ended: at >= total }
}

function armJoints(arm) {
  return (arm?.kind === 'judged' || arm?.kind === 'measured') && Array.isArray(arm.joints) ? arm.joints : null
}

/** Whether the arm stays on one solution branch between two samples (①). */
export function armContinuous(a, b) {
  const ja = armJoints(a); const jb = armJoints(b)
  if (!ja || !jb || ja.length !== jb.length) return false
  return ja.every((q, i) => Math.abs(jb[i] - q) <= BRANCH_JUMP_RAD)
}

/**
 * What the subject's arm draws at a frame, and on whose authority — the payload
 * `RobotStageSet.previewSolution` takes. `judged` is the search's own pose
 * (`solved`) when drawn at its own TCP; anything only measured, interpolated,
 * or held while the tcp moves on is `measured`
 * (drawn like an unverified arm — ②). No joints → `null` = rest (③).
 */
function armPayload(arm, kind) {
  const joints = armJoints(arm)
  if (!joints) return null
  return { authority: arm.kind === 'judged' && kind === 'sample' ? 'solved' : 'measured', joints }
}

function hitsOf(sample) {
  const struck = (sample.hits ?? []).map(h => ({ part: h.part, obstacleIndex: h.obstacleIndex, judged: true }))
  for (const o of sample.arm?.obstacles ?? []) {
    struck.push({ part: 'arm', obstacleIndex: o, judged: sample.arm.kind === 'judged' })
  }
  return struck
}

/** The pose a still segment (sweep / unjudged) holds: the nearest judged sample — earlier first. */
function heldSample(timeline, index) {
  for (let i = index - 1; i >= 0; i--) {
    const seg = timeline.segments[i]
    if (seg.kind === 'path') return seg.samples.at(-1)
  }
  for (let i = index + 1; i < timeline.segments.length; i++) {
    const seg = timeline.segments[i]
    if (seg.kind === 'path') return seg.samples[0]
  }
  return null
}

/** How closed the hand is at a frame: open on the approach, closing over the sweep, closed after. */
function handClosure(timeline, index, u) {
  const seg = timeline.segments[index]
  if (seg.kind === 'sweep') return u
  const closeIndex = timeline.segments.findIndex(s => s.phase === 'close')
  return closeIndex >= 0 && index > closeIndex ? 1 : 0
}

/**
 * The frame at axis position `at` (pure). Four kinds, and only ONE carries hits:
 *
 * - `sample`   — the playhead is on a judged sample: its tcp, its hits, its arm
 *                exactly as the wire says (G1).
 * - `between`  — between two samples: the tcp on the straight line (the phase's
 *                path IS that line), the arm linearly in joint space when it
 *                stays on one branch, otherwise HELD at the earlier sample.
 *                **`hits` is always empty** — nobody judged this pose.
 * - `sweep`    — closing the hand: the volume's hits for the whole segment
 *                (one judgement, no instants inside), the pick pose held.
 * - `unjudged` — a phase nobody judged: its reason, the nearest pose held, no hits.
 *
 * @returns {{kind:string, phase:string, label:string, u:number, tcp:number[]|null,
 *            hits:{part:string, obstacleIndex:number, judged:boolean}[],
 *            arm:{authority:'solved'|'measured', joints:readonly number[]}|null,
 *            armNote:string|null, armHeld:boolean, closure:number, note:string|null,
 *            sampleIndex:number|null}}
 */
export function replayFrame(timeline, at) {
  const segs = timeline.segments
  const x = Math.min(timeline.total, Math.max(0, Number.isFinite(at) ? at : 0))
  let index = segs.findIndex(s => x < s.start + s.length)
  if (index < 0) index = segs.length - 1
  // A path phase's last sample (s = 1) sits ON the boundary with the next
  // segment. Within the snap window it belongs to the path — otherwise the
  // judged pick pose could never be stepped onto (the next segment would claim
  // the boundary and show a held or not-judged frame instead).
  const prev = segs[index - 1]
  if (prev?.kind === 'path' && x - (prev.start + prev.length) <= SAMPLE_SNAP * prev.length) index--
  const seg = segs[index]
  const u = seg.length > 0 ? Math.min(1, Math.max(0, (x - seg.start) / seg.length)) : 0
  const base = { phase: seg.phase, label: seg.label, u, closure: handClosure(timeline, index, u), sampleIndex: null }

  if (seg.kind === 'path') {
    const samples = seg.samples
    const near = samples.findIndex(sm => Math.abs(sm.s - u) <= SAMPLE_SNAP)
    if (near >= 0) {
      const sm = samples[near]
      return { ...base, kind: 'sample', u: sm.s, sampleIndex: near, tcp: sm.tcp, hits: hitsOf(sm),
        arm: armPayload(sm.arm, 'sample'), armHeld: false,
        armNote: lookup(REPLAY_ARM_TEXT, sm.arm?.kind, 'replay arm kind'), note: null }
    }
    let i = 0
    while (i < samples.length - 2 && samples[i + 1].s < u) i++
    const a = samples[i]; const b = samples[i + 1]
    const w = b.s > a.s ? (u - a.s) / (b.s - a.s) : 0
    const tcp = a.tcp.map((v, k) => v + (b.tcp[k] - v) * w)
    let arm = null; let armHeld = false; let armNote = null
    if (armContinuous(a.arm, b.arm)) {
      const ja = armJoints(a.arm); const jb = armJoints(b.arm)
      arm = { authority: 'measured', joints: ja.map((q, k) => q + (jb[k] - q) * w) }
      armNote = 'arm: between two samples — drawn, not judged'
    } else if (armJoints(a.arm) || armJoints(b.arm)) {
      const held = armJoints(a.arm) ? a.arm : b.arm
      arm = armPayload(held, 'between'); armHeld = true
      armNote = armJoints(a.arm) && armJoints(b.arm)
        ? 'arm: its solution jumps here — held, it switches at the next sample'
        : 'arm: held at the nearest sample that has a solution'
    } else {
      armNote = lookup(REPLAY_ARM_TEXT, a.arm?.kind, 'replay arm kind')
    }
    return { ...base, kind: 'between', tcp, hits: [], arm, armHeld, armNote, note: null }
  }

  const held = heldSample(timeline, index)
  // A still segment holds the tcp AND the arm of the same sample, so the arm is
  // drawn at the very TCP it was solved for — a judged pose stays `solved`.
  const heldArm = held ? armPayload(held.arm, 'sample') : null
  if (seg.kind === 'sweep') {
    return { ...base, kind: 'sweep', tcp: held?.tcp ?? null,
      hits: seg.hits.map(h => ({ part: h.part, obstacleIndex: h.obstacleIndex, judged: true })),
      arm: heldArm, armHeld: heldArm != null, armNote: heldArm ? 'arm: held at the pick pose' : null,
      note: 'judged as one swept volume — no instant inside it is claimed' }
  }
  return { ...base, kind: 'unjudged', tcp: held?.tcp ?? null, hits: [], arm: heldArm,
    armHeld: heldArm != null, armNote: null, note: seg.note }
}

/**
 * The obstacles a frame struck, one entry per obstacle, with the shape the
 * REQUEST sent for it (the very box the solver tested — wire units). `judged`
 * is true when any hit on it was a judgement (a part the search checked, or a
 * judged arm); an arm that was only measured leaves it false (drawn dashed).
 * Derived frames carry no hits, so they strike nothing.
 *
 * @param {{hits:{obstacleIndex:number, judged:boolean}[]}} frame
 * @param {object[]} obstacles  the request's `graspSearch.obstacles`
 * @returns {{obstacleIndex:number, judged:boolean, shape:object|null}[]}
 */
export function struckObstacles(frame, obstacles) {
  const by = new Map()
  for (const h of frame.hits) {
    const prev = by.get(h.obstacleIndex)
    by.set(h.obstacleIndex, { obstacleIndex: h.obstacleIndex, judged: (prev?.judged ?? false) || h.judged,
      shape: obstacles?.[h.obstacleIndex] ?? null })
  }
  return [...by.values()].sort((a, b) => a.obstacleIndex - b.obstacleIndex)
}

/** What the frame is, in a few words — the ghost's caption and the panel's line. */
export function replayCaption(frame, timeline) {
  const seg = timeline.segments.find(s => s.phase === frame.phase)
  if (frame.kind === 'sample') {
    return `${frame.label} · sample ${frame.sampleIndex + 1}/${seg.samples.length} (s ${frame.u.toFixed(2)}) — judged`
  }
  if (frame.kind === 'between') return `${frame.label} · between samples (s ${frame.u.toFixed(2)}) — drawn, not judged`
  if (frame.kind === 'sweep') return `${frame.label} — ${frame.note}`
  return `${frame.label} — ${frame.note}`
}
