/**
 * ProvenanceTree — the Why-rooted 5W1H tree and φ⁻¹ provenance recovery
 * (ADR-052).
 *
 * Pure computation: no I/O, no Three.js, no DOM. (PHILOSOPHY #3) Input-immutable
 * — the document is read, never mutated. Loads under bare `node --test`.
 *
 * ADR-052 establishes that the canonical Context DSL document IS a Why-rooted
 * 5W1H tree: Why (KPI / criterion / measured-vs-target Gap / Acceptance / Intent)
 * at the top, How (decisions / obligations / constraints) in the middle, What
 * (entities / facts / variables) at the leaves. The 3D scene is a *What/How
 * projection* that drops the Why (ADR-049 invariant 9) — so from the scene alone
 * you cannot recover why a placement exists.
 *
 * This module adds **no new data structure** to the document. It synthesises the
 * already-scattered fields (`intents[].parent`, `requirements[].kpi/criterion/
 * constrains`, `decisions[].resolves/relaxes`, `obligations[].dependsOn`,
 * `acceptance[].requires`, `specification.trace[]`, and the `$fact`/`$decision`
 * markers inside `specification.layout`) into a single typed node + edge graph,
 * with every edge oriented from the more-derived node (What-ward) toward its
 * source (Why-ward). Climbing those edges from a scene entity recovers its Why
 * provenance — the φ⁻¹ "macro recording for context" generalisation of ADR-044
 * §φ⁻¹ (CommandStack → ExecutionPlan) to the whole document.
 *
 * Mutual (ADR-052 §2.2): φ : NL → doc is a many-to-one homomorphism (ADR-044);
 * φ⁻¹ discards surface synonyms but recovers the 5W1H tree completely *as long as
 * the doc retains it*. `recoverProvenance` is the mechanical witness of that
 * recovery on the data side.
 *
 * @module context/ProvenanceTree
 */

import { CONFLICT_REF_PREFIX, CLUSTER_REF_PREFIX } from './ContextDslSchema.js'

/** The three 5W1H layers, in Why→What order (ADR-052 §2.1). */
export const PROVENANCE_LAYERS = ['why', 'how', 'what']

const LAYER_BY_KIND = {
  intent:      'why',
  requirement: 'why',
  acceptance:  'why',
  decision:    'how',
  obligation:  'how',
  constraint:  'how',
  entity:      'what',
  fact:        'what',
  variable:    'what',
  ref:         'what', // an unclassifiable trace source (defensive)
}

/**
 * Build the Why-rooted 5W1H tree for a context document.
 *
 * @param {object} ctx — Context DSL object (context/0.1 – 0.3)
 * @returns {{
 *   nodes: Array<{id:string, layer:string, kind:string, ref:string, label:string, data:object}>,
 *   edges: Array<{from:string, to:string, relation:string}>,
 *   roots: string[],
 * }} `nodes` are deterministically ordered (Why → How → What, then by id);
 *    `edges` point from the derived node toward its source (toward Why); `roots`
 *    are the Why-layer node ids that nothing climbs above (the Why apexes).
 */
export function buildWhyTree(ctx) {
  const g = new ProvenanceGraph(ctx)
  return { nodes: g.nodeList(), edges: g.edgeList(), roots: g.whyRoots() }
}

/**
 * φ⁻¹ — recover the Why provenance of a derived scene entity.
 *
 * Walks the up-edges (toward Why) from the given layout entity ref, collecting
 * every reachable node and grouping it by 5W1H layer. The Why fields the UI
 * cares about — KPIs, criteria, the variables a requirement constrains, and the
 * Intents reached — are surfaced as convenience arrays. The measured-vs-target
 * **Gap** itself is a validator output (R6, `validateContext().conflicts` keyed
 * by `conflict_<variable>`); this function returns the constrained `variables`
 * so the caller can join the gap in without ProvenanceTree re-implementing R6.
 *
 * @param {object} ctx — Context DSL object
 * @param {string} entityRef — a layout entity ref (or a "constraint:a→b" ref)
 * @returns {{
 *   entityRef:string, found:boolean,
 *   node: object|null,
 *   chain: string[],                       // reached node ids, BFS order (toward Why)
 *   why: object[], how: object[], what: object[],
 *   variables: string[],
 *   kpis: Array<{requirement:string, name:string, expr:string, unit:string, criterion:object}>,
 *   intents: string[],
 * }}
 */
