/**
 * LayoutCompiler — compile a Layout DSL object into a SceneSerializer v1.3 JSON.
 *
 * Pure computation: no I/O, no Three.js, no DOM.
 * Output is compatible with SceneImporter.parseImportJson() + SceneService.importFromJson().
 *
 * 5W1H mapping (ADR-044):
 *   Why   → dsl.constraints   (success conditions)
 *   How   → dsl.strategy      (linear / grid / stack / radial / manual)
 *   What  → dsl.entities      (Solid dimensions, CF offsets, annotation vertices)
 *
 * @module layout/LayoutCompiler
 */

import { SCENE_JSON_VERSION, DEFAULT_STRATEGY_OPTIONS } from './LayoutDslSchema.js'
import { validateLayoutDsl } from './LayoutValidator.js'

// ── ID helpers ────────────────────────────────────────────────────────────────

function slug(ref) {
  return ref.replace(/[^a-zA-Z0-9_]/g, '_')
}

const ENTITY_PREFIX = {
  Solid:            'solid',
  CoordinateFrame:  'cf',
  AnnotatedLine:    'al',
  AnnotatedRegion:  'ar',
  AnnotatedPoint:   'ap',
}

// ── Ref map ───────────────────────────────────────────────────────────────────

/**
 * Build a Map from Layout DSL ref strings to generated entity IDs.
 * Exposes three namespaces per Solid:
 *   "<ref>"         → Solid ID
 *   "<ref>_origin"  → auto-generated Origin CF ID (ADR-037)
 *   "<frame.ref>"   → user-defined child CF ID
 *
 * Exported so callers that load the compiled scene (importFromJson keeps the
 * original IDs when clear=true) can map DSL refs to live scene entity IDs.
 */
export function buildRefMap(entities) {
  const map = new Map()

  for (const entity of entities) {
    const prefix = ENTITY_PREFIX[entity.type] ?? 'entity'
    const entityId = `${prefix}_${slug(entity.ref)}`
    map.set(entity.ref, entityId)

    if (entity.type === 'Solid') {
      map.set(`${entity.ref}_origin`, `cf_origin_${slug(entity.ref)}`)

      for (const frame of entity.frames ?? []) {
        map.set(frame.ref, `cf_${slug(entity.ref)}_${slug(frame.ref)}`)
      }
    }
  }

  return map
}

// ── Position computation ──────────────────────────────────────────────────────

function axisVector(axis) {
  switch (axis) {
    case '+X': return { x: 1, y: 0, z: 0 }
    case '-X': return { x: -1, y: 0, z: 0 }
    case '+Y': return { x: 0, y: 1, z: 0 }
    case '-Y': return { x: 0, y: -1, z: 0 }
    case '+Z': return { x: 0, y: 0, z: 1 }
    case '-Z': return { x: 0, y: 0, z: -1 }
    default:   return { x: 1, y: 0, z: 0 }
  }
}

/**
 * Compute world-space center positions for all entities.
 * Entities with an explicit "position" field always use it directly.
 * Remaining entities (that need positioning) are assigned by strategy.
 *
 * Position = ADR-040 _position = body-frame centroid = geometric center.
 * For a Solid with dims {x,y,z}: bottom sits at z = position.z - dims.z/2.
 */
