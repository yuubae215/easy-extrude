/**
 * LinkNetworkLayout — the LINK NETWORK panel's layout as a PURE function
 * (ADR-094 E1/E3, ADR-095 geometry).
 *
 * `computeLayout(entityInfos, links)` takes the scene facts the controller
 * already publishes (`{ name, type, parentId }` per entity + the SpatialLink
 * list — ADR-048 §2.4, unchanged) and returns the finished picture: node
 * positions, resolved edges, cotree lane assignment, panel height. It reads no
 * DOM, holds no `this`, and mutates neither argument. `LinkNetworkView` only
 * draws the result.
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
 *     neither TF depth nor containment depth but a mix of the two.
 *   - The body-frame row carried no information: every Solid's body frame has
 *     the same, uneditable name, so N Solids produced N identical labels.
 *
 * ## The fusion (ADR-094 E1)
 *
 * Solid : body frame is a 1:1 bijection — the frame is created with the Solid,
 * sits at its centroid with its orientation, and cannot be renamed or deleted
 * (ADR-037 §1/§4). Two entities that always come in pairs and always share a
 * pose are ONE thing on a 220px canvas, so they are drawn as one node:
 *
 *   - TF identity  → the body frame (the node IS the frame).
 *   - Label        → the Solid's name (ROS names a body frame after its link).
 *   - Click        → selects the **Solid**, because the body frame is edit-locked
 *     and can never be the target of an operation (ADR-037 §4).
 *   - Highlight    → either entity's 3D selection lights the fused node, via
 *     `nodeIdByEntity`. The round trip is deliberately asymmetric and lives here,
 *     in one place, rather than in the view's event handlers.
 *
 * ## Why an indented outline and not a hierarchy drawing (ADR-095)
 *
 * The two axes of this panel have wildly different supply, and the layered
 * drawing spent them backwards:
 *
 *   - **x is fixed at 196px** (`PANEL_W − 2·MARGIN`). The left edge is a shared
 *     resource (原則 #26): the `left:188px` column is shared with the Map's
 *     vertical toolbar, so the panel cannot be widened. It was carrying the
 *     **sibling count**, which grows with the scene.
 *   - **y can be made scrollable**, i.e. unbounded. It was carrying **TF depth**,
 *     which after the ADR-094 fusion is nearly constant (measured: 2).
 *
 * The consequence was written down in code as `DENSE_SLOT = 22`: past a dozen
 * Solids the panel *dropped every label* and became a strip of dots. That line
 * is "when information grows, give up on knowing who" spelled out.
 *
 * So the assignment is swapped: **row = node** (tree DFS preorder) and
 * **x = depth** (indent). A label's width now depends on depth, not on how many
 * siblings it has, and depth is readable as the staircase of line starts rather
 * than by tracing edges. Crowding still has to be paid for somewhere — it is
 * paid by the **cotree arcs**, which are packed into right-gutter lanes and
 * degrade to a `+N` badge past `MAX_LANES`. Inverting the direction of that
 * degradation is the whole point: a structure view must keep answering "who",
 * even when it has given up on drawing "which line".
 *
 * x is still finite, so depth is NOT poured into it without a bound either —
 * indentation saturates at `MAX_INDENT_DEPTH` and the true depth is stated by a
 * badge (repeating the old mistake on the other axis would be the same bug).
 *
 * ## Cardinality (原則 #31 — the reason this file is testable at all)
 *
 *   0 — no links at all: no nodes, no edges. The caller hides the whole panel;
 *       `computeLayout` reports it as an empty result rather than an empty canvas.
 *       No cotree edge → `gutterW === 0`: the label gets the full width back
 *       rather than a default-sized gutter reserved "just in case".
 *   1 — a single node: one row, and `rows === 1` must not divide by anything.
 *   N — the interesting one. Lane collisions, row overflow into scrolling and
 *       indent saturation only ever appear with several entities; a one-Solid
 *       fixture cannot see them (the same blind spot ADR-093 hit with lockstep).
 *
 * Pure and THREE-free, so it runs under bare `node --test`. Entities are
 * duck-typed on `{ name, type, parentId }`; body-frame identity is asked of
 * `domain/originFrame.js` (never re-derived here — ADR-090 / ADR-094 §波及).
 *
 * @see ADR-095 (indented outline), ADR-094 (TF tree regression, fused node),
 *      ADR-048 (panel dimensions, data contract), ADR-037 (auto body frame)
 */
import { isOriginFrame } from '../domain/originFrame.js'

