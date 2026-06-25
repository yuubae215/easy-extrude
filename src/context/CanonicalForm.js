/**
 * CanonicalForm — the computable structural isomorphism on the synonym quotient
 * (ADR-056).
 *
 * Pure computation: input-immutable, no I/O, no THREE/DOM — loads under bare
 * `node --test` (PHILOSOPHY #3/#6). Adds **no new doc field** (the ProvenanceTree
 * precedent: synthesise, never persist — the signature is composed, not stored).
 *
 * ADR-052 *declared* Mutual as a "structural isomorphism on the synonym quotient",
 * but that isomorphism was never **computed** — it was only observed anecdotally in
 * golden tests. ADR-055 made the geometry side computable as the *scene fixpoint*.
 * This module generalises that to the **doc layer** (the 5W1H Why-tree): it maps a
 * canonical Context doc to its quotient-labelled 5W1H graph and computes a
 * **ref-name- and order-invariant normal-form signature** by colour refinement
 * (Weisfeiler–Leman). Two docs from different authors (NL-authored vs scene/geometry
 * derived) carry **different `ref` strings**, so the normal form cannot key on `ref`.
 *
 * It depends ONLY on `buildWhyTree` (ProvenanceTree) for the structure and
 * `canonicalKey` / `operatorSymbol` (SynonymQuotient) for the quotient labels.
 *
 * Four operations sit on top of the signature (ADR-056 §2.3) — the finalized
 * **output forms** of the deterministic core:
 *   - `canonicalForm(ctx)` — the finalized, **JSON-serializable, versioned** normal
 *     form: `{version, docSignature, rootSignature, roots, nodes}` with per-node WL
 *     colours. This is the stable machine-contract output (no `Map`, no internal
 *     `ProvenanceTree` `data`/`label`/id leakage). `canonicalSignature` stays the
 *     internal `Map`-based primitive that `structuralDiff`/`reconcile` build on.
 *   - `verify(a, b)` — the round-trip / equivalence check (ADR §2.3 *verify*):
 *     `equal` ⇔ `docSignature(a) === docSignature(b)`, i.e. a and b are structurally
 *     isomorphic **on the quotient** (WL-equivalent — §2.2 honest note: WL-equiv
 *     ⊋ isomorphism in general, but the target is a small rooted near-tree DAG so
 *     it is effectively exact; we claim "normal form up to WL", not a full
 *     canonical form — PHILOSOPHY #28).
 *   - `structuralDiff(a, b)` — colour-aligned, per-layer typed added/removed/changed.
 *   - `reconcile(a, b)` — maximum matching between same-colour nodes → `refA ↔ refB`,
 *     the deterministic seam that stitches two different input faces (the geometry⇄NL
 *     recommender alignment base).
 *
 * Scope boundary (ADR-056 §3): this is the **deterministic core** — the curated
 * quotient + the normal form + diff + exact-colour reconcile *decide* equivalence.
 * Disambiguating terms the quotient cannot resolve (embedding / corpus / similarity
 * ranking) is **out of scope** — that is a *proposal* layer for an external service,
 * never part of this decision.
 *
 * @module context/CanonicalForm
 */

import { buildWhyTree, PROVENANCE_LAYERS } from './ProvenanceTree.js'
import { canonicalKey, operatorSymbol } from './SynonymQuotient.js'

/**
 * Fixed Weisfeiler–Leman refinement depth (the WL-subtree kernel hyper-parameter
 * h). A node's colour after exactly `WL_ROUNDS` rounds is the hash of its depth-h
 * unrolled neighbourhood, which makes colours **comparable across two different
 * docs** (the requirement of reconcile/diff): a node with the same local structure
 * gets the same colour regardless of the rest of the graph. The count MUST be a
 * constant for every call — running a doc-dependent number of rounds (e.g. "until
 * the partition is stable") makes a sink node hashed a different number of times in
 * two docs, so its colour stops being comparable. 16 ≫ the diameter of the small
 * rooted near-tree DAGs this targets (§2.2), so it is fully refined in practice.
 */
const WL_ROUNDS = 16

/**
 * Version stamp of the finalized `canonicalForm` output contract (the machine
 * contract the deterministic core publishes). House style mirrors the other
 * versioned contracts in the repo (`context/0.4`, `layout/1.0`); a breaking
 * change to the `canonicalForm` shape or the signature scheme bumps this.
 */
export const CANONICAL_FORM_VERSION = 'canonical-form/1.0'

