#!/usr/bin/env node
// Validate a DSL instance against one of the in-repo DSL schemas.
//
//   node schema/tools/validate.mjs <schema> <instance.json | ->
//
//   schema:   layout-1.0 | context-0.4
//   instance: path to a JSON file, or "-" to read stdin.
//
// Exit 0 = the instance conforms to the SHAPE contract. Exit 1 = it would be
// rejected (unknown field, wrong enum, bad version, ...). This is only the
// shape check; the MEANING contract lives in LayoutValidator.js /
// ContextValidator.js (ADR-064 Phase 2).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'

const here = dirname(fileURLToPath(import.meta.url))
const schemaDir = join(here, '..')

const schemas = { 'layout-1.0': 'layout-1.0.schema.json', 'context-0.4': 'context-0.4.schema.json' }

const [name, instancePath] = process.argv.slice(2)

if (!schemas[name] || !instancePath) {
  console.error([
    'usage: node schema/tools/validate.mjs <schema> <instance.json | ->',
    '',
    'schemas:',
    ...Object.keys(schemas).map((s) => `  ${s}`),
    '',
    'examples:',
    '  node schema/tools/validate.mjs layout-1.0 examples/factory_layout.json',
    '  node schema/tools/validate.mjs context-0.4 examples/cell_robotics_context.json',
  ].join('\n'))
  process.exit(1)
}

const readJson = (p) => JSON.parse(p === '-' ? readFileSync(0, 'utf8') : readFileSync(p, 'utf8'))

const schema = readJson(join(schemaDir, schemas[name]))
const instance = readJson(instancePath)

const ajv = new Ajv2020({ allErrors: true, strict: false })
const validate = ajv.compile(schema)

if (validate(instance)) {
  console.log(`ok: conforms to ${name} (shape)`)
  process.exit(0)
}

console.error(`rejected as ${name}:`)
for (const err of validate.errors) {
  console.error(`  - ${err.instancePath || '/'} ${err.message} ${JSON.stringify(err.params)}`)
}
process.exit(1)
