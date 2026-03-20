# ADR-008: Mode Transition State Machine — Logical Consistency Policy

**Date:** 2026-03-20
**Status:** Accepted

---

## Context

`AppController` はモード (`_selectionMode`: `'object'` | `'edit'`) と
Edit サブステート (`_editSubstate`: `null` | `'3d'` | `'2d-sketch'` | `'2d-extrude'`) を持つ。

初期実装ではモード遷移を引き起こす箇所がいくつかあったが、すべてが `setMode()` を経由しておらず、
次のような不整合が起きていた：

- `_addObject('box')` を Edit Mode 中に呼ぶと `setMode` が呼ばれず、`_editSubstate`・`_hoveredFace` 等が前のオブジェクトのものを参照し続ける
- `_deleteObject` を Edit Mode 中に Outliner から呼ぶと、`meshView.dispose()` の後に `setMode('object')` を呼ぼうとしても meshView は既に破棄済みになる
- `setMode('edit')` は visual state (`setFaceHighlight`, `clearExtrusionDisplay` 等) をクリアしていなかった
- `setMode()` は face drag 中・object drag 中の割り込みに対して中断処理をしなかった
- `MeshView.setFaceHighlight()` は `hlMesh.visible` を管理しておらず、`setVisible(false)` で一度隠された meshView の `hlMesh` が再表示されなかった

## Decision

### 1. `setMode()` を唯一の状態遷移エントリポイントとする

`setMode(mode)` は「現在どのモードにいるかに関わらず、確実にクリーンな状態で新しいモードに移行する」関数として実装する。

実行順序：

```
1. 進行中の操作をキャンセル
   - Grab 中 → _cancelGrab()
   - Face drag 中 → _faceDragging = false, clearExtrusionDisplay()
   - Object drag 中 → _objDragging = false

2. 現在の active object の visual state をクリア
   - setFaceHighlight(null, corners)
   - clearExtrusionDisplay()
   - clearSketchRect()
   - UIView.clearExtrusionLabel()

3. コントローラ状態をリセット
   - _hoveredFace = null
   - _faceDragging = false
   - _dragFaceIdx = null
   - _cleanupEditSubstate() → sketch/extrude state クリア

4. 新しいモードへ遷移
   - 'object': UI 更新のみ
   - 'edit': _setObjectSelected(false), dimension に応じてサブステートへ
```

### 2. active object を切り替える前に必ず `setMode` を経由する

オブジェクトを追加・削除・切り替える操作は、Edit Mode 中に発生しうる。
その際は `_switchActiveObject` を呼ぶ**前**に `setMode('object')` を呼んで、
現在の active object の visual state を cleanup する。

```
// 正しい順序（dispose 前に setMode）
if (selectionMode === 'edit') setMode('object')   // ← meshView が生きている間に cleanup
meshView.dispose()                                  // ← その後に破棄
```

適用箇所：

| 関数 | 条件 |
|------|------|
| `_addObject('box')` | Edit Mode 中 |
| `_addSketchObject()` | Edit Mode 中（現在は到達しないが防御的に） |
| `_deleteObject(id)` | Edit Mode 中 かつ `id === _activeId` |

### 3. `MeshView.setFaceHighlight()` が `hlMesh.visible` を完全管理する

```javascript
setFaceHighlight(fi, corners) {
  this.hlMesh.visible = (fi !== null)  // ← visible を setFaceHighlight が制御
  if (fi === null) { /* clear geometry */ return }
  /* update geometry */
}
```

`setVisible(false/true)` の履歴に依存せず、常に `setFaceHighlight` で可視状態が決まる。

## Consequences

- **バグ減少**: モード遷移を経ずに active object が変わることがなくなるため、
  前のオブジェクトの visual state (face highlight など) が残留しない
- **Outliner からの操作も安全**: Delete ボタンは Edit Mode 中でも常に安全に動作する
- `setMode` の冪等性: 同じモードへの遷移（例: Edit → Edit）も cleanup として機能し、
  サブステートが壊れた場合のリセット手段になる
- **将来の機能追加への安全策**: 新たなオブジェクト切り替えパスを追加する際は、
  必ず `setMode('object')` を先行させるルールを守れば良い

## References

- ADR-002 (Sketch→Extrude ワークフロー)
- ADR-004 (Edit Mode の dimension ディスパッチ)
- ADR-005 (オブジェクト階層と dimension)
