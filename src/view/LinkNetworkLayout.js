/**
 * LinkNetworkLayout — the LINK NETWORK panel's layout as a PURE function
 * (ADR-094 E1/E3, refining ADR-048's deterministic layered layout).
 *
 * `computeLayout(entityInfos, links)` takes the scene facts the controller
 * already publishes (`{ name, type, parentId }` per entity + the SpatialLink
 * list — ADR-048 §2.4, unchanged) and returns the finished picture: node
 * positions, resolved edges, row count, panel height. It reads no DOM, holds no
 * `this`, and mutates neither argument. `LinkNetworkView` only draws the result.
 *
 * ## Why the panel draws a TF tree (ADR-094)
 *
 * What is on screen is not two views that should be split apart — it is ONE
 * graph with two edge classes: the CF tree is the kinematic **spanning tree**
 * and SpatialLinks are the **cotree edges** that close loops (ADR-048 §2.2.1,
 * ADR-038). The standard way to draw that pair is to give the TREE the geometry
 * and lay the cotree edges over it as the "leftovers". The panel's defect was
 * that the tree carrying the geometry was not a TF tree:
 *
 *   - Layer 0 held **Solids**, which are not TF frames at all — a Solid's body
 *     frame is its auto Origin CF (ADR-037 §1). The Y axis therefore meant
 *     neither TF depth nor containment depth but a mix of the two, and the row
 *     of item names on top was that category error made visible.
 *   - The body-frame row carried no information: every Solid's body frame has
 *     the same, uneditable name, so N Solids produced N identical labels. That
 *     row alone pushed the hierarchy to 3 layers and the panel to its max height,
 *     crushing the user's own CFs into the bottom row. (`LayoutDecompiler` had
 *     already folded that frame out of the DSL — the DSL layer knew the row was
 *     noise before the panel did.)
 *
 * ## The fusion (E1)
 *
 * Solid : body frame is a 1:1 bijection — the frame is created with the Solid,
 * sits at its centroid with its orientation, and cannot be renamed or deleted
 * (ADR-037 §1/§4). Two entities that always come in pairs and always share a
 * pose are ONE thing on a 220px canvas, so they are drawn as one node:
 *
 *   - TF identity  → the body frame (the node IS the frame; the Y axis now means
 *     TF depth and nothing else, and user CFs sit one row below it, not two).
 *   - Label        → the Solid's name (the body frame's meaningful identity —
 *     ROS names a body frame after its link, not "origin").
 *   - Click        → selects the **Solid**, because the body frame is edit-locked
 *     and can never be the target of an operation (ADR-037 §4).
 *   - Highlight    → either entity's 3D selection lights the fused node, via
 *     `nodeIdByEntity`. The round trip is deliberately asymmetric and lives here,
 *     in one place, rather than in the view's event handlers.
 *
 * Roots without a body frame (annotations, measures, sketches, imported meshes)
 * are untouched: they stay plain nodes on row 0. Fusing needs no new visual
 * vocabulary — no group bands, no band-edge stubs — which is exactly why it was
 * chosen over demoting Solids to enclosures (ADR-094 Option D): a Solid can be a
 * SpatialLink endpoint itself, and an arrow into a band would have been a new
 * special case.
 *
 * ## Cardinality (原則 #31 — the reason this file is testable at all)
 *
 *   0 — no links at all: no nodes, no edges. The caller hides the whole panel;
 *       `computeLayout` reports it as an empty result rather than an empty canvas.
 *   1 — a single node: `L === 1`, so the row formula has no interval to divide
 *       and the node is centred instead (a naive `layer/(L-1)` divides by zero).
 *   N — the interesting one. Row crowding, label collision and the dense-mode
 *       degradation only ever appear with several Solids; a one-Solid fixture
 *       cannot see them (the same blind spot ADR-093 hit with lockstep).
 *
 * Pure and THREE-free, so it runs under bare `node --test`. Entities are
 * duck-typed on `{ name, type, parentId }`; body-frame identity is asked of
 * `domain/originFrame.js` (never re-derived here — ADR-090 / ADR-094 §波及).
 *
 * @see ADR-094 (TF tree regression, fused node), ADR-048 (layered layout),
 *      ADR-037 (auto body frame), ADR-038 (two-layer taxonomy)
 */
