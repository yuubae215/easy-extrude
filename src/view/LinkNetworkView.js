// @ts-nocheck
/**
 * LinkNetworkView — 2D SVG overlay showing the SpatialLink graph.
 *
 * Renders a force-directed graph of all entities that participate in at
 * least one SpatialLink.  Nodes are color-coded by entity type; edges by
 * semanticType.  Directed edges carry an arrowhead and a marching-ants
 * animation.  Clicking a node selects the entity in the 3D viewport.
 *
 * Lifecycle: auto-visible when links exist, hidden when none.
 * The panel is collapsible via the header button (−/+).
 *
 * @see ADR-030 (SpatialLink architecture)
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
const PANEL_H = 152

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
    this._collapsed   = false

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
    this._svgEl.setAttribute('height', PANEL_H)
    Object.assign(this._svgEl.style, {
      display:    'block',
      width:      '100%',
      flexShrink: '0',
    })
    this._panelEl.appendChild(this._svgEl)

    // ── SVG defs: markers + CSS animation ──────────────────────────────────
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
    style.textContent = `
      @keyframes lnv-march {
        from { stroke-dashoffset: 14; }
        to   { stroke-dashoffset:  0; }
      }`
    defs.appendChild(style)

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
   * @param {Map<string, {name:string, type:string}>} entityInfos
   * @param {import('../domain/SpatialLink.js').SpatialLink[]} links
   */
  update(entityInfos, links) {
    // Preserve existing positions for layout stability across incremental changes.
    const prevPos = new Map()
    for (const [id, nd] of this._nodes) prevPos.set(id, { x: nd.x, y: nd.y })

    this._nodes.clear()
    this._edges.clear()

    const usedIds = new Set()
    for (const link of links) {
      usedIds.add(link.sourceId)
      usedIds.add(link.targetId)
    }

    for (const id of usedIds) {
      const info = entityInfos.get(id)
      if (!info) continue
      const prev = prevPos.get(id)
      this._nodes.set(id, {
        label: info.name,
        type:  info.type,
        x: prev?.x ?? 20 + Math.random() * (PANEL_W - 40),
        y: prev?.y ?? 20 + Math.random() * (PANEL_H - 40),
      })
    }

    for (const link of links) {
      if (!this._nodes.has(link.sourceId) || !this._nodes.has(link.targetId)) continue
      this._edges.set(link.id, {
        source:       link.sourceId,
        target:       link.targetId,
        semanticType: link.semanticType ?? 'connects',
        directed:     DIRECTED_TYPES.has(link.semanticType) || link.jointType != null,
      })
    }

    const hasContent = this._edges.size > 0
    this._panelEl.style.display = hasContent ? 'flex' : 'none'

    if (hasContent) {
      this._runLayout()
      this._renderSVG()
    }
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
   * Fruchterman-Reingold spring layout — runs synchronously for 180 iterations.
   * Position state is stored directly on node objects.
   */
  _runLayout() {
    const nodes   = [...this._nodes.values()]
    const edges   = [...this._edges.values()]
    const n = nodes.length
    if (n === 0) return
    if (n === 1) { nodes[0].x = PANEL_W / 2; nodes[0].y = PANEL_H / 2; return }

    const W  = PANEL_W - 24, H = PANEL_H - 20
    const cx = W / 2 + 12,  cy = H / 2 + 10
    // optimal pairwise distance
    const k  = Math.sqrt((W * H) / n) * 0.75

    const nodeById = new Map()
    for (const [id, nd] of this._nodes) nodeById.set(id, nd)

    let temp = W * 0.4
    // cool temperature to ~1 % of initial over 180 steps
    const cool = Math.pow(0.01, 1 / 180)

    for (let it = 0; it < 180; it++) {
      for (const nd of nodes) { nd.dx = 0; nd.dy = 0 }

      // Repulsion — all pairs
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const u = nodes[i], v = nodes[j]
          let dx = u.x - v.x, dy = u.y - v.y
          if (dx === 0 && dy === 0) { dx = Math.random() - 0.5; dy = Math.random() - 0.5 }
          const dist  = Math.sqrt(dx * dx + dy * dy) || 0.01
          const force = k * k / dist
          const fx = (dx / dist) * force, fy = (dy / dist) * force
          u.dx += fx; u.dy += fy
          v.dx -= fx; v.dy -= fy
        }
      }

      // Attraction — connected pairs
      for (const e of edges) {
        const u = nodeById.get(e.source), v = nodeById.get(e.target)
        if (!u || !v) continue
        const dx   = v.x - u.x, dy = v.y - u.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01
        const force = dist * dist / k
        const fx = (dx / dist) * force, fy = (dy / dist) * force
        u.dx += fx; u.dy += fy
        v.dx -= fx; v.dy -= fy
      }

      // Weak center gravity
      for (const nd of nodes) {
        nd.dx += (cx - nd.x) * 0.04
        nd.dy += (cy - nd.y) * 0.04
      }

      // Apply displacement, clamped by temperature
      for (const nd of nodes) {
        const len  = Math.sqrt(nd.dx * nd.dx + nd.dy * nd.dy) || 0.01
        const step = Math.min(len, temp)
        nd.x += (nd.dx / len) * step
        nd.y += (nd.dy / len) * step
        nd.x = Math.max(14, Math.min(W + 10, nd.x))
        nd.y = Math.max(14, Math.min(H + 8,  nd.y))
      }

      temp *= cool
    }
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  _renderSVG() {
    while (this._graphGrp.firstChild) this._graphGrp.removeChild(this._graphGrp.firstChild)
    if (this._nodes.size === 0) return

    const nodeById = new Map()
    for (const [id, nd] of this._nodes) nodeById.set(id, nd)

    // ── Edges ──────────────────────────────────────────────────────────────
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

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      line.setAttribute('x1', u.x + nx * R)
      line.setAttribute('y1', u.y + ny * R)
      line.setAttribute('x2', v.x - nx * pullback)
      line.setAttribute('y2', v.y - ny * pullback)
      line.setAttribute('stroke',           color)
      line.setAttribute('stroke-width',     '1.5')
      line.setAttribute('stroke-opacity',   '0.75')
      line.setAttribute('stroke-dasharray', '4 3')
      line.style.animation = 'lnv-march 1.4s linear infinite'
      if (edge.directed) {
        line.setAttribute('marker-end', `url(#lnv-arr-${edge.semanticType})`)
      }
      this._graphGrp.appendChild(line)
    }

    // ── Nodes ──────────────────────────────────────────────────────────────
    for (const [id, nd] of this._nodes) {
      const sel    = this._selectedIds.has(id)
      const color  = NODE_COLOR[nd.type] ?? NODE_COLOR.default
      const radius = sel ? 7 : 5

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
      g.style.cursor = 'pointer'
      g.addEventListener('click', () => this._onSelect?.(id))

      if (sel) {
        // Glow ring around selected node
        const glow = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
        glow.setAttribute('cx',             nd.x)
        glow.setAttribute('cy',             nd.y)
        glow.setAttribute('r',              radius + 4)
        glow.setAttribute('fill',           'none')
        glow.setAttribute('stroke',         color)
        glow.setAttribute('stroke-width',   '1.5')
        glow.setAttribute('stroke-opacity', '0.35')
        g.appendChild(glow)
      }

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      circle.setAttribute('cx',           nd.x)
      circle.setAttribute('cy',           nd.y)
      circle.setAttribute('r',            radius)
      circle.setAttribute('fill',         color)
      circle.setAttribute('stroke',       sel ? '#ffffff' : 'rgba(0,0,0,0.45)')
      circle.setAttribute('stroke-width', sel ? '1.5' : '0.8')

      const maxChars = 10
      const labelTxt = nd.label.length > maxChars
        ? nd.label.slice(0, maxChars - 1) + '…'
        : nd.label

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      text.setAttribute('x',           nd.x + radius + 3)
      text.setAttribute('y',           nd.y + 3.5)
      text.setAttribute('fill',        sel ? '#ffffff' : '#c0c0c0')
      text.setAttribute('font-size',   '8.5')
      text.setAttribute('font-family', 'system-ui, -apple-system, sans-serif')
      text.setAttribute('pointer-events', 'none')
      text.textContent = labelTxt

      g.appendChild(circle)
      g.appendChild(text)
      this._graphGrp.appendChild(g)
    }
  }

  _toggleCollapse() {
    this._collapsed = !this._collapsed
    this._svgEl.style.display      = this._collapsed ? 'none' : 'block'
    this._collapseBtn.textContent  = this._collapsed ? '+' : '−'
    this._collapseBtn.setAttribute('aria-label',
      this._collapsed ? 'Expand link network panel' : 'Collapse link network panel')
  }
}
