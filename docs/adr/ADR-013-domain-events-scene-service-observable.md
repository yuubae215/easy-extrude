# ADR-013: ドメインイベント — SceneService を Observable に (DDD Phase 4)

- **Status**: Accepted
- **Date**: 2026-03-20
- **References**: ADR-011, ADR-010

---

## Context

DDD Phase 3 (ADR-011) までで `SceneService` が ApplicationService として確立された。
しかし `AppController` は依然として、ドメイン操作のたびに View を直接呼び出していた。

```js
// Phase 3 まで — AppController._addObject
const obj = this._service.createCuboid()
this._outlinerView.addObject(obj.id, obj.name)  // ← 直接呼び出し
this._switchActiveObject(obj.id, true)
```

この結合により AppController はドメイン操作の「通知バス」になっており、
View の増減に応じて AppController を修正する必要があった。

---

## Decision

`SceneService` を `EventEmitter` のサブクラスとし、状態変更時にドメインイベントを emit する。

```
src/
  core/
    EventEmitter.js   # NEW: 最小限の pub/sub ユーティリティ
  service/
    SceneService.js   # EventEmitter を継承、イベント emit を追加
  controller/
    AppController.js  # イベント購読に切り替え、直接 View 呼び出しを削除
```

### SceneService が emit するイベント

| イベント名      | 引数               | 発火タイミング                        |
|---------------|-------------------|-------------------------------------|
| `objectAdded`   | `obj: SceneObject`  | `createCuboid()` / `createSketch()` 完了後 |
| `objectRemoved` | `id: string`        | `deleteObject()` 完了後              |
| `objectRenamed` | `id, name: string`  | `renameObject()` 完了後              |
| `activeChanged` | `id: string\|null`  | `setActiveObject()` 完了後           |

### AppController の変化

コンストラクタでイベントを購読し、OutlinerView を自動同期する。

```js
this._service.on('objectAdded',   obj      => outlinerView?.addObject(obj.id, obj.name))
this._service.on('objectRemoved', id       => outlinerView?.removeObject(id))
this._service.on('objectRenamed', (id, nm) => outlinerView?.setObjectName(id, nm))
this._service.on('activeChanged', id       => outlinerView?.setActive(id))
```

`_addObject` / `_deleteObject` / `_switchActiveObject` / `_renameObject` から
対応する直接 View 呼び出しを削除。

`_switchActiveObject` は `this._scene.setActiveId(id)` の代わりに
`this._service.setActiveObject(id)` を呼ぶ。

### SceneModel の変化

`renameObject` ファサードメソッドを削除（SceneService が `obj.rename()` を直接呼ぶため、
Phase 3 から事実上デッドコードだった）。

---

## Consequences

**良い点**
- AppController は View の具体型を知らずにドメイン操作を行える
- 新しい View (例: プロパティパネル) を追加する際、AppController を修正せずにイベント購読だけで対応できる
- SceneService がドメイン状態の唯一の公式ゲートウェイになった

**制約**
- UIView へのステータスバー更新は依然として AppController が直接担う
  (これはインタラクション状態 — grab/hover — に依存するため、モデルイベントに馴染まない)
- イベントはすべて同期ディスパッチ。非同期イベントが必要になった場合は EventEmitter を拡張する
