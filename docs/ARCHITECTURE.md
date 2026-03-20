# Architecture

easy-extrude は MVC パターンで構成された Web ベースの 3D モデリングアプリ。
将来的なドメイン駆動設計（DDD）への移行を見据えて、段階的に整理している。

---

## 全体構成

```
src/
  main.js                      # エントリポイント: MVC を組み立てて start()
  model/
    CuboidModel.js             # 純粋関数: ジオメトリ計算 (ステートレス)
    SceneModel.js              # ドメイン状態: シーンオブジェクト + モード
  view/
    SceneView.js               # Three.js シーン / カメラ / レンダラー
    MeshView.js                # オブジェクトごとのメッシュと視覚状態
    UIView.js                  # DOM UI (ヘッダー / N パネル / ステータスバー)
    GizmoView.js               # ワールド軸ギズモ (右上)
    OutlinerView.js            # シーン階層サイドバー (左)
  controller/
    AppController.js           # 入力ハンドリング + MVC 調整
```

---

## レイヤー責任

### Model

| モジュール | 責任 |
|-----------|------|
| `CuboidModel.js` | 純粋関数のみ。副作用なし。ジオメトリ構築・法線計算・座標変換 |
| `SceneModel.js` | ドメイン状態を保持。`_objects` (Map) / `_activeId` / `_selectionMode` / `_editSubstate` |

`SceneModel` は Three.js に依存しない純粋な状態コンテナ。
DDD 移行時にエンティティ（Cuboid, Sketch）とリポジトリに分化する予定。

### View

| モジュール | 責任 |
|-----------|------|
| `SceneView` | Three.js の初期化 (レンダラー / カメラ / OrbitControls / グリッド / 照明) |
| `MeshView` | 1 オブジェクト = 1 MeshView。メッシュ / ワイヤーフレーム / ハイライト / スケッチ矩形を所有 |
| `UIView` | Blender 風 DOM UI。`setStatusRich()` / `updateNPanel()` / `showAddMenu()` 等 |
| `GizmoView` | 右上の小キャンバスに軸ギズモを描画。クリックでカメラスナップ |
| `OutlinerView` | 左サイドバー。オブジェクト一覧・可視切替・削除・リネームのコールバックを提供 |

**ビジュアル状態の所有権** (ADR-008 の契約):

| 要素 | 所有者 |
|------|--------|
| `hlMesh.visible` | `setFaceHighlight()` |
| `cuboid.visible` / `wireframe.visible` | `setVisible()` |
| `boxHelper.visible` | `setObjectSelected()` |

### Controller

`AppController` の責任:

- DOM イベントのバインドと分岐 (`_bindEvents`)
- インタラクション状態の保持 (ドラッグ・ホバー・グラブ・スケッチフェーズ等)
- `SceneModel` のドメイン状態を読み書き
- View を呼び出して描画を更新
- アニメーションループ (`start()`)
- `setMode()` — モード遷移の唯一の入口 (ADR-008)

---

## データフロー

```
ユーザー入力
    |
    v
AppController (_onMouseDown / _onKeyDown 等)
    |-- SceneModel を更新 (addObject / setMode / setActiveId 等)
    |-- View を直接呼び出し (meshView.updateGeometry / uiView.setStatus 等)
    |
    v
requestAnimationFrame ループ
    |-- SceneView.render()  → Three.js がメッシュを描画
    |-- GizmoView.update()  → ギズモを再描画
```

View はコントローラからのみ更新される (View は Model を直接参照しない)。

---

## SceneObject の構造

```javascript
{
  id:          string,                  // "obj_0_1234567890"
  name:        string,                  // "Cube", "Sketch.001"
  description: string,
  dimension:   1 | 2 | 3,             // 1D(将来) / 2D スケッチ / 3D キュービック
  corners:     THREE.Vector3[8] | [],  // 3D のみ有効; 2D は []
  sketchRect:  { p1, p2 } | null,     // 2D のみ有効
  meshView:    MeshView,               // 描画オブジェクト
}
```

---

## 座標系

**ROS ワールドフレーム (+X 前, +Y 左, +Z 上)**。右手系。Three.js の `camera.up = (0,0,1)`。
XY 平面 (Z=0) がグラウンドプレーン。

```
      6─────7
     /|    /|    +Z up
    5─────4 |    +Y left
    | 2───|─3    +X front
    |/    |/
    1─────0
```

---

## DDD 移行ロードマップ

現在は「ドメイン状態を SceneModel に集約した MVC」。以下の順で DDD に移行予定:

| フェーズ | 内容 |
|---------|------|
| **Phase 0 (現在)** | SceneModel が状態コンテナ。AppController がビジネスロジックを保持 |
| **Phase 1** | SceneObject を `Cuboid` / `Sketch` ドメインエンティティに分化。`src/domain/` を新設 |
| **Phase 2** | ドメインエンティティが自身の操作メソッドを持つ (extrude, move, rename 等) |
| **Phase 3** | `SceneModel` をリポジトリ + アグリゲートルートに昇格。ApplicationService 層を追加 |
| **Phase 4** | ドメインイベント (EventEmitter) を使い View が Model を直接購読 |

---

## 関連ドキュメント

- `docs/adr/README.md` — アーキテクチャ決定記録の索引
- `docs/STATE_TRANSITIONS.md` — モード状態遷移の詳細
- `docs/ROADMAP.md` — 機能ロードマップ
- `.claude/MENTAL_MODEL.md` — バグから学んだコーディングポリシー
