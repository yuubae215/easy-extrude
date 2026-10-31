// @ts-nocheck
/**
 * LinkNetworkView — 2D SVG overlay drawing the scene's TF tree top-down, with
 * the SpatialLink constraints laid over it as coloured bows (ADR-167, refining
 * ADR-094).
 *
 * The panel shows ONE graph with two edge classes: the CF tree is the kinematic
 * spanning tree and SpatialLinks are the cotree edges closing loops (ADR-038).
 * The tree carries the geometry — it is the **skeleton**, drawn as org-chart
 * elbows — and the constraints ride over it as dashed/solid bows. A two-line
 * legend names that pairing.
 *
 * Every node is a coordinate frame. A Solid and its auto body frame render as
 * ONE fused node (ADR-094 E1): the node's TF identity is the body frame, its
 * label is the Solid's name, clicking it selects the Solid (the body frame is
 * edit-locked, ADR-037 §4), and a 3D selection of *either* entity highlights it.
 *
 * ## Parent above, children below (ADR-167)
 *
 * Depth is the vertical position; siblings sit side by side in fixed-width
 * column slots. The panel keeps its fixed 220px footprint (the left edge is
 * shared — 原則 #26) and the CONTENT scrolls inside it on both axes, so a wide
 * scene costs scrolling, never label width. Selecting something in 3D scrolls
 * its node into view (`_revealSelection`) — with a scrolled picture, a
 * selection that lands off-screen would otherwise say nothing here.
 *
 * Crowding of the arcs is paid for by the arcs: they are packed into
 * `MAX_LANES` bow heights and anything past that becomes a `+N` badge on both
 * endpoints. A structure view must keep answering "who" long after it has given
 * up on drawing "which line".
 *
 * **No coordinate is computed here.** Positions, elbows (`treeSegments`), arc
 * paths (`arcPath`), label widths and content size all come from
 * `LinkNetworkLayout`, which is pure and tested; this class draws the result and
 * routes input (ADR-094 E3).
 *
 * READABILITY: edges are static — there is no idle animation. Every edge
 * marching-ants at once carried no per-firing information and read as chaos
 * (PHILOSOPHY #30). Legibility comes from *state*: with a node focused (hover or
 * selection) its incident arcs brighten and the rest dim to context, so "what
 * connects to this entity" is answerable at a glance; kinematic links
 * (jointType ≠ null) read heavier than topological ones.
 *
 * Visibility is two orthogonal axes — `forceHidden` (an overlay owns the
 * viewport) × `collapsed` (the user's −/+ button) — and `_applyVisibility()` is
 * the sole writer of both (PHILOSOPHY #4). Flattening them into one enum would
 * make "the user collapsed the panel during the demo" unrepresentable.
 *
 * **Scroll position is NOT mirrored here.** It lives in exactly one place, the
 * scroll container's own `scrollLeft`/`scrollTop` (§1.1): re-rendering replaces
 * the SVG's children but never the container, so the user's scroll survives a
 * hover without this class holding a second copy of it to drift. Besides the
 * user, the only writer is `_revealSelection` — on a selection change only.
 *
 * ## Two render paths, and why (ADR-099)
 *
 * A row's `<g>` must outlive the pointer gesture aimed at it (ADR-099 G3).
 * Until ADR-099 every render rebuilt the whole SVG, including on `mouseenter` —
 * so the element under the pointer was destroyed and recreated, the browser saw
 * a new hover target and fired `mouseenter` again, and the loop never settled.
 * Measured on the reported scene: 76 hover events and 114–120 child mutations
 * per touch, and **zero** `mousedown` / `mouseup` / `click` — `click` is only
 * synthesised when press and release reach a common element, so the panel's
 * click handler had never once run. That is 原則 #24 (a derived value fed back
 * into its own input) wearing a DOM face: the derived value is "which row is
 * hovered", and it was feeding the code that *creates the hit targets*.
 *
 * So there are two paths now:
 *
 *   - `_rebuildGraph()` — elements are created. Runs only when the LAYOUT
 *     changed, judged by `layoutSignature()` on the pure side (the view holds no
 *     opinion about equivalence — ADR-099 pays the "stale DOM" cost there).
 *   - `_applyFocus()`  — attributes are written on existing elements. Runs on
 *     hover, on selection, and after a rebuild.
 *
 * The idempotence guard on `mouseenter` stays as well: it prevents the loop from
 * REAPPEARING through some future caller of the rebuild path, but it is not what
 * breaks it. Identity is protected by structure, not by a guard (ADR-099 §1).
 *
 * @see ADR-167 (top-down tree), ADR-099 (selection round trip), ADR-094 (TF
 *      tree regression), ADR-030 (SpatialLink), ADR-048 (panel dimensions)
 */
