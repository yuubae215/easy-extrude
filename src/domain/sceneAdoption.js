/**
 * sceneAdoption — bringing an object that is only on the screen into the document,
 * so a declaration about it has somewhere to live (ADR-159), together with what it
 * is attached to (ADR-163).
 *
 * Pure (no THREE, no DOM, no I/O): the THREE-free `node --test` lane exercises the
 * real rule. The controller supplies a serialized scene, a ref and the document's
 * footprint; the service performs the side effects.
 *
 * ## Why this exists
 *
 * A declaration (where to grasp, what it weighs) belongs to the DOCUMENT's entity,
 * keyed by `ref` (ADR-129 D0). The search, though, runs on what is on the screen
 * (ADR-132). So an object placed directly in the scene was searchable but not
 * declarable — the declaring press stopped with "adopt a document first" (DEF-049).
 * The press itself is the act that asks for the object to be declared, so the act
 * that brings it into the document rides on the same press (ADR-159 D1).
 *
 * ## Invert first, cut second (ADR-163 D1 / D2)
 *
 * The document projects an entity under the compiler's id (`solid_<ref>`), so an
 * adopted object is RE-CREATED under that id. Anything pointing at its old id — a
 * child frame, a SpatialLink — would be cut loose. ADR-159 cut the object out of
 * the scene BEFORE inverting it (`links: []`) and so had to refuse those (ADR-159 D4).
 * Now the whole scene is inverted once (`decompileLayout` — the same reading the
 * grasp search uses), and the cut is taken from that result: the connected
 * component of the pressed object, walking parent and link edges only through
 * objects the document does not hold yet. Those all enter the document together,
 * their relations as `parentRef` / `constraints`. A relation to an object the
 * document already holds enters as a constraint naming that object's DOCUMENT
 * ref; the document object itself is never read back (its `$fact` / `$decision`
 * would collapse to numbers — 原則 #28, ADR-055 §3).
 *
 * The only refusals left are an object not on the screen, and a component holding
 * something the Layout DSL cannot say (`unconvertible`, ADR-163 D4).
 *
 * @see docs/adr/ADR-159-declaring-on-the-screen-brings-the-object-into-the-document.md
 * @see docs/adr/ADR-163-adopting-from-the-screen-reads-the-whole-scene-and-cuts-a-component.md
 * @module domain/sceneAdoption
 */

import { decompileLayout, solidRefOfSceneId } from '../layout/LayoutDecompiler.js'

/**
 * Why an adoption cannot happen. A closed vocabulary: the toast is built from it,
 * so a new reason is declared here first (原則 #31).
 */
export const ADOPTION_REFUSAL = Object.freeze({
  NOT_ON_SCREEN: 'not-on-screen',
  UNCONVERTIBLE: 'unconvertible',
})

/**
 * The objects that enter the document with `startId` (ADR-163 D2):
 *
 *     C(r) = closure over E restricted to U of {r}
 *
 * U = scene objects the document does not hold (`held` is the projection
 * footprint, ADR-131); E = undirected parent (`parentId`) and SpatialLink edges.
 * A Solid's Origin and the frames under it join through their parent edges, so
 * they are counted as part of the Solid with no rule of their own. Held objects
 * stop the walk — they are already in the document.
 *
 * @param {object[]} objects  serialized scene objects
 * @param {object[]} links    serialized SpatialLinks
 * @param {Set<string>} held  scene ids the document projects
 * @param {string} startId
 * @returns {Set<string>} scene ids, `startId` included
 */
export function adoptionComponent(objects, links, held, startId) {
  const neighbours = new Map()
  const join = (a, b) => {
    if (!neighbours.has(a)) neighbours.set(a, [])
    if (!neighbours.has(b)) neighbours.set(b, [])
    neighbours.get(a).push(b)
    neighbours.get(b).push(a)
  }
  for (const o of objects) if (o.parentId) join(o.id, o.parentId)
  for (const l of links) join(l.sourceId, l.targetId)

  const component = new Set([startId])
  const queue = [startId]
  while (queue.length > 0) {
    for (const next of neighbours.get(queue.pop()) ?? []) {
      if (component.has(next) || held.has(next)) continue
      component.add(next)
      queue.push(next)
    }
  }
  return component
}

