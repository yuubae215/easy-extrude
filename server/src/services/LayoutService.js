/**
 * LayoutService — server-side wrapper for LayoutCompiler.
 *
 * Side-effects layer: handles DB persistence via sceneStore.
 * Pure compilation is delegated to src/layout/LayoutCompiler.js.
 */
import { v4 as uuidv4 } from 'uuid'
import { compileLayout } from '../../../src/layout/LayoutCompiler.js'
import { createScene }   from './sceneStore.js'

export { compileLayout }

/**
 * Compile a Layout DSL and persist the result as a new scene in the DB.
 *
 * @param {string} name  Scene display name
 * @param {object} dsl   Layout DSL object (version layout/1.0)
 * @returns {Promise<{ id, name, created_at, updated_at, data }>}
 */
export async function compileAndSaveLayout(name, dsl) {
  const sceneJson = compileLayout(dsl)

  const { version, ...data } = sceneJson
  if (!data.transformGraph) {
    data.transformGraph = { nodes: [], edges: [] }
  }

  const id   = `scene_${uuidv4().replace(/-/g, '').slice(0, 16)}`
  const meta = await createScene({ id, name: name.trim(), data })
  return { ...meta, data }
}
