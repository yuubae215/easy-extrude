import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, sep } from 'node:path'
import { readdirSync } from 'node:fs'
import ts from 'typescript'

/**
 * Boot-wiring guard — catches the "references a name it never imported" class of
 * regression that only blows up when the real app boots.
 *
 * Why this exists (ADR-085 regression, 2026-07-22): `SceneService.js` used the
 * constants `ROBOT_BASE_FRAME_NAME` / `TCP_FRAME_NAME` in `ensureRobotFrames()`
 * but the import line only brought in `ROBOT_FRAME_DEFAULTS`. `AppController`
 * calls `ensureRobotFrames()` in its constructor, so every boot threw
 * `ReferenceError: ROBOT_BASE_FRAME_NAME is not defined` and the whole app died
 * with a blank canvas — yet:
 *   - `pnpm test` never constructs the controller stack, so it stayed green;
 *   - `pnpm typecheck` only includes `src/types` + `src/domain` (the runtime
 *     layers service/controller/view are deliberately excluded — tsconfig.json),
 *     so `tsc` never saw the unresolved name;
 *   - the only guard was the Playwright boot smoke, which lives in the separate,
 *     non-required `e2e` CI job.
 *
 * This test closes that hole inside the always-required `gate` job: it runs the
 * TypeScript checker over every runtime `.js` module and fails on the
 * *resolution* diagnostics only — an unresolved value name (TS2304 / TS2552) or
 * a named import that the target module does not export (TS2305). It does NOT
 * enforce full types (the deep property/assignability diagnostics those layers
 * defer, TS2339/TS2345/…, are ignored), so it adds no typing burden — it purely
 * asserts that every identifier a runtime module names is actually reachable, so
 * it cannot throw a ReferenceError the moment that line executes at boot.
 *
 * It complements, not duplicates, `pnpm typecheck` (which strictly types
 * types/domain) and the e2e boot smoke (which proves live end-to-end wiring).
 */

const SRC = dirname(fileURLToPath(import.meta.url))

// TS2304 Cannot find name 'X'.
// TS2305 Module '...' has no exported member 'X'.
// TS2552 Cannot find name 'X'. Did you mean 'Y'?
const RESOLUTION_CODES = new Set([2304, 2305, 2552])

/** Every runtime `.js` under src/ except the test files themselves. */
function runtimeJsFiles() {
  return readdirSync(SRC, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.js') && !d.name.endsWith('.test.js'))
    .map((d) => join(d.parentPath ?? d.path, d.name))
}

test('every runtime module resolves every name it references (boot cannot ReferenceError)', () => {
  const rootFiles = runtimeJsFiles()

  // Mirror tsconfig.json's loose runtime posture: we only care that names
  // resolve, not that the deferred layers are fully typed.
  const options = {
    allowJs: true,
    checkJs: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ES2020,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    noImplicitAny: false,
    strictNullChecks: false,
  }

  const program = ts.createProgram(rootFiles, options)
  const roots = new Set(rootFiles.map((f) => f.replace(/\\/g, '/')))

  const offenders = []
  for (const sf of program.getSourceFiles()) {
    // Only judge our own runtime modules — skip lib.d.ts, node_modules, and the
    // .jsx files pulled in transitively (React components are out of scope here).
    if (!roots.has(sf.fileName)) continue
    for (const d of program.getSemanticDiagnostics(sf)) {
      if (!RESOLUTION_CODES.has(d.code)) continue
      const where = d.file && d.start != null
        ? (() => {
            const { line, character } = d.file.getLineAndCharacterOfPosition(d.start)
            return `${relative(SRC, d.file.fileName).split(sep).join('/')}:${line + 1}:${character + 1}`
          })()
        : '(unknown)'
      offenders.push(`${where}  TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`)
    }
  }

  assert.equal(
    offenders.length,
    0,
    `unresolved reference(s) in runtime modules — these throw a ReferenceError on boot:\n  ${offenders.join('\n  ')}`,
  )
})
