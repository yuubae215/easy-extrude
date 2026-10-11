/**
 * GraspDeclarationCatalog — camera / gripper declaration presets, their gap
 * predicates, and the viewport-camera capture conversion (ADR-081 Decision 5).
 *
 * SCOPE / GOVERNANCE:
 * - Everything here is DECLARATION-side provisioning for the request's open
 *   payload (`graspSearch.camera` / `graspSearch.gripper` — layoutVersion
 *   governance, no contractVersion bump; ADR-081 §2). Nothing here judges
 *   visibility or graspability — the solving stays in `core/` (AI 向けガード).
 * - Presets follow the ADR-063 selection-first premise (白紙入力不能): a card
 *   never opens on a blank numeric form — the first preset seeds it, and the
 *   active-preset chip is DERIVED by value equality (`matchingPresetId`), so
 *   editing a field is the fork (fork & tweak, ADR-058) with no second
 *   "customised" flag to drift (kernel §1.1).
 * - The `*Gaps()` lists are the single submit predicate for their card
 *   (disable the Run button AND print the reasons — no silent disabled,
 *   PHILOSOPHY #11; same discipline as IntakeAssist, ADR-058 UX rule).
 * - The vision camera is no longer a card here: since ADR-164 D3 it is a scene
 *   entity (`domain/visionCamera.js` — its presets, gaps and the "copy the
 *   current view" math moved with it).
 *
 * Pure and THREE-free: runs in the bare `node --test` lane (test:context).
 */

/**
 * The objective names `core/`'s registry actually scores (ADR-117).
 *
 * These are WIRE KEYS, not labels. `graspSearch.objectiveWeights` is keyed by
 * them and the response's `score.objectiveScores` comes back keyed by them —
 * `core/`'s `evaluate_objectives` looks each requested name up in
 * `OBJECTIVE_REGISTRY` and **silently skips the ones it does not know**
 * (objectives.py: `if definition is None: continue`). That tolerance is
 * deliberate on the solver's side (a newer DSL may ask for objectives an older
 * engine lacks), but it means a misspelled weight is a silent no-op on the wire:
 * the panel used to send `{ reach, clearance }`, none of which is registered, so
 * every response carried `objectiveScores: {}` and `totalScore: 0.0` — five
 * candidates tied at zero, ranked by nothing, with empty score bars. The sliders
 * moved and the answer never changed (原則 #11).
 *
 * Naming them once here is what stops the two halves (the panel's sliders and the
 * controller's default weights) from drifting apart again (§1.1).
 */
export const OBJECTIVE = Object.freeze({
  /** How much reach envelope is left over at the grasp pose. */
  REACH_MARGIN:       'reach_margin',
  /** How far the approach path stays from the declared obstacles. */
  APPROACH_CLEARANCE: 'approach_clearance',
  /** How well the contact geometry holds the object. */
  GRASP_STABILITY:    'grasp_stability',
  /**
   * Whether a suction cup holds the object's weight there (ADR-156): 0 = it
   * falls, 1 = the best this object and this hand can do. Needs the declared
   * mass, centre of mass and hold — any missing, and it is "not measured".
   */
  SUCTION_HOLD:       'suction_hold',
})

/** Every objective name the wire may carry — the enumeration a census can count. */
export const DECLARED_OBJECTIVES = Object.freeze(Object.values(OBJECTIVE))

/**
 * Which objectives a run asks for, per hand kind — the ONE place both the panel's
 * sliders and the controller's default read (§1.1). `suction_hold` is asked for
 * only under a suction hand: under jaws it can never be evaluated (ADR-156 D4),
 * so asking would plant a permanent "not measured" row. An undeclared hand
 * (`null`) is a declared row too, never a fall-through (原則 #31).
 */
