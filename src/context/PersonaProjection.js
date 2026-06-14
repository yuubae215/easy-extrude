/**
 * PersonaProjection — persona-facing projections of the requirement/conflict
 * graph (ADR-049 Phase 4, §5.3).
 *
 * Pure computation: no I/O, no Three.js, no DOM. (PHILOSOPHY #3)
 * Returns new data; never mutates its inputs. (PHILOSOPHY #6)
 * Loadable under bare `node --test` — imports nothing from THREE/DOM.
 *
 * Two projections, both read-only views over the validator output (R6 conflicts
 * and R7 negotiation clusters are emitted by ContextValidator, never authored —
 * ADR-049 invariant 7):
 *
 *   projectConflictMatrix    — an actor × variable grid: who staked a claim on
 *                              which shared design variable, and where those
 *                              claims collide. The matrix makes "indirect
 *                              conflict through a shared variable" (ADR-049 §1
 *                              observation 1) visible at a glance.
 *   projectResolutionOrder   — the meeting design: contract every negotiation
 *                              cluster to one node, the result is a DAG, and a
 *                              topological order gives the sequence in which
 *                              Decisions should be stacked (DSM partitioning,
 *                              ADR-049 §R7). Independent single-variable
 *                              conflicts are leaves; coupled clusters depend on
 *                              the pairwise conflicts on their variables.
 *
 * @module context/PersonaProjection
 */
import { intersectBoxes, AXIS_ORDER } from './RegionGeometry.js'

/**
 * Approval gate (ADR-049 Phase 4, n-ary Decision approval). A conflict / cluster
 * carries `resolvedBy` whenever a Decision *references* it — the validator sets
 * this regardless of whether that Decision has been approved. The negotiation
 * view walks the resolution-order DAG and approves each Decision in turn, so it
 * must distinguish "a Decision is on the table" (`proposed`) from "the Decision
 * is approved" (`resolved`).
 *
 *   no resolvedBy                         → 'unresolved' (live conflict)
 *   resolvedBy, `approvedRefs` omitted    → 'resolved'   (backward compat: the
 *                                            story/authoring callers pass no gate
 *                                            and treat any resolvedBy as settled)
 *   resolvedBy, approved                  → 'resolved'
 *   resolvedBy, not approved              → 'proposed'
 *
 * @param {string|null|undefined} resolvedBy
 * @param {Set<string>|undefined} approvedRefs — approved Decision refs, or omit for no gate
 * @returns {'unresolved'|'proposed'|'resolved'}
 */
function resolutionState(resolvedBy, approvedRefs) {
  if (!resolvedBy) return 'unresolved'
  if (!approvedRefs) return 'resolved'
  return approvedRefs.has(resolvedBy) ? 'resolved' : 'proposed'
}

/**
 * Build the actor × variable conflict matrix.
 *
 * @param {object} ctx — raw Context DSL object (reads actors/variables/requirements)
 * @param {{ conflicts: object[] }} validatorResult — validateContext() output
 * @param {{ approvedRefs?: Set<string> }} [opts] — approved Decision refs; when
 *   omitted, any `resolvedBy` reads `resolved` (backward compat). When provided,
 *   an unapproved resolving Decision reads `proposed` instead.
 * @returns {{
 *   actors: string[],
 *   variables: string[],
 *   cells: Object<string, {
 *     state: 'none'|'satisfied'|'conflict'|'proposed'|'resolved',
 *     coupled: boolean,
 *     requirements: string[],
 *     admissible: {ref: string, set: any}[],
 *     criteria: {ref: string, kpi: string|null, op: string|null, value: number|null}[],
 *   }>,
 *   variableSummary: Object<string, {
 *     inConflict: boolean,
 *     conflictRef: string|null,
 *     gap: any,
 *     between: string[],
 *     resolvedBy: string|null,
 *     approved: boolean,
 *     actors: string[],
 *   }>,
 * }}
 *
 * Cell key is `"<actorRef>|<varRef>"`. A cell exists for every (actor, variable)
 * pair, but only populated cells carry requirements; empty ones are `state:'none'`.
 */
