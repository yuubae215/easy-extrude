/**
 * robotModel — WHICH ARM this app is talking about (ADR-141).
 *
 * ## Why this module exists
 *
 * Five things in this repo claimed to know which robot the user has, and none
 * of them asked the others:
 *
 *   1. `public/robot/skeleton_arm.urdf` — the arm the screen DRAWS. A genuine
 *      UR5e (its DH lengths are the published ones), and since ADR-127 the
 *      `robot.kinematics` declaration is read straight out of it.
 *   2. `REACH_PRESETS` — three hand-written envelopes labelled "small arm
 *      (≈0.5)", "medium arm (≈0.85)", "large arm (≈1.3)". The panel seeded the
 *      first one; the other two describe arms that do not exist in this app.
 *   3–5. the Context DSL's `f_robot.attrs.reach` in the bundled examples, and
 *      the backend acceptance fixtures under `templates/`.
 *
 * So a user could place a UR5e, watch it draw at UR5e scale, then declare "large
 * arm (≈1.3)" and get a `reach_margin` scored against an arm 50 cm longer than
 * the one on screen. Nothing anywhere compared the two numbers, because there
 * was no place where both of them were in scope. **That** is the defect: not a
 * wrong value, but a fact with more than one author (§1.1).
 *
 * ## Declared row, derived band
 *
 * The envelope is a DECLARATION (`ROBOT_MODELS[…].reach`), because "how far can
 * this arm work" is a manufacturer's figure measured on real hardware, not
 * something a URDF states. But it is not left free-floating: `reachBandFromDh`
 * derives, from the very chain the app draws, the interval the declaration MUST
 * fall inside. A declaration outside that band is not a preference, it is a
 * different arm — and `robotModel.test.js` fails the build on it.
 *
 * That split is deliberate and is the same one ADR-127 made for
 * `FLANGE_APPROACH_AXIS`: declare what cannot be derived, and pin the
 * declaration to something outside its own loop so a self-consistent wrong
 * answer cannot pass.
 *
 * ## What stays in core/
 *
 * This module never judges REACHABILITY. It answers "how long is this arm",
 * from the arm's own geometry, judging no target. Whether a given grasp point
 * lies inside the envelope is reach *solving* and stays in `core/` behind the
 * contract, exactly as CLAUDE.md requires — the front declares, the backend
 * solves.
 *
 * Pure module (no THREE / no DOM / no `?raw`) so the `node --test` lane and the
 * browser read one definition.
 *
 * @module domain/robotModel
 */

/** The robot models this app ships. A closed vocabulary (原則 #31). */
export const ROBOT_MODEL_ID = Object.freeze({ UR5E: 'ur5e' })

/**
 * The model `Add ▸ Robot` inserts — and, since every robot in a scene is drawn
 * from the one bundled URDF (ADR-090 gives each base frame a stage built from
 * `ROBOT_URDF_TEXT`), the model EVERY robot in the scene is.
 *
 * When a second model is added this stops being a constant and becomes a
 * property of the robot entity. It is a constant today because the cardinality
 * of shipped models is one, and pretending otherwise would be a selector over a
 * set with one member (kernel §5 — no trigger, no lens).
 */
export const SHIPPED_ROBOT_MODEL_ID = ROBOT_MODEL_ID.UR5E

/**
 * One row per shipped arm.
 *
 * `reach` is the wire-shaped `graspSearch.plan` envelope (ADR-084 §4), in the
 * arm's own unit — METRES, like everything else that crosses the robotics wire
 * (ADR-136). `reachProvenance` records where the figure came from, because an
 * envelope with no stated origin is indistinguishable from one somebody guessed.
 *
 * @type {Readonly<Record<string, Readonly<{
 *   id: string, label: string, urdf: string,
 *   reach: Readonly<{reachMin: number, reachMax: number, wristConeHalfAngle: number}>,
 *   reachProvenance: string,
 * }>>>}
 */
export const ROBOT_MODELS = Object.freeze({
  [ROBOT_MODEL_ID.UR5E]: Object.freeze({
    id:    ROBOT_MODEL_ID.UR5E,
    label: 'UR5e (6-axis)',
    urdf:  'public/robot/skeleton_arm.urdf',
    reach: Object.freeze({
      // 0.85 m is the UR5e's published working radius. It sits inside the band
      // `reachBandFromDh` derives from the drawn chain ([0.817, 1.017]) — which
      // is what makes it this arm's figure rather than a number someone liked.
      reachMin:           0.2,
      reachMax:           0.85,
      wristConeHalfAngle: 1.05,
    }),
    reachProvenance: 'Universal Robots UR5e datasheet — 850 mm working radius',
  }),
})