export const OBJECTIVES_BY_HAND_KIND = Object.freeze({
  parallelJaw: Object.freeze([OBJECTIVE.REACH_MARGIN, OBJECTIVE.APPROACH_CLEARANCE, OBJECTIVE.GRASP_STABILITY]),
  suction:     Object.freeze([OBJECTIVE.REACH_MARGIN, OBJECTIVE.APPROACH_CLEARANCE, OBJECTIVE.GRASP_STABILITY, OBJECTIVE.SUCTION_HOLD]),
  none:        Object.freeze([OBJECTIVE.REACH_MARGIN, OBJECTIVE.APPROACH_CLEARANCE, OBJECTIVE.GRASP_STABILITY]),
})

/** Default weight per objective (the panel's slider seeds). */
export const DEFAULT_OBJECTIVE_WEIGHT = Object.freeze({
  [OBJECTIVE.REACH_MARGIN]:       0.6,
  [OBJECTIVE.APPROACH_CLEARANCE]: 0.4,
  [OBJECTIVE.GRASP_STABILITY]:    1.0,
  [OBJECTIVE.SUCTION_HOLD]:       1.0,
})

/**
 * The objectives a run asks for under a hand kind. Throws on an undeclared kind.
 * @param {string|null} gripperKind
 * @returns {ReadonlyArray<string>}
 */
export function objectivesForHand(gripperKind) {
  const row = OBJECTIVES_BY_HAND_KIND[gripperKind ?? 'none']
  if (!row) throw new Error(`GraspDeclarationCatalog: 未宣言のハンド種別 "${gripperKind}" — OBJECTIVES_BY_HAND_KIND に行を足すこと`)
  return row
}

/**
 * Default `objectiveWeights` for a hand kind.
 * @param {string|null} gripperKind
 * @returns {Record<string, number>}
 */
export function defaultObjectiveWeights(gripperKind) {
  return Object.fromEntries(objectivesForHand(gripperKind).map(o => [o, DEFAULT_OBJECTIVE_WEIGHT[o]]))
}

/**
 * Reach-envelope rows to offer (wire shape: `graspSearch.plan` — ADR-084 §4).
 *
 * The envelope exists because `reach_margin` needs an ABSOLUTE basis to be a
 * score at all: with no declared envelope `core/` cannot normalise the margin,
 * so it reports the objective as NOT MEASURED rather than as zero (ADR-120). The
 * front declared no `plan{}` at all until ADR-128, which is why the panel's
 * reach weight slider spent its life weighting something nothing could evaluate.
 *
 * **ADR-141 changed where the numbers come from.** This used to be a fixed
 * catalog of three arms — "small (≈0.5)", "medium (≈0.85)", "large (≈1.3)" —
 * none of which was connected to the skeleton on screen. Two of them described
 * robots this app has never shipped, and picking one silently scored the search
 * against an arm the user was not looking at (`RETIRED_REACH_PRESETS` counts
 * them). Now there is exactly one row and it is **the arm in the scene**: the
 * envelope is derived from the drawn URDF and passed in, so the offer cannot
 * describe a different robot than the viewport does.
 *
 * `envelope` may be null — no robot, or a bundled URDF that no longer agrees
 * with its declared model. The honest answer is then NO row rather than a
 * plausible one (kernel §5), because an invented envelope produces a margin that
 * looks measured and is not.
 *
 * Values are metres (the robotics wire's unit — ADR-136); the cone half-angle is
 * radians.
 *
 * @param {{reachMin: number, reachMax: number, wristConeHalfAngle: number}|null|undefined} envelope
 * @param {string} [label]  the model's display name, e.g. 'UR5e (6-axis)'
 * @returns {ReadonlyArray<{id: string, label: string, params: object}>}
 */
export function reachPresetsFor(envelope, label = 'the arm in the scene') {
  if (!envelope) return Object.freeze([])
  return Object.freeze([Object.freeze({
    id:     'scene-arm',
    label:  `${label} (≈${envelope.reachMax})`,
    params: Object.freeze({ ...envelope }),
  })])
}

/**
 * Why Run cannot proceed on the REACH-ENVELOPE side (ADR-128) — the sibling of
 * `gripperDeclarationGaps`, and only consulted when the
 * envelope is actually declared (an undeclared envelope is not a gap, it is a
 * legitimate state that leaves `reach_margin` unmeasured).
 *
 * `reachMin >= reachMax` is rejected rather than silently swapped: a swapped pair
 * would score every candidate against an envelope the user did not describe, and
 * the answer would look exactly like a correct one.
 *
 * @param {{reachMin: number, reachMax: number, wristConeHalfAngle: number}} plan
 * @returns {string[]}
 */
