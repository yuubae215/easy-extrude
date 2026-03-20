# ADR-011: ApplicationService 層の導入 — SceneService (DDD Phase 3)

- **Status**: Accepted
- **Date**: 2026-03-20
- **References**: ADR-009, ADR-010

---

## Context

DDD Phase 2 (ADR-010) までで、ドメインエンティティ (`Cuboid` / `Sketch`) が自身の振る舞いメソッドを持つようになった。しかし `AppController` は依然として:

1. エンティティのファクトリ責任 (`new Cuboid(...)`, `new MeshView(...)`) を持つ
2. `SceneModel` への直接的な CRUD 操作 (`addObject` / `removeObject`) を担う
3. 入力ハンドリング、モード遷移、View 更新という本来の責務と混在する

このため AppController は「ユーザー入力に反応するコントローラ」と「ドメイン操作を行うサービス」の2つの役割を持っていた。

---

## Decision

`src/service/SceneService.js` を ApplicationService として新設し、エンティティ生成と CRUD 操作をここに集約する。

```
src/
  service/
    SceneService.js   # NEW: ApplicationService
  model/
    SceneModel.js     # Aggregate Root (変更なし)
  domain/
    Cuboid.js
    Sketch.js
  controller/
    AppController.js  # 入力ハンドリングのみに専念
```

### SceneService の責務

| 操作 | メソッド |
|------|---------|
| Cuboid 生成 + 登録 | `createCuboid()` |
| Sketch 生成 + 登録 | `createSketch()` |
| エンティティ削除 + MeshView 破棄 | `deleteObject(id)` |
| リネーム (エンティティへ委譲) | `renameObject(id, name)` |
| 可視切替 (MeshView へ委譲) | `setObjectVisible(id, visible)` |
| 集約ルートの読み取り | `get scene()` → SceneModel |

### AppController の変化

- `this._scene = new SceneModel()` → `this._service = new SceneService(sceneView.scene)`
- `get _scene()` ショートハンドを追加し、SceneModel への読み取りアクセスを維持
- `_addObject` / `_deleteObject` / `_renameObject` / `_setObjectVisible` が `this._service.*` を呼ぶだけになる
- `new Cuboid`, `new Sketch`, `new MeshView` の直接インスタンス化が AppController から消える

---

## Consequences

**良い点**
- AppController の責務が「入力 → サービス呼び出し → View 更新」に絞られる
- エンティティ生成ロジックが SceneService に集約され、テスト容易性が向上する
- Phase 4 (ドメインイベント) の準備として、SceneModel をサービス経由でのみ変更するパターンが確立される

**制約**
- `MeshView` 生成に Three.js シーンが必要なため、SceneService は Three.js シーンへの参照を持つ
- Phase 4 (ドメインイベント) で View/Model 分離が完成するまで、この結合は残る
