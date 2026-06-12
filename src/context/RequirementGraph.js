/**
 * RequirementGraph — conflict detection (R6) and negotiation-cluster
 * extraction (R7) over the Requirement / Variable layer (ADR-049).
 *
 * Pure computation: no I/O, no Three.js, no DOM. (PHILOSOPHY #3)
 * Both outputs are deterministic for a given input (sorted refs, stable
 * naming) so they can be referenced from Decision.resolves and diffed
 * across baselines.
 *
 * Conflicts and NegotiationClusters are validator OUTPUTS — they are never
 * authored by humans (ADR-046 invariant 5 extended by ADR-049 invariant 7).
 *
 * @module context/RequirementGraph
 */

import { CONFLICT_REF_PREFIX, CLUSTER_REF_PREFIX } from './ContextDslSchema.js'

/**
 * R6 — per shared variable, intersect the admissible intervals of every
 * requirement that constrains exactly that one variable. An empty
 * intersection is a Conflict.
 *
 * Intervals follow the ADR-046 half-open convention [min, max): two
 * intervals that merely touch (e.g. [200,350] vs [350,600]) do NOT
 * intersect. In 1-D, intervals have the Helly property (joint emptiness
 * ⇔ some pair is disjoint), so one Conflict per variable is complete.
 *
 * Phase 1 scope: only requirements with `constrains.length === 1` and an
 * `admissible.interval` participate. Multi-variable requirements carry a
 * region, not an interval — they join R7 clustering but not R6 (Phase 3).
 *
 * @param {Map<string, object>} requirements — ref → Requirement
 * @returns {object[]} Conflict records:
 *   { ref, variable, between: string[], admissibleSets: {[ref]: [lo,hi]}, gap: [lo,hi] }
 */
export function detectConflicts(requirements) {
  const byVariable = new Map()

  for (const req of requirements.values()) {
    const constrains = req.constrains ?? []
    const interval   = req.admissible?.interval
    if (constrains.length !== 1 || !Array.isArray(interval)) continue

    const variable = constrains[0]
    if (!byVariable.has(variable)) byVariable.set(variable, [])
    byVariable.get(variable).push(req)
  }

  const conflicts = []
  for (const [variable, reqs] of byVariable) {
    if (reqs.length < 2) continue

    const lo = Math.max(...reqs.map(r => r.admissible.interval[0]))
    const hi = Math.min(...reqs.map(r => r.admissible.interval[1]))
    if (lo < hi) continue // non-empty intersection — no conflict

    const between = reqs.map(r => r.ref).sort()
    const admissibleSets = {}
    for (const ref of between) {
      admissibleSets[ref] = requirements.get(ref).admissible.interval
    }

    conflicts.push({
      ref: `${CONFLICT_REF_PREFIX}${variable}`,
      variable,
      between,
      admissibleSets,
      gap: [hi, lo], // the no-man's-land between the binding constraints
    })
  }

  return conflicts.sort((a, b) => a.ref.localeCompare(b.ref))
}

/**
 * R7 — extract negotiation clusters from the bipartite Requirement–Variable
 * graph (edges = `constrains`).
 *
 * If the graph is a forest, variables can be settled leaf-first by
 * independent Decisions (topological order = serialised meetings). An
 * alternating cycle (r₁–v₁–r₂–v₂–r₁ …) means no variable in it can be
 * fixed without re-opening another actor's negotiation — the structural
 * cause of endless review loops. R7 finds these as biconnected components
 * containing ≥2 requirements and ≥2 variables.
 *
 * A cluster is NOT an error (coupling is created by physics — ADR-049 §1
 * observation 3). The prescription: settle all of the cluster's variables
 * in ONE joint n-ary Decision (invariant 8). Same detect-and-prescribe
 * pattern as ADR-035 `_detectFastenedCycles()`.
 *
 * @param {Map<string, object>} requirements — ref → Requirement
 * @returns {object[]} NegotiationCluster records:
 *   { ref, requirements: string[], variables: string[], actors: string[] }
 */
export function detectNegotiationClusters(requirements) {
  // Build the undirected bipartite adjacency. Node ids are namespaced
  // ('r:' / 'v:') so a requirement and a variable may share a raw ref.
  const adjacency = new Map()
  const addEdge = (a, b) => {
    if (!adjacency.has(a)) adjacency.set(a, [])
    if (!adjacency.has(b)) adjacency.set(b, [])
    adjacency.get(a).push(b)
    adjacency.get(b).push(a)
  }
  for (const req of requirements.values()) {
    for (const variable of req.constrains ?? []) addEdge(`r:${req.ref}`, `v:${variable}`)
  }

  const components = biconnectedComponents(adjacency)

  const clusters = []
  for (const edges of components) {
    const reqRefs = new Set()
    const varRefs = new Set()
    for (const [a, b] of edges) {
      for (const node of [a, b]) {
        if (node.startsWith('r:')) reqRefs.add(node.slice(2))
        else varRefs.add(node.slice(2))
      }
    }
    if (reqRefs.size < 2 || varRefs.size < 2) continue // bridge / single negotiation — fine

    const variables = [...varRefs].sort()
    const reqs      = [...reqRefs].sort()
    const actors    = [...new Set(reqs.map(ref => requirements.get(ref)?.by).filter(Boolean))].sort()

    clusters.push({
      ref: `${CLUSTER_REF_PREFIX}${variables.join('+')}`,
      requirements: reqs,
      variables,
      actors,
    })
  }

  return clusters.sort((a, b) => a.ref.localeCompare(b.ref))
}

/**
 * Hopcroft–Tarjan biconnected components (edge partition) via iterative DFS.
 * Returns an array of components, each an array of [nodeA, nodeB] edges.
 */
function biconnectedComponents(adjacency) {
  const disc = new Map()   // discovery index
  const low  = new Map()   // low-link
  const components = []
  const edgeStack  = []
  let counter = 0

  for (const start of adjacency.keys()) {
    if (disc.has(start)) continue

    // Frame: [node, parent, neighborCursor]
    const stack = [[start, null, 0]]
    disc.set(start, counter)
    low.set(start, counter)
    counter++

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]
      const [node, parent] = frame
      const neighbors = adjacency.get(node)

      if (frame[2] < neighbors.length) {
        const next = neighbors[frame[2]++]
        if (!disc.has(next)) {
          edgeStack.push([node, next])
          disc.set(next, counter)
          low.set(next, counter)
          counter++
          stack.push([next, node, 0])
        } else if (next !== parent && disc.get(next) < disc.get(node)) {
          edgeStack.push([node, next])
          low.set(node, Math.min(low.get(node), disc.get(next)))
        }
      } else {
        stack.pop()
        if (parent !== null) {
          low.set(parent, Math.min(low.get(parent), low.get(node)))
          if (low.get(node) >= disc.get(parent)) {
            // parent is an articulation point (or root) — pop one component
            const component = []
            let edge
            do {
              edge = edgeStack.pop()
              component.push(edge)
            } while (edge[0] !== parent || edge[1] !== node)
            if (component.length > 0) components.push(component)
          }
        }
      }
    }
  }

  return components
}
