// @ts-nocheck
/**
 * LinkNetworkView — 2D SVG overlay drawing the scene's TF tree with the
 * SpatialLink constraints laid over it (ADR-094).
 *
 * The panel shows ONE graph with two edge classes: the CF tree is the kinematic
 * spanning tree and SpatialLinks are the cotree edges closing loops (ADR-038).
 * The tree carries the geometry — it is the **skeleton**, drawn as the most
 * legible line on the canvas — and the constraints ride above it as coloured
 * arcs, the "leftover" edges. A two-line legend names that pairing. This is the
 * reversal ADR-094 E2 made: containment lines used to be the faintest thing in
 * the panel, which is backwards for a view whose subject is the TF tree, and the
 * legend ADR-048 §2.2.1 decided on had never been drawn.
 *
 * Every node is a coordinate frame. A Solid and its auto body frame render as
 * ONE fused node (ADR-094 E1): the node's TF identity is the body frame, its
 * label is the Solid's name, clicking it selects the Solid (the body frame is
 * edit-locked, ADR-037 §4), and a 3D selection of *either* entity highlights it.
 * All of that resolution happens in `LinkNetworkLayout.computeLayout()`, which
 * is pure — this class does nothing but draw the result and route input.
 *
 * READABILITY (the "lines flying everywhere" fix): edges are static — there is
 * no idle animation. Every edge marching-ants at once carried no per-firing
 * information and read as chaos (PHILOSOPHY #30: motion must speak a fact or an
 * affordance, else it is noise). Legibility comes from *state*, not motion:
 * with a node focused (hover or selection), its incident edges brighten and the
 * rest dim to context, so "what connects to this entity" is answerable at a
 * glance; kinematic links (jointType ≠ null) read heavier than topological ones.
 *
 * Visibility is two orthogonal axes — `forceHidden` (an overlay owns the
 * viewport) × `collapsed` (the user's −/+ button) — and `_applyVisibility()` is
 * the sole writer of both (PHILOSOPHY #4). Flattening them into one enum would
 * make "the user collapsed the panel during the demo" unrepresentable.
 *
 * @see ADR-094 (TF tree regression), ADR-030 (SpatialLink), ADR-048 (layout)
 */
import { LINK_TYPE_COLORS } from './SpatialLinkView.js'
import {
  computeLayout, PANEL_W, MIN_PANEL_H, LEGEND_H,
} from './LinkNetworkLayout.js'

/** Node fill color by entity type (matches AppController type strings). */
const NODE_COLOR = {
  cuboid:         '#60A5FA',
  frame:          '#FB923C',
  measure:        '#A78BFA',
  imported:       '#94A3B8',
  sketch:         '#FCD34D',
  'annot-line':   '#34D399',
  'annot-region': '#34D399',
  'annot-point':  '#34D399',
  default:        '#9CA3AF',
}

/** Tree edge (TF parent → child): the skeleton, the most legible line here. */
const TREE_STROKE = 'rgba(255,255,255,0.62)'
const TREE_WIDTH  = 1.6

export class LinkNetworkView {
  /**
   * @param {(id: string) => void} onSelectEntity  Called when a node is clicked.
   */
  constructor(onSelectEntity) {
    this._onSelect    = onSelectEntity
    /** @type {Map<string, import('./LinkNetworkLayout.js').LayoutNode>} laid-out nodes */
    this._nodes       = new Map()
    /** @type {Map<string, {source:string, target:string, semanticType:string, directed:boolean}>} */
    this._edges       = new Map()
    /**
     * entity id → node id. A fused node is reachable from BOTH the Solid and its
     * body frame, so a 3D selection of either highlights it (ADR-094 E1).
     * @type {Map<string, string>}
     */
    this._nodeIdByEntity = new Map()
    /** 3D selection as ENTITY ids — mapped to node ids at render time, so a
     *  selection set before the next layout is not stale. */
    this._selectedIds = new Set()
    /** Node currently hovered in the panel — drives focus+context with selection. */
    this._hoveredId   = null
    this._collapsed   = false
    /** Current SVG height — MIN_PANEL_H, or MAX_PANEL_H for 3+ layers. */
    this._svgH        = MIN_PANEL_H
    /** Graph area height (SVG minus the legend strip). */
    this._graphH      = MIN_PANEL_H - LEGEND_H
    /** True when rows are too crowded for labels (selection still labelled). */
    this._denseMode   = false
    /** True while an overlay (e.g. the Context DSL demo) suppresses the panel. */
    this._forceHidden = false
    /** Cached link-existence flag from the last update() — drives auto-visibility. */
    this._hasContent  = false

    this._buildDOM()
  }

