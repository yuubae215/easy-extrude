# ADR-005: Object Hierarchy with Dimensional Classification

**Date:** 2026-03-20
**Status:** Accepted (updated 2026-03-20 — VoxelShape → CuboidShape)

---

## Context

アプリは単一オブジェクト編集から複数オブジェクトのシーン編集に進化している。
オブジェクトは次元（dimensionality）を持ち、階層（グループ・親子）に整理できる必要がある。

## Decision

### オブジェクトタイプ分類

全シーンオブジェクトは `dimension` プロパティを持つ：

| Dimension | 型の例 | データ | Edit Mode の動作 |
|-----------|--------|--------|-----------------|
| `1D` | MeasureLine | 2エンドポイント | エンドポイントドラッグ |
| `2D` | Sketch | `{ min: Vector2, max: Vector2 }` (矩形2コーナー) | 矩形描画 |
| `3D` | Box, ExtrudedShape | `corners: THREE.Vector3[8]` | フェイスプッシュ/プル |

### オブジェクトデータ構造

```javascript
SceneObject = {
  id:        string,           // 例: "obj_0_1742394000000"
  name:      string,           // 例: "Wall_A"
  dimension: 1 | 2 | 3,
  shape:     CuboidShape | SketchRect | LineShape,
  visible:   boolean,
  locked:    boolean,
  children:  SceneObject[],    // グループ / 親子
}

// 3D shape
CuboidShape = {
  corners: THREE.Vector3[8],   // CCW winding, ROS world frame
}

// 2D shape (Sketch フットプリント)
SketchRect = {
  min: THREE.Vector2,
  max: THREE.Vector2,
}
```

### 階層

- オブジェクトはグループ化できる（空の親 + 子）
- 2D Sketch とその押し出し後の 3D 子を親子にすることで非破壊履歴を実現（将来）
- Outliner パネルがツリーを表示

### Outliner 表示例

```
Scene
├── [GRP] Building_A
│   ├── [3D] Wall
│   ├── [3D] Column
│   └── [2D] Footprint
├── [3D] Floor
└── [1D] Width_ref      <- 将来
```

アイコンで次元を区別：立方体(3D)、四角(2D)、線(1D)。

## Consequences

- `dimension` フィールドが Edit Mode ディスパッチを駆動（ADR-004）
- Outliner の現行フラット実装は `parentId` 参照で階層拡張可能
- 1D オブジェクトはバックログ — アーキテクチャは対応済みだが実装は未定
