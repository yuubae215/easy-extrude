/**
 * NodeEditorView — Unified Scene + Operation Graph panel (ADR-017, ADR-028, ADR-030).
 *
 * Phase B: OperationGraph from Geometry Service (WS graph.snapshot).
 * Phase S-1: Integrated scene graph via SceneService.getSceneGraph().
 *   - Entity nodes (Solid, Profile, CoordinateFrame, etc.) with type-based colors
 *   - Edge layers: frame (grey) | anchor (yellow) | spatial (linkType colors) | operation (blue/grey)
 *   - Layer filter toggles in the filter bar
 *   - Read-only display (Phase S-2 adds topology editing)
 */

const NODE_W = 140
const NODE_H = 48

// Colors for scene entity node borders/accents
const ENTITY_COLORS = {
  Solid:           '#3a7bd5',
  Profile:         '#8e44ad',
  CoordinateFrame: '#e74c3c',
  ImportedMesh:    '#e67e22',
  MeasureLine:     '#f1c40f',
  AnnotatedLine:   '#4a90d9',
  AnnotatedRegion: '#27ae60',
  AnnotatedPoint:  '#9b59b6',
}

// Colors for operation graph node types (BFF Geometry Service)
const OP_NODE_COLORS = {
  cuboid:     '#3a7bd5',
  sketch:     '#8e44ad',
  extrude:    '#27ae60',
  stepImport: '#e67e22',
  transform:  '#7f8c8d',
  default:    '#2c3e50',
}

// Edge visual styles per relation / linkType (ADR-030, ADR-032)
const EDGE_STYLE = {
  // Scene graph structural edges
  frame:      { color: '#95a5a6', dash: '6,3', width: 1.5, directed: true  },
  anchor:     { color: '#f1c40f', dash: '3,3', width: 1.5, directed: true  },
  // Spatial linkTypes — topological / semantic (ADR-030)
  references: { color: '#f39c12', dash: 'none', width: 1.5, directed: true  },
  connects:   { color: '#00bcd4', dash: 'none', width: 1.5, directed: false },
  contains:   { color: '#9c27b0', dash: 'none', width: 1.5, directed: true  },
  adjacent:   { color: '#607d8b', dash: 'none', width: 1.5, directed: false },
  // Spatial linkTypes — geometric binding (ADR-032)
  mounts:     { color: '#ff5722', dash: 'none', width: 2.0, directed: true  },
  fastened:   { color: '#ff9800', dash: 'none', width: 2.0, directed: false },
  aligned:    { color: '#8bc34a', dash: 'none', width: 2.0, directed: false },
  // Operation graph edges (Phase B, BFF)
  geometry:   { color: '#3a7bd5', dash: 'none', width: 1.5, directed: true  },
  control:    { color: '#7f8c8d', dash: '4,3',  width: 1.0, directed: false },
}

const SCENE_NODE_START_Y = 40   // scene entities occupy the upper canvas area
const OP_NODE_START_Y    = 280  // operation nodes appear below scene nodes

