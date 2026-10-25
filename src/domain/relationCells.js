/**
 * relationCells (domain) — the grid of everything one side of an Arrangement can
 * say: contact × direction, each axis also "not said" (ADR-168 — 2026-10-25).
 *
 * The grid comes first and the dictionary is laid onto it (当事者 2026-10-25:
 * 「組み合わせ表を先に作って、辞書を後で当てはめれば良い」). With the grid as the
 * population, "which cells have a way of saying them" is something that can be
 * counted instead of remembered (原則 #31).
 *
 * ## Cells are derived, not listed
 *
 *   contacts × directions = (CONTACTS ∪ {_}) × (FACE_TOWARD ∪ ABSOLUTE_TOWARD ∪ RELATIVE_DIRS ∪ {_})
 *
 * and whether a cell can be declared is asked of `arrangementIssues` — the one
 * validator R15 uses — so the grid can never allow what a document may not say,
 * or forbid what it may (§1.1). Adding an axis value to the domain adds its
 * cells here by construction.
 *
 * ## The ID is the cell's own values
 *
 *   id = `${contact}:${direction}`   with `_` for "not said"
 *   e.g. `touching:+z`, `apart:above`, `apart:front`, `_:+z`, `_:_`
 *
 * A natural key, not a serial number: it is computed from the values, so it
 * cannot drift from them and needs no registry that hands out numbers. A
 * relative direction's cell names the direction only — the viewer is a
 * parameter of the claim, not a different cell.
 *
 * Pure, THREE-free, input-immutable.
 *
 * @module domain/relationCells
 */
import {
  CONTACTS, FACE_TOWARD, ABSOLUTE_TOWARD, RELATIVE_DIRS, arrangementIssues, frameOfToward,
} from './arrangement.js'

/** The value of an axis that is not said. */
export const UNSTATED = '_'

const DIRECTIONS = Object.freeze([...FACE_TOWARD, ...ABSOLUTE_TOWARD, ...RELATIVE_DIRS])

/**
 * The ID of the cell a contact and a direction fall in.
 * @param {string|undefined} contact   a CONTACTS value, or undefined / `_` for not said
 * @param {unknown} toward             a declarable direction (string or {dir, viewer}), or undefined / `_`
 * @returns {string}
 */
export function cellId(contact, toward) {
  const c = contact === undefined || contact === UNSTATED ? UNSTATED : contact
  let t = UNSTATED
  if (toward !== undefined && toward !== UNSTATED) {
    t = frameOfToward(toward) === 'relative' ? /** @type {any} */ (toward).dir : /** @type {string} */ (toward)
  }
  return `${c}:${t}`
}

/** The cell of a declared side. @param {{contact?: string, toward?: unknown}} side */
export function cellOfSide(side) {
  return cellId(side?.contact, side?.toward)
}

/**
 * A side that says exactly what a cell says (a relative direction is seen by
 * `viewer`). The inverse of `cellOfSide` up to the viewer.
 * @param {string} id
 * @param {string} [viewer]
 * @returns {{contact?: string, toward?: unknown}}
 */
export function sideOfCell(id, viewer = 'viewer') {
  const cell = cellById(id)
  /** @type {{contact?: string, toward?: unknown}} */
  const side = {}
  if (cell.contact !== UNSTATED) side.contact = cell.contact
  if (cell.direction !== UNSTATED) {
    side.toward = RELATIVE_DIRS.includes(cell.direction) ? { dir: cell.direction, viewer } : cell.direction
  }
  return side
}

/** Does a declared side, read on its own, pass the validator? Returns the reason if not. */
function reasonRefused(side) {
  const issues = arrangementIssues(
    [{ ref: 'cell', by: 'someone', subject: 'a', sides: [{ of: 'b', ...side }] }],
    {
      actorRefs: new Set(['someone']),
      solidRefs: new Set(['a', 'b']),
      viewers: new Map([['viewer', { position: { x: 0, y: 0, z: 0 } }]]),
      kinematicLinks: [],
    },
  )
  return issues.length ? issues.map(m => m.replace(/^arrangement "cell" side 0: /, '')).join('; ') : null
}

/**
 * Every cell of the grid. `declarable` false carries the validator's reason —
 * a cell that cannot be said is kept, with why, not dropped (原則 #31).
 *
 * @type {ReadonlyArray<Readonly<{id: string, contact: string, direction: string,
 *                                declarable: boolean, reason: string|null}>>}
 */
export const RELATION_CELLS = Object.freeze(
  [...CONTACTS, UNSTATED].flatMap(contact => [...DIRECTIONS, UNSTATED].map(direction => {
    const id = `${contact}:${direction}`
    const side = {}
    if (contact !== UNSTATED) side.contact = contact
    if (direction !== UNSTATED) side.toward = RELATIVE_DIRS.includes(direction) ? { dir: direction, viewer: 'viewer' } : direction
    const reason = reasonRefused(side)
    return Object.freeze({ id, contact, direction, declarable: reason === null, reason })
  })),
)

const _byId = new Map(RELATION_CELLS.map(c => [c.id, c]))

/**
 * The cell with an ID. Throws on an ID outside the grid — a misspelt cell is
 * a mistake, not an empty answer.
 * @param {string} id
 */
export function cellById(id) {
  const cell = _byId.get(id)
  if (!cell) throw new Error(`relationCells: "${id}" is not a cell of the grid (contact:direction, "_" for not said)`)
  return cell
}

/** The cells that say both axes — the ones a combination can name. */
export function bothAxesSaid(cell) {
  return cell.contact !== UNSTATED && cell.direction !== UNSTATED
}
