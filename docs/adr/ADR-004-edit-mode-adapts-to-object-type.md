# ADR-004: Edit Mode Adapts to Object Type

**Date:** 2026-03-20
**Status:** Accepted (updated 2026-03-20 — VoxelShape → CuboidShape)

---

## Context

異なる次元のオブジェクト（1D, 2D, 3D）を編集するために、モードごとに別名（"Sketch Mode" 等）を用意すると学習コストが増える。

## Decision

トップレベルのモードは **Object Mode と Edit Mode の2つだけ** に保つ。

Edit Mode の動作は選択オブジェクトのタイプ（`dimension`）に応じて自動的に変わる：

| 選択オブジェクトタイプ | Edit Mode の動作 |
|----------------------|-----------------|
| **3D** (CuboidShape) | フェイスホバー + プッシュ/プル |
| **2D** (Sketch / 矩形) | XY 平面上で矩形を描く（2コーナー指定） |
| **1D** (MeasureLine, 将来) | エンドポイントドラッグ |

```
Object Mode  ──Tab──→  Edit Mode
                           ├── if 3D selected: face push/pull
                           ├── if 2D selected: rect sketch
                           └── if 1D selected: endpoint drag
```

ヘッダーバーのモード表示はサブタイプを含む：
- `Edit Mode · 3D`
- `Edit Mode · 2D`
- `Edit Mode · 1D`

### Extrude 遷移 (2D → 3D)

2D Sketch オブジェクトが Edit Mode にあり、ユーザーが Enter を押したとき：
1. Extrude フェーズ（高さ入力）に移行 — Edit Mode の内側
2. 確定で `corners[8]` の CuboidShape が生成される
3. そのまま Edit Mode · 3D に継続
4. ステータスバー: `"Extruded → Edit Mode · 3D"`

## Consequences

- ユーザーが覚えるショートカットは `Tab` の1つだけ
- AppController は Edit Mode 入口でオブジェクトタイプに応じてディスパッチが必要
- UIView のステータス表示は `Edit Mode · 2D / 3D` のコンパウンド文字列を扱う
