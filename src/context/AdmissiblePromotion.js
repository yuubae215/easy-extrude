/**
 * AdmissiblePromotion — stated → derived auto-promotion of a Requirement's
 * admissible interval (ADR-049 Phase 2, invariant 6).
 *
 * Pure computation: no I/O, no Three.js, no DOM. (PHILOSOPHY #3)
 * Returns a NEW requirements Map; never mutates its input (PHILOSOPHY #6 —
 * Transformations Return New Instances).
 *
 * The canonical admissible region is the preimage `{ x | criterion(kpi(x)) }`
 * (ADR-049 §1 observation 2). When a `stated` requirement already carries a
 * *closed-form monotonic* `kpi.expr` over its single constrained variable, that
 * preimage can be computed: invert the criterion numerically over the variable's
 * domain and replace the hand-stated interval with the derived one, flipping
 * `source` to `'derived'`. This silences R9 (the KPI backing now exists in
 * usable form) and lets R6 conflict-check the canonical region.
 *
 * Promotion is best-effort and conservative. A requirement is left untouched
 * (and therefore still governed by R9) whenever it cannot be promoted safely:
 *   - not `source: 'stated'`, or not exactly one constrained variable
 *   - no `kpi.expr` or no `criterion`
 *   - the expression contains a function call (e.g. `fov_width(x)`) — opaque,
 *     not invertible in closed form
 *   - the expression references an identifier that is neither the variable nor a
 *     numeric fact path
 *   - `kpi(x)` is not strictly monotonic over the domain
 *   - the satisfying region over the domain is empty
 *
 * @module context/AdmissiblePromotion
 */

/** Thrown internally when an expression cannot be promoted; caught per-requirement. */
class NotPromotable extends Error {}

const SAMPLES = 1024 // domain sampling resolution for monotonicity + boundary search

/**
 * Promote every promotable `stated` requirement to `derived`.
 *
 * @param {Map<string, object>} requirements — ref → Requirement
 * @param {Map<string, object>} variables    — ref → Variable (carries `domain`)
 * @param {Map<string, object>} facts         — ref → Fact (for numeric fact paths)
 * @returns {{ requirements: Map<string, object>, promoted: string[] }}
 *          a new Map (promoted entries cloned) and the sorted list of promoted refs
 */
export function promoteAdmissible(requirements, variables, facts) {
  const out = new Map()
  const promoted = []

  for (const [ref, req] of requirements) {
    const derived = tryPromote(req, variables, facts)
    if (derived) {
      out.set(ref, derived)
      promoted.push(ref)
    } else {
      out.set(ref, req)
    }
  }

  return { requirements: out, promoted: promoted.sort() }
}

/** @returns {object|null} a cloned, promoted requirement, or null if not promotable. */
function tryPromote(req, variables, facts) {
  if (req.admissible?.source !== 'stated') return null
  if ((req.constrains ?? []).length !== 1) return null
  if (!req.kpi?.expr || !req.criterion) return null

  const variable = variables.get(req.constrains[0])
  const domain = variable?.domain
  if (!Array.isArray(domain) || domain.length !== 2) return null
  const [a, b] = domain
  if (!(a < b)) return null

  // The compiled expression is lazy: a function call (`fov_width(x)`) or a
  // non-numeric fact path only surfaces as NotPromotable when kpi(x) is first
  // evaluated inside invertCriterion — so the catch must wrap both steps.
  let interval
  try {
    const kpi = compileMonotoneExpr(req.kpi.expr, req.constrains[0], facts)
    interval = invertCriterion(kpi, req.criterion, a, b)
  } catch (e) {
    if (e instanceof NotPromotable) return null
    throw e
  }
  if (!interval) return null

  return {
    ...req,
    admissible: {
      ...req.admissible,
      interval,
      source: 'derived',
      promotedFrom: 'stated',
    },
  }
}

/**
 * Compile `expr` into a numeric function of the single free variable `varRef`.
 * Identifiers other than `varRef` are resolved as numeric fact paths. A function
 * call (`ident(`) or a non-numeric / missing identifier throws NotPromotable.
 *
 * @returns {(x: number) => number}
 */
