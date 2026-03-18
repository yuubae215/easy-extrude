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
    // コの字形: 頂点 corners[0] を起点に corners[1] 方向へ固定長伸ばし、先端同士を棒で結ぶ
    //   savedFaceCorners[0] ──────── tipS
    //                                |  ← 寸法棒
    //   currentFaceCorners[0] ────── tipC
    const ARM_LEN = 0.5
    const armDir = new THREE.Vector3()
      .subVectors(savedFaceCorners[1], savedFaceCorners[0]).normalize()
    const tipS = savedFaceCorners[0].clone().addScaledVector(armDir,  ARM_LEN)
    const tipC = currentFaceCorners[0].clone().addScaledVector(armDir, ARM_LEN)

    // 3 line segments × 2 points × 3 components = 18 floats
    // [0] 腕1 (saved頂点 → tipS), [1] 棒 (tipS → tipC), [2] 腕2 (tipC → current頂点)
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
