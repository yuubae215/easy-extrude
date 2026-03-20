# ADR-006: Right-Click as Cancel / Context Menu

**Date:** 2026-03-20
**Status:** Accepted (updated 2026-03-20 — Voxel固有記述を除去)

---

## Context

右クリックは OrbitControls が「右ドラッグ = カメラオービット」として使い、
AppController が「Grab キャンセル = 右クリック」として使っており、役割が競合している。

現行実装では `controls.mouseButtons = { RIGHT: THREE.MOUSE.ROTATE }` のため、
右ドラッグはオービットだが、Grab 中は AppController が右クリックをキャンセルとして横取りする。

## Decision

右クリックの動作は **操作中かどうか** に応じてコンテキストセンシティブとする：

| 状態 | 右クリック動作 |
|------|--------------|
| 操作中（Grab, Extrude, Sketch） | 現在の操作を **キャンセル** |
| 操作なし・オブジェクトホバー中 | **コンテキストメニュー**（将来実装） |
| 操作なし・空白クリック | **選択解除**（Object Mode） |
| 操作なし | OrbitControls に委譲（右ドラッグ = オービット） |

### 現行のオービット競合について

- OrbitControls が右ドラッグをオービットとして処理している
- AppController の `mousedown (button 2)` は Grab 中のみキャンセルに使う
- 操作中でない右ドラッグは OrbitControls がオービットとして処理する（意図的な共存）
- 将来コンテキストメニューを実装する際は `contextmenu` イベントで `e.preventDefault()` が必要

### Sketch Mode

Edit Mode · 2D（矩形スケッチ）では：
- 右クリック → スケッチ操作のキャンセル（描画中の矩形を破棄）

## Consequences

- 右クリックは一貫して「キャンセル / コンテキストメニュー」の意味を持つ
- コンテキストメニューは将来機能 — アーキテクチャは予約済み
- モバイルでのロングプレス = `contextmenu` 発火に注意（`e.preventDefault()` 必要）
