# イベント設計 (Events Reference)

easy-extrude で発生するすべてのイベント — ドメインイベント、DOM イベント、
キーボードショートカット — の一覧と仕様。

> **このドキュメントを更新するタイミング**
> - 新しいドメインイベント (`SceneService.emit(...)`) を追加・変更したとき
> - キーボードショートカットを追加・変更・削除したとき
> - pointer/touch イベントの処理フローが変わったとき
> - Undo/Redo コマンドを追加したとき
> - 新しい UI ボタン / ウィジェットのクリックハンドラを追加したとき

---

## イベントカテゴリ

| カテゴリ | 発生源 | 伝達経路 |
|----------|--------|---------|
| [A] ドメインイベント | `SceneService` | `EventEmitter.emit()` → listeners |
| [B] ポインターイベント | ブラウザ Pointer Events API | `AppController._bind*()` |
| [C] キーボードイベント | ブラウザ KeyboardEvent | `AppController._onKeyDown/Up()` |
| [D] タッチ固有イベント | ブラウザ + 長押しタイマー | `AppController` (touch paths) |
| [E] UI イベント | DOM `click` / `change` | `UIView` / `OutlinerView` コールバック |

---

## [A] ドメインイベント (SceneService.emit)

`SceneService` は `EventEmitter` を継承しており、エンティティのライフサイクル変化を
購読者 (主に `AppController`, `OutlinerView`) に通知する。

### objectAdded

```
emit('objectAdded', entity)
```

| 項目 | 内容 |
|------|------|
| ペイロード | `entity: Solid | Profile | MeasureLine | CoordinateFrame | ImportedMesh` |
| 発火タイミング | `createCuboid()`, `createProfile()`, `createImportedMesh()`, `createMeasureLine()`, `createCoordinateFrame()`, `duplicateCuboid()`, `extrudeSketch()` |
| 主な受信者 | `OutlinerView.addObject()` — アウトライナーに行追加 |
| 副作用 | CoordinateFrame の場合は親オブジェクトの可視性ロジックも更新 |

### objectRemoved

```
emit('objectRemoved', id)
```

| 項目 | 内容 |
|------|------|
| ペイロード | `id: string` |
| 発火タイミング | `deleteObject()`, `detachObject()` |
| 主な受信者 | `OutlinerView.removeObject()` — アウトライナーから行削除 |
| 注意 | `_clearScene()` では各オブジェクトの削除前に `objectRemoved` を emit してから `_model` を置換する |

### objectRenamed

```
emit('objectRenamed', id, newName)
```

| 項目 | 内容 |
|------|------|
| ペイロード | `id: string`, `newName: string` |
| 発火タイミング | `renameObject()` |
| 主な受信者 | `OutlinerView.setObjectName()`, `AppController` (ステータス更新) |

### activeChanged

```
emit('activeChanged', id)
```

| 項目 | 内容 |
|------|------|
| ペイロード | `id: string | null` |
| 発火タイミング | `setActiveObject()` |
| 主な受信者 | `OutlinerView.setActive()` — アウトライナーのハイライト更新 |

### geometryApplied

```
emit('geometryApplied', { objectId })
```

| 項目 | 内容 |
|------|------|
| ペイロード | `{ objectId: string }` |
| 発火タイミング | WebSocket 経由で STEP ジオメトリが受信・適用された後 |
| 主な受信者 | `AppController` — カメラフィット (`fitCameraToSphere()`)、プログレス非表示 |

### geometryError

```
emit('geometryError', { objectId, message })
```

| 項目 | 内容 |
|------|------|
| ペイロード | `{ objectId: string, message: string }` |
| 発火タイミング | `_applyGeometryUpdate()` の catch 節 |
| 主な受信者 | `AppController` — エラー Toast 表示 |

### wsConnected / wsDisconnected

```
emit('wsConnected', {})
emit('wsDisconnected', {})
```

| 項目 | 内容 |
|------|------|
| 発火タイミング | `WsChannel` の WebSocket open / close イベント |
| 主な受信者 | `AppController` — インポート状態の確認 |

---

## [B] ポインターイベント

