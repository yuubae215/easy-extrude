/**
 * MeshView - manages Three.js mesh rendering
 *
 * Side effects: creates Three.js objects, adds them to the scene, and updates geometry.
 * Pure geometry calculations are delegated to CuboidModel functions.
 */
import * as THREE from 'three'
import { buildGeometry, buildFaceHighlightPositions } from '../model/CuboidModel.js'

export class MeshView {
  constructor(scene) {
    // Cuboid mesh
    this.cuboidMat = new THREE.MeshStandardMaterial({ color: 0x4fc3f7, roughness: 0.3, metalness: 0.3, side: THREE.DoubleSide })
    this.cuboid = new THREE.Mesh(new THREE.BufferGeometry(), this.cuboidMat)
    scene.add(this.cuboid)

    // Wireframe overlay
    this.wireframe = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 }),
    )
    scene.add(this.wireframe)

    // BoxHelper for object-selected highlight
    this.boxHelper = new THREE.BoxHelper(this.cuboid, 0x4fc3f7)
    this.boxHelper.visible = false
    scene.add(this.boxHelper)

    // Face highlight quad
    this._hlGeo = new THREE.BufferGeometry()
    this.hlMesh = new THREE.Mesh(this._hlGeo, new THREE.MeshBasicMaterial({
      color: 0xffeb3b, transparent: true, opacity: 0.35,
      depthTest: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1,
    }))
    scene.add(this.hlMesh)

    // Extrusion display lines: original face outline (4 edges) + connectors to current face (4 edges)
    this._extrusionLinesGeo = new THREE.BufferGeometry()
    this._extrusionLines = new THREE.LineSegments(
      this._extrusionLinesGeo,
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false }),
    )
    this._extrusionLines.visible = false
    scene.add(this._extrusionLines)

    // ── Pivot candidate shapes: ○ Vertex, △ Edge, □ Face (yellow, hollow) ──
    const _texCircle   = MeshView._makeShapeTexture('circle')
    const _texTriangle = MeshView._makeShapeTexture('triangle')
    const _texSquare   = MeshView._makeShapeTexture('square')
    const _texDiamond  = MeshView._makeShapeTexture('diamond')

    const _makePivotMat = (tex) => new THREE.PointsMaterial({
      color: 0xffeb3b, size: 14, sizeAttenuation: false, depthTest: false,
      map: tex, transparent: true, alphaTest: 0.05,
    })
    this._pivotVertGeo = new THREE.BufferGeometry()
    this._pivotVertPoints = new THREE.Points(this._pivotVertGeo, _makePivotMat(_texCircle))
    this._pivotVertPoints.visible = false
    scene.add(this._pivotVertPoints)

    this._pivotEdgeGeo = new THREE.BufferGeometry()
    this._pivotEdgePoints = new THREE.Points(this._pivotEdgeGeo, _makePivotMat(_texTriangle))
    this._pivotEdgePoints.visible = false
    scene.add(this._pivotEdgePoints)

    this._pivotFaceGeo = new THREE.BufferGeometry()
    this._pivotFacePoints = new THREE.Points(this._pivotFaceGeo, _makePivotMat(_texSquare))
    this._pivotFacePoints.visible = false
    scene.add(this._pivotFacePoints)

    // Hovered pivot highlight (orange, larger) — same shape per type
    const _makeHovMat = (tex) => new THREE.PointsMaterial({
      color: 0xff8c00, size: 20, sizeAttenuation: false, depthTest: false,
      map: tex, transparent: true, alphaTest: 0.05,
    })
    this._hovPivotVertGeo = new THREE.BufferGeometry()
    this._hovPivotVertPoints = new THREE.Points(this._hovPivotVertGeo, _makeHovMat(_texCircle))
    this._hovPivotVertPoints.visible = false
    scene.add(this._hovPivotVertPoints)

    this._hovPivotEdgeGeo = new THREE.BufferGeometry()
    this._hovPivotEdgePoints = new THREE.Points(this._hovPivotEdgeGeo, _makeHovMat(_texTriangle))
    this._hovPivotEdgePoints.visible = false
    scene.add(this._hovPivotEdgePoints)

    this._hovPivotFaceGeo = new THREE.BufferGeometry()
    this._hovPivotFacePoints = new THREE.Points(this._hovPivotFaceGeo, _makeHovMat(_texSquare))
    this._hovPivotFacePoints.visible = false
    scene.add(this._hovPivotFacePoints)

    // ── Modern snap indicators ─────────────────────────────────────────────

    // Snap candidates — hollow shapes per type (○ Vertex, △ Edge, □ Face)
    const _makeSnapCandMat = (tex) => new THREE.PointsMaterial({
      size: 12, sizeAttenuation: false, depthTest: false,
      map: tex, vertexColors: true, transparent: true, alphaTest: 0.05, opacity: 0.65,
    })
    this._snapVertCandGeo = new THREE.BufferGeometry()
    this._snapVertCandidates = new THREE.Points(this._snapVertCandGeo, _makeSnapCandMat(_texCircle))
    this._snapVertCandidates.visible = false
    scene.add(this._snapVertCandidates)

    this._snapEdgeCandGeo = new THREE.BufferGeometry()
    this._snapEdgeCandidates = new THREE.Points(this._snapEdgeCandGeo, _makeSnapCandMat(_texTriangle))
    this._snapEdgeCandidates.visible = false
    scene.add(this._snapEdgeCandidates)

    this._snapFaceCandGeo = new THREE.BufferGeometry()
    this._snapFaceCandidates = new THREE.Points(this._snapFaceCandGeo, _makeSnapCandMat(_texSquare))
    this._snapFaceCandidates.visible = false
    scene.add(this._snapFaceCandidates)

    this._snapWorldCandGeo = new THREE.BufferGeometry()
    this._snapWorldCandidates = new THREE.Points(this._snapWorldCandGeo, _makeSnapCandMat(_texDiamond))
    this._snapWorldCandidates.visible = false
    scene.add(this._snapWorldCandidates)

    // Locked snap target — large bright hollow shape per type
    const _makeSnapLockMat = (tex, color) => new THREE.PointsMaterial({
      color, size: 20, sizeAttenuation: false, depthTest: false,
      map: tex, transparent: true, alphaTest: 0.05,
    })
    this._snapLockedVertGeo = new THREE.BufferGeometry()
    this._snapLockedVert = new THREE.Points(this._snapLockedVertGeo, _makeSnapLockMat(_texCircle,   0x69f0ae))
    this._snapLockedVert.visible = false
    scene.add(this._snapLockedVert)

    this._snapLockedEdgeGeo = new THREE.BufferGeometry()
    this._snapLockedEdge = new THREE.Points(this._snapLockedEdgeGeo, _makeSnapLockMat(_texTriangle, 0xffd740))
    this._snapLockedEdge.visible = false
    scene.add(this._snapLockedEdge)

    this._snapLockedFaceGeo = new THREE.BufferGeometry()
    this._snapLockedFace = new THREE.Points(this._snapLockedFaceGeo, _makeSnapLockMat(_texSquare,   0x4fc3f7))
    this._snapLockedFace.visible = false
    scene.add(this._snapLockedFace)

    this._snapLockedWorldGeo = new THREE.BufferGeometry()
    this._snapLockedWorld = new THREE.Points(this._snapLockedWorldGeo, _makeSnapLockMat(_texDiamond, 0xffffff))
    this._snapLockedWorld.visible = false
    scene.add(this._snapLockedWorld)

    // Snap guide line — pivot → locked target
    this._snapLineGeo = new THREE.BufferGeometry()
    this._snapLine = new THREE.Line(
      this._snapLineGeo,
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthTest: false }),
    )
    this._snapLine.visible = false
    scene.add(this._snapLine)

    // Sketch rect preview (ground-plane rectangle outline + fill)
    this._sketchRectGeo = new THREE.BufferGeometry()
    this._sketchRectLines = new THREE.LineLoop(
      this._sketchRectGeo,
      new THREE.LineBasicMaterial({ color: 0x4fc3f7, depthTest: false }),
    )
    this._sketchRectLines.visible = false
    scene.add(this._sketchRectLines)

    this._sketchFillGeo = new THREE.BufferGeometry()
    this._sketchFill = new THREE.Mesh(
      this._sketchFillGeo,
      new THREE.MeshBasicMaterial({ color: 0x4fc3f7, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthTest: false }),
    )
    this._sketchFill.visible = false
    scene.add(this._sketchFill)

    // ── Sub-element selection visuals (Phase 6) ───────────────────────────

    // Hover vertex indicator (white, 12px)
    this._hoverVertGeo = new THREE.BufferGeometry()
    this._hoverVertPoints = new THREE.Points(
      this._hoverVertGeo,
      new THREE.PointsMaterial({ color: 0xffffff, size: 12, sizeAttenuation: false, depthTest: false }),
    )
    this._hoverVertPoints.visible = false
    scene.add(this._hoverVertPoints)

    // Selected vertices (cyan, 8px)
    this._selVertGeo = new THREE.BufferGeometry()
    this._selVertPoints = new THREE.Points(
      this._selVertGeo,
      new THREE.PointsMaterial({ color: 0x00e5ff, size: 8, sizeAttenuation: false, depthTest: false }),
    )
    this._selVertPoints.visible = false
    scene.add(this._selVertPoints)

    // Hover edge indicator (white)
    this._hoverEdgeGeo = new THREE.BufferGeometry()
    this._hoverEdgeLines = new THREE.LineSegments(
      this._hoverEdgeGeo,
      new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false }),
    )
    this._hoverEdgeLines.visible = false
    scene.add(this._hoverEdgeLines)

    // Selected edges (cyan)
    this._selEdgeGeo = new THREE.BufferGeometry()
    this._selEdgeLines = new THREE.LineSegments(
      this._selEdgeGeo,
      new THREE.LineBasicMaterial({ color: 0x00e5ff, depthTest: false }),
    )
    this._selEdgeLines.visible = false
    scene.add(this._selEdgeLines)

    // Selected faces highlight (cyan tint, separate from hover hlMesh)
    this._selFaceHlGeo = new THREE.BufferGeometry()
    this._selFaceMesh = new THREE.Mesh(this._selFaceHlGeo, new THREE.MeshBasicMaterial({
      color: 0x00e5ff, transparent: true, opacity: 0.28,
      depthTest: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2,
    }))
    this._selFaceMesh.visible = false
    scene.add(this._selFaceMesh)
  }

  /** Rebuilds geometry from the corner array and applies it to the mesh */
  updateGeometry(corners) {
    const newGeo = buildGeometry(corners)
    this.cuboid.geometry.dispose()
    this.cuboid.geometry = newGeo
    this.wireframe.geometry.dispose()
    this.wireframe.geometry = new THREE.EdgesGeometry(newGeo, 1)
  }

  /** Updates the visual appearance for object-selected state */
  setObjectSelected(sel) {
    this.cuboidMat.emissive.set(sel ? 0x112244 : 0x000000)
    this.boxHelper.visible = sel
    if (sel) this.boxHelper.update()
  }

  /** Updates the BoxHelper to match the current geometry */
  updateBoxHelper() {
    this.boxHelper.update()
  }

  /**
   * Updates the extrusion display lines (I-type dimension line).
   * Shape:  tick ─── span ─── tick  (like ├────────┤)
   * @param {THREE.Vector3[]} savedFaceCorners - 4 face vertices at drag start
   * @param {THREE.Vector3[]} currentFaceCorners - 4 face vertices at current position
   * @returns {{ spanMid: THREE.Vector3, armDir: THREE.Vector3 }}
   */
  setExtrusionDisplay(savedFaceCorners, currentFaceCorners) {
    const ARM_LEN  = 0.5
    const TICK_HALF = 0.18

    // Extrusion direction (saved → current)
    const extDir = new THREE.Vector3().subVectors(currentFaceCorners[0], savedFaceCorners[0]).normalize()

    // Pick the world axis most perpendicular to extDir (prefer horizontal: X, then Y, then Z)
    const AXES = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 1),
    ]
    let armDir = AXES[0]
    let minDot = Infinity
    for (const axis of AXES) {
      const d = Math.abs(extDir.dot(axis))
      if (d < minDot) { minDot = d; armDir = axis }
    }

    // Span endpoints: offset from edge midpoints by ARM_LEN along armDir
    const edgeMidS = new THREE.Vector3().addVectors(savedFaceCorners[0], savedFaceCorners[1]).multiplyScalar(0.5)
    const edgeMidC = new THREE.Vector3().addVectors(currentFaceCorners[0], currentFaceCorners[1]).multiplyScalar(0.5)
    const tipS = edgeMidS.clone().addScaledVector(armDir, ARM_LEN)
    const tipC = edgeMidC.clone().addScaledVector(armDir, ARM_LEN)

    // I-type: tick at tipS + span tipS→tipC + tick at tipC
    // 3 segments × 2 points × 3 floats = 18 floats
    const tickS0 = tipS.clone().addScaledVector(armDir, -TICK_HALF)
    const tickS1 = tipS.clone().addScaledVector(armDir,  TICK_HALF)
    const tickC0 = tipC.clone().addScaledVector(armDir, -TICK_HALF)
    const tickC1 = tipC.clone().addScaledVector(armDir,  TICK_HALF)

    const positions = new Float32Array(18)
    positions[0]  = tickS0.x; positions[1]  = tickS0.y; positions[2]  = tickS0.z
    positions[3]  = tickS1.x; positions[4]  = tickS1.y; positions[5]  = tickS1.z
    positions[6]  = tipS.x;   positions[7]  = tipS.y;   positions[8]  = tipS.z
    positions[9]  = tipC.x;   positions[10] = tipC.y;   positions[11] = tipC.z
    positions[12] = tickC0.x; positions[13] = tickC0.y; positions[14] = tickC0.z
    positions[15] = tickC1.x; positions[16] = tickC1.y; positions[17] = tickC1.z

    this._extrusionLinesGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    this._extrusionLinesGeo.attributes.position.needsUpdate = true
    this._extrusionLines.visible = true

    return { spanMid: tipS.clone().add(tipC).multiplyScalar(0.5), armDir }
  }

  /** Hides the extrusion display lines */
  clearExtrusionDisplay() {
    this._extrusionLines.visible = false
  }

  /**
   * Creates a canvas texture for a hollow shape (circle/triangle/square/diamond).
   * The shape is drawn as a white outline on a transparent background.
   * @param {'circle'|'triangle'|'square'|'diamond'} shape
   * @returns {THREE.CanvasTexture}
   */
  static _makeShapeTexture(shape) {
    const S = 32, h = S / 2, m = 4
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = S
    const ctx = canvas.getContext('2d')
    ctx.strokeStyle = 'white'
    ctx.lineWidth = 3
    if (shape === 'circle') {
      ctx.beginPath()
      ctx.arc(h, h, h - m, 0, Math.PI * 2)
      ctx.stroke()
    } else if (shape === 'triangle') {
      ctx.beginPath()
      ctx.moveTo(h, m)
      ctx.lineTo(S - m, S - m)
      ctx.lineTo(m, S - m)
      ctx.closePath()
      ctx.stroke()
    } else if (shape === 'diamond') {
      ctx.beginPath()
      ctx.moveTo(h, m)
      ctx.lineTo(S - m, h)
      ctx.lineTo(h, S - m)
      ctx.lineTo(m, h)
      ctx.closePath()
      ctx.stroke()
    } else {
      ctx.strokeRect(m, m, S - m * 2, S - m * 2)
    }
    return new THREE.CanvasTexture(canvas)
  }

  /**
   * Shows pivot candidate shapes split by type (○ vertex, △ edge, □ face).
   * @param {{ label: string, position: THREE.Vector3, type: string }[]} candidates
   */
  showPivotCandidates(candidates) {
    const byType = { vertex: [], edge: [], face: [] }
    for (const c of candidates) byType[c.type]?.push(c.position)

    const _upload = (geo, pts, points) => {
      if (!pts.length) { points.visible = false; return }
      const arr = new Float32Array(pts.length * 3)
      pts.forEach((p, i) => { arr[i*3] = p.x; arr[i*3+1] = p.y; arr[i*3+2] = p.z })
      geo.setAttribute('position', new THREE.BufferAttribute(arr, 3))
      geo.attributes.position.needsUpdate = true
      points.visible = true
    }
    _upload(this._pivotVertGeo, byType.vertex, this._pivotVertPoints)
    _upload(this._pivotEdgeGeo, byType.edge,   this._pivotEdgePoints)
    _upload(this._pivotFaceGeo, byType.face,   this._pivotFacePoints)
    this._hovPivotVertPoints.visible = false
    this._hovPivotEdgePoints.visible = false
    this._hovPivotFacePoints.visible = false
  }

  /**
   * Highlights the hovered pivot candidate with the correct shape; pass null to clear.
   * @param {{ position: THREE.Vector3, type: string }|null} cand
   */
  setHoveredPivot(cand) {
    this._hovPivotVertPoints.visible = false
    this._hovPivotEdgePoints.visible = false
    this._hovPivotFacePoints.visible = false
    if (!cand) return
    const geoMap = { vertex: this._hovPivotVertGeo, edge: this._hovPivotEdgeGeo, face: this._hovPivotFaceGeo }
    const ptMap  = { vertex: this._hovPivotVertPoints, edge: this._hovPivotEdgePoints, face: this._hovPivotFacePoints }
    const geo = geoMap[cand.type]; const points = ptMap[cand.type]
    if (!geo) return
    const pos = new Float32Array([cand.position.x, cand.position.y, cand.position.z])
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.attributes.position.needsUpdate = true
    points.visible = true
  }

  /** Hides all pivot candidate display */
  clearPivotDisplay() {
    this._pivotVertPoints.visible = false
    this._pivotEdgePoints.visible = false
    this._pivotFacePoints.visible = false
    this._hovPivotVertPoints.visible = false
    this._hovPivotEdgePoints.visible = false
    this._hovPivotFacePoints.visible = false
  }

  // ── Modern snap display ──────────────────────────────────────────────────

  /** Color per snap target type */
  static _SNAP_COLOR = {
    vertex: new THREE.Color(0x69f0ae),
    edge:   new THREE.Color(0xffd740),
    face:   new THREE.Color(0x4fc3f7),
    world:  new THREE.Color(0xffffff),
  }

  /**
   * Shows all snap candidates as hollow shapes: ○ vertex, △ edge, □ face.
   * @param {{ position: THREE.Vector3, type: string }[]} targets
   */
  showSnapCandidates(targets) {
    const byType = { vertex: [], edge: [], face: [], world: [] }
    for (const t of targets) byType[t.type]?.push(t.position)

    const _upload = (type, geo, points) => {
      const pts = byType[type]
      if (!pts.length) { points.visible = false; return }
      const c = MeshView._SNAP_COLOR[type]
      const arr = new Float32Array(pts.length * 3)
      const col = new Float32Array(pts.length * 3)
      pts.forEach((p, i) => {
        arr[i*3] = p.x; arr[i*3+1] = p.y; arr[i*3+2] = p.z
        col[i*3] = c.r; col[i*3+1] = c.g; col[i*3+2] = c.b
      })
      geo.setAttribute('position', new THREE.BufferAttribute(arr, 3))
      geo.setAttribute('color',    new THREE.BufferAttribute(col, 3))
      geo.attributes.position.needsUpdate = true
      points.visible = true
    }
    _upload('vertex', this._snapVertCandGeo,   this._snapVertCandidates)
    _upload('edge',   this._snapEdgeCandGeo,   this._snapEdgeCandidates)
    _upload('face',   this._snapFaceCandGeo,   this._snapFaceCandidates)
    _upload('world',  this._snapWorldCandGeo,  this._snapWorldCandidates)
  }

  /**
   * Shows the locked snap indicator (hollow shape + guide line from pivot).
   * @param {THREE.Vector3} position - snap target position
   * @param {string}        type     - 'vertex'|'edge'|'face'
   * @param {THREE.Vector3} pivot    - grab pivot (guide line start)
   */
  showSnapLocked(position, type, pivot) {
    this._snapLockedVert.visible  = false
    this._snapLockedEdge.visible  = false
    this._snapLockedFace.visible  = false
    this._snapLockedWorld.visible = false
    const lockedMap = { vertex: [this._snapLockedVertGeo,  this._snapLockedVert],
                        edge:   [this._snapLockedEdgeGeo,  this._snapLockedEdge],
                        face:   [this._snapLockedFaceGeo,  this._snapLockedFace],
                        world:  [this._snapLockedWorldGeo, this._snapLockedWorld] }
    const entry = lockedMap[type] ?? lockedMap.vertex
    const [geo, points] = entry
    const posArr = new Float32Array([position.x, position.y, position.z])
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3))
    geo.attributes.position.needsUpdate = true
    points.visible = true

    const linePos = new Float32Array([
      pivot.x,    pivot.y,    pivot.z,
      position.x, position.y, position.z,
    ])
    this._snapLineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3))
    this._snapLineGeo.attributes.position.needsUpdate = true
    this._snapLine.visible = true
  }

  /** Hides the locked snap shape and guide line only. */
  clearSnapLocked() {
    this._snapLockedVert.visible  = false
    this._snapLockedEdge.visible  = false
    this._snapLockedFace.visible  = false
    this._snapLockedWorld.visible = false
    this._snapLine.visible        = false
  }

  /** Hides all snap candidate and locked-target visuals. */
  clearSnapDisplay() {
    this._snapVertCandidates.visible  = false
    this._snapEdgeCandidates.visible  = false
    this._snapFaceCandidates.visible  = false
    this._snapWorldCandidates.visible = false
    this._snapLockedVert.visible      = false
    this._snapLockedEdge.visible      = false
    this._snapLockedFace.visible      = false
    this._snapLockedWorld.visible     = false
    this._snapLine.visible            = false
  }

  /**
   * Toggles mesh visibility.
   * @param {boolean} visible
   */
  setVisible(visible) {
    this.cuboid.visible    = visible
    this.wireframe.visible = visible
    if (!visible) {
      // Direct mutation is safe here: hiding the whole object overrides any
      // sub-element state. The visual-state owners (setObjectSelected,
      // setFaceHighlight) remain authoritative for show paths.
      this.boxHelper.visible = false
      this.hlMesh.visible    = false
    }
  }

  /**
   * Shows a sketch rectangle preview on the XY ground plane.
   * @param {THREE.Vector3} p1 - first corner (XY)
   * @param {THREE.Vector3} p2 - opposite corner (XY)
   * @param {number} [z=0.001] - Z offset above ground to avoid z-fighting
   */
  showSketchRect(p1, p2, z = 0.001) {
    const minX = Math.min(p1.x, p2.x), maxX = Math.max(p1.x, p2.x)
    const minY = Math.min(p1.y, p2.y), maxY = Math.max(p1.y, p2.y)
    const positions = new Float32Array([
      minX, minY, z,
      maxX, minY, z,
      maxX, maxY, z,
      minX, maxY, z,
    ])
    this._sketchRectGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    this._sketchRectGeo.attributes.position.needsUpdate = true
    this._sketchRectLines.visible = true
    this._sketchFillGeo.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3))
    this._sketchFillGeo.setIndex([0, 1, 2, 0, 2, 3])
    this._sketchFillGeo.attributes.position.needsUpdate = true
    this._sketchFill.visible = true
  }

  /** Hides the sketch rect preview */
  clearSketchRect() {
    this._sketchRectLines.visible = false
    this._sketchFill.visible = false
  }

  /**
   * Removes all Three.js objects from the scene and disposes geometries.
   * @param {THREE.Scene} scene
   */
  dispose(scene) {
    scene.remove(this.cuboid)
    scene.remove(this.wireframe)
    scene.remove(this.boxHelper)
    scene.remove(this.hlMesh)
    scene.remove(this._extrusionLines)
    // Pivot candidate shapes (per-type)
    scene.remove(this._pivotVertPoints)
    scene.remove(this._pivotEdgePoints)
    scene.remove(this._pivotFacePoints)
    // Hovered pivot highlights (per-type)
    scene.remove(this._hovPivotVertPoints)
    scene.remove(this._hovPivotEdgePoints)
    scene.remove(this._hovPivotFacePoints)
    // Snap candidate indicators
    scene.remove(this._snapVertCandidates)
    scene.remove(this._snapEdgeCandidates)
    scene.remove(this._snapFaceCandidates)
    scene.remove(this._snapWorldCandidates)
    // Locked snap targets
    scene.remove(this._snapLockedVert)
    scene.remove(this._snapLockedEdge)
    scene.remove(this._snapLockedFace)
    scene.remove(this._snapLockedWorld)
    scene.remove(this._snapLine)
    scene.remove(this._sketchRectLines)
    scene.remove(this._sketchFill)
    scene.remove(this._hoverVertPoints)
    scene.remove(this._selVertPoints)
    scene.remove(this._hoverEdgeLines)
    scene.remove(this._selEdgeLines)
    scene.remove(this._selFaceMesh)
    this.cuboid.geometry.dispose()
    this.wireframe.geometry.dispose()
    this._hlGeo.dispose()
    this._extrusionLinesGeo.dispose()
    this._pivotVertGeo.dispose()
    this._pivotEdgeGeo.dispose()
    this._pivotFaceGeo.dispose()
    this._hovPivotVertGeo.dispose()
    this._hovPivotEdgeGeo.dispose()
    this._hovPivotFaceGeo.dispose()
    this._snapVertCandGeo.dispose()
    this._snapEdgeCandGeo.dispose()
    this._snapFaceCandGeo.dispose()
    this._snapWorldCandGeo.dispose()
    this._snapLockedVertGeo.dispose()
    this._snapLockedEdgeGeo.dispose()
    this._snapLockedFaceGeo.dispose()
    this._snapLockedWorldGeo.dispose()
    this._snapLineGeo.dispose()
    this._sketchRectGeo.dispose()
    this._sketchFillGeo.dispose()
    this._hoverVertGeo.dispose()
    this._selVertGeo.dispose()
    this._hoverEdgeGeo.dispose()
    this._selEdgeGeo.dispose()
    this._selFaceHlGeo.dispose()
  }

  // ── Sub-element hover / selection visuals (Phase 6) ──────────────────────

  /**
   * Shows a hover indicator on a single vertex.
   * @param {import('../graph/Vertex.js').Vertex} vertex
   */
  showVertexHover(vertex) {
    const pos = new Float32Array([vertex.position.x, vertex.position.y, vertex.position.z])
    this._hoverVertGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this._hoverVertGeo.attributes.position.needsUpdate = true
    this._hoverVertPoints.visible = true
  }

  /** Hides the vertex hover indicator. */
  clearVertexHover() {
    this._hoverVertPoints.visible = false
  }

  /**
   * Shows a hover indicator on a single edge.
   * @param {import('../graph/Edge.js').Edge} edge
   */
  showEdgeHover(edge) {
    const pos = new Float32Array([
      edge.v0.position.x, edge.v0.position.y, edge.v0.position.z,
      edge.v1.position.x, edge.v1.position.y, edge.v1.position.z,
    ])
    this._hoverEdgeGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this._hoverEdgeGeo.attributes.position.needsUpdate = true
    this._hoverEdgeLines.visible = true
  }

  /** Hides the edge hover indicator. */
  clearEdgeHover() {
    this._hoverEdgeLines.visible = false
  }

  /**
   * Renders all selected sub-elements (vertices, edges, faces).
   * Duck-typing is used to distinguish element types without domain imports.
   * @param {Set} selection  SceneModel.editSelection
   * @param {import('three').Vector3[]} corners  current corner array of active object
   */
  updateEditSelection(selection, corners) {
    const verts = [], edges = [], faceIndices = []
    for (const el of selection) {
      if ('v0' in el)                              edges.push(el)
      else if (Array.isArray(el.vertices))         faceIndices.push(el.index)
      else                                         verts.push(el)
    }

    // Selected vertices
    if (verts.length) {
      const pos = new Float32Array(verts.length * 3)
      verts.forEach((v, i) => {
        pos[i * 3] = v.position.x; pos[i * 3 + 1] = v.position.y; pos[i * 3 + 2] = v.position.z
      })
      this._selVertGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      this._selVertGeo.attributes.position.needsUpdate = true
      this._selVertPoints.visible = true
    } else {
      this._selVertPoints.visible = false
    }

    // Selected edges
    if (edges.length) {
      const pos = new Float32Array(edges.length * 6)
      edges.forEach((e, i) => {
        pos[i * 6]     = e.v0.position.x; pos[i * 6 + 1] = e.v0.position.y; pos[i * 6 + 2] = e.v0.position.z
        pos[i * 6 + 3] = e.v1.position.x; pos[i * 6 + 4] = e.v1.position.y; pos[i * 6 + 5] = e.v1.position.z
      })
      this._selEdgeGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      this._selEdgeGeo.attributes.position.needsUpdate = true
      this._selEdgeLines.visible = true
    } else {
      this._selEdgeLines.visible = false
    }

    // Selected faces
    if (faceIndices.length && corners) {
      const vPos = new Float32Array(faceIndices.length * 12) // 4 verts * 3 coords
      const idx  = []
      faceIndices.forEach((fi, i) => {
        const facePos = buildFaceHighlightPositions(corners, fi)
        vPos.set(facePos, i * 12)
        const b = i * 4
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3)
      })
      this._selFaceHlGeo.setAttribute('position', new THREE.BufferAttribute(vPos, 3))
      this._selFaceHlGeo.setIndex(idx)
      this._selFaceHlGeo.attributes.position.needsUpdate = true
      this._selFaceMesh.visible = true
    } else {
      this._selFaceMesh.visible = false
    }
  }

  /** Hides all selection highlight visuals. */
  clearEditSelection() {
    this._selVertPoints.visible  = false
    this._selEdgeLines.visible   = false
    this._selFaceMesh.visible    = false
  }

  /**
   * Updates the face highlight overlay.
   * @param {number|null} fi - face index; null clears the highlight
   * @param {THREE.Vector3[]} corners - current corner array
   */
  setFaceHighlight(fi, corners) {
    this.hlMesh.visible = (fi !== null)
    if (fi === null) {
      this._hlGeo.setIndex([])
      this._hlGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
      return
    }
    const pos = buildFaceHighlightPositions(corners, fi)
    this._hlGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this._hlGeo.setIndex([0, 1, 2,  0, 2, 3])
    this._hlGeo.attributes.position.needsUpdate = true
    this._hlGeo.computeBoundingSphere()
  }
}