export function reachDeclarationGaps(plan) {
  const gaps = []
  const finite = (v) => typeof v === 'number' && Number.isFinite(v)
  if (!finite(plan?.reachMin) || plan.reachMin < 0) gaps.push('reach min must be a number ≥ 0')
  if (!finite(plan?.reachMax) || plan.reachMax <= 0) gaps.push('reach max must be a number > 0')
  if (finite(plan?.reachMin) && finite(plan?.reachMax) && plan.reachMin >= plan.reachMax) {
    gaps.push('reach min must be smaller than reach max (an empty envelope reaches nowhere)')
  }
  if (!finite(plan?.wristConeHalfAngle) || plan.wristConeHalfAngle <= 0) {
    gaps.push('wrist cone half-angle must be a number > 0 (radians)')
  }
  return gaps
}

/**
 * Hand kinds the contract can express (ADR-118). These are WIRE VALUES — the
 * `kind` discriminator of `graspSearch.gripper`, matching `core/`'s GripperKind
 * one for one.
 *
 * A parallel jaw and a suction cup do not measure the same thing: one asks
 * whether the jaws close across the object, the other whether a flat enough
 * patch can be sealed. They are separate branches rather than optional fields on
 * one object, so "a suction cup with a jaw opening" stays unrepresentable.
 */
export const GRIPPER_KIND = Object.freeze({
  PARALLEL_JAW: 'parallelJaw',
  SUCTION:      'suction',
})

/** Every declared hand kind — the enumeration a census counts against. */
export const DECLARED_GRIPPER_KINDS = Object.freeze(Object.values(GRIPPER_KIND))

/**
 * Presets per hand kind (wire shape: `graspSearch.gripper`). Units follow the
 * request geometry; the first entry of each kind is that card's seed.
 *
 * Keyed by kind rather than flattened into one list because the *fields* differ
 * — a flat list would need every preset to carry every field, which is the
 * optional-sibling shape the union exists to prevent.
 */
export const GRIPPER_PRESETS_BY_KIND = Object.freeze({
  [GRIPPER_KIND.PARALLEL_JAW]: Object.freeze([
    Object.freeze({
      id: 'standard-60',
      label: 'parallel 60 mm',
      params: Object.freeze({ kind: GRIPPER_KIND.PARALLEL_JAW, maxOpening: 0.06, fingerClearance: 0.01 }),
    }),
    Object.freeze({
      id: 'wide-85',
      label: 'parallel 85 mm',
      params: Object.freeze({ kind: GRIPPER_KIND.PARALLEL_JAW, maxOpening: 0.085, fingerClearance: 0.01 }),
    }),
    Object.freeze({
      id: 'micro-30',
      label: 'micro 30 mm',
      params: Object.freeze({ kind: GRIPPER_KIND.PARALLEL_JAW, maxOpening: 0.03, fingerClearance: 0.005 }),
    }),
  ]),
  [GRIPPER_KIND.SUCTION]: Object.freeze([
    Object.freeze({
      id: 'cup-40',
      label: 'suction ⌀40 mm',
      params: Object.freeze({ kind: GRIPPER_KIND.SUCTION, cupDiameter: 0.04, sealTiltTolerance: 0.35 }),
    }),
    Object.freeze({
      id: 'cup-20',
      label: 'suction ⌀20 mm',
      params: Object.freeze({ kind: GRIPPER_KIND.SUCTION, cupDiameter: 0.02, sealTiltTolerance: 0.35 }),
    }),
    Object.freeze({
      id: 'cup-80',
      label: 'suction ⌀80 mm',
      params: Object.freeze({ kind: GRIPPER_KIND.SUCTION, cupDiameter: 0.08, sealTiltTolerance: 0.26 }),
    }),
  ]),
})