/**
 * @typedef {{ ok: true, entities: object[], constraints: object[], sceneIds: string[], name: string }
 *         | { ok: false, reason: string, name: string|null, detail: string }} AdoptionPlan
 */

/**
 * Plan adopting the scene Solid that decompiles to `ref` into a document.
 *
 * Returns the Layout DSL entities and constraints to write (the decompiler's
 * canonical form) and the scene ids the projection will replace. Refuses — never
 * guesses — when part of the component cannot be said in the Layout DSL.
 *
 * @param {{objects?: object[], links?: object[]}} sceneJson  SceneSerializer output
 * @param {string} ref  Layout DSL ref of the Solid
 * @param {{ held?: Set<string>, docRefOf?: (sceneId: string) => string|null }} [doc]
 *   the document's footprint and its scene id → document ref reading
 *   (`ContextService.getProjectedIds` / `refForSceneId`). Omitted = no document.
 * @returns {AdoptionPlan}
 */
export function planSceneAdoption(sceneJson, ref, { held = new Set(), docRefOf = () => null } = {}) {
  const objects = Array.isArray(sceneJson?.objects) ? sceneJson.objects : []
  const links   = Array.isArray(sceneJson?.links)   ? sceneJson.links   : []

  const solid = objects.find(o => o.type === 'Solid' && !held.has(o.id) && solidRefOfSceneId(o.id) === ref)
  if (!solid) {
    return { ok: false, reason: ADOPTION_REFUSAL.NOT_ON_SCREEN, name: null,
      detail: `no object "${ref}" is on the screen` }
  }
  const name = solid.name ?? ref
  /** @param {string} detail @returns {AdoptionPlan} */
  const refuse = detail => ({ ok: /** @type {false} */ (false), reason: ADOPTION_REFUSAL.UNCONVERTIBLE, name, detail })
  const byId = new Map(objects.map(o => [o.id, o]))
  const label = id => `"${byId.get(id)?.name ?? id}"`

  const component = adoptionComponent(objects, links, held, solid.id)

  // D1 — the whole scene, inverted once.
  const { dsl, refOf } = decompileLayout(sceneJson)

  // D4 — a member the Layout DSL cannot say has no ref.
  const unsayable = [...component].filter(id => !refOf.has(id))
  if (unsayable.length > 0) {
    return refuse(`${label(unsayable[0])} (${byId.get(unsayable[0])?.type ?? 'unknown'}) cannot be written in a layout`)
  }

  // The entities whose refs the component's members carry. A member that is
  // neither an entity nor folded into one of them (a frame under a DOCUMENT
  // object's Origin) could only enter by rewriting that document object.
  const memberRefs = new Set([...component].map(id => refOf.get(id)))
  const entities = (dsl.entities ?? []).filter(e => memberRefs.has(e.ref))
  const covered = new Set()
  for (const e of entities) {
    covered.add(e.ref)
    if (e.type === 'Solid') covered.add(`${e.ref}_origin`)
    for (const f of e.frames ?? []) covered.add(f.ref)
  }
  const folded = [...component].filter(id => !covered.has(refOf.get(id)))
  if (folded.length > 0) {
    return refuse(`${label(folded[0])} belongs to an object already in the document`)
  }
  if (entities.length !== new Set(entities.map(e => e.ref)).size) {
    throw new Error(`planSceneAdoption: the component of "${ref}" decompiles to duplicate refs`)
  }

  // D3 — an edge leaving the component ends at a held object: name it by the
  // DOCUMENT's ref (`docRefOf` — the compiler's own map), never by re-reading the
  // object. The decompiled ref is not used: `slug` makes them differ for a ref
  // like "bin-1".
  const memberOfRef = new Map([...component].map(id => [refOf.get(id), id]))
  const written = []
  for (const e of entities) {
    const parentId = e.type === 'CoordinateFrame' ? byId.get(memberOfRef.get(e.ref))?.parentId : null
    if (!parentId || component.has(parentId)) { written.push(e); continue }
    const docRef = docRefOf(parentId)
    if (docRef == null) return refuse(`${label(parentId)}, which ${label(memberOfRef.get(e.ref))} hangs from, is not written in the document`)
    written.push({ ...e, parentRef: docRef })
  }

  // Pass F of the decompiler emits one constraint per link whose endpoints both
  // have refs, in link order — so the k-th such link IS the k-th constraint.
  const expressible = links.filter(l => refOf.has(l.sourceId) && refOf.has(l.targetId))
  if (expressible.length !== (dsl.constraints ?? []).length) {
    throw new Error('planSceneAdoption: decompiled constraints do not line up with the scene links')
  }
  const constraints = []
  for (const [k, link] of expressible.entries()) {
    const inSource = component.has(link.sourceId)
    const inTarget = component.has(link.targetId)
    if (!inSource && !inTarget) continue
    const c = { ...dsl.constraints[k] }
    for (const [end, id, inside] of [['source', link.sourceId, inSource], ['target', link.targetId, inTarget]]) {
      if (inside) continue
      const docRef = docRefOf(id)
      if (docRef == null) return refuse(`a link reaches ${label(id)}, which is not written in the document`)
      c[end] = docRef
    }
    constraints.push(c)
  }
  // A link with an unsayable end inside the component was refused above (that
  // member has no ref). Its other end is held, so it is one the document projects
  // — still, a held end the decompiler cannot say would drop the link silently.
  const lost = links.find(l => (component.has(l.sourceId) || component.has(l.targetId))
    && !(refOf.has(l.sourceId) && refOf.has(l.targetId)))
  if (lost) return refuse(`a link from ${label(component.has(lost.sourceId) ? lost.sourceId : lost.targetId)} cannot be written in a layout`)

  return { ok: true, entities: written, constraints, sceneIds: [...component], name }
}

