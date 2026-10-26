/**
 * DocBuilder — pure functions for constructing Context DSL documents (ADR-051 Phase 1).
 *
 * All functions are input-immutable: they deep-clone the input doc and return a
 * new one, never mutating the source (PHILOSOPHY #6). No I/O, no THREE/DOM —
 * load under bare `node --test` (PHILOSOPHY #3).
 *
 * All entry-point functions follow the same pattern as FormApplication:
 *   fn(doc, entry) → newDoc   (returns new doc, never mutates)
 */
import { CONTEXT_DSL_VERSION } from './ContextDslSchema.js'
import { LAYOUT_DSL_VERSION } from '../layout/LayoutDslSchema.js'
import { unclaimedKey, unclaimedRef } from '../layout/LegacyRelations.js'
import { sideOfCell } from '../domain/relationCells.js'
import { constraintRef } from './ContextValidator.js'
import { WHERE_KEYS, RELATION_KEYS } from '../domain/graspFeature.js'
import { declaresGraspRelation } from '../domain/graspRelation.js'

/**
 * Create a minimal valid blank context document.
 *
 * The blank doc has no `specification.layout` — the service adopts it via
 * `adoptDoc()` which clears the scene without a compile/layout step.
 * All arrays are empty; the validator emits OpenQuestions as actors / variables /
 * requirements are added through the intake UI (ADR-051 §3 Entry A).
 *
 * @param {string} [name]
 * @returns {object} canonical Context DSL doc (context/0.3)
 */
export function createBlankDoc(name = 'New Project') {
  return {
    version:      CONTEXT_DSL_VERSION,
    meta:         { name, baseline: null },
    actors:       [],
    sources:      [],
    given:        [],
    variables:    [],
    requirements: [],
    obligations:  [],
    decisions:    [],
  }
}

/**
 * Add an actor to the doc (input-immutable).
 *
 * @param {object} doc
 * @param {{ ref: string, role: string, discipline?: string }} actor
 * @returns {object} new doc
 */
export function addActor(doc, actor) {
  const clone = _clone(doc)
  clone.actors = [...(clone.actors ?? []), actor]
  return clone
}

/**
 * Add a given fact to the doc (input-immutable).
 *
 * @param {object} doc
 * @param {{ ref: string, subject: string, attrs: object, status: string, evidence?: string[], note?: string }} fact
 * @returns {object} new doc
 */
export function addFact(doc, fact) {
  const clone = _clone(doc)
  clone.given = [...(clone.given ?? []), fact]
  return clone
}

/**
 * Add a shared design variable to the doc (input-immutable).
 *
 * @param {object} doc
 * @param {{ ref: string, unit: string, domain: [number, number], description?: string }} variable
 * @returns {object} new doc
 */
export function addVariable(doc, variable) {
  const clone = _clone(doc)
  clone.variables = [...(clone.variables ?? []), variable]
  return clone
}

/**
 * Add a requirement to the doc (input-immutable).
 * Admissible interval `[lo, hi)` is `stated`; the validator promotes it to
 * `derived` once the KPI backing is satisfiable (ADR-049 §2.2 / R9).
 *
 * @param {object} doc
 * @param {{ ref: string, by: string, kpi: {name:string,expr:string,unit:string}, criterion: {op:string,value:number}, constrains: string[], negotiability: string, admissible: {interval:[number,number],source:'stated'}, evidence?: string[], note?: string }} requirement
 * @returns {object} new doc
 */
export function addRequirement(doc, requirement) {
  const clone = _clone(doc)
  clone.requirements = [...(clone.requirements ?? []), requirement]
  return clone
}

// ── In-place editing (ADR-058 Phase 2 — fork & tweak, per-field edit) ────────────
//
// The add-* functions above append a new entry; the update-* functions below
// REPLACE the entry sharing the same `ref` (identity), so an existing actor /
// variable / requirement can be tweaked in place without deleting and re-adding.
// They are the pure complement of the intake edit forms: the form rebuilds the
// full entry object, the update fn swaps it in by ref. Input-immutable
// (PHILOSOPHY #6); ref is the identity key, so renaming is not an edit but a
// remove + add (which the validator would anyway force, since a rename orphans
// referencing `by`/`constrains`). Upsert semantics: if no entry matches the ref
// the entry is appended, so a stale ref never silently drops data (PHILOSOPHY #11).