export function projectConflictMatrix(ctx, validatorResult, { approvedRefs } = {}) {
  const actorRefs = (ctx?.actors ?? []).map(a => a.ref)
  const varRefs   = (ctx?.variables ?? []).map(v => v.ref)
  const reqs      = ctx?.requirements ?? []
  const reqByRef  = new Map(reqs.map(r => [r.ref, r]))
  const conflicts = validatorResult?.conflicts ?? []
  const conflictByVar = new Map(conflicts.map(c => [c.variable, c]))

  // Seed every (actor, variable) cell empty so the grid is dense and stable.
  const cells = {}
  for (const a of actorRefs) {
    for (const v of varRefs) {
      cells[`${a}|${v}`] = { state: 'none', coupled: false, requirements: [], admissible: [], criteria: [] }
    }
  }

  // Populate cells from the requirements each actor authored.
  for (const req of reqs) {
    const actor = req.by
    const constrains = req.constrains ?? []
    if (!actorRefs.includes(actor)) continue // matrix is actor-indexed; skip unknown authors
    const coupled = constrains.length >= 2 // multi-variable → feeds R7 (cluster), never R6
    for (const variable of constrains) {
      const key = `${actor}|${variable}`
      const cell = cells[key]
      if (!cell) continue // requirement constrains a variable not declared in variables[]
      cell.requirements.push(req.ref)
      cell.coupled = cell.coupled || coupled
      const set = req.admissible?.interval ?? req.admissible?.region ?? null
      if (set !== null) cell.admissible.push({ ref: req.ref, set })
      cell.criteria.push({
        ref:   req.ref,
        kpi:   req.kpi?.name ?? null,
        op:    req.criterion?.op ?? null,
        value: req.criterion?.value ?? null,
      })
    }
  }

  // Derive each populated cell's state. A cell is `conflict` when the actor
  // authors a requirement that participates in an *unresolved* R6 conflict on
  // that variable, `proposed` once a Decision references it but is not yet
  // approved, `resolved` once that Decision is approved, and `satisfied`
  // otherwise. Coupled (multi-variable) requirements never appear in
  // `conflict.between`, so a cell carrying only those reads `satisfied`.
  for (const a of actorRefs) {
    for (const v of varRefs) {
      const cell = cells[`${a}|${v}`]
      if (cell.requirements.length === 0) continue
      const conflict = conflictByVar.get(v)
      const involved = conflict && cell.requirements.some(r => (conflict.between ?? []).includes(r))
      if (!involved) { cell.state = 'satisfied'; continue }
      const rs = resolutionState(conflict.resolvedBy, approvedRefs)
      cell.state = rs === 'unresolved' ? 'conflict' : rs // 'proposed' | 'resolved'
    }
  }

  // Per-variable roll-up (drives the matrix-tab badge + summary row).
  const variableSummary = {}
  for (const v of varRefs) {
    const conflict = conflictByVar.get(v)
    const between  = conflict?.between ?? []
    variableSummary[v] = {
      inConflict:  !!conflict,
      conflictRef: conflict?.ref ?? null,
      gap:         conflict?.gap ?? null,
      between,
      resolvedBy:  conflict?.resolvedBy ?? null,
      approved:    resolutionState(conflict?.resolvedBy, approvedRefs) === 'resolved',
      actors:      [...new Set(between.map(r => reqByRef.get(r)?.by).filter(Boolean))].sort(),
    }
  }

  return { actors: actorRefs, variables: varRefs, cells, variableSummary }
}

/**
 * Derive the negotiation resolution order (DSM partitioning, ADR-049 §R7).
 *
 * Each single-variable conflict and each negotiation cluster becomes one
 * resolution step. A cluster depends on every pairwise conflict whose variable
 * it contains (the conflict is the narrower, earlier negotiation; the n-ary
 * cluster Decision fixes the coupled variable's final value — ADR-049 §6,
 * invariant 8). Contracting clusters yields a DAG; a deterministic topological
 * sort (ready set ordered by ref, matching RequirementGraph's stable-output
 * convention) gives the meeting sequence.
 *
 * @param {object} ctx — raw Context DSL object (reads requirements for authors)
 * @param {{ conflicts: object[], negotiationClusters: object[] }} validatorResult
 * @param {{ approvedRefs?: Set<string> }} [opts] — approved Decision refs; gates
 *   each step's `approved` flag (omit → any `resolvedBy` reads approved).
 * @returns {{
 *   kind: 'conflict'|'cluster',
 *   order: number,
 *   ref: string,
 *   variables: string[],
 *   actors: string[],
 *   requirements: string[],
 *   decisionKind: 'single'|'n-ary',
 *   resolvedBy: string|null,
 *   approved: boolean,
 *   dependsOn: string[],
 * }[]}
 */
