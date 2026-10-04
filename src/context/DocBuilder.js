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
import { constraintRef } from './ContextValidator.js'

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
 * This is the only writer of `specification.layout.entities[].graspFeature`. It
 * lives in the doc builder rather than in the grasp panel because the declaration
 * belongs to the DOCUMENT, not to a run: the same statement must survive a reload,
 * an export, and an undo, which a controller-held run parameter would not.
 *
 * `feature === null` CLEARS the declaration — and clearing is not the same as
 * declaring `anywhere` (原則 #31). Deleting the key restores the "nobody said"
 * state, which the panel then reports honestly instead of showing a phantom
 * choice the user never made.
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
  const clone   = _clone(doc)
  const layout  = clone.specification?.layout
  const entities = layout?.entities
  if (!Array.isArray(entities)) return clone
  const i = entities.findIndex(e => e?.ref === ref)
  if (i === -1) return clone
  if (feature == null) delete entities[i].graspFeature
  else entities[i].graspFeature = feature
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
 * Bring an object that is on the screen into the document (ADR-159 D1/D2),
 * input-immutable. `doc === null` starts a blank document first — the press that
 * declares is the request, so there is no separate "create a document" step.
 *
 * Unlike `setEntityGraspFeature`'s refusal to append, this DOES append — but it
 * fabricates nothing: `entity` is the decompiler's reading of geometry the scene
 * already has (`planSceneAdoption`), traced to `ON_SCREEN_FACT_REF` so the
 * validator can still say who asked for it.
 *
 * An entity already in the document is a no-op clone (adopting twice is not two
 * entities).
 *
 * @param {object|null} doc
 * @param {object} entity  Layout DSL entity (from `planSceneAdoption`)
 * @param {string} [name]  name of a newly started document
 * @returns {object} new doc
 */
export function adoptSceneEntity(doc, entity, name = 'Scene on screen') {
  const clone = doc ? _clone(doc) : createBlankDoc(name)
  if (docDeclaresEntity(clone, entity.ref)) return clone
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
  spec.layout.entities = [...(spec.layout.entities ?? []), _clone(entity)]
  spec.trace = [...(spec.trace ?? []), { from: ON_SCREEN_FACT_REF, to: entity.ref, kind: 'derives' }]
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
