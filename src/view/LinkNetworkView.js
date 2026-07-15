// @ts-nocheck
/**
 * LinkNetworkView — 2D SVG overlay showing the SpatialLink graph.
 *
 * Renders a deterministic layered hierarchy of all entities that participate
 * in at least one SpatialLink, plus their ancestor entities (a linked CF is
 * anchored under its parent Solid even when the Solid itself has no link).
 * Layer 0 holds root entities (Solids, annotations); each CF sits one row
 * below its parent. Parent-child structure is drawn as faint static lines;
 * SpatialLinks keep their semanticType colors and arrowheads and curve gently
 * so opposite-direction edges separate instead of overlapping. Same scene →
 * same pixels, every update (no force simulation, no random scatter).
 * Clicking a node selects the entity in the 3D viewport; hovering it (or a
 * 3D selection) puts the graph into FOCUS+CONTEXT mode.
 *
 * READABILITY (the "lines flying everywhere" fix): edges are static — there is
 * no idle animation. Every edge marching-ants at once carried no per-firing
 * information and read as chaos (PHILOSOPHY #30: motion must speak a fact or an
 * affordance, else it is noise). Legibility now comes from *state*, not motion:
 * with a node focused (hover or selection), its incident edges brighten and the
 * rest dim to context, so "what connects to this entity" is answerable at a
 * glance; kinematic links (jointType ≠ null) read heavier than topological ones.
 *
 * Lifecycle: auto-visible when links exist, hidden when none.
 * The panel is collapsible via the header button (−/+).
 *
 * @see ADR-030 (SpatialLink architecture), ADR-048 (layered layout)
 */
import { LINK_TYPE_COLORS } from './SpatialLinkView.js'

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

/** semanticType values that carry a directional arrowhead. */
const DIRECTED_TYPES = new Set([
  'mounts', 'fastened', 'aligned', 'contains', 'above', 'references', 'represents',
])

const PANEL_W = 220
// SVG height: grows to MAX when the hierarchy has 3+ layers (Solid → Origin CF
// → user CF). Width never grows (left-edge occupancy contract). The MAX cap is
// set by the Map vertical toolbar, which shares the left:188px column
// (top:50%, ~259px tall): on a 720px viewport the panel top
// (720 − 34 bottom − 28 header − MAX) must stay below the toolbar's lower
// edge (~490px). 160 leaves ~8px clearance; measured via Playwright.
const MIN_PANEL_H = 152
const MAX_PANEL_H = 160
/** Max parentId hops when walking ancestor chains (cycle/corruption guard). */
const MAX_ANCESTOR_HOPS = 16

