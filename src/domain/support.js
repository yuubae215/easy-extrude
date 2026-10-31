/**
 * support (domain) — which thing is held up by which, read off the declared
 * relations (ADR-168 S3).
 *
 * "Support" is not an axis a person declares. It is DERIVED from one cell of
 * the grid (`domain/relationCells.js`): a side that says `touching` on the
 * partner's `+z` face — "載っている". The same fact said from the other end
 * (the partner touches the subject's `-z` face — "is under it") is the same
 * support, so both readings fold onto one normal form (原則 #28):
 *
 *   { subject, of }  —  subject rests on `of`
 *
 * The face words are the partner's own faces (ADR-168 D1 — intrinsic), so a
 * rotated partner's `+z` is still "its top"; nothing here reads the placement.
 * The LINK NETWORK hangs a thing under its support (`LinkNetworkLayout`), and a
 * declaration is what the panel draws — a pose is not (ADR-168 S3 Q1).
 *
 * ## When declarations disagree (S3 Q2)
 *
 * Claims (each by someone) and unclaimed relations (said by a file, nobody yet)
 * are read together. When the statements about one pair disagree — on contact,
 * on the intrinsic face, or on which of the two rests on the other — the pair
 * is CONTESTED: it is not a support, and it is returned as such so the panel
 * can still draw it (not dropped — 原則 #11). Which statement is right is not
 * decided here (the same restraint as `claimConflicts`).
 *
 * Pure, THREE-free, input-immutable. The ids are whatever space the caller
 * speaks (layout refs or scene ids) — they are compared, never interpreted.
 *
 * @module domain/support
 */
import { frameOfToward } from './arrangement.js'
import { sideOfCell } from './relationCells.js'

/** The cell a supporting side says, and the cell of the same fact said the other way. */
export const SUPPORT_CELL = 'touching:+z'
export const SUPPORTED_BY_CELL = 'touching:-z'

/**
 * @typedef {{subject: string, of: string}} Support   subject rests on `of`
 * @typedef {{a: string, b: string}} ContestedPair    a < b
 */

/**
 * Every support the declarations state, and the pairs whose statements disagree.
 *
 * @param {{arrangements?: ReadonlyArray<{subject: string, sides?: ReadonlyArray<{of: string, contact?: string, toward?: unknown}>}>,
 *          unclaimed?: ReadonlyArray<{subject: string, of: string, cell: string}>}} declarations
 * @returns {{supports: Support[], contested: ContestedPair[]}}  both in a canonical order
 */
export function supportsOf({ arrangements = [], unclaimed = [] } = {}) {
  /** @type {Array<{subject: string, of: string, side: {contact?: string, toward?: unknown}}>} */
  const statements = []
  for (const arr of arrangements ?? []) {
    for (const side of arr.sides ?? []) statements.push({ subject: arr.subject, of: side.of, side })
  }
  // An unclaimed relation says its side as a cell; read it as the side a claim
  // would carry. (Which unclaimed relation it IS is `unclaimedKey`'s question —
  // not asked here: two copies of one statement agree with themselves.)
  for (const u of unclaimed ?? []) {
    const side = sideOfCell(u.cell)
    statements.push({ subject: u.subject, of: u.of, side })
  }

  /** @type {Map<string, {a: string, b: string, contact: Set<string>, face: Set<string>, rests: Set<string>}>} */
  const byPair = new Map()
  for (const { subject, of, side } of statements) {
    if (subject === of) continue
    const [a, b] = subject < of ? [subject, of] : [of, subject]
    const key = `${a}\u0000${b}`
    if (!byPair.has(key)) byPair.set(key, { a, b, contact: new Set(), face: new Set(), rests: new Set() })
    const pair = byPair.get(key)
    // Contact and face are compared per ordered reading: a face is the
    // PARTNER's face, so "+z of b" and "-z of a" are different words for one
    // fact — compared through `rests`, not as two faces.
    if (side.contact !== undefined) pair.contact.add(side.contact)
    const intrinsic = side.toward !== undefined && frameOfToward(side.toward) === 'intrinsic'
    if (intrinsic) pair.face.add(`${of}:${side.toward}`)
    const r = restsOn(subject, of, side)
    if (r) pair.rests.add(`${r.subject}\u0000${r.of}`)
  }

  const supports = []
  const contested = []
  for (const [, pair] of [...byPair].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) {
    if (pair.rests.size === 0) continue
    if (pair.contact.size > 1 || pair.rests.size > 1 || !supportFacesOnly(pair)) {
      contested.push({ a: pair.a, b: pair.b })
      continue
    }
    const [subject, of] = [...pair.rests][0].split('\u0000')
    supports.push({ subject, of })
  }
  return { supports, contested }
}

/**
 * The support one side states, in normal form, or null.
 * @param {string} subject
 * @param {string} of
 * @param {{contact?: string, toward?: unknown}} side
 * @returns {Support|null}
 */
export function restsOn(subject, of, side) {
  if (side?.contact !== 'touching') return null
  if (side.toward === '+z') return { subject, of }
  if (side.toward === '-z') return { subject: of, of: subject }
  return null
}

/**
 * Do the pair's face statements all name its one support — either reading of
 * it (the partner's top, or the subject's bottom)? A face elsewhere (a side
 * face of one of the two) says the two touch somewhere else: contested.
 */
function supportFacesOnly(pair) {
  const [rest] = [...pair.rests]
  const [subject, of] = rest.split('\u0000')
  const expected = new Set([`${of}:+z`, `${subject}:-z`])
  return [...pair.face].every(f => expected.has(f))
}