/**
 * Replace the actor sharing `actor.ref` with `actor` (input-immutable).
 * @param {object} doc
 * @param {{ ref: string, role: string, discipline?: string }} actor
 * @returns {object} new doc
 */
export function updateActor(doc, actor) {
  const clone = _clone(doc)
  clone.actors = _upsertByRef(clone.actors, actor)
  return clone
}

/**
 * Replace the variable sharing `variable.ref` with `variable` (input-immutable).
 * @param {object} doc
 * @param {{ ref: string, unit: string, domain: [number, number], description?: string }} variable
 * @returns {object} new doc
 */
export function updateVariable(doc, variable) {
  const clone = _clone(doc)
  clone.variables = _upsertByRef(clone.variables, variable)
  return clone
}

/**
 * Replace the requirement sharing `requirement.ref` with `requirement`
 * (input-immutable).
 * @param {object} doc
 * @param {object} requirement — full requirement entry (same shape as addRequirement)
 * @returns {object} new doc
 */
export function updateRequirement(doc, requirement) {
  const clone = _clone(doc)
  clone.requirements = _upsertByRef(clone.requirements, requirement)
  return clone
}

/**
 * Write a CONFIRMED pose onto a layout entity (ADR-129 D1) — where the user put
 * it, and how they aimed it.
 *
 * The only writer of `specification.layout.entities[].position` / `.rotation`
 * from a gesture. It lives here, beside `setEntityGraspFeature`, because a
 * placement is the same kind of fact as a grasp location: **a statement the user
 * made about an entity**, whose lifetime must be the entity's own. Until this
 * existed, G / R wrote to the SceneModel instance and the declaration died with
 * the session — the scene said one thing and the exported document another, and
 * a grasp search run afterwards answered correctly about the OLD position
 * (ADR-129 §なぜ黙って壊れるか).
 *
 * A gesture is an ACT, and the act is the claim (ADR-129 D0′). This records the
 * act; it never infers one from the rendered mesh — that would be the scene
 * reverse-compile ADR-054/055 forbid. The boundary is act-vs-inference, not
 * whether a field happened to exist.
 *
 * `position` / `rotation` are written only when GIVEN: a Grab confirms a
 * position and says nothing about orientation, and writing an identity rotation
 * there would turn "I did not aim it" into "I aimed it at zero" (原則 #31).
 *
 * A ref with no matching entity is a no-op clone — never an append. Inventing a
 * carrier entity for a pose would fabricate geometry (原則 #11), the same reason
 * `setEntityGraspFeature` refuses to.
 *
 * @param {object} doc
 * @param {string} ref  Layout DSL entity ref
 * @param {{position?: {x:number,y:number,z:number},
 *          rotation?: {x:number,y:number,z:number,w:number}}} pose
 * @returns {object} new doc
 */
export function setEntityPose(doc, ref, pose) {
  const clone    = _clone(doc)
  const entities = clone.specification?.layout?.entities
  if (!Array.isArray(entities)) return clone
  const i = entities.findIndex(e => e?.ref === ref)
  if (i === -1) return clone
  if (pose?.position) {
    const p = pose.position
    entities[i].position = { x: p.x, y: p.y, z: p.z }
  }
  if (pose?.rotation) {
    const q = pose.rotation
    entities[i].rotation = { x: q.x, y: q.y, z: q.z, w: q.w }
  }
  return clone
}