function compileMonotoneExpr(source, varRef, facts) {
  const tokens = tokenize(source)

  return (x) => {
    let pos = 0
    const peek = () => tokens[pos]
    const next = () => tokens[pos++]

    function expr() {
      let value = term()
      while (peek() === '+' || peek() === '-') {
        const op = next()
        const rhs = term()
        value = op === '+' ? value + rhs : value - rhs
      }
      return value
    }
    function term() {
      let value = factor()
      while (peek() === '*' || peek() === '/') {
        const op = next()
        const rhs = factor()
        value = op === '*' ? value * rhs : value / rhs
      }
      return value
    }
    function factor() {
      const token = next()
      if (token === undefined) throw new NotPromotable(`unexpected end of "${source}"`)
      if (token === '(') {
        const value = expr()
        if (next() !== ')') throw new NotPromotable(`missing ")" in "${source}"`)
        return value
      }
      if (token === '-') return -factor()
      if (typeof token === 'number') return token
      // identifier: a function call is opaque and not invertible
      if (peek() === '(') throw new NotPromotable(`"${token}(" is a function call — not invertible`)
      if (token === varRef) return x
      return numericFact(token, facts)
    }

    const value = expr()
    if (pos !== tokens.length) throw new NotPromotable(`unexpected token "${tokens[pos]}" in "${source}"`)
    return value
  }
}

/** Resolve a dotted fact path to a finite number, or throw NotPromotable. */
function numericFact(path, facts) {
  const [factRef, ...rest] = path.split('.')
  let node = facts.get(factRef)
  for (const seg of rest) {
    if (node == null || typeof node !== 'object') { node = undefined; break }
    node = node[seg]
  }
  if (typeof node !== 'number' || !Number.isFinite(node)) {
    throw new NotPromotable(`"${path}" does not resolve to a numeric fact value`)
  }
  return node
}

/**
 * Numerically invert `criterion(kpi(x))` over [a, b]. Requires `kpi` strictly
 * monotonic on the domain (else returns null). Returns the satisfying sub-interval
 * `[lo, hi]` (lo < hi), refined at its boundaries by bisection, or null if the
 * region is empty or degenerate.
 *
 * @returns {[number, number]|null}
 */
function invertCriterion(kpi, criterion, a, b) {
  const xs = []
  const ys = []
  for (let i = 0; i <= SAMPLES; i++) {
    const x = a + ((b - a) * i) / SAMPLES
    const y = kpi(x)
    if (Number.isNaN(y)) return null
    xs.push(x)
    ys.push(y)
  }

  // strict monotonicity over the sampled domain
  let dir = 0
  for (let i = 1; i < ys.length; i++) {
    const d = Math.sign(ys[i] - ys[i - 1])
    if (d === 0) return null
    if (dir === 0) dir = d
    else if (d !== dir) return null
  }

  const pred = makePredicate(criterion)
  const ok = ys.map(pred)

  let start = ok.indexOf(true)
  if (start === -1) return null // unsatisfiable over the domain
  let end = ok.lastIndexOf(true)

  // refine boundaries via bisection on the predicate crossing
  const lo = start === 0 ? a : bisectBoundary(kpi, pred, xs[start - 1], xs[start])
  const hi = end === SAMPLES ? b : bisectBoundary(kpi, pred, xs[end + 1], xs[end])

  const loR = round(Math.min(lo, hi))
  const hiR = round(Math.max(lo, hi))
  if (!(loR < hiR)) return null
  return [loR, hiR]
}

/** Build x → boolean from a {op, value} criterion. */
function makePredicate({ op, value }) {
  switch (op) {
    case '>=': return (y) => y >= value
    case '>':  return (y) => y >  value
    case '<=': return (y) => y <= value
    case '<':  return (y) => y <  value
    case '==': return (y) => y === value
    default:   throw new NotPromotable(`unsupported criterion op "${op}"`)
  }
}

/**
 * Bisect between a known-false point `xFalse` and known-true point `xTrue`
 * (predicate over kpi(x)) to locate the boundary; returns the last point that
 * still satisfies the predicate.
 */
function bisectBoundary(kpi, pred, xFalse, xTrue) {
  for (let i = 0; i < 50; i++) {
    const mid = (xFalse + xTrue) / 2
    if (pred(kpi(mid))) xTrue = mid
    else xFalse = mid
  }
  return xTrue
}

/** Round to a stable precision so derived intervals are deterministic and clean. */
function round(n) {
  return Math.round(n * 1e6) / 1e6
}

/** Same token grammar as ContextCompiler: NUMBER | IDENT_PATH | + - * / ( ). */
function tokenize(source) {
  const tokens = []
  const re = /\s*(\d+\.?\d*|[A-Za-z_][\w.]*|[+\-*/()])/y
  let lastIndex = 0
  while (lastIndex < source.length) {
    re.lastIndex = lastIndex
    const match = re.exec(source)
    if (!match) throw new NotPromotable(`invalid character at position ${lastIndex} in "${source}"`)
    const raw = match[1]
    tokens.push(/^\d/.test(raw) ? Number(raw) : raw)
    lastIndex = re.lastIndex
  }
  return tokens
}
