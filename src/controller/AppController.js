/**
 * AppController - ユーザー入力の処理とアニメーションループの管理
 *
 * Model (CuboidModel) と View (SceneView / MeshView / UIView) を繋ぐ。
 * 副作用: イベントリスナー登録・requestAnimationFrame・Model 状態の更新を行う。
 */
import * as THREE from 'three'
import { FACES, computeOutwardFaceNormal, getCentroid, toNDC } from '../model/CuboidModel.js'

export class AppController {
  /**
   * @param {{ corners: THREE.Vector3[] }} model
   * @param {import('../view/SceneView.js').SceneView} sceneView
   * @param {import('../view/MeshView.js').MeshView} meshView
   * @param {import('../view/UIView.js').UIView} uiView
   */
  constructor(model, sceneView, meshView, uiView) {
    this._corners   = model.corners
    this._sceneView = sceneView
    this._meshView  = meshView
    this._uiView    = uiView

    // 初期ジオメトリを構築
    meshView.updateGeometry(this._corners)

    // 選択モード
    this._selectionMode = 'object'

    // ── オブジェクトモード状態 ──────────────────────────────────────────
    this._objSelected           = false
    this._objDragging           = false
    this._objCtrlDrag           = false
    this._objDragPlane          = new THREE.Plane()
    this._objDragStart          = new THREE.Vector3()
    this._objDragStartCorners   = []
    this._objRotateStartX       = 0
    this._objRotateCentroid     = new THREE.Vector3()
    this._objRotateStartCorners = []

    // ── 面モード状態 ────────────────────────────────────────────────────
    this._hoveredFace      = null
    this._faceDragging     = false
    this._dragFaceIdx      = null
    this._dragNormal       = new THREE.Vector3()
    this._dragPlane        = new THREE.Plane()
    this._dragStart        = new THREE.Vector3()
    this._savedFaceCorners = []

    // レイキャスター
    this._raycaster = new THREE.Raycaster()
    this._mouse     = new THREE.Vector2()

    // UI 連携
    uiView.setCanvas(sceneView.renderer.domElement)
    uiView.onModeChange(mode => this.setMode(mode))

    this._bindEvents()
    this.setMode('object')
  }

  // ─── 便利ゲッター ──────────────────────────────────────────────────────────
  get _camera()   { return this._sceneView.camera }
  get _controls() { return this._sceneView.controls }

  // ─── イベントバインド ─────────────────────────────────────────────────────
  _bindEvents() {
    window.addEventListener('mousemove', e => this._onMouseMove(e))
    window.addEventListener('mousedown', e => this._onMouseDown(e))
    window.addEventListener('mouseup',   e => this._onMouseUp(e))
    window.addEventListener('keydown',   e => this._onKeyDown(e))
  }

  // ─── レイキャスト ─────────────────────────────────────────────────────────
  _updateMouse(e) {
    const v = toNDC(e.clientX, e.clientY, innerWidth, innerHeight)
    this._mouse.copy(v)
  }

  _hitCuboid() {
    this._raycaster.setFromCamera(this._mouse, this._camera)
    const hits = this._raycaster.intersectObject(this._meshView.cuboid)
    return hits.length ? hits[0] : null
  }

  _hitFace() {
    const hit = this._hitCuboid()
    if (!hit) return null
    return { faceIdx: Math.floor(hit.face.a / 4), point: hit.point }
  }

  // ─── ユーティリティ ──────────────────────────────────────────────────────
  /** 3D ワールド座標をスクリーン座標 (px) に変換する */
  _projectToScreen(position) {
    const v = position.clone().project(this._camera)
    return {
      x: (v.x + 1) / 2 * innerWidth,
      y: (-v.y + 1) / 2 * innerHeight,
    }
  }

  // ─── モード管理 ───────────────────────────────────────────────────────────
  setMode(mode) {
    this._selectionMode = mode
    if (mode === 'object') {
      this._meshView.setFaceHighlight(null, this._corners)
      this._meshView.clearExtrusionDisplay()
      this._uiView.clearExtrusionLabel()
      this._hoveredFace  = null
      this._faceDragging = false
      this._dragFaceIdx  = null
      this._uiView.setStatus(this._objSelected ? 'オブジェクト選択中' : '')
    } else {
      this._setObjectSelected(false)
      this._objDragging = false
      this._uiView.setStatus('')
    }
    this._controls.enabled = true
    this._uiView.updateMode(mode)
  }

  _setObjectSelected(sel) {
    this._objSelected = sel
    this._meshView.setObjectSelected(sel)
    this._uiView.setStatus(sel ? 'オブジェクト選択中' : '')
  }

