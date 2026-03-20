# ADR-014: Edit Mode Sub-Element Selection (DDD Phase 6)

**Status:** Accepted
**Date:** 2026-03-20
**References:** ADR-004, ADR-012

---

## Context

DDD Phase 5-3 で `Vertex`, `Edge`, `Face` オブジェクトと `SceneModel.editSelection: Set<Vertex|Edge|Face>` を導入したが、実際の選択操作には接続されていなかった。

また Grab + Ctrl のスナップ機能が World 原点のみに限定されており、利便性が低かった。

---

## Decisions

### 1. Sub-element mode switching — 1 / 2 / 3 keys

Edit Mode · 3D で以下のキーを割り当てる:

| キー | モード |
|------|--------|
| `1` | Vertex mode |
| `2` | Edge mode |
| `3` | Face mode (デフォルト) |

Blender の Numpad 1/2/3 相当。`V`/`E`/`F` は Grab 中の V キー (pivot select) と
競合するため使用しない。

### 2. Click-vs-drag separation (Face mode)

Face mode では mousedown で即 drag 開始していた従来の動作を変更:

- `mousedown` → `_editDragPending = true` (状態を保留)
- `mousemove` で 5px 以上移動 AND hovered face あり → face extrude drag 開始
- `mouseup` でまだ pending → クリックとして扱い `_handleEditClick()` 実行

Vertex / Edge mode では drag なし、`mousedown` で即 `_handleEditClick()`。

### 3. Selection semantics

- クリック → `editSelection` を 1 要素に置き換え
- Shift+クリック → `editSelection` にトグル（追加 or 除去）
- 空白クリック → `editSelection` をクリア

### 4. Hover detection

| モード | 検出方法 |
|--------|---------|
| face | raycasting（既存） |
| vertex | 各 `Vertex.position` をスクリーン投影 → 最近傍（15px 閾値） |
| edge | 各 `Edge` の midpoint をスクリーン投影 → 最近傍（15px 閾値） |

### 5. Grab snap expansion (Grab Snap 改善)

`_trySnapToOrigin` を `_trySnapToGeometry` に置き換え:

- スナップ候補: World 原点 + 全 Cuboid の Vertex + 全 Edge 中点
- `_grab.autoSnap: boolean` を追加:
  - G→V でピボット確定後に `true` にセット
  - `autoSnap = true` の間は Ctrl なしで自動スナップ発動
  - Ctrl 離しても `autoSnap` は維持（Grab 終了時にリセット）
- Ctrl 押下時もスナップ発動（既存動作を拡張）

---

## Rejected Alternatives

- **V/E/F キー**: `V` が Grab 中の pivot select に使用済み。Grab 非アクティブ時のみ使う設計も可能だが、一貫性のため 1/2/3 を採用。
- **Ctrl を離したら autoSnap をリセット**: 忘れやすいという元の問題を再発させるため却下。

---

## Consequences

- `editSelection` が実際の操作に接続され、Multi-face / Multi-vertex 選択の基盤が完成
- Grab snap が全ジオメトリに対応し、精密な配置が容易になる
- Face drag はクリックが先に割り込まないよう pending パターンで分離