/** Panel width — fixed by the left-edge occupancy contract (ADR-048 §2.3). */
export const PANEL_W = 220
/**
 * Panel height bounds — unchanged by ADR-095. The cap is set by the Map vertical
 * toolbar sharing the left:188px column (~490px lower edge @720px viewport);
 * 160 leaves ~8px clearance (ADR-048 §2.3). What ADR-095 changes is what happens
 * when the content wants more: it scrolls inside the cap instead of dropping
 * labels.
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

/** One outline row per node — the unit the whole layout is denominated in. */
export const ROW_H = 16
/** Horizontal step per TF depth level. */
export const INDENT = 11
/**
 * Indentation stops here and a depth badge takes over. x is a finite resource
 * too: pouring an unbounded quantity into it is exactly the mistake this ADR
 * removes from the sibling axis (ADR-095 Decision 2).
 */
export const MAX_INDENT_DEPTH = 4
/** Node dot radius — geometry, so it belongs with the rest of the geometry. */
export const NODE_R = 3.5
/** Width of one cotree lane in the right gutter. */
export const LANE_W = 7
/**
 * Lane budget. Past this, a cotree edge is not drawn — it is counted into the
 * row's `+N` badge. Dropping it silently would be 原則 #11.
 */
export const MAX_LANES = 3

const TOP = 8           // padding above row 0
const BOT = 8           // padding below the last row
const MARGIN = 12       // left padding
const RIGHT_PAD = 4     // right padding, outside the gutter
const LANE_PAD = 3      // gap between the label column and the first lane
const LABEL_GAP = 4     // dot → label gap
const DEPTH_BADGE_W = 13 // reserved for the "5·" prefix when indentation saturates
const OVERFLOW_BADGE_W = 16 // reserved for the "+N" dropped-link badge

/**
 * @typedef {{name: string, type: string, parentId?: string|null}} EntityInfo
 * @typedef {{id: string, sourceId: string, targetId: string,
 *            semanticType?: string|null, jointType?: string|null}} LinkInfo
 * @typedef {{label: string, type: string, parentId: string|null, layer: number,
 *            row: number, x: number, y: number, labelX: number, labelW: number,
 *            indentDepth: number, depthSaturated: boolean, overflow: number,
 *            entityId: string, frameId: string|null, fused: boolean}} LayoutNode
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
 * Deterministic indented-outline layout for the LINK NETWORK panel.
 *
 * Identical scene state yields identical output — no force simulation, no random
 * seed, no carry-over from the previous call, and no dependence on the iteration
 * order of the inputs (every comparator ends in a total order on ids). That
 * property is ADR-048's core promise; being a pure function is what finally lets
 * a test hold it. ADR-095 adds a second thing that must be order-independent:
 * the **lane assignment** of cotree edges, which is derived from the canonical
 * edge order rather than from the caller's link list.
 *
 * @param {Map<string, EntityInfo>|null|undefined} entityInfos every scene entity
 * @param {Iterable<LinkInfo>|null|undefined} links the SpatialLinks
 * @returns {{nodes: Map<string, LayoutNode>,
 *            edges: Map<string, {source:string, target:string, semanticType:string,
 *                                directed:boolean, kinematic:boolean,
 *                                fromRow:number, toRow:number,
 *                                lane:number|null, dropped:boolean}>,
 *            nodeIdByEntity: Map<string, string>,
 *            rows: number, depth: number, lanes: number, gutterW: number,
 *            dropped: number, contentH: number, svgH: number, graphH: number,
 *            scrollable: boolean}}
 */
