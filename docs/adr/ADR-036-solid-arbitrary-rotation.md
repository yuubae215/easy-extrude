# ADR-036 — Solid Arbitrary Rotation (R key)

| Field | Value |
|-------|-------|
| **Status** | Accepted |
| **Date** | 2026-05-02 |
| **References** | ADR-007, ADR-019, ADR-022, ADR-012 |

---

## Context

### 問題

Solid（3D ソリッド）を直接回転させる手段がなかった。
CoordinateFrame は ADR-019 (Phase B) で R キー回転が実装されているが、
Solid の `R` キーは no-op であり、ユーザーは：

- CF を作成して fastened リンクを張る（未完成：ROADMAP 🔴 High「fastened 拘束の回転伝播」が未実装）
- 8 頂点を Grab で個別に動かす（非直感的）

のいずれかしか選択肢がなかった。

### 設計の中心的な問い

Solid の回転を「どう表現するか」：

| アプローチ | 格納形式 | 長所 | 短所 |
|-----------|---------|------|------|
| **A — コーナーベイク** | corners: Vector3[8] に回転結果を書き込む | ADR-007 の表現を維持; Grab と同じパターン | rotation quaternion は後から取り出せない |
| B — CF 経由 | CF rotation を Solid に伝播 | 回転状態を分解できる | fastened 伝播が未実装; CF 生成の儀式が必要 |

---

## Decision

**アプローチ A — コーナーへの直接ベイク** を採用する。

### 根拠（Philosophy との対応）

- **PHILOSOPHY #2（Type Is the Capability Contract）**：Solid の回転能力は Solid の型が直接保証すべき。CF という中間エンティティへの依存は型契約の外部化であり違反。
- **PHILOSOPHY #6（Transformations Return New Instances）**：純粋関数 `rotateCuboid(corners, pivot, quat)` が新たな配列を返す。Solid ドメインメソッド `rotate()` がそれをインプレース適用。`extrudeFace()` / `move()` と完全に対称なパターン。
- **PHILOSOPHY #3（Separate Pure Computation from Side Effects）**：幾何演算は `CuboidModel.js` の純粋関数、副作用（View 更新・コマンド記録）はコントローラ。

### データモデル

Solid に `rotation: Quaternion` フィールドを追加しない。ADR-007 の `corners: Vector3[8]` 表現を維持する。回転は 8 コーナーに bake される。

### 操作フロー

```
Object モード、Solid 選択中
  R         → rotate 開始（pivot = startCorners のセントロイド）
  マウス移動 → セントロイド周りのスクリーン平面回転
  X/Y/Z     → ワールド軸拘束（CF 回転と同一 UX）
  数値入力   → 角度直接指定（CF 回転と同一 UX）
  Enter     → 確定（SolidRotateCommand を push）
  Esc / RMB → キャンセル（startCorners を復元）
```

### ピボット

コーナーの重心（`getCentroid(startCorners)`）を固定ピボットとする。

操作開始時に `startCorners` を snapshot し、`_applyRotate()` では
常に startCorners のセントロイドを pivot として使う。
これにより、回転中に pivot が揺れない（pivot は開始時点のセントロイドで固定）。

### Undo / Redo

`SolidRotateCommand(solidRef, startCorners, endCorners, sceneService, onApplied)` を新設。
`MoveCommand` と同じ「開始/終了コーナーを保存して swap」方式。

```
execute(): endCorners → obj.corners → meshView.updateGeometry()
undo():    startCorners → obj.corners → meshView.updateGeometry()
```

---

## Consequences

### 正の影響

- Solid を R キーで直接回転できる。CF 作成や fastened 設定が不要。
- `move()` / `extrudeFace()` と同じパターンで実装でき、コードの一貫性が高い。
- `SolidRotateCommand` はシンプルな corners-swap で undo/redo が完結する。

### 制約・既知の限界

- 回転は corners に bake されるため、後から「何度回転した」という状態は取り出せない。
- Solid の rotation quaternion が必要になる将来のユースケース（アニメーション、制約ソルバー等）では、Solid のデータモデル自体を再設計する必要がある。その際は別の ADR を作成すること。
- CoordinateFrame の場合と異なり、Solid 回転に対してはプロベナンスチェック（ADR-034）は不要（Solid に `declaredBy` はない）。

### 変更しないこと

| 項目 | 理由 |
|------|------|
| `_rotate` 状態の基本構造 | CF 回転の UX と同一のため共有する |
| CF 回転フロー | ADR-019 で確立済み；変更なし |
| fastened 拘束の回転伝播 | 独立した ROADMAP 課題のまま |
| モバイル TC の rotate モード | Solid には TC rotate を追加しない（スコープ外） |

---

## 実装ガイド

```
変更ファイル:
  src/model/CuboidModel.js
    - rotateCuboid(corners, pivot, quat): Vector3[]  を追加

  src/domain/Solid.js
    - rotate(startCorners, pivot, quat): void  を追加
      (move() / extrudeFace() と対称なドメインメソッド)

  src/command/SolidRotateCommand.js  (新規)
    - createSolidRotateCommand(solidRef, startCorners, endCorners, sceneService, onApplied)

  src/controller/AppController.js
    - _rotate.startCorners: Vector3[] | null  を追加
    - _startRotate():  instanceof Solid 分岐を追加
    - _applyRotate():  instanceof Solid 分岐を追加
    - _confirmRotate(): SolidRotateCommand を push
    - _cancelRotate(): Solid コーナー復元
    - _setRotateAxis(): Solid pivot 再投影
    - R key 条件を Solid にも拡張

更新するドキュメント:
  docs/adr/README.md  (インデックス行追加)
  docs/EVENTS.md      (keyboard 表: R キー Solid 行追加)
  docs/SCREEN_DESIGN.md (ステータスバー行)
  docs/CODE_CONTRACTS.md (Entity Capability Contracts 更新)
```