export function recoverProvenance(ctx, entityRef) {
  const g = new ProvenanceGraph(ctx)
  const startId = g.entityNodeId(entityRef)
  const startNode = g.get(startId) ?? null

  const empty = {
    entityRef, found: startNode !== null, node: startNode,
    chain: [], why: [], how: [], what: [],
    variables: [], kpis: [], intents: [],
  }
  if (!startNode) return empty

  // BFS up the derived→source edges. Deterministic: neighbours are pre-sorted.
  const visited = new Set([startId])
  const chain = []
  const queue = [startId]
  while (queue.length) {
    const id = queue.shift()
    for (const to of g.upNeighbours(id)) {
      if (visited.has(to)) continue
      visited.add(to)
      chain.push(to)
      queue.push(to)
    }
  }

  const reached = chain.map(id => g.get(id)).filter(Boolean)
  const why  = reached.filter(n => n.layer === 'why')
  const how  = reached.filter(n => n.layer === 'how')
  const what = reached.filter(n => n.layer === 'what')

  // Why convenience: KPIs + each requirement's constrained variables + intents.
  const variables = new Set()
  const kpis = []
  const intents = []
  for (const n of why) {
    if (n.kind === 'requirement') {
      for (const v of n.data.constrains ?? []) variables.add(v)
      if (n.data.kpi) {
        kpis.push({
          requirement: n.ref,
          name:        n.data.kpi.name ?? '',
          expr:        n.data.kpi.expr ?? '',
          unit:        n.data.kpi.unit ?? '',
          criterion:   n.data.criterion ?? null,
        })
      }
    } else if (n.kind === 'intent') {
      intents.push(n.ref)
    }
  }
  // Variables reached directly as nodes (e.g. via a decision's `resolves`).
  for (const n of what) if (n.kind === 'variable') variables.add(n.ref)

  return {
    entityRef, found: true, node: startNode,
    chain, why, how, what,
    variables: [...variables].sort(),
    kpis,
    intents,
  }
}

// ── Internal graph builder (pure; owns only its own maps) ─────────────────────

class ProvenanceGraph {
  /** @param {object} ctx */
  constructor(ctx) {
    /** @type {Map<string, object>} id → node */
    this._nodes = new Map()
    /** @type {Array<{from:string,to:string,relation:string}>} */
    this._edges = []
    /** @type {Map<string, Set<string>>} id → set of derived→source neighbour ids */
    this._up = new Map()

    // Ref → kind membership, so a bare trace `from`/`resolves` ref can be typed.
    this._kindOf = new Map()
    const register = (arr, kind) => {
      for (const item of arr ?? []) if (item?.ref) this._kindOf.set(item.ref, kind)
    }
    register(ctx?.intents,      'intent')
    register(ctx?.requirements, 'requirement')
    register(ctx?.acceptance,   'acceptance')
    register(ctx?.decisions,    'decision')
    register(ctx?.obligations,  'obligation')
    register(ctx?.given,        'fact')
    register(ctx?.variables,    'variable')

    this._build(ctx)
  }

  // -- public reads -----------------------------------------------------------

  get(id)            { return this._nodes.get(id) }
  upNeighbours(id)   { return [...(this._up.get(id) ?? [])].sort() }
  entityNodeId(ref)  { return ref.startsWith('constraint:') ? ref : `entity:${ref}` }

  nodeList() {
    const order = { why: 0, how: 1, what: 2 }
    return [...this._nodes.values()].sort(
      (a, b) => (order[a.layer] - order[b.layer]) || a.id.localeCompare(b.id),
    )
  }

  edgeList() {
    return [...this._edges].sort(
      (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) ||
                a.relation.localeCompare(b.relation),
    )
  }