import { isOriginFrame } from '../domain/originFrame.js'

/** Panel width — fixed by the left-edge occupancy contract (ADR-048 §2.3). */
export const PANEL_W = 220
/**
 * SVG height: MAX only when the hierarchy still reaches 3 layers. After the
 * fusion that needs a user CF *under* a user CF, so the common scene sits at
 * MIN. The cap is set by the Map vertical toolbar sharing the left:188px column
 * (~490px lower edge @720px viewport); 160 leaves ~8px clearance (ADR-048 §2.3).
 */
export const MIN_PANEL_H = 152
export const MAX_PANEL_H = 160
/** Bottom strip reserved for the legend (ADR-094 E2) — outside the graph area. */
export const LEGEND_H = 14
/** Max parentId hops when walking ancestor chains (cycle/corruption guard). */
export const MAX_ANCESTOR_HOPS = 16

/** semanticType values that carry a directional arrowhead. */
export const DIRECTED_TYPES = new Set([
  'mounts', 'fastened', 'aligned', 'contains', 'above', 'references', 'represents',
])

const TOP = 22          // graph-area padding above row 0
const BOT = 22          // graph-area padding below the last row
const MARGIN = 12       // horizontal padding
const MIN_GAP = 16      // minimum x distance between siblings in a row
const SIBLING_SPREAD = 20
const DENSE_SLOT = 22   // row slot narrower than this → labelled-on-focus dots

/**
 * @typedef {{name: string, type: string, parentId?: string|null}} EntityInfo
 * @typedef {{id: string, sourceId: string, targetId: string,
 *            semanticType?: string|null, jointType?: string|null}} LinkInfo
 * @typedef {{label: string, type: string, parentId: string|null, layer: number,
 *            x: number, y: number, entityId: string, frameId: string|null,
 *            fused: boolean}} LayoutNode
 */

/**
 * Body-frame → host map: which entities disappear into which fused node.
 *
 * A body frame only fuses into a host that is present and is not itself a body
 * frame. An orphaned frame (host outside the given entity set) keeps its own
 * node rather than vanishing — dropping a node because its parent is missing
 * would silently lose an endpoint the graph still draws edges to (原則 #11).
 *
 * @param {Map<string, EntityInfo>} entityInfos
 * @returns {{fuseInto: Map<string, string>, frameOf: Map<string, string>}}
 */
function buildFusion(entityInfos) {
  const fuseInto = new Map()   // body frame id → host id
  const frameOf  = new Map()   // host id → body frame id
  for (const [id, info] of entityInfos) {
    if (!isOriginFrame(info)) continue
    const hostId = info.parentId ?? null
    if (hostId == null || !entityInfos.has(hostId)) continue
    if (isOriginFrame(entityInfos.get(hostId))) continue
    fuseInto.set(id, hostId)
    // Cardinality N (two body frames under one host) is illegal and unreachable
    // by any code path, but reachable in a corrupted scene: both fuse into the
    // same node and the first one wins the host's `frameId`. Collapsing beats
    // rendering a duplicate identity row.
    if (!frameOf.has(hostId)) frameOf.set(hostId, id)
  }
  return { fuseInto, frameOf }
}

/**
 * Deterministic layered layout for the LINK NETWORK panel.
 *
 * Identical scene state yields identical output — no force simulation, no random
 * seed, no carry-over from the previous call, and no dependence on the iteration
 * order of the inputs (every comparator ends in a total order on ids). That
 * property is ADR-048's core promise; being a pure function is what finally lets
 * a test hold it.
 *
 * @param {Map<string, EntityInfo>|null|undefined} entityInfos every scene entity
 * @param {Iterable<LinkInfo>|null|undefined} links the SpatialLinks
 * @returns {{nodes: Map<string, LayoutNode>,
 *            edges: Map<string, {source:string, target:string, semanticType:string,
 *                                directed:boolean, kinematic:boolean}>,
 *            nodeIdByEntity: Map<string, string>,
 *            rows: number, svgH: number, graphH: number, denseMode: boolean}}
 */