/**
 * Compute the colour-refinement (Weisfeiler–Leman) normal-form signature of a
 * context document. This is the **internal primitive** — `structuralDiff` /
 * `reconcile` consume the `Map`-based `colorOf` and the raw `nodes` directly. For
 * the finalized, JSON-serializable output use `canonicalForm` instead.
 *
 * @param {object} ctx — Context DSL object
 * @returns {{
 *   docSignature: string,                 // sorted-multiset signature over all nodes
 *   rootSignature: string,                // sorted-multiset signature over the Why roots
 *   colorOf: Map<string,string>,          // nodeId → stable WL colour
 *   nodes: Array<object>,                 // the underlying ProvenanceTree nodes
 *   roots: string[],                      // Why-root node ids (the Why apexes)
 * }}
 */
export function canonicalSignature(ctx) {
  const { nodes, edges, roots } = buildWhyTree(ctx)

  // Up-adjacency (derived→source): every ProvenanceTree edge is already an up-edge.
  /** @type {Map<string, Array<{to:string, rel:string}>>} */
  const adj = new Map()
  for (const n of nodes) adj.set(n.id, [])
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, [])
    adj.get(e.from).push({ to: e.to, rel: relationLabel(e.relation) })
  }

  // Initial colour c0(n) = hash( canonicalKey(kind), identityPayload(n) ).
  let color = new Map()
  for (const n of nodes) {
    color.set(n.id, _hash(_stable([kindLabel(n.kind), identityPayload(n)])))
  }

  // Refine for a FIXED number of rounds (a constant for every doc) so colours
  // encode only depth-h local structure and stay comparable across docs. An
  // early stop on partition stability would run a doc-dependent round count and
  // break cross-doc colour comparison (see WL_ROUNDS).
  for (let iter = 0; iter < WL_ROUNDS; iter++) {
    const next = new Map()
    for (const n of nodes) {
      const neigh = (adj.get(n.id) ?? [])
        .map(({ to, rel }) => [rel, color.get(to)])
        .sort(_tupleCompare)
      next.set(n.id, _hash(_stable([color.get(n.id), neigh])))
    }
    color = next
  }

  const docSignature = _hash([...color.values()].sort().join('|'))
  const rootColors = roots.map(id => color.get(id)).filter(Boolean).sort()
  const rootSignature = _hash(rootColors.join('|'))

  return { docSignature, rootSignature, colorOf: color, nodes, roots }
}

/**
 * The finalized canonical-form output (ADR-056 §2.4) — a versioned,
 * JSON-serializable normal form. Unlike `canonicalSignature` it carries no `Map`
 * and no internal `ProvenanceTree` `data`/`label`/id; node identity is the
 * doc-meaningful `(kind, ref)` pair (unique by construction). This is the stable
 * machine contract a consumer (or the future external recommender lane) reads.
 *
 * @param {object} ctx — Context DSL object
 * @returns {{
 *   version: string,
 *   docSignature: string,
 *   rootSignature: string,
 *   roots: Array<{ref:string, kind:string, color:string}>,   // Why apexes, sorted by ref
 *   nodes: Array<{ref:string, kind:string, layer:string, color:string}>,
 * }}
 */
export function canonicalForm(ctx) {
  const sig = canonicalSignature(ctx)
  const byId = new Map(sig.nodes.map(n => [n.id, n]))
  const roots = sig.roots
    .map(id => byId.get(id))
    .filter(Boolean)
    .map(n => ({ ref: n.ref, kind: n.kind, color: sig.colorOf.get(n.id) }))
    .sort(_byRef)
  return {
    version: CANONICAL_FORM_VERSION,
    docSignature: sig.docSignature,
    rootSignature: sig.rootSignature,
    roots,
    nodes: _serializableNodes(sig),
  }
}

/**
 * Verify two docs are structurally isomorphic on the quotient (ADR-056 §2.3
 * *verify*). The primary invariant is `equal` = `docSignature(a) ===
 * docSignature(b)` — the computable form of the ADR-052 Mutual round-trip
 * (`docSignature(φ(NL)) === docSignature(structural-recovery)`). When `equal` is
 * false, `structuralDiff(a, b)` explains *what* differs.
 *
 * @param {object} a — Context DSL object
 * @param {object} b — Context DSL object
 * @returns {{
 *   equal: boolean,
 *   rootEqual: boolean,
 *   docSignature: { a: string, b: string },
 *   rootSignature: { a: string, b: string },
 * }}
 */