  /** Why-layer nodes that are never the `from` of an up-edge (nothing above). */
  whyRoots() {
    const hasParent = new Set(this._edges.map(e => e.from))
    return [...this._nodes.values()]
      .filter(n => n.layer === 'why' && !hasParent.has(n.id))
      .map(n => n.id)
      .sort()
  }

  // -- construction -----------------------------------------------------------

  _ensure(id, kind, ref, label, data) {
    let node = this._nodes.get(id)
    if (!node) {
      node = { id, layer: LAYER_BY_KIND[kind] ?? 'what', kind, ref, label: label ?? ref, data: data ?? {} }
      this._nodes.set(id, node)
    } else if (data && Object.keys(node.data).length === 0) {
      node.data = data
      if (label) node.label = label
    }
    return node
  }

  _edge(fromId, toId, relation) {
    if (fromId === toId) return
    this._edges.push({ from: fromId, to: toId, relation })
    if (!this._up.has(fromId)) this._up.set(fromId, new Set())
    this._up.get(fromId).add(toId)
  }

  /** Resolve a bare doc ref to its node id, registering the node if needed. */
  _refNodeId(ref) {
    const kind = this._kindOf.get(ref) ?? 'ref'
    const id = `${kind}:${ref}`
    this._ensure(id, kind, ref)
    return id
  }

  _build(ctx) {
    if (!ctx || typeof ctx !== 'object') return

    // Why nodes ---------------------------------------------------------------
    for (const i of ctx.intents ?? []) {
      this._ensure(`intent:${i.ref}`, 'intent', i.ref, i.summary ?? i.verb ?? i.ref, i)
    }
    for (const i of ctx.intents ?? []) {
      if (i.parent) this._edge(`intent:${i.ref}`, `intent:${i.parent}`, 'refines')
    }
    for (const r of ctx.requirements ?? []) {
      this._ensure(`requirement:${r.ref}`, 'requirement', r.ref, r.kpi?.name ?? r.ref, r)
    }
    for (const a of ctx.acceptance ?? []) {
      this._ensure(`acceptance:${a.ref}`, 'acceptance', a.ref,
        typeof a.predicate === 'string' ? a.predicate : a.ref, a)
      for (const req of a.requires ?? []) {
        const factRef = String(req).split('.')[0]
        // The fact is a What precondition; climbing from it reaches the Acceptance.
        this._edge(this._refNodeId(factRef), `acceptance:${a.ref}`, 'required-by')
      }
    }

    // What nodes --------------------------------------------------------------
    for (const f of ctx.given ?? []) {
      this._ensure(`fact:${f.ref}`, 'fact', f.ref, f.subject ?? f.ref, f)
    }
    for (const v of ctx.variables ?? []) {
      this._ensure(`variable:${v.ref}`, 'variable', v.ref, v.description ?? v.ref, v)
    }

    // variable → requirement (a variable is constrained by its requirements) --
    for (const r of ctx.requirements ?? []) {
      for (const v of r.constrains ?? []) {
        this._edge(this._refNodeId(v), `requirement:${r.ref}`, 'constrained-by')
      }
    }

    // How nodes ---------------------------------------------------------------
    for (const o of ctx.obligations ?? []) {
      this._ensure(`obligation:${o.ref}`, 'obligation', o.ref, o.deliverable ?? o.ref, o)
      for (const dep of o.dependsOn ?? []) {
        this._edge(`obligation:${o.ref}`, this._refNodeId(dep), 'dependsOn')
      }
    }
    for (const d of ctx.decisions ?? []) {
      this._ensure(`decision:${d.ref}`, 'decision', d.ref, d.rationale ?? d.ref, d)
      // A Decision exists to relax a requirement and/or resolve a conflict /
      // negotiation cluster / fact / variable — climb to all of those.
      if (d.relaxes?.requirement) {
        this._edge(`decision:${d.ref}`, this._refNodeId(d.relaxes.requirement), 'relaxes')
      }
      for (const target of resolveTargets(d)) {
        // `variable` targets are known variable refs (from conflict_/nc_/nominals);
        // `ref` targets are plain refs whose kind we look up (fact or variable).
        if (target.variable) {
          this._ensure(`variable:${target.variable}`, 'variable', target.variable)
          this._edge(`decision:${d.ref}`, `variable:${target.variable}`, 'resolves-variable')
        } else {
          this._edge(`decision:${d.ref}`, this._refNodeId(target.ref), 'resolves')
        }
      }
    }

    // Layout entities + constraints (What / How) and their trace + markers ----
    const layout = ctx.specification?.layout ?? {}
    for (const e of layout.entities ?? []) {
      this._ensure(`entity:${e.ref}`, 'entity', e.ref, e.name ?? e.ref, { type: e.type, name: e.name })
    }
    for (const c of layout.constraints ?? []) {
      const id = `constraint:${c.source}→${c.target}`
      this._ensure(id, 'constraint', id, `${c.source}→${c.target}`, c)
    }

    // TraceLinks: entity/constraint → source ref (toward Why) -----------------
    for (const t of ctx.specification?.trace ?? []) {
      const toId = this.entityNodeId(t.to)
      // Register the target if the layout walk did not (defensive — a trace may
      // reference a constraint not enumerated in layout.constraints).
      if (!this._nodes.has(toId)) {
        if (toId.startsWith('constraint:')) this._ensure(toId, 'constraint', toId, toId.slice('constraint:'.length))
        else this._ensure(toId, 'entity', t.to, t.to)
      }
      this._edge(toId, this._refNodeId(t.from), `trace:${t.kind}`)
    }

    // $fact / $decision markers inside specification.layout (entity → fact/decision)
    for (const e of layout.entities ?? []) {
      this._collectMarkers(e, `entity:${e.ref}`)
    }
    for (const c of layout.constraints ?? []) {
      this._collectMarkers(c, `constraint:${c.source}→${c.target}`)
    }
  }

