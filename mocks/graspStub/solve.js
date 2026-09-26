/**
 * Coarse grasp-search stand-in (ADR-117) — a TEST DOUBLE for the backend layer.
 *
 * ## What this is, and where it lives
 *
 * This file is deliberately NOT under `src/`. The repository's scope boundary
 * (CLAUDE.md) puts every *solution* to a robotics constraint — reach, IK, grasp
 * stability, visibility, interference — in `core/`, and lets the front declare
 * and display only. This module does solve those constraints, crudely, so it
 * lives on the backend side of the line: it is a stand-in for `core/`, reached
 * through the same wire contract, never imported by `src/`. `mocks/` is to
 * `core/` what `templates/` is to the contract — fixture material belonging to
 * the layer it stands in for.
 *
 * ## What it is FOR
 *
 * Letting someone exercise the grasp UX from a static URL, with no Python, no
 * BFF and no install. It is not an approximation anyone should trust
 * numerically: the ranking, the near-miss distances and the score values are
 * this file's invention, and they will disagree with `core/`. What it reproduces
 * faithfully is the *shape* of the answer:
 *
 *   - the response conforms to `grasp-search-response.schema.json`;
 *   - the funnel identity holds
 *     (`candidatesGenerated = Σ rejections + feasible`);
 *   - the stages are EXCLUSIVE and short-circuit in `core/`'s measured
 *     cheapest-first order (reach → IK → grasp → visibility → interference), so
 *     a multiply-infeasible candidate is attributed to the same single stage the
 *     real engine would attribute it to;
 *   - undeclared camera / gripper make their stages vacuously true, exactly as
 *     the contract specifies.
 *
 * Those are the properties the UI derives its presentation from, so they are the
 * ones a UX session must not be lied to about. The conformance tests next door
 * are what keep this list true rather than aspirational.
 *
 * Pure module: no fetch, no clock, no randomness. Same request in, same response
 * out — a reviewer's screenshot is reproducible (原則 #3).
 */

/** Stages, in the engine's measured cheapest-first short-circuit order. */
const STAGE = Object.freeze({
  REACH:        'rejectedByReach',
  IK:           'rejectedByIk',
  GRASP:        'rejectedByGrasp',
  VISIBILITY:   'rejectedByVisibility',
  INTERFERENCE: 'rejectedByInterference',
})

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = (a) => Math.sqrt(dot(a, a))

/** Unit vector, or null when the input is degenerate (never a fabricated axis). */
function unit(v) {
  const n = norm(v)
  return n > 1e-12 ? scale(v, 1 / n) : null
}

/**
 * Shortest distance from a segment to a point — the primitive both the sightline
 * and the approach-path checks use.
 */
function segmentPointDistance(a, b, p) {
  const ab = sub(b, a)
  const len2 = dot(ab, ab)
  if (len2 < 1e-12) return norm(sub(p, a))
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / len2))
  return norm(sub(p, add(a, scale(ab, t))))
}

/**
 * Signed distance from a segment to an obstacle's SURFACE (negative = the segment
 * passes through it). The stub's one answer to "how close is this body", shared by
 * the occlusion and approach-path checks (ADR-133 D5).
 *
 * The stub is a SECOND PRODUCER of the same judgement `core/` makes (ADR-120: the
 * same defect lived in both producers, independently). So it must not quietly read
 * a box as a sphere — an unknown shape THROWS rather than being approximated, the
 * same rule `_obstacle_from_wire` follows in core (原則 #31).
 */
function surfaceDistance(a, b, o) {
  const kind = o.kind ?? (o.radius !== undefined ? 'sphere' : undefined)
  if (kind === 'sphere') return segmentPointDistance(a, b, o.center) - o.radius
  if (kind === 'box') return segmentBoxDistance(a, b, o)
  throw new Error(
    `graspStub: 未宣言の障害物種別 ${JSON.stringify(o.kind)} — ` +
    '球へ倒すと「箱を宣言したのに外接球で判定された」が、候補が減っただけの正しい形で通る',
  )
}

/** Inverse-rotate a world vector into a box's own frame (conjugate quaternion). */
function intoBoxFrame(v, q) {
  if (!q) return v
  const [x, y, z, w] = q
  const c = [-x, -y, -z, w]
  return quatRotate(c, v)
}