ポインターイベントは Pointer Events API で統合管理される。
`pointerdown` は `window` に登録し、`pointermove` / `pointerup` はキャンバス上で取得。

### キャンバスターゲットガード

```
pointerdown 発火
  ↓
if (e.target !== renderer.domElement) return  ← 必須ガード
```

ツールバーや UI パネルのクリックで `_handleEditClick()` が誤発火するのを防ぐ。

### pointerdown

| 条件 | 処理 |
|------|------|
| `grab.active` + button=0 | `_confirmGrab()` → IDLE |
| `grab.active` + button=2 | `_cancelGrab()` → IDLE |
| `faceExtrude.active` + button=0 | `_activeDragPointerId` をセット (確定は pointerup) |
| `faceExtrude.active` + button=2 | `_cancelFaceExtrude()` |
| `editSubstate === '2d-sketch'` | `_sketch.drawing = true`, orbit 無効化 |
| `selectionMode === 'object'` + オブジェクトヒット | `_objDragging = true`, orbit 無効化 |
| `selectionMode === 'object'` + ミス | `_rectSel.active = true` (デスクトップのみ) |
| `editSubstate === '3d'` | ヒットテスト再実行 → `_handleEditClick()` |
| 2本目タッチ (rectSel 中) | rectSel キャンセル、OrbitControls に委譲 |

### pointermove

| 条件 | 処理 |
|------|------|
| `_rectSel.active` | 選択矩形オーバーレイ更新 |
| `_objDragging` | オブジェクト移動 (Grab ではない直接ドラッグ) |
| `_sketch.drawing` | スケッチ矩形 p2 更新 |
| `faceExtrude.active` | 距離計算 + `_applyFaceExtrude()` + 押し出しラベル更新 |
| `grab.active` | `_applyGrab()` |
| hover (edit 3d, 何もアクティブでない) | `_hitFace/Vertex/Edge()` → `setFaceHighlight()` |
| 長押しタイマー中 (`_longPressTimer`) | 8px 以上の移動でタイマーキャンセル |

### pointerup

| 条件 | 処理 |
|------|------|
| `faceExtrude.active` + `wasDragging` | `_confirmFaceExtrude()` |
| `_sketch.drawing` + `wasDragging` | `_confirmSketchRect()` |
| `_rectSel.active` + `wasDragging` | `_finalizeRectSel()` |
| `_objDragging` | フラグリセット |
| 共通 | `_activeDragPointerId = null` |

### wheel

| 条件 | 処理 |
|------|------|
| `Ctrl` + `grab.active` | グリッドサイズをサイクル (0.1, 0.5, 1, 5) |
| `Ctrl` + `rotate.active` | 回転ステップサイズをサイクル (1°, 5°, 10°, 45°) |
| それ以外 | OrbitControls のズームに委譲 |

### contextmenu

- `e.preventDefault()` で標準メニューを抑制
- `grab.active` のときは `_cancelGrab()` のトリガーになる

---

## [C] キーボードイベント

### グローバル (_onKeyDown)

| キー | 条件 | 処理 |
|------|------|------|
| `Tab` | grab.active / faceExtrude.active でない | モード切替 (object ↔ edit) |
| `Escape` | 各操作中 | キャンセル (grab, faceExtrude, rectSel, sketch, rotate, measure) |
| `Enter` | 各操作中 | 確定 (grab → `_confirmGrab()`, faceExtrude → `_confirmFaceExtrude()`, 2d-sketch → `_enterExtrudePhase()`) |
| `Ctrl+Z` | 全モード | `_commandStack.undo()` |
| `Ctrl+Y` | 全モード | `_commandStack.redo()` |
| `Ctrl+E` | Object Mode | シーン JSON エクスポート |
| `Ctrl+I` | Object Mode | シーン JSON インポートモーダル表示 |
| `Ctrl+S` | Object Mode | シーン保存 (BFF) |
| `Ctrl+O` | Object Mode | シーン読み込み (BFF) |

### Object Mode