/**
 * Set (or clear) WHERE a layout Solid should be grasped (ADR-119 D2 / ADR-128),
 * input-immutable like every builder here.
 *
 * This is the only writer of the WHERE half of `specification.layout.entities[].graspFeature`
 * (`WHERE_KEYS` — ADR-164 D4 split the declaration: which hand and how it lifts
 * are the relation's own fields, with their own writers, and ride through here). It
 * lives in the doc builder rather than in the grasp panel because the declaration
 * belongs to the DOCUMENT, not to a run: the same statement must survive a reload,
 * an export, and an undo, which a controller-held run parameter would not.
 *
 * `feature === null` CLEARS the where — and clearing is not the same as
 * declaring `anywhere` (原則 #31). Removing it restores the "nobody said where"
 * state, which the panel then reports honestly instead of showing a phantom
 * choice the user never made. The relation survives when it still names a hand
 * or a lift; when nothing is left, the key goes (`removeEntityGraspRelation`
 * removes the whole relation on purpose). A field outside `WHERE_KEYS` throws.
 *
 * A ref with no matching entity is a no-op clone, never a throw and never an
 * append: unlike an actor, a grasp feature has no meaning without the solid it
 * sits on, so inventing a carrier entity would fabricate geometry (PHILOSOPHY #11).
 *
 * @param {object} doc
 * @param {string} ref  Layout DSL entity ref of the Solid
 * @param {object|null} feature  `{kind:'anywhere'}` | `{kind:'specs', specs:[…], strategy?}` | null to clear
 *   (ADR-152 D1: the writer never writes the legacy `faces` kind — it is read and
 *   migrated by `resolveGraspFeature`, and the panel writes specs back)
 * @returns {object} new doc
 */
export function setEntityGraspFeature(doc, ref, feature) {
  if (feature != null) {
    const foreign = Object.keys(feature).filter(k => !WHERE_KEYS.includes(k))
    if (foreign.length) {
      throw new Error(`DocBuilder.setEntityGraspFeature: "${foreign[0]}" は where の欄ではない — RELATION_KEYS の書き手 (setEntityGraspTcp / setEntityGraspLift) を使うこと`)
    }
  }
  const clone   = _clone(doc)
  const layout  = clone.specification?.layout
  const entities = layout?.entities
  if (!Array.isArray(entities)) return clone
  const i = entities.findIndex(e => e?.ref === ref)
  if (i === -1) return clone
  // The relation's own half (which hand, how it lifts — ADR-164 D4) is not this
  // writer's: it rides through, so clearing the where never un-names the hand.
  const kept = _relationHalf(entities[i].graspFeature)
  _putGraspFeature(entities[i], feature == null ? kept : { ...feature, ...kept })
  return clone
}

/** The RELATION_KEYS half of a stored graspFeature (empty when there is none). */
function _relationHalf(feature) {
  const out = {}
  if (!feature || typeof feature !== 'object' || Array.isArray(feature)) return out
  for (const k of RELATION_KEYS) if (feature[k] !== undefined) out[k] = feature[k]
  return out
}

/**
 * Store a graspFeature, or delete the key when nothing is left in it — an empty
 * object says nothing (the schema's `minProperties: 1`), and writing one would
 * make "a relation that says nothing" a thing the document can hold.
 */
function _putGraspFeature(entity, feature) {
  if (!feature || Object.keys(feature).length === 0) delete entity.graspFeature
  else entity.graspFeature = feature
}

/**
 * Set (or clear) how a grasped object is LIFTED OUT — the lift of the grasp
 * RELATION (ADR-157 D5, moved onto the relation by ADR-164 D4), input-immutable.
 *
 * The only writer of `graspFeature.lift`, and the place the pre-D4 address
 * (`entity.lift`, still read and migrated by `resolveDeclaredLift`) is retired:
 * every write deletes the old key, so the first edit moves a legacy lift instead
 * of leaving the document with two addresses.
 *
 * Unlike `setEntityGraspTcp`, declaring a lift on an object with NO grasp
 * declaration creates the relation (`graspFeature: {lift}`): since D4 `kind` is
 * optional, so this says exactly what the user said — how it lifts — and
 * nothing about where (原則 #11: no invented `anywhere`). Clearing the last field
 * of a relation removes the declaration.
 *
 * @param {object} doc
 * @param {string} ref   Layout DSL entity ref of the Solid
 * @param {{along:string, distance:number}|null} lift  null to clear
 * @returns {object} new doc
 */
export function setEntityGraspLift(doc, ref, lift) {
  const clone    = _clone(doc)
  const entities = clone.specification?.layout?.entities
  if (!Array.isArray(entities)) return clone
  const i = entities.findIndex(e => e?.ref === ref)
  if (i === -1) return clone
  const e = entities[i]
  const feature = (e.graspFeature && typeof e.graspFeature === 'object') ? { ...e.graspFeature } : {}
  if (lift == null) delete feature.lift
  else feature.lift = { along: lift.along, distance: lift.distance }
  delete e.lift
  _putGraspFeature(e, feature)
  return clone
}

