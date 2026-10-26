/**
 * LinkNetworkLayout — the LINK NETWORK panel's layout as a PURE function
 * (ADR-094 fusion, ADR-167 geometry — top-down tree).
 *
 * `computeLayout(entityInfos, links)` takes the scene facts the controller
 * already publishes (`{ name, type, parentId }` per entity + the SpatialLink
 * list — ADR-048 §2.4, unchanged) and returns the finished picture: node
 * positions, resolved edges, cotree lane assignment, content size. It reads no
 * DOM, holds no `this`, and mutates neither argument. `LinkNetworkView` only
 * draws the result.
 *
 * ## Why the panel draws a TF tree (ADR-094)
 *
 * What is on screen is ONE graph with two edge classes: the CF tree is the
 * kinematic **spanning tree** and SpatialLinks are the **cotree edges** that
 * close loops (ADR-048 §2.2.1, ADR-038). The tree carries the geometry; the
 * cotree edges are laid over it as the "leftovers".
 *
 * ## The fusion (ADR-094 E1)
 *
 * Solid : body frame is a 1:1 bijection — the frame is created with the Solid,
 * sits at its centroid with its orientation, and cannot be renamed or deleted
 * (ADR-037 §1/§4). Two entities that always come in pairs and always share a
 * pose are ONE thing on a small canvas, so they are drawn as one node:
 *
 *   - TF identity  → the body frame (the node IS the frame).
 *   - Label        → the Solid's name (ROS names a body frame after its link).
 *   - Click        → selects the **Solid**, because the body frame is edit-locked
 *     and can never be the target of an operation (ADR-037 §4).
 *   - Highlight    → either entity's 3D selection lights the fused node, via
 *     `nodeIdByEntity`.
 *
 * ## Why a top-down tree, and what keeps it readable (ADR-167)
 *
 * The person reading this panel asked for a top-down tree twice (ADR-095's
 * request was "Mermaid TD", and it was answered with an indented outline; on
 * 2026-10-21, after living with the outline: 「上から下へツリー構造になってる
 * のが見えるのが一番見やすい」). Parent above, children below, siblings side by
 * side — the branching is SEEN, not read off a staircase of indents.
 *
 * ADR-095 rejected the layered drawing because it spent the fixed axis (x,
 * 196px) on the growing quantity (sibling count) and degraded labels into a dot
 * strip past a dozen Solids. Its two goals stay — G1 "a label is always
 * readable", G2 "depth is visible at a glance" — and the premise that made them
 * incompatible with a top-down tree is what changes: **x scrolls now** (the
 * person's choice of the three ways to pay for width). So:
 *
 *   - **y = TF depth**, one level per `LEVEL_H` (G2: depth is the vertical
 *     position, and it means nothing else).
 *   - **x = a column slot** of fixed width `SLOT_W`. Leaves take consecutive
 *     slots in DFS order; a parent sits centred over its first and last child.
 *     Two nodes on one level are therefore always ≥ 1 slot apart (their leaf
 *     intervals are disjoint), so labels cannot collide.
 *   - **A label's width is `SLOT_W − LABEL_PAD`, a constant.** It divides by
 *     nothing — not the sibling count, not the depth (G1). Crowding grows the
 *     content, and the content scrolls inside the panel.
 *
 * Crowding of the cotree arcs is still paid for by the arcs (ADR-095's
 * direction of degradation, kept): each arc is assigned a lane by deterministic
 * interval colouring over its x span; the lane sets how far it bows above its
 * endpoints, and past `MAX_LANES` an arc becomes a `+N` badge on both endpoints.
 *
 * ## Cardinality (原則 #31 — the reason this file is testable at all)
 *
 *   0 — no links at all: no nodes, no edges. The caller hides the whole panel;
 *       `computeLayout` reports it as an empty result rather than an empty canvas.
 *       No cotree edge → `lanes === 0`: no headroom is reserved for arcs that
 *       do not exist.
 *   1 — a single node pair: one column each side of nothing to divide by.
 *   N — the interesting one. Lane collisions and overflow into scrolling appear
 *       only with several entities; a one-Solid fixture cannot see them (the
 *       same blind spot ADR-093 hit with lockstep).
 *
 * Pure and THREE-free, so it runs under bare `node --test`. Entities are
 * duck-typed on `{ name, type, parentId }`; body-frame identity is asked of
 * `domain/originFrame.js` (never re-derived here — ADR-090 / ADR-094 §波及).
 *
 * @see ADR-167 (top-down tree), ADR-095 (its goals, kept), ADR-094 (TF tree,
 *      fused node), ADR-048 (panel dimensions, data contract), ADR-037
 */