| キー | 処理 |
|------|------|
| `G` | `_startGrab()` |
| `R` | CoordinateFrame 選択中のみ `_startRotate()` |
| `M` | `_startMeasurePlacement()` |
| `Shift+A` | 追加メニュー表示 |
| `Shift+D` | 選択オブジェクトの複製 |
| `X` / `Delete` | 選択オブジェクトの削除 |

### Edit Mode · 3D

| キー | 処理 |
|------|------|
| `1` | サブ要素モード: Vertex |
| `2` | サブ要素モード: Edge |
| `3` | サブ要素モード: Face |
| `E` | Face 選択中のみ `_startFaceExtrude()` |
| `O` | Object Mode に戻る |

### Grab アクティブ中

| キー | 処理 |
|------|------|
| `X` | X 軸にロック |
| `Y` | Y 軸にロック |
| `Z` | Z 軸にロック |
| `V` | Pivot 選択モード ON |
| `S` | Stack モード トグル |
| `0`-`9` / `.` | 数値入力モード (軸ロック必須) |

### Face Extrude アクティブ中

| キー | 処理 |
|------|------|
| `0`-`9` / `.` | 数値入力モード |
| `Ctrl` (hold) | スナップモード ON |

### Rotate アクティブ中 (CoordinateFrame)

| キー | 処理 |
|------|------|
| `X` | X 軸周りに回転 |
| `Y` | Y 軸周りに回転 |
| `Z` | Z 軸周りに回転 |
| `0`-`9` / `.` | 数値入力モード (度数) |

---

## [D] タッチ固有イベント

### 長押し (Long Press)

```
pointerdown (touch, Object Mode, オブジェクト選択済み)
  ↓
_longPressTimer = setTimeout(callback, 400ms) 開始
  ↓
pointermove: 移動量 > 8px → clearTimeout (キャンセル)
  ↓
400ms 到達 → showContextMenu() 表示
  コンテキストメニュー項目:
  - Grab (全エンティティ)
  - Duplicate (Solid のみ)
  - Rename (全エンティティ)
  - Delete (全エンティティ)
```

### タッチでの Grab 確定

```
モバイルでの Grab フロー:
  長押し → コンテキストメニュー → "Grab" タップ → grab.active = true
  (キャンバスドラッグは orbit に使われるため、grab 中のドラッグは移動に使わない)
  → ツールバー "✓ Confirm" ボタンタップ → _confirmGrab()
```

### タッチでの Face Extrude

```
Edit 3D + 面選択済み → タッチタップで自動スタート
  (デスクトップは E キー; タッチは E キーなしで Face をタップすると起動)
  ↓
キャンバスドラッグ → pointermove で距離更新
  ↓
指を離す (pointerup, wasDragging=true) → _confirmFaceExtrude()
```

---

## [E] UI イベント (click / change)

### ヘッダー

| 要素 | イベント | 処理 |
|------|---------|------|
| モードセレクターボタン | `click` | ドロップダウン表示/非表示 |
| モードドロップダウン項目 | `click` | `setMode(value)` |
| Undo ボタン (↶) | `click` | `_commandStack.undo()` |
| Redo ボタン (↷) | `click` | `_commandStack.redo()` |
| Export ボタン | `click` | `SceneExporter.export()` + ダウンロード |
| Import ボタン | `click` | インポートモーダル表示 |
| Save ボタン | `click` | `SceneService.saveScene()` (BFF REST) |
| Load ボタン | `click` | `SceneService.loadScene()` (BFF REST) |
| ⋯ メニュー (モバイル) | `click` | Export / Import を含むドロップダウン表示 |
| N ボタン (モバイル) | `click` | N Panel ドロワー 開閉 |
| ≡ ハンバーガー (モバイル) | `click` | Outliner ドロワー 開閉 |

### アウトライナー

| 要素 | イベント | 処理 |
|------|---------|------|
| オブジェクト行 | `click` | `_switchActiveObject(id)` |
| 可視性トグル (○) | `click` | `setVisible(id, toggle)` |
| 削除ボタン (✕) | `click` | `_deleteObject(id)` |
| オブジェクト名 | `dblclick` | リネームインライン入力 or ダイアログ |

### モバイルツールバー