/**
 * Remove a grasp RELATION from the document — the whole declaration (where, which
 * hand, how it lifts) and the pre-D4 lift that would otherwise resurrect it as a
 * relation on the next read (ADR-164 D4). The exit of a broken relation whose
 * object is gone. A ref with no entity is a no-op clone.
 *
 * @param {object} doc
 * @param {string} ref  Layout DSL entity ref of the Solid
 * @returns {object} new doc
 */
export function removeEntityGraspRelation(doc, ref) {
  const clone    = _clone(doc)
  const entities = clone.specification?.layout?.entities
  if (!Array.isArray(entities)) return clone
  const i = entities.findIndex(e => e?.ref === ref)
  if (i === -1) return clone
  delete entities[i].graspFeature
  delete entities[i].lift
  return clone
}

/**
 * Name (or un-name) WHICH robot tcp a Solid's grasp declaration is for — the
 * right-hand side of the grasp RELATION (ADR-164 D2), input-immutable.
 *
 * The only writer of `graspFeature.tcp`. Separate from `setEntityGraspFeature`
 * because the two are different facts said from different places: the specs say
 * HOW to grasp (the relation's panel), this says WITH WHAT (the relation's row,
 * including a broken one being re-pointed). The relation is derived from the
 * declaration, so naming the hand on an object with NO grasp declaration is a
 * no-op clone — there is no relation to name a hand for, and inventing an empty
 * declaration would fabricate a statement the user never made (原則 #11).
 *
 * `tcpRef === null` deletes the key — back to "the hand is not declared", never
 * a default (ADR-164 §俯瞰: not even when the scene has one tcp).
 *
 * @param {object} doc
 * @param {string} ref     Layout DSL entity ref of the Solid
 * @param {string|null} tcpRef  Layout DSL ref of a robot tcp, or null
 * @returns {object} new doc
 */
export function setEntityGraspTcp(doc, ref, tcpRef) {
  const clone    = _clone(doc)
  const entities = clone.specification?.layout?.entities
  if (!Array.isArray(entities)) return clone
  const i = entities.findIndex(e => e?.ref === ref)
  if (i === -1) return clone
  // A relation exists when the object declares a grasp — including a lift still
  // at its pre-D4 address (ADR-164 D4), which has no graspFeature to hold the tcp
  // yet; the object without either has no relation to name a hand for.
  if (!declaresGraspRelation(entities[i])) return clone
  const stored  = entities[i].graspFeature
  const feature = (stored && typeof stored === 'object' && !Array.isArray(stored)) ? { ...stored } : {}
  if (tcpRef == null) delete feature.tcp
  else feature.tcp = tcpRef
  _putGraspFeature(entities[i], feature)
  return clone
}

/** The mass declarations of a Solid (ADR-121 / ADR-156) — the keys this writer owns. */
export const MASS_DECLARATION_KEYS = Object.freeze(['mass', 'centerOfMass'])

/**
 * Set (or clear) what a layout Solid WEIGHS (`mass`, kg) or WHERE that weight
 * sits (`centerOfMass`) — ADR-121 / ADR-156, input-immutable. The only writer of
 * these two keys, beside `setEntityGraspFeature` for the same reason: they are
 * declarations about the object that must survive a reload, an export and an undo.
 *
 * `value === null` DELETES the key — undeclared, never a default (ADR-121 D2: an
 * absent centre of mass is not the centroid). A ref with no entity is a no-op
 * clone. An unknown key throws — a new declaration is added here on purpose.
 *
 * @param {object} doc
 * @param {string} ref  Layout DSL entity ref of the Solid
 * @param {'mass'|'centerOfMass'} key
 * @param {number|object|null} value
 * @returns {object} new doc
 */
