// @ts-nocheck
/**
 * GraspSampleView — the grasp-location declaration, drawn where it lives
 * (ADR-128; the 3D half of ADR-119 D2).
 *
 * ## Why this exists
 *
 * The declaration is entered as chips in a panel, but what it MEANS is spatial:
 * "the two long sides", "the right half of the top". A user reading `+x / -x`
 * cannot tell from the words whether they picked the faces they were looking at.
 * So input is 2D and confirmation is 3D — and the confirmation is not a
 * decorative highlight of the declared faces but **the exact points that will go
 * on the wire**. Drawing the intent rather than the payload would let the two
 * drift, which is the failure this repo keeps finding (a correct-looking picture
 * of something the request never carried — ADR-117).
 *
 * That choice also makes the DERIVED case visible for free: with no declaration
 * the same overlay shows ADR-118's hand-driven grid, so "you never said where"
 * is something the user can SEE on the object rather than only read in a caption
 * (原則 #31 — the state with no field of its own gets a picture instead).
 *
 * Read-only output projection (ADR-047 ghost lineage — sibling of GraspGhostView
 * / RegionGhostView). Sole owner = GraspController (原則 #4/#9): it constructs
 * this via an injected factory, refreshes it when the declaration or the hand
 * changes, and disposes it when the panel closes. It never writes back.
 *
 * Sizing follows the 原則 #27 pair rule: a world-space marker radius derived from
 * the sampled body's own extent, so the dots stay legible on a 60 mm widget and
 * do not swallow a 2 m pallet.
 *
 * **e2e レーンは未着手 (DEF-031).** 単体テストはこの overlay の呼び出し契約までしか
 * 見ない — 「チップを押した人が意図した面を押せたか」は宣言と実測が別レーンである
 * 以上 (ADR-114)、画面を実際に動かすレーンからしか出てこない。この overlay はまさに
 * その穴を*狭める*ために足したので、overlay 自身が焼かれていないことは宣言しておく。
 *
 * @module view/GraspSampleView
 */
import * as THREE from 'three'
import { COLOR } from '../theme/tokens.js'

/** Marker radius as a fraction of the sampled body's smallest half-extent. */
const MARKER_FRACTION = 0.16
/** Never draw a marker smaller than this in world units (legibility floor). */
const MARKER_MIN = 0.004
/** Normal whisker length, as a multiple of the marker radius. */
const WHISKER = 3

export class GraspSampleView {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this._scene = scene
    this._group = new THREE.Group()
    this._group.visible = false
    scene.add(this._group)

    // Two materials because the overlay carries a two-valued fact: these points
    // were CHOSEN, or they were derived because nobody chose.
    //
    // Declared uses `infoTone` — the declared token for "a decision landed" —
    // rather than the accent. The accent means "what you are operating on"
    // (ADR-100 G2), and these dots are not the selection: the object is selected
    // whether or not anyone declared anything, so painting them accent would put
    // a second meaning on one hue, which is the defect ADR-100 exists to prevent.
    this._declaredMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(COLOR.infoTone), transparent: true, opacity: 0.85, depthWrite: false,
    })
    // `entityDefault` is the declared token for "this thing has nothing to
    // report" — exactly what a derived sample is. Reused rather than tuned into
    // a fresh near-neutral, which is the defect ADR-100 was written about.
    this._derivedMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(COLOR.entityDefault), transparent: true, opacity: 0.5, depthWrite: false,
    })
    this._lineMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(COLOR.infoTone), transparent: true, opacity: 0.45,
    })

    /** @type {THREE.BufferGeometry[]} per-render geometries, cleared on each show */
    this._geometries = []
  }

  /**
   * Draw the samples a run would send.
   *
   * @param {{point:number[], normal:number[]}[]} samples  wire-shaped, verbatim
   * @param {{declared: boolean, extent: number}} opts
   *        `declared` — whether these came from the user's declaration (colour);
   *        `extent`   — the sampled body's smallest full extent, the world-space
   *                     input of the 原則 #27 size pair.
   */
  show(samples, { declared = false, extent = 0 } = {}) {
    this._clearGeometry()
    if (!samples || samples.length === 0) { this._group.visible = false; return }

    const radius = Math.max(MARKER_MIN, (extent / 2) * MARKER_FRACTION)
    const sphere = new THREE.SphereGeometry(radius, 8, 6)
    this._geometries.push(sphere)
    const mat = declared ? this._declaredMat : this._derivedMat

    // One InstancedMesh rather than N meshes: a 3×3 grid over six faces is 54
    // markers, and a per-sample Mesh would put 54 draw calls on every refresh of
    // a panel the user is actively typing in.
    const dots = new THREE.InstancedMesh(sphere, mat, samples.length)
    const m = new THREE.Matrix4()
    const linePoints = []
    for (const [i, s] of samples.entries()) {
      const [x, y, z] = s.point
      dots.setMatrixAt(i, m.makeTranslation(x, y, z))
      const [nx, ny, nz] = s.normal ?? [0, 0, 0]
      const L = radius * WHISKER
      // The outward normal is the fact `core/` derives the approach from, so it
      // is drawn rather than implied: a face declared with an inward normal
      // would otherwise look identical to a correct one.
      linePoints.push(x, y, z, x + nx * L, y + ny * L, z + nz * L)
    }
    dots.instanceMatrix.needsUpdate = true
    this._group.add(dots)
    this._rendered = [dots]

    const lineGeo = new THREE.BufferGeometry()
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePoints, 3))
    this._geometries.push(lineGeo)
    const lines = new THREE.LineSegments(lineGeo, this._lineMat)
    this._group.add(lines)
    this._rendered.push(lines)

    this._group.visible = true
  }

  /** Hide the overlay, releasing this render's geometry (no state kept). */
  clear() {
    this._clearGeometry()
    this._group.visible = false
  }

  /** Remove and dispose everything the last `show` added (symmetric — 原則 #9). */
  _clearGeometry() {
    for (const obj of this._rendered ?? []) this._group.remove(obj)
    for (const g of this._geometries) g.dispose()
    this._geometries = []
    this._rendered = []
  }

  /** Symmetric teardown of everything the constructor added. */
  dispose() {
    this._clearGeometry()
    this._scene.remove(this._group)
    this._declaredMat.dispose()
    this._derivedMat.dispose()
    this._lineMat.dispose()
  }
}
