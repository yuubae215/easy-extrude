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

    /**
     * Centre of the geometry's bounding box in local geometry space (i.e. with
     * cuboid.position = 0,0,0).  Set once the first geometry is loaded.
     * Used by updateGeometry() to convert corner positions → a position offset.
     * @type {THREE.Vector3 | null}
     */
    this._originalCenter = null
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
      // setIndex() only auto-wraps plain Arrays; TypedArrays (e.g. Uint32Array from
      // base64ToU32) must be wrapped manually, otherwise geometry.index.array is
      // undefined and the WebGL renderer throws on the next render tick.
      this._geo.setIndex(
        Array.isArray(indices)
          ? indices
          : new THREE.BufferAttribute(indices instanceof Uint32Array ? indices : new Uint32Array(indices), 1),
      )
    } else {
      this._geo.setIndex(null)
    }
    this._geo.computeBoundingBox()
    this._geo.computeBoundingSphere()
    const s = this._geo.boundingSphere
    if (s) console.log(`[ImportedMeshView] bounding sphere: center=(${s.center.x.toFixed(2)}, ${s.center.y.toFixed(2)}, ${s.center.z.toFixed(2)}) r=${s.radius.toFixed(2)}`)
    // Capture original geometry centre for updateGeometry() position mapping.
    if (this._geo.boundingBox) {
      this._originalCenter = new THREE.Vector3()
      this._geo.boundingBox.getCenter(this._originalCenter)
    }
    this.boxHelper.update()
  }

  // ── Move support ─────────────────────────────────────────────────────────────

  /**
   * Returns the 8 bounding-box corners in world space (respects current
   * cuboid.position offset).  Used by SceneService to initialise ImportedMesh
   * corners after geometry is first loaded.
   * @returns {THREE.Vector3[]}
   */
  getInitialCorners8() {
    const bb = this._geo.boundingBox
    if (!bb) return []
    const pos = this.cuboid.position
    const { min, max } = bb
    const corners = []
    for (let xi = 0; xi < 2; xi++) {
      for (let yi = 0; yi < 2; yi++) {
        for (let zi = 0; zi < 2; zi++) {
          corners.push(new THREE.Vector3(
            (xi ? max.x : min.x) + pos.x,
            (yi ? max.y : min.y) + pos.y,
            (zi ? max.z : min.z) + pos.z,
          ))
        }
      }
    }
    return corners
  }

  /**
   * Applies a new set of 8 synthetic corners to the mesh position.
   * The centroid of the 8 corners defines the new world-space centre of the
   * mesh; cuboid.position is set to (newCentre − originalGeometryCentre).
   * @param {THREE.Vector3[]} corners
   */
  updateGeometry(corners) {
    if (!corners || corners.length === 0 || !this._originalCenter) return
    const newCenter = corners.reduce(
      (acc, c) => acc.add(c), new THREE.Vector3(),
    ).divideScalar(corners.length)
    this.cuboid.position.copy(newCenter).sub(this._originalCenter)
    this.boxHelper.update()
  }

  /** Refreshes the BoxHelper outline after an external position change. */
  updateBoxHelper() {
    this.boxHelper.update()
  }

  /**
   * Returns the raw geometry buffers and current position offset for serialization.
   * positions / normals are Float32Array; indices is Uint32Array (may be null).
   * offset is the current cuboid.position (world-space translation applied via updateGeometry).
   * @returns {{ positions: Float32Array, normals: Float32Array|null, indices: Uint32Array|null, offset: {x:number,y:number,z:number} } | null}
   */
  getGeometryBuffers() {
    const posAttr = this._geo.attributes.position
    if (!posAttr) return null
    const nrmAttr  = this._geo.attributes.normal ?? null
    const idxAttr  = this._geo.index ?? null
    const pos      = this.cuboid.position
    return {
      positions: new Float32Array(posAttr.array),
      normals:   nrmAttr ? new Float32Array(nrmAttr.array) : null,
      indices:   idxAttr ? new Uint32Array(idxAttr.array)  : null,
      offset:    { x: pos.x, y: pos.y, z: pos.z },
    }
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

  // ── Snap targets ────────────────────────────────────────────────────────────

  /**
   * Returns snap targets for the imported mesh.
   * Vertices: actual geometry vertex positions (world space).
   * Edges / Faces: bounding-box midpoints and centers (AABB approximation).
   * @param {string} name  Object name used for target labels
   * @param {{ doVert: boolean, doEdge: boolean, doFace: boolean }} modes
   * @returns {{ label: string, position: THREE.Vector3, type: string }[]}
   */
  getSnapTargets(name, { doVert, doEdge, doFace }) {
    const bb = this._geo.boundingBox
    if (!bb) return []

    // Offset all snap targets by the current mesh position (set via updateGeometry).
    const off = this.cuboid.position
    const { min, max } = bb
    const mnx = min.x + off.x, mxx = max.x + off.x
    const mny = min.y + off.y, mxy = max.y + off.y
    const mnz = min.z + off.z, mxz = max.z + off.z
    const cx = (mnx + mxx) / 2
    const cy = (mny + mxy) / 2
    const cz = (mnz + mxz) / 2
    const targets = []

    if (doVert) {
      // Actual mesh vertex positions (world space) from the geometry buffer.
      const posAttr = this._geo.attributes.position
      if (posAttr) {
        const ox = off.x, oy = off.y, oz = off.z
        for (let i = 0, n = posAttr.count; i < n; i++) {
          targets.push({
            label:    `${name} Vertex`,
            position: new THREE.Vector3(
              posAttr.getX(i) + ox,
              posAttr.getY(i) + oy,
              posAttr.getZ(i) + oz,
            ),
            type: 'vertex',
          })
        }
      }
    }

    if (doEdge) {
      // 12 bounding-box edge midpoints
      const edgeMids = [
        // Bottom face (z=min)
        new THREE.Vector3(cx,  mny, mnz),
        new THREE.Vector3(cx,  mxy, mnz),
        new THREE.Vector3(mnx, cy,  mnz),
        new THREE.Vector3(mxx, cy,  mnz),
        // Top face (z=max)
        new THREE.Vector3(cx,  mny, mxz),
        new THREE.Vector3(cx,  mxy, mxz),
        new THREE.Vector3(mnx, cy,  mxz),
        new THREE.Vector3(mxx, cy,  mxz),
        // Vertical edges
        new THREE.Vector3(mnx, mny, cz),
        new THREE.Vector3(mxx, mny, cz),
        new THREE.Vector3(mnx, mxy, cz),
        new THREE.Vector3(mxx, mxy, cz),
      ]
      for (const p of edgeMids) {
        targets.push({ label: `${name} Edge`, position: p, type: 'edge' })
      }
    }

    if (doFace) {
      // 6 bounding-box face centers
      const faceCenters = [
        new THREE.Vector3(mnx, cy,  cz),
        new THREE.Vector3(mxx, cy,  cz),
        new THREE.Vector3(cx,  mny, cz),
        new THREE.Vector3(cx,  mxy, cz),
        new THREE.Vector3(cx,  cy,  mnz),
        new THREE.Vector3(cx,  cy,  mxz),
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
  showSnapNearest()       {}
  clearSnapNearest()      {}
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
