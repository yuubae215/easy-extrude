/**
 * A dependency-free JSON Schema *subset* validator (ADR-117).
 *
 * ## Why not ajv
 *
 * The stub's conformance suite has to run in the same lane as the rest of the
 * unit tests — `node --test` with no `node_modules` (the discipline
 * `test:context` already relies on). Pulling ajv in would make the one suite
 * that guards the stub the one suite a contributor can skip by not installing.
 *
 * ## Why this is not a hand-copied shape
 *
 * It reads `grasp-search-response.schema.json` itself, so the contract package
 * stays the single authority (§1.1). What is hand-written is the *checker*, not
 * the *shape* — and the checker refuses to guess: any keyword it does not
 * implement raises, rather than being skipped. A validator that silently ignores
 * an unsupported keyword reports "valid" for constraints it never looked at,
 * which is worse than no validator at all, because it produces the green tick
 * that stops anyone from looking (the ADR-115 shape).
 */

/** Keywords that carry documentation or identity, not constraints. */
const ANNOTATIONS = new Set([
  '$schema', '$id', 'title', 'description', 'default', 'examples',
  // OpenAPI's union hint. `oneOf` beside it is what actually constrains, and it
  // IS implemented below — so ignoring this one drops no checking.
  'discriminator',
])

/** Constraint keywords this validator understands. */
const SUPPORTED = new Set([
  'type', 'properties', 'required', 'additionalProperties', 'items',
  'minimum', 'maximum', 'minItems', 'maxItems', 'const', 'enum', 'oneOf', '$ref', '$defs',
])

/**
 * Resolve a local `#/$defs/name` pointer against the root schema.
 * Remote refs are not supported and raise — this contract has none.
 */
function resolveRef(root, ref) {
  if (!ref.startsWith('#/')) {
    throw new Error(`schemaCheck: only local $ref is supported, got "${ref}"`)
  }
  let node = root
  for (const part of ref.slice(2).split('/')) {
    node = node?.[part.replace(/~1/g, '/').replace(/~0/g, '~')]
    if (node === undefined) throw new Error(`schemaCheck: unresolvable $ref "${ref}"`)
  }
  return node
}

/** JSON Schema's type names for a runtime value. */
function typeOf(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (Number.isInteger(value)) return 'integer'
  return typeof value === 'number' ? 'number' : typeof value
}

/** True when `value` satisfies a `type` keyword (string or array form). */
function matchesType(value, type) {
  const allowed = Array.isArray(type) ? type : [type]
  const actual = typeOf(value)
  return allowed.some(t => t === actual || (t === 'number' && actual === 'integer'))
}

/**
 * Validate `value` against `schema`, collecting human-readable errors.
 *
 * @param {unknown} value
 * @param {object} schema  a node of the schema document
 * @param {object} root    the schema document (for `$ref` resolution)
 * @param {string} path    JSON-pointer-ish path, for messages
 * @param {string[]} errors  accumulator
 * @returns {string[]} `errors`
 */
export function validate(value, schema, root, path = '', errors = []) {
  for (const keyword of Object.keys(schema)) {
    if (ANNOTATIONS.has(keyword) || SUPPORTED.has(keyword)) continue
    throw new Error(
      `schemaCheck: unsupported keyword "${keyword}" at ${path || '/'}. ` +
      `Implement it — skipping it would report "valid" for a constraint nobody checked.`,
    )
  }

  if (schema.$ref) {
    return validate(value, resolveRef(root, schema.$ref), root, path, errors)
  }

  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path}: must equal ${JSON.stringify(schema.const)}`)
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: must be one of ${JSON.stringify(schema.enum)}`)
  }

  if (schema.type && !matchesType(value, schema.type)) {
    errors.push(`${path}: expected ${JSON.stringify(schema.type)}, got ${typeOf(value)}`)
    return errors                      // further keywords assume the type held
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path}: ${value} < minimum ${schema.minimum}`)
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${path}: ${value} > maximum ${schema.maximum}`)
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path}: ${value.length} items < minItems ${schema.minItems}`)
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${path}: ${value.length} items > maxItems ${schema.maxItems}`)
    }
    if (schema.items) {
      value.forEach((item, i) => validate(item, schema.items, root, `${path}/${i}`, errors))
    }
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${path}: missing required property "${key}"`)
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (key in value) validate(value[key], sub, root, `${path}/${key}`, errors)
    }
    if (schema.additionalProperties !== undefined) {
      const known = new Set(Object.keys(schema.properties ?? {}))
      for (const key of Object.keys(value)) {
        if (known.has(key)) continue
        if (schema.additionalProperties === false) {
          errors.push(`${path}: additional property "${key}" is not allowed`)
        } else if (typeof schema.additionalProperties === 'object') {
          validate(value[key], schema.additionalProperties, root, `${path}/${key}`, errors)
        }
      }
    }
  }

  if (schema.oneOf) {
    const matches = schema.oneOf.filter(branch => validate(value, branch, root, path, []).length === 0)
    if (matches.length !== 1) {
      errors.push(`${path}: must match exactly one oneOf branch (matched ${matches.length})`)
    }
  }

  return errors
}

/**
 * Validate a whole document against a schema document.
 * @param {unknown} value
 * @param {object} schema
 * @returns {string[]} empty when valid
 */
export function validateAgainst(value, schema) {
  return validate(value, schema, schema, '', [])
}