import { LINK_TYPE_COLORS, NODE_TYPE_COLORS } from '../theme/semantic.js'
import { COLOR, Z } from '../theme/tokens.js'
import { leftEdgeOffset, bottomEdgeOffset, BOTTOM_TIER } from './EdgeOccupancy.js'
import {
  computeLayout, layoutSignature, treeSegments, arcPath, labelLines,
  PANEL_W, MIN_PANEL_H, LEGEND_H, NODE_R, SLOT_W, LABEL_DY,
  LABEL_SIZE, LABEL_LINES, LABEL_LINE_H,
} from './LinkNetworkLayout.js'

/**
 * Node fill colour by entity type. A data-meaning vocabulary, declared out of
 * scope for the state palette and owned by `theme/semantic.js` (ADR-100 §5).
 */
const NODE_COLOR = NODE_TYPE_COLORS

/** Tree edge (TF parent → child): the skeleton, the most legible line here. */
const TREE_STROKE = 'rgba(255,255,255,0.62)'
const TREE_WIDTH  = 1.6
/** An elbow that hangs a thing by a fixed link or a support, not by its owner (ADR-168 S3). */
const ATTACHED_DASH = '5 2.5'

const SVG_NS = 'http://www.w3.org/2000/svg'
const FONT   = 'system-ui, -apple-system, sans-serif'

export class LinkNetworkView {
  /**
   * @param {(id: string) => void} onSelectEntity  Called when a node is clicked.
   */
  constructor(onSelectEntity) {
    this._onSelect    = onSelectEntity
    /** @type {Map<string, import('./LinkNetworkLayout.js').LayoutNode>} laid-out nodes */
    this._nodes       = new Map()
    /** @type {Map<string, object>} resolved cotree edges with lane assignments */
    this._edges       = new Map()
    /**
     * entity id → node id. A fused node is reachable from BOTH the Solid and its
     * body frame, so a 3D selection of either highlights it (ADR-094 E1).
     * @type {Map<string, string>}
     */
    this._nodeIdByEntity = new Map()
    /**
     * The 3D selection as ENTITY ids, as last announced to this panel — mapped
     * to node ids at focus time, so a selection set before the next layout is
     * not stale. A display copy of an event payload, deliberately NOT named
     * `_selectedIds`: the authority is `SelectionManager._ids` and one concept
     * gets one name (§1.1 / ADR-099).
     */
    this._selectionEntityIds = new Set()
    /** Node currently hovered in the panel — drives focus+context with selection. */
    this._hoveredId   = null
    this._collapsed   = false
    /** Full tree size (may exceed the viewport on either axis — the container scrolls). */
    this._contentW    = PANEL_W
    this._contentH    = MIN_PANEL_H - LEGEND_H
    /** Visible graph height — capped by the Map toolbar clearance (ADR-048 §2.3). */
    this._graphH      = MIN_PANEL_H - LEGEND_H
    /** True while an overlay (e.g. the Context DSL demo) suppresses the panel. */
    this._forceHidden = false
    /** Cached link-existence flag from the last update() — drives auto-visibility. */
    this._hasContent  = false
    /**
     * Signature of the layout the current DOM was built from (ADR-099). `null`
     * = nothing built yet. Compared, never interpreted — the equivalence rule
     * lives in the pure layout module.
     * @type {string|null}
     */
    this._layoutSig   = null
    /**
     * Live element handles, so focus can be written without creating anything.
     * @type {Map<string, {g: SVGGElement, hit: SVGRectElement, circle: SVGCircleElement, text: SVGTextElement}>}
     */
    this._nodeEls      = new Map()
    /** @type {Map<string, SVGPathElement>} edge id → its drawn bow (dropped edges absent) */
    this._edgeEls     = new Map()

    this._buildDOM()
  }

