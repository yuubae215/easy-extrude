# State Transitions

easy-extrude のモード状態遷移を記録する。
実装の詳細は ADR-008 を参照。

---

## トップレベルモード

`SceneModel.selectionMode` が持つ 2 値の状態機械。

```
              Tab / O key            Tab / E key
  ┌─────────────────────────────────────────────────┐
  |                                                 |
  v                                                 |
OBJECT MODE  ──────────────────────────────> EDIT MODE
  |                                                 |
  | Shift+A → Add Box                               | (active object の dimension で分岐)
  |   → _addObject('box') → OBJECT MODE             |
  |                                                 |
  | Shift+A → Add Sketch                            |
  |   → _addSketchObject() → EDIT MODE · 2D         |
  |                                                 |
  | X / Delete (selected)                           |
  |   → _deleteObject() → OBJECT MODE               |
  └─────────────────────────────────────────────────┘
```

---

## Edit Mode のサブステート

`SceneModel.editSubstate` が持つ状態機械。
EDIT MODE 遷移時に `activeObject.dimension` で初期サブステートが決まる。

```
EDIT MODE 入場
    |
    v
dimension == 3 ?─────> EDIT · 3D ('3d')
    |                       |
    | No                    | Tab / O key / setMode('object')
    |                       v
dimension == 2 ?─────> OBJECT MODE
    |
    v
EDIT · 2D-SKETCH ('2d-sketch')
    |
    | 矩形ドラッグ完了 → sketchRect 保存
    | Enter (面積 > 0.01)
    v
EDIT · 2D-EXTRUDE ('2d-extrude')
    |                |
    | Enter          | Escape
    | (height > 0)   |
    v                v
EDIT · 3D      EDIT · 2D-SKETCH (戻る)
    |
    | Tab / O key
    v
OBJECT MODE
```

### サブステート詳細

| substate | 意味 | 遷移トリガー |
|---------|------|------------|
| `null` | Edit Mode 外 (Object Mode) | `setMode('object')` 呼び出し後 |
| `'2d-sketch'` | グラウンドプレーンで矩形を描画中 | `_enterEditMode2D()` |
| `'2d-extrude'` | スケッチを高さ方向に押し出し中 | `_enterExtrudePhase()` (Enter キー) |
| `'3d'` | 3D キュービックのフェイス選択・押し出し | `_enterEditMode3D()` |

---

## setMode() の実行順序 (ADR-008 の契約)

```
setMode(mode) 呼び出し
    |
    1. 進行中の操作をキャンセル
    |    - grab.active → _cancelGrab()
    |    - faceDragging → clearExtrusionDisplay()
    |    - objDragging → reset flags
    |
    2. アクティブオブジェクトのビジュアル状態をクリア
    |    - setFaceHighlight(null)
    |    - clearExtrusionDisplay()
    |    - clearSketchRect()
    |    - uiView.clearExtrusionLabel()
    |
    3. コントローラ内部状態をリセット
    |    - _hoveredFace = null
    |    - _cleanupEditSubstate() → SceneModel.setEditSubstate(null)
    |
    4. SceneModel.setSelectionMode(mode)
    |
    5. 新モードへのディスパッチ
         mode === 'object' → UI 更新のみ
         mode === 'edit'   → dimension で分岐
                             2 → _enterEditMode2D()
                             3 → _enterEditMode3D()
```

**重要**: アクティブオブジェクトを切り替える前に必ず `setMode('object')` を呼ぶこと。
Edit Mode 中に `_switchActiveObject()` を呼ぶと、前のオブジェクトのビジュアル状態が残る。

---

## オブジェクト追加・削除時の状態遷移

```
_addObject(type) / _addSketchObject()
    |
    if selectionMode === 'edit'
        → setMode('object')  ← 必須: Edit Mode のクリーンアップ
    |
    → SceneModel.addObject(obj)
    → _switchActiveObject(id, true)
    |
    type === 'sketch' の場合のみ
        → setMode('edit')  ← Edit Mode · 2D に即入場

_deleteObject(id)
    |
    if id === activeId && selectionMode === 'edit'
        → setMode('object')  ← 必須: dispose 前にビジュアル状態クリア
    |
    → meshView.dispose()
    → SceneModel.removeObject(id)
    → (別オブジェクトに) _switchActiveObject()
```

---

## Grab 状態機械

Object Mode 中に G キーで開始するブレンダー風のグラブ操作。

```
OBJECT MODE (selected)
    |
    G key → _startGrab()
    |
    v
GRAB ACTIVE (grab.active = true)
    |
    |── マウス移動 → _applyGrab()
    |── X/Y/Z key → _setGrabAxis(axis)  (軸ロック)
    |── V key → PIVOT SELECT MODE (grab.pivotSelectMode = true)
    |       |── マウス移動 → _updatePivotHover()
    |       |── 左クリック → _confirmPivotSelect() → GRAB ACTIVE
    |       └── Escape    → _cancelPivotSelect()  → GRAB ACTIVE
    |── 0-9/. key (軸ロック中) → 数値入力 → _applyGrabFromInput()
    |── Ctrl 押し → _trySnapToOrigin() (オリジンスナップ)
    |── Enter / 左クリック → _confirmGrab() → OBJECT MODE
    └── Escape / 右クリック → _cancelGrab() → コーナー位置を復元 → OBJECT MODE
```

---

## フェイス押し出し状態機械

Edit Mode · 3D でのフェイスドラッグ操作。

```
EDIT MODE · 3D
    |
    マウス移動 → _hitFace() → setFaceHighlight(fi)
    |
    左ボタン押下 (face hit あり) → _faceDragging = true
    |
    v
FACE DRAGGING (faceDragging = true)
    |
    |── マウス移動 → コーナー更新 + setExtrusionDisplay() + setExtrusionLabel()
    └── 左ボタン解放 → _faceDragging = false → clearExtrusionDisplay()
```

---

## 関連 ADR

- **ADR-002**: Sketch → Extrude の 2 ステップワークフロー
- **ADR-004**: Edit Mode が object.dimension で 2D / 3D を自動ディスパッチ
- **ADR-008**: `setMode()` が唯一のモード遷移エントリポイント
