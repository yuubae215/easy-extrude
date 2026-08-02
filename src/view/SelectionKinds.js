/**
 * SelectionKinds — the two DECLARATION TABLES a selectable kind must appear in
 * (ADR-107 D4 / D6).
 *
 * Widening the selection union (`src/domain/selection.js`) makes "what is
 * selected" polymorphic. Two questions become kind-dependent at that moment:
 *
 *   1. **What does it look like in 3-D?** Everything selectable used to have a
 *      body, so "selecting shows something" was true by accident of the
 *      population rather than by rule. A kind without a 3-D response makes
 *      selection a silent no-op (原則 #11) — the worst failure shape, because
 *      the input was consumed and nothing happened.
 *   2. **What does the right-hand panel show?** (v8 注釈⑤ — the panel's content
 *      swaps with the kind.)
 *
 * Both are answered by a TABLE, not by an `if` chain, and both **throw on an
 * undeclared kind**. That is the difference between a fact and a rule: "today's
 * two kinds both have a shape" is a fact; a third kind added later would
 * reintroduce silence *and the tests would stay green*. The population of both
 * tables is derived from the union's own branches (`src/SelectionKindDeclarations.test.js`),
 * so adding a branch without a row fails rather than falling through.
 *
 * Same discipline as `EXPLICIT_DEFAULTS` (ADR-096), `PLACEMENT_BY_KIND` /
 * `SUPPORT_SURFACE_BY_KIND` (ADR-097/102) and `ENTITY_SCOPE_BY_KIND` (ADR-105).
 *
 * Pure: no THREE, no DOM — the tables must be readable by the node test runner.
 *
 * @see docs/adr/ADR-107-selection-has-two-kinds.md
 * @module view/SelectionKinds
 */

import { SELECTION_KIND } from '../domain/selection.js'

/**
 * **宣言表 1/2** — how each SELECTABLE kind becomes visible in 3-D.
 *
 * `paint` names the painter `SelectionManager` runs for that kind. Every painter
 * runs on every transition with the whole selection, so leaving a kind releases
 * its paint by the same wholesale write that claims the new one — "the window
 * that forgot to clean up" stays unrepresentable (ADR-099 `_apply`).
 */
export const SELECTION_SHAPE_BY_KIND = Object.freeze({
  [SELECTION_KIND.ENTITIES]: Object.freeze({
    paint: 'meshHighlight',
    shape: 'the entity outline itself, plus its frame context at DIMMED',
    why:   'An entity IS a body; highlighting it is the tactile answer to "I picked this" (ADR-099 G2).',
  }),
  [SELECTION_KIND.VARIABLES]: Object.freeze({
    paint: 'undecidedBand',
    shape: 'the undecided band (region ghost, ADR-050) + the entities the variable ' +
           'constrains, at DIMMED',
    why:   'A shared design variable is an interval, not a thing — but a SPATIAL interval: ' +
           'the band its claims span IS its body (v8 注釈⑤). When the variable is scalar ' +
           '(no footprint) the DIMMED entities carry the response, and when it constrains ' +
           'nothing either, the panel says so in words rather than leaving the gesture silent (原則 #11).',
  }),
})

/**
 * **宣言表 2/2** — what the N panel talks about for each selection kind
 * (including `empty`, which is a state the panel must also have an answer for).
 *
 * `body` names the panel section; `NPanel.jsx` branches on the `type` the
 * controller writes, and `src/view/EntityScopeChecks.js` declares the
 * entity-scope entry per `type` (原則 #17 — the polymorphic member exists on
 * every implementation, `false` included).
 */
export const NPANEL_BY_SELECTION_KIND = Object.freeze({
  [SELECTION_KIND.EMPTY]: Object.freeze({
    body: 'activeEntity',
    why:  'Clearing the selection does not clear the active entity (ADR-099 `clearSelection`): ' +
          'the panel keeps talking about it, exactly as before. 0 selected is a legal, ' +
          'frequent state — not a reason to blank the slot (原則 #15).',
  }),
  [SELECTION_KIND.ENTITIES]: Object.freeze({
    body: 'activeEntity',
    why:  'The active entity of the selection — generic / frame / link bodies, unchanged.',
  }),
  [SELECTION_KIND.VARIABLES]: Object.freeze({
    body: 'variable',
    why:  'The variable\'s claims, its gap and who is fighting over it — the detail the ' +
          'floor\'s matrix cell only summarises (v8 注釈⑤).',
  }),
})

/**
 * The declared 3-D shape of a selectable kind. Throws on an undeclared kind — a
 * new selectable kind must DECLARE how it answers the gesture, not inherit
 * silence from a fall-through (原則 #11 at the level of kinds).
 *
 * @param {string} kind — a `SELECTABLE_KINDS` member
 */
export function shapeForKind(kind) {
  if (!Object.hasOwn(SELECTION_SHAPE_BY_KIND, kind)) {
    throw new Error(
      `[SelectionKinds] no declared 3-D shape for selectable kind "${kind}". ` +
      'Add a row to SELECTION_SHAPE_BY_KIND — a kind that is selectable but invisible makes ' +
      'selection a silent no-op, and the tests would stay green (ADR-107 D4 / 原則 #11).',
    )
  }
  return SELECTION_SHAPE_BY_KIND[kind]
}

/**
 * The declared N-panel body for a selection kind. Throws on an undeclared kind
 * (原則 #17 / #31 — the undeclared kind must not be indistinguishable from a
 * declared default).
 *
 * @param {string} kind — a `SELECTION_KIND` member
 */
export function npanelBodyFor(kind) {
  if (!Object.hasOwn(NPANEL_BY_SELECTION_KIND, kind)) {
    throw new Error(
      `[SelectionKinds] no declared N-panel body for selection kind "${kind}". ` +
      'Add a row to NPANEL_BY_SELECTION_KIND — a fall-through makes "the declared default" ' +
      'and "the kind nobody thought about" indistinguishable (ADR-107 D6 / 原則 #31).',
    )
  }
  return NPANEL_BY_SELECTION_KIND[kind]
}

/** The painter names the shape table declares (the census reads this). */
export const DECLARED_PAINTERS = Object.freeze(
  Object.values(SELECTION_SHAPE_BY_KIND).map(s => s.paint),
)
