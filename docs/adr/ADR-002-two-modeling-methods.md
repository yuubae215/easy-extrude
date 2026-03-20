# ADR-002: Two Modeling Methods (Primitive Box vs. Sketch → Extrude)

**Date:** 2026-03-20
**Status:** Accepted (updated 2026-03-20 — VoxelShape → CuboidShape)

---

## Context

ユーザーは2通りの方法で3Dシェイプを作成できる必要がある：

1. 3Dプリミティブから直接始める（最速・最多用途）
2. 2Dフットプリント（矩形）を先に定義し、高さ方向に押し出す（平面図・断面図ワークフロー）

どちらの方法も最終的に **同一の Edit Mode**（フェイスプッシュ/プル）に到達する。

## Decision

### Method A — Primitive Box

- `Shift+A` → "Add Box" → 既定サイズ（2×2×2）の Cuboid を配置
- 新しいオブジェクトは `corners[8]` で表現される直方体
- 配置直後に Edit Mode に入る

### Method B — Sketch → Extrude

- `Shift+A` → "Add Sketch" → 空の 2D Sketch オブジェクトを作成し、Edit Mode · 2D に入る
- **Sketch フェーズ:** XY グラウンドプレーン上でクリック→ドラッグして矩形を描く（2コーナー指定）
- **Extrude フェーズ:** Enter → マウスを上方向にドラッグ（または数値入力）で高さを指定
- 結果: 矩形フットプリント × 高さ から `corners[8]` の Cuboid が生成される
- そのまま Edit Mode (3D) に継続して入る

### Shared Edit Phase

どちらも `corners[8]` の CuboidShape を生成する。Edit Mode の操作は共通：
- フェイスをホバー → ハイライト
- フェイスを外向きにドラッグ → 押し出し（フェイスの4コーナーを法線方向に移動）
- フェイスを内向きにドラッグ → 押し込み

```
Method A:  Add Box ─────────────────────→ Edit Mode (3D)
Method B:  Add Sketch → Sketch Phase → Extrude Phase → Edit Mode (3D)
                                                         ↑ same code path
```

## Consequences

- Edit Mode は Sketch/Box 問わず同じフェイス操作（ADR-004 参照）
- Sketch オブジェクトは矩形定義のみ保持（2コーナー）、非破壊再編集は ADR-005 階層で実現予定
- `buildCuboidFromRect(minXY, maxXY, height)` は純粋関数として Model 層に実装
