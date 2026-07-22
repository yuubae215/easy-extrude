/**
 * LayoutValidator — validate a Layout DSL object before compilation.
 *
 * Pure computation: no I/O, no Three.js, no DOM.
 *
 * @param {object} dsl
 * @returns {{ valid: boolean, errors: string[] }}
 */
import {
  LAYOUT_DSL_VERSION,
  VALID_STRATEGIES,
  VALID_AXES,
  VALID_ENTITY_TYPES,
  VALID_JOINT_TYPES,
  VALID_SEMANTIC_TYPES,
} from './LayoutDslSchema.js'

export function validateLayoutDsl(dsl) {
  const errors = []

  if (!dsl || typeof dsl !== 'object') {
    return { valid: false, errors: ['DSL must be a non-null object'] }
  }

  if (dsl.version !== LAYOUT_DSL_VERSION) {
    errors.push(`version must be "${LAYOUT_DSL_VERSION}", got "${dsl.version}"`)
  }

  if (!Array.isArray(dsl.entities)) {
    errors.push('entities must be an array')
    return { valid: false, errors }
  }

  if (dsl.entities.length === 0) {
    errors.push('entities array must not be empty')
  }

  const strategy = dsl.strategy ?? 'manual'
  if (!VALID_STRATEGIES.includes(strategy)) {
    errors.push(`strategy "${strategy}" is not valid. Use one of: ${VALID_STRATEGIES.join(', ')}`)
  }

  if (dsl.strategyOptions?.axis && !VALID_AXES.includes(dsl.strategyOptions.axis)) {
    errors.push(`strategyOptions.axis "${dsl.strategyOptions.axis}" is not valid. Use one of: ${VALID_AXES.join(', ')}`)
  }

  // Build full ref namespace: entity refs + frame refs + implicit _origin refs
  const entityRefs = new Set()
  const frameRefs  = new Set()

  for (const [i, entity] of dsl.entities.entries()) {
    if (!entity || typeof entity !== 'object') {
      errors.push(`entities[${i}] must be an object`)
      continue
    }

    if (!VALID_ENTITY_TYPES.includes(entity.type)) {
      errors.push(`entities[${i}].type "${entity.type}" is not valid. Use one of: ${VALID_ENTITY_TYPES.join(', ')}`)
    }

    if (!entity.ref || typeof entity.ref !== 'string') {
      errors.push(`entities[${i}] must have a non-empty string "ref"`)
    } else if (entityRefs.has(entity.ref)) {
      errors.push(`entities[${i}].ref "${entity.ref}" is not unique`)
    } else {
      entityRefs.add(entity.ref)
    }

    if (!entity.name || typeof entity.name !== 'string') {
      errors.push(`entities[${i}] must have a non-empty string "name"`)
    }

    if (entity.type === 'Solid') {
      if (entity.dimensions) {
        const d = entity.dimensions
        if (typeof d.x !== 'number' || d.x <= 0 ||
            typeof d.y !== 'number' || d.y <= 0 ||
            typeof d.z !== 'number' || d.z <= 0) {
          errors.push(`entities[${i}].dimensions must have positive x, y, z numbers`)
        }
      }

      // Optional rotation (ADR-055, additive within layout/1.0): body orientation
      // quaternion. Omitted ⇒ identity. Lets a rotated Solid round-trip scene⇄DSL.
      if (entity.rotation !== undefined && entity.rotation !== null) {
        const r = entity.rotation
        if (typeof r.x !== 'number' || typeof r.y !== 'number' ||
            typeof r.z !== 'number' || typeof r.w !== 'number') {
          errors.push(`entities[${i}].rotation must be a quaternion {x,y,z,w} of numbers`)
        }
      }

      for (const [j, frame] of (entity.frames ?? []).entries()) {
        if (!frame.ref || typeof frame.ref !== 'string') {
          errors.push(`entities[${i}].frames[${j}] must have a non-empty string "ref"`)
          continue
        }
        if (entityRefs.has(frame.ref) || frameRefs.has(frame.ref)) {
          errors.push(`entities[${i}].frames[${j}].ref "${frame.ref}" conflicts with an existing ref`)
        } else {
          frameRefs.add(frame.ref)
        }
      }
    }

    if (entity.type === 'AnnotatedPoint' && !entity.position && strategy === 'manual') {
      errors.push(`entities[${i}] (AnnotatedPoint "${entity.ref}") requires a "position" when strategy is "manual"`)
    }

    if ((entity.type === 'AnnotatedLine' || entity.type === 'AnnotatedRegion') && !Array.isArray(entity.vertices)) {
      errors.push(`entities[${i}] (${entity.type} "${entity.ref}") requires a "vertices" array`)
    }
  }

  // Standalone CoordinateFrame TF-parent links (ADR-084 §2 revised): a
  // `parentRef` must reference an existing top-level entity and not itself.
  // Checked after the first pass so a forward reference (parent declared later)
  // still resolves. The runtime reparent guard (_isDescendant) rejects deeper
  // cycles; here we only catch the trivial self-parent.
  for (const [i, entity] of dsl.entities.entries()) {
    if (!entity || typeof entity !== 'object') continue
    if (entity.parentRef === undefined || entity.parentRef === null) continue
    if (entity.type !== 'CoordinateFrame') {
      errors.push(`entities[${i}] ("${entity.ref}") "parentRef" is only valid on a CoordinateFrame`)
      continue
    }
    if (entity.parentRef === entity.ref) {
      errors.push(`entities[${i}] (CoordinateFrame "${entity.ref}") "parentRef" cannot reference itself`)
    } else if (!entityRefs.has(entity.parentRef)) {
      errors.push(`entities[${i}] (CoordinateFrame "${entity.ref}") "parentRef" "${entity.parentRef}" does not match any entity ref`)
    }
  }

  // All resolvable refs: entity refs + frame refs + implicit <ref>_origin for Solids
  const originRefs = new Set([...entityRefs].map(r => `${r}_origin`))
  const allRefs    = new Set([...entityRefs, ...frameRefs, ...originRefs])

  for (const [i, c] of (dsl.constraints ?? []).entries()) {
    if (!c || typeof c !== 'object') {
      errors.push(`constraints[${i}] must be an object`)
      continue
    }
    if (!c.source || !allRefs.has(c.source)) {
      errors.push(`constraints[${i}].source "${c.source}" does not match any entity ref, frame ref, or "<ref>_origin"`)
    }
    if (!c.target || !allRefs.has(c.target)) {
      errors.push(`constraints[${i}].target "${c.target}" does not match any entity ref, frame ref, or "<ref>_origin"`)
    }
    if (c.jointType !== null && c.jointType !== undefined && !VALID_JOINT_TYPES.includes(c.jointType)) {
      errors.push(`constraints[${i}].jointType "${c.jointType}" is not valid. Use one of: ${VALID_JOINT_TYPES.join(', ')} or null`)
    }
    if (!c.semanticType || !VALID_SEMANTIC_TYPES.includes(c.semanticType)) {
      errors.push(`constraints[${i}].semanticType "${c.semanticType}" is not valid. Use one of: ${VALID_SEMANTIC_TYPES.join(', ')}`)
    }
  }

  return { valid: errors.length === 0, errors }
}
