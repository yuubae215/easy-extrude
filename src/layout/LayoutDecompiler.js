/**
 * LayoutDecompiler — the scene→DSL inverse of LayoutCompiler (ADR-055).
 *
 * Pure computation: no I/O, no Three.js, no DOM. Loads under bare `node --test`.
 *
 * Recovers a Layout DSL (layout/1.0) from a SceneSerializer v1.3 scene JSON — the
 * φ⁻¹ of `compileLayout`. Makes Scene ⇄ Layout DSL *Mutual* at the What/How
 * geometry layer: the scene is "just another way to input the same geometry."
 *
 * ── Mutual up to a normal form ──────────────────────────────────────────────
 * `compileLayout` is many-to-one (strategy linear/grid/stack/radial/manual can all
 * yield the same positions; refs are slugged into ids), so a literal byte-identity
 * inverse is impossible — the same situation ADR-052 resolved for NL⇄doc as
 * "structural isomorphism on the quotient by synonyms". We adopt the geometric
 * analogue: the inverse emits the CANONICAL REPRESENTATIVE —
 *   • `strategy: 'manual'` with an explicit per-entity `position`
 *   • refs recovered by stripping the generated id prefix (already slugged, so
 *     stable under recompile; original human ref text is normalised away)
 * The meaningful invariant is the **scene fixpoint law**:
 *     compileLayout(decompileLayout(scene)) ≡ scene
 * for any Layout-DSL-expressible scene produced by `compileLayout`.
 *
 * ── Scope boundary (ADR-050/052: Context stays canonical) ───────────────────
 * This recovers only the What/How geometry layer. It NEVER reconstructs
 * Why/Context (KPI, criterion, Gap, Intent, Acceptance, provenance markers) —
 * the scene does not carry them (ADR-052 §1). When a Context doc is loaded, the
 * canonical Layout DSL remains `ContextService.getCompiled().layoutDsl`
 * (ADR-054); `decompileLayout` is for the **non-Context authoring path**
 * (a directly-built / hand-edited scene exported back to DSL).
 *
 * @module layout/LayoutDecompiler
 */

import { LAYOUT_DSL_VERSION } from './LayoutDslSchema.js'

const IDENTITY_QUATERNION = { x: 0, y: 0, z: 0, w: 1 }

/** Inverse of LayoutCompiler.ENTITY_PREFIX (id prefix → DSL entity type). */
const PREFIX_FOR_TYPE = {
  Solid:           'solid_',
  CoordinateFrame: 'cf_',
  AnnotatedLine:   'al_',
  AnnotatedRegion: 'ar_',
  AnnotatedPoint:  'ap_',
}

/** Scene entity types that the Layout DSL cannot express (reported, not dropped). */
const UNCONVERTIBLE_TYPES = new Set(['ImportedMesh', 'MeasureLine', 'Profile'])

// ── helpers ─────────────────────────────────────────────────────────────────

function stripPrefix(id, prefix) {
  return id.startsWith(prefix) ? id.slice(prefix.length) : id
}

function isIdentityQuat(q) {
  return !!q && q.x === 0 && q.y === 0 && q.z === 0 && q.w === 1
}

/** Recover full dimensions from the 8 body-frame corner vectors (max − min per axis). */
function dimsFromCorners(corners) {
  const xs = corners.map(c => c.x)
  const ys = corners.map(c => c.y)
  const zs = corners.map(c => c.z)
  return {
    x: Math.max(...xs) - Math.min(...xs),
    y: Math.max(...ys) - Math.min(...ys),
    z: Math.max(...zs) - Math.min(...zs),
  }
}

function vec(v) {
  return { x: v.x ?? 0, y: v.y ?? 0, z: v.z ?? 0 }
}

function quat(q) {
  return { x: q.x ?? 0, y: q.y ?? 0, z: q.z ?? 0, w: q.w ?? 1 }
}

// ── public API ───────────────────────────────────────────────────────────────

/**
 * Recover a Layout DSL from a SceneSerializer v1.3 scene JSON.
 *
 * @param {{objects?: object[], links?: object[]}} sceneJson
 * @returns {{ dsl: object, warnings: {id:string, type:string, reason:string}[] }}
 */