| 状態 | ボタン | イベント | 処理 |
|------|--------|---------|------|
| grab.active | ✓ Confirm | `click` | `_confirmGrab()` |
| grab.active | Stack | `click` | Stack モード トグル |
| grab.active | ✕ Cancel | `click` | `_cancelGrab()` |
| faceExtrude.active | ✓ Confirm | `click` | `_confirmFaceExtrude()` |
| faceExtrude.active | ✕ Cancel | `click` | `_cancelFaceExtrude()` |
| Object Mode | + Add | `click` | 追加メニュー表示 |
| Object Mode | Edit | `click` | `setMode('edit')` |
| Object Mode | Delete | `click` | `_deleteObject(activeId)` |
| Object Mode (Frame) | Rotate | `click` | `_startRotate()` |
| Object Mode (Frame) | Add Frame | `click` | `createCoordinateFrame()` |
| Edit 2D-Sketch | ← Object | `click` | `setMode('object')` |
| Edit 2D-Sketch | Extrude | `click` | `_enterExtrudePhase()` |
| Edit 2D-Extrude | ✓ Confirm | `click` | `_confirmExtrude()` |
| Edit 2D-Extrude | ✕ Cancel | `click` | `_cancelExtrude()` |
| Edit 3D | ← Object | `click` | `setMode('object')` |
| Edit 3D | Vertex/Edge/Face | `click` | サブ要素モード切替 |
| Edit 3D | Extrude | `click` | `_startFaceExtrude()` |

> ツールバーボタンは `click` イベントで処理する。`pointerdown` ではない。
> キャンバスターゲットガードにより `pointerdown` はキャンバス以外を無視するため。

### ギズモ

| 要素 | イベント | 処理 |
|------|---------|------|
| X 軸 | `click` | カメラを +X 方向に snap (正面ビュー) |
| Y 軸 | `click` | カメラを +Y 方向に snap (左側面ビュー) |
| Z 軸 | `click` | カメラを +Z 方向に snap (上面ビュー) |

---

## イベント処理の優先順序

複数のイベントが同時に発火する場合の優先順序:

```
1. キャンバスターゲットガード (pointerdown)
   → UI 要素クリックは即 return

2. アクティブな操作ハンドラ (高優先)
   grab.active → grab ハンドラ
   faceExtrude.active → faceExtrude ハンドラ

3. 現在のモード別ハンドラ
   'object' → オブジェクト選択 / ドラッグ / rectSel
   'edit' (2d-sketch) → スケッチ描画
   'edit' (3d) → サブ要素選択

4. OrbitControls (フォールスルー)
   消費されなかったポインターイベント → カメラ操作
```

---

## Undo/Redo コマンドとイベントの対応

コマンドは `push()` により事後記録される (事前実行の `execute()` は使わない)。

| コマンド | 記録タイミング | Undo 操作 |
|---------|-------------|---------|
| `MoveCommand` | `_confirmGrab()` 内 | コーナー座標を startCorners に戻す |
| `AddSolidCommand` | `_addObject()` 確定後 | オブジェクト削除 |
| `DeleteCommand` | `_deleteObject()` 確定後 | `attachObject()` + `setVisible(true)` |
| `ExtrudeSketchCommand` | `_confirmExtrude()` 確定後 | Solid 削除、Profile を復元 |
| `RenameCommand` | `_confirmRename()` 確定後 | 旧名前に戻す |
| `FrameRotateCommand` | `_confirmRotate()` 確定後 | startQuat に戻す |

---

## 関連ドキュメント

- `docs/STATE_TRANSITIONS.md` — 各操作の状態遷移詳細
- `docs/SCREEN_DESIGN.md` — 各画面の情報設計
- `docs/adr/ADR-013-domain-events-scene-service-observable.md` — ドメインイベント ADR
- `docs/adr/ADR-022-undo-redo-command-pattern.md` — Undo/Redo コマンドパターン ADR
- `docs/adr/ADR-023-mobile-input-model.md` — モバイル入力モデル ADR
- `.claude/mental_model/2_interaction.md` — インタラクションのコーディングルール
