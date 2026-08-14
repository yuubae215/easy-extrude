/**
 * searchGeometry — WHICH geometry a grasp search is about, and where each half
 * of it comes from (ADR-132).
 *
 * ## Why this module exists
 *
 * A grasp request has two subjects — *which robot* and *which object* — and until
 * ADR-132 they were resolved from **different sources**:
 *
 *   robot  ← the live scene   (`resolveRobots(scene.objects)` + `worldPoseOf`)
 *   object ← the loaded document (`ContextService.getCompiled().layoutDsl`)
 *
 * Two consequences, both of which shipped:
 *
 *  1. **A scene with no document could not be searched at all.** The entrance
 *     covered for this by auto-loading a starter example — which replaced the
 *     scene, destroying whatever the user had modelled (that starter loader is now
 *     gone). The user's report was "I pressed grasp search and my robot/object
 *     relationship reset, and something about TCP 教示点 appeared": those were the
 *     starter's entities, and the reset was a document load nobody asked for.
 *  2. **Moving a solid in the viewport did not move its samples.** The document
 *     had not been recompiled, so the request kept describing the old pose —
 *     ADR-129's 「動かしたのに答えが変わらない」 in its geometry half.
 *
 * ADR-055 already built the inverse that closes both (`decompileLayout`, the φ⁻¹
 * of `compileLayout`) and it had **zero production consumers** — a machine built,
 * declared, and never wired to anything (the shape ADR-115 named). This module is
 * the wiring, plus the one rule that says which source owns which half.
 *
 * ## The split: geometry is live, declarations are documentary
 *
 * The two halves genuinely have different owners, so they get different sources
 * rather than one winner:
 *
 *   **geometry** (where a body is, how big, how turned) — the LIVE SCENE. It is
 *   what the user sees, and it is already what the robot half reads.
 *
 *   **declaration** (`graspFeature` — *where on this object to grasp it*) — the
 *   DOCUMENT. The scene does not carry it: it is written into
 *   `specification.layout.entities[].graspFeature` (DocBuilder) and only ever
 *   travels doc → Layout DSL. Decompiling recovers the What/How geometry layer and
 *   deliberately NOT the Why/Context layer (ADR-055 §Scope boundary), so taking the
 *   scene wholesale would silently drop every declaration — "you declared and we
 *   ignored you", exactly the lie ADR-119 D3 forbids.
 *
 * So the declarations are **joined onto** the live geometry by `ref`. That the ref
 * survives Scene → DSL is not an assumption: it is ADR-055's fixpoint law
 * (`compileLayout(decompileLayout(scene)) ≡ scene`), which the decompiler's own
 * tests hold up. And joining is the ADR-129 thesis stated in code — a declaration
 * outlives the instance it was written on, so it must attach to wherever that body
 * is NOW, not to where it was when the sentence was written.
 *
 * ## The source is a state, not an implementation detail (原則 #31)
 *
 * `geometrySource` / `declarationSource` are returned as NAMED values and shown in
 * the panel. A resolution that silently changed which source it used would make
 * "the document says nothing here" and "the document was not consulted"
 * indistinguishable — the same missing field ADR-120 found on the score layer.
 * `SOURCE.NONE` is a real answer ("nobody declared"), never a missing one.
 *
 * Pure module (no THREE, no DOM, no I/O), so the THREE-free `test:context` lane
 * exercises the REAL rule rather than a stub of it. The controller supplies the
 * two inputs; it does not own the rule (原則 #25).
 *
 * @see docs/adr/ADR-132-a-search-is-about-what-is-on-the-screen.md
 * @module domain/searchGeometry
 */

/**
 * Where one half of the search geometry came from. A closed vocabulary — the
 * panel renders from it, so a fourth source must be declared here first.
 *
 *   'scene'    — the live scene, decompiled through ADR-055's φ⁻¹.
 *   'document' — the loaded Context's compiled Layout DSL.
 *   'none'     — nothing supplied this half. A STATE, not an absence: for
 *                declarations it means "no document is loaded", which is why the
 *                targets read `derived` rather than `malformed`.
 */
export const SOURCE = Object.freeze({
  SCENE:    'scene',
  DOCUMENT: 'document',
  NONE:     'none',
})

/**
 * How each source reads on screen (ADR-132 D3). A DECLARED table rather than a
 * ternary at the render site: the panel is where "which source" becomes visible to
 * the user, and a fourth source that silently rendered as `undefined` would put the
 * distinction back exactly where it was — invisible.
 */
const SOURCE_LABEL = Object.freeze({
  [SOURCE.SCENE]:    'live scene',
  [SOURCE.DOCUMENT]: 'document',
  [SOURCE.NONE]:     'not declared',
})

/**
 * The screen label for a source. **Throws on an undeclared source** (原則 #31) —
 * falling through to the raw value would make a new source indistinguishable from
 * a typo, and this string is the only thing telling the user whether their
 * document was consulted at all.
 *
 * @param {string} source  a `SOURCE` member
 * @returns {string}
 */
export function sourceLabel(source) {
  // `Object.prototype.hasOwnProperty.call` rather than `Object.hasOwn`: this file
  // is inside `checkJs` and the tsconfig lib predates ES2022 (same reason
  // `domain/placement.js` spells it out).
  if (!Object.prototype.hasOwnProperty.call(SOURCE_LABEL, source)) {
    throw new Error(
      `searchGeometry: 未宣言の源 "${source}"。SOURCE_LABEL に行を足すこと — ` +
      '既定へ倒すと「文書を読んでいない」と「文書が何も言っていない」が画面で同じに見える (ADR-132 D3)',
    )
  }
  return SOURCE_LABEL[source]
}

