/**
 * import command — Layout DSL file → compile → save to BFF DB
 *
 * Options:
 *   --api-url <url>   BFF base URL (default: http://localhost:3001)
 *   --name <name>     Scene name (default: DSL meta.name or filename stem)
 *   --token <jwt>     JWT token (falls back to LAYOUT_API_TOKEN env var)
 */
import { readFileSync }  from 'node:fs'
import { basename }      from 'node:path'
import { compileLayout } from '../../src/layout/LayoutCompiler.js'

function parseArgs(args) {
  const opts = { input: null, apiUrl: 'http://localhost:3001', name: null, token: null }
  for (let i = 0; i < args.length; i++) {
    if      (args[i] === '--api-url') opts.apiUrl = args[++i]
    else if (args[i] === '--name')    opts.name   = args[++i]
    else if (args[i] === '--token')   opts.token  = args[++i]
    else if (!opts.input)             opts.input  = args[i]
  }
  return opts
}

export async function importCmd(args) {
  const opts = parseArgs(args)
  if (!opts.input) {
    console.error('Usage: import <input.json> --api-url <url> [--name <name>] [--token <jwt>]')
    process.exit(1)
  }

  const token = opts.token ?? process.env.LAYOUT_API_TOKEN
  if (!token) {
    throw new Error(
      'A JWT token is required. Pass --token <jwt> or set LAYOUT_API_TOKEN env var.\n' +
      'Obtain a token via: POST ' + opts.apiUrl + '/api/auth/token'
    )
  }

  const raw = readFileSync(opts.input, 'utf8')
  let dsl
  try {
    dsl = JSON.parse(raw)
  } catch {
    throw new Error(`Input file is not valid JSON: ${opts.input}`)
  }

  // Compile locally first to catch errors before hitting the network.
  compileLayout(dsl)

  const name = opts.name
    ?? dsl.meta?.name
    ?? basename(opts.input, '.json')

  const res = await fetch(`${opts.apiUrl}/api/layout/scenes`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ name, dsl }),
  })

  const body = await res.json()
  if (!res.ok) {
    const msg = body.details ? body.details.join('\n  ') : body.error
    throw new Error(`BFF responded ${res.status}: ${msg}`)
  }

  console.log(`Scene saved: id=${body.id}  name="${body.name}"`)
  console.log(`Load in app: SceneService.loadScene("${body.id}")`)
}
