# Architecture

easy-extrude は MVC パターンで構成された Web ベースの 3D モデリングアプリ。
将来的なドメイン駆動設計（DDD）への移行を見据えて、段階的に整理している。

---

## 全体構成

```
src/
  main.js                      # エントリポイント: MVC を組み立てて start()
  domain/
    Cuboid.js                  # ドメインエンティティ: 3D キュービック (faces, edges 保持)
    Sketch.js                  # ドメインエンティティ: 2D スケッチ (未押し出し状態のみ)
  graph/
    Vertex.js                  # グラフ基底: 頂点 { id, position: Vector3 }
    Edge.js                    # グラフ基底: 辺 { id, v0: Vertex, v1: Vertex }
    Face.js                    # グラフ基底: 面 { id, vertices: Vertex[4], name, index }
  model/
    CuboidModel.js             # 純粋関数: ジオメトリ計算 (ステートレス)
    SceneModel.js              # 集約ルート: シーンオブジェクト + モード状態 + editSelection
  service/
    SceneService.js            # ApplicationService: エンティティ生成・CRUD・extrudeSketch
  view/
    SceneView.js               # Three.js シーン / カメラ / レンダラー
    MeshView.js                # オブジェクトごとのメッシュと視覚状態
    UIView.js                  # DOM UI (ヘッダー / N パネル / ステータスバー)
    GizmoView.js               # ワールド軸ギズモ (右上)
    OutlinerView.js            # シーン階層サイドバー (左)
  controller/
    AppController.js           # 入力ハンドリング + View 調整
```

---

## レイヤー責任

### Model

| モジュール | 責任 |
|-----------|------|
| `CuboidModel.js` | 純粋関数のみ。副作用なし。ジオメトリ構築・法線計算・座標変換 |
| `SceneModel.js` | ドメイン状態を保持。`_objects` / `_activeId` / `_selectionMode` / `_editSubstate` / `_editSelection` |

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

SceneObject は `Cuboid` または `Sketch` のいずれか。型（`instanceof`）が振る舞いを決定する。

**Cuboid** (3D):
```javascript
{
  id:          string,            // "obj_0_1234567890"
  name:        string,            // "Cube", "Cube.001"
  description: string,
  vertices:    Vertex[8],         // グラフ基底頂点; get corners() で Vector3[] に投影
  faces:       Face[6],           // 明示的な面オブジェクト (ADR-012)
  edges:       Edge[12],          // 明示的な辺オブジェクト (ADR-012)
  meshView:    MeshView,
}
```

**Sketch** (2D、未押し出し):
```javascript
{
  id:          string,            // "obj_0_1234567890"
  name:        string,            // "Sketch.001"
  description: string,
  sketchRect:  { p1, p2 } | null, // 描画された矩形
  meshView:    MeshView,
}
```

`Sketch.extrude(height)` は `Sketch` を変異させず新しい `Cuboid` を返す。
`SceneService.extrudeSketch(id, height)` が Sketch を Cuboid に置換する。

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

## ドメインモデル — 次元と動詞

エンティティは「次元」で分類し、操作は「次元を上げる動詞」として定義する。
型（`instanceof`）が振る舞いを決定し、`dimension` フィールドは持たない（ADR-012 Phase 5-3 にて廃止）。

| 次元 | エンティティ | 生成する動詞 |
|------|-------------|-------------|
| 0D   | `Vertex`          | — |
| 1D   | `Edge`            | — |
| 2D   | `Face` / `Sketch` | **Sketch**: 矩形を描画 |
| 3D   | `Cuboid`          | **Extrude**: `Sketch.extrude(h)` → 新 Cuboid |

動詞はエンティティを突然変異させず、**上位次元の新エンティティを返す**。
`SceneService` が旧エンティティを削除し、新エンティティを同一 ID で登録する。

これにより「ステートが遷移したのにメソッドがついてこない」問題が構造上起こり得ない。

### グラフ基底モデル (ADR-012)

```
Vertex  = { id, position: Vector3 }
Edge    = { id, v0: Vertex, v1: Vertex }
Face    = { id, vertices: Vertex[4], name, index }
Cuboid  = { vertices: Vertex[8], faces: Face[6], edges: Edge[12], ... }
```

`Face` / `Edge` が明示的に存在することで、将来の G→V / G→E / G→F 選択モデルの基盤となる。
`SceneModel.editSelection: Set<Vertex|Edge|Face>` として統一選択セットを保持する。

---

## DDD 移行ロードマップ

| フェーズ | 内容 | 状態 |
|---------|------|------|
| **Phase 0** | SceneModel が状態コンテナ。AppController がビジネスロジックを保持 | 完了 2026-03-20 |
| **Phase 1** | `Cuboid` / `Sketch` ドメインエンティティを新設 (ADR-009) | 完了 2026-03-20 |
| **Phase 2** | ドメインエンティティが操作メソッドを持つ (ADR-010) | 完了 2026-03-20 |
| **Phase 3** | `SceneService` (ApplicationService) を新設 (ADR-011) | 完了 2026-03-20 |
| **Phase 4** | ドメインイベント — `SceneService` が Observable に (ADR-013) | 完了 2026-03-20 |
| **Phase 5-1** | `Vertex` 層を追加。`Cuboid.vertices: Vertex[8]` (ADR-012) | 完了 2026-03-20 |
| **Phase 5-2** | ステータスバーをイベント駆動に移行 | 完了 2026-03-20 |
| **Phase 5-3** | `Edge` / `Face` 層、`dimension` 廃止、統一選択モデル基盤 (ADR-012) | 完了 2026-03-20 |

---

## 関連ドキュメント

- `docs/adr/README.md` — アーキテクチャ決定記録の索引
- `docs/STATE_TRANSITIONS.md` — モード状態遷移の詳細
- `docs/ROADMAP.md` — 機能ロードマップ
- `.claude/MENTAL_MODEL.md` — バグから学んだコーディングポリシー
