/**
 * clickTarget — THE decision of "which entity did that click mean?" (ADR-140).
 *
 * ## Why this module exists
 *
 * PHILOSOPHY #22 (Narrower Scope Wins in Hit-Testing) was implemented three
 * times, in three pointer handlers, as three hand-written `??` chains
 * (`_onPointerDown`, the `contextmenu` handler, `_onDblClick`). Three copies of
 * one rule is a §1.1 violation by construction, and they had ALREADY drifted:
 * the double-click copy had neither the CF-descendant exception nor the
 * annotation fallback, so a double-click resolved a different entity than the
 * single click that preceded it.
 *
 * Worse than the drift was what all three copies agreed on. The robot skeleton
 * was consulted **last, and only when nothing else was hit at all**:
 *
 *     if (!result) result = this._hitTest.hitRobotStage()
 *
 * That is not a priority, it is an unconditional loss. Distance never entered
 * the comparison, so a Solid anywhere along the ray — the floor slab, the
 * pedestal the arm stands on, a workpiece two metres behind it — beat the arm
 * the pointer was actually over. In the bundled pick-and-place cells the arm
 * stands on a pedestal and over a table, so the case that loses is the common
 * one: clicking the robot selected the furniture.
 *
 * ## The rule, stated once
 *
 *   1. **Scope rank decides first** (#22 — the narrower target wins):
 *      frame (0) < body: solid | robot (1) < annotation (2).
 *   2. **Within a rank, the NEARER hit wins.** This is the half that was
 *      missing: `solid` and `robot` are both bodies, so the one in front wins.
 *   3. **One declared exception** (carried over verbatim): a frame that is not
 *      *within* the body it competes with does not shadow that body. A CF's hit
 *      box is deliberately generous (a tap target), so an unrelated frame's box
 *      overlapping a body is a false positive, not a narrower intent.
 *
 * Rule 3 is why this function takes a containment predicate rather than reading
 * `parentId` itself: "is this frame within that body" is owned by the scene
 * graph (`HitTestService.isCfDescendantOf`), and re-deriving it here would make
 * this module the second source of an answer it does not own (§1.1).
 *
 * Pure module (no THREE / no DOM) so the rule is checkable under bare
 * `node --test` — the raycasting that PRODUCES candidates needs a camera, a
 * renderer and a pointer, which is precisely why the rule went three years
 * without a test while living inside the handlers (原則 #3).
 *
 * @module domain/clickTarget
 */

/**
 * The kinds of thing a click can land on. A closed vocabulary: `clickScopeRank`
 * throws on anything else rather than defaulting, because a kind nobody ranked
 * would otherwise silently inherit some rank and win or lose for no declared
 * reason (原則 #31 — the same discipline as `EXPLICIT_DEFAULTS` / `PLACEMENT_BY_KIND`).
 */
export const CLICK_TARGET_KIND = Object.freeze({
  FRAME:      'frame',
  SOLID:      'solid',
  ROBOT:      'robot',
  ANNOTATION: 'annotation',
})

/**
 * Scope rank per kind — lower is narrower, and narrower wins (PHILOSOPHY #22).
 *
 * `solid` and `robot` deliberately share rank 1: a robot skeleton **is** a body
 * in the scene, the same kind of thing as a cuboid, and the defect ADR-140
 * closes was exactly that it was treated as a lesser one. Sharing a rank is what
 * sends the two of them to the distance comparison instead of to a fixed winner.
 *
 * @type {Readonly<Record<string, number>>}
 */
export const CLICK_SCOPE_RANK = Object.freeze({
  [CLICK_TARGET_KIND.FRAME]:      0,
  [CLICK_TARGET_KIND.SOLID]:      1,
  [CLICK_TARGET_KIND.ROBOT]:      1,
  [CLICK_TARGET_KIND.ANNOTATION]: 2,
})

/** The rank shared by the things that occupy volume — solids and robot arms. */
export const BODY_RANK = CLICK_SCOPE_RANK[CLICK_TARGET_KIND.SOLID]

/**
 * Retired shapes of this decision (ADR-103's discipline: a retired form that
 * stays readable goes on producing green, so the removal itself is counted).
 *
 * `robot-last-resort` was the `if (!result) result = hitRobotStage()` tail that
 * made the arm lose to every solid regardless of depth. `per-handler-chain` was
 * the practice of writing the priority inline in a pointer handler at all.
 * `src/ClickTargetOwnership.test.js` asserts neither shape is back.
 */
