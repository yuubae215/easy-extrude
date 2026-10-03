import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCHEMA, checkDocument, expandSteps, normalize, DslError } from '../src/dsl.mjs'
import { Ease } from '../src/ease.mjs'
import { CORE_ACTIONS } from '../src/actions.mjs'
import { loadScenario } from '../src/load.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const base = { version: 'screencast/1.0', meta: { id: 't' }, app: { url: 'http://x/' } }

test('schema ease enum and the easing catalog are one vocabulary', () => {
  assert.deepEqual([...SCHEMA.$defs.ease.enum].sort(), Object.keys(Ease).sort())
})

test('schema step union and the core action registry are one vocabulary', () => {
  const kinds = SCHEMA.$defs.step.oneOf
    .map(r => SCHEMA.$defs[r.$ref.split('/').pop()].properties.do)
    .filter(d => d.const).map(d => d.const)
  assert.deepEqual(kinds.filter(k => k !== 'use').sort(), [...CORE_ACTIONS.keys()].sort())
})

test('every shipped scenario and library is a valid document', async () => {
  for (const dir of ['scenarios', 'library']) {
    for (const f of readdirSync(join(root, dir))) {
      const doc = JSON.parse(readFileSync(join(root, dir, f), 'utf8'))
      checkDocument(doc, f)
      if (dir === 'scenarios') await loadScenario(join(root, dir, f))
    }
  }
})

test('unknown top-level field is rejected (closed wire)', () => {
  assert.throws(() => checkDocument({ ...base, steps: [{ do: 'wait', duration: 1 }], extra: 1 }), DslError)
})

test('macro: whole-value placeholder keeps its type, inline one interpolates', () => {
  const macros = { m: { params: { p: null, n: 'x' }, steps: [{ do: 'move', to: { world: '${p}' } }, { do: 'caption', text: 'hi ${n}' }] } }
  const out = expandSteps([{ do: 'use', macro: 'm', with: { p: [1, 2, 3] } }], macros)
  assert.deepEqual(out[0].to.world, [1, 2, 3])
  assert.equal(out[1].text, 'hi x')
  assert.deepEqual(out[0].origin, [0, 'm', 0])
})

test('macro: missing required param, unknown param, recursion all fail loudly', () => {
  const macros = { m: { params: { p: null }, steps: [{ do: 'wait', duration: 1 }] }, r: { steps: [{ do: 'use', macro: 'r' }] } }
  assert.throws(() => expandSteps([{ do: 'use', macro: 'm' }], macros), /requires p/)
  assert.throws(() => expandSteps([{ do: 'use', macro: 'm', with: { p: 1, q: 2 } }], macros), /no parameter "q"/)
  assert.throws(() => expandSteps([{ do: 'use', macro: 'r' }], macros), /calls itself/)
  assert.throws(() => expandSteps([{ do: 'use', macro: 'nope' }], macros), /unknown macro/)
})

test('steps are validated after expansion — a bad macro argument is caught', () => {
  const doc = { ...base, macros: { m: { params: { d: null }, steps: [{ do: 'wait', duration: '${d}' }] } }, steps: [{ do: 'use', macro: 'm', with: { d: 'soon' } }] }
  assert.throws(() => normalize(checkDocument(doc)), /invalid steps/)
})

test('x-* kinds need a declaring plugin, and the plugin validates its payload', async () => {
  const doc = { ...base, steps: [{ do: 'x-page/eval', expression: '1' }] }
  assert.throws(() => normalize(checkDocument(doc)), /no plugin declares/)
  const { actions } = await import('../plugins/page-eval.mjs')
  const { compileExtensionSchema } = await import('../src/dsl.mjs')
  const ext = new Map(actions.map(a => [a.kind, { ...a, validate: compileExtensionSchema(a.schema) }]))
  assert.ok(normalize(checkDocument(doc), [], ext))
  assert.throws(() => normalize(checkDocument({ ...doc, steps: [{ do: 'x-page/eval' }] }), [], ext), /invalid steps/)
})

test('defaults fill style without erasing what the author set', () => {
  const p = normalize(checkDocument({ ...base, style: { keys: { holdMs: 900 } }, steps: [{ do: 'wait', duration: 1 }] }))
  assert.equal(p.style.keys.holdMs, 900)
  assert.equal(p.style.keys.visible, true)
  assert.equal(p.capture.fps, 30)
})