export function computeLayout(entityInfos, links) {
  const infos = entityInfos instanceof Map ? entityInfos : new Map()
  const linkList = [...(links ?? [])]

  const empty = {
    nodes: new Map(), edges: new Map(), nodeIdByEntity: new Map(),
    rows: 0, depth: 0, lanes: 0, gutterW: 0, dropped: 0,
    contentH: TOP + BOT, svgH: MIN_PANEL_H, graphH: MIN_PANEL_H - LEGEND_H,
    scrollable: false,
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
      layer:    0,          // TF depth — the meaning the Y axis used to carry
      row:      0,          // outline row — what Y carries now
      x:        0,
      y:        0,
      labelX:   0,
      labelW:   0,
      indentDepth:    0,
      depthSaturated: false,
      overflow:       0,
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
      fromRow: 0, toRow: 0, lane: null, dropped: false,
    })
  }
  if (edges.size === 0) return empty
  // Canonical edge order. It fixes two things at once: the z-stacking of two
  // crossing arcs, and — since ADR-095 — the LANE each arc is assigned. The
  // caller's link list is ordered by scene mutation history, which changes when
  // an unrelated link is deleted and re-added.
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

  // ── Row order = DFS preorder over the TREE edges ───────────────────────────
  // The child order is the existing (name, id) total order. ADR-048's barycenter
  // refinement pass is dropped here on purpose: it minimised edge *crossings*
  // between columns, and an indented outline has no columns to cross between
  // (ADR-095 Decision 1). Keeping it would be an unfalsifiable ritual — a sort
  // key nothing reads.
  const byNameId = (a, b) => {
    const na = nodes.get(a).label, nb = nodes.get(b).label
    return na < nb ? -1 : na > nb ? 1 : a < b ? -1 : a > b ? 1 : 0
  }
  const childrenOf = new Map(ids.map(id => [id, []]))
  const roots = []
  for (const id of ids) {
    const pid = nodes.get(id).parentId
    if (pid != null && nodes.has(pid)) childrenOf.get(pid).push(id)
    else roots.push(id)
  }
  roots.sort(byNameId)
  for (const list of childrenOf.values()) list.sort(byNameId)

  const order = []
  const walk = (id, hop) => {
    if (hop > MAX_ANCESTOR_HOPS) return
    order.push(id)
    for (const child of childrenOf.get(id)) walk(child, hop + 1)
  }
  for (const root of roots) walk(root, 0)
  // A cycle in `parentId` would leave nodes unvisited. They still exist and can
  // still be a link endpoint, so they are appended rather than dropped (原則 #11).
  if (order.length < ids.length) {
    const seen = new Set(order)
    for (const id of [...ids].sort(byNameId)) if (!seen.has(id)) order.push(id)
  }

  order.forEach((id, row) => {
    const nd = nodes.get(id)
    nd.row = row
    nd.y   = TOP + row * ROW_H + ROW_H / 2
    nd.indentDepth    = Math.min(nd.layer, MAX_INDENT_DEPTH)
    nd.depthSaturated = nd.layer > MAX_INDENT_DEPTH
    nd.x = MARGIN + nd.indentDepth * INDENT
  })

  // ── Cotree lanes: deterministic interval colouring in the right gutter ─────
  // Each cotree edge spans the row interval between its endpoints. Two edges may
  // share a lane only if their intervals are disjoint — touching counts as a
  // collision, because two arcs that meet at a row are exactly the ambiguity the
  // lanes exist to remove. Edges are coloured in the canonical order above, so
  // the assignment is a function of the scene and not of the link list's order.
  /** @type {{a: number, b: number}[][]} */
  const laneIntervals = []
  let dropped = 0
  for (const [, e] of orderedEdges) {
    const ru = nodes.get(e.source).row, rv = nodes.get(e.target).row
    e.fromRow = ru
    e.toRow   = rv
    const a = Math.min(ru, rv), b = Math.max(ru, rv)
    let lane = -1
    for (let l = 0; l < MAX_LANES; l++) {
      if (laneIntervals[l] == null) laneIntervals[l] = []
      if (laneIntervals[l].every(iv => b < iv.a || a > iv.b)) { lane = l; break }
    }
    if (lane < 0) {
      // No lane left. The edge is not drawn — and not silently forgotten: both
      // endpoint rows count it into a "+N" badge (原則 #11).
      e.dropped = true
      dropped++
      nodes.get(e.source).overflow++
      nodes.get(e.target).overflow++
      continue
    }
    laneIntervals[lane].push({ a, b })
    e.lane = lane
  }
  const lanes = laneIntervals.filter(l => l != null && l.length > 0).length
  const gutterW = lanes > 0 ? LANE_PAD + lanes * LANE_W : 0

  // ── Label column: what is left after the indent and the gutter ─────────────
  // The width no longer divides by the sibling count, which is the whole of G1.
  for (const id of order) {
    const nd = nodes.get(id)
    nd.labelX = nd.x + NODE_R + LABEL_GAP + (nd.depthSaturated ? DEPTH_BADGE_W : 0)
    nd.labelW = Math.max(0,
      PANEL_W - RIGHT_PAD - gutterW - (nd.overflow > 0 ? OVERFLOW_BADGE_W : 0) - nd.labelX)
  }

  // ── Vertical: content grows with rows, the panel does not ──────────────────
  const rows     = order.length
  const contentH = TOP + rows * ROW_H + BOT
  const graphH   = Math.min(Math.max(contentH, MIN_PANEL_H - LEGEND_H), MAX_PANEL_H - LEGEND_H)
  const svgH     = graphH + LEGEND_H

  // Render order = row order, so the view draws top to bottom.
  const rendered = new Map()
  for (const id of order) rendered.set(id, nodes.get(id))

  return {
    nodes: rendered,
    edges: orderedEdges,
    nodeIdByEntity,
    rows,
    depth: maxLayer + 1,
    lanes,
    gutterW,
    dropped,
    contentH,
    svgH,
    graphH,
    scrollable: contentH > graphH,
  }
}

/**
 * x of a cotree lane's centre line. Exported so the view never re-derives the
 * gutter arithmetic — the layout owns every coordinate in this panel.
 * @param {number} lane
 * @param {number} lanes total lanes in use (from `computeLayout`)
 */