export function setEntityMassDeclaration(doc, ref, key, value) {
  if (!MASS_DECLARATION_KEYS.includes(key)) {
    throw new Error(`DocBuilder: 未宣言の質量宣言 "${key}" — MASS_DECLARATION_KEYS に足すこと`)
  }
  const clone   = _clone(doc)
  const entities = clone.specification?.layout?.entities
  if (!Array.isArray(entities)) return clone
  const i = entities.findIndex(e => e?.ref === ref)
  if (i === -1) return clone
  if (value == null) delete entities[i][key]
  else entities[i][key] = JSON.parse(JSON.stringify(value))
  return clone
}

/**
 * Set (or clear) WHAT a robot grasps with — the `hand` of a tcp entity in the
 * document's layout (ADR-152 D3), input-immutable. The document-side writer, for
 * a tcp the document KNOWS (a scene-only tcp is written by
 * `SceneService.setTcpHand` instead — the ADR-129 split, by what the entity is).
 * Without it, the next document edit recompiles the scene from a layout that has
 * no hand and the user's hand silently disappears.
 *
 * `hand === null` deletes the key (UNDECLARED — never a default). A ref with no
 * matching entity is a no-op clone.
 *
 * @param {object} doc
 * @param {string} ref  Layout DSL entity ref of the tcp CoordinateFrame
 * @param {object|null} hand  mm
 * @returns {object} new doc
 */
export function setEntityHand(doc, ref, hand) {
  const clone    = _clone(doc)
  const entities = clone.specification?.layout?.entities
  if (!Array.isArray(entities)) return clone
  const i = entities.findIndex(e => e?.ref === ref)
  if (i === -1) return clone
  if (hand == null) delete entities[i].hand
  else entities[i].hand = JSON.parse(JSON.stringify(hand))
  return clone
}

/**
 * Set (or clear) a frame's vision-camera declaration — `camera` on a
 * CoordinateFrame entity in the document's layout (ADR-164 D3), input-immutable.
 * The document-side writer for a frame the document KNOWS (a scene-only frame is
 * written by `SceneService.setFrameCamera` — the ADR-129 split, as for the hand).
 *
 * `camera === null` deletes the key (the frame stops being a camera). `pose`,
 * when given, is written in the same edit ("copy the current view" is one act).
 *
 * @param {object} doc
 * @param {string} ref
 * @param {object|null} camera  `{ fovHalfAngle? }`
 * @param {{position?: object, rotation?: object}} [pose]
 * @returns {object} new doc
 */
export function setEntityCamera(doc, ref, camera, pose = null) {
  const clone    = pose ? setEntityPose(doc, ref, pose) : _clone(doc)
  const entities = clone.specification?.layout?.entities
  if (!Array.isArray(entities)) return clone
  const i = entities.findIndex(e => e?.ref === ref)
  if (i === -1) return clone
  if (camera == null) delete entities[i].camera
  else entities[i].camera = JSON.parse(JSON.stringify(camera))
  return clone
}

/** Entity kinds → their doc array key (mirrors SeedAnchor's map). */
const KIND_ARRAY = {
  actor:       'actors',
  variable:    'variables',
  requirement: 'requirements',
  fact:        'given',
}

/**
 * The given fact every screen-adopted entity derives from (ADR-159 D2). ADR-046
 * invariant 1 forbids a specification nobody requested; this says who did — the
 * user, by declaring something about an object they placed on the screen.
 */
export const ON_SCREEN_FACT_REF = 'f_on_screen'

/**
 * True when the document carries a layout entity with this ref — i.e. a
 * declaration about it has somewhere to be written. The one reading of "is this
 * object in the document" for the declaring path (ADR-159).
 * @param {object|null} doc
 * @param {string} ref
 * @returns {boolean}
 */
export function docDeclaresEntity(doc, ref) {
  const entities = doc?.specification?.layout?.entities
  return Array.isArray(entities) && entities.some(e => e?.ref === ref)
}

