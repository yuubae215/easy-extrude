/**
 * SceneImporter — parse and validate a scene JSON file produced by SceneExporter.
 *
 * Pure computation: no I/O, no DOM, no Three.js mutations.
 *
 * Supported versions:
 *   "1.0" — no ImportedMesh geometry
 *   "1.1" — geometry buffers included
 *   "1.2" — SpatialLinks with flat `linkType` field
 *   "1.3" — SpatialLinks with `jointType` + `semanticType` (ADR-038)
 *
 * Backward compatibility: v1.2 files with `linkType` are auto-migrated on import.
 *                         Files missing `links` are imported with links treated as [].
 *
 * Usage:
 *   const parsed = parseImportJson(jsonText)   // throws on invalid input
 *   await sceneService.importFromJson(parsed, viewContext, { clear: true })
 */

/** @typedef {'Solid'|'Profile'|'MeasureLine'|'CoordinateFrame'|'ImportedMesh'} ObjType */

const SUPPORTED_VERSIONS = new Set(['1.0', '1.1', '1.2', '1.3'])

const VALID_JOINT_TYPES    = new Set(['fixed', 'revolute', 'continuous', 'prismatic', 'floating', 'planar'])
const VALID_SEMANTIC_TYPES = new Set([
  'fastened', 'mounts', 'aligned',
  'contains', 'adjacent', 'above', 'connects',
  'references', 'represents',
  'bounded_by',
])
// v1.2 flat linkType values still accepted for backward compat
const VALID_LEGACY_LINK_TYPES = new Set([...VALID_SEMANTIC_TYPES, 'references', 'connects', 'contains', 'adjacent'])

/**
 * Parse and lightly validate the JSON text of an exported scene file.
 *
 * @param {string} jsonText  Raw text content of the .json file.
 * @returns {{ version: string, objects: object[], links: object[] }}
 * @throws {Error} if the JSON is malformed or the schema is invalid.
 */
export function parseImportJson(jsonText) {
  let root
  try {
    root = JSON.parse(jsonText)
  } catch {
    throw new Error('ファイルが有効な JSON ではありません')
  }

  if (!root || typeof root !== 'object') {
    throw new Error('JSONのルートがオブジェクトではありません')
  }

  if (!SUPPORTED_VERSIONS.has(root.version)) {
    throw new Error(`未対応のバージョンです: ${root.version}`)
  }

  if (!Array.isArray(root.objects)) {
    throw new Error('objects フィールドが配列ではありません')
  }

  // Light per-entry type check (no deep validation — invalid entries are skipped on import)
  const KNOWN_TYPES = new Set([
    'Solid', 'Profile', 'MeasureLine', 'CoordinateFrame', 'ImportedMesh',
    'AnnotatedLine', 'AnnotatedRegion', 'AnnotatedPoint',
  ])
  const objects = root.objects.filter(o => {
    if (!o || typeof o !== 'object') return false
    if (!KNOWN_TYPES.has(o.type))    return false
    if (typeof o.id !== 'string' || !o.id) return false
    return true
  })

  // Parse SpatialLinks (v1.2+); treat missing array as empty for older files.
  // v1.3+: validates jointType + semanticType
  // v1.2:  validates legacy linkType (migration happens in SceneService on reconstruction)
  const links = Array.isArray(root.links) ? root.links.filter(l => {
    if (!l || typeof l !== 'object')              return false
    if (typeof l.id !== 'string' || !l.id)        return false
    if (typeof l.sourceId !== 'string')            return false
    if (typeof l.targetId !== 'string')            return false
    // v1.3 format
    if ('semanticType' in l) {
      if (!VALID_SEMANTIC_TYPES.has(l.semanticType)) return false
      if (l.jointType !== null && l.jointType !== undefined && !VALID_JOINT_TYPES.has(l.jointType)) return false
      return true
    }
    // v1.2 legacy format
    if (!VALID_LEGACY_LINK_TYPES.has(l.linkType)) return false
    return true
  }) : []

  return { version: root.version, objects, links }
}