export function laneX(lane, lanes) {
  return PANEL_W - RIGHT_PAD - lanes * LANE_W + lane * LANE_W + LANE_W / 2
}

/**
 * x where the right gutter starts = the right edge of the label column, and the
 * point every cotree arc and every "+N" badge is anchored to.
 * @param {number} gutterW from `computeLayout`
 */
export function gutterX(gutterW) {
  return PANEL_W - RIGHT_PAD - gutterW
}

// ── Layout equivalence (ADR-099) ─────────────────────────────────────────────
//
// The view no longer rebuilds its DOM on every render: a row's `<g>` must
// outlive the pointer gesture aimed at it, or `mouseenter → rebuild → mouseenter`
// closes a loop that destroys the element between `mousedown` and `mouseup` and
// `click` is never synthesised (原則 #24 on the DOM: the derived value — which
// row is hovered — was feeding the input that *creates the hit targets*).
//
// So the view needs to answer "did the LAYOUT change, or only the focus?" and
// that judgement is made HERE, not by a feeling inside the view. ADR-099 accepts
// one cost — "the layout changed but the DOM is stale" becomes newly writable —
// and this is where it is paid: the signature is a pure function of the layout,
// and its field list is asserted COMPLETE by counting (原則 #31). A field added
// to a layout node without a decision about it fails the test rather than
// silently dropping out of the equivalence.

/**
 * Node fields the panel's DOM is a function of. Anything here differing means
 * the elements must be built again.
 */
export const NODE_SIGNATURE_FIELDS = Object.freeze([
  'label',          // the row's text
  'type',           // dot colour
  'parentId',       // tree elbows + indent guides
  'x', 'y',         // dot position
  'labelX', 'labelW', // label placement / truncation
  'depthSaturated', 'layer',  // the "5·" depth badge and its text
  'overflow',       // the "+N" badge and its text
  'entityId',       // the click target (equal to the node key today — a node
                    // whose selection target changed must be rebuilt, not restyled)
])

/**
 * Node fields that provably do NOT reach the DOM, and why. Declared rather than
 * omitted: an unlisted field is a field nobody decided about.
 *   row          — the DOM reads `y`, which is derived from it
 *   indentDepth  — likewise, via `x`
 *   frameId/fused— TF identity carried for the caller; never drawn
 */
export const NODE_PRESENTATION_IRRELEVANT = Object.freeze([
  'row', 'indentDepth', 'frameId', 'fused',
])

/** Edge fields the arcs are a function of. */
export const EDGE_SIGNATURE_FIELDS = Object.freeze([
  'source', 'target',   // endpoints → path geometry
  'semanticType',       // colour + arrowhead marker id
  'directed', 'kinematic',
  'lane',               // x of the bracket
  'dropped',            // drawn at all
])

/**
 * Edge fields that do not reach the DOM: `fromRow`/`toRow` are the lane
 * assignment's inputs, and the drawn geometry uses the endpoint nodes' `y`.
 */
export const EDGE_PRESENTATION_IRRELEVANT = Object.freeze(['fromRow', 'toRow'])

/** Panel-level fields the SVG/scroll-container sizes are a function of. */
export const PANEL_SIGNATURE_FIELDS = Object.freeze([
  'contentH', 'graphH', 'lanes', 'gutterW',
])

// 名前や id に現れ得ない制御文字を区切りにする — "a|b" と "a"+"|b" が
// 同じ署名へ潰れない (境界の曖昧さは署名の意味を静かに壊す)。
const SIG_FIELD  = '\u0001'
const SIG_RECORD = '\u0002'
const SIG_GROUP  = '\u0003'

/**
 * A value identifying everything the panel's DOM depends on — but NOT the focus
 * state (selection / hover), which is written onto existing elements.
 *
 * Iteration order is part of the signature on purpose: the map order IS the
 * render order, and the render order is the arcs' z-stacking (ADR-095).
 *
 * @param {ReturnType<typeof computeLayout>} layout
 * @returns {string}
 */
export function layoutSignature(layout) {
  const nodes = [...(layout?.nodes ?? new Map())].map(([id, nd]) =>
    [id, ...NODE_SIGNATURE_FIELDS.map(f => nd[f])].join(SIG_FIELD))
  const edges = [...(layout?.edges ?? new Map())].map(([id, e]) =>
    [id, ...EDGE_SIGNATURE_FIELDS.map(f => e[f])].join(SIG_FIELD))
  const panel = PANEL_SIGNATURE_FIELDS.map(f => layout?.[f]).join(SIG_FIELD)
  return [panel, nodes.join(SIG_RECORD), edges.join(SIG_RECORD)].join(SIG_GROUP)
}