  // ── DOM construction ────────────────────────────────────────────────────────

  _buildDOM() {
    this._panelEl = document.createElement('div')
    Object.assign(this._panelEl.style, {
      position:        'fixed',
      // Both offsets are placeholders until `setEdgeOffsets()` runs — they are
      // NOT a second computation of the edges' occupancy (原則 #26). Writing a
      // usable literal here is how a panel ends up correct on first paint and
      // wrong forever after, so these stay obviously provisional.
      bottom:          '0',
      left:            '0',
      width:           `${PANEL_W}px`,
      background:      'rgba(20, 20, 22, 0.93)',
      border:          '1px solid rgba(255,255,255,0.10)',
      borderRadius:    '8px',
      // Mounted on document.body, outside #react-ui-root's stacking context, so
      // it competes with the 3D labels directly — a tie (it was '50' = sceneLabel)
      // let any label projected under the panel print across it.
      zIndex:          String(Z.edgePanel),
      display:         'none',
      flexDirection:   'column',
      backdropFilter:  'blur(8px)',
      fontFamily:      FONT,
      overflow:        'hidden',
      userSelect:      'none',
      boxShadow:       '0 4px 20px rgba(0,0,0,0.45)',
      pointerEvents:   'auto',
    })
    // Named region: on mobile this panel is the only permanent structure view,
    // so it needs an accessible name — and it gives the round-trip regression a
    // handle that is not a style selector (ADR-099 §Consequences).
    this._panelEl.setAttribute('role', 'region')
    this._panelEl.setAttribute('aria-label', 'Link Network panel')
    document.body.appendChild(this._panelEl)

    // ── Header row ──────────────────────────────────────────────────────────
    const header = document.createElement('div')
    Object.assign(header.style, {
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'space-between',
      padding:        '5px 8px 4px',
      borderBottom:   '1px solid rgba(255,255,255,0.07)',
      cursor:         'pointer',
      flexShrink:     '0',
    })

    const title = document.createElement('span')
    Object.assign(title.style, {
      fontSize:      '10px',
      color:         '#999',
      fontWeight:    '500',
      letterSpacing: '0.6px',
      textTransform: 'uppercase',
    })
    title.textContent = 'Link Network'

    this._collapseBtn = document.createElement('button')
    Object.assign(this._collapseBtn.style, {
      background:     'transparent',
      border:         'none',
      color:          '#666',
      cursor:         'pointer',
      padding:        '0',
      lineHeight:     '1',
      fontSize:       '15px',
      width:          '16px',
      height:         '16px',
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
      flexShrink:     '0',
    })
    this._collapseBtn.textContent = '−'
    this._collapseBtn.setAttribute('aria-label', 'Collapse link network panel')

    header.appendChild(title)
    header.appendChild(this._collapseBtn)
    this._panelEl.appendChild(header)
    header.addEventListener('click', () => this._toggleCollapse())

    // ── Body: scrollable tree + pinned legend ───────────────────────────────
    // The legend sits OUTSIDE the scroll container. It names the two edge
    // classes, so scrolling it away would take the key with the content it
    // explains — the same reason the layout reserves LEGEND_H outside graphH.
    this._bodyEl = document.createElement('div')
    Object.assign(this._bodyEl.style, {
      display:       'flex',
      flexDirection: 'column',
      minHeight:     '0',
    })
    this._panelEl.appendChild(this._bodyEl)

    this._scrollEl = document.createElement('div')
    Object.assign(this._scrollEl.style, {
      overflowY:            'auto',
      overflowX:            'auto',
      scrollbarWidth:       'thin',
      scrollbarColor:       'rgba(255,255,255,0.18) transparent',
      overscrollBehavior:   'contain',
      flexShrink:           '0',
    })
    this._bodyEl.appendChild(this._scrollEl)

    this._svgEl = document.createElementNS(SVG_NS, 'svg')
    this._svgEl.setAttribute('width',  PANEL_W)
    this._svgEl.setAttribute('height', MIN_PANEL_H - LEGEND_H)
    Object.assign(this._svgEl.style, { display: 'block' })
    this._scrollEl.appendChild(this._svgEl)

    // ── SVG defs: arrowhead markers ────────────────────────────────────────
    // Edges are static (no idle animation) — legibility is carried by
    // focus+context styling, not motion (see class doc / PHILOSOPHY #30).
    const defs = document.createElementNS(SVG_NS, 'defs')
    for (const [type, colorInt] of Object.entries(LINK_TYPE_COLORS)) {
      const hex    = '#' + colorInt.toString(16).padStart(6, '0')
      const marker = document.createElementNS(SVG_NS, 'marker')
      marker.setAttribute('id',          `lnv-arr-${type}`)
      marker.setAttribute('markerWidth', '6')
      marker.setAttribute('markerHeight','6')
      marker.setAttribute('refX',        '5')
      marker.setAttribute('refY',        '3')
      marker.setAttribute('orient',      'auto')
      marker.setAttribute('markerUnits', 'userSpaceOnUse')
      const path = document.createElementNS(SVG_NS, 'path')
      path.setAttribute('d',    'M0,0 L0,6 L6,3 z')
      path.setAttribute('fill', hex)
      path.setAttribute('opacity', '0.85')
      marker.appendChild(path)
      defs.appendChild(marker)
    }
    this._svgEl.appendChild(defs)

    // Graph container group
    this._graphGrp = document.createElementNS(SVG_NS, 'g')
    this._svgEl.appendChild(this._graphGrp)

    // Legend canvas — fixed height, never scrolls.
    this._legendEl = document.createElementNS(SVG_NS, 'svg')
    this._legendEl.setAttribute('width',  PANEL_W)
    this._legendEl.setAttribute('height', LEGEND_H)
    Object.assign(this._legendEl.style, { display: 'block', flexShrink: '0' })
    this._bodyEl.appendChild(this._legendEl)
    this._renderLegend()
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Rebuilds the graph from current scene state.
   * @param {Map<string, {name:string, type:string, parentId?:string|null}>} entityInfos
   * @param {import('../domain/SpatialLink.js').SpatialLink[]} links
   * @param {{supports: Array<{subject:string, of:string}>, contested: Array<{a:string, b:string}>}|null} [held]
   *        the declared supports by scene id (ADR-168 S3)
   */
  update(entityInfos, links, held = null) {
    // All graph derivation — fusion, ancestor expansion, attachments, levels,
    // columns, lanes — is the pure layout's job (ADR-094 E3 / ADR-167 / ADR-168
    // S3). Nothing here recomputes it.
    const layout = computeLayout(entityInfos, links, held)
    this._nodes          = layout.nodes
    this._edges          = layout.edges
    this._nodeIdByEntity = layout.nodeIdByEntity
    this._contentW       = layout.contentW
    this._contentH       = layout.contentH
    this._graphH         = layout.graphH

    // A support with no link is still something declared (ADR-168 S3).
    this._hasContent = layout.nodes.size > 0
    this._applyVisibility()

    // Elements are created only when the picture itself changed. Everything a
    // selection or a hover does is an attribute write on what is already there.
    const sig = layoutSignature(layout)
    if (sig !== this._layoutSig) {
      this._layoutSig = sig
      this._rebuildGraph()
    }
    this._applyFocus()
  }

  /**
   * Suppresses the panel while a full-screen overlay owns the viewport
   * (Context DSL demo: the StoryBar covers the panel region, and showing the
   * link graph early would spoil the staged step-⑤ reveal). Auto-visibility
   * resumes when released.
   * @param {boolean} hidden
   */
  setForceHidden(hidden) {
    this._forceHidden = hidden
    this._applyVisibility()
  }

  /**
   * Sole writer of every display style in the panel (PHILOSOPHY #4).
   *
   * The two axes are independent and both land here: `forceHidden`/`hasContent`
   * decide whether the panel exists on screen, `collapsed` decides whether the
   * body inside it does. They used to have separate writers (`_toggleCollapse`
   * wrote the canvas's display directly), which is how a shared visual flag drifts.
   */
  _applyVisibility() {
    this._panelEl.style.display = (this._hasContent && !this._forceHidden) ? 'flex' : 'none'
    this._bodyEl.style.display  = this._collapsed ? 'none' : 'flex'
  }

  /**
   * Highlights the nodes carrying the given ENTITY ids. A fused node is
   * highlighted by either of its two members (ADR-094 E1) — the mapping is the
   * layout's, resolved at render time so it always matches the current graph.
   */
  setSelection(ids) {
    const before = this._selectionEntityIds
    this._selectionEntityIds = new Set(ids)
    this._applyFocus()
    const changed = before.size !== this._selectionEntityIds.size ||
      [...this._selectionEntityIds].some(id => !before.has(id))
    if (changed) this._revealSelection()
  }

  /**
   * Scrolls the first selected node into view when it is outside the visible
   * part of the tree. The ONE writer of the container's scroll besides the user
   * (see class doc), and it writes only on a selection CHANGE — never on hover
   * or re-layout, so it cannot fight a user who is scrolling to look around.
   */
  _revealSelection() {
    if (this._collapsed || this._scrollEl.clientWidth === 0) return
    let target = null
    for (const entityId of this._selectionEntityIds) {
      const nodeId = this._nodeIdByEntity.get(entityId)
      if (nodeId != null) { target = this._nodes.get(nodeId); break }
    }
    if (!target) return
    const el = this._scrollEl
    const halfW = SLOT_W / 2
    if (target.x - halfW < el.scrollLeft || target.x + halfW > el.scrollLeft + el.clientWidth) {
      el.scrollLeft = Math.max(0, target.x - el.clientWidth / 2)
    }
    const top = target.y - NODE_R
    const bottom = target.y + LABEL_DY + (LABEL_LINES - 1) * LABEL_LINE_H + 2
    if (top < el.scrollTop || bottom > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, target.y - el.clientHeight / 2)
    }
  }