export class NodeEditorView {
  /**
   * @param {HTMLElement} container
   * @param {import('../service/SceneService.js').SceneService} sceneService
   */
  constructor(container, sceneService) {
    this._container     = container
    this._service       = sceneService
    this._opGraph       = { nodes: [], edges: [] }   // from WS graph.snapshot
    this._sceneGraph    = { nodes: [], edges: [] }   // from getSceneGraph()
    this._nodePositions = new Map()                  // id → { x, y }
    this._selectedId    = null
    this._visible       = false
    this._layerVisible  = { frame: true, anchor: true, spatial: true, operation: true }

    this._panel        = null
    this._svg          = null
    this._paramsPanel  = null
    this._wsStatus     = null
    this._layerBtns    = {}

    this._buildDOM()
    this._bindWsEvents()
    this._bindSceneEvents()
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  setVisible(visible) {
    this._visible = visible
    this._panel.style.display = visible ? 'flex' : 'none'
    if (visible) this.refreshSceneGraph()
  }

  toggle() {
    this.setVisible(!this._visible)
    return this._visible
  }

  /** Replaces the operation graph (from WS graph.snapshot). */
  setOpGraph(graph) {
    this._opGraph = graph
    graph.nodes.forEach((node, i) => {
      if (!this._nodePositions.has(node.id)) {
        this._nodePositions.set(node.id, {
          x: 40 + (i % 4) * (NODE_W + 40),
          y: OP_NODE_START_Y + Math.floor(i / 4) * (NODE_H + 32),
        })
      }
    })
    this._render()
  }

  /** Refreshes the scene entity display from SceneService.getSceneGraph(). */
  refreshSceneGraph() {
    const sg = this._service.getSceneGraph()
    this._sceneGraph = sg
    this._assignScenePositions(sg.nodes)
    // Remove stale position entries for deleted entities
    const live = new Set([
      ...sg.nodes.map(n => n.id),
      ...this._opGraph.nodes.map(n => n.id),
    ])
    for (const id of this._nodePositions.keys()) {
      if (!live.has(id)) this._nodePositions.delete(id)
    }
    this._render()
  }

  // ── Position assignment ─────────────────────────────────────────────────────

  _assignScenePositions(nodes) {
    const byId = new Map(nodes.map(n => [n.id, n]))

    const depthOf = (n) => {
      if (!n.parentId || !byId.has(n.parentId)) return 0
      return 1 + depthOf(byId.get(n.parentId))
    }

    const slotsUsed = new Map()   // depth → count
    for (const node of nodes) {
      if (this._nodePositions.has(node.id)) continue
      const depth = depthOf(node)
      const slot  = slotsUsed.get(depth) ?? 0
      slotsUsed.set(depth, slot + 1)
      this._nodePositions.set(node.id, {
        x: 20 + slot * (NODE_W + 20),
        y: SCENE_NODE_START_Y + depth * (NODE_H + 32),
      })
    }
  }

  // ── DOM construction ────────────────────────────────────────────────────────

  _buildDOM() {
    const panel = document.createElement('div')
    panel.style.cssText = `
      display: none;
      position: fixed;
      bottom: 0; right: 0;
      width: 520px; height: 360px;
      background: #1a1a2e;
      border-top: 2px solid #3a7bd5;
      border-left: 2px solid #3a7bd5;
      border-radius: 6px 0 0 0;
      flex-direction: row;
      z-index: 200;
      font-family: monospace;
      font-size: 12px;
      color: #ecf0f1;
      box-shadow: -4px -4px 16px rgba(0,0,0,0.5);
    `
    this._panel = panel

    // Header
    const header = document.createElement('div')
    header.style.cssText = `
      position: absolute; top: 0; left: 0; right: 0; height: 28px;
      background: #16213e;
      display: flex; align-items: center; padding: 0 10px;
      border-bottom: 1px solid #2a3a4a;
      user-select: none; cursor: default;
    `
    header.innerHTML = `
      <span style="color:#3a7bd5;font-weight:bold;margin-right:8px">◈</span>
      <span style="color:#aaa">Node Editor</span>
      <span id="ne-ws-status" style="margin-left:auto;font-size:10px;color:#666">● offline</span>
    `
    panel.appendChild(header)
    this._wsStatus = header.querySelector('#ne-ws-status')

    // Layer filter bar
    const filterBar = document.createElement('div')
    filterBar.style.cssText = `
      position: absolute; top: 28px; left: 0; right: 0; height: 24px;
      background: #0d1b2e;
      display: flex; align-items: center; padding: 0 8px; gap: 4px;
      border-bottom: 1px solid #2a3a4a;
      user-select: none;
    `
    const layers = [
      { key: 'frame',     label: 'Frame',   color: EDGE_STYLE.frame.color     },
      { key: 'anchor',    label: 'Anchor',  color: EDGE_STYLE.anchor.color    },
      { key: 'spatial',   label: 'Spatial', color: EDGE_STYLE.references.color },
      { key: 'operation', label: 'Op',      color: EDGE_STYLE.geometry.color   },
    ]
    for (const { key, label, color } of layers) {
      const btn = document.createElement('button')
      btn.textContent = label
      btn.style.cssText = `
        padding: 1px 6px; font-size: 9px; font-family: monospace;
        border-radius: 3px; cursor: pointer;
        border: 1px solid ${color};
        background: ${color}33;
        color: ${color};
      `
      btn.addEventListener('click', () => {
        this._layerVisible[key] = !this._layerVisible[key]
        btn.style.opacity = this._layerVisible[key] ? '1' : '0.35'
        this._render()
      })
      filterBar.appendChild(btn)
      this._layerBtns[key] = btn
    }
    panel.appendChild(filterBar)

    // SVG canvas (top = 52px to clear header + filter bar)
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.style.cssText = `
      position: absolute; top: 52px; left: 0; right: 200px; bottom: 0;
      width: calc(100% - 200px); height: calc(100% - 52px);
      cursor: default; overflow: hidden;
    `
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    this._svg = svg
    panel.appendChild(svg)

    // Params panel
    const params = document.createElement('div')
    params.style.cssText = `
      position: absolute; top: 52px; right: 0; width: 200px; bottom: 0;
      border-left: 1px solid #3a7bd5;
      background: #16213e;
      padding: 8px;
      overflow-y: auto;
    `
    this._paramsPanel = params
    panel.appendChild(params)

    this._container.appendChild(panel)
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  _render() {
    const svg = this._svg
    while (svg.firstChild) svg.removeChild(svg.firstChild)

    // Scene graph edges (frame / anchor / spatial)
    for (const edge of this._sceneGraph.edges) {
      const layer = edge.relation === 'spatial' ? 'spatial' : edge.relation
      if (!this._layerVisible[layer]) continue
      const srcPos = this._nodePositions.get(edge.from)
      const dstPos = this._nodePositions.get(edge.to)
      if (!srcPos || !dstPos) continue
      this._drawSceneEdge(svg, srcPos, dstPos, edge)
    }

    // Operation graph edges
    if (this._layerVisible.operation) {
      for (const edge of this._opGraph.edges) {
        const srcPos = this._nodePositions.get(edge.sourceId)
        const dstPos = this._nodePositions.get(edge.targetId)
        if (!srcPos || !dstPos) continue
        this._drawOpEdge(svg, srcPos, dstPos, edge)
      }
    }

    // Scene entity nodes
    for (const node of this._sceneGraph.nodes) {
      const pos = this._nodePositions.get(node.id) ?? { x: 20, y: SCENE_NODE_START_Y }
      this._drawSceneNode(svg, node, pos)
    }

    // Operation graph nodes
    for (const node of this._opGraph.nodes) {
      const pos = this._nodePositions.get(node.id) ?? { x: 20, y: OP_NODE_START_Y }
      this._drawOpNode(svg, node, pos)
    }
  }

  // ── Edge drawing ────────────────────────────────────────────────────────────

  _drawSceneEdge(svg, src, dst, edge) {
    const x1 = src.x + NODE_W / 2,  y1 = src.y + NODE_H / 2
    const x2 = dst.x + NODE_W / 2,  y2 = dst.y + NODE_H / 2
    const cx = (x1 + x2) / 2

    const styleKey = edge.relation === 'spatial' ? (edge.linkType ?? 'references') : edge.relation
    const style    = EDGE_STYLE[styleKey] ?? EDGE_STYLE.geometry

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`)
    path.setAttribute('fill',         'none')
    path.setAttribute('stroke',       style.color)
    path.setAttribute('stroke-width', String(style.width))
    if (style.dash !== 'none') path.setAttribute('stroke-dasharray', style.dash)
    svg.appendChild(path)

    if (style.directed) {
      this._drawArrow(svg, x2, y2, Math.atan2(y2 - y1, x2 - x1), style.color)
    }
  }

  _drawArrow(svg, x, y, angle, color) {
    const size = 7
    const dx   = Math.cos(angle), dy = Math.sin(angle)
    const x1   = x - dx * size - dy * size * 0.5
    const y1   = y - dy * size + dx * size * 0.5
    const x2   = x - dx * size + dy * size * 0.5
    const y2   = y - dy * size - dx * size * 0.5
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
    poly.setAttribute('points', `${x},${y} ${x1},${y1} ${x2},${y2}`)
    poly.setAttribute('fill', color)
    svg.appendChild(poly)
  }

  _drawOpEdge(svg, src, dst, edge) {
    const x1 = src.x + NODE_W,  y1 = src.y + NODE_H / 2
    const x2 = dst.x,           y2 = dst.y + NODE_H / 2
    const cx = (x1 + x2) / 2

    const style = edge.dataType === 'geometry' ? EDGE_STYLE.geometry : EDGE_STYLE.control

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`)
    path.setAttribute('fill',         'none')
    path.setAttribute('stroke',       style.color)
    path.setAttribute('stroke-width', String(style.width))
    if (style.dash !== 'none') path.setAttribute('stroke-dasharray', style.dash)
    svg.appendChild(path)
  }

  // ── Node drawing ────────────────────────────────────────────────────────────

  _drawSceneNode(svg, node, pos) {
    const color = ENTITY_COLORS[node.type] ?? '#2c3e50'
    this._drawNodeShape(svg, node.id, node.name ?? node.id, node.type, color, pos)
  }

  _drawOpNode(svg, node, pos) {
    const color = OP_NODE_COLORS[node.type] ?? OP_NODE_COLORS.default
    this._drawNodeShape(svg, node.id, node.label ?? node.id, node.type, color, pos)
  }

  _drawNodeShape(svg, id, label, typeTag, color, pos) {
    const isSelected = id === this._selectedId

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    g.setAttribute('transform', `translate(${pos.x},${pos.y})`)
    g.style.cursor = 'pointer'
    g.addEventListener('click', () => this._selectNode(id))

    // Shadow
    const shadow = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    shadow.setAttribute('x', '2');              shadow.setAttribute('y', '3')
    shadow.setAttribute('width',  String(NODE_W)); shadow.setAttribute('height', String(NODE_H))
    shadow.setAttribute('rx', '4');             shadow.setAttribute('fill', 'rgba(0,0,0,0.4)')
    g.appendChild(shadow)

    // Body
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    rect.setAttribute('width',        String(NODE_W)); rect.setAttribute('height', String(NODE_H))
    rect.setAttribute('rx',           '4')
    rect.setAttribute('fill',         '#1e2a3a')
    rect.setAttribute('stroke',       isSelected ? '#f1c40f' : color)
    rect.setAttribute('stroke-width', isSelected ? '2' : '1.5')
    g.appendChild(rect)

    // Accent bar
    const bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    bar.setAttribute('width', '6');  bar.setAttribute('height', String(NODE_H))
    bar.setAttribute('rx', '4');     bar.setAttribute('fill', color)
    g.appendChild(bar)

    // Input port
    const portIn = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    portIn.setAttribute('cx', '0');         portIn.setAttribute('cy', String(NODE_H / 2))
    portIn.setAttribute('r',  '4');         portIn.setAttribute('fill', color)
    g.appendChild(portIn)

    // Output port
    const portOut = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    portOut.setAttribute('cx', String(NODE_W)); portOut.setAttribute('cy', String(NODE_H / 2))
    portOut.setAttribute('r',  '4');            portOut.setAttribute('fill', color)
    g.appendChild(portOut)

    // Name label
    const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    lbl.setAttribute('x', '14'); lbl.setAttribute('y', '20')
    lbl.setAttribute('fill', '#ecf0f1'); lbl.setAttribute('font-size', '11')
    lbl.setAttribute('font-family', 'monospace')
    lbl.textContent = label.length > 14 ? label.slice(0, 13) + '…' : label
    g.appendChild(lbl)

    // Type tag
    const typeLbl = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    typeLbl.setAttribute('x', '14'); typeLbl.setAttribute('y', '36')
    typeLbl.setAttribute('fill', color); typeLbl.setAttribute('font-size', '9')
    typeLbl.setAttribute('font-family', 'monospace')
    typeLbl.textContent = typeTag
    g.appendChild(typeLbl)

    // Drag to reposition
    let dragging = false, ox = 0, oy = 0
    g.addEventListener('pointerdown', (e) => {
      dragging = true; ox = e.clientX - pos.x; oy = e.clientY - pos.y
      g.setPointerCapture(e.pointerId)
      e.stopPropagation()
    })
    g.addEventListener('pointermove', (e) => {
      if (!dragging) return
      pos.x = e.clientX - ox; pos.y = e.clientY - oy
      g.setAttribute('transform', `translate(${pos.x},${pos.y})`)
      this._render()
    })
    g.addEventListener('pointerup', () => { dragging = false })

    svg.appendChild(g)
  }

  // ── Selection + params ──────────────────────────────────────────────────────

  _selectNode(id) {
    this._selectedId = id
    this._render()
    this._renderParams(id)
  }

  _renderParams(id) {
    const panel = this._paramsPanel
    panel.innerHTML = ''

    const sceneNode = this._sceneGraph.nodes.find(n => n.id === id)
    if (sceneNode) { this._renderSceneNodeParams(panel, sceneNode); return }

    const opNode = this._opGraph.nodes.find(n => n.id === id)
    if (opNode) this._renderOpNodeParams(panel, opNode)
  }

  _renderSceneNodeParams(panel, node) {
    const color = ENTITY_COLORS[node.type] ?? '#aaa'

    const title = document.createElement('div')
    title.style.cssText = 'font-weight:bold;margin-bottom:8px;font-size:11px'
    title.innerHTML = `<span style="color:${color}">${node.type}</span>: ${node.name ?? node.id}`
    panel.appendChild(title)

    const rows = [
      ['id',       node.id.length > 16 ? node.id.slice(0, 15) + '…' : node.id],
      ['name',     node.name ?? '—'],
      ['type',     node.type],
      ['parent',   node.parentId ? node.parentId.slice(0, 10) + '…' : '—'],
    ]

    for (const [key, val] of rows) {
      const row = document.createElement('div')
      row.style.cssText = 'display:flex;margin-bottom:4px;gap:4px'
      row.innerHTML = `
        <span style="flex:0 0 40px;color:#888;font-size:9px;padding-top:1px">${key}</span>
        <span style="color:#ecf0f1;font-size:10px;word-break:break-all">${val}</span>
      `
      panel.appendChild(row)
    }

    // Spatial links involving this entity
    const links = this._sceneGraph.edges.filter(
      e => e.relation === 'spatial' && (e.from === node.id || e.to === node.id)
    )
    if (links.length > 0) {
      const sep = document.createElement('div')
      sep.style.cssText = 'border-top:1px solid #2a3a4a;margin:6px 0;font-size:9px;color:#666'
      sep.textContent = `${links.length} spatial link${links.length > 1 ? 's' : ''}`
      panel.appendChild(sep)

      for (const edge of links) {
        const style    = EDGE_STYLE[edge.linkType] ?? EDGE_STYLE.references
        const dir      = edge.from === node.id ? '→' : '←'
        const otherId  = edge.from === node.id ? edge.to : edge.from
        const other    = this._sceneGraph.nodes.find(n => n.id === otherId)
        const otherLbl = other?.name ?? otherId.slice(0, 8) + '…'

        const row = document.createElement('div')
        row.style.cssText = 'font-size:9px;margin-bottom:3px'
        row.innerHTML = `<span style="color:${style.color}">${edge.linkType}</span> ${dir} ${otherLbl}`
        panel.appendChild(row)
      }
    }
  }

  _renderOpNodeParams(panel, node) {
    const title = document.createElement('div')
    title.style.cssText = 'color:#3a7bd5;font-weight:bold;margin-bottom:8px;font-size:11px'
    title.textContent = `${node.type}: ${node.label}`
    panel.appendChild(title)

    for (const [key, value] of Object.entries(node.params ?? {})) {
      const row = document.createElement('div')
      row.style.cssText = 'display:flex;align-items:center;margin-bottom:6px;gap:4px'

      const lbl = document.createElement('label')
      lbl.textContent = key
      lbl.style.cssText = 'flex:1;color:#aaa;font-size:10px'
      row.appendChild(lbl)

      if (typeof value === 'number') {
        const inp = document.createElement('input')
        inp.type = 'number'; inp.value = String(value); inp.step = '0.1'
        inp.style.cssText = `
          width: 64px; background: #0d2137; color: #ecf0f1;
          border: 1px solid #3a7bd5; border-radius: 3px; padding: 2px 4px;
          font-size: 11px; font-family: monospace;
        `
        inp.addEventListener('change', () => {
          const v = parseFloat(inp.value)
          if (!isNaN(v)) this._sendSetParam(node.id, key, v)
        })
        row.appendChild(inp)
      } else {
        const span = document.createElement('span')
        span.textContent = String(value)
        span.style.cssText = 'color:#ecf0f1;font-size:10px'
        row.appendChild(span)
      }
      panel.appendChild(row)
    }
  }

  _sendSetParam(nodeId, param, value) {
    const ws = this._service.wsChannel
    if (!ws) { console.warn('[NodeEditor] No WS channel'); return }
    ws.send('graph.node.setParam', { nodeId, param, value })
  }

  // ── WebSocket events ────────────────────────────────────────────────────────

  _bindWsEvents() {
    this._service.on('wsConnected', () => {
      if (this._wsStatus) {
        this._wsStatus.textContent = '● connected'
        this._wsStatus.style.color = '#2ecc71'
      }
      const ws = this._service.wsChannel
      if (ws) {
        ws.on('graph.snapshot', (payload) => { this.setOpGraph(payload) })
        ws.on('geometry.update', ({ objectId }) => { this._flashNode(objectId) })
        ws.on('import.progress', ({ percent, status }) => {
          if (this._wsStatus) this._wsStatus.textContent = `● ${status} ${percent}%`
        })
      }
    })
    this._service.on('wsDisconnected', () => {
      if (this._wsStatus) {
        this._wsStatus.textContent = '● offline'
        this._wsStatus.style.color = '#e74c3c'
      }
    })
  }

  // ── Scene change events ─────────────────────────────────────────────────────

  _bindSceneEvents() {
    const refresh = () => { if (this._visible) this.refreshSceneGraph() }
    this._service.on('objectAdded',        refresh)
    this._service.on('objectRemoved',      refresh)
    this._service.on('objectRenamed',      refresh)
    this._service.on('spatialLinkAdded',   refresh)
    this._service.on('spatialLinkRemoved', refresh)
  }

  // ── Flash on geometry update ────────────────────────────────────────────────

  _flashNode(objectId) {
    const node =
      this._opGraph.nodes.find(n => n.objectId === objectId || n.id === objectId) ??
      this._sceneGraph.nodes.find(n => n.id === objectId)
    if (!node) return
    const prev = this._selectedId
    this._selectedId = node.id
    this._render()
    setTimeout(() => { this._selectedId = prev; this._render() }, 400)
  }
}