function computePositions(entities, strategy, rawOpts) {
  const opts   = { ...DEFAULT_STRATEGY_OPTIONS, ...rawOpts }
  const posMap = new Map()

  if (strategy === 'manual') {
    for (const e of entities) {
      posMap.set(e.ref, e.position ?? { x: 0, y: 0, z: 0 })
    }
    return posMap
  }

  // Entities with explicit positions are placed as-is.
  for (const e of entities) {
    if (e.position) posMap.set(e.ref, e.position)
  }

  // Entities needing automatic placement.
  const needsPos = entities.filter(e =>
    (e.type === 'Solid' || e.type === 'AnnotatedPoint') && !e.position
  )

  let stackZ = opts.baseZ

  for (let i = 0; i < needsPos.length; i++) {
    const entity = needsPos[i]
    const dims   = entity.dimensions ?? { x: 1000, y: 1000, z: 1000 }
    let pos

    switch (strategy) {
      case 'linear': {
        const av = axisVector(opts.axis)
        pos = {
          x: av.x * i * opts.spacing,
          y: av.y * i * opts.spacing,
          z: dims.z / 2 + av.z * i * opts.spacing,
        }
        break
      }
      case 'grid': {
        const col = i % opts.cols
        const row = Math.floor(i / opts.cols)
        pos = { x: col * opts.spacing, y: row * opts.spacing, z: dims.z / 2 }
        break
      }
      case 'stack': {
        pos    = { x: 0, y: 0, z: stackZ + dims.z / 2 }
        stackZ += dims.z
        break
      }
      case 'radial': {
        const total = needsPos.length
        const angle = (2 * Math.PI / total) * i
        const r     = opts.spacing
        pos = { x: r * Math.cos(angle), y: r * Math.sin(angle), z: dims.z / 2 }
        break
      }
      default:
        pos = { x: 0, y: 0, z: 0 }
    }

    posMap.set(entity.ref, pos)
  }

  return posMap
}

// ── localCorners ──────────────────────────────────────────────────────────────

/**
 * Generate 8 body-frame corner vectors from Solid dimensions.
 * Matches CuboidModel.createInitialCorners() corner ordering (ROS world frame).
 *
 * Corner index diagram:
 *   6─────7
 *  /|    /|   +Z up
 * 5─────4 |   +Y left
 * | 2───|─3   +X front
 * |/    |/
 * 1─────0
 */
function generateLocalCorners(dims) {
  const hw = dims.x / 2
  const hd = dims.y / 2
  const hh = dims.z / 2
  return [
    { x: -hw, y: -hd, z: -hh }, // 0
    { x:  hw, y: -hd, z: -hh }, // 1
    { x:  hw, y:  hd, z: -hh }, // 2
    { x: -hw, y:  hd, z: -hh }, // 3
    { x: -hw, y: -hd, z:  hh }, // 4
    { x:  hw, y: -hd, z:  hh }, // 5
    { x:  hw, y:  hd, z:  hh }, // 6
    { x: -hw, y:  hd, z:  hh }, // 7
  ]
}

const IDENTITY_QUATERNION = { x: 0, y: 0, z: 0, w: 1 }

// ── Object generation ─────────────────────────────────────────────────────────