  /**
   * Walk a layout node for `$fact` / `$decision` markers WITHOUT resolving their
   * values, so an unresolvable or incomplete doc never throws (cf. the resolving
   * `extractProvenance` in ContextCompiler). Each marker adds an entity→source
   * up-edge.
   */
  _collectMarkers(node, entityId) {
    if (Array.isArray(node)) {
      for (const item of node) this._collectMarkers(item, entityId)
      return
    }
    if (node === null || typeof node !== 'object') return

    const keys = Object.keys(node)
    if (keys.length === 1 && (keys[0] === '$fact' || keys[0] === '$decision' || keys[0] === '$expr')) {
      if (keys[0] === '$fact') {
        const factRef = String(node.$fact).split('.')[0]
        this._edge(entityId, this._refNodeId(factRef), 'marker:fact')
      } else if (keys[0] === '$decision') {
        this._edge(entityId, this._refNodeId(node.$decision), 'marker:decision')
      }
      // $expr references are arithmetic over fact paths; left unparsed (scaffold).
      return
    }
    for (const value of Object.values(node)) this._collectMarkers(value, entityId)
  }
}

/**
 * The node ids a Decision's `resolves` field points at. Handles the four shapes:
 * a `conflict_<var>` ref, an `nc_<v1+v2>` cluster ref, a plain fact/variable ref,
 * and an array of variable refs (the n-ary joint Decision).
 */
function resolveTargets(d) {
  const out = []
  const one = (r) => {
    if (typeof r !== 'string') return
    if (r.startsWith(CONFLICT_REF_PREFIX)) {
      out.push({ variable: r.slice(CONFLICT_REF_PREFIX.length) })
    } else if (r.startsWith(CLUSTER_REF_PREFIX)) {
      for (const v of r.slice(CLUSTER_REF_PREFIX.length).split('+')) out.push({ variable: v })
    } else {
      // a plain fact or variable ref — kind resolved by the caller via _refNodeId.
      out.push({ ref: r })
    }
  }
  if (Array.isArray(d.resolves)) d.resolves.forEach(one)
  else one(d.resolves)
  // resolves may also carry n-ary nominals{} whose keys are variable refs.
  for (const v of Object.keys(d.nominals ?? {})) out.push({ variable: v })
  return out
}
