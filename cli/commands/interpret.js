/**
 * interpret command — NL requirements text → Layout DSL via Claude API
 *
 * Requires: ANTHROPIC_API_KEY environment variable
 *
 * Options:
 *   --ai              Enable Claude API interpretation (required flag)
 *   --output <file>   Write Layout DSL JSON to file instead of stdout
 *   --import          After interpreting, also run the import command
 *   --api-url <url>   BFF URL (used with --import)
 *   --name <name>     Scene name (used with --import)
 *   --token <jwt>     JWT token (used with --import)
 *   --pretty          Pretty-print DSL JSON
 */
import { writeFileSync } from 'node:fs'
import { validateLayoutDsl } from '../../src/layout/LayoutValidator.js'
import { importCmd }         from './import.js'
import { LAYOUT_DSL_VERSION, VALID_ENTITY_TYPES, VALID_STRATEGIES,
         VALID_SEMANTIC_TYPES, VALID_JOINT_TYPES } from '../../src/layout/LayoutDslSchema.js'

function parseArgs(args) {
  const opts = {
    text: null, ai: false, output: null, pretty: false,
    doImport: false, apiUrl: 'http://localhost:3001', name: null, token: null,
  }
  for (let i = 0; i < args.length; i++) {
    if      (args[i] === '--ai')       opts.ai       = true
    else if (args[i] === '--output' || args[i] === '-o') opts.output = args[++i]
    else if (args[i] === '--pretty')   opts.pretty   = true
    else if (args[i] === '--import')   opts.doImport = true
    else if (args[i] === '--api-url')  opts.apiUrl   = args[++i]
    else if (args[i] === '--name')     opts.name     = args[++i]
    else if (args[i] === '--token')    opts.token    = args[++i]
    else if (!opts.text)               opts.text     = args[i]
  }
  return opts
}

const SCHEMA_SUMMARY = `
Layout DSL v1.0 JSON schema:
{
  "version": "${LAYOUT_DSL_VERSION}",         // required, exact string
  "meta": { "name": "string", "description": "string" },
  "strategy": "${VALID_STRATEGIES.join(' | ')}",   // default: "manual"
  "strategyOptions": {
    "axis": "+X | -X | +Y | -Y | +Z | -Z",  // for linear/radial
    "spacing": <number>,                      // mm, default 3000
    "cols": <number>                          // for grid
  },
  "entities": [
    {
      "ref":         "unique_id_string",            // required, no spaces
      "type":        "${VALID_ENTITY_TYPES.join(' | ')}",
      "name":        "Human-readable name",
      "description": "optional",
      "ifcClass":    "IfcEquipmentElement | IfcWall | IfcFurniture | ...",
      "dimensions":  { "x": <mm>, "y": <mm>, "z": <mm> },  // Solid only
      "position":    { "x": <mm>, "y": <mm>, "z": <mm> },  // centroid; overrides strategy
      "vertices":    [{ "x": <mm>, "y": <mm>, "z": <mm> }], // AnnotatedLine/Region
      "placeType":   "Zone | Route | Hub | Anchor",          // AnnotatedLine/Region/Point
      "frames": [    // optional child CoordinateFrames on a Solid
        { "ref": "unique_ref", "name": "name", "translation": { "x":0,"y":0,"z":0 } }
      ]
    }
  ],
  "constraints": [
    {
      "source":       "entity_ref | frame_ref | entity_ref_origin",
      "target":       "entity_ref | frame_ref | entity_ref_origin",
      "jointType":    "${VALID_JOINT_TYPES.join(' | ')} | null",
      "semanticType": "${VALID_SEMANTIC_TYPES.join(' | ')}",
      "properties":   {}
    }
  ]
}

Rules:
- World frame: +X forward, +Y left, +Z up (ROS REP-103). Units: mm.
- position is the centroid (center) of the Solid. If bottom should be at z=0, set z = dims.z/2.
- For <ref>_origin in constraints: refers to the auto-generated Origin CF of entity <ref>.
- Use "fastened" + jointType:"fixed" for rigid bolted connections.
- Use "above" (jointType:null) for objects placed on top of another.
- Use "adjacent" (jointType:null) for side-by-side objects.
- Use "connects" (jointType:null) for utility connections (power, pipe, cable).
- Refs must be unique, no spaces, ASCII only.
- Output ONLY valid JSON. No explanation text. No markdown code fences.
`

export async function interpret(args) {
  const opts = parseArgs(args)

  if (!opts.text) {
    console.error('Usage: interpret "<requirements text>" --ai [--output <file>]')
    process.exit(1)
  }

  if (!opts.ai) {
    throw new Error('Pass --ai to enable Claude API interpretation (ANTHROPIC_API_KEY required)')
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is not set')
  }

  process.stderr.write('Interpreting requirements via Claude API...\n')

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: 4096,
      system: `You are a factory layout assistant for easy-extrude, a 3D modeling tool.
Convert the user's natural language requirements into a valid Layout DSL JSON.

${SCHEMA_SUMMARY}

IMPORTANT: Output ONLY the raw JSON object. No markdown, no explanation, no code fences.`,
      messages: [{ role: 'user', content: opts.text }],
    }),
  })

  if (!response.ok) {
    const errBody = await response.text()
    throw new Error(`Claude API error ${response.status}: ${errBody}`)
  }

  const apiResult = await response.json()
  const rawText   = apiResult.content?.[0]?.text ?? ''

  let dsl
  try {
    dsl = JSON.parse(rawText.trim())
  } catch {
    throw new Error(
      `Claude returned non-JSON output:\n${rawText.slice(0, 500)}`
    )
  }

  // Validate before proceeding (PHILOSOPHY #11 — silent failures are the hardest bugs)
  const validation = validateLayoutDsl(dsl)
  if (!validation.valid) {
    const errDetail = validation.errors.map(e => `  - ${e}`).join('\n')
    throw new Error(`Claude generated an invalid Layout DSL:\n${errDetail}`)
  }

  const outputStr = opts.pretty
    ? JSON.stringify(dsl, null, 2)
    : JSON.stringify(dsl)

  if (opts.output) {
    writeFileSync(opts.output, outputStr, 'utf8')
    process.stderr.write(`Layout DSL written to ${opts.output}\n`)
  } else if (!opts.doImport) {
    process.stdout.write(outputStr + '\n')
  }

  if (opts.doImport) {
    // Write DSL to a temp file, then run import
    const { writeFileSync: wfs, unlinkSync } = await import('node:fs')
    const tmpPath = `/tmp/layout_dsl_${Date.now()}.json`
    wfs(tmpPath, outputStr, 'utf8')
    try {
      await importCmd([tmpPath,
        '--api-url', opts.apiUrl,
        ...(opts.name  ? ['--name',  opts.name]  : []),
        ...(opts.token ? ['--token', opts.token] : []),
      ])
    } finally {
      try { unlinkSync(tmpPath) } catch { /* ignore */ }
    }
  }
}
