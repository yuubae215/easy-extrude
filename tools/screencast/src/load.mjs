// Impure shell around dsl.mjs: reads the scenario, its imported libraries and
// its plugins from disk, then hands plain data to the pure normaliser.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { checkDocument, normalize, compileExtensionSchema, DslError, LIBRARY_VERSION } from './dsl.mjs'
import { CORE_ACTIONS } from './actions.mjs'

const readJson = path => {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch (e) { throw new DslError(`${path}: ${e.message}`) }
}

/** @returns {Promise<{ program, actions: Map, baseDir: string, file: string }>} */
export async function loadScenario(file) {
  const path = resolve(file)
  const baseDir = dirname(path)
  const doc = checkDocument(readJson(path), path)
  if (doc.version === LIBRARY_VERSION) throw new DslError(`${path}: is a macro library, not a scenario`)

  const libraries = (doc.imports ?? []).map(rel => {
    const p = resolve(baseDir, rel)
    const lib = checkDocument(readJson(p), p)
    if (lib.version !== LIBRARY_VERSION) throw new DslError(`${p}: imports must be "${LIBRARY_VERSION}" documents`)
    return lib
  })

  const actions = new Map(CORE_ACTIONS)
  for (const rel of doc.plugins ?? []) {
    const mod = await import(pathToFileURL(resolve(baseDir, rel)).href)
    for (const def of mod.actions ?? []) {
      if (!/^x-[a-z0-9-]+\/[a-z0-9-]+$/.test(def.kind)) throw new DslError(`plugin ${rel}: kind "${def.kind}" must be x-<namespace>/<name>`)
      if (actions.has(def.kind)) throw new DslError(`plugin ${rel}: kind "${def.kind}" is already declared`)
      actions.set(def.kind, { ...def, validate: compileExtensionSchema(def.schema) })
    }
  }
  const extensions = new Map([...actions].filter(([k]) => k.startsWith('x-')))
  const program = normalize(doc, libraries, extensions)
  return { program, actions, baseDir, file: path }
}
