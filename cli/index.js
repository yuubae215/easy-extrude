#!/usr/bin/env node
/**
 * easy-extrude-layout CLI
 *
 * Commands:
 *   compile  <input.json>            Compile Layout DSL → SceneSerializer v1.3 JSON
 *   import   <input.json>            Compile + save to BFF DB
 *   interpret "<text>" --ai          NL → Layout DSL via Claude API (requires ANTHROPIC_API_KEY)
 *
 * Usage:
 *   node cli/index.js compile examples/factory_layout.json
 *   node cli/index.js compile examples/factory_layout.json --output scene.json
 *   node cli/index.js import  examples/factory_layout.json --api-url http://localhost:3001 --name "My Layout"
 *   ANTHROPIC_API_KEY=... node cli/index.js interpret "ロボット3台を1m間隔で配置" --ai
 */

import { compile }   from './commands/compile.js'
import { importCmd } from './commands/import.js'
import { interpret } from './commands/interpret.js'

const [,, command, ...args] = process.argv

const COMMANDS = {
  compile:   compile,
  import:    importCmd,
  interpret: interpret,
}

function printUsage() {
  console.error(`
Usage: easy-extrude-layout <command> [options]

Commands:
  compile  <input.json> [--output <file>] [--pretty]
  import   <input.json> --api-url <url> [--name <name>] [--token <jwt>]
  interpret "<requirements text>" --ai [--output <file>] [--import --api-url <url>]

Examples:
  node cli/index.js compile examples/factory_layout.json --pretty
  node cli/index.js import  examples/factory_layout.json --api-url http://localhost:3001
  ANTHROPIC_API_KEY=sk-... node cli/index.js interpret "工場セルに作業台とロボットを配置" --ai
`.trim())
  process.exit(1)
}

if (!command || !COMMANDS[command]) {
  printUsage()
}

try {
  await COMMANDS[command](args)
} catch (err) {
  console.error(`Error: ${err.message}`)
  if (err.errors) {
    for (const e of err.errors) console.error(`  - ${e}`)
  }
  process.exit(1)
}