import { isOriginFrame } from '../domain/originFrame.js'

/** Panel width — fixed by the left-edge occupancy contract (ADR-048 §2.3). The
 *  CONTENT may be wider; it scrolls inside the panel (ADR-167). */
export const PANEL_W = 220
/**
 * Panel height bounds — unchanged since ADR-048. The cap is set by the Map
 * vertical toolbar sharing the left:188px column (~490px lower edge @720px
 * viewport). Content taller than the cap scrolls inside it.
 */
export const MIN_PANEL_H = 152
export const MAX_PANEL_H = 160
/** Bottom strip reserved for the legend (ADR-094 E2) — outside the graph area. */
export const LEGEND_H = 14
/** Max parentId hops when walking ancestor chains (cycle/corruption guard). */
export const MAX_ANCESTOR_HOPS = 16

/** semanticType values that carry a directional arrowhead. */
export const DIRECTED_TYPES = new Set([
  'mounts', 'fastened', 'aligned', 'contains', 'references', 'represents',
])

/** One column per leaf — the unit the tree's width is denominated in. */
export const SLOT_W = 64
/** Vertical step per TF depth level. */
export const LEVEL_H = 46
/** Node dot radius — geometry, so it belongs with the rest of the geometry. */
export const NODE_R = 3.5
/** First label baseline below the dot centre (labels hang under their node). */
export const LABEL_DY = 12
/** Label font size — the width estimate below is denominated in it. */
export const LABEL_SIZE = 9
/**
 * A label may wrap onto this many lines (word-wise) before it is truncated.
 * Names like "Robot pedestal" are two words that each fit a slot; one line
 * would cut both to "Robot ped…".
 */
export const LABEL_LINES = 2
/** Baseline-to-baseline distance of a wrapped label. */
export const LABEL_LINE_H = 10
/** Horizontal room a label gives up inside its slot (a gap to the neighbour). */
export const LABEL_PAD = 6
/** Where a parent's stem leaves it: below the last line of its label. */
export const STEM_DY = LABEL_DY + (LABEL_LINES - 1) * LABEL_LINE_H + 4
/** How much higher each further cotree lane bows above its endpoints. */
export const ARC_RISE = 7
/**
 * Lane budget. Past this, a cotree edge is not drawn — it is counted into the
 * endpoints' `+N` badge. Dropping it silently would be 原則 #11.
 */
export const MAX_LANES = 5

const TOP = 8           // padding above level 0 (before any arc headroom)
const BOT = 5           // padding below the deepest label
const MARGIN = 4        // left/right padding around the columns

/**
 * @typedef {{name: string, type: string, parentId?: string|null}} EntityInfo
 * @typedef {{id: string, sourceId: string, targetId: string,
 *            semanticType?: string|null, jointType?: string|null}} LinkInfo
 * @typedef {{label: string, type: string, parentId: string|null, layer: number,
 *            slot: number, x: number, y: number, labelW: number,
 *            overflow: number, entityId: string, frameId: string|null,
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
 * Deterministic top-down tree layout for the LINK NETWORK panel (ADR-167).
 *
 * Identical scene state yields identical output — no force simulation, no random
 * seed, no carry-over from the previous call, and no dependence on the iteration
 * order of the inputs (every comparator ends in a total order on ids). That
 * property is ADR-048's core promise; being a pure function is what lets a test
 * hold it. The **lane assignment** of cotree edges is order-independent too: it
 * is derived from the canonical edge order rather than from the caller's list.
 *
 * @param {Map<string, EntityInfo>|null|undefined} entityInfos every scene entity
 * @param {Iterable<LinkInfo>|null|undefined} links the SpatialLinks
 * @returns {{nodes: Map<string, LayoutNode>,
 *            edges: Map<string, {source:string, target:string, semanticType:string,
 *                                directed:boolean, kinematic:boolean,
 *                                lane:number|null, dropped:boolean,
 *                                cx:number|null, cy:number|null}>,
 *            nodeIdByEntity: Map<string, string>,
 *            columns: number, depth: number, lanes: number, dropped: number,
 *            contentW: number, contentH: number, svgH: number, graphH: number,
 *            scrollX: boolean, scrollY: boolean}}
 */