export function verify(a, b) {
  const sa = canonicalSignature(a)
  const sb = canonicalSignature(b)
  return {
    equal: sa.docSignature === sb.docSignature,
    rootEqual: sa.rootSignature === sb.rootSignature,
    docSignature: { a: sa.docSignature, b: sb.docSignature },
    rootSignature: { a: sa.rootSignature, b: sb.rootSignature },
  }
}

/** Layer sort order for deterministic serialisation (Why → How → What). */
const _LAYER_ORDER = Object.fromEntries(PROVENANCE_LAYERS.map((l, i) => [l, i]))

/**
 * Project a `canonicalSignature` result into the serializable per-node array
 * `{ref, kind, layer, color}`, deterministically ordered by (layer, colour, ref).
 */
function _serializableNodes(sig) {
  return sig.nodes
    .map(n => ({ ref: n.ref, kind: n.kind, layer: n.layer, color: sig.colorOf.get(n.id) }))
    .sort((a, b) =>
      (_LAYER_ORDER[a.layer] - _LAYER_ORDER[b.layer]) ||
      a.color.localeCompare(b.color) ||
      a.ref.localeCompare(b.ref))
}

/**
 * Colour-aligned structural diff between two docs, grouped by 5W1H layer.
 *
 * Nodes are aligned by their refinement colour: a colour present on both sides is
 * an unchanged match (not reported). Of the leftovers, a node whose `id` exists on
 * both sides with a *different* colour is `changed`; otherwise it is `removed`
 * (a-only) or `added` (b-only). Pairing the `changed` set by `id` is the
 * version-to-version key (reconcile is the cross-author, colour-only complement).
 *
 * @param {object} a — Context DSL object (the "before"/left doc)
 * @param {object} b — Context DSL object (the "after"/right doc)
 * @returns {{ why: object, how: object, what: object }} each layer is
 *   `{ added: Item[], removed: Item[], changed: ChangedItem[] }` where
 *   `Item = {ref, kind, color}` and `ChangedItem = {ref, kind, fromColor, toColor}`.
 */
export function structuralDiff(a, b) {
  const sa = canonicalSignature(a)
  const sb = canonicalSignature(b)
  const out = {}

  for (const layer of PROVENANCE_LAYERS) {
    const aNodes = sa.nodes.filter(n => n.layer === layer)
    const bNodes = sb.nodes.filter(n => n.layer === layer)

    // Greedy colour match: each matched pair is unchanged and dropped.
    const bByColor = new Map()
    for (const n of bNodes) {
      const c = sb.colorOf.get(n.id)
      if (!bByColor.has(c)) bByColor.set(c, [])
      bByColor.get(c).push(n)
    }
    const leftoverA = []
    for (const n of aNodes) {
      const queue = bByColor.get(sa.colorOf.get(n.id))
      if (queue && queue.length) queue.shift()
      else leftoverA.push(n)
    }
    const leftoverB = [].concat(...[...bByColor.values()])

    // Of the leftovers, same-id-different-colour ⇒ changed; else removed/added.
    const bById = new Map(leftoverB.map(n => [n.id, n]))
    const usedB = new Set()
    const changed = []
    const removed = []
    for (const n of leftoverA) {
      const peer = bById.get(n.id)
      if (peer) {
        usedB.add(peer.id)
        changed.push({
          ref: n.ref, kind: n.kind,
          fromColor: sa.colorOf.get(n.id), toColor: sb.colorOf.get(peer.id),
        })
      } else {
        removed.push({ ref: n.ref, kind: n.kind, color: sa.colorOf.get(n.id) })
      }
    }
    const added = leftoverB
      .filter(n => !usedB.has(n.id))
      .map(n => ({ ref: n.ref, kind: n.kind, color: sb.colorOf.get(n.id) }))

    out[layer] = {
      added:   added.sort(_byRef),
      removed: removed.sort(_byRef),
      changed: changed.sort(_byRef),
    }
  }
  return out
}

/**
 * Reconcile two docs by maximum matching between same-colour nodes — the
 * deterministic `refA ↔ refB` correspondence that stitches two different input
 * faces (NL-derived vs scene/geometry-derived). Within a colour class the nodes
 * are structurally indistinguishable, so any pairing is valid; we pair by sorted
 * `ref` for determinism.
 *
 * @param {object} a — Context DSL object
 * @param {object} b — Context DSL object
 * @returns {{
 *   pairs: Array<{refA:string, refB:string, color:string, layer:string}>,
 *   unmatchedA: Array<{ref:string, kind:string, color:string, layer:string}>,
 *   unmatchedB: Array<{ref:string, kind:string, color:string, layer:string}>,
 * }}
 */
