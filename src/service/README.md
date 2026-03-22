# Service Layer — 副作用・調整・ロック管理

**責務**: エンティティの永続化 (CRUD)、ドメイン間調整、BFF 通信、ロック管理。

ファイル: `SceneService.js`, `SceneSerializer.js`, `BffClient.js`

---

## Meta Model: 副作用を許容する唯一の内部層

Service 層は「副作用」を許容する。ただし Three.js レンダリングは View 層の責務。

| 許可 | 禁止 |
|------|------|
| `SceneModel` の読み書き | `THREE.Mesh` の直接生成 |
| `fetch` / WebSocket | `document.querySelector` |
| `EventEmitter.emit()` | ビジネスロジックの外部ロケーション（Domain 層へ） |
| ロックフラグ管理 | エンティティ上の `isProcessing` フラグ（Service が持つ） |

## Observable パターン (ADR-013)

`SceneService` はイベントを emit する:
- `objectAdded`, `objectRemoved`, `objectRenamed`, `activeChanged`

Controller は subscribe してのみ View を更新する。Service から直接 View を呼ばない。

## ロック管理の責務

### 楽観的ロック（高頻度操作）
Grab / 選択更新などのリアルタイム操作はロックなし。Service は即座に `SceneModel` へコミットする。

### 悲観的ロック（整合性クリティカル操作）
```js
async function heavyServiceOperation(id) {
  this._isProcessing = true
  try {
    // ... 複数エンティティにまたがる不可分な処理
  } finally {
    this._isProcessing = false
    this.emit('processingDone')
  }
}
```
`isProcessing` は Service が保持し、View が監視してUIを無効化する。

詳細は `docs/CONCURRENCY.md` §3–4 参照。

## エンティティ生成 (ADR-011)

エンティティの `new Cuboid()` / `new Sketch()` / `new ImportedMesh()` は必ず
`SceneService` 内のファクトリメソッド（`createBox`, `createSketch`,
`createImportedMesh`）経由で行う。Controller や View から直接 `new` しない。