/**
 * The sentence the user reads when an adoption happened (原則 #11). When the
 * component carried more than the pressed object, it says how many entered — one
 * press moved N objects into the document and gave them new ids (ADR-163 D2).
 * @param {{entities: object[], constraints: object[], name: string}} plan  an ok plan
 * @param {boolean} hadDocument  the document existed before the press
 * @returns {string}
 */
export function adoptionToast(plan, hadDocument) {
  const others = plan.entities.length - 1
  const links = plan.constraints.length
  const withWhat = others > 0
    ? ` together with ${others} attached object${others === 1 ? '' : 's'}${links > 0 ? ` and ${links} link${links === 1 ? '' : 's'}` : ''}`
    : links > 0 ? ` with ${links} link${links === 1 ? '' : 's'}` : ''
  return hadDocument
    ? `"${plan.name}" was added to the document from the screen${withWhat}.`
    : `Started a document from the screen — "${plan.name}" is now declared in it${withWhat}.`
}

/**
 * The sentence the user reads when an adoption is refused (原則 #11). Throws on an
 * undeclared reason (原則 #31) — falling through would print `undefined`.
 * @param {{reason: string, name: string|null, detail: string}} plan
 * @returns {string}
 */
export function adoptionRefusalMessage(plan) {
  const who = plan.name ? `"${plan.name}"` : 'this object'
  switch (plan.reason) {
    case ADOPTION_REFUSAL.NOT_ON_SCREEN:
      return `Cannot declare: ${plan.detail}.`
    case ADOPTION_REFUSAL.UNCONVERTIBLE:
      return `Cannot declare on ${who} — it would have to enter the document with what it is attached to, and ${plan.detail}.`
    default:
      throw new Error(`adoptionRefusalMessage: 未宣言の理由 "${plan.reason}" — ADOPTION_REFUSAL に行を足すこと`)
  }
}