export function computeLayout(entityInfos, links) {
  const infos = entityInfos instanceof Map ? entityInfos : new Map()
  const linkList = [...(links ?? [])]

  const empty = {
    nodes: new Map(), edges: new Map(), nodeIdByEntity: new Map(),
    rows: 0, svgH: MIN_PANEL_H, graphH: MIN_PANEL_H - LEGEND_H, denseMode: false,
  }

  const { fuseInto, frameOf } = buildFusion(infos)
  const resolve = (id) => fuseInto.get(id) ?? id

  /** Parent in the FUSED graph: a user CF's body-frame parent resolves to the host. */
  const parentOf = (nodeId) => {
    const pid = infos.get(nodeId)?.parentId ?? null
    if (pid == null) return null
    const r = resolve(pid)
    return (r === nodeId || !infos.has(r)) ? null : r
  }

  // ── Which entities appear ───────────────────────────────────────────────────
  // Link endpoints, plus their ancestors so a linked CF is anchored under its
  // root node even when that root carries no link of its own.
  const seeds = []
  for (const link of linkList) {
    for (const endpoint of [link.sourceId, link.targetId]) {
      const id = resolve(endpoint)
      if (infos.has(id)) seeds.push(id)
    }
  }
  const includedIds = new Set()
  for (const seed of seeds) {
    let cur = seed
    for (let hop = 0; hop < MAX_ANCESTOR_HOPS && cur != null; hop++) {
      if (includedIds.has(cur)) break
      includedIds.add(cur)
      cur = parentOf(cur)
    }
  }
  if (includedIds.size === 0) return empty

  /** @type {Map<string, LayoutNode>} */
  const nodes = new Map()
  const nodeIdByEntity = new Map()
  for (const id of includedIds) {
    const info = infos.get(id)
    const frameId = frameOf.get(id) ?? null
    nodes.set(id, {
      label:    info.name,
      type:     info.type,
      parentId: parentOf(id),
      layer:    0,
      x:        0,
      y:        0,
      entityId: id,        // click target — the Solid, never the locked body frame
      frameId,             // TF identity of a fused node
      fused:    frameId != null,
    })
    nodeIdByEntity.set(id, id)
  }
  // Both members of a fused pair light the same node from a 3D selection.
  for (const [frameId, hostId] of fuseInto) {
    if (nodes.has(hostId)) nodeIdByEntity.set(frameId, hostId)
  }

  // ── Edges (endpoints resolved through the fusion) ──────────────────────────
  const edges = new Map()
  for (const link of linkList) {
    const source = resolve(link.sourceId)
    const target = resolve(link.targetId)
    if (!nodes.has(source) || !nodes.has(target)) continue
    // A link between a Solid and its own body frame collapses to a self-loop.
    // It carried no information before the fusion either (the pair is rigid).
    if (source === target) continue
    edges.set(link.id, {
      source,
      target,
      semanticType: link.semanticType ?? 'connects',
      directed:     DIRECTED_TYPES.has(link.semanticType) || link.jointType != null,
      // Kinematic links (a real URDF joint) read heavier than topological ones.
      kinematic:    link.jointType != null,
    })
  }
  if (edges.size === 0) return empty
  // Canonical edge order. Overlapping arcs are drawn in iteration order, so the
  // z-stacking of two crossing links is part of "same scene → same pixels" —
  // and the caller's link list is ordered by scene mutation history, which
  // changes when an unrelated link is deleted and re-added.
  const orderedEdges = new Map([...edges].sort(([ia, a], [ib, b]) =>
    (a.source < b.source ? -1 : a.source > b.source ? 1 : 0) ||
    (a.target < b.target ? -1 : a.target > b.target ? 1 : 0) ||
    (ia < ib ? -1 : ia > ib ? 1 : 0)))

  const ids = [...nodes.keys()]

  // ── Layer = TF depth (and now nothing else) ────────────────────────────────
  const layerOf = (id, hop = 0) => {
    const pid = nodes.get(id).parentId
    if (hop >= MAX_ANCESTOR_HOPS || pid == null || !nodes.has(pid)) return 0
    return 1 + layerOf(pid, hop + 1)
  }
  let maxLayer = 0
  for (const id of ids) {
    const layer = layerOf(id)
    nodes.get(id).layer = layer
    maxLayer = Math.max(maxLayer, layer)
  }
  const L = maxLayer + 1

  // ── Vertical: panel height + row positions ─────────────────────────────────
  const svgH   = L >= 3 ? MAX_PANEL_H : MIN_PANEL_H
  const graphH = svgH - LEGEND_H
  const rowY = (layer) =>
    L === 1 ? graphH / 2 : TOP + layer * (graphH - TOP - BOT) / (L - 1)

  // ── Roots: stable (name, id) order + one barycenter refinement pass ────────
  const byNameId = (a, b) => {
    const na = nodes.get(a).label, nb = nodes.get(b).label
    return na < nb ? -1 : na > nb ? 1 : a < b ? -1 : a > b ? 1 : 0
  }
  const rootOf = (id) => {
    let cur = id
    for (let hop = 0; hop < MAX_ANCESTOR_HOPS; hop++) {
      const pid = nodes.get(cur)?.parentId
      if (pid == null || !nodes.has(pid)) return cur
      cur = pid
    }
    return cur
  }
  let roots = ids.filter(id => nodes.get(id).layer === 0).sort(byNameId)
  const initialIdx = new Map(roots.map((id, i) => [id, i]))
  const bary = new Map()
  for (const id of roots) {
    const partners = []
    for (const e of edges.values()) {
      const ru = rootOf(e.source), rv = rootOf(e.target)
      if (ru === id && rv !== id) partners.push(initialIdx.get(rv))
      if (rv === id && ru !== id) partners.push(initialIdx.get(ru))
    }
    bary.set(id, partners.length
      ? partners.reduce((s, v) => s + v, 0) / partners.length
      : initialIdx.get(id))
  }
  roots = roots.sort((a, b) => (bary.get(a) - bary.get(b)) || byNameId(a, b))

  const W = PANEL_W - 2 * MARGIN
  const rootSlot = W / roots.length
  roots.forEach((id, i) => {
    const nd = nodes.get(id)
    nd.x = MARGIN + (i + 0.5) * rootSlot
    nd.y = rowY(0)
  })

  // ── Child rows: group under parent x, then min-gap sweeps ──────────────────
  let maxRowCount = roots.length
  for (let layer = 1; layer < L; layer++) {
    const row = ids.filter(id => nodes.get(id).layer === layer)
    maxRowCount = Math.max(maxRowCount, row.length)
    row.sort((a, b) => {
      const pa = nodes.get(nodes.get(a).parentId)
      const pb = nodes.get(nodes.get(b).parentId)
      return (pa.x - pb.x) || byNameId(a, b)
    })
    const groupIndex = new Map()
    for (const id of row) {
      const pid = nodes.get(id).parentId
      if (!groupIndex.has(pid)) groupIndex.set(pid, [])
      groupIndex.get(pid).push(id)
    }
    for (const [pid, members] of groupIndex) {
      const px = nodes.get(pid).x
      members.forEach((id, j) => {
        nodes.get(id).x = px + (j - (members.length - 1) / 2) * SIBLING_SPREAD
      })
    }
    // Left-to-right min-gap sweep, then right-to-left to fix edge pileup.
    for (let i = 0; i < row.length; i++) {
      const nd = nodes.get(row[i])
      const prev = i > 0 ? nodes.get(row[i - 1]).x + MIN_GAP : MARGIN
      nd.x = Math.max(nd.x, prev)
      nd.y = rowY(layer)
    }
    for (let i = row.length - 1; i >= 0; i--) {
      const nd = nodes.get(row[i])
      const next = i < row.length - 1
        ? nodes.get(row[i + 1]).x - MIN_GAP
        : PANEL_W - MARGIN
      nd.x = Math.min(nd.x, next)
    }
    for (const id of row) {
      const nd = nodes.get(id)
      nd.x = Math.max(MARGIN, Math.min(PANEL_W - MARGIN, nd.x))
    }
  }

  // Dense scenes degrade to a labelled-on-focus dot strip (ADR-048 §MVP).
  const denseMode = W / maxRowCount < DENSE_SLOT

  // Render order (top-to-bottom, left-to-right) so the view's greedy label pass
  // resolves left-neighbour-first — part of "same scene → same pixels".
  const ordered = ids.sort((a, b) => {
    const u = nodes.get(a), v = nodes.get(b)
    return (u.layer - v.layer) || (u.x - v.x) || byNameId(a, b)
  })
  const rendered = new Map()
  for (const id of ordered) rendered.set(id, nodes.get(id))

  return { nodes: rendered, edges: orderedEdges, nodeIdByEntity, rows: L, svgH, graphH, denseMode }
}
