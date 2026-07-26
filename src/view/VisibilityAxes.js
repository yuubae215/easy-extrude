/**
 * VisibilityAxes — the two orthogonal axes an entity's visibility is made of,
 * and the ONE composition that turns them into pixels (ADR-096).
 *
 * ## Why two axes
 *
 * A CoordinateFrame's axes were written by two writers that did not know about
 * each other: the Outliner eye (persistent, user-owned) and selection
 * (transient, context-owned). Neither read the other, so the Outliner row was a
 * seeded `true` that had never been derived from anything — the row said "eye
 * open" while the viewport drew nothing, the first click sent `false` to
 * something already hidden (input consumed, nothing happened — 原則 #11), and
 * selecting another entity wiped an axis the user had explicitly opened.
 *
 * The defect is the two writers, not the two features: a persistent intent and
 * a transient context genuinely have different lifetimes and different owners.
 * So they stay two axes, and the *pixels* get exactly one owner (原則 #4) —
 * the same shape ADR-094 took for the LINK NETWORK panel's
 * `forceHidden × collapsed`. Handlers own AXES; nobody owns pixels but the
 * composition.
 *
 *   explicit   : boolean                       — "always show this"  (eye, persistent)
 *   contextual : 'full' | 'dimmed' | null      — "show this for now" (selection, transient)
 *
 * ## Why the defaults live in a table
 *
 * The row's `true` was a default nobody declared. 原則 #31: a value that was
 * never stated must not be indistinguishable from a value that was — so the
 * default is DECLARED per kind, and `defaultExplicit()` throws rather than
 * inventing one for a kind that forgot to add its row. Adding an entity kind
 * without deciding its visibility default is a test failure, not a silent
 * `true`.
 *
 * `robot_base` carries two rows, keyed by the ENTRY POINT it was born through
 * rather than by its kind: a robot seeded onto the empty boot scene stays down
 * (an arm standing alone reads as clutter — ADR-089 follow-up), while a robot
 * the user just asked for must appear (原則 #11). That distinction already
 * exists in the domain (`ensureRobotFrames({seed:true})` vs `addRobot()`,
 * ADR-090) — this table only hangs a default on it.
 *
 * Pure module: no THREE, no DOM, no domain imports. The `instanceof` narrowing
 * that produces `isFrame` / `isRobotBase` belongs to the caller (原則 #2 — the
 * branch is on type, and it happens in one place: SceneService).
 *
 * @see docs/adr/ADR-096-visibility-two-axes-declared-defaults.md
 * @see docs/gsn/adr-096-visibility-two-axes.gsn
 */

/**
 * The contextual axis' vocabulary. `null` (absent) is the third value and is
 * deliberately NOT a member here — "no context asked for this" is the absence
 * of a request, not a mode.
 */
export const CONTEXTUAL = Object.freeze({
  FULL:   'full',
  DIMMED: 'dimmed',
})

/**
 * Entry points an entity can be born through, where the entry — not the kind —
 * decides the visibility default (ADR-096 §Decision 3).
 *   'seed'      — the scene put it there (boot seed, template/import upgrade).
 *   'userAdded' — the user asked for it just now.
 */
export const VISIBILITY_ENTRY = Object.freeze({
  SEED:       'seed',
  USER_ADDED: 'userAdded',
})

/**
 * The kinds the default table is keyed by. Every member MUST have a row in
 * `EXPLICIT_DEFAULTS` — asserted by counting, not by walking what happens to be
 * there (原則 #31).
 */
export const VISIBILITY_KIND = Object.freeze({
  /** Solid / ImportedMesh / MeasureLine / Profile / Annotated* — the outline itself. */
  GEOMETRY:          'geometry',
  /** User CF, body frame (Origin), tcp — axes are context furniture. */
  COORDINATE_FRAME:  'coordinateFrame',
  /** robot_base born from the boot seed / a loaded scene. */
  ROBOT_BASE_SEEDED: 'robotBaseSeeded',
  /** robot_base born from the user's Add ▸ Robot. */
  ROBOT_BASE_ADDED:  'robotBaseAdded',
})

/**
 * The declared `explicit` default per kind (ADR-096 §Decision 3).
 *
 * Read through `defaultExplicit()` — never index this directly, or an unknown
 * kind silently reads `undefined` and coerces to "hidden", which is exactly the
 * un-declared default this ADR exists to remove.
 */
export const EXPLICIT_DEFAULTS = Object.freeze({
  // The outline IS the entity; hidden geometry cannot be found again.
  [VISIBILITY_KIND.GEOMETRY]:          true,
  // Axes everywhere is noise; ADR-087's "select a Solid → its grounding CF
  // appears" is precisely the contextual axis doing this job instead.
  [VISIBILITY_KIND.COORDINATE_FRAME]:  false,
  // An arm standing alone on an empty scene reads as clutter (ADR-089 follow-up).
  [VISIBILITY_KIND.ROBOT_BASE_SEEDED]: false,
  // The user just asked for it — nothing appearing would be a silent no-op (#11).
  [VISIBILITY_KIND.ROBOT_BASE_ADDED]:  true,
})

/**
 * Classifies an entity for the default table.
 *
 * Takes booleans rather than the entity so this module stays free of domain and
 * THREE imports; the caller does the `instanceof` / `isRobotBaseFrame()`
 * narrowing once (SceneService).
 *
 * @param {{isFrame: boolean, isRobotBase?: boolean, entry?: string}} descriptor
 * @returns {string} a `VISIBILITY_KIND` member
 */
export function visibilityKindOf({ isFrame, isRobotBase = false, entry = VISIBILITY_ENTRY.SEED }) {
  if (!isFrame) return VISIBILITY_KIND.GEOMETRY
  if (!isRobotBase) return VISIBILITY_KIND.COORDINATE_FRAME
  return entry === VISIBILITY_ENTRY.USER_ADDED
    ? VISIBILITY_KIND.ROBOT_BASE_ADDED
    : VISIBILITY_KIND.ROBOT_BASE_SEEDED
}

/**
 * The declared default for a kind. Throws on an undeclared kind — a new entity
 * kind must DECLARE its visibility default, not inherit one nobody chose
 * (原則 #31; the bug this ADR fixes was exactly an inherited `true`).
 *
 * @param {string} kind  a `VISIBILITY_KIND` member
 * @returns {boolean}
 */
export function defaultExplicit(kind) {
  if (!Object.hasOwn(EXPLICIT_DEFAULTS, kind)) {
    throw new Error(
      `[VisibilityAxes] no declared explicit-visibility default for kind "${kind}". ` +
      'Add a row to EXPLICIT_DEFAULTS — a default nobody declared is the defect ADR-096 removes.',
    )
  }
  return EXPLICIT_DEFAULTS[kind]
}

/**
 * THE composition (ADR-096 §Decision 2). The only function that answers "is
 * this drawn, and how" — everything else writes an axis and calls this.
 *
 *   visible  = explicit || contextual !== null
 *   dimmed   = only when the contextual axis asked for dimming AND the user has
 *              not explicitly claimed the entity. An explicitly shown entity is
 *              never dimmed by someone else's selection — that would make the
 *              eye a suggestion rather than a statement.
 *
 * @param {{explicit: boolean, contextual: string|null}} axes
 * @returns {{visible: boolean, dimmed: boolean}}
 */
export function composeVisibility({ explicit, contextual = null }) {
  const visible = Boolean(explicit) || contextual !== null
  const dimmed  = visible && !explicit && contextual === CONTEXTUAL.DIMMED
  return { visible, dimmed }
}
