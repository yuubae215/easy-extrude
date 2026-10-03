/**
 * sceneAdoption — bringing an object that is only on the screen into the document,
 * so a declaration about it has somewhere to live (ADR-159).
 *
 * Pure (no THREE, no DOM, no I/O): the THREE-free `node --test` lane exercises the
 * real rule. The controller supplies a serialized scene and a ref; the service
 * performs the side effects.
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
 * ## The one thing that changes: its scene id
 *
 * The document projects an entity under the compiler's id (`solid_<ref>`). A scene
 * box was born as `obj_…`, so adopting it RE-CREATES it under the compiled id —
 * the `ref` (what the panel and the search key on) is unchanged, the scene id is
 * not. Anything else in the scene that points at the old id would be left pointing
 * at nothing, so those objects are REFUSED with a reason rather than silently
 * orphaned (原則 #11): a child that is not part of the Solid, or a SpatialLink.
 * Adopting those too is 未実装 (DEF-060) — it needs a decision on whether the
 * children / links enter the document with it or are re-pointed.
 *
 * @see docs/adr/ADR-159-declaring-on-the-screen-brings-the-object-into-the-document.md
 * @module domain/sceneAdoption
 */

import { decompileLayout, solidRefOfSceneId } from '../layout/LayoutDecompiler.js'
import { isOriginFrame } from './originFrame.js'

/**
 * Why an adoption cannot happen. A closed vocabulary: the toast is built from it,
 * so a new reason is declared here first.
 */
export const ADOPTION_REFUSAL = Object.freeze({
  NOT_ON_SCREEN: 'not-on-screen',
  HAS_CHILDREN:  'has-children',
  LINKED:        'linked',
})

/**
 * The scene ids that ARE the Solid as the document will project it: the Solid, its
 * auto-Origin frame and the user frames under that Origin (the decompiler folds all
 * three into one entity — the same grouping, read from the same structure).
 *
 * @param {object[]} objects  serialized scene objects
 * @param {string} solidId
 * @returns {Set<string>}
 */
function idsOfSolid(objects, solidId) {
  const ids = new Set([solidId])
  const origins = objects.filter(o => o.type === 'CoordinateFrame' && o.parentId === solidId && isOriginFrame(o))
  for (const o of origins) ids.add(o.id)
  for (const o of objects) {
    if (o.type === 'CoordinateFrame' && origins.some(org => org.id === o.parentId)) ids.add(o.id)
  }
  return ids
}

/**
 * @typedef {{ ok: true, entity: object, sceneIds: string[], name: string }
 *         | { ok: false, reason: string, name: string|null, detail: string }} AdoptionPlan
 */

/**
 * Plan adopting the scene Solid that decompiles to `ref` into a document.
 *
 * Returns the Layout DSL entity to write (the decompiler's canonical form — the
 * same φ⁻¹ the search already reads, so the document says what the search saw)
 * and the scene ids the projection will replace. Refuses — never guesses — when
 * re-creating the object under a new id would cut something else loose.
 *
 * @param {{objects?: object[], links?: object[]}} sceneJson  SceneSerializer output
 * @param {string} ref  Layout DSL ref of the Solid
 * @returns {AdoptionPlan}
 */
export function planSceneAdoption(sceneJson, ref) {
  const objects = Array.isArray(sceneJson?.objects) ? sceneJson.objects : []
  const links   = Array.isArray(sceneJson?.links)   ? sceneJson.links   : []

  const solid = objects.find(o => o.type === 'Solid' && solidRefOfSceneId(o.id) === ref)
  if (!solid) {
    return { ok: false, reason: ADOPTION_REFUSAL.NOT_ON_SCREEN, name: null,
      detail: `no object "${ref}" is on the screen` }
  }
  const name = solid.name ?? ref
  const ids = idsOfSolid(objects, solid.id)

  const strays = objects.filter(o => !ids.has(o.id) && ids.has(o.parentId))
  if (strays.length > 0) {
    return { ok: false, reason: ADOPTION_REFUSAL.HAS_CHILDREN, name,
      detail: `"${strays[0].name ?? strays[0].id}" is attached to it` }
  }
  const linked = links.filter(l => ids.has(l.sourceId) || ids.has(l.targetId))
  if (linked.length > 0) {
    return { ok: false, reason: ADOPTION_REFUSAL.LINKED, name,
      detail: `${linked.length} link(s) connect it to other objects` }
  }

  const { dsl } = decompileLayout({ ...sceneJson, objects: objects.filter(o => ids.has(o.id)), links: [] })
  const entity = (dsl.entities ?? []).find(e => e.ref === ref && e.type === 'Solid')
  if (!entity) {
    // The object is on screen but the decompiler did not yield it — a contradiction
    // in the inputs, not a state to paper over.
    throw new Error(`planSceneAdoption: "${ref}" is on screen but did not decompile to a Solid`)
  }
  return { ok: true, entity, sceneIds: [...ids], name }
}

/**
 * The sentence the user reads when an adoption is refused (原則 #11). Throws on an
 * undeclared reason (原則 #31) — falling through would print `undefined`.
 * @param {{reason: string, name: string|null, detail: string}} plan
 * @returns {string}
 */
export function adoptionRefusalMessage(plan) {
  const who = plan.name ? `"${plan.name}"` : 'This object'
  switch (plan.reason) {
    case ADOPTION_REFUSAL.NOT_ON_SCREEN:
      return `Cannot declare: ${plan.detail}.`
    case ADOPTION_REFUSAL.HAS_CHILDREN:
      return `Cannot declare on ${who} yet — ${plan.detail}, and bringing it into the document would detach it (DEF-060).`
    case ADOPTION_REFUSAL.LINKED:
      return `Cannot declare on ${who} yet — ${plan.detail}, and bringing it into the document would break them (DEF-060).`
    default:
      throw new Error(`adoptionRefusalMessage: 未宣言の理由 "${plan.reason}" — ADOPTION_REFUSAL に行を足すこと`)
  }
}