export function computeLayout(entityInfos, links) {
  const infos = entityInfos instanceof Map ? entityInfos : new Map()
  const linkList = [...(links ?? [])]

  const empty = {
    nodes: new Map(), edges: new Map(), nodeIdByEntity: new Map(),
    columns: 0, depth: 0, lanes: 0, dropped: 0,
    contentW: PANEL_W, contentH: TOP + BOT,
    svgH: MIN_PANEL_H, graphH: MIN_PANEL_H - LEGEND_H,
    scrollX: false, scrollY: false,
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
      layer:    0,          // TF depth — what y carries
      slot:     0,          // column position — what x carries
      x:        0,
      y:        0,
      labelW:   0,
      overflow: 0,
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
      lane: null, dropped: false, cx: null, cy: null,
    })
  }
  if (edges.size === 0) return empty
  // Canonical edge order. It fixes two things at once: the z-stacking of two
  // crossing arcs, and the LANE each arc is assigned. The caller's link list is
  // ordered by scene mutation history, which changes when an unrelated link is
  // deleted and re-added.
  const orderedEdges = new Map([...edges].sort(([ia, a], [ib, b]) =>
    (a.source < b.source ? -1 : a.source > b.source ? 1 : 0) ||
    (a.target < b.target ? -1 : a.target > b.target ? 1 : 0) ||
    (ia < ib ? -1 : ia > ib ? 1 : 0)))

  const ids = [...nodes.keys()]

  // ── Tree order: children by (name, id), roots likewise ────────────────────
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

  // ── Tidy columns: leaves take consecutive slots, a parent centres over its
  // first and last child. Layer = depth of the walk, so it cannot disagree with
  // the parent chain the walk followed.
  const placed = new Set()
  let nextSlot = 0
  let maxLayer = 0
  const place = (id, layer) => {
    placed.add(id)
    const nd = nodes.get(id)
    nd.layer = layer
    maxLayer = Math.max(maxLayer, layer)
    const kids = layer < MAX_ANCESTOR_HOPS ? childrenOf.get(id).filter(k => !placed.has(k)) : []
    if (kids.length === 0) { nd.slot = nextSlot++; return }
    for (const kid of kids) place(kid, layer + 1)
    nd.slot = (nodes.get(kids[0]).slot + nodes.get(kids[kids.length - 1]).slot) / 2
  }
  for (const root of roots) place(root, 0)
  // A cycle in `parentId` leaves its members unreached from any root. They still
  // exist and can still be a link endpoint, so they are placed as roots of their
  // own rather than dropped (原則 #11).
  for (const id of [...ids].sort(byNameId)) if (!placed.has(id)) place(id, 0)

  // ── Cotree lanes: deterministic interval colouring over x spans ────────────
  // Each cotree edge spans the column interval between its endpoints. Two edges
  // may share a lane only if their intervals are disjoint — touching counts as a
  // collision, because two arcs meeting at a column are exactly the ambiguity
  // the lanes exist to remove. Coloured in the canonical order above, so the
  // assignment is a function of the scene and not of the link list's order.
  /** @type {{a: number, b: number}[][]} */
  const laneIntervals = []
  let dropped = 0
  for (const [, e] of orderedEdges) {
    const su = nodes.get(e.source).slot, sv = nodes.get(e.target).slot
    const a = Math.min(su, sv), b = Math.max(su, sv)
    let lane = -1
    for (let l = 0; l < MAX_LANES; l++) {
      if (laneIntervals[l] == null) laneIntervals[l] = []
      if (laneIntervals[l].every(iv => b < iv.a || a > iv.b)) { lane = l; break }
    }
    if (lane < 0) {
      // No lane left. The edge is not drawn — and not silently forgotten: both
      // endpoints count it into a "+N" badge (原則 #11).
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

  // ── Coordinates ────────────────────────────────────────────────────────────
  // Arcs bow ABOVE their endpoints, so level 0 gets headroom for the lanes in
  // use — and none when there are none (an absent thing is not pre-allocated).
  const top = TOP + lanes * ARC_RISE
  for (const id of ids) {
    const nd = nodes.get(id)
    nd.x = MARGIN + SLOT_W / 2 + nd.slot * SLOT_W
    nd.y = top + NODE_R + nd.layer * LEVEL_H
    // G1: a constant. Nothing about the scene's size appears in it.
    nd.labelW = SLOT_W - LABEL_PAD
  }
  for (const [, e] of orderedEdges) {
    if (e.dropped) continue
    const u = nodes.get(e.source), v = nodes.get(e.target)
    const rise = 2 * ARC_RISE * (e.lane + 1)
    // Endpoints in one column (a cotree edge along a TF chain) would bow
    // straight up the tree's own stem; push the bow sideways instead.
    const sameColumn = Math.abs(u.x - v.x) < SLOT_W / 2
    e.cx = (u.x + v.x) / 2 + (sameColumn ? SLOT_W * 0.45 * (e.lane + 1) : 0)
    e.cy = Math.min(u.y, v.y) - (sameColumn ? 0 : rise)
  }

  // ── Content size: both axes grow with the tree, the panel does not ─────────
  const columns  = nextSlot
  const contentW = Math.max(PANEL_W, 2 * MARGIN + columns * SLOT_W)
  const contentH = top + NODE_R + maxLayer * LEVEL_H + LABEL_DY + (LABEL_LINES - 1) * LABEL_LINE_H + BOT
  const graphH   = Math.min(Math.max(contentH, MIN_PANEL_H - LEGEND_H), MAX_PANEL_H - LEGEND_H)
  const svgH     = graphH + LEGEND_H

  // Render order: by level, then left to right — reading order of the picture.
  const order = [...ids].sort((a, b) => {
    const na = nodes.get(a), nb = nodes.get(b)
    return (na.layer - nb.layer) || (na.slot - nb.slot) || (a < b ? -1 : a > b ? 1 : 0)
  })
  const rendered = new Map()
  for (const id of order) rendered.set(id, nodes.get(id))

  return {
    nodes: rendered,
    edges: orderedEdges,
    nodeIdByEntity,
    columns,
    depth: maxLayer + 1,
    lanes,
    dropped,
    contentW,
    contentH,
    svgH,
    graphH,
    scrollX: contentW > PANEL_W,
    scrollY: contentH > graphH,
  }
}

/**
 * The tree edges as org-chart elbows: a stem down from each parent (below its
 * label), a bar across its children, and a drop into each child. Pure, so the
 * view draws segments and computes no coordinate (ADR-094 E3).
 *
 * @param {Map<string, LayoutNode>} nodes from `computeLayout`
 * @returns {{x1:number, y1:number, x2:number, y2:number}[]}
 */
export function treeSegments(nodes) {
  /** @type {Map<string, LayoutNode[]>} */
  const kidsOf = new Map()
  for (const [, nd] of nodes) {
    const parent = nd.parentId != null ? nodes.get(nd.parentId) : null
    // Only a child one level down is drawn as a tree edge — a cycle member
    // placed as its own root has a parentId but no edge to hang from.
    if (!parent || nd.layer !== parent.layer + 1) continue
    if (!kidsOf.has(nd.parentId)) kidsOf.set(nd.parentId, [])
    kidsOf.get(nd.parentId).push(nd)
  }
  const segs = []
  for (const [parentId, kids] of kidsOf) {
    const p = nodes.get(parentId)
    const barY = p.y + STEM_DY + (LEVEL_H - STEM_DY - NODE_R) / 2
    const xs = kids.map(k => k.x)
    segs.push({ x1: p.x, y1: p.y + STEM_DY, x2: p.x, y2: barY })
    const lo = Math.min(p.x, ...xs), hi = Math.max(p.x, ...xs)
    if (hi > lo) segs.push({ x1: lo, y1: barY, x2: hi, y2: barY })
    for (const k of kids) segs.push({ x1: k.x, y1: barY, x2: k.x, y2: k.y - NODE_R - 1 })
  }
  return segs
}

/**
 * Approximate rendered width of a label at `LABEL_SIZE`. CJK glyphs are
 * full-width (≈ the font size); Latin/ASCII ≈ 0.55×. An estimate on purpose:
 * the layout is pure and measures nothing.
 * @param {string} str
 * @returns {number} px
 */
export function estimateTextWidth(str) {
  let w = 0
  for (const ch of str) w += ch.charCodeAt(0) > 0xff ? LABEL_SIZE : LABEL_SIZE * 0.55
  return w
}

/**
 * A label broken into at most `LABEL_LINES` lines of at most `maxW` px. Words
 * are kept whole when they fit; a word wider than a line, or text left over
 * after the last line, is truncated with one ellipsis. Truncation is the ONLY
 * loss a label suffers — the width is a constant, so a busier scene widens the
 * tree instead (ADR-167 G1).
 * @param {string} label
 * @param {number} maxW
 * @returns {string[]} 1..LABEL_LINES lines
 */
export function labelLines(label, maxW) {
  const cut = (str) => {
    if (estimateTextWidth(str) <= maxW) return str
    const ellipsisW = estimateTextWidth('…')
    let out = '', w = 0
    for (const ch of str) {
      const cw = estimateTextWidth(ch)
      if (w + cw + ellipsisW > maxW) break
      out += ch
      w += cw
    }
    return out + '…'
  }
  const words = String(label ?? '').split(/\s+/).filter(Boolean)
  if (words.length === 0) return ['']
  const lines = []
  let line = ''
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i]
    if (estimateTextWidth(next) <= maxW) { line = next; continue }
    if (line) lines.push(line)
    line = words[i]
    if (lines.length === LABEL_LINES - 1) {
      // Last line: everything left, truncated as one run.
      lines.push(cut(words.slice(i).join(' ')))
      return lines
    }
  }
  lines.push(cut(line))
  return lines
}