/**
 * @typedef {object} SearchLayout
 * @property {object|null} dsl   Layout DSL the request is built from, or null when
 *                               neither source yields a renderable layout
 * @property {string} geometrySource     a `SOURCE` member — who owned the bodies
 * @property {string} declarationSource  a `SOURCE` member — who owned `graspFeature`
 * @property {{id:string,type:string,reason:string}[]} warnings
 *           entities the Layout DSL cannot express (ImportedMesh / MeasureLine /
 *           Profile). Reported, never dropped silently: an object the user can see
 *           but the search cannot is a fact they must be told (原則 #11).
 */

/**
 * True when a Layout DSL is renderable — present with at least one entity. An
 * empty layout is not a small layout: there is nothing to search, and the caller
 * says so rather than sending an empty request.
 * @param {any} dsl
 * @returns {boolean}
 */
function isRenderable(dsl) {
  return !!dsl && Array.isArray(dsl.entities) && dsl.entities.length > 0
}

/**
 * Index a document's Layout DSL entities by ref → its `graspFeature` declaration.
 * Entities that declare nothing are absent from the map, so "declared nothing" and
 * "not in the document at all" both resolve to `undefined` and the join simply
 * does not fire — the resulting target reads `derived`, which is the honest state
 * for both ("nobody said").
 *
 * @param {object|null|undefined} docDsl
 * @returns {Map<string, object>}
 */
function declarationsByRef(docDsl) {
  const out = new Map()
  for (const e of docDsl?.entities ?? []) {
    if (!e || typeof e.ref !== 'string') continue
    if (e.graspFeature == null) continue
    out.set(e.ref, e.graspFeature)
  }
  return out
}

/**
 * THE resolution point for "what geometry is this search about" (§1.1).
 *
 * Live geometry wins; documented declarations ride along. Both inputs are
 * optional and every combination is a named outcome:
 *
 * | sceneDsl | docDsl | geometry | declarations | note                          |
 * |----------|--------|----------|--------------|-------------------------------|
 * | yes      | yes    | scene    | document     | the normal case once loaded   |
 * | yes      | no     | scene    | none         | a hand-built scene — now legal|
 * | no       | yes    | document | document     | no serializable scene (test   |
 * |          |        |          |              | lane / headless) — declared,  |
 * |          |        |          |              | not a silent fallback         |
 * | no       | no     | none     | none         | dsl null; the caller guides   |
 *
 * The third row is why this returns the source rather than just the DSL: a rule
 * that quietly degrades is indistinguishable from one that never ran.
 *
 * @param {{ sceneDsl?: object|null, docDsl?: object|null,
 *           warnings?: {id:string,type:string,reason:string}[] }} inputs
 * @returns {SearchLayout}
 */
export function resolveSearchLayout({ sceneDsl = null, docDsl = null, warnings = [] } = {}) {
  const sceneOk = isRenderable(sceneDsl)
  const docOk   = isRenderable(docDsl)

  if (!sceneOk && !docOk) {
    return { dsl: null, geometrySource: SOURCE.NONE, declarationSource: SOURCE.NONE, warnings: [] }
  }

  // No live geometry to stand on: fall back to the document AS the geometry, and
  // say so. (The document is then both halves — its entities carry their own
  // declarations, so no join is needed or possible.)
  if (!sceneOk) {
    return {
      dsl: docDsl,
      geometrySource:    SOURCE.DOCUMENT,
      declarationSource: SOURCE.DOCUMENT,
      warnings: [],
    }
  }

  const declared = declarationsByRef(docDsl)
  const entities = sceneDsl.entities.map((e) => {
    const feature = e && typeof e.ref === 'string' ? declared.get(e.ref) : undefined
    // Non-mutating: the decompiled DSL is an input, and a join that wrote through
    // to it would make the scene's projection a second source (§1.1 / 原則 #6).
    return feature === undefined ? e : { ...e, graspFeature: feature }
  })

  return {
    dsl: { ...sceneDsl, entities },
    geometrySource:    SOURCE.SCENE,
    declarationSource: docOk ? SOURCE.DOCUMENT : SOURCE.NONE,
    warnings: warnings ?? [],
  }
}

/**
 * How many of the document's declarations found a body in the live scene, and how
 * many did not. The lost half is the one that matters and it has **no field of its
 * own** (原則 #31): a declaration whose solid was deleted from the scene simply
 * stops appearing, and every "in ours" count keeps looking correct.
 *
 * Counted here — rather than inferred from the joined output — because the
 * population is the DOCUMENT's declarations, not the scene's entities. Walking
 * what came out can never reveal what failed to come out.
 *
 * **画面へ出す経路は未実装 (DEF-035)。** この関数には今日呼び手が居ない — ADR-132 は
 * ADR-115 が名指しした形 (宣言は在るが読む機械が無い) を自分で 1 つ作っている。
 * 未決なのは技術ではなく**出す場所と語**である: パネルのどこに置くか、何と言うか
 * (「宣言した物が見つからない」は削除なのか改名なのか区別できない)、それはエラーなのか
 * 状態なのか。「対象外」ではなく **まだ決めていない**ので、登録簿がその 1 件を持つ。
 *
 * @param {object|null|undefined} sceneDsl
 * @param {object|null|undefined} docDsl
 * @returns {{joined: number, orphaned: string[]}} orphaned = declared refs with no
 *          body in the live scene, in declaration order
 */
export function declarationJoinCensus(sceneDsl, docDsl) {
  const declared = declarationsByRef(docDsl)
  const sceneRefs = new Set((sceneDsl?.entities ?? []).map(e => e?.ref).filter(r => typeof r === 'string'))
  const orphaned = []
  let joined = 0
  for (const ref of declared.keys()) {
    if (sceneRefs.has(ref)) joined += 1
    else orphaned.push(ref)
  }
  return { joined, orphaned }
}
