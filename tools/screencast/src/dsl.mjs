// Screencast DSL — shape validation, macro expansion, defaults. PURE: no fs,
// no browser. `load.mjs` is the impure shell that reads files and plugins and
// hands them here (principle #3).
import Ajv2020 from 'ajv/dist/2020.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
export const SCHEMA = JSON.parse(readFileSync(join(here, '..', 'schema', 'screencast-1.0.schema.json'), 'utf8'))
export const SCENARIO_VERSION = 'screencast/1.0'
export const LIBRARY_VERSION = 'screencast-library/1.0'

const ajv = new Ajv2020({ allErrors: true, strict: false })
ajv.addSchema(SCHEMA)
const validateDocument = ajv.getSchema(SCHEMA.$id)
const validateStep = ajv.compile({ $ref: `${SCHEMA.$id}#/$defs/step` })

export class DslError extends Error {
  constructor(message, details = []) {
    super(details.length ? `${message}\n  - ${details.join('\n  - ')}` : message)
    this.details = details
  }
}

const fmt = errors => (errors ?? []).map(e => `${e.instancePath || '/'} ${e.message}${e.params?.allowedValues ? ` (${e.params.allowedValues.join(', ')})` : ''}`)

/** Shape-check a scenario or library document. Throws DslError. */
export function checkDocument(doc, where = 'document') {
  if (!validateDocument(doc)) throw new DslError(`${where}: not a valid screencast document`, fmt(validateDocument.errors))
  return doc
}

export const DEFAULTS = Object.freeze({
  app: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, storage: {}, css: '', settleMs: 600, probes: {} },
  capture: { fps: 30, clock: 'virtual', pace: 1, format: 'png' },
  style: {
    accent: '#4fc3f7', ink: '#f5f7fa', surface: '#0d1117',
    font: '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif',
    cursor: { visible: true, size: 22, trail: true },
    keys: { visible: true, holdMs: 1100, anchor: 'bottom-center' },
    captions: { anchor: 'bottom-left' },
  },
})

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v)
function merge(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over
  const out = { ...base }
  for (const [k, v] of Object.entries(over)) out[k] = merge(base[k], v)
  return out
}

const PLACEHOLDER = /\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g
function substitute(value, params, macroName) {
  if (typeof value === 'string') {
    const whole = value.match(/^\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}$/)
    if (whole) {
      if (!(whole[1] in params)) throw new DslError(`macro "${macroName}": unknown parameter \${${whole[1]}}`)
      return structuredClone(params[whole[1]])
    }
    return value.replace(PLACEHOLDER, (_, name) => {
      if (!(name in params)) throw new DslError(`macro "${macroName}": unknown parameter \${${name}}`)
      return String(params[name])
    })
  }
  if (Array.isArray(value)) return value.map(v => substitute(v, params, macroName))
  if (isObj(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, params, macroName)]))
  return value
}

/**
 * Expand `use` steps recursively. Each emitted step carries `origin` — the
 * macro call chain — so a runtime error names the line the author wrote.
 */
export function expandSteps(steps, macros, chain = []) {
  const out = []
  steps.forEach((step, i) => {
    const at = [...chain, i]
    if (step.do !== 'use') { out.push({ ...step, origin: at }); return }
    const macro = macros[step.macro]
    if (!macro) throw new DslError(`step ${at.join('.')}: unknown macro "${step.macro}"`, Object.keys(macros).map(k => `known: ${k}`))
    if (chain.filter(c => c === step.macro).length) throw new DslError(`macro "${step.macro}" calls itself`)
    if (chain.length > 32) throw new DslError('macro expansion deeper than 32')
    const params = { ...(macro.params ?? {}) }
    for (const [k, v] of Object.entries(step.with ?? {})) {
      if (!(k in params)) throw new DslError(`step ${at.join('.')}: macro "${step.macro}" has no parameter "${k}"`)
      params[k] = v
    }
    const missing = Object.entries(params).filter(([, v]) => v === null).map(([k]) => k)
    if (missing.length) throw new DslError(`step ${at.join('.')}: macro "${step.macro}" requires ${missing.join(', ')}`)
    const body = substitute(macro.steps, params, step.macro)
    // A macro call may itself be async/labelled: the flag applies to its LAST step
    // (the one whose end the next step would otherwise wait for).
    const inner = expandSteps(body, macros, [...at, step.macro])
    if (step.async && inner.length) inner[inner.length - 1] = { ...inner[inner.length - 1], async: true }
    out.push(...inner)
  })
  return out
}

/**
 * Normalise a validated scenario into the program the planner consumes.
 * @param {object} doc         scenario (already shape-checked)
 * @param {object[]} libraries imported library documents, in import order
 * @param {Map<string,object>} extensions  kind → ActionDef (from plugins)
 */
export function normalize(doc, libraries = [], extensions = new Map()) {
  if (doc.version !== SCENARIO_VERSION) throw new DslError(`expected version "${SCENARIO_VERSION}", got "${doc.version}"`)
  const macros = Object.assign({}, ...libraries.map(l => l.macros), doc.macros ?? {})
  const steps = expandSteps(doc.steps, macros)
  const errors = []
  steps.forEach(step => {
    const where = `step ${step.origin.join('.')} (${step.do})`
    const { origin, ...bare } = step
    if (step.do.startsWith('x-')) {
      const ext = extensions.get(step.do)
      if (!ext) { errors.push(`${where}: no plugin declares this kind`); return }
      if (ext.validate && !ext.validate(bare)) errors.push(...fmt(ext.validate.errors).map(e => `${where}: ${e}`))
      return
    }
    if (!validateStep(bare)) errors.push(`${where}: ${fmt(validateStep.errors).slice(0, 3).join('; ')}`)
  })
  if (errors.length) throw new DslError('invalid steps after macro expansion', errors)
  return {
    version: doc.version,
    meta: doc.meta,
    app: merge(DEFAULTS.app, doc.app),
    capture: merge(DEFAULTS.capture, doc.capture ?? {}),
    style: merge(DEFAULTS.style, doc.style ?? {}),
    outputs: doc.outputs ?? [{ format: 'mp4', path: `${doc.meta.id}.mp4` }],
    steps,
  }
}

/** Compile a plugin's own payload schema (used by load.mjs). */
export const compileExtensionSchema = schema => (schema ? ajv.compile(schema) : null)