/**
 * SVG path of one drawn cotree arc: a quadratic bow through the layout's control
 * point, trimmed at both ends so it meets each dot's rim — the arrowhead of a
 * directed edge lands ON the target dot instead of under it.
 *
 * @param {{cx:number, cy:number}} edge a non-dropped edge from `computeLayout`
 * @param {{x:number, y:number}} u source node
 * @param {{x:number, y:number}} v target node
 * @returns {string}
 */
export function arcPath(edge, u, v) {
  const trim = (p, toward, by) => {
    const dx = toward.x - p.x, dy = toward.y - p.y
    const len = Math.hypot(dx, dy) || 1
    return { x: p.x + (dx / len) * by, y: p.y + (dy / len) * by }
  }
  const c = { x: edge.cx, y: edge.cy }
  const a = trim(u, c, NODE_R + 1)
  const b = trim(v, c, NODE_R + 1.5)
  const r = (n) => Math.round(n * 100) / 100
  return `M ${r(a.x)} ${r(a.y)} Q ${r(c.x)} ${r(c.y)} ${r(b.x)} ${r(b.y)}`
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
  'label',          // the node's text
  'type',           // dot colour
  'parentId',       // tree elbows
  'x', 'y',         // dot + label position
  'labelW',         // label truncation
  'overflow',       // the "+N" badge and its text
  'entityId',       // the click target (equal to the node key today — a node
                    // whose selection target changed must be rebuilt, not restyled)
])

/**
 * Node fields that provably do NOT reach the DOM, and why. Declared rather than
 * omitted: an unlisted field is a field nobody decided about.
 *   layer        — the DOM reads `y`, which is derived from it
 *   slot         — likewise, via `x`
 *   frameId/fused— TF identity carried for the caller; never drawn
 */
export const NODE_PRESENTATION_IRRELEVANT = Object.freeze([
  'layer', 'slot', 'frameId', 'fused',
])

/** Edge fields the arcs are a function of. */
export const EDGE_SIGNATURE_FIELDS = Object.freeze([
  'source', 'target',   // endpoints → path geometry
  'semanticType',       // colour + arrowhead marker id
  'directed', 'kinematic',
  'lane',               // how far the arc bows
  'dropped',            // drawn at all
  'cx', 'cy',           // the bow's control point
])

/** Edge fields that do not reach the DOM — none today; the empty list is a declaration. */
export const EDGE_PRESENTATION_IRRELEVANT = Object.freeze([])

/** Panel-level fields the SVG/scroll-container sizes are a function of. */
export const PANEL_SIGNATURE_FIELDS = Object.freeze([
  'contentW', 'contentH', 'graphH', 'lanes',
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