  // ── DOM construction ────────────────────────────────────────────────────────

  _buildDOM() {
    this._panelEl = document.createElement('div')
    Object.assign(this._panelEl.style, {
      position:        'fixed',
      bottom:          '8px',
      left:            '8px',
      width:           `${PANEL_W}px`,
      background:      'rgba(20, 20, 22, 0.93)',
      border:          '1px solid rgba(255,255,255,0.10)',
      borderRadius:    '8px',
      zIndex:          '50',
      display:         'none',
      flexDirection:   'column',
      backdropFilter:  'blur(8px)',
      fontFamily:      'system-ui, -apple-system, sans-serif',
      overflow:        'hidden',
      userSelect:      'none',
      boxShadow:       '0 4px 20px rgba(0,0,0,0.45)',
      pointerEvents:   'auto',
    })
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

    // ── SVG canvas ──────────────────────────────────────────────────────────
    this._svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    this._svgEl.setAttribute('width',  PANEL_W)
    this._svgEl.setAttribute('height', MIN_PANEL_H)
    Object.assign(this._svgEl.style, {
      display:    'block',
      width:      '100%',
      flexShrink: '0',
    })
    this._panelEl.appendChild(this._svgEl)

    // ── SVG defs: arrowhead markers ────────────────────────────────────────
    // Edges are static (no idle animation) — legibility is carried by
    // focus+context styling, not motion (see class doc / PHILOSOPHY #30).
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')

    for (const [type, colorInt] of Object.entries(LINK_TYPE_COLORS)) {
      const hex    = '#' + colorInt.toString(16).padStart(6, '0')
      const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker')
      marker.setAttribute('id',          `lnv-arr-${type}`)
      marker.setAttribute('markerWidth', '7')
      marker.setAttribute('markerHeight','7')
      marker.setAttribute('refX',        '6')
      marker.setAttribute('refY',        '3.5')
      marker.setAttribute('orient',      'auto')
      marker.setAttribute('markerUnits', 'userSpaceOnUse')
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('d',    'M0,0 L0,7 L7,3.5 z')
      path.setAttribute('fill', hex)
      path.setAttribute('opacity', '0.85')
      marker.appendChild(path)
      defs.appendChild(marker)
    }

    this._svgEl.appendChild(defs)

    // Graph container group
    this._graphGrp = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    this._svgEl.appendChild(this._graphGrp)
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Rebuilds the graph from current scene state.
   * @param {Map<string, {name:string, type:string, parentId?:string|null}>} entityInfos
   * @param {import('../domain/SpatialLink.js').SpatialLink[]} links
   */
  update(entityInfos, links) {
    // All graph derivation — fusion, ancestor expansion, layering, positions —
    // is the pure layout's job (ADR-094 E3). Nothing here reads or writes it.
    const layout = computeLayout(entityInfos, links)
    this._nodes          = layout.nodes
    this._edges          = layout.edges
    this._nodeIdByEntity = layout.nodeIdByEntity
    this._svgH           = layout.svgH
    this._graphH         = layout.graphH
    this._denseMode      = layout.denseMode

    this._hasContent = layout.edges.size > 0
    this._applyVisibility()

    if (this._hasContent) this._renderSVG()
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
   * canvas inside it does. They used to have separate writers (`_toggleCollapse`
   * wrote the SVG's display directly), which is how a shared visual flag drifts.
   */
  _applyVisibility() {
    this._panelEl.style.display = (this._hasContent && !this._forceHidden) ? 'flex' : 'none'
    this._svgEl.style.display   = this._collapsed ? 'none' : 'block'
  }

  /**
   * Highlights the nodes carrying the given ENTITY ids. A fused node is
   * highlighted by either of its two members (ADR-094 E1) — the mapping is the
   * layout's, resolved at render time so it always matches the current graph.
   */
  setSelection(ids) {
    this._selectedIds = new Set(ids)
    this._renderSVG()
  }

  /**
   * Adjusts the panel offsets per viewport.
   * Bottom: clears the mobile toolbar (60px) + info bar (26px) on mobile, and
   * the 26px info bar on desktop.
   * Left: on desktop the Outliner sidebar (180px, z:90, opaque) permanently
   * occupies the left edge — sit beside it, never behind it. On mobile the
   * Outliner is a drawer (hidden by default), so the edge itself is free.
   * @param {boolean} isMobile
   */
  setMobile(isMobile) {
    this._panelEl.style.bottom = isMobile ? '94px' : '34px'
    this._panelEl.style.left   = isMobile ? '8px'  : '188px'
  }

  dispose() {
    this._panelEl.remove()
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  _renderSVG() {
    while (this._graphGrp.firstChild) this._graphGrp.removeChild(this._graphGrp.firstChild)
    if (this._nodes.size === 0) return

    this._svgEl.setAttribute('height', this._svgH)

    // Focus+context: the union of the panel-hovered node and the 3D selection.
    // When non-empty, incident edges brighten and the rest recede to context;
    // when empty, edges render in a calm neutral state. This is the state
    // signal that replaces the old idle marching animation (PHILOSOPHY #30).
    // Selection arrives as entity ids; a fused node answers to both of its
    // members, so it is resolved through the layout's map (ADR-094 E1).
    const focusIds = new Set()
    for (const entityId of this._selectedIds) {
      const nodeId = this._nodeIdByEntity.get(entityId)
      if (nodeId != null) focusIds.add(nodeId)
    }
    if (this._hoveredId && this._nodes.has(this._hoveredId)) focusIds.add(this._hoveredId)
    const hasFocus = focusIds.size > 0
    // Nodes one hop from a focused node — their labels stay legible in dense mode.
    const neighborIds = new Set()
    if (hasFocus) {
      for (const edge of this._edges.values()) {
        if (focusIds.has(edge.source)) neighborIds.add(edge.target)
        if (focusIds.has(edge.target)) neighborIds.add(edge.source)
      }
    }

    // ── Tree edges (TF parent → child) — the skeleton ──────────────────────
    // Solid, unbroken, and the brightest neutral line in the panel: this is the
    // kinematic spanning tree the whole view is about, so it must read as
    // structure at a glance (ADR-094 E2 — the old faint hairline said the
    // opposite). Still no dash, no arrowhead, no marching ants: those encode
    // SpatialLink semantics (ADR-030/038), and the tree's direction is already
    // carried by the vertical axis, which now means TF depth and nothing else.
    for (const [id, nd] of this._nodes) {
      const parent = nd.parentId != null ? this._nodes.get(nd.parentId) : null
      if (!parent) continue
      const dx   = nd.x - parent.x, dy = nd.y - parent.y
      const dist = Math.sqrt(dx * dx + dy * dy) || 1
      const nx   = dx / dist, ny = dy / dist
      const R    = 5
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      line.setAttribute('x1', parent.x + nx * R)
      line.setAttribute('y1', parent.y + ny * R)
      line.setAttribute('x2', nd.x - nx * R)
      line.setAttribute('y2', nd.y - ny * R)
      line.setAttribute('stroke',       TREE_STROKE)
      line.setAttribute('stroke-width', String(TREE_WIDTH))
      line.setAttribute('stroke-linecap', 'round')
      this._graphGrp.appendChild(line)
    }

    // ── SpatialLink edges ──────────────────────────────────────────────────
    // All edges are quadratic curves: same-row links bow away from their row
    // (a straight line would run through every sibling between the endpoints),
    // and cross-layer links bow to the RIGHT of travel so A→B and B→A separate
    // instead of stacking into one ambiguous line. Static styling only — width
    // and opacity encode importance (kinematic vs topological) and focus.
    for (const [, edge] of this._edges) {
      const u = this._nodes.get(edge.source), v = this._nodes.get(edge.target)
      if (!u || !v) continue

      const colorInt = LINK_TYPE_COLORS[edge.semanticType] ?? 0x888888
      const color    = '#' + colorInt.toString(16).padStart(6, '0')

      const dx   = v.x - u.x, dy = v.y - u.y
      const dist = Math.sqrt(dx * dx + dy * dy) || 1
      const nx   = dx / dist, ny = dy / dist
      const R    = 5
      const pullback = edge.directed ? R + 7 : R

      const x1 = u.x + nx * R,        y1 = u.y + ny * R
      const x2 = v.x - nx * pullback, y2 = v.y - ny * pullback

      let cx, cy
      if (u.layer === v.layer && u !== v) {
        const bow = u.layer === 0 ? -14 : 14
        cx = (x1 + x2) / 2
        cy = (y1 + y2) / 2 + bow
      } else {
        const curve = Math.min(Math.max(dist * 0.16, 6), 18)
        cx = (x1 + x2) / 2 - ny * curve   // perpendicular, right of travel
        cy = (y1 + y2) / 2 + nx * curve
      }

      // active: null = no focus (neutral), true = incident to focus, false = dimmed.
      const active = !hasFocus ? null : (focusIds.has(edge.source) || focusIds.has(edge.target))
      const dimmed = active === false

      const el = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      el.setAttribute('d', `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`)
      el.setAttribute('fill', 'none')
      el.setAttribute('stroke',         color)
      el.setAttribute('stroke-width',   String((edge.kinematic ? 2 : 1.3) + (active ? 0.5 : 0)))
      // Neutral opacities sit above the skeleton's, not below it: the arcs are
      // the layer ON TOP of the tree, and a coloured arc must not read fainter
      // than the white line it crosses (ADR-094 E2).
      el.setAttribute('stroke-opacity', String(
        dimmed ? 0.12 : active ? 0.95 : edge.kinematic ? 0.78 : 0.58))
      el.setAttribute('stroke-linecap', 'round')
      // Kinematic joints render solid (a real constraint); topological
      // annotations stay dashed (a conceptual relationship).
      if (!edge.kinematic) el.setAttribute('stroke-dasharray', '4 3')
      if (edge.directed && !dimmed) {
        el.setAttribute('marker-end', `url(#lnv-arr-${edge.semanticType})`)
      }
      this._graphGrp.appendChild(el)
    }

    // ── Nodes ──────────────────────────────────────────────────────────────
    // Label placement: flip to the node's left side near the right edge, clamp
    // inside the panel, and greedily shift down/up to avoid label-label overlap
    // — without this, labels of right-edge nodes are clipped by the SVG bounds
    // and labels of nearby nodes render on top of each other.
    /** @type {{x1:number,y1:number,x2:number,y2:number}[]} placed label boxes */
    const placedLabels = []
    const LABEL_H = 9   // approx line height at font-size 8.5

    for (const [id, nd] of this._nodes) {
      const focused  = focusIds.has(id)                    // selected OR hovered
      const neighbor = neighborIds.has(id)
      const context  = hasFocus && !focused && !neighbor   // recede to background
      const color    = NODE_COLOR[nd.type] ?? NODE_COLOR.default
      const radius   = focused ? 7 : 5

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
      g.style.cursor = 'pointer'
      g.addEventListener('click', () => this._onSelect?.(id))
      // Panel-hover drives focus+context (Tier A affordance — "these are the
      // links of this entity"); it never mutates the 3D selection.
      g.addEventListener('mouseenter', () => { this._hoveredId = id; this._renderSVG() })
      g.addEventListener('mouseleave', () => {
        if (this._hoveredId === id) { this._hoveredId = null; this._renderSVG() }
      })

      if (focused) {
        // Glow ring around the focused node
        const glow = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
        glow.setAttribute('cx',             nd.x)
        glow.setAttribute('cy',             nd.y)
        glow.setAttribute('r',              radius + 4)
        glow.setAttribute('fill',           'none')
        glow.setAttribute('stroke',         color)
        glow.setAttribute('stroke-width',   '1.5')
        glow.setAttribute('stroke-opacity', '0.4')
        g.appendChild(glow)
      }

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      circle.setAttribute('cx',           nd.x)
      circle.setAttribute('cy',           nd.y)
      circle.setAttribute('r',            radius)
      circle.setAttribute('fill',         color)
      circle.setAttribute('fill-opacity', context ? '0.4' : '1')
      circle.setAttribute('stroke',       focused ? '#ffffff' : 'rgba(0,0,0,0.45)')
      circle.setAttribute('stroke-width', focused ? '1.5' : '0.8')

      // Crowded rows degrade to a dot strip — but the focused node and its
      // neighbours keep their labels so the local neighbourhood stays readable
      // without growing the panel (clicking any dot still reveals its name).
      if (this._denseMode && !focused && !neighbor) {
        g.appendChild(circle)
        this._graphGrp.appendChild(g)
        continue
      }

      const maxChars = 10
      const labelTxt = nd.label.length > maxChars
        ? nd.label.slice(0, maxChars - 1) + '…'
        : nd.label
      const labelW = this._estimateTextWidth(labelTxt)

      // Horizontal: right of node by default; left when it would clip the
      // right edge; clamped into the panel as a last resort.
      let anchor = 'start'
      let lx     = nd.x + radius + 3
      if (lx + labelW > PANEL_W - 2) {
        if (nd.x - radius - 3 - labelW >= 2) {
          anchor = 'end'
          lx     = nd.x - radius - 3
        } else {
          lx = Math.max(2, PANEL_W - 2 - labelW)
        }
      }

      // Vertical: try baseline, then below, above, twice-below — first
      // candidate that doesn't intersect an already-placed label wins.
      const boxFor = (y) => anchor === 'start'
        ? { x1: lx,          y1: y - LABEL_H + 1, x2: lx + labelW, y2: y + 1 }
        : { x1: lx - labelW, y1: y - LABEL_H + 1, x2: lx,          y2: y + 1 }
      const intersects = (b) => placedLabels.some(p =>
        b.x1 < p.x2 && b.x2 > p.x1 && b.y1 < p.y2 && b.y2 > p.y1)

      let ly = nd.y + 3.5
      for (const dy of [0, LABEL_H, -LABEL_H, LABEL_H * 2]) {
        // Clamped to the GRAPH area — a label must never fall into the legend
        // strip, where it would read as a third legend entry.
        const cand = Math.min(Math.max(nd.y + 3.5 + dy, LABEL_H), this._graphH - 2)
        if (!intersects(boxFor(cand))) { ly = cand; break }
        ly = cand   // all candidates collide → keep the last (least-bad) one
      }
      placedLabels.push(boxFor(ly))

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      text.setAttribute('x',           lx)
      text.setAttribute('y',           ly)
      text.setAttribute('text-anchor', anchor)
      text.setAttribute('fill',        focused ? '#ffffff' : '#c0c0c0')
      text.setAttribute('fill-opacity', context ? '0.45' : '1')
      text.setAttribute('font-size',   '8.5')
      text.setAttribute('font-family', 'system-ui, -apple-system, sans-serif')
      text.setAttribute('pointer-events', 'none')
      text.textContent = labelTxt

      g.appendChild(circle)
      g.appendChild(text)
      this._graphGrp.appendChild(g)
    }

    this._renderLegend()
  }

  /**
   * Two-line legend naming the two edge classes (ADR-048 §2.2.1's decision,
   * finally drawn — ADR-094 E2).
   *
   * It answers the report that started ADR-048 §2.2.1 ("nodes look like they
   * have several parents"): the tree is single-parent, the coloured arcs are the
   * constraint graph laid over it. After the fusion this is a confirmation
   * rather than an instruction manual — a picture that needs its manual read
   * first has not been fixed, which is why the legend alone was rejected as the
   * whole answer (ADR-094 Option F).
   */
  _renderLegend() {
    const y = this._svgH - 5
    const swatch = (x, stroke, dash) => {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      line.setAttribute('x1', x)
      line.setAttribute('y1', y - 2.5)
      line.setAttribute('x2', x + 13)
      line.setAttribute('y2', y - 2.5)
      line.setAttribute('stroke',       stroke)
      line.setAttribute('stroke-width', dash ? '1.3' : String(TREE_WIDTH))
      line.setAttribute('stroke-linecap', 'round')
      if (dash) line.setAttribute('stroke-dasharray', '4 3')
      this._graphGrp.appendChild(line)
    }
    const caption = (x, txt) => {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      text.setAttribute('x', x)
      text.setAttribute('y', y)
      text.setAttribute('fill',        '#7b7b7b')
      text.setAttribute('font-size',   '7.5')
      text.setAttribute('font-family', 'system-ui, -apple-system, sans-serif')
      text.setAttribute('pointer-events', 'none')
      text.textContent = txt
      this._graphGrp.appendChild(text)
    }
    swatch(10, TREE_STROKE, false)
    caption(27, 'TF parent')
    // The constraint swatch borrows a real semanticType colour rather than a
    // neutral grey, so the legend and the graph share one vocabulary.
    const linkColor = '#' + (LINK_TYPE_COLORS.mounts ?? 0x888888).toString(16).padStart(6, '0')
    swatch(108, linkColor, true)
    caption(125, 'constraint')
  }

  /**
   * Approximate rendered width of a label at font-size 8.5px.
   * CJK glyphs are full-width (≈ the font size); Latin/ASCII ≈ 0.55×.
   * @param {string} str
   * @returns {number} estimated width in px
   */
  _estimateTextWidth(str) {
    let w = 0
    for (const ch of str) w += ch.charCodeAt(0) > 0xff ? 8.5 : 4.7
    return w
  }

  _toggleCollapse() {
    this._collapsed = !this._collapsed
    // The canvas's display belongs to `_applyVisibility()` (PHILOSOPHY #4) —
    // this handler owns the *axis*, never the pixel.
    this._applyVisibility()
    this._collapseBtn.textContent  = this._collapsed ? '+' : '−'
    this._collapseBtn.setAttribute('aria-label',
      this._collapsed ? 'Expand link network panel' : 'Collapse link network panel')
  }
}
