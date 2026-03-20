# ADR-007: Cuboid-based Shape Representation

**Date:** 2026-03-20
**Status:** Accepted
**Supersedes:** ADR-001

---

## Context

ADR-001 では Voxel（単位立方体の集合）を採用した。しかしユーザーの実際のユースケースは
「**直方体（Cuboid）を配置し、フェイスを押し出して変形させる**」であり、
unit-cube グリッドの細粒度は不要だった。

Voxel モデルと Cuboid モデルの違い：

| | Voxel | Cuboid |
|--|-------|--------|
| 形状表現 | 単位立方体の集合 (`Map<key, {ix,iy,iz}>`) | 8コーナー頂点 (`THREE.Vector3[8]`) |
| フェイス押し出し | 単位グリッドのレイヤー追加/削除 | フェイスの4頂点を法線方向に移動 |
| 変形の粒度 | 整数ステップ（1単位） | 連続値（浮動小数点） |
| 形状の種類 | L字・T字など任意の積み重ね | 単一の変形可能な六面体 |

## Decision

**Cuboid-based 表現**を採用する。3D オブジェクトは 8コーナー頂点による変形可能な直方体で表現する。

```javascript
CuboidShape = {
  corners: THREE.Vector3[8]  // ROS world frame (+X forward, +Y left, +Z up)
}
```

コーナーのラベルと配置：

```
      6─────7
     /|    /|    +Z up
    5─────4 |    +Y left
    | 2───|─3    +X front
    |/    |/
    1─────0
```

フェイス定義（各フェイスは 4コーナーのインデックス、外向きCCW）：

```javascript
FACES = [
  { name: 'Front (+X)', corners: [1, 2, 6, 5] },
  { name: 'Back (-X)',  corners: [0, 4, 7, 3] },
  { name: 'Top (+Z)',   corners: [4, 5, 6, 7] },
  { name: 'Bottom (-Z)', corners: [1, 0, 3, 2] },
  { name: 'Left (+Y)',  corners: [2, 3, 7, 6] },
  { name: 'Right (-Y)', corners: [1, 5, 4, 0] },
]
```

### フェイス押し出し

フェイス `fi` を押し出す = そのフェイスの4コーナーを法線方向に `delta` だけ移動する：

```javascript
// Model 純粋関数
function extrudeFace(corners, fi, delta) → THREE.Vector3[8]
```

### 初期形状

新規オブジェクトは `createInitialCorners()` で 2×2×2 の単位直方体（原点中心）として作成される。

## Consequences

**メリット：**
- 単一オブジェクト = 単一の直方体。データ構造がシンプル
- フェイス押し出しは頂点移動だけで実現（整数スナップ不要）
- 浮動小数点精度でスムーズな変形が可能
- コード量が少ない（`CuboidModel.js` の純粋関数群で完結）

**トレードオフ：**
- L字・T字などの複合形状は **複数の Cuboid オブジェクトを並べる** ことで表現する
  （単一 Cuboid の変形では凸でない形状は作れない）
- Sketch → Extrude の結果は常に直方体（矩形フットプリント × 高さ）

## References

- ADR-001（Superseded）
- ADR-002（Two modeling methods — Method B も直方体を生成）
- ADR-005（オブジェクト階層 — `CuboidShape` の定義）