  // ─── マウスイベント ───────────────────────────────────────────────────────
  _onMouseMove(e) {
    this._updateMouse(e)

    if (this._selectionMode === 'object') {
      if (this._objDragging) {
        if (this._objCtrlDrag) {
          // 重心周りの Y 軸回転
          const angle = (e.clientX - this._objRotateStartX) * 0.01
          const quat  = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle)
          this._objRotateStartCorners.forEach((c, i) => {
            this._corners[i].copy(c).sub(this._objRotateCentroid).applyQuaternion(quat).add(this._objRotateCentroid)
          })
        } else {
          // カメラ正面のドラッグ平面上で平行移動
          this._raycaster.setFromCamera(this._mouse, this._camera)
          const pt = new THREE.Vector3()
          if (this._raycaster.ray.intersectPlane(this._objDragPlane, pt)) {
            const delta = pt.clone().sub(this._objDragStart)
            this._objDragStartCorners.forEach((c, i) => this._corners[i].copy(c).add(delta))
          }
        }
        this._meshView.updateGeometry(this._corners)
        if (this._objSelected) this._meshView.updateBoxHelper()
      } else {
        this._uiView.setCursor(this._hitCuboid() ? 'pointer' : 'default')
      }
      return
    }

    // ── 面モード ────────────────────────────────────────────────────────
    if (this._faceDragging) {
      this._raycaster.setFromCamera(this._mouse, this._camera)
      const pt = new THREE.Vector3()
      if (!this._raycaster.ray.intersectPlane(this._dragPlane, pt)) return
      const dist   = pt.clone().sub(this._dragStart).dot(this._dragNormal)
      const offset = this._dragNormal.clone().multiplyScalar(dist)
      FACES[this._dragFaceIdx].corners.forEach((ci, i) => {
        this._corners[ci].copy(this._savedFaceCorners[i]).add(offset)
      })
      this._meshView.updateGeometry(this._corners)
      this._meshView.setFaceHighlight(this._dragFaceIdx, this._corners)
      this._uiView.setStatus(`${FACES[this._dragFaceIdx].name}  Δ ${dist.toFixed(3)}`)

      // 押し出し量表示: ホチキス状のラインとラベル
      const currentFaceCorners = FACES[this._dragFaceIdx].corners.map(ci => this._corners[ci])
      this._meshView.setExtrusionDisplay(this._savedFaceCorners, currentFaceCorners)
      const savedCenter = this._savedFaceCorners
        .reduce((acc, v) => acc.add(v), new THREE.Vector3()).divideScalar(4)
      const currentCenter = currentFaceCorners
        .reduce((acc, v) => acc.add(v), new THREE.Vector3()).divideScalar(4)
      const midpoint = savedCenter.clone().add(currentCenter).multiplyScalar(0.5)
      const screen = this._projectToScreen(midpoint)
      this._uiView.setExtrusionLabel(`Δ ${Math.abs(dist).toFixed(3)}`, screen.x, screen.y)
      return
    }

    // 面ホバー検出
    const hit = this._hitFace()
    const fi  = hit ? hit.faceIdx : null
    if (fi !== this._hoveredFace) {
      this._hoveredFace = fi
      this._meshView.setFaceHighlight(fi, this._corners)
      this._uiView.setStatus(fi !== null ? FACES[fi].name : '')
      this._uiView.setCursor(fi !== null ? 'pointer' : 'default')
    }
  }

  _onMouseDown(e) {
    if (e.button !== 0) return
    this._updateMouse(e)

    if (this._selectionMode === 'object') {
      const hit = this._hitCuboid()
      if (hit) {
        if (!this._objSelected) this._setObjectSelected(true)
        this._objDragging       = true
        this._objCtrlDrag       = e.ctrlKey
        this._controls.enabled  = false
        const camDir = new THREE.Vector3()
        this._camera.getWorldDirection(camDir)
        this._objDragPlane.setFromNormalAndCoplanarPoint(camDir, hit.point)
        this._objDragStart.copy(hit.point)
        this._objDragStartCorners = this._corners.map(c => c.clone())
        if (e.ctrlKey) {
          this._objRotateStartX = e.clientX
          this._objRotateCentroid.copy(getCentroid(this._corners))
          this._objRotateStartCorners = this._corners.map(c => c.clone())
        }
      } else {
        this._setObjectSelected(false)
      }
      return
    }

    // ── 面モード ────────────────────────────────────────────────────────
    const hit = this._hitFace()
    if (!hit) return
    this._faceDragging        = true
    this._dragFaceIdx         = hit.faceIdx
    this._controls.enabled    = false
    this._dragNormal.copy(computeOutwardFaceNormal(this._corners, this._dragFaceIdx))
    const camDir = new THREE.Vector3()
    this._camera.getWorldDirection(camDir)
    this._dragPlane.setFromNormalAndCoplanarPoint(camDir, hit.point)
    this._dragStart.copy(hit.point)
    this._savedFaceCorners = FACES[this._dragFaceIdx].corners.map(ci => this._corners[ci].clone())
  }

  _onMouseUp(e) {
    if (e.button !== 0) return
    if (this._objDragging)  { this._objDragging  = false; this._objCtrlDrag = false; this._controls.enabled = true }
    if (this._faceDragging) {
      this._faceDragging = false
      this._dragFaceIdx  = null
      this._controls.enabled = true
      this._meshView.clearExtrusionDisplay()
      this._uiView.clearExtrusionLabel()
    }
  }

  _onKeyDown(e) {
    if (e.key === 'o' || e.key === 'O') this.setMode('object')
    if (e.key === 'f' || e.key === 'F') this.setMode('face')
  }

  // ─── アニメーションループ ─────────────────────────────────────────────────
  start() {
    const loop = () => {
      requestAnimationFrame(loop)
      this._sceneView.render()
    }
    loop()
  }
}