export function projectResolutionOrder(ctx, validatorResult, { approvedRefs } = {}) {
  const reqByRef  = new Map((ctx?.requirements ?? []).map(r => [r.ref, r]))
  const conflicts = validatorResult?.conflicts ?? []
  const clusters  = validatorResult?.negotiationClusters ?? []

  /** @type {Map<string, object>} ref → step (without order yet) */
  const steps = new Map()

  for (const c of conflicts) {
    const between = c.between ?? []
    steps.set(c.ref, {
      kind: 'conflict',
      ref: c.ref,
      variables: [c.variable],
      requirements: between,
      actors: [...new Set(between.map(r => reqByRef.get(r)?.by).filter(Boolean))].sort(),
      decisionKind: 'single',
      resolvedBy: c.resolvedBy ?? null,
      approved: resolutionState(c.resolvedBy, approvedRefs) === 'resolved',
      dependsOn: [],
    })
  }

  for (const nc of clusters) {
    const vars = nc.variables ?? []
    // A cluster depends on every pairwise conflict on one of its variables.
    const dependsOn = conflicts
      .filter(c => vars.includes(c.variable))
      .map(c => c.ref)
      .sort()
    steps.set(nc.ref, {
      kind: 'cluster',
      ref: nc.ref,
      variables: vars,
      requirements: nc.requirements ?? [],
      actors: nc.actors ?? [],
      decisionKind: 'n-ary',
      resolvedBy: nc.resolvedBy ?? null,
      approved: resolutionState(nc.resolvedBy, approvedRefs) === 'resolved',
      dependsOn,
    })
  }

  return topoSort([...steps.values()])
}

/**
 * Deterministic Kahn topological sort over resolution steps. The ready set is
 * processed in ref order so the output is stable for a given input. Any cyclic
 * remainder (should not occur once clusters are contracted) is appended in ref
 * order rather than dropped (PHILOSOPHY #11 — never a silent omission).
 */
function topoSort(stepList) {
  const byRef    = new Map(stepList.map(s => [s.ref, s]))
  const indegree = new Map(stepList.map(s => [s.ref, 0]))
  const dependents = new Map(stepList.map(s => [s.ref, []]))

  for (const s of stepList) {
    for (const dep of s.dependsOn) {
      if (!byRef.has(dep)) continue // dangling dependency — ignore, don't block
      indegree.set(s.ref, indegree.get(s.ref) + 1)
      dependents.get(dep).push(s.ref)
    }
  }

  const ready = stepList.filter(s => indegree.get(s.ref) === 0).map(s => s.ref).sort()
  const ordered = []
  const seen = new Set()

  while (ready.length > 0) {
    const ref = ready.shift()
    if (seen.has(ref)) continue
    seen.add(ref)
    ordered.push(byRef.get(ref))
    const freed = []
    for (const dep of dependents.get(ref)) {
      indegree.set(dep, indegree.get(dep) - 1)
      if (indegree.get(dep) === 0) freed.push(dep)
    }
    if (freed.length > 0) {
      ready.push(...freed)
      ready.sort()
    }
  }

  // Append any cycle remainder deterministically (defensive — clusters contract
  // the only cycles R7 can produce, so this is normally empty).
  for (const s of stepList) {
    if (!seen.has(s.ref)) ordered.push(s)
  }

  return ordered.map((s, i) => ({ ...s, order: i }))
}

