/**
 * ImportedMeshView — thin-client view for arbitrary triangle meshes received
 * from the Geometry Service (Phase C, ADR-017).
 *
 * Unlike MeshView (Cuboid), this view:
 *  - Accepts raw positions/normals/indices from the server (no local geometry computation).
 *  - Has no edit mesh, no face highlight, no pivot / snap indicators.
 *  - Exposes the same minimal interface used by AppController and SceneService
 *    (setVisible, setObjectSelected, dispose, no-op edit stubs).
 *
 * The mesh property is named `cuboid` to stay API-compatible with the raycasting
 * in AppController._hitAnyObject() / _hitActiveCuboid().
 */
import * as THREE from 'three'

export class ImportedMeshView {
  /**
   * @param {THREE.Scene} scene  Three.js scene to add objects to
   */
  constructor(scene) {
    this._geo = new THREE.BufferGeometry()
    this._mat = new THREE.MeshStandardMaterial({
      color: 0x888888,
      roughness: 0.5,
      metalness: 0.1,
      side: THREE.DoubleSide,
    })

    /** Named `cuboid` for API compatibility with AppController raycasting. */
    this.cuboid = new THREE.Mesh(this._geo, this._mat)
    scene.add(this.cuboid)

    this.boxHelper = new THREE.BoxHelper(this.cuboid, 0xaaaaaa)
    this.boxHelper.visible = false
    scene.add(this.boxHelper)
  }

  // ── Geometry update ─────────────────────────────────────────────────────────

  /**
   * Replaces the mesh geometry with data received from the Geometry Service.
   * @param {number[]} positions  flat [x,y,z, ...] array
   * @param {number[]} normals    flat [nx,ny,nz, ...] array (may be empty)
   * @param {number[]} indices    flat triangle index array (may be empty)
   */
  updateGeometryBuffers(positions, normals, indices) {
    if (positions.length % 3 !== 0) {
      console.warn('[ImportedMeshView] positions.length is not a multiple of 3 — skipping update')
      return
    }
    this._geo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3),
    )
    if (normals && normals.length) {
      this._geo.setAttribute(
        'normal',
        new THREE.Float32BufferAttribute(normals, 3),
      )
    } else {
      this._geo.deleteAttribute('normal')
      this._geo.computeVertexNormals()
    }
    if (indices && indices.length) {
      this._geo.setIndex(indices)
    } else {
      this._geo.setIndex(null)
    }
    this._geo.computeBoundingBox()
    this._geo.computeBoundingSphere()
    const s = this._geo.boundingSphere
    if (s) console.log(`[ImportedMeshView] bounding sphere: center=(${s.center.x.toFixed(2)}, ${s.center.y.toFixed(2)}, ${s.center.z.toFixed(2)}) r=${s.radius.toFixed(2)}`)
    this.boxHelper.update()
  }

  // ── Visual state ────────────────────────────────────────────────────────────

  /** Shows or hides the mesh. */
  setVisible(visible) {
    this.cuboid.visible = visible
  }

  /** Shows or hides the BoxHelper selection outline. */
  setObjectSelected(sel) {
    this.boxHelper.visible = sel
  }

  // ── Snap targets (bounding-box based) ──────────────────────────────────────

  /**
   * Returns snap targets derived from the bounding box of the imported mesh.
   * Snap types mirror those of Cuboid: corners → 'vertex', edge midpoints → 'edge',
   * face centers → 'face'.
   * @param {string} name  Object name used for target labels
   * @param {{ doVert: boolean, doEdge: boolean, doFace: boolean }} modes
   * @returns {{ label: string, position: THREE.Vector3, type: string }[]}
   */
  getSnapTargets(name, { doVert, doEdge, doFace }) {
    const bb = this._geo.boundingBox
    if (!bb) return []

    const { min, max } = bb
    const cx = (min.x + max.x) / 2
    const cy = (min.y + max.y) / 2
    const cz = (min.z + max.z) / 2
    const targets = []

    if (doVert) {
      // 8 bounding-box corners
      for (let xi = 0; xi < 2; xi++) {
        for (let yi = 0; yi < 2; yi++) {
          for (let zi = 0; zi < 2; zi++) {
            targets.push({
              label: `${name} Vertex`,
              position: new THREE.Vector3(
                xi ? max.x : min.x,
                yi ? max.y : min.y,
                zi ? max.z : min.z,
              ),
              type: 'vertex',
            })
          }
        }
      }
    }

    if (doEdge) {
      // 12 bounding-box edge midpoints
      const edgeMids = [
        // Bottom face (z=min)
        new THREE.Vector3(cx,    min.y, min.z),
        new THREE.Vector3(cx,    max.y, min.z),
        new THREE.Vector3(min.x, cy,    min.z),
        new THREE.Vector3(max.x, cy,    min.z),
        // Top face (z=max)
        new THREE.Vector3(cx,    min.y, max.z),
        new THREE.Vector3(cx,    max.y, max.z),
        new THREE.Vector3(min.x, cy,    max.z),
        new THREE.Vector3(max.x, cy,    max.z),
        // Vertical edges
        new THREE.Vector3(min.x, min.y, cz),
        new THREE.Vector3(max.x, min.y, cz),
        new THREE.Vector3(min.x, max.y, cz),
        new THREE.Vector3(max.x, max.y, cz),
      ]
      for (const p of edgeMids) {
        targets.push({ label: `${name} Edge`, position: p, type: 'edge' })
      }
    }

    if (doFace) {
      // 6 bounding-box face centers
      const faceCenters = [
        new THREE.Vector3(min.x, cy,    cz),
        new THREE.Vector3(max.x, cy,    cz),
        new THREE.Vector3(cx,    min.y, cz),
        new THREE.Vector3(cx,    max.y, cz),
        new THREE.Vector3(cx,    cy,    min.z),
        new THREE.Vector3(cx,    cy,    max.z),
      ]
      for (const p of faceCenters) {
        targets.push({ label: `${name} Face`, position: p, type: 'face' })
      }
    }

    return targets
  }

  // ── Edit-mode no-ops (keeps AppController.setMode() safe) ──────────────────

  setFaceHighlight()      {}
  clearExtrusionDisplay() {}
  clearSketchRect()       {}
  clearVertexHover()      {}
  clearEdgeHover()        {}
  clearEditSelection()    {}
  clearPivotDisplay()     {}
  showSnapCandidates()    {}
  showSnapLocked()        {}
  clearSnapLocked()       {}
  clearSnapDisplay()      {}

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  /**
   * Removes all Three.js objects from the scene and disposes GPU resources.
   * @param {THREE.Scene} scene
   */
  dispose(scene) {
    scene.remove(this.cuboid)
    scene.remove(this.boxHelper)
    this._geo.dispose()
    this._mat.dispose()
  }
}