export function reconcile(a, b) {
  const sa = canonicalSignature(a)
  const sb = canonicalSignature(b)

  const groupByColor = (sig) => {
    const m = new Map()
    for (const n of sig.nodes) {
      const c = sig.colorOf.get(n.id)
      if (!m.has(c)) m.set(c, [])
      m.get(c).push(n)
    }
    return m
  }
  const aByColor = groupByColor(sa)
  const bByColor = groupByColor(sb)

  const pairs = []
  const unmatchedA = []
  const unmatchedB = []

  const colors = new Set([...aByColor.keys(), ...bByColor.keys()])
  for (const c of colors) {
    const aList = (aByColor.get(c) ?? []).slice().sort(_byRef)
    const bList = (bByColor.get(c) ?? []).slice().sort(_byRef)
    const k = Math.min(aList.length, bList.length)
    for (let i = 0; i < k; i++) {
      pairs.push({ refA: aList[i].ref, refB: bList[i].ref, color: c, layer: aList[i].layer })
    }
    for (let i = k; i < aList.length; i++) {
      unmatchedA.push({ ref: aList[i].ref, kind: aList[i].kind, color: c, layer: aList[i].layer })
    }
    for (let i = k; i < bList.length; i++) {
      unmatchedB.push({ ref: bList[i].ref, kind: bList[i].kind, color: c, layer: bList[i].layer })
    }
  }

  return {
    pairs: pairs.sort((x, y) => x.refA.localeCompare(y.refA) || x.refB.localeCompare(y.refB)),
    unmatchedA: unmatchedA.sort(_byRef),
    unmatchedB: unmatchedB.sort(_byRef),
  }
}

// ── Quotient labelling (deterministic, curated dictionary only — §2.1) ────────

/** Canonical label for a node kind; verbatim when the kind is outside the quotient. */
function kindLabel(kind) {
  return canonicalKey(kind) ?? String(kind ?? '')
}

/** Canonical label for an edge relation; verbatim when outside the quotient. */
function relationLabel(relation) {
  return canonicalKey(relation) ?? String(relation ?? '')
}

/**
 * The node's *identity payload* — only the canonical scalars that belong to its
 * identity (§2.2): a criterion's `op` (folded through the quotient) + `value`, and
 * a requirement KPI's normalised `expr` + `unit`. Label strings and standalone
 * domain nouns are deliberately excluded (they live outside the quotient), so the
 * signature stays invariant under `ref` renaming and author choice of names.
 *
 * @param {object} node — a ProvenanceTree node
 * @returns {object}
 */
function identityPayload(node) {
  const d = node?.data ?? {}
  const out = {}
  const crit = d.criterion
  if (crit && typeof crit === 'object') {
    out.op = canonicalKey(crit.op) ?? operatorSymbol(crit.op)
    if (crit.value !== undefined) out.value = crit.value
  }
  if (d.kpi && typeof d.kpi === 'object') {
    if (d.kpi.expr != null) out.expr = _normExpr(d.kpi.expr)
    if (d.kpi.unit != null) out.unit = String(d.kpi.unit)
  }
  return out
}

/**
 * Normalise a KPI expression to its ref-invariant *shape*: every identifier / ref
 * path (a domain noun — outside the quotient, §2.1) collapses to a single `_`
 * placeholder, while operators, parentheses and numeric constants are preserved.
 * So `f_camera.attrs.sensor_px_h / fov_width(v_standoff)` → `_/_(_)`. This keeps
 * the expression's arithmetic structure in the node's identity without letting a
 * `ref` rename leak into the signature (the §2.2 ref-invariance property).
 */
function _normExpr(expr) {
  return String(expr)
    .replace(/[A-Za-z_$][\w$.]*/g, '_')
    .replace(/\s+/g, '')
    .toLowerCase()
}

// ── Pure helpers (deterministic serialisation, hashing, ordering) ─────────────

/** Deterministic JSON serialisation with sorted object keys (arrays kept in order). */
function _stable(value) {
  if (Array.isArray(value)) return `[${value.map(_stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort()
      .map(k => `${JSON.stringify(k)}:${_stable(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** FNV-1a 32-bit hash → base36. Deterministic, Unicode-safe, no imports. */
function _hash(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/** Compare `[rel, color]` tuples lexicographically. */
function _tupleCompare(x, y) {
  return x[0].localeCompare(y[0]) || x[1].localeCompare(y[1])
}

/** Order typed diff/reconcile items by `ref`. */
function _byRef(x, y) {
  return x.ref.localeCompare(y.ref)
}