export const RETIRED_CLICK_RULES = Object.freeze([
  'robot-last-resort',
  'per-handler-chain',
])

/**
 * The declared rank of a click-target kind.
 * @param {string} kind
 * @returns {number}
 * @throws {Error} when `kind` is not in `CLICK_TARGET_KIND`
 */
export function clickScopeRank(kind) {
  const rank = CLICK_SCOPE_RANK[kind]
  if (rank === undefined) {
    throw new Error(
      `clickScopeRank: undeclared click-target kind "${kind}" — add it to ` +
      'CLICK_SCOPE_RANK with a decided rank (原則 #31: no silent default)')
  }
  return rank
}

/**
 * @typedef {object} ClickCandidate
 * @property {string} kind      one of `CLICK_TARGET_KIND`
 * @property {object} obj       the scene entity this hit resolves to
 * @property {number} distance  ray distance to the hit, in world units
 */

/**
 * Declared precedence for an EXACT distance tie within a rank. A tie is rare but
 * reachable (two coplanar faces, a fallback box whose depth equals a mesh hit),
 * and resolving it by the order the caller happened to collect candidates in
 * would make the answer depend on the shape of a list rather than on a decision.
 * Earlier wins; a kind absent here would rank last, which `clickScopeRank`
 * already prevents by throwing.
 */
const CLICK_KIND_TIE_ORDER = Object.freeze([
  CLICK_TARGET_KIND.FRAME,
  CLICK_TARGET_KIND.SOLID,
  CLICK_TARGET_KIND.ROBOT,
  CLICK_TARGET_KIND.ANNOTATION,
])

/**
 * The nearest candidate of a list, or null. An exact tie falls through to the
 * declared kind order above, so the result never depends on input order.
 */
function nearest(candidates) {
  let best = null
  for (const c of candidates) {
    if (!best) { best = c; continue }
    if (c.distance < best.distance) { best = c; continue }
    if (c.distance === best.distance &&
        CLICK_KIND_TIE_ORDER.indexOf(c.kind) < CLICK_KIND_TIE_ORDER.indexOf(best.kind)) {
      best = c
    }
  }
  return best
}

/**
 * Resolve a pointer's candidate hits to the one entity the click means.
 *
 * Every candidate's kind is ranked BEFORE any winner is chosen, so an
 * undeclared kind throws whether or not it would have won — a rule that only
 * notices unknown kinds when they happen to be nearest is a rule that passes
 * its own test suite and fails in the field.
 *
 * A candidate with a non-finite distance is treated as infinitely far rather
 * than dropped: it can still win its rank when it is the only member, which
 * preserves the behaviour of the bounding-box fallbacks that report a hit
 * without a meaningful depth.
 *
 * @param {ReadonlyArray<ClickCandidate|null|undefined>} candidates
 * @param {(frameObj: object, bodyObj: object) => boolean} isFrameWithin
 *   "is this frame part of that body?" — owned by the caller (the scene graph).
 * @returns {ClickCandidate|null} the winning candidate, or null when nothing was hit
 */
export function chooseClickTarget(candidates, isFrameWithin) {
  const live = (candidates ?? [])
    .filter(c => c && c.obj)
    .map(c => ({ ...c, distance: Number.isFinite(c.distance) ? c.distance : Infinity }))

  // Rank everything first — see the note above about throwing regardless of rank.
  for (const c of live) clickScopeRank(c.kind)

  const frame = nearest(live.filter(c => clickScopeRank(c.kind) < BODY_RANK))
  const body  = nearest(live.filter(c => clickScopeRank(c.kind) === BODY_RANK))
  const rest  = nearest(live.filter(c => clickScopeRank(c.kind) > BODY_RANK))

  if (frame && body) {
    // Rule 3: the frame wins only where it is genuinely the narrower scope —
    // i.e. it is part of the body underneath it. Otherwise its generous tap box
    // must not shadow the body (this is the pre-ADR-140 behaviour, unchanged).
    return isFrameWithin(frame.obj, body.obj) ? frame : body
  }
  return frame ?? body ?? rest ?? null
}