/**
 * Presets for a declared kind. **Throws on an undeclared kind** rather than
 * falling back to the jaw list (原則 #31 — a fall-through cannot be told apart
 * from a declared default, and here it would silently offer jaw presets for a
 * hand that has no jaws).
 *
 * @param {string} kind  a `GRIPPER_KIND` value
 * @returns {ReadonlyArray<{id: string, label: string, params: object}>}
 */
export function gripperPresetsFor(kind) {
  const presets = GRIPPER_PRESETS_BY_KIND[kind]
  if (!presets) {
    throw new Error(
      `GraspDeclarationCatalog: 未宣言のハンド種別 "${kind}"。` +
      `GRIPPER_PRESETS_BY_KIND に行を足すこと (宣言は ${DECLARED_GRIPPER_KINDS.join(' / ')})`,
    )
  }
  return presets
}

// Declared as explicit type predicates rather than left to inference: the
// callers narrow `unknown` wire values through them, and an inferred predicate
// is a fragile thing to hang narrowing on (adding an unrelated export above was
// enough to lose it).
/** @type {(v: unknown) => v is number} */
const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * Derived active-preset id: the preset whose every param equals the current
 * values (numeric equality; vectors element-wise), or null when the values
 * diverge (= the user forked). This keeps the chip state a derivation of the
 * values, never a second source (kernel §1.1).
 *
 * @param {ReadonlyArray<{id: string, params: object}>} presets
 * @param {object|null|undefined} params  current parsed values (same shape)
 * @returns {string|null}
 */
export function matchingPresetId(presets, params) {
  if (!params) return null
  const eq = (a, b) => (Array.isArray(a) && Array.isArray(b))
    ? a.length === b.length && a.every((v, i) => v === b[i])
    : a === b
  for (const p of presets) {
    const keys = Object.keys(p.params)
    if (keys.every(k => eq(p.params[k], params[k]))) return p.id
  }
  return null
}

/**
 * Gap list for a parsed hand declaration ([] = valid) — the Grasped card's submit
 * predicate (an unreadable declaration is printed, never dropped).
 *
 * The parameter is the WIRE union (ADR-118), so the fields present depend on
 * `kind`; the type is left open per-branch rather than intersected, because an
 * intersection would say every hand has both an opening and a cup.
 *
 * @param {any} g  the wire union — see above
 * @returns {string[]}
 */
export function gripperDeclarationGaps(g) {
  if (!g || typeof g !== 'object') return ['gripper declaration is empty']
  // The kind decides which fields even exist, so it is checked first and never
  // assumed — an unstated kind is a gap, not a parallel jaw (ADR-118 / 原則 #31).
  if (!DECLARED_GRIPPER_KINDS.includes(/** @type {any} */ (g.kind))) {
    return [`hand kind must be one of ${DECLARED_GRIPPER_KINDS.join(' / ')}`]
  }
  const gaps = []
  if (g.kind === GRIPPER_KIND.PARALLEL_JAW) {
    if (!isFiniteNumber(g.maxOpening) || g.maxOpening < 0) {
      gaps.push('max opening must be a number ≥ 0 (geometry unit)')
    }
    if (g.fingerClearance != null && (!isFiniteNumber(g.fingerClearance) || g.fingerClearance < 0)) {
      gaps.push('finger clearance must be a number ≥ 0 (geometry unit)')
    }
    return gaps
  }
  if (g.kind === GRIPPER_KIND.SUCTION) {
    if (!isFiniteNumber(g.cupDiameter) || g.cupDiameter <= 0) {
      gaps.push('cup diameter must be a number > 0 (geometry unit)')
    }
    if (g.sealTiltTolerance != null && (!isFiniteNumber(g.sealTiltTolerance) || g.sealTiltTolerance < 0)) {
      gaps.push('seal tilt tolerance must be a number ≥ 0 (radians)')
    }
    return gaps
  }
  // Unreachable while the guard above is the only entry — kept so adding a kind
  // to the vocabulary without adding its gaps fails loudly instead of passing.
  throw new Error(`gripperDeclarationGaps: 未宣言のハンド種別 "${g.kind}"`)
}