/**
 * Project the actor-coloured admissible-region ghost overlay (ADR-049 §5.3,
 * "actor ごとに色分けした許容領域ゴーストを重畳 — 共通部分が空 = 衝突が目で見える").
 *
 * For each *region* Variable (a 2-D/3-D AABB footprint, not a scalar interval),
 * collect every single-variable region requirement that constrains it, one per
 * actor, and compute the common intersection of their admissible boxes via
 * `RegionGeometry.intersectBoxes` — the single source of the half-open per-axis
 * conflict logic (CODE_CONTRACTS: R6 Region Conflict). When the intersection is
 * empty on ≥1 axis the requirements collide (no common footprint); the per-axis
 * `gap` is the no-man's-land the view renders so the conflict is visible in 3-D.
 *
 * Pure (no THREE/DOM), input-immutable. Colour assignment is left to the view —
 * this returns actors in `ctx.actors` order so the caller can map a deterministic
 * palette index. Scalar variables (no `region`) and single-actor regions yield no
 * ghost (nothing to overlay).
 *
 * The `state` field mirrors `projectConflictMatrix`: an R6 region conflict reads
 * `conflict` while unresolved, `proposed` once a Decision references it (under an
 * `approvedRefs` gate), and `resolved` once approved (or whenever `resolvedBy` is
 * set with the gate omitted — the backward-compat seam).
 *
 * @param {object} ctx — raw Context DSL object (reads variables/requirements/actors/decisions)
 * @param {{ conflicts: object[] }} validatorResult — validateContext() output
 * @param {{ approvedRefs?: Set<string> }} [opts]
 * @returns {{
 *   variable: string,
 *   unit: string|null,
 *   axes: string[],
 *   domain: object|null,
 *   regions: { requirement: string, actor: string|null, negotiability: string|null, region: object }[],
 *   intersection: { box: object, emptyAxes: string[], gap: object, empty: boolean },
 *   inConflict: boolean,
 *   conflictRef: string|null,
 *   state: 'satisfied'|'conflict'|'proposed'|'resolved',
 *   resolvedBy: string|null,
 *   nominal: object|number|null,
 * }[]}
 */
export function projectRegionGhosts(ctx, validatorResult, { approvedRefs } = {}) {
  const actorRefs   = (ctx?.actors ?? []).map(a => a.ref)
  const variables   = ctx?.variables ?? []
  const reqs        = ctx?.requirements ?? []
  const decisions   = ctx?.decisions ?? []
  const conflicts   = validatorResult?.conflicts ?? []
  const conflictByVar = new Map(conflicts.map(c => [c.variable, c]))

  const ghosts = []
  for (const v of variables) {
    if (!v.region) continue // scalar variable — no footprint to overlay
    const axes = v.region.axes ?? AXIS_ORDER.filter(a => v.region.domain?.[a])

    // One region requirement per actor (single-variable region admissibles only;
    // coupled multi-variable reqs feed R7, not the per-axis footprint overlay).
    const regionReqs = reqs.filter(r =>
      (r.constrains ?? []).length === 1 &&
      r.constrains[0] === v.ref &&
      r.admissible?.region
    )
    if (regionReqs.length < 1) continue

    const regions = regionReqs.map(r => ({
      requirement:   r.ref,
      actor:         r.by ?? null,
      negotiability: r.negotiability ?? null,
      region:        r.admissible.region,
    }))
    // Sort by actor index so the colour palette assignment is deterministic.
    regions.sort((a, b) => actorRefs.indexOf(a.actor) - actorRefs.indexOf(b.actor))

    const { box, emptyAxes, gap } = intersectBoxes(regions.map(r => r.region), axes)
    const conflict = conflictByVar.get(v.ref)
    const rs = resolutionState(conflict?.resolvedBy, approvedRefs)
    // The nominal the resolving Decision fixes (single region nominal {x,y}).
    const decision = decisions.find(d =>
      d.ref === conflict?.resolvedBy || d.resolves === conflict?.ref
    )

    ghosts.push({
      variable:     v.ref,
      unit:         v.unit ?? null,
      axes,
      domain:       v.region.domain ?? null,
      regions,
      intersection: { box, emptyAxes, gap, empty: emptyAxes.length > 0 },
      inConflict:   !!conflict,
      conflictRef:  conflict?.ref ?? null,
      state:        conflict ? (rs === 'unresolved' ? 'conflict' : rs) : 'satisfied',
      resolvedBy:   conflict?.resolvedBy ?? null,
      nominal:      decision?.nominal ?? null,
    })
  }
  return ghosts
}
