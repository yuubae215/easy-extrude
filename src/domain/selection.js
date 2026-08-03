/**
 * selection.js — THE selection VALUE (ADR-107 D1 / D3).
 *
 * ADR-099 established that there is exactly ONE entrance to changing what is
 * selected (`SelectionManager`'s five verbs). It did not establish that the only
 * selectable *thing* is an entity with a 3-D body — that was merely the only
 * kind that existed. Widening the element kind is therefore the correct
 * extension, and this module is the widened value: the entrance count does not
 * change, the members do.
 *
 * ## Why a discriminated union rather than one Set
 *
 * `Set<string>` has no kind. Mixing a document's shared-design-variable `ref`
 * into the entity-id set would make the kind a property of the *string* — a
 * naming convention (`var:` prefixes) enforced by review, which is precisely
 * what 原則 #21 forbids for coordinate spaces and what applies unchanged to
 * namespaces. Entity ids and document refs are names from different worlds that
 * merely happen to be comparable as strings.
 *
 *     Selection =
 *       | { kind: 'empty' }
 *       | { kind: 'entities',  ids:  Set<entityId> }    // size ≥ 1
 *       | { kind: 'variables', refs: Set<variableRef> } // size ≥ 1
 *
 * Two properties are load-bearing:
 *
 *   - **`empty` is the first branch, not an empty `entities`.** "Nothing is
 *     selected" is a state without a kind. If both `entities([])` and
 *     `variables([])` were constructible, the same fact would have two
 *     representations (§1.1) and every reader would have to normalise them.
 *     `makeSelection([])` therefore returns the one `EMPTY_SELECTION`.
 *
 *   - **A mixed selection cannot be constructed.** `makeSelection` is the only
 *     way to build a selection value and it throws on mixed members. Allowing a
 *     mix would force the N panel to decide *which* detail to show, and that
 *     decision has no natural answer — filling the absence of a decision with a
 *     default is the defect 原則 #31 names. Rectangle selection and viewport
 *     picking only ever collect geometry, so a mix is not an intended gesture;
 *     it is only reachable by accident.
 *
 * Pure: no THREE, no DOM, no I/O — loads under bare `node --test`.
 *
 * @see docs/adr/ADR-107-selection-has-two-kinds.md
 * @see docs/gsn/adr-107-selection-has-two-kinds.gsn
 * @module domain/selection
 */

/**
 * @typedef {{ns: 'variable', ref: string}} VariableRef
 *   A document variable, wrapped in its namespace so it is never comparable to
 *   an entity id as a bare string.
 * @typedef {string|VariableRef} SelectionMember
 * @typedef {{kind: 'empty'}
 *          |{kind: 'entities',  ids:  Set<string>}
 *          |{kind: 'variables', refs: Set<string>}} Selection
 */

/** The three branches of the selection union. */
export const SELECTION_KIND = Object.freeze({
  /** Nothing is selected. Cardinality 0 has exactly ONE representation. */
  EMPTY:     'empty',
  /** Entities with a 3-D body (Solid / CoordinateFrame / SpatialLink / …). */
  ENTITIES:  'entities',
  /** Shared design variables of the context document (`d_ref`, `cycle`, …). */
  VARIABLES: 'variables',
})

/**
 * The kinds something can be selected AS. `empty` is deliberately absent: it is
 * the state of having selected nothing, not a kind of thing one can select.
 * Every member here must declare its 3-D shape (ADR-107 D4) — the declaration
 * tables in `src/view/SelectionKinds.js` derive their population from this.
 */
export const SELECTABLE_KINDS = Object.freeze([
  SELECTION_KIND.ENTITIES,
  SELECTION_KIND.VARIABLES,
])

/** THE representation of "nothing is selected" (there is only one). */
export const EMPTY_SELECTION = Object.freeze({ kind: SELECTION_KIND.EMPTY })

/**
 * The empty entity-id set handed to readers when the selection is not entity-
 * shaped. Shared so that `ids` is allocation-free and identity-stable — readers
 * compare `.size`, iterate, and must never mutate it.
 */
const NO_MEMBERS = Object.freeze(new Set())

/** Namespace tag of the variable-ref token. Never appears inside a ref string. */
const VARIABLE_NS = 'variable'

/**
 * Wraps a document variable ref in its namespace token, so a variable can be
 * handed to the same five verbs an entity id goes through without the two ever
 * being comparable as bare strings.
 *
 * @param {string} ref — a `variables[].ref` of the context document
 * @returns {VariableRef} frozen token
 */
export function variableRef(ref) {
  if (typeof ref !== 'string' || ref.length === 0) {
    throw new TypeError(`[selection] variableRef() needs a non-empty ref, got ${JSON.stringify(ref)}`)
  }
  return Object.freeze({ ns: VARIABLE_NS, ref })
}

/** @param {unknown} x @returns {x is VariableRef} true for a `variableRef()` token. */
export function isVariableRef(x) {
  if (typeof x !== 'object' || x === null) return false
  const t = /** @type {{ns?: unknown, ref?: unknown}} */ (x)
  return t.ns === VARIABLE_NS && typeof t.ref === 'string'
}

