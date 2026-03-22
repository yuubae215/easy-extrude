# Domain Layer — 純粋エンティティ

**責務**: ビジネスロジックとドメインエンティティの表現。

ファイル: `Cuboid.js`, `Sketch.js`, `ImportedMesh.js`

---

## Meta Model: 完全な純粋性

このレイヤーのコードは **副作用を持ってはならない**。

| 禁止事項 | 理由 |
|----------|------|
| `import` from `three` | Three.js はレンダリング副作用。View 層の責務。 |
| `window`, `document` への参照 | DOM は副作用。Controller/View の責務。 |
| `fetch`, WebSocket, DB | I/O は副作用。Service 層の責務。 |
| 外部状態の直接変更 | 予測不能な副作用。Service 経由で行う。 |

## 依存方向

```
Domain ← Model ← Service ← Controller ← View
```

Domain は何にも依存しない。他の全層が Domain に依存する。

## エンティティ契約 (ADR-009, ADR-010, ADR-012)

- `instanceof Sketch` = 2D 未押し出し。操作: `extrude(height)`, `rename(name)`
- `instanceof Cuboid` = 3D。操作: `move()`, `extrudeFace(face, ...)`, `rename(name)`
- `instanceof ImportedMesh` = 任意三角形メッシュ（読み取り専用ジオメトリ）。操作: `rename(name)` のみ
- `Sketch.extrude()` はミューテーションせず新しい `Cuboid` を返す
- エンティティの型判定には `instanceof` を使い、`dimension` スカラーは使わない

## 楽観的ロック注記

エンティティは `isProcessing` フラグを持たない。ロック管理は Service 層の責務。
詳細は `docs/CONCURRENCY.md` §4 参照。
