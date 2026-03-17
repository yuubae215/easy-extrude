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
    this.cuboidMat = new THREE.MeshStandardMaterial({ color: 0x4fc3f7, roughness: 0.3, metalness: 0.3 })
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
