# Next Session Plan — CoordinateFrame Visibility UX

**Date planned**: 2026-03-24
**Status**: Ready to implement

---

## Goal

Coordinate Frameのデフォルト非表示化と、親オブジェクト選択時のみ表示する仕組みを実装する。
現状の問題：
- フレームが常に表示されていて視覚的ノイズになる
- フレームが親ジオメトリの内側に埋まって見えない

---

## Implementation Plan

### Step 1: `CoordinateFrameView.setParentSelected(selected)`

`src/view/CoordinateFrameView.js` に新メソッドを追加：

```js
setParentSelected(selected) {
  this._group.visible = selected
  if (selected) {
    // 親ジオメトリを貫通して見えるようにX-ray
    const depthTest = false
    const renderOrder = 1
    for (const arrow of [this._arrowX, this._arrowY, this._arrowZ]) {
      arrow.line.material.depthTest = depthTest; arrow.line.renderOrder = renderOrder
      arrow.cone.material.depthTest = depthTest; arrow.cone.renderOrder = renderOrder
    }
    for (const label of [this._labelX, this._labelY, this._labelZ]) {
      label.material.depthTest = depthTest; label.renderOrder = renderOrder
    }
    this._originSphere.material.depthTest = depthTest
    this._originSphere.renderOrder = renderOrder
  }
}
```

初期化時（constructor）で `this._group.visible = false` にする。

### Step 2: `AppController._switchActiveObject()` の変更

`src/controller/AppController.js`：

```js
_switchActiveObject(newId, select = false) {
  // 既存の選択オブジェクトの子フレームを非表示に
  if (this._activeId) {
    for (const child of this._scene.getChildren(this._activeId)) {
      if (child instanceof CoordinateFrame) {
        child.meshView.setParentSelected(false)
      }
    }
  }

  // ... 既存の切り替えロジック ...

  // 新しいオブジェクトが選択されたとき子フレームを表示
  if (select && newId) {
    for (const child of this._scene.getChildren(newId)) {
      if (child instanceof CoordinateFrame) {
        child.meshView.setParentSelected(true)
      }
    }
  }
}
```

### Step 3: `setMode('object')` 復帰時の対応

Edit Mode → Object Mode に戻ったとき `_objSelected = true` を復元している箇所で、合わせて子フレームも再表示する。

### Step 4: フレーム自体が選択されたときの挙動

フレーム自体が選択（Tab/クリック）されたときは現行の `setObjectSelected(true)` が動く。
`setParentSelected` と `setObjectSelected` は独立して動作させる：
- `setParentSelected(true)` → visible=true + X-ray（親が選ばれているとき）
- `setObjectSelected(true)` → visible=true + X-ray（フレーム自体が選ばれているとき）
- 両方 false → visible=false

---

## Additional UX Ideas (Future)

| アイデア | 優先度 | 概要 |
|---------|--------|------|
| Nパネル「Frame Overlays」トグル | 中 | 全フレームを一括表示/非表示するグローバルスイッチ |
| アウトライナーの「目」アイコン | 低 | フレームごとに個別表示切替 |
| フレームサイズを親BBoxに比例 | 低 | 小さいオブジェクトでもサイズが適切に |

---

## Files to Modify

- `src/view/CoordinateFrameView.js` — `setParentSelected()` 追加、constructor で `visible=false`
- `src/controller/AppController.js` — `_switchActiveObject()` と `setMode('object')` の対応箇所
- `.claude/MENTAL_MODEL.md` — CoordinateFrame Depth Rendering Policy セクションを更新

## ADR

既存 ADR-018/ADR-019 の範囲内の変更のため新規ADR不要。MENTAL_MODEL更新で十分。
