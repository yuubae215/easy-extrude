# View Layer — Three.js & DOM レンダリング

**責務**: レンダリング、Three.js シーン管理、DOM UI。

ファイル: `MeshView.js`, `ImportedMeshView.js`, `SceneView.js`, `UIView.js`,
`OutlinerView.js`, `GizmoView.js`, `NodeEditorView.js`

---

## Meta Model: 副作用の集積地

View 層は Three.js・DOM 操作という「副作用の塊」である。

| 許可 | 禁止 |
|------|------|
| `THREE.*` の直接操作 | ドメインロジック（`Cuboid.extrude()` 等の再実装） |
| `document.*` の操作 | `SceneModel` への直接書き込み |
| ビジュアル状態の保持 | Service メソッドの直接呼び出し（Controller 経由） |

## ビジュアル状態の所有権 (MENTAL_MODEL §1)

各ビジュアルフラグは **唯一の mutator 関数**が所有する:

| 要素 | 所有者（メソッド） |
|------|------------------|
| `hlMesh.visible` | `setFaceHighlight()` |
| `cuboid.visible` / `wireframe.visible` | `setVisible()` |
| `boxHelper.visible` | `setObjectSelected()` |

これらのフラグを所有者メソッド以外から変更してはならない。

## メモリ管理の対称性 (MENTAL_MODEL §4)

`constructor` 内の全 `scene.add()` と `new THREE.BufferGeometry()` は
`dispose()` に対応する `scene.remove()` と `.dispose()` を持つこと。
同じコミットで追加・削除を対称に実装する。

## モバイル UI の安定性 (MENTAL_MODEL §3)

- 各モードで表示するボタンセットは固定。非活性時は `disabled` を使い `hidden` にしない。
- `showToast()` は `_isMobile()` を確認して `bottom` を調整する（モバイル: `96px`）。

## 楽観的ロックの視覚フィードバック

Service 層が `isProcessing = true` を emit した場合、View は対象オブジェクトへの
ポインターイベントを無効化し、ローディング UI を表示する責務を持つ。
`isProcessing` フラグの判定ロジックは View に書かず、Controller から View へ
メソッド呼び出しで委譲する。詳細は `docs/CONCURRENCY.md` §4 参照。