export function decompileLayout(sceneJson) {
  if (!sceneJson || typeof sceneJson !== 'object') {
    throw new Error('decompileLayout: scene JSON must be a non-null object')
  }
  const objects  = Array.isArray(sceneJson.objects) ? sceneJson.objects : []
  const links    = Array.isArray(sceneJson.links)   ? sceneJson.links   : []
  const warnings = []

  // ── Pass A: index + identify Solids ──────────────────────────────────────
  const solidIds = new Set(objects.filter(o => o.type === 'Solid').map(o => o.id))

  // ── Pass B: Solid refs ───────────────────────────────────────────────────
  /** scene id → DSL ref */
  const idToRef = new Map()
  /** Solid scene id → recovered ref */
  const solidRefById = new Map()
  for (const o of objects) {
    if (o.type !== 'Solid') continue
    const ref = stripPrefix(o.id, PREFIX_FOR_TYPE.Solid)
    idToRef.set(o.id, ref)
    solidRefById.set(o.id, ref)
  }

  // ── Pass C1: auto-Origin CFs (parent is a Solid, name 'Origin') → fold ────
  const originIds       = new Set()
  const solidIdByOrigin = new Map()
  for (const o of objects) {
    if (o.type !== 'CoordinateFrame') continue
    if (solidIds.has(o.parentId) && o.name === 'Origin') {
      originIds.add(o.id)
      solidIdByOrigin.set(o.id, o.parentId)
      idToRef.set(o.id, `${solidRefById.get(o.parentId)}_origin`)
    }
  }

  // ── Pass C2: user frame CFs (parent is an Origin) → fold into Solid.frames ─
  /** Solid scene id → [frame CF object] */
  const framesBySolidId = new Map()
  for (const o of objects) {
    if (o.type !== 'CoordinateFrame' || !originIds.has(o.parentId)) continue
    const solidId = solidIdByOrigin.get(o.parentId)
    const solidRef = solidRefById.get(solidId)
    const frameRef = stripPrefix(o.id, `cf_${solidRef}_`)
    idToRef.set(o.id, frameRef)
    if (!framesBySolidId.has(solidId)) framesBySolidId.set(solidId, [])
    framesBySolidId.get(solidId).push(o)
  }

  // ── Pass C3: standalone CF refs (everything else) ─────────────────────────
  for (const o of objects) {
    if (o.type !== 'CoordinateFrame') continue
    if (originIds.has(o.id) || idToRef.has(o.id)) continue
    idToRef.set(o.id, stripPrefix(o.id, PREFIX_FOR_TYPE.CoordinateFrame))
  }

  // ── Pass D: annotation refs ───────────────────────────────────────────────
  for (const o of objects) {
    const prefix = PREFIX_FOR_TYPE[o.type]
    if (!prefix || o.type === 'Solid' || o.type === 'CoordinateFrame') continue
    idToRef.set(o.id, stripPrefix(o.id, prefix))
  }

  // ── Pass E: build entities[] in scene object order (preserves DSL order) ──
  const entities = []
  for (const o of objects) {
    switch (o.type) {
      case 'Solid': {
        const entity = {
          ref:  idToRef.get(o.id),
          type: 'Solid',
          name: o.name,
        }
        if (o.description) entity.description = o.description
        if (o.ifcClass != null) entity.ifcClass = o.ifcClass
        entity.dimensions = dimsFromCorners(o.localCorners ?? [])
        entity.position   = vec(o.position ?? { x: 0, y: 0, z: 0 })
        if (!isIdentityQuat(o.orientation)) entity.rotation = quat(o.orientation)

        const frameObjs = framesBySolidId.get(o.id) ?? []
        if (frameObjs.length > 0) {
          entity.frames = frameObjs.map(f => {
            const fr = { ref: idToRef.get(f.id), name: f.name }
            fr.translation = vec(f.translation ?? { x: 0, y: 0, z: 0 })
            if (!isIdentityQuat(f.rotation)) fr.rotation = quat(f.rotation)
            if (f.declaredBy && f.declaredBy !== 'modeller') fr.declaredBy = f.declaredBy
            return fr
          })
        }
        entities.push(entity)
        break
      }

      case 'CoordinateFrame': {
        if (originIds.has(o.id)) break               // auto-Origin: folded away
        if (originIds.has(o.parentId)) break          // user frame: folded into Solid
        // Standalone CF — e.g. robot_base / tcp (ADR-084 §2, TF tree revised).
        //   • World-parented root (robot_base): parentId null → no `parentRef`;
        //     `translation` / `rotation` ARE its world pose → schema `position` +
        //     `rotation`.
        //   • TF child (tcp → robot_base): parentId is another standalone CF →
        //     emit `parentRef`; `translation` / `rotation` are already LOCAL to
        //     that parent, so they map to `position` + `rotation` unchanged
        //     (the compiler re-reads them as a local offset).
        const parentRef = o.parentId ? idToRef.get(o.parentId) : undefined
        const entity = {
          ref:      idToRef.get(o.id),
          type:     'CoordinateFrame',
          name:     o.name,
          position: vec(o.translation ?? { x: 0, y: 0, z: 0 }),
        }
        if (parentRef) entity.parentRef = parentRef
        if (!isIdentityQuat(o.rotation)) entity.rotation = quat(o.rotation)
        entities.push(entity)
        break
      }

      case 'AnnotatedPoint': {
        const entity = { ref: idToRef.get(o.id), type: 'AnnotatedPoint', name: o.name }
        if (o.description) entity.description = o.description
        if (o.placeType != null) entity.placeType = o.placeType
        entity.position = vec(o.vertex ?? { x: 0, y: 0, z: 0 })
        entities.push(entity)
        break
      }

      case 'AnnotatedLine':
      case 'AnnotatedRegion': {
        const entity = { ref: idToRef.get(o.id), type: o.type, name: o.name }
        if (o.description) entity.description = o.description
        if (o.placeType != null) entity.placeType = o.placeType
        entity.vertices = (o.vertices ?? []).map(vec)
        entities.push(entity)
        break
      }

      default: {
        if (UNCONVERTIBLE_TYPES.has(o.type)) {
          warnings.push({ id: o.id, type: o.type, reason: `${o.type} is not expressible in ${LAYOUT_DSL_VERSION}` })
        } else {
          warnings.push({ id: o.id, type: o.type, reason: `unknown scene entity type "${o.type}"` })
        }
      }
    }
  }

  // ── Pass F: constraints[] from SpatialLinks ───────────────────────────────
  const constraints = []
  for (const link of links) {
    const source = idToRef.get(link.sourceId)
    const target = idToRef.get(link.targetId)
    if (source === undefined || target === undefined) {
      warnings.push({
        id:   link.id ?? `${link.sourceId}→${link.targetId}`,
        type: 'SpatialLink',
        reason: `link endpoint not expressible in ${LAYOUT_DSL_VERSION} (source="${link.sourceId}", target="${link.targetId}")`,
      })
      continue
    }
    constraints.push({
      source,
      target,
      jointType:    link.jointType ?? null,
      semanticType: link.semanticType,
      properties:   link.properties ?? {},
    })
  }

  const dsl = {
    version:  LAYOUT_DSL_VERSION,
    strategy: 'manual',
    entities,
    constraints,
  }

  return { dsl, warnings }
}
