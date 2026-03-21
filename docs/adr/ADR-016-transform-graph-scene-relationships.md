# ADR-016: トランスフォームグラフ — シーンオブジェクト間の位置・姿勢関係

- **Status**: Proposed
- **Date**: 2026-03-21
- **References**: ADR-012, ADR-015

---

## Context

ADR-015 で導入する BFF + マイクロサービス構成では、Geometry Service がシーンの
ジオメトリグラフを管理する。その第一歩として、シーンオブジェクト間の**位置と姿勢の関係**
（相対トランスフォーム）をグラフ構造で表現する必要がある。

現在のフロントエンドはオブジェクトをワールド座標で独立して管理しており、
オブジェクト間の親子関係・拘束関係を表現する仕組みがない。

将来的には Blender の Geometry Nodes のように、オブジェクト間の依存関係や
パラメトリック演算をノードとして視覚的に編集できる **Node Editor** へ拡張したい。
今回の設計はその基盤となる。

---

## Decision

### 1. SE(3) トランスフォームツリーとして表現する

シーンの空間関係を **有向木（ツリー）** で表現する。
各ノードは親ノードからの相対トランスフォーム (SE(3)) を保持する。

```
world (root)
  ├── tnode_A  [translation: [1,0,0], rotation: identity]
  │     └── tnode_B  [translation: [0,2,0], rotation: quat]   ← A原点からの相対
  └── tnode_C  [translation: [0,0,0], rotation: identity]
```

座標系は既存の **ROS ワールドフレーム (+X 前, +Y 左, +Z 上)** を維持する（ADR-008）。
回転は **クォータニオン [qx, qy, qz, qw]** で表現し、ジンバルロックを避ける。

### 2. データ構造

#### TransformNode

```jsonc
{
  "id": "tnode_001",
  "objectId": "obj_0_xxx",          // SceneObject の ID (null = 仮想ノード)
  "label": "Cuboid_A",
  "transform": {
    "translation": [1.0, 0.0, 0.0], // 親ノード原点からの相対位置 (m)
    "rotation":    [0.0, 0.0, 0.0, 1.0]  // クォータニオン [qx, qy, qz, qw]
  }
}
```

`objectId: null` の仮想ノードはグループやアセンブリの軸足として使える（将来対応）。

#### TransformEdge

```jsonc
{
  "id": "tedge_001",
  "parentId": "tnode_world",    // 親 TransformNode の id ("world" = ルート)
  "childId":  "tnode_001",
  "constraint": "fixed"         // 現フェーズは "fixed" のみ
}
```

#### constraint の拡張予定（Node Editor フェーズ）

| 値 | 意味 |
|----|------|
| `"fixed"` | 相対トランスフォームを固定（現フェーズ） |
| `"revolute"` | 1軸回転自由度（将来） |
| `"prismatic"` | 1軸並進自由度（将来） |
| `"free"` | 6自由度（将来：組み立てシミュレーション用） |

### 3. 永続化フォーマット（Geometry Service の DB スキーマ）

グラフは **隣接リスト** で保存する。

```jsonc
// Scene ドキュメント（例: MongoDB / PostgreSQL JSON カラム）
{
  "sceneId": "scene_xxx",
  "transformGraph": {
    "nodes": [ /* TransformNode[] */ ],
    "edges": [ /* TransformEdge[] */ ]
  }
}
```

Phase A（REST によるシーン保存）でこの形式をそのまま永続化する。
Phase B（Node Editor）でノード種別を拡張し DAG（有向非巡回グラフ）へ移行する。

### 4. Node Editor への拡張パス

現在の TransformNode / TransformEdge は、Node Editor の初期形態に相当する。
将来は OperationNode（STEP インポート・ブール演算・パラメトリック修飾子）を追加し、
ジオメトリをノード間でストリームとして流す構成に拡張する。

```
現在 (Phase A):
  TransformNode ─(fixed)─→ TransformNode

将来 (Node Editor):
  StepImportNode ──┐
                   ├─→ BooleanOpNode ─→ TransformNode
  CuboidNode ──────┘
```

OperationNode の出力ジオメトリは WebSocket 経由でフロントエンドにストリームされる（ADR-015）。

### 5. フロントエンドへの影響

Phase A では `SceneService` が BFF の REST エンドポイントからトランスフォームグラフを
取得し、`SceneModel` に反映するだけでよい。フロントエンドはグラフ構造を**読み取り専用**
で受け取り、Three.js の Object3D 階層に変換して描画する。

グラフ編集操作（親子付け・トランスフォーム変更）は BFF 経由で Geometry Service に
送り、更新済みグラフを受け取る形にする（フロントに書き込みロジックを持たせない）。

---

## Consequences

### 良い点

- ROS TF / URDF と同じ思想のため、将来ロボティクス用途との統合が容易。
- クォータニオン表現により ROS フレームとの変換が直接対応できる。
- 隣接リスト形式はグラフの増減に柔軟で、Node Editor 拡張時にノード種別を追加しやすい。
- `objectId: null` の仮想ノードでグループ化・アセンブリ軸を将来追加できる。

### トレードオフ・制約

- **ツリーのみ（現フェーズ）**: 現在は厳密なツリー構造のみ対応。
  DAG（共有サブグラフ）が必要になった時点で ADR を追加し設計を拡張する。
- **ワールド座標への変換コスト**: 深いツリーでは全祖先のトランスフォーム合成が必要。
  Geometry Service 側でキャッシュする（フロントは合成済み座標を受け取る）。
- **WebSocket 同期設計は Phase B で別 ADR**: 接続断・再接続時の差分同期プロトコル、
  グラフ状態のセッション vs 永続化の方針は Phase B の ADR で決定する。

### 未決事項（Phase B で継続検討）

- OperationNode の永続化フォーマット（DAG エッジのサイクル検出ポリシー）
- WebSocket メッセージでのグラフ差分表現（full-state vs patch）
- STEP インポートで得た B-rep 位相情報をグラフにどう組み込むか