export class LinkNetworkView {
  /**
   * @param {(id: string) => void} onSelectEntity  Called when a node is clicked.
   */
  constructor(onSelectEntity) {
    this._onSelect    = onSelectEntity
    /** @type {Map<string, {label:string, type:string, x:number, y:number}>} */
    this._nodes       = new Map()
    /** @type {Map<string, {source:string, target:string, semanticType:string, directed:boolean}>} */
    this._edges       = new Map()
    this._selectedIds = new Set()
    /** Node currently hovered in the panel — drives focus+context with selection. */
    this._hoveredId   = null
    this._collapsed   = false
    /** Current SVG height — MIN_PANEL_H, or MAX_PANEL_H for 3+ layers. */
    this._svgH        = MIN_PANEL_H
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
    this._nodes.clear()
    this._edges.clear()

    const usedIds = new Set()
    for (const link of links) {
      usedIds.add(link.sourceId)
      usedIds.add(link.targetId)
    }

    // Include ancestor entities so every linked CF is anchored under its root
    // Solid — the root itself may carry no link (e.g. a fastened child CF
    // whose parent Solid is otherwise unreferenced).
    const includedIds = new Set()
    for (const id of usedIds) {
      let cur = id
      for (let hop = 0; hop < MAX_ANCESTOR_HOPS && cur != null; hop++) {
        if (includedIds.has(cur)) break
        if (!entityInfos.has(cur)) break
        includedIds.add(cur)
        cur = entityInfos.get(cur).parentId ?? null
      }
    }

    for (const id of includedIds) {
      const info = entityInfos.get(id)
      // Positions are always assigned by the deterministic layered layout —
      // no random seed, no carry-over from the previous update.
      this._nodes.set(id, {
        label:    info.name,
        type:     info.type,
        parentId: info.parentId ?? null,
        layer:    0,
        x: 0,
        y: 0,
      })
    }

    for (const link of links) {
      if (!this._nodes.has(link.sourceId) || !this._nodes.has(link.targetId)) continue
      this._edges.set(link.id, {
        source:       link.sourceId,
        target:       link.targetId,
        semanticType: link.semanticType ?? 'connects',
        directed:     DIRECTED_TYPES.has(link.semanticType) || link.jointType != null,
        // Kinematic links (a real URDF joint) read heavier than topological
        // annotations (adjacent/contains/…, jointType === null).
        kinematic:    link.jointType != null,
      })
    }

    const hasContent = this._edges.size > 0
    this._hasContent = hasContent
    this._applyVisibility()

    if (hasContent) {
      this._runLayout()
      this._renderSVG()
    }
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

  /** Sole writer of the panel's display style (PHILOSOPHY #4). */
  _applyVisibility() {
    this._panelEl.style.display = (this._hasContent && !this._forceHidden) ? 'flex' : 'none'
  }

  /** Highlights nodes whose IDs are in the provided selection set. */
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

  // ── Layout ──────────────────────────────────────────────────────────────────

  /**
   * Deterministic layered hierarchy layout (ADR-048).
   *
   * Layer = parentId depth among included nodes (roots at 0, CFs below their
   * parent). X order: roots stable-sorted by (name, id), refined by one
   * barycenter pass over SpatialLink partners; children grouped under their
   * parent's x with min-gap sweeps. The output is a pure function of the
   * input graph — identical scene state yields identical pixels, which
   * replaces the old force layout's `prevPos` carry-over as the stability
   * mechanism.
   *
   * Side outputs (read by `_renderSVG()`): `nd.layer`, `this._svgH`,
   * `this._denseMode`, and `this._nodes` rebuilt in left-to-right /
   * top-to-bottom order so greedy label placement resolves deterministically.
   */
  _runLayout() {
    const ids = [...this._nodes.keys()]
    const n = ids.length
    if (n === 0) return

    // ── Layer assignment (memoized parentId walk) ───────────────────────────
    const layerOf = (id, hop = 0) => {
      const nd = this._nodes.get(id)
      const pid = nd.parentId
      if (hop >= MAX_ANCESTOR_HOPS || pid == null || !this._nodes.has(pid)) return 0
      return 1 + layerOf(pid, hop + 1)
    }
    let maxLayer = 0
    for (const id of ids) {
      const layer = layerOf(id)
      this._nodes.get(id).layer = layer
      maxLayer = Math.max(maxLayer, layer)
    }
    const L = maxLayer + 1

    // ── Vertical: panel height + row positions ──────────────────────────────
    this._svgH = L >= 3 ? MAX_PANEL_H : MIN_PANEL_H
    const TOP = 24, BOT = 26
    const rowY = (layer) =>
      L === 1 ? this._svgH / 2 : TOP + layer * (this._svgH - TOP - BOT) / (L - 1)

    // ── Roots: stable (name, id) order + one barycenter refinement pass ─────
    const byNameId = (a, b) => {
      const na = this._nodes.get(a).label, nb = this._nodes.get(b).label
      return na < nb ? -1 : na > nb ? 1 : a < b ? -1 : a > b ? 1 : 0
    }
    const rootOf = (id) => {
      let cur = id
      for (let hop = 0; hop < MAX_ANCESTOR_HOPS; hop++) {
        const pid = this._nodes.get(cur)?.parentId
        if (pid == null || !this._nodes.has(pid)) return cur
        cur = pid
      }
      return cur
    }
    let roots = ids.filter(id => this._nodes.get(id).layer === 0).sort(byNameId)
    const initialIdx = new Map(roots.map((id, i) => [id, i]))
    const bary = new Map()
    for (const id of roots) {
      const partners = []
      for (const e of this._edges.values()) {
        const ru = rootOf(e.source), rv = rootOf(e.target)
        if (ru === id && rv !== id) partners.push(initialIdx.get(rv))
        if (rv === id && ru !== id) partners.push(initialIdx.get(ru))
      }
      bary.set(id, partners.length
        ? partners.reduce((s, v) => s + v, 0) / partners.length
        : initialIdx.get(id))
    }
    roots = roots.sort((a, b) => (bary.get(a) - bary.get(b)) || byNameId(a, b))

    const MARGIN = 12
    const W = PANEL_W - 2 * MARGIN
    const rootSlot = W / roots.length
    roots.forEach((id, i) => {
      const nd = this._nodes.get(id)
      nd.x = MARGIN + (i + 0.5) * rootSlot
      nd.y = rowY(0)
    })

    // ── Child rows: group under parent x, then min-gap sweeps ───────────────
    let maxRowCount = roots.length
    for (let layer = 1; layer < L; layer++) {
      const row = ids.filter(id => this._nodes.get(id).layer === layer)
      maxRowCount = Math.max(maxRowCount, row.length)
      // Group order by parent's x, then stable (name, id) within the group.
      row.sort((a, b) => {
        const pa = this._nodes.get(this._nodes.get(a).parentId)
        const pb = this._nodes.get(this._nodes.get(b).parentId)
        return (pa.x - pb.x) || byNameId(a, b)
      })
      // Ideal: spread each sibling group around the parent's x.
      const groupIndex = new Map()
      for (const id of row) {
        const pid = this._nodes.get(id).parentId
        if (!groupIndex.has(pid)) groupIndex.set(pid, [])
        groupIndex.get(pid).push(id)
      }
      for (const [pid, members] of groupIndex) {
        const px = this._nodes.get(pid).x
        members.forEach((id, j) => {
          this._nodes.get(id).x = px + (j - (members.length - 1) / 2) * 20
        })
      }
      // Left-to-right min-gap sweep, then right-to-left to fix edge pileup.
      const minGap = 16
      for (let i = 0; i < row.length; i++) {
        const nd = this._nodes.get(row[i])
        const prev = i > 0 ? this._nodes.get(row[i - 1]).x + minGap : MARGIN
        nd.x = Math.max(nd.x, prev)
        nd.y = rowY(layer)
      }
      for (let i = row.length - 1; i >= 0; i--) {
        const nd = this._nodes.get(row[i])
        const next = i < row.length - 1
          ? this._nodes.get(row[i + 1]).x - minGap
          : PANEL_W - MARGIN
        nd.x = Math.min(nd.x, next)
      }
      for (let i = 0; i < row.length; i++) {
        const nd = this._nodes.get(row[i])
        nd.x = Math.max(MARGIN, Math.min(PANEL_W - MARGIN, nd.x))
      }
    }

    // Dense scenes degrade to a labelled-on-selection dot strip (ADR-048 §MVP).
    this._denseMode = W / maxRowCount < 22

    // Rebuild the node Map in render order (top-to-bottom, left-to-right) so
    // the greedy label pass in _renderSVG resolves left-neighbor-first.
    const ordered = ids.sort((a, b) => {
      const u = this._nodes.get(a), v = this._nodes.get(b)
      return (u.layer - v.layer) || (u.x - v.x) || byNameId(a, b)
    })
    const rebuilt = new Map()
    for (const id of ordered) rebuilt.set(id, this._nodes.get(id))
    this._nodes = rebuilt
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  _renderSVG() {
    while (this._graphGrp.firstChild) this._graphGrp.removeChild(this._graphGrp.firstChild)
    if (this._nodes.size === 0) return

    this._svgEl.setAttribute('height', this._svgH)

    const nodeById = new Map()
    for (const [id, nd] of this._nodes) nodeById.set(id, nd)

    // Focus+context: the union of the panel-hovered node and the 3D selection.
    // When non-empty, incident edges brighten and the rest recede to context;
    // when empty, edges render in a calm neutral state. This is the state
    // signal that replaces the old idle marching animation (PHILOSOPHY #30).
    const focusIds = new Set(this._selectedIds)
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

    // ── Hierarchy edges (parent → child, structural) ───────────────────────
    // Faint static lines underneath the SpatialLink layer: containment is
    // scaffolding, not a semantic relationship — no dash, no marching ants,
    // no arrowhead (those encode SpatialLink semantics, ADR-030/038).
    for (const [id, nd] of this._nodes) {
      const parent = nd.parentId != null ? nodeById.get(nd.parentId) : null
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
      line.setAttribute('stroke',       'rgba(255,255,255,0.18)')
      line.setAttribute('stroke-width', '1')
      this._graphGrp.appendChild(line)
    }

    // ── SpatialLink edges ──────────────────────────────────────────────────
    // All edges are quadratic curves: same-row links bow away from their row
    // (a straight line would run through every sibling between the endpoints),
    // and cross-layer links bow to the RIGHT of travel so A→B and B→A separate
    // instead of stacking into one ambiguous line. Static styling only — width
    // and opacity encode importance (kinematic vs topological) and focus.
    for (const [, edge] of this._edges) {
      const u = nodeById.get(edge.source), v = nodeById.get(edge.target)
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
      el.setAttribute('stroke-opacity', String(
        dimmed ? 0.1 : active ? 0.95 : edge.kinematic ? 0.62 : 0.42))
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
        const cand = Math.min(Math.max(nd.y + 3.5 + dy, LABEL_H), this._svgH - 2)
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
    this._svgEl.style.display      = this._collapsed ? 'none' : 'block'
    this._collapseBtn.textContent  = this._collapsed ? '+' : '−'
    this._collapseBtn.setAttribute('aria-label',
      this._collapsed ? 'Expand link network panel' : 'Collapse link network panel')
  }
}
