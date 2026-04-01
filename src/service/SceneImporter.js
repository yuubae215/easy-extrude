/**
 * SceneImporter — parse and validate a scene JSON file produced by SceneExporter.
 *
 * Pure computation: no I/O, no DOM, no Three.js mutations.
 *
 * Supported versions: "1.0" (no ImportedMesh geometry), "1.1" (geometry buffers included).
 *
 * Usage:
 *   const parsed = parseImportJson(jsonText)   // throws on invalid input
 *   await sceneService.importFromJson(parsed, viewContext, { clear: true })
 */

/** @typedef {'Solid'|'Profile'|'MeasureLine'|'CoordinateFrame'|'ImportedMesh'} ObjType */

const SUPPORTED_VERSIONS = new Set(['1.0', '1.1'])

/**
 * Parse and lightly validate the JSON text of an exported scene file.
 *
 * @param {string} jsonText  Raw text content of the .json file.
 * @returns {{ version: string, objects: object[] }}
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
  const KNOWN_TYPES = new Set(['Solid', 'Profile', 'MeasureLine', 'CoordinateFrame', 'ImportedMesh'])
  const objects = root.objects.filter(o => {
    if (!o || typeof o !== 'object') return false
    if (!KNOWN_TYPES.has(o.type))    return false
    if (typeof o.id !== 'string' || !o.id) return false
    return true
  })

  return { version: root.version, objects }
}