/**
 * The envelopes retired by ADR-141: two arms this app never had.
 *
 * Counted rather than deleted, because a retired shape that is merely absent
 * comes back the first time someone wants "a bigger arm" and nothing asks them
 * which arm they are drawing (ADR-103 — a retired form goes on producing green).
 */
export const RETIRED_REACH_PRESETS = Object.freeze([
  'small-arm',  // ≈0.5 — no such URDF ships
  'large-arm',  // ≈1.3 — no such URDF ships
])

/**
 * The declared model row, or a throw.
 *
 * No default and no `?? ROBOT_MODELS.ur5e`: an unknown id means somebody is
 * talking about an arm nobody declared, and silently handing them the UR5e is
 * how the original defect worked (原則 #31 — the same discipline as
 * `EXPLICIT_DEFAULTS` / `PLACEMENT_BY_KIND`).
 *
 * @param {string} id
 * @returns {(typeof ROBOT_MODELS)[keyof typeof ROBOT_MODELS]}
 * @throws {Error} when `id` is not a shipped model
 */
export function robotModelById(id) {
  const model = ROBOT_MODELS[id]
  if (!model) {
    throw new Error(
      `robotModelById: undeclared robot model "${id}" — add a row to ROBOT_MODELS ` +
      '(with its URDF and a sourced reach envelope) before referring to it')
  }
  return model
}

/**
 * The interval the flange's distance from the shoulder can span, read from the
 * DH lengths of the chain the app actually draws.
 *
 *   lower = |a2| + |a3|                the arm straight out, wrist folded in:
 *                                      shoulder → wrist centre, the span every
 *                                      quoted "reach" is at least as large as
 *   upper = |a2| + |a3| + d5 + d6      everything colinear: the furthest the
 *                                      flange can physically get
 *
 * A published working radius is measured between these two (the UR5e's 850 mm
 * sits at 817 + 33). Anything outside is a different arm — which is the whole
 * assertion, since the DH here comes from the drawn URDF.
 *
 * @param {{a2: number, a3: number, d5: number, d6: number}} dh
 * @returns {{lower: number, upper: number}}
 */
export function reachBandFromDh(dh) {
  const span = Math.abs(dh.a2) + Math.abs(dh.a3)
  return { lower: span, upper: span + Math.abs(dh.d5) + Math.abs(dh.d6) }
}

/**
 * Does a declared envelope describe the arm whose DH this is?
 *
 * Returns the REASONS it does not, so the caller can print them (原則 #11 —
 * a mismatch the user cannot see is a mismatch they will ship).
 *
 * @param {{reachMin: number, reachMax: number}|null|undefined} reach
 * @param {{a2: number, a3: number, d5: number, d6: number}|null|undefined} dh
 * @returns {string[]} empty when the declaration fits the arm
 */
export function reachDisagreements(reach, dh) {
  if (!reach || !dh) return []   // nothing to compare is not a disagreement
  const { lower, upper } = reachBandFromDh(dh)
  const out = []
  const round = (v) => Math.round(v * 1000)
  if (!(reach.reachMax >= lower && reach.reachMax <= upper)) {
    out.push(
      `declared reach max ${round(reach.reachMax)} mm is outside the drawn arm's ` +
      `${round(lower)}–${round(upper)} mm — that is a different robot than the one on screen`)
  }
  if (reach.reachMin >= reach.reachMax) {
    out.push('declared reach min is not smaller than reach max (an envelope that reaches nowhere)')
  }
  return out
}

/**
 * The envelope to OFFER for an arm whose kinematics were read from its URDF.
 *
 * Returns the shipped model's declared envelope when the drawn chain agrees with
 * it, and `null` when it does not — a caller with no trustworthy envelope must
 * leave the declaration undeclared rather than seed a wrong one, because an
 * invented envelope produces a `reach_margin` that looks measured and is not
 * (ADR-120 / kernel §5).
 *
 * @param {{kind: string, dh: object}|null|undefined} kinematics
 *   the `robot.kinematics` declaration derived from the drawn URDF (ADR-127)
 * @param {string} [modelId]
 * @returns {{reachMin: number, reachMax: number, wristConeHalfAngle: number}|null}
 */
export function reachEnvelopeFor(kinematics, modelId = SHIPPED_ROBOT_MODEL_ID) {
  if (!kinematics?.dh) return null
  const { reach } = robotModelById(modelId)
  return reachDisagreements(reach, kinematics.dh).length ? null : reach
}