/**
 * Bring objects that are on the screen into the document (ADR-159 D1/D2), with
 * the relations between them and to the document's own objects (ADR-163 D2/D3),
 * input-immutable. `doc === null` starts a blank document first — the press that
 * declares is the request, so there is no separate "create a document" step.
 *
 * Unlike `setEntityGraspFeature`'s refusal to append, this DOES append — but it
 * fabricates nothing: every entity and constraint is the decompiler's reading of
 * what the scene already has (`planSceneAdoption`), traced to `ON_SCREEN_FACT_REF`
 * so the validator can still say who asked for it. Existing entities are never
 * touched (their `$fact` / `$decision` stay — ADR-163).
 *
 * A ref the document already has is a contradiction in the inputs (the plan only
 * cuts objects outside the footprint), so it throws rather than writing a twin.
 *
 * @param {object|null} doc
 * @param {{entities: object[], constraints?: object[]}} adopted  from `planSceneAdoption`
 * @param {string} [name]  name of a newly started document
 * @returns {object} new doc
 */
export function adoptSceneEntities(doc, { entities, constraints = [] }, name = 'Scene on screen') {
  const clone = doc ? _clone(doc) : createBlankDoc(name)
  for (const e of entities) {
    if (docDeclaresEntity(clone, e.ref)) {
      throw new Error(`adoptSceneEntities: "${e.ref}" is already in the document`)
    }
  }
  clone.given = clone.given ?? []
  if (!clone.given.some(f => f?.ref === ON_SCREEN_FACT_REF)) {
    clone.given.push({
      ref:     ON_SCREEN_FACT_REF,
      subject: 'objects placed on the screen',
      status:  'asserted',
      note:    'Brought into this document from the screen when something was declared about them (ADR-159).',
    })
  }
  const spec = clone.specification = clone.specification ?? {}
  spec.layout = spec.layout ?? { version: LAYOUT_DSL_VERSION, strategy: 'manual', entities: [] }
  spec.layout.entities = [...(spec.layout.entities ?? []), ...entities.map(_clone)]
  if (constraints.length > 0) {
    spec.layout.constraints = [...(spec.layout.constraints ?? []), ...constraints.map(_clone)]
  }
  spec.trace = [
    ...(spec.trace ?? []),
    ...entities.map(e => ({ from: ON_SCREEN_FACT_REF, to: e.ref, kind: 'derives' })),
    ...constraints.map(c => ({ from: ON_SCREEN_FACT_REF, to: constraintRef(c), kind: 'derives' })),
  ]
  return clone
}

/**
 * The given fact every entity of a Home template derives from (ADR-162 D1). The
 * template is what asked for the layout — ADR-046 invariant 1 needs that said.
 */
export const TEMPLATE_FACT_REF = 'f_layout_template'

/**
 * A Context document that HOLDS a Layout DSL as its specification (ADR-162 D1) —
 * so a scene compiled from a template keeps its source. Before ADR-162 the Home
 * load compiled the DSL and dropped it: the scene became the only holder, and a
 * declaration (mass, grasp spec) had to be re-derived from the screen one object
 * at a time (ADR-159), which cannot carry relations — every template workpiece
 * fastened to a bin was refused (DEF-060).
 *
 * The layout is cloned verbatim, so `compileContext(doc).layoutDsl` compiles to
 * the same scene as the DSL itself. Every entity and constraint is traced to
 * `TEMPLATE_FACT_REF` (ADR-046 invariant 1 — nothing unrequested).
 *
 * @param {object} layoutDsl  layout/1.0 DSL
 * @param {string} [name]  document name (falls back to the DSL's `meta.name`)
 * @returns {object} new Context DSL doc
 */
export function docFromLayout(layoutDsl, name) {
  const layout = _clone(layoutDsl)
  const doc = createBlankDoc(name ?? layout.meta?.name ?? 'Layout template')
  doc.given.push({
    ref:     TEMPLATE_FACT_REF,
    subject: 'the layout template this project was started from',
    status:  'asserted',
    note:    'Every object and constraint of the template derives from it (ADR-162).',
  })
  const targets = [
    ...(layout.entities ?? []).map(e => e.ref),
    ...(layout.constraints ?? []).map(constraintRef),
  ]
  doc.specification = {
    layout,
    trace: targets.map(to => ({ from: TEMPLATE_FACT_REF, to, kind: 'derives' })),
  }
  return doc
}

/**
 * Remove the entry of `kind` matching `ref` (input-immutable). A ref with no
 * match is a no-op clone (never throws — the caller may have stale UI state).
 * @param {object} doc
 * @param {'actor'|'variable'|'requirement'|'fact'} kind
 * @param {string} ref
 * @returns {object} new doc
 */