function generateObjects(entities, refMap, positions) {
  const objects = []

  for (const entity of entities) {
    switch (entity.type) {

      case 'Solid': {
        const id  = refMap.get(entity.ref)
        const pos = positions.get(entity.ref) ?? { x: 0, y: 0, z: 0 }
        const dims = entity.dimensions ?? { x: 1000, y: 1000, z: 1000 }

        objects.push({
          type:         'Solid',
          id,
          name:         entity.name,
          description:  entity.description ?? '',
          ifcClass:     entity.ifcClass ?? null,
          position:     { x: pos.x, y: pos.y, z: pos.z },
          orientation:  entity.rotation
            ? { x: entity.rotation.x, y: entity.rotation.y, z: entity.rotation.z, w: entity.rotation.w }
            : IDENTITY_QUATERNION,
          localCorners: generateLocalCorners(dims),
        })

        // Auto-generated Origin CoordinateFrame (ADR-037)
        const originId = refMap.get(`${entity.ref}_origin`)
        objects.push({
          type:        'CoordinateFrame',
          id:          originId,
          name:        'Origin',
          parentId:    id,
          declaredBy:  'modeller',
          translation: { x: 0, y: 0, z: 0 },
          rotation:    IDENTITY_QUATERNION,
        })

        // User-defined child CoordinateFrames
        for (const frame of entity.frames ?? []) {
          objects.push({
            type:        'CoordinateFrame',
            id:          refMap.get(frame.ref),
            name:        frame.name ?? frame.ref,
            parentId:    originId,   // always children of Origin CF (ADR-037)
            declaredBy:  frame.declaredBy ?? 'modeller',
            translation: frame.translation ?? { x: 0, y: 0, z: 0 },
            rotation:    frame.rotation    ?? IDENTITY_QUATERNION,
          })
        }
        break
      }

      case 'AnnotatedPoint': {
        const id  = refMap.get(entity.ref)
        const pos = positions.get(entity.ref) ?? { x: 0, y: 0, z: 0 }
        objects.push({
          type:        'AnnotatedPoint',
          id,
          name:        entity.name,
          description: entity.description ?? '',
          placeType:   entity.placeType ?? null,
          vertex:      { id: `vtx_${id}`, x: pos.x, y: pos.y, z: pos.z },
        })
        break
      }

      case 'AnnotatedLine': {
        const id = refMap.get(entity.ref)
        objects.push({
          type:        'AnnotatedLine',
          id,
          name:        entity.name,
          description: entity.description ?? '',
          placeType:   entity.placeType ?? null,
          vertices:    (entity.vertices ?? []).map((v, i) => ({
            id: `vtx_${id}_${i}`,
            x:  v.x ?? 0,
            y:  v.y ?? 0,
            z:  v.z ?? 0,
          })),
        })
        break
      }

      case 'AnnotatedRegion': {
        const id = refMap.get(entity.ref)
        objects.push({
          type:        'AnnotatedRegion',
          id,
          name:        entity.name,
          description: entity.description ?? '',
          placeType:   entity.placeType ?? null,
          vertices:    (entity.vertices ?? []).map((v, i) => ({
            id: `vtx_${id}_${i}`,
            x:  v.x ?? 0,
            y:  v.y ?? 0,
            z:  v.z ?? 0,
          })),
        })
        break
      }

      case 'CoordinateFrame': {
        const id       = refMap.get(entity.ref)
        const parentId = entity.parentRef ? (refMap.get(entity.parentRef) ?? null) : null
        objects.push({
          type:        'CoordinateFrame',
          id,
          name:        entity.name,
          parentId,
          declaredBy:  entity.declaredBy ?? 'modeller',
          translation: entity.translation ?? { x: 0, y: 0, z: 0 },
          rotation:    entity.rotation    ?? IDENTITY_QUATERNION,
        })
        break
      }
    }
  }

  return objects
}

// ── Link generation ───────────────────────────────────────────────────────────

/**
 * Deterministic SpatialLink ID for the i-th constraint.
 * Exported alongside buildRefMap so callers can resolve trace targets like
 * "constraint:robot_base→robot_mount" to live scene link IDs.
 */
export function linkIdForConstraint(index, c) {
  return `sl_${index}_${slug(c.source)}_${slug(c.target)}`
}

function generateLinks(constraints, refMap) {
  const links = []

  for (const [i, c] of constraints.entries()) {
    const sourceId = refMap.get(c.source)
    const targetId = refMap.get(c.target)
    if (!sourceId || !targetId) continue // validator catches unresolved refs

    links.push({
      id:           linkIdForConstraint(i, c),
      sourceId,
      targetId,
      jointType:    c.jointType    ?? null,
      semanticType: c.semanticType,
      properties:   c.properties   ?? {},
    })
  }

  return links
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compile a Layout DSL object into a SceneSerializer v1.3 scene JSON.
 *
 * @param {object} dsl  Parsed Layout DSL (version layout/1.0)
 * @returns {{ version: string, objects: object[], links: object[], transformGraph: object }}
 * @throws {Error} with .errors string[] on validation failure
 */
export function compileLayout(dsl) {
  const validation = validateLayoutDsl(dsl)
  if (!validation.valid) {
    const err = new Error(
      'Layout DSL validation failed:\n' +
      validation.errors.map(e => `  - ${e}`).join('\n')
    )
    err.errors = validation.errors
    throw err
  }

  const refMap    = buildRefMap(dsl.entities)
  const positions = computePositions(
    dsl.entities,
    dsl.strategy        ?? 'manual',
    dsl.strategyOptions ?? {},
  )
  const objects = generateObjects(dsl.entities, refMap, positions)
  const links   = generateLinks(dsl.constraints ?? [], refMap)

  return {
    version:        SCENE_JSON_VERSION,
    objects,
    links,
    transformGraph: { nodes: [], edges: [] },
  }
}
