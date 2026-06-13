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

import { CONFLICT_REF_PREFIX, CLUSTER_REF_PREFIX, REGION_AXES } from './ContextDslSchema.js'
import { intersectIntervals, intersectBoxes } from './RegionGeometry.js'

/**
 * R6 — per shared variable, intersect the admissible sets of every requirement
 * that constrains exactly that one variable. An empty intersection is a Conflict.
 *
 * Two admissible shapes are handled (a variable's requirements all use the same
 * shape):
 *   - scalar `admissible.interval` ([lo,hi]) — 1-D conflict; `gap` is `[hi,lo]`
 *     (array), preserved verbatim for backward compatibility.
 *   - region `admissible.region`  ({axis:[lo,hi]}) — AABB conflict; runs the 1-D
 *     interval logic once per axis (RegionGeometry.intersectBoxes). The
 *     intersection is empty iff empty on ≥1 axis; `gap` is a per-axis map
 *     `{axis:[hi,lo]}` for the empty axes only.
 *
 * Both shapes follow the ADR-046 half-open convention [min, max) — the single
 * `intersectIntervals` helper holds that test, so scalar and per-axis logic can
 * never diverge. The 1-D Helly property (joint emptiness ⇔ some pair disjoint)
 * is what makes one Conflict per variable complete; for regions it is applied
 * per axis (AABB only — see RegionGeometry's Helly-2-D caveat).
 *
 * Region ≠ multi-variable: a region admissible still constrains ONE region
 * variable. Multi-variable requirements (`constrains.length ≥ 2`) carry no
 * single-variable admissible — they continue to feed R7 clustering, never R6.
 *
 * @param {Map<string, object>} requirements — ref → Requirement
 * @returns {object[]} Conflict records:
 *   { ref, variable, between: string[], admissibleSets, gap }
 *   admissibleSets[ref] is the interval [lo,hi] (scalar) or box {axis:[lo,hi]} (region);
 *   gap is [hi,lo] (scalar) or {axis:[hi,lo]} (region).
 */
export function detectConflicts(requirements) {
  const byVariable = new Map()

  for (const req of requirements.values()) {
    const constrains = req.constrains ?? []
    const admissible = req.admissible
    const hasInterval = Array.isArray(admissible?.interval)
    const hasRegion   = admissible?.region && typeof admissible.region === 'object'
    if (constrains.length !== 1 || (!hasInterval && !hasRegion)) continue

    const variable = constrains[0]
    if (!byVariable.has(variable)) byVariable.set(variable, [])
    byVariable.get(variable).push(req)
  }

  const conflicts = []
  for (const [variable, reqs] of byVariable) {
    if (reqs.length < 2) continue

    const regionReqs   = reqs.filter(r => r.admissible.region && typeof r.admissible.region === 'object')
    const intervalReqs = reqs.filter(r => Array.isArray(r.admissible.interval))
    // Mixed shapes within one variable is malformed input — R0' flags it as an
    // error. Skip the bucket rather than throw on the inconsistent data.
    if (regionReqs.length !== reqs.length && intervalReqs.length !== reqs.length) continue

    const between  = reqs.map(r => r.ref).sort()
    const admissibleSets = {}

    if (regionReqs.length === reqs.length) {
      const boxes = reqs.map(r => r.admissible.region)
      const axes  = REGION_AXES.filter(ax => Array.isArray(boxes[0][ax]))
      const { emptyAxes, gap } = intersectBoxes(boxes, axes)
      if (emptyAxes.length === 0) continue // overlap on every axis — no conflict

      for (const ref of between) admissibleSets[ref] = requirements.get(ref).admissible.region
      conflicts.push({ ref: `${CONFLICT_REF_PREFIX}${variable}`, variable, between, admissibleSets, gap })
    } else {
      const { lo, hi, empty } = intersectIntervals(reqs.map(r => r.admissible.interval))
      if (!empty) continue // non-empty intersection — no conflict

      for (const ref of between) admissibleSets[ref] = requirements.get(ref).admissible.interval
      conflicts.push({
        ref: `${CONFLICT_REF_PREFIX}${variable}`,
        variable,
        between,
        admissibleSets,
        gap: [hi, lo], // the no-man's-land between the binding constraints
      })
    }
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