function quatRotate(q, v) {
  const [x, y, z, w] = q
  const t = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])]
  return [
    v[0] + w * t[0] + (y * t[2] - z * t[1]),
    v[1] + w * t[1] + (z * t[0] - x * t[2]),
    v[2] + w * t[2] + (x * t[1] - y * t[0]),
  ]
}

/** Point → OBB distance (0 inside): back into the box frame, then an AABB. */
function pointBoxDistance(p, o) {
  const l = intoBoxFrame(sub(p, o.center), o.orientation)
  const d = [0, 1, 2].map(i => Math.max(Math.abs(l[i]) - o.halfExtents[i], 0))
  return Math.hypot(d[0], d[1], d[2])
}

/**
 * Segment → OBB distance by golden-section search.
 *
 * Distance to a convex set is CONVEX along the segment, so the search is unimodal
 * and cannot settle on a false minimum. Sampling at a fixed step would miss a
 * contact thinner than the step; writing the 26 face/edge/vertex branches by hand
 * would produce plausible-looking numbers when one branch is wrong.
 */
const GOLDEN = (Math.sqrt(5) - 1) / 2
function segmentBoxDistance(a, b, o) {
  const at = t => pointBoxDistance(add(a, scale(sub(b, a), t)), o)
  let lo = 0, hi = 1
  let c = hi - GOLDEN * (hi - lo), d = lo + GOLDEN * (hi - lo)
  let fc = at(c), fd = at(d)
  for (let i = 0; i < 48; i++) {
    if (fc < fd) { hi = d; d = c; fd = fc; c = hi - GOLDEN * (hi - lo); fc = at(c) }
    else         { lo = c; c = d; fc = fd; d = lo + GOLDEN * (hi - lo); fd = at(d) }
  }
  return Math.min(fc, fd, at(0), at(1))
}

/**
 * Quaternion → forward (+X) axis, matching the contract's TCP convention.
 */
function forwardAxis(q) {
  const [x, y, z, w] = q
  return [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)]
}

/**
 * Build the candidate frame's quaternion from `approach`, in the contract's
 * FRAME_CONVENTION: **+Z = −approach**, +X a deterministic reference axis turned
 * by roll (the stub has no roll, so roll = 0).
 *
 * ## これは 2026-09-21 に直した本物のズレである (ADR-147)
 *
 * 以前ここは「**+X** を approach に向ける」四元数を返しており、`core/` の
 * `pose_codec.py` (+Z = −approach) とは**別の gauge** だった。誰も気づかなかったのは、
 * 読み手が `frame.position` しか使っていなかったから — ゴーストは位置だけで描け、
 * ADR-144 の近似も位置しか合わせていなかったので、**四元数は誰にも読まれないまま
 * 間違っていられた**。ADR-147 でクライアントが姿勢まで解くようになった瞬間に、
 * 間違った approach から IK を解くことになって表に出た。
 *
 * ADR-120 が記録した形そのもの (同じ欠陥が生産者ごとに独立に住む) で、しかも今回は
 * **読む機械が現れるまで存在しなかった**: 規約の一致を問う検査が無ければ、
 * 契約に載っている値でも誰も読まないあいだは何であってもよい。
 * `conformance.test.js` がその検査を引き受ける。
 */