  /**
   * Adjusts the panel offsets per viewport and per bottom-edge occupancy.
   *
   * Neither offset is a literal here: both edges are shared resources whose
   * occupancy is computed by `EdgeOccupancy` alone (原則 #26). The left edge got
   * a second occupant in ADR-105 (the scene-checks HUD); the bottom edge got one
   * in ADR-106 (the floor). The panel used to be *deleted* when the floor opened
   * (`setForceHidden(true)` from `ContextController`) — that was one of the three
   * mutually-unaware workarounds for a single address collision. It now steps up
   * instead, which is why negotiating while reading the relation graph is possible
   * at all.
   *
   * @param {{isMobile: boolean, floorOpen?: boolean}} occupancy
   */
  setEdgeOffsets({ isMobile, floorOpen = false }) {
    this._panelEl.style.bottom =
      `${bottomEdgeOffset({ isMobile, tier: BOTTOM_TIER.FLOATING, floorOpen })}px`
    this._panelEl.style.left   = `${leftEdgeOffset({ isMobile })}px`
  }

  dispose() {
    this._panelEl.remove()
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  /**
   * Creates the elements. THE ONLY place that does — every other visual change
   * is an attribute write in `_applyFocus()` (ADR-099 §1).
   *
   * Called only when `layoutSignature()` says the picture changed, which is what
   * makes a row's `<g>` outlive the gesture aimed at it.
   */
  _rebuildGraph() {
    while (this._graphGrp.firstChild) this._graphGrp.removeChild(this._graphGrp.firstChild)
    this._nodeEls.clear()
    this._edgeEls.clear()
    if (this._nodes.size === 0) return

    // The SVG is as large as the tree; the container is capped and scrolls.
    // The scroll offsets are the container's — this path never writes them.
    this._svgEl.setAttribute('width',  this._contentW)
    this._svgEl.setAttribute('height', this._contentH)
    this._scrollEl.style.height = `${this._graphH}px`

    this._renderTreeElbows()
    this._buildCotreeArcs()
    this._buildNodes()
  }

  /**
   * Writes focus+context onto the existing elements. Creates and removes
   * nothing, so it is safe to call from a pointer handler (ADR-099 G3).
   *
   * Focus is the union of the panel-hovered node and the 3D selection. Selection
   * arrives as ENTITY ids; a fused node answers to both of its members, so it is
   * resolved through the layout's map (ADR-094 E1).
   */
  _applyFocus() {
    if (this._nodeEls.size === 0) return

    const focusIds = new Set()
    for (const entityId of this._selectionEntityIds) {
      const nodeId = this._nodeIdByEntity.get(entityId)
      if (nodeId != null) focusIds.add(nodeId)
    }
    if (this._hoveredId && this._nodes.has(this._hoveredId)) focusIds.add(this._hoveredId)
    const hasFocus = focusIds.size > 0
    // Nodes one cotree hop from a focused node — they stay at full contrast so
    // the neighbourhood reads as a unit.
    const neighborIds = new Set()
    if (hasFocus) {
      for (const edge of this._edges.values()) {
        if (focusIds.has(edge.source)) neighborIds.add(edge.target)
        if (focusIds.has(edge.target)) neighborIds.add(edge.source)
      }
    }

    for (const [id, edge] of this._edges) {
      const el = this._edgeEls.get(id)
      if (!el) continue                       // dropped edge — drawn as a "+N" badge
      // active: null = no focus (neutral), true = incident to focus, false = dimmed.
      const active = !hasFocus ? null : (focusIds.has(edge.source) || focusIds.has(edge.target))
      const dimmed = active === false
      el.setAttribute('stroke-width', String((edge.kinematic ? 1.8 : 1.2) + (active ? 0.5 : 0)))
      // Neutral opacities sit above the skeleton's: the arcs are the layer ON TOP
      // of the tree, and a coloured arc must not read fainter than the white line
      // it crosses (ADR-094 E2).
      el.setAttribute('stroke-opacity', String(
        dimmed ? 0.12 : active ? 0.95 : edge.kinematic ? 0.78 : 0.58))
      if (edge.directed && !dimmed) el.setAttribute('marker-end', `url(#lnv-arr-${edge.semanticType})`)
      else                          el.removeAttribute('marker-end')
    }

    for (const [id, els] of this._nodeEls) {
      const focused  = focusIds.has(id)                    // selected OR hovered
      const neighbor = neighborIds.has(id)
      const context  = hasFocus && !focused && !neighbor   // recede to background

      els.hit.setAttribute('fill', focused ? 'rgba(255,255,255,0.09)' : 'transparent')
      els.circle.setAttribute('r',            focused ? NODE_R + 1.5 : NODE_R)
      els.circle.setAttribute('fill-opacity', context ? '0.4' : '1')
      els.circle.setAttribute('stroke',       focused ? COLOR.accent : 'rgba(0,0,0,0.45)')
      els.circle.setAttribute('stroke-width', focused ? '1.2' : '0.8')
      els.text.setAttribute('fill',         focused ? COLOR.accent : '#c8c8c8')
      els.text.setAttribute('fill-opacity', context ? '0.45' : '1')
    }
  }

  /**
   * Tree edges as org-chart elbows: a stem down from the parent (below its
   * label), a bar across the siblings, a drop into each child. The segments are
   * the layout's (`treeSegments`); this method only draws them.
   *
   * ADR-094 established that the tree is the skeleton and must be the most
   * legible line in the panel; ADR-167 changes only its *shape*.
   */
  _renderTreeElbows() {
    for (const seg of treeSegments(this._nodes)) {
      const line = document.createElementNS(SVG_NS, 'line')
      line.setAttribute('x1', seg.x1)
      line.setAttribute('y1', seg.y1)
      line.setAttribute('x2', seg.x2)
      line.setAttribute('y2', seg.y2)
      line.setAttribute('stroke',         TREE_STROKE)
      line.setAttribute('stroke-width',   String(TREE_WIDTH))
      line.setAttribute('stroke-linecap', 'round')
      if (seg.attached) line.setAttribute('stroke-dasharray', ATTACHED_DASH)
      this._graphGrp.appendChild(line)
    }
  }

  /**
   * Cotree edges as bows above the tree, one bow height per assigned lane.
   *
   * The lane is the layout's decision, not this method's — a deterministic
   * interval colouring over the canonical edge order, which is what keeps two
   * crossing constraints from swapping places when an unrelated link is deleted
   * and re-added. Edges the layout could not fit (`dropped`) are drawn by
   * `_buildNodes` as a "+N" badge instead of vanishing (原則 #11).
   *
   * Focus-dependent attributes (width, opacity, arrowhead) are NOT set here —
   * they belong to `_applyFocus()`, which runs against these same elements.
   */
  _buildCotreeArcs() {
    for (const [edgeId, edge] of this._edges) {
      if (edge.dropped || edge.tree) continue   // a tree-consumed link is its elbow
      const u = this._nodes.get(edge.source), v = this._nodes.get(edge.target)
      if (!u || !v) continue

      // A support that could not hang (or is contested) is not a SpatialLink —
      // it takes the skeleton's colour, not a semanticType's (ADR-168 S3).
      const color = edge.kind === 'link'
        ? '#' + (LINK_TYPE_COLORS[edge.semanticType] ?? 0x888888).toString(16).padStart(6, '0')
        : TREE_STROKE

      const el = document.createElementNS(SVG_NS, 'path')
      el.setAttribute('d', arcPath(edge, u, v))
      el.setAttribute('fill', 'none')
      el.setAttribute('stroke',       color)
      el.setAttribute('stroke-linecap', 'round')
      // Kinematic joints render solid (a real constraint); topological
      // annotations stay dashed (a conceptual relationship).
      if (!edge.kinematic) el.setAttribute('stroke-dasharray', '3.5 2.5')
      this._graphGrp.appendChild(el)
      this._edgeEls.set(edgeId, el)
    }
  }

  /**
   * One group per node: hit area, dot, label hanging under it, optional "+N".
   *
   * Labels cannot collide: the layout puts any two nodes on a level at least
   * one slot apart and truncates each label to its slot. The full name stays
   * reachable as the group's `<title>` (the hover tooltip).
   *
   * Focus-dependent attributes are left to `_applyFocus()` — this method decides
   * WHAT EXISTS, never how it currently reads (ADR-099 §1).
   */
  _buildNodes() {
    for (const [id, nd] of this._nodes) {
      const color = NODE_COLOR[nd.type] ?? NODE_COLOR.default

      const g = document.createElementNS(SVG_NS, 'g')
      g.style.cursor = 'pointer'
      g.addEventListener('click', () => this._onSelect?.(id))
      // Panel-hover drives focus+context (Tier A affordance — "these are the
      // links of this entity"); it never mutates the 3D selection.
      //
      // Both handlers are idempotent. `mouseleave` always was; `mouseenter` was
      // not, and with a rebuilding renderer behind it that asymmetry was the
      // loop (ADR-099 力学 1). The guard is kept as re-entry protection even
      // though `_applyFocus` no longer touches this element's existence.
      g.addEventListener('mouseenter', () => {
        if (this._hoveredId === id) return
        this._hoveredId = id
        this._applyFocus()
      })
      g.addEventListener('mouseleave', () => {
        if (this._hoveredId !== id) return
        this._hoveredId = null
        this._applyFocus()
      })

      const title = document.createElementNS(SVG_NS, 'title')
      title.textContent = nd.label
      g.appendChild(title)

      // The node's slot is the target — dot and label together.
      const hit = document.createElementNS(SVG_NS, 'rect')
      hit.setAttribute('x',      String(nd.x - SLOT_W / 2 + 1))
      hit.setAttribute('y',      String(nd.y - NODE_R - 3))
      hit.setAttribute('width',  String(SLOT_W - 2))
      hit.setAttribute('height', String(NODE_R + 3 + LABEL_DY + (LABEL_LINES - 1) * LABEL_LINE_H + 3))
      hit.setAttribute('fill',   'transparent')
      hit.setAttribute('rx',     '3')
      g.appendChild(hit)

      const circle = document.createElementNS(SVG_NS, 'circle')
      circle.setAttribute('cx',   nd.x)
      circle.setAttribute('cy',   nd.y)
      circle.setAttribute('r',    String(NODE_R))
      circle.setAttribute('fill', color)
      g.appendChild(circle)

      const text = document.createElementNS(SVG_NS, 'text')
      text.setAttribute('x',            nd.x)
      text.setAttribute('y',            nd.y + LABEL_DY)
      text.setAttribute('text-anchor',  'middle')
      text.setAttribute('fill',         '#c8c8c8')
      text.setAttribute('font-size',    String(LABEL_SIZE))
      text.setAttribute('font-family',  FONT)
      text.setAttribute('pointer-events', 'none')
      labelLines(nd.label, nd.labelW).forEach((line, i) => {
        const span = document.createElementNS(SVG_NS, 'tspan')
        span.setAttribute('x', nd.x)
        if (i > 0) span.setAttribute('dy', String(LABEL_LINE_H))
        span.textContent = line
        text.appendChild(span)
      })
      g.appendChild(text)

      // Links the lane budget could not fit. Counted, never silently dropped.
      if (nd.overflow > 0) {
        const more = document.createElementNS(SVG_NS, 'text')
        more.setAttribute('x',           String(nd.x + NODE_R + 2))
        more.setAttribute('y',           String(nd.y - 2))
        more.setAttribute('fill',        '#8a8a8a')
        more.setAttribute('font-size',   '7.5')
        more.setAttribute('font-family', FONT)
        more.setAttribute('pointer-events', 'none')
        more.textContent = `+${nd.overflow}`
        g.appendChild(more)
      }

      this._graphGrp.appendChild(g)
      this._nodeEls.set(id, { g, hit, circle, text })
    }
  }

  /**
   * Legend naming the edge classes (ADR-048 §2.2.1's decision,
   * finally drawn — ADR-094 E2). It is pinned below the scroll area, because a
   * key that scrolls away from the thing it explains is not a key.
   *
   * It answers the report that started ADR-048 §2.2.1 ("nodes look like they
   * have several parents"): the tree is single-parent, the coloured bows are
   * the constraint graph laid over it. ADR-168 S3 split the tree's line in two:
   * "TF parent" (defined on) and "attached" (fixed to / resting on).
   */
  _renderLegend() {
    while (this._legendEl.lastChild) this._legendEl.removeChild(this._legendEl.lastChild)
    const y = LEGEND_H - 4
    const swatch = (x, stroke, dash, treeDash = null) => {
      const line = document.createElementNS(SVG_NS, 'line')
      line.setAttribute('x1', x)
      line.setAttribute('y1', y - 2.5)
      line.setAttribute('x2', x + 13)
      line.setAttribute('y2', y - 2.5)
      line.setAttribute('stroke',       stroke)
      line.setAttribute('stroke-width', dash ? '1.2' : String(TREE_WIDTH))
      line.setAttribute('stroke-linecap', 'round')
      if (dash) line.setAttribute('stroke-dasharray', '3.5 2.5')
      else if (treeDash) line.setAttribute('stroke-dasharray', treeDash)
      this._legendEl.appendChild(line)
    }
    const caption = (x, txt) => {
      const text = document.createElementNS(SVG_NS, 'text')
      text.setAttribute('x', x)
      text.setAttribute('y', y)
      text.setAttribute('fill',        '#7b7b7b')
      text.setAttribute('font-size',   '7.5')
      text.setAttribute('font-family', FONT)
      text.setAttribute('pointer-events', 'none')
      text.textContent = txt
      this._legendEl.appendChild(text)
    }
    swatch(10, TREE_STROKE, false)
    caption(27, 'TF parent')
    // A thing hung by a fixed link or a support (ADR-168 S3) — same skeleton,
    // dashed, so "defined on" and "attached to" stay two readings.
    swatch(74, TREE_STROKE, false, ATTACHED_DASH)
    caption(91, 'attached')
    // The constraint swatch borrows a real semanticType colour rather than a
    // neutral grey, so the legend and the graph share one vocabulary.
    const linkColor = '#' + (LINK_TYPE_COLORS.mounts ?? 0x888888).toString(16).padStart(6, '0')
    swatch(138, linkColor, true)
    caption(155, 'constraint')
  }

  _toggleCollapse() {
    this._collapsed = !this._collapsed
    // The body's display belongs to `_applyVisibility()` (PHILOSOPHY #4) —
    // this handler owns the *axis*, never the pixel.
    this._applyVisibility()
    this._collapseBtn.textContent  = this._collapsed ? '+' : '−'
    this._collapseBtn.setAttribute('aria-label',
      this._collapsed ? 'Expand link network panel' : 'Collapse link network panel')
  }
}
