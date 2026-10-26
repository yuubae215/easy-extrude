/**
 * LegacyRelations — the retired relation words `above` / `adjacent` and the
 * place their old data moves to (ADR-168 S2-2).
 *
 * `above` and `adjacent` were SpatialLink semanticTypes that each carried two
 * facts (ADR-168 力学 1). They are no longer words a link can say. A file that
 * still says them is read without loss: every such link becomes an **unclaimed
 * relation** — a relation nobody has claimed yet, kept until a person claims it
 * in their own name (`DocBuilder.claimUnclaimed`).
 *
 *   unclaimed = { subject, of, cell, was, properties? }
 *
 *   subject / of — the link's source / target (layout refs in a layout, scene
 *                  ids in a scene JSON)
 *   cell         — the cell of the contact × direction grid the old word reads
 *                  as (`relationCells`). The reading says no more than the old
 *                  word did: `above` = "higher, contact not said" (`_:above`),
 *                  `adjacent` = "a neighbour — neither axis said" (`_:_`).
 *                  Narrowing it is the claimant's call, not the loader's.
 *   was          — the old word, kept verbatim
 *   properties   — the link's properties (e.g. its `note`), kept verbatim
 *
 * A link that ALSO has a joint (`jointType` not null) cannot move: the joint is
 * the link's own fact (mobility — ADR-168 D1) and the link would be left with no
 * word, so a word would have to be invented for it. Such a file is refused with
 * the pair named (原則 #11) — no creation path ever wrote one.
 *
 * The reading table throws on a word it does not declare (原則 #31 — a word
 * nobody thought about is not read as anything).
 *
 * Pure, THREE-free, input-immutable.
 *
 * @module layout/LegacyRelations
 */
import { cellById, UNSTATED } from '../domain/relationCells.js'
import { RELATIVE_DIRS } from '../domain/arrangement.js'

/** The cell each retired word is read as. The one table (§1.1). */
export const LEGACY_CELL_BY_WORD = Object.freeze({
  above:    `${UNSTATED}:above`,
  adjacent: `${UNSTATED}:${UNSTATED}`,
})

/** The retired relation words. */
export const RETIRED_RELATION_WORDS = Object.freeze(Object.keys(LEGACY_CELL_BY_WORD))

/** @param {unknown} word */
export function isRetiredRelationWord(word) {
  return typeof word === 'string' && Object.prototype.hasOwnProperty.call(LEGACY_CELL_BY_WORD, word)
}

/**
 * The cell a retired word is read as. Throws on any other word.
 * @param {string} word
 * @returns {string}
 */
export function legacyCellOf(word) {
  if (!isRetiredRelationWord(word)) {
    throw new Error(`LegacyRelations: "${word}" is not a retired relation word (${RETIRED_RELATION_WORDS.join(', ')})`)
  }
  return LEGACY_CELL_BY_WORD[word]
}

/** Raised when an old link cannot be moved without inventing a word. */
export class RetiredRelationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'RetiredRelationError'
  }
}

/**
 * Which unclaimed relation this is: the pair and the cell. The old word is not
 * part of it — two entries that say the same thing about the same pair are the
 * same relation. The one identity predicate (IDENTITY_RULES).
 * @param {{subject: string, of: string, cell: string}} u
 */
export function unclaimedKey(u) {
  return `${u.subject}|${u.of}|${u.cell}`
}

/** @param {{subject: string, of: string, cell: string}} a @param {{subject: string, of: string, cell: string}} b */
export function isSameUnclaimed(a, b) {
  return unclaimedKey(a) === unclaimedKey(b)
}

/**
 * The trace target that names an unclaimed relation — the counterpart of
 * `constraintRef` (`constraint:a→b`) for the relation it used to be.
 * @param {{subject: string, of: string}} u
 */
export function unclaimedRef(u) {
  return `unclaimed:${u.subject}→${u.of}`
}

/**
 * What is wrong with one unclaimed relation, read on its own ([] = nothing).
 * @param {unknown} u
 * @returns {string[]}
 */
export function unclaimedIssues(u) {
  if (!u || typeof u !== 'object') return ['must be an object']
  const e = /** @type {any} */ (u)
  const out = []
  if (typeof e.subject !== 'string' || !e.subject) out.push('subject must be a non-empty string')
  if (typeof e.of !== 'string' || !e.of) out.push('of must be a non-empty string')
  if (!isRetiredRelationWord(e.was)) out.push(`was "${e.was}" is not a retired relation word (${RETIRED_RELATION_WORDS.join(', ')})`)
  if (e.properties !== undefined && (e.properties === null || typeof e.properties !== 'object' || Array.isArray(e.properties))) {
    out.push('properties must be an object')
  }
  let cell = null
  try { cell = cellById(e.cell) } catch (err) { out.push(/** @type {Error} */ (err).message) }
  if (cell && !cell.declarable) out.push(`cell "${e.cell}" cannot be declared: ${cell.reason}`)
  if (cell && RELATIVE_DIRS.includes(cell.direction)) {
    out.push(`cell "${e.cell}" is relative — it needs a viewer, which an unclaimed relation does not carry`)
  }
  for (const k of Object.keys(e)) {
    if (!['subject', 'of', 'cell', 'was', 'properties'].includes(k)) out.push(`unknown field "${k}"`)
  }
  return out
}