function candidateFrameOrientation(approach) {
  const z = scale(approach, -1)                 // FRAME_CONVENTION: +Z = −approach
  // `pose_codec._basis_from_z` と同じ参照選択 (閾値 0.9 も同値 — gauge を共有する)。
  const ref = Math.abs(z[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
  const bx = unit(cross(ref, z))
  if (!bx) return [0, 0, 0, 1]
  const by = cross(z, bx)
  return quaternionFromColumns(bx, by, z)       // roll = 0 なので bx がそのまま +X
}

const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

/** 回転行列の 3 列 → 四元数 [x,y,z,w] (`pose_codec._matrix_to_quaternion` と同じ). */
function quaternionFromColumns(x, y, z) {
  const m = [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]]
  const tr = m[0][0] + m[1][1] + m[2][2]
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2
    return [(m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s, 0.25 * s]
  }
  if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2
    return [0.25 * s, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s, (m[2][1] - m[1][2]) / s]
  }
  if (m[1][1] > m[2][2]) {
    const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2
    return [(m[0][1] + m[1][0]) / s, 0.25 * s, (m[1][2] + m[2][1]) / s, (m[0][2] - m[2][0]) / s]
  }
  const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2
  return [(m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, 0.25 * s, (m[1][0] - m[0][1]) / s]
}

/** Housing length along the flange +Z (a cylinder's length, a box's z size). */
function bodyLengthOf(body) {
  if (!body) return 0
  return body.kind === 'cylinder' ? Number(body.length) : Number(body.size?.[2] ?? 0)
}

/** Half-thickness of an OBB along a world direction (Σ hᵢ·|axisᵢ·d|). */
function boxExtentAlong(box, dir) {
  const q = box.orientation ?? [0, 0, 0, 1]
  const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(e => quatRotate(q, e))
  return axes.reduce((s, ax, i) => s + box.halfExtents[i] * Math.abs(dot(ax, dir)), 0)
}

/**
 * Read the judgement parameters, honouring the contract's precedence: `plan{}`
 * wins over the legacy `robot.*` fallback (ADR-084 §4). An undeclared bound is
 * left unbounded rather than guessed — the same rule `core/` follows, and the
 * reason an undeclared reach envelope rejects nothing.
 */
function judgement(graspSearch) {
  const plan  = graspSearch.plan  ?? {}
  const robot = graspSearch.robot ?? {}
  const pick = (key, fallback) => {
    if (plan[key]  != null) return Number(plan[key])
    if (robot[key] != null) return Number(robot[key])
    return fallback
  }
  return {
    reachMin:  pick('reachMin', 0),
    reachMax:  pick('reachMax', Number.POSITIVE_INFINITY),
    coneHalf:  pick('wristConeHalfAngle', Math.PI),
  }
}

/**
 * A reach envelope that COVERS every declared sample, derived from the request.
 *
 * The point of this is the **positive control** for ADR-120. Everywhere else the
 * front never declares a reach envelope, so `reach_margin` is always absent —
 * and an absence you can never make appear is indistinguishable from a key this
 * stub simply does not know how to emit. A reviewer on GitHub Pages has no
 * `plan{}` form and no `curl`, so without this they can only ever see one half
 * of the claim (原則 #31 — the negative control alone proves nothing).
 *
 * Derived, not constant: the stub is unit-agnostic (a millimetre layout and a
 * metre layout must both work), so the bounds are scaled from the sample
 * distances rather than hard-coded. The margin is deliberately generous on both
 * sides so that the reach stage rejects NOTHING — the A/B must differ in the
 * declaration alone, not in which candidates survived.
 *
 * @param {object} graspSearch  the request's `graspSearch` declaration
 * @returns {{reachMin: number, reachMax: number}|null} null when there is
 *   nothing to cover (no samples → no distances → no basis, and inventing one
 *   would be the very guess this ADR is about)
 */
export function envelopeCoveringSamples(graspSearch) {
  const base    = graspSearch?.robot?.base ?? [0, 0, 0]
  const samples = graspSearch?.target?.surfaceSamples ?? []
  const distances = samples
    .map(s => norm(sub(s.point, base)))
    .filter(d => Number.isFinite(d) && d > 0)
  if (!distances.length) return null
  return {
    reachMin: Math.min(...distances) * 0.5,
    reachMax: Math.max(...distances) * 1.5,
  }
}

/**
 * The objective values this stand-in can produce, keyed by `core/`'s registered
 * names. Only the objectives the request actually weights are returned, so an
 * unweighted objective does not appear in the breakdown — mirroring
 * `evaluate_objectives`, which returns only requested names.
 *
 * A weighted objective this stub COULD NOT EVALUATE (`null`) is left out too, so
 * "not measured" is carried by the ABSENCE OF THE KEY rather than by a 0 that is
 * indistinguishable from a genuinely bad score (ADR-120 D2). The stub reproduced
 * the very defect ADR-120 names: with no reach envelope declared it reported
 * `reach_margin: 0`, which reads as "no margin left" when it means "nobody
 * measured".
 */
function objectiveScores(weights, { reachMargin, clearance, stability }) {
  const all = {
    reach_margin:       reachMargin,
    approach_clearance: clearance,
    grasp_stability:    stability,
  }
  const out = {}
  for (const name of Object.keys(weights ?? {})) {
    if (!(name in all)) continue
    const value = all[name]
    if (value == null) continue          // weighted, but not evaluable → no key
    out[name] = Math.max(0, Math.min(1, value))
  }
  return out
}

/**
 * Weighted average over the objectives that were ACTUALLY EVALUATED (ADR-120 D1).
 *
 * The unevaluated ones are out of the numerator AND the denominator, so weighting
 * an objective this stub cannot compute does not drag the absolute score down —
 * which is what makes `totalScore` comparable between runs, as the contract
 * claims ("absolute basis, so scores are comparable across requests").
 *
 * Nothing evaluated at all → 0, and `objectiveScores` is then empty: the empty
 * breakdown is what distinguishes it from a scored-but-bad candidate (a 0 with
 * keys present). The stub's numbers are its own invention either way — what is
 * held to the contract is this SHAPE, never the arithmetic (ADR-117).
 */
function totalScoreOf(scores, weights) {
  let weighted   = 0
  let weightSum  = 0
  for (const [name, value] of Object.entries(scores)) {
    const w = Number(weights?.[name] ?? 0)
    weighted  += value * w
    weightSum += w
  }
  return weightSum > 0 ? weighted / weightSum : 0
}

/**
 * Solve a grasp-search request, coarsely.
 *
 * @param {object} request  a contract-shaped GraspSearchRequest
 * @param {number} contractVersion  stamped onto the response
 * @returns {object} a contract-shaped GraspSearchResponse
 */
export function stubSolve(request, contractVersion) {
  const gs        = request?.graspSearch ?? {}
  const base      = gs.robot?.base ?? [0, 0, 0]
  const derivedSamples = gs.target?.surfaceSamples ?? []
  // ADR-152 (contract v7): named grasp specs in priority order. The stub honours
  // WHICH spec a candidate came from, the strategy and the depth — the shape of
  // the answer the UI reads — and nothing about the hand's shape (no OBBs here;
  // the numbers stay this file's invention, ADR-117).
  const specs     = Array.isArray(gs.target?.graspSpecs) ? gs.target.graspSpecs : []
  const strategy  = gs.target?.strategy ?? { order: 'priority', fallback: 'none' }
  const targetBox = gs.target?.box ?? null
  const toolLength = Number(gs.robot?.toolLength ?? 0)
  const samples   = specs.length ? specs.flatMap(sp => sp.samples ?? []) : derivedSamples
  const obstacles = gs.obstacles ?? []
  const camera    = gs.camera  ?? null
  const gripper   = gs.gripper ?? null
  const weights   = gs.objectiveWeights ?? {}
  const topN      = Number.isFinite(gs.topN) && gs.topN > 0 ? Math.floor(gs.topN) : 5
  const { reachMin, reachMax, coneHalf } = judgement(gs)

  // The pre-grasp standoff and the clearance reference are expressed in the
  // request's own length unit, which the contract never names. Deriving them
  // from the scene's own scale keeps the stub unit-agnostic: a millimetre layout
  // and a metre layout both get a standoff proportional to what they contain,
  // instead of a hard-coded constant that is either invisible or enormous.
  const spread = samples.length
    ? Math.max(...samples.map(s => norm(sub(s.point, base))))
    : 1
  const preGraspDistance   = spread * 0.1
  const clearanceReference = spread * 0.05

  const counts = {
    rejectedByReach: 0, rejectedByIk: 0, rejectedByGrasp: 0,
    rejectedByVisibility: 0, rejectedByInterference: 0,
  }
  let reachNearestMiss     = null
  let occlusionNearestMiss = null
  let graspNearestMiss     = null   // { kind, shortfall } — contract v5 (ADR-118)
  const keepMin = (cur, v) => (cur == null || v < cur ? v : cur)

  // Counted rather than assumed to equal `samples.length`: a degenerate sample
  // generates no candidate, and folding it into the total would break the
  // funnel identity the UI derives every bar width from.
  let generated = 0

  /** One group of samples (a spec, or the derived set) → its feasible candidates. */
  const evaluateGroup = (groupSamples, spec) => {
  const graspSpecId = spec?.id ?? null
  const depth = Number(spec?.depth ?? 0)
  const closingAxis = spec?.closingAxis ? unit(spec.closingAxis) : null
  const feasible = []
  for (const sample of groupSamples) {
    const surface = sample.point
    const outward = unit(sample.normal)
    if (!outward) continue                       // a normal-less sample defines no approach
    generated += 1
    const approach = scale(outward, -1)          // face-on: approach opposes the normal
    const preGrasp = add(surface, scale(outward, preGraspDistance))
    // ADR-152 D5: the TCP goes `depth` past the face along the approach.
    const point    = depth > 0 ? add(surface, scale(approach, depth)) : surface
    const distance = norm(sub(point, base))

    // ── reach ────────────────────────────────────────────────────────────────
    if (distance < reachMin || distance > reachMax) {
      counts[STAGE.REACH] += 1
      const miss = distance > reachMax ? distance - reachMax : reachMin - distance
      reachNearestMiss = keepMin(reachNearestMiss, miss)
      continue
    }

    // ── IK (wrist cone against the declared TCP axis, else the base proxy) ────
    const reference = gs.robot?.tcpOrientation
      ? unit(forwardAxis(gs.robot.tcpOrientation))
      : unit(sub(point, base))
    if (reference) {
      const angle = Math.acos(Math.max(-1, Math.min(1, dot(reference, approach))))
      if (angle > coneHalf) { counts[STAGE.IK] += 1; continue }
    }

    // ── grasp gate (vacuously true with no gripper declared) ─────────────────
    // The "required opening" a parallel jaw needs is stood in for by the
    // clearance reference; the real gate searches contact pairs on the mesh.
    // The hand kind decides WHICH quantity is measured (ADR-118) — a jaw misses by
    // an opening shortfall, a cup by a seal-patch shortfall. Reporting one as the
    // other is the failure the contract union exists to prevent, so the stub keeps
    // the two apart too.
    let graspSlack = 1
    if (gripper) {
      const required = clearanceReference
      if (gripper.kind === 'suction') {
        const cup = Number(gripper.cupDiameter ?? 0)
        // Coarse stand-in for "is there a flat patch this big": the target's own
        // sample spread around the contact point.
        const patch = required * 2
        if (cup > patch) {
          counts[STAGE.GRASP] += 1
          const shortfall = cup - patch
          if (graspNearestMiss == null || shortfall < graspNearestMiss.shortfall) {
            graspNearestMiss = { kind: 'sealPatch', shortfall }
          }
          continue
        }
        graspSlack = patch > 0 ? Math.min(1, (patch - cup) / patch) : 1
      } else {
        const maxOpening = Number(gripper.maxOpening ?? 0)
        // ADR-152 D5 (coarse copy): past the palm is not a grasp — the palm would
        // sink below the approach face. Counted as a grasp rejection with no
        // measurable opening miss, as core/ does.
        if (depth > 0 && gripper.body && depth > toolLength - bodyLengthOf(gripper.body)) {
          counts[STAGE.GRASP] += 1
          continue
        }
        // A declared closing axis measures the width as the TARGET BOX's thickness
        // along it (ADR-152 §2) — the part the jaws actually straddle — instead of
        // this stub's scene-scale stand-in.
        const width = closingAxis && targetBox
          ? 2 * boxExtentAlong(targetBox, closingAxis) + Number(gripper.fingerClearance ?? 0)
          : required
        if (maxOpening < width) {
          counts[STAGE.GRASP] += 1
          const shortfall = width - maxOpening
          if (graspNearestMiss == null || shortfall < graspNearestMiss.shortfall) {
            graspNearestMiss = { kind: 'opening', shortfall }
          }
          continue
        }
        graspSlack = width > 0 ? Math.min(1, (maxOpening - width) / width) : 1
      }
    }

    // ── visibility (vacuously true with no camera declared) ──────────────────
    if (camera) {
      const eye  = camera.position ?? [0, 0, 0]
      const axis = unit(camera.viewAxis ?? [0, 0, -1])
      const toPoint = unit(sub(point, eye))
      const fov = Number(camera.fovHalfAngle ?? Math.PI)
      let rejected = false
      if (axis && toPoint && Math.acos(Math.max(-1, Math.min(1, dot(axis, toPoint)))) > fov) {
        rejected = true                          // outside the field of view: no depth to report
      } else {
        for (const o of obstacles) {
          const d = surfaceDistance(eye, point, o)
          if (d < 0) {
            rejected = true
            occlusionNearestMiss = keepMin(occlusionNearestMiss, -d)
            break
          }
        }
      }
      if (rejected) { counts[STAGE.VISIBILITY] += 1; continue }
    }

    // ── interference along the approach path ─────────────────────────────────
    let minClearance = Number.POSITIVE_INFINITY
    let blocked = false
    for (const o of obstacles) {
      const d = surfaceDistance(preGrasp, point, o)
      if (d < 0) { blocked = true; break }
      minClearance = Math.min(minClearance, d)
    }
    // ADR-152 D5 (coarse copy): the declared FINGERS, open, straddling the TCP
    // along the closing axis — each one a segment down its centreline, blocked
    // when an obstacle comes within half its thickness. core/ places the whole
    // hand as boxes along the approach; the stub checks the fingers at the grasp
    // pose only. Coarse on purpose: what it must not do is call a finger that
    // stands in a tray wall "clear".
    if (!blocked && gripper?.fingers && closingAxis && gripper.kind !== 'suction') {
      const f = gripper.fingers
      const off = Number(gripper.maxOpening ?? 0) / 2 + f.thickness / 2
      const palm = bodyLengthOf(gripper.body)
      const tip = add(point, scale(approach, palm + f.length - toolLength))
      const base = sub(tip, scale(approach, f.length))
      for (const sign of [-1, 1]) {
        const a = add(base, scale(closingAxis, sign * off))
        const b = add(tip, scale(closingAxis, sign * off))
        if (obstacles.some(o => surfaceDistance(a, b, o) < f.thickness / 2)) { blocked = true; break }
      }
    }
    if (blocked) { counts[STAGE.INTERFERENCE] += 1; continue }

    // ── survived every stage: score it ───────────────────────────────────────
    const span        = reachMax === Number.POSITIVE_INFINITY ? 0 : (reachMax - reachMin) / 2
    // No declared envelope → the margin is NOT MEASURED, which is a different
    // fact from "no margin left" (ADR-120). `null` travels as an absent key.
    const reachMargin = span > 0
      ? 1 - Math.abs(distance - (reachMin + span)) / span
      : null
    // `1` here IS an evaluation, not a stand-in: nothing declared nearby means
    // the approach is unobstructed, which the stub did measure.
    const clearance = Number.isFinite(minClearance) && clearanceReference > 0
      ? Math.min(1, minClearance / clearanceReference)
      : 1
    const scores = objectiveScores(weights, {
      reachMargin, clearance, stability: graspSlack,
    })
    const totalScore = totalScoreOf(scores, weights)

    feasible.push({
      graspSpecId,
      pose: {
        kind:  'endEffector',
        // **把持点**であって pre-grasp ではない (`core/` の `pose_to_payload` は
        // `pose.position` を載せる)。以前ここは `preGrasp` を載せており、進入距離
        // ぶんずれた位置をゴーストが描いていた — 位置しか読まれないあいだは
        // 「それらしい」ので気づけなかった、四元数と同じ形のズレである。
        frame: { position: point, orientation: candidateFrameOrientation(approach) },
      },
      score: {
        withinReach: true, visible: true, ikSolvable: true,
        interferenceFree: true, graspable: true,
        objectiveScores: scores,
        totalScore: Math.max(0, totalScore),
        // ADR-135: このスタブは IK を解かない (運動学を持たない) ので、関節配置は
        // **誰も決めていない**。`undeclared` はその事実の宣言であって「到達不可」では
        // ない。占位の値を `solved` として返すと、フロントは誰も決めていない腕を
        // 描き、しかもそれは本物の解と見分けがつかない (ADR-120 と同じ形の欠陥が
        // 生産者ごとに独立に住む)。
        reachSolution: { kind: 'undeclared' },
      },
    })
  }

  return feasible
  }

  // Strategy (ADR-152 D5): every spec is evaluated so each gets its row — a spec
  // the strategy did not return and a spec that had nothing are different facts.
  const graspSpecs = []
  let returnable
  let feasibleTotal
  if (specs.length) {
    const perSpec = specs.map(sp => {
      const before = generated
      const found  = evaluateGroup(sp.samples ?? [], sp)
      graspSpecs.push({ id: sp.id, candidatesGenerated: generated - before, feasible: found.length })
      return found
    })
    feasibleTotal = perSpec.reduce((n, f) => n + f.length, 0)
    returnable = strategy.order === 'score' ? perSpec.flat() : (perSpec.find(f => f.length) ?? [])
    if (feasibleTotal === 0 && strategy.fallback === 'derived') {
      returnable = evaluateGroup(derivedSamples, null)
      feasibleTotal = returnable.length
    }
  } else {
    returnable = evaluateGroup(derivedSamples, null)
    feasibleTotal = returnable.length
  }

  returnable.sort((a, b) => b.score.totalScore - a.score.totalScore)
  const candidates = returnable.slice(0, topN).map((c, i) => ({ rank: i + 1, ...c }))

  return {
    contractVersion,
    candidates,
    diagnostics: {
      candidatesGenerated: generated,
      ...counts,
      feasible: feasibleTotal,
      returned: candidates.length,
      reachNearestMiss,
      occlusionNearestMiss,
      graspNearestMiss,
      graspSpecs,
    },
  }
}
