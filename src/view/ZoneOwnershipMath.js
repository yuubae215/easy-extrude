/**
 * ZoneOwnershipMath — what a selected zone's panel says about its owner and the
 * zones it overlaps (ADR-170 O2 / D2 / S3). Pure: the controller hands in the
 * zone, the overlap pairs (`domain/zone.js` zoneOverlaps) and who may act.
 *
 * Every sentence a kind can produce is declared in one table that throws on a
 * kind nobody declared (原則 #31). Nothing here scores or ranks (ADR-146 axis 1):
 * a conflict is a fact of two declared owners, not a severity.
 *
 * @module view/ZoneOwnershipMath
 */
import { ZONE_OVERLAP_KIND, ZONE_OWNER_KIND } from '../domain/zone.js'
import { OWNER_NONE_DECLARED } from '../context/Ownership.js'

/** How each overlap kind is said beside the zone. */
const OVERLAP_LINE = Object.freeze({
  [ZONE_OVERLAP_KIND.CONFLICT]:    (o) => `Conflict — overlaps "${o}", and the two owners differ`,
  [ZONE_OVERLAP_KIND.SAME_OWNER]:  (o) => `Overlaps "${o}" — same owner, nothing to settle`,
  [ZONE_OVERLAP_KIND.OWNERLESS]:   (o) => `Overlaps "${o}" — one is declared to belong to nobody, so no one to settle with`,
  [ZONE_OVERLAP_KIND.UNDECLARED]:  (o) => `Overlaps "${o}" — an owner is not declared (counted, not a conflict)`,
  [ZONE_OVERLAP_KIND.UNDECIDABLE]: (o) => `May overlap "${o}" — a concave zone is not decided yet`,
})

/** The tone each kind takes: only a conflict is told in the caution colour (ADR-100 — no new colour). */
export const OVERLAP_TONE = Object.freeze({
  [ZONE_OVERLAP_KIND.CONFLICT]:    'cautionTone',
  [ZONE_OVERLAP_KIND.SAME_OWNER]:  'textSecondary',
  [ZONE_OVERLAP_KIND.OWNERLESS]:   'textSecondary',
  [ZONE_OVERLAP_KIND.UNDECLARED]:  'textSecondary',
  [ZONE_OVERLAP_KIND.UNDECIDABLE]: 'textSecondary',
})

/**
 * The line for one overlap kind. Throws on an undeclared kind.
 * @param {string} kind
 * @param {string} otherName
 */
export function overlapLine(kind, otherName) {
  const say = OVERLAP_LINE[kind]
  if (!say) throw new Error(`ZoneOwnershipMath: no line declared for overlap kind "${kind}"`)
  return say(otherName)
}

/** The owner value, as a person reads it. */
function ownerText(owner) {
  if (owner.kind === ZONE_OWNER_KIND.ACTOR) return owner.ref
  if (owner.kind === ZONE_OWNER_KIND.NONE) return 'nobody (declared)'
  if (owner.kind === ZONE_OWNER_KIND.UNDECLARED) return 'not declared'
  throw new Error(`ZoneOwnershipMath: unknown owner kind "${owner.kind}"`)
}

/**
 * Which zones are in a conflict — the plates the 3D view lights (sole input of
 * `AnnotatedRegionView.setOwnerConflict`, through ZoneOwnershipController).
 * @param {ReadonlyArray<{a:{id:string}, b:{id:string}, kind:string}>} pairs
 * @returns {Set<string>}
 */
export function conflictedZoneIds(pairs) {
  const out = new Set()
  for (const p of pairs) {
    if (p.kind === ZONE_OVERLAP_KIND.CONFLICT) { out.add(p.a.id); out.add(p.b.id) }
  }
  return out
}

/**
 * The panel model for one zone.
 *
 * Declaring is offered only while the zone is undeclared (changing a declared
 * owner is decided with DEF-077), and only in someone's name — never filled in
 * from who drew it (O2). When it cannot be offered, `note` says why (原則 #11).
 *
 * @param {{
 *   zone: {id:string, name?:string},
 *   owner: {kind:string, ref?:string},
 *   pairs: ReadonlyArray<{a:any, b:any, kind:string}>,
 *   hasDocument: boolean,
 *   zoneRef: string|null,
 *   speaker: string|null,
 * }} p
 */
export function zonePanel({ zone, owner, pairs, hasDocument, zoneRef, speaker }) {
  const mine = pairs.filter(p => p.a.id === zone.id || p.b.id === zone.id)
  const overlaps = mine.map(p => {
    const other = p.a.id === zone.id ? p.b : p.a
    return { otherId: other.id, kind: p.kind, tone: OVERLAP_TONE[p.kind], text: overlapLine(p.kind, other.name ?? other.id) }
  })
  let note = null
  let actions = []
  if (owner.kind !== ZONE_OWNER_KIND.UNDECLARED) note = 'Changing a declared owner is not decided yet (DEF-077).'
  else if (!hasDocument) note = 'Open a document to declare an owner — the owner is written in the document, beside its actors.'
  else if (!zoneRef) note = 'This zone is not in the document, so it has no owner to declare.'
  else if (!speaker) note = 'Choose who is speaking (Relations section) — an owner is declared in someone\'s name, never filled in.'
  else actions = [
    { owner: speaker, label: `Own as ${speaker}` },
    { owner: OWNER_NONE_DECLARED, label: 'No owner' },
  ]
  return {
    owner: { text: ownerText(owner), kind: owner.kind },
    actions,
    note,
    overlaps,
    conflicts: overlaps.filter(o => o.kind === ZONE_OVERLAP_KIND.CONFLICT).length,
    undeclared: overlaps.filter(o => o.kind === ZONE_OVERLAP_KIND.UNDECLARED).length,
  }
}