/** @param {unknown} x @returns {x is string} true for a bare entity id. */
export function isEntityId(x) {
  return typeof x === 'string' && x.length > 0
}

/**
 * The kind ONE member belongs to. Throws for anything that is neither an entity
 * id nor a variable token — a member whose namespace nobody declared must not
 * silently become "an entity" because entity ids are the plain strings
 * (原則 #31: the undeclared kind and the declared default must stay
 * distinguishable).
 *
 * @param {unknown} member
 * @returns {string} a `SELECTABLE_KINDS` member
 */
export function kindOfMember(member) {
  if (isVariableRef(member)) return SELECTION_KIND.VARIABLES
  if (isEntityId(member))    return SELECTION_KIND.ENTITIES
  throw new TypeError(
    `[selection] member of unknown namespace: ${JSON.stringify(member)}. ` +
    'An entity id is a string; a document variable must be wrapped in variableRef(ref) — ' +
    'namespaces are distinguished by shape, never by a naming convention (ADR-107 D3 / 原則 #21).',
  )
}

/**
 * THE constructor of a selection value — the only path to one, which is what
 * makes a mixed selection unconstructible rather than merely discouraged.
 *
 * @param {Iterable<SelectionMember>} members — entity ids and/or `variableRef()`
 *   tokens. An empty iterable yields `EMPTY_SELECTION`.
 * @returns {Selection} frozen union
 * @throws {TypeError} on a mixed member list, or an unknown member namespace
 */
export function makeSelection(members) {
  const list = [...members]
  if (list.length === 0) return EMPTY_SELECTION

  const kinds = new Set(list.map(kindOfMember))
  if (kinds.size > 1) {
    throw new TypeError(
      '[selection] a selection cannot mix kinds ' +
      `(${[...kinds].sort().join(' + ')}). ` +
      'The N panel would have to decide which detail to show, and that decision has no ' +
      'natural answer — the absence of a decision must not be filled with a default ' +
      '(ADR-107 D1 / 原則 #31). Select one kind, or widen the union deliberately.',
    )
  }

  if ([...kinds][0] === SELECTION_KIND.VARIABLES) {
    const refs = new Set(list.map(m => /** @type {VariableRef} */ (m).ref))
    return Object.freeze({ kind: SELECTION_KIND.VARIABLES, refs })
  }
  const ids = new Set(/** @type {string[]} */ (list))
  return Object.freeze({ kind: SELECTION_KIND.ENTITIES, ids })
}

/**
 * The members of a selection, in that selection's own namespace (entity ids for
 * `entities`, bare variable refs for `variables`, none for `empty`).
 * @param {Selection} sel
 * @returns {Set<string>}
 */
export function selectionMembers(sel) {
  if (sel?.kind === SELECTION_KIND.ENTITIES)  return sel.ids
  if (sel?.kind === SELECTION_KIND.VARIABLES) return sel.refs
  return NO_MEMBERS
}

/** Selection cardinality — 0, 1 or N (原則 #31). @param {Selection} sel */
export function selectionSize(sel) {
  return selectionMembers(sel).size
}

/**
 * The selected ENTITY ids — empty (not "all", not "undefined") when the
 * selection is of another kind. This is what the many read-only call sites of
 * `AppController._selectedIds` keep reading: with a variable selected, no entity
 * is selected, and that is the honest answer rather than a special case each
 * reader has to know about.
 * @param {Selection} sel
 * @returns {Set<string>}
 */
export function entityIdsOf(sel) {
  return sel?.kind === SELECTION_KIND.ENTITIES ? sel.ids : NO_MEMBERS
}

/**
 * The selected VARIABLE refs — empty when the selection is of another kind.
 * @param {Selection} sel
 * @returns {Set<string>}
 */
export function variableRefsOf(sel) {
  return sel?.kind === SELECTION_KIND.VARIABLES ? sel.refs : NO_MEMBERS
}

/**
 * Membership test in the member's OWN namespace: a bare string asks about
 * entities, a `variableRef()` token asks about variables. A variable can
 * therefore never test true against an entity selection just because the
 * strings match.
 * @param {Selection} sel
 * @param {SelectionMember} member
 */
export function selectionHas(sel, member) {
  const kind = kindOfMember(member)
  if (sel?.kind !== kind) return false
  return selectionMembers(sel).has(isVariableRef(member) ? member.ref : member)
}

/**
 * A plain, serialisable copy for the display layer (uiStore / React). It is a
 * COPY of the authority, deliberately shaped differently from the union so that
 * a panel can never be mistaken for the source (§1.1 — the same reason
 * `LinkNetworkView` holds `_selectionEntityIds` and not `_selectedIds`).
 * @param {Selection} sel
 * @returns {{kind: string, members: string[]}}
 */
export function selectionSummary(sel) {
  return { kind: sel?.kind ?? SELECTION_KIND.EMPTY, members: [...selectionMembers(sel)] }
}
