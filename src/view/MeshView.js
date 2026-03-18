/**
 * MeshView - Three.js メッシュ描画の管理
 *
 * 副作用: Three.js オブジェクトの生成・シーンへの追加・ジオメトリ更新を行う。
 * 純粋なジオメトリ計算は CuboidModel の関数に委譲する。
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

  /** コーナー配列からジオメトリを再構築してメッシュへ反映する */
  updateGeometry(corners) {
    const newGeo = buildGeometry(corners)
    this.cuboid.geometry.dispose()
    this.cuboid.geometry = newGeo
    this.wireframe.geometry.dispose()
    this.wireframe.geometry = new THREE.EdgesGeometry(newGeo, 1)
  }

  /** オブジェクト選択状態の外観を更新する */
  setObjectSelected(sel) {
    this.cuboidMat.emissive.set(sel ? 0x112244 : 0x000000)
    this.boxHelper.visible = sel
    if (sel) this.boxHelper.update()
  }

  /** BoxHelper を現在のジオメトリに合わせて更新する */
  updateBoxHelper() {
    this.boxHelper.update()
  }

  /**
   * 押し出し表示ラインを更新する (コの字 = 寸法線スタイル)
   * 元の面中心のティック線 + 現在の面中心のティック線 + 両中心を結ぶ寸法線 の 3 本
   * @param {THREE.Vector3[]} savedFaceCorners - ドラッグ開始時の面の 4 頂点
   * @param {THREE.Vector3[]} currentFaceCorners - 現在の面の 4 頂点
   */
  setExtrusionDisplay(savedFaceCorners, currentFaceCorners) {
    // 各面の中心
    const savedCenter   = savedFaceCorners.reduce((a, v) => a.add(v), new THREE.Vector3()).divideScalar(4)
    const currentCenter = currentFaceCorners.reduce((a, v) => a.add(v.clone()), new THREE.Vector3()).divideScalar(4)

    // ティック方向: 面の最初のエッジを正規化して使う
    const tick = new THREE.Vector3().subVectors(savedFaceCorners[1], savedFaceCorners[0]).normalize()
    const tickHalfLen = 0.35

    // 3 line segments × 2 points × 3 components = 18 floats
    // [0] 元の面中心ティック, [1] 中心 → 中心の寸法線, [2] 現在の面中心ティック
    const positions = new Float32Array(18)
    const sa = savedCenter.clone().addScaledVector(tick, -tickHalfLen)
    const sb = savedCenter.clone().addScaledVector(tick,  tickHalfLen)
    const ca = currentCenter.clone().addScaledVector(tick, -tickHalfLen)
    const cb = currentCenter.clone().addScaledVector(tick,  tickHalfLen)
    positions[0]  = sa.x; positions[1]  = sa.y; positions[2]  = sa.z
    positions[3]  = sb.x; positions[4]  = sb.y; positions[5]  = sb.z
    positions[6]  = savedCenter.x;   positions[7]  = savedCenter.y;   positions[8]  = savedCenter.z
    positions[9]  = currentCenter.x; positions[10] = currentCenter.y; positions[11] = currentCenter.z
    positions[12] = ca.x; positions[13] = ca.y; positions[14] = ca.z
    positions[15] = cb.x; positions[16] = cb.y; positions[17] = cb.z

    this._extrusionLinesGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    this._extrusionLinesGeo.attributes.position.needsUpdate = true
    this._extrusionLines.visible = true
  }

  /** 押し出し表示ラインを非表示にする */
  clearExtrusionDisplay() {
    this._extrusionLines.visible = false
  }

  /**
   * 面ハイライトを更新する
   * @param {number|null} fi - 面インデックス。null でハイライトを消す
   * @param {THREE.Vector3[]} corners - 現在のコーナー配列
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
