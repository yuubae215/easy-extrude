/**
 * compile command — Layout DSL file → SceneSerializer v1.3 JSON
 *
 * Options:
 *   --output <file>   Write JSON to file instead of stdout
 *   --pretty          Pretty-print JSON (2-space indent)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { compileLayout } from '../../src/layout/LayoutCompiler.js'

function parseArgs(args) {
  const opts = { input: null, output: null, pretty: false }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' || args[i] === '-o') opts.output = args[++i]
    else if (args[i] === '--pretty' || args[i] === '-p')  opts.pretty = true
    else if (!opts.input) opts.input = args[i]
  }
  return opts
}

export async function compile(args) {
  const opts = parseArgs(args)
  if (!opts.input) {
    console.error('Usage: compile <input.json> [--output <file>] [--pretty]')
    process.exit(1)
  }

  const raw = readFileSync(opts.input, 'utf8')
  let dsl
  try {
    dsl = JSON.parse(raw)
  } catch {
    throw new Error(`Input file is not valid JSON: ${opts.input}`)
  }

  const sceneJson = compileLayout(dsl)
  const output    = opts.pretty
    ? JSON.stringify(sceneJson, null, 2)
    : JSON.stringify(sceneJson)

  if (opts.output) {
    writeFileSync(opts.output, output, 'utf8')
    const { objects, links } = sceneJson
    console.error(
      `Compiled: ${objects.filter(o => o.type === 'Solid').length} Solid(s), ` +
      `${objects.filter(o => o.type === 'CoordinateFrame').length} CoordinateFrame(s), ` +
      `${links.length} SpatialLink(s) → ${opts.output}`
    )
  } else {
    process.stdout.write(output + '\n')
  }
}