export function removeDocEntry(doc, kind, ref) {
  const arrKey = KIND_ARRAY[kind]
  if (!arrKey) return _clone(doc)
  const clone = _clone(doc)
  clone[arrKey] = (clone[arrKey] ?? []).filter(e => e?.ref !== ref)
  return clone
}

/**
 * Record a claim about two things (ADR-168 — an Arrangement with one side), in
 * the claimant's name (input-immutable). The ref is minted from the pair and
 * made unique among the document's arrangements. Throws when the claimant
 * already claims this pair (in either order) — one claim per person per pair
 * (ADR-168 D5); a second would overwrite the first in the reader's head.
 *
 * @param {object} doc
 * @param {{by: string, subject: string, side: {of: string, contact?: string, toward?: unknown}}} claim
 * @returns {object} new doc
 */
export function claimArrangement(doc, { by, subject, side }) {
  const existing = doc.arrangements ?? []
  const claims = (a, b) => existing.some(arr => arr.by === by && arr.subject === a && (arr.sides ?? []).some(s => s.of === b))
  if (claims(subject, side.of) || claims(side.of, subject)) {
    throw new Error(`"${by}" already claims the relation of "${subject}" and "${side.of}"`)
  }
  const taken = new Set(existing.map(a => a.ref))
  const stem = `${subject}_${side.of}`
  let ref = stem
  for (let n = 2; taken.has(ref); n++) ref = `${stem}_${n}`
  const clone = _clone(doc)
  clone.arrangements = [...existing.map(a => _clone(a)), { ref, by, subject, sides: [_clone(side)] }]
  return clone
}

/**
 * Claim an unclaimed relation in someone's name (ADR-168 S2-2,
 * input-immutable): the relation a retired word said (`above` / `adjacent`)
 * becomes an Arrangement whose one side says exactly its cell, and leaves
 * `specification.layout.unclaimedRelations`. A trace that named the unclaimed
 * relation now names the claim — it still traces to where it came from.
 *
 * Throws when no such unclaimed relation exists, or when the claimant already
 * claims the pair (`claimArrangement` — one claim per person per pair).
 * The relation's `properties` (e.g. an old `note`) do not travel: an
 * Arrangement has no field for them.
 *
 * @param {object} doc
 * @param {{by: string, key: string}} claim  `key` = `unclaimedKey` of the relation
 * @returns {object} new doc
 */
export function claimUnclaimed(doc, { by, key }) {
  const layout = doc.specification?.layout
  const list = layout?.unclaimedRelations ?? []
  const i = list.findIndex(u => unclaimedKey(u) === key)
  if (i === -1) throw new Error(`No unclaimed relation "${key}" in the document`)
  const u = list[i]
  const side = { of: u.of, ...sideOfCell(u.cell) }
  const claimed = claimArrangement(doc, { by, subject: u.subject, side })
  const ref = claimed.arrangements[claimed.arrangements.length - 1].ref
  const rest = list.filter((_, j) => j !== i)
  const nextLayout = { ...claimed.specification.layout }
  if (rest.length > 0) nextLayout.unclaimedRelations = rest
  else delete nextLayout.unclaimedRelations
  const named = unclaimedRef(u)
  // Another unclaimed relation of the same pair keeps the trace.
  const stillNamed = rest.some(r => unclaimedRef(r) === named)
  const specification = { ...claimed.specification, layout: nextLayout }
  if (claimed.specification.trace !== undefined && !stillNamed) {
    specification.trace = claimed.specification.trace.map(t => t?.to === named ? { ...t, to: ref } : t)
  }
  return { ...claimed, specification }
}

/** Replace the array element sharing `entry.ref`, or append if none matches. */
function _upsertByRef(arr, entry) {
  const list = arr ?? []
  const i = list.findIndex(e => e?.ref === entry.ref)
  if (i === -1) return [...list, entry]
  const next = list.slice()
  next[i] = entry
  return next
}

/** Deep clone via JSON round-trip (Context DSL docs are JSON-serializable). */
function _clone(doc) {
  return JSON.parse(JSON.stringify(doc))
}
