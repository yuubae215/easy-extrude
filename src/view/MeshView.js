/**
 * MeshView - manages Three.js mesh rendering
 *
 * Side effects: creates Three.js objects, adds them to the scene, and updates geometry.
 * Pure geometry calculations are delegated to CuboidModel functions.
 */
import * as THREE from 'three'
import { buildGeometryFromVoxels } from '../model/VoxelModel.js'

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

    // Pivot candidate dots (yellow, fixed screen size)
    this._pivotPointsGeo = new THREE.BufferGeometry()
    this._pivotPoints = new THREE.Points(
      this._pivotPointsGeo,
      new THREE.PointsMaterial({ color: 0xffeb3b, size: 7, sizeAttenuation: false, depthTest: false }),
    )
    this._pivotPoints.visible = false
    scene.add(this._pivotPoints)

    // Hovered pivot highlight (orange, larger)
    this._hoveredPivotGeo = new THREE.BufferGeometry()
    this._hoveredPivotPoints = new THREE.Points(
      this._hoveredPivotGeo,
      new THREE.PointsMaterial({ color: 0xff8c00, size: 14, sizeAttenuation: false, depthTest: false }),
    )
    this._hoveredPivotPoints.visible = false
    scene.add(this._hoveredPivotPoints)
  }

  /**
   * Rebuilds geometry from a VoxelShape and applies it to the mesh.
   * @returns {FaceDescriptor[]} exposed faces (index matches Math.floor(hit.face.a / 4))
   */
  updateGeometryFromVoxelShape(shape) {
    const { geometry, exposedFaces } = buildGeometryFromVoxels(shape)
    this.cuboid.geometry.dispose()
    this.cuboid.geometry = geometry
    this.wireframe.geometry.dispose()
    this.wireframe.geometry = new THREE.EdgesGeometry(geometry, 1)
    return exposedFaces
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
   * Shows pivot candidate dots.
   * @param {{ label: string, position: THREE.Vector3 }[]} candidates
   */
  showPivotCandidates(candidates) {
    const positions = new Float32Array(candidates.length * 3)
    candidates.forEach((c, i) => {
      positions[i * 3]     = c.position.x
      positions[i * 3 + 1] = c.position.y
      positions[i * 3 + 2] = c.position.z
    })
    this._pivotPointsGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    this._pivotPointsGeo.attributes.position.needsUpdate = true
    this._pivotPoints.visible = true
    this._hoveredPivotPoints.visible = false
  }

  /**
   * Highlights the hovered pivot candidate; pass null to clear.
   * @param {THREE.Vector3|null} position
   */
  setHoveredPivot(position) {
    if (!position) {
      this._hoveredPivotPoints.visible = false
      return
    }
    const pos = new Float32Array([position.x, position.y, position.z])
    this._hoveredPivotGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this._hoveredPivotGeo.attributes.position.needsUpdate = true
    this._hoveredPivotPoints.visible = true
  }

  /** Hides all pivot candidate display */
  clearPivotDisplay() {
    this._pivotPoints.visible = false
    this._hoveredPivotPoints.visible = false
  }

  /**
   * Shows a single snap target indicator (world origin during Ctrl+grab).
   * @param {THREE.Vector3} position
   * @param {boolean} snapping - true = orange (locked), false = yellow (in range)
   */
  showSnapTarget(position, snapping) {
    const pos = new Float32Array([position.x, position.y, position.z])
    if (snapping) {
      this._hoveredPivotGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      this._hoveredPivotGeo.attributes.position.needsUpdate = true
      this._hoveredPivotPoints.visible = true
      this._pivotPoints.visible = false
    } else {
      this._pivotPointsGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      this._pivotPointsGeo.attributes.position.needsUpdate = true
      this._pivotPoints.visible = true
      this._hoveredPivotPoints.visible = false
    }
  }

  /**
   * Toggles mesh visibility.
   * @param {boolean} visible
   */
  setVisible(visible) {
    this.cuboid.visible    = visible
    this.wireframe.visible = visible
    if (!visible) {
      this.boxHelper.visible = false
      this.hlMesh.visible    = false
    }
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
    scene.remove(this._pivotPoints)
    scene.remove(this._hoveredPivotPoints)
    this.cuboid.geometry.dispose()
    this.wireframe.geometry.dispose()
    this._hlGeo.dispose()
    this._extrusionLinesGeo.dispose()
    this._pivotPointsGeo.dispose()
    this._hoveredPivotGeo.dispose()
  }

  /**
   * Updates the face highlight overlay using 4 vertex positions directly.
   * @param {THREE.Vector3[]|null} verts - 4 vertices; null clears the highlight
   */
  setFaceHighlightFromVerts(verts) {
    if (!verts) {
      this.clearFaceHighlight()
      return
    }
    const pos = new Float32Array(12)
    verts.forEach((v, i) => { pos[i*3] = v.x; pos[i*3+1] = v.y; pos[i*3+2] = v.z })
    this._hlGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this._hlGeo.setIndex([0, 1, 2,  0, 2, 3])
    this._hlGeo.attributes.position.needsUpdate = true
    this._hlGeo.computeBoundingSphere()
  }

  /** Clears the face highlight overlay. */
  clearFaceHighlight() {
    this._hlGeo.setIndex([])
    this._hlGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
  }
}
