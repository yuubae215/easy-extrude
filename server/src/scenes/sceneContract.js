/**
 * Scene contract binding — derives a runtime validator + the stamped scene
 * version from the in-repo JSON Schema (schema/scene-1.3.schema.json).
 *
 * Unlike the grasp contract (owned upstream in a submodule), the scene schema's
 * source of truth is THIS repository — the BFF only *reads* it, never restates
 * the shape. The schema is the SHAPE contract; the MEANING contract (ref
 * resolution across objects/links/graph) stays in the domain reconstruct path.
 *
 * ADR-064 Phase 3, PHILOSOPHY #29: /api/scenes is a rigor-scoped wire. The graph
 * skeleton is validated closed; bulk geometry (ImportedMesh base64 buffers)
 * rides as an opaque blob leaf whose envelope is checked but whose contents are
 * not (Blender datablock principle).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'

const here = dirname(fileURLToPath(import.meta.url))
const schemaPath = join(here, '..', '..', '..', 'schema', 'scene-1.3.schema.json')

const sceneSchema = JSON.parse(readFileSync(schemaPath, 'utf8'))

/** Canonical scene version, read from the schema — never hardcoded here. */
export const SCENE_VERSION = sceneSchema.properties.version.const

const ajv = new Ajv2020({ allErrors: true, strict: false })
const _validate = ajv.compile(sceneSchema)

/** @param {import('ajv').ErrorObject[] | null | undefined} errors */
function formatErrors(errors) {
  if (!errors) return []
  return errors.map((e) => `${e.instancePath || '/'} ${e.message}`.trim())
}

/**
 * Validate a scene DTO payload against the scene-1.3 shape contract.
 * @param {unknown} value
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSceneData(value) {
  const valid = _validate(value)
  return { valid: Boolean(valid), errors: formatErrors(_validate.errors) }
}