/**
 * One old link → one unclaimed relation, or throw when it also has a joint.
 * @param {{subject: string, of: string, jointType?: string|null, word: string, properties?: object}} link
 */
function _toUnclaimed({ subject, of, jointType, word, properties }) {
  if (jointType !== null && jointType !== undefined) {
    throw new RetiredRelationError(
      `"${subject}" → "${of}" has the joint "${jointType}" and the retired word "${word}" at once — ` +
      `it cannot be moved without inventing a word for the joint (ADR-168 S2-2). Change one of them by hand.`)
  }
  /** @type {{subject: string, of: string, cell: string, was: string, properties?: object}} */
  const u = { subject, of, cell: legacyCellOf(word), was: word }
  if (properties && typeof properties === 'object' && Object.keys(properties).length > 0) {
    u.properties = structuredClone(properties)
  }
  return u
}

/**
 * Move a layout's retired-word constraints into `unclaimedRelations`. The
 * same object comes back when there is nothing to move.
 *
 * @param {object} dsl  a Layout DSL (resolved or hydrated)
 * @param {string} version  the version a moved layout is labelled with
 * @returns {{dsl: object, moved: {subject: string, of: string}[]}}
 * @throws {RetiredRelationError}
 */
export function migrateLayoutRelations(dsl, version) {
  const constraints = Array.isArray(dsl?.constraints) ? dsl.constraints : []
  if (!constraints.some(c => isRetiredRelationWord(c?.semanticType))) return { dsl, moved: [] }
  const kept = []
  const moved = []
  for (const c of constraints) {
    if (!isRetiredRelationWord(c?.semanticType)) { kept.push(c); continue }
    moved.push(_toUnclaimed({
      subject: c.source, of: c.target, jointType: c.jointType, word: c.semanticType, properties: c.properties,
    }))
  }
  const next = { ...dsl, version, constraints: kept, unclaimedRelations: [...(dsl.unclaimedRelations ?? []), ...moved] }
  return { dsl: next, moved }
}

/**
 * Move a scene JSON's retired-word links (v1.3 `semanticType`, or v1.2
 * `linkType`) into `unclaimedRelations` (scene ids). The same object comes
 * back when there is nothing to move.
 *
 * @param {object} scene  a scene JSON (parseImportJson output or a stored payload)
 * @param {string} version  the version a moved scene is labelled with
 * @returns {{scene: object, moved: {subject: string, of: string}[]}}
 * @throws {RetiredRelationError}
 */
export function migrateSceneRelations(scene, version) {
  const links = Array.isArray(scene?.links) ? scene.links : []
  const wordOf = (l) => l?.semanticType ?? l?.linkType
  if (!links.some(l => isRetiredRelationWord(wordOf(l)))) return { scene, moved: [] }
  const kept = []
  const moved = []
  for (const l of links) {
    if (!isRetiredRelationWord(wordOf(l))) { kept.push(l); continue }
    moved.push(_toUnclaimed({
      subject: l.sourceId, of: l.targetId, jointType: l.jointType, word: wordOf(l), properties: l.properties,
    }))
  }
  const next = { ...scene, version, links: kept, unclaimedRelations: [...(scene.unclaimedRelations ?? []), ...moved] }
  return { scene: next, moved }
}

/**
 * Move a Context document's retired-word constraints (in
 * `specification.layout`) into unclaimed relations, and point every trace that
 * named such a constraint at the unclaimed relation instead — the relation
 * still traces to where it came from. The same object comes back when there is
 * nothing to move.
 *
 * @param {object} doc  a Context DSL document
 * @param {string} version  the layout version a moved layout is labelled with
 * @returns {{doc: object, moved: {subject: string, of: string}[]}}
 * @throws {RetiredRelationError}
 */
export function migrateDocRelations(doc, version) {
  const layout = doc?.specification?.layout
  if (!layout) return { doc, moved: [] }
  const { dsl, moved } = migrateLayoutRelations(layout, version)
  if (moved.length === 0) return { doc, moved }
  const renamed = new Map(moved.map(u => [`constraint:${u.subject}→${u.of}`, unclaimedRef(u)]))
  // A constraint that stayed (same pair, another word) keeps its trace.
  for (const c of dsl.constraints) renamed.delete(`constraint:${c.source}→${c.target}`)
  const trace = (doc.specification.trace ?? []).map(t => renamed.has(t?.to) ? { ...t, to: renamed.get(t.to) } : t)
  const specification = { ...doc.specification, layout: dsl }
  if (doc.specification.trace !== undefined) specification.trace = trace
  return { doc: { ...doc, specification }, moved }
}
