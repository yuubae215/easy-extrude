/**
 * NodeEditorView — Geometry DAG editor panel (ADR-017, Phase B prototype).
 *
 * Renders the OperationGraph as an SVG canvas inside a resizable side panel.
 * Nodes are draggable rectangles; edges are Bezier curves.
 *
 * Phase B capabilities:
 *   - Display the graph received from the Geometry Service (graph.snapshot)
 *   - Select a node (show params in a sidebar)
 *   - Change a numeric param (sends graph.node.setParam via WsChannel)
 *   - Trigger STEP import (opens file picker, sends import.step via WsChannel)
 *   - Show geometry.update notifications as a brief status flash
 *
 * Phase C extensions (not in this prototype):
 *   - Add / remove nodes and edges via UI drag
 *   - Multi-node selection and copy/paste
 */

const NODE_W = 140
const NODE_H = 48
const COLORS = {
  cuboid:     '#3a7bd5',
  sketch:     '#8e44ad',
  extrude:    '#27ae60',
  stepImport: '#e67e22',
  transform:  '#7f8c8d',
  default:    '#2c3e50',
}

export class NodeEditorView {
  /**
   * @param {HTMLElement} container  Element that will host the node editor panel
   * @param {import('../service/SceneService.js').SceneService} sceneService
   */
  constructor(container, sceneService) {
    this._container    = container
    this._service      = sceneService
    this._graph        = { nodes: [], edges: [] }
    this._nodePositions = new Map()  // nodeId → { x, y }
    this._selectedId   = null
    this._visible      = false

    this._panel        = null
    this._svg          = null
    this._paramsPanel  = null

    this._buildDOM()
    this._bindWsEvents()
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Shows / hides the Node Editor panel. */
  setVisible(visible) {
    this._visible = visible
    this._panel.style.display = visible ? 'flex' : 'none'
  }

  /** Toggles panel visibility. Returns new state. */
  toggle() {
    this.setVisible(!this._visible)
    return this._visible
  }

  /** Replaces the current graph display with new snapshot data. */
  setGraph(graph) {
    this._graph = graph
    // Assign default positions for new nodes
    this._graph.nodes.forEach((node, i) => {
      if (!this._nodePositions.has(node.id)) {
        this._nodePositions.set(node.id, { x: 40 + (i % 4) * 180, y: 40 + Math.floor(i / 4) * 80 })
      }
    })
    this._render()
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

    // ── Header ─────────────────────────────────────────────────────────────
    const header = document.createElement('div')
    header.style.cssText = `
      position: absolute; top: 0; left: 0; right: 0; height: 28px;
      background: #16213e;
      display: flex; align-items: center; padding: 0 10px;
      border-bottom: 1px solid #3a7bd5;
      user-select: none; cursor: default;
    `
    header.innerHTML = `
      <span style="color:#3a7bd5;font-weight:bold;margin-right:8px">◈</span>
      <span style="color:#aaa">Node Editor</span>
      <span id="ne-ws-status" style="margin-left:auto;font-size:10px;color:#666">● offline</span>
    `
    panel.appendChild(header)
    this._wsStatus = header.querySelector('#ne-ws-status')

    // ── Toolbar ────────────────────────────────────────────────────────────
    const toolbar = document.createElement('div')
    toolbar.style.cssText = `
      position: absolute; top: 28px; left: 0; right: 200px; height: 28px;
      background: #0f3460;
      display: flex; align-items: center; padding: 0 8px; gap: 6px;
      border-bottom: 1px solid #1a1a2e;
    `
    const btnImport = this._makeBtn('Import STEP', () => this._triggerStepImport())
    toolbar.appendChild(btnImport)
    panel.appendChild(toolbar)

    // ── SVG canvas ─────────────────────────────────────────────────────────
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.style.cssText = `
      position: absolute; top: 56px; left: 0; right: 200px; bottom: 0;
      width: calc(100% - 200px); height: calc(100% - 56px);
      cursor: default; overflow: hidden;
    `
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    this._svg = svg
    panel.appendChild(svg)

    // ── Params panel ───────────────────────────────────────────────────────
    const params = document.createElement('div')
    params.style.cssText = `
      position: absolute; top: 28px; right: 0; width: 200px; bottom: 0;
      border-left: 1px solid #3a7bd5;
      background: #16213e;
      padding: 8px;
      overflow-y: auto;
    `
    this._paramsPanel = params
    panel.appendChild(params)

    this._container.appendChild(panel)
  }

  _makeBtn(label, onClick) {
    const btn = document.createElement('button')
    btn.textContent = label
    btn.style.cssText = `
      background: #0d2137; color: #aaa; border: 1px solid #3a7bd5;
      padding: 2px 8px; border-radius: 3px; cursor: pointer; font-size: 11px;
    `
    btn.addEventListener('click', onClick)
    return btn
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  _render() {
    const svg = this._svg
    while (svg.firstChild) svg.removeChild(svg.firstChild)

    // Draw edges first (behind nodes)
    for (const edge of this._graph.edges) {
      const srcPos = this._nodePositions.get(edge.sourceId)
      const dstPos = this._nodePositions.get(edge.targetId)
      if (!srcPos || !dstPos) continue
      this._drawEdge(svg, srcPos, dstPos, edge)
    }

    // Draw nodes
    for (const node of this._graph.nodes) {
      const pos = this._nodePositions.get(node.id) ?? { x: 20, y: 20 }
      this._drawNode(svg, node, pos)
    }
  }

  _drawEdge(svg, src, dst, edge) {
    const x1 = src.x + NODE_W, y1 = src.y + NODE_H / 2
    const x2 = dst.x,          y2 = dst.y + NODE_H / 2
    const cx  = (x1 + x2) / 2

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`)
    path.setAttribute('fill', 'none')
    path.setAttribute('stroke', edge.dataType === 'geometry' ? '#3a7bd5' : '#7f8c8d')
    path.setAttribute('stroke-width', '1.5')
    path.setAttribute('stroke-dasharray', edge.dataType === 'control' ? '4,3' : 'none')
    svg.appendChild(path)
  }

  _drawNode(svg, node, pos) {
    const color = COLORS[node.type] ?? COLORS.default
    const isSelected = node.id === this._selectedId

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    g.setAttribute('transform', `translate(${pos.x},${pos.y})`)
    g.style.cursor = 'pointer'
    g.addEventListener('click', () => this._selectNode(node.id))

    // ── Node shadow ─────────────────────────────────────────────────────
    const shadow = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    shadow.setAttribute('x', '2'); shadow.setAttribute('y', '3')
    shadow.setAttribute('width', String(NODE_W)); shadow.setAttribute('height', String(NODE_H))
    shadow.setAttribute('rx', '4'); shadow.setAttribute('fill', 'rgba(0,0,0,0.4)')
    g.appendChild(shadow)

    // ── Node body ───────────────────────────────────────────────────────
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    rect.setAttribute('width', String(NODE_W)); rect.setAttribute('height', String(NODE_H))
    rect.setAttribute('rx', '4')
    rect.setAttribute('fill', '#1e2a3a')
    rect.setAttribute('stroke', isSelected ? '#f1c40f' : color)
    rect.setAttribute('stroke-width', isSelected ? '2' : '1.5')
    g.appendChild(rect)

    // ── Colour bar ──────────────────────────────────────────────────────
    const bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    bar.setAttribute('width', '6'); bar.setAttribute('height', String(NODE_H))
    bar.setAttribute('rx', '4'); bar.setAttribute('fill', color)
    g.appendChild(bar)

    // ── Input / output ports ────────────────────────────────────────────
    const portIn = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    portIn.setAttribute('cx', '0'); portIn.setAttribute('cy', String(NODE_H / 2))
    portIn.setAttribute('r', '4'); portIn.setAttribute('fill', color)
    g.appendChild(portIn)

    const portOut = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    portOut.setAttribute('cx', String(NODE_W)); portOut.setAttribute('cy', String(NODE_H / 2))
    portOut.setAttribute('r', '4'); portOut.setAttribute('fill', color)
    g.appendChild(portOut)

    // ── Label ───────────────────────────────────────────────────────────
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    label.setAttribute('x', '14'); label.setAttribute('y', '20')
    label.setAttribute('fill', '#ecf0f1'); label.setAttribute('font-size', '11')
    label.setAttribute('font-family', 'monospace')
    label.textContent = node.label.length > 14 ? node.label.slice(0, 13) + '…' : node.label
    g.appendChild(label)

    const typeTag = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    typeTag.setAttribute('x', '14'); typeTag.setAttribute('y', '36')
    typeTag.setAttribute('fill', color); typeTag.setAttribute('font-size', '9')
    typeTag.setAttribute('font-family', 'monospace')
    typeTag.textContent = node.type
    g.appendChild(typeTag)

    // ── Drag to move ────────────────────────────────────────────────────
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

  _selectNode(nodeId) {
    this._selectedId = nodeId
    this._render()
    this._renderParams(nodeId)
  }

  _renderParams(nodeId) {
    const panel = this._paramsPanel
    panel.innerHTML = ''

    const node = this._graph.nodes.find(n => n.id === nodeId)
    if (!node) return

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
          if (!isNaN(v)) this._sendSetParam(nodeId, key, v)
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

  // ── STEP import ─────────────────────────────────────────────────────────────

  _triggerStepImport() {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = '.stp,.step,.STP,.STEP'
    input.addEventListener('change', async () => {
      const file = input.files?.[0]
      if (!file) return
      const ws = this._service.wsChannel
      if (!ws) {
        // Fall back to REST upload
        try {
          if (!this._service._bff) return
          const result = await this._service._bff.importStep(file)
          console.log('[NodeEditor] STEP import result (REST):', result)
        } catch (err) {
          console.error('[NodeEditor] STEP import error:', err)
        }
        return
      }
      // Send via WebSocket
      const reader = new FileReader()
      reader.onload = () => {
        const base64 = btoa(
          new Uint8Array(reader.result).reduce((s, b) => s + String.fromCharCode(b), '')
        )
        const jobId = `job_${Date.now()}`
        ws.send('import.step', { jobId, filename: file.name, data: base64 })
      }
      reader.readAsArrayBuffer(file)
    })
    input.click()
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
        ws.on('graph.snapshot', (payload) => {
          this.setGraph(payload)
        })
        ws.on('geometry.update', ({ objectId }) => {
          this._flashNode(objectId)
        })
        ws.on('import.progress', ({ percent, status }) => {
          if (this._wsStatus) {
            this._wsStatus.textContent = `● ${status} ${percent}%`
          }
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

  /** Briefly highlights the node whose geometry was updated. */
  _flashNode(objectId) {
    // Find the node whose objectId matches
    const node = this._graph.nodes.find(n => n.objectId === objectId || n.id === objectId)
    if (!node) return
    const prevSelected = this._selectedId
    this._selectedId = node.id
    this._render()
    setTimeout(() => {
      this._selectedId = prevSelected
      this._render()
    }, 400)
  }
}
