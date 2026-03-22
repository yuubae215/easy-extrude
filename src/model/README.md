# Model Layer — 純粋計算ロジック & アプリケーション状態

**責務**: ジオメトリ計算（ステートレス純粋関数）とシーン状態の集約ルート。

ファイル: `CuboidModel.js`, `SceneModel.js`

---

## Meta Model: 計算と状態の分離

| ファイル | 分類 | ルール |
|----------|------|--------|
| `CuboidModel.js` | 純粋計算 | 副作用禁止。同じ入力に対して常に同じ出力を返すこと。 |
| `SceneModel.js` | 集約ルート（状態） | ドメインオブジェクトの正規コレクション。Three.js 禁止。 |

## CuboidModel の純粋性制約

```js
// Good — 純粋関数
export function computeGeometry(params) { return { vertices, indices } }

// Bad — 副作用あり（禁止）
export function computeGeometry(params) {
  scene.add(new THREE.Mesh(...))  // Three.js 参照 → View 層へ移動せよ
}
```

## SceneModel の集約ルール (ADR-008)

- `SceneModel` はドメインエンティティの唯一の正規コレクション
- モードとサブステート (`selectionMode`, `editSubstate`) の正規ソース
- `setMode()` を経由しない状態遷移は禁止（`MENTAL_MODEL.md` §1 参照）

## 楽観的ロック注記

高頻度な `editSelection` 更新はロックフリー（楽観的ロック）。
重い整合性操作（エクスポート等）では Service 層が `isProcessing` フラグを管理する。
詳細は `docs/CONCURRENCY.md` §2–3 参照。
