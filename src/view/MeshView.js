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
   * Updates the extrusion display lines (bracket / dimension-line style).
   * Draws: arm from saved corner → tipS, span tipS → tipC, arm tipC → current corner.
   * @param {THREE.Vector3[]} savedFaceCorners - 4 face vertices at drag start
   * @param {THREE.Vector3[]} currentFaceCorners - 4 face vertices at current position
   */
  setExtrusionDisplay(savedFaceCorners, currentFaceCorners) {
    // Bracket shape: extend from corners[0] in the corners[1] direction by a fixed length,
    // then connect the two tips with a span segment.
    //   savedFaceCorners[0]   ──────── tipS
    //                                  |  ← span
    //   currentFaceCorners[0] ──────── tipC
    const ARM_LEN = 0.5
    const armDir = new THREE.Vector3()
      .subVectors(savedFaceCorners[1], savedFaceCorners[0]).normalize()
    const tipS = savedFaceCorners[0].clone().addScaledVector(armDir,  ARM_LEN)
    const tipC = currentFaceCorners[0].clone().addScaledVector(armDir, ARM_LEN)

    // 3 line segments × 2 points × 3 components = 18 floats
    // [0] arm1 (saved corner → tipS), [1] span (tipS → tipC), [2] arm2 (tipC → current corner)
    const positions = new Float32Array(18)
    const s0 = savedFaceCorners[0]
    const c0 = currentFaceCorners[0]
    positions[0]  = s0.x;  positions[1]  = s0.y;  positions[2]  = s0.z
    positions[3]  = tipS.x; positions[4] = tipS.y; positions[5]  = tipS.z
    positions[6]  = tipS.x; positions[7] = tipS.y; positions[8]  = tipS.z
    positions[9]  = tipC.x; positions[10] = tipC.y; positions[11] = tipC.z
    positions[12] = tipC.x; positions[13] = tipC.y; positions[14] = tipC.z
    positions[15] = c0.x;  positions[16] = c0.y;  positions[17] = c0.z

    this._extrusionLinesGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    this._extrusionLinesGeo.attributes.position.needsUpdate = true
    this._extrusionLines.visible = true
  }

  /** Hides the extrusion display lines */
  clearExtrusionDisplay() {
    this._extrusionLines.visible = false
  }

  /**
   * Updates the face highlight overlay.
   * @param {number|null} fi - face index; null clears the highlight
   * @param {THREE.Vector3[]} corners - current corner array
   */
  setFaceHighlight(fi, corners) {
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
