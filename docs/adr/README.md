# Architecture Decision Records (ADR)

このディレクトリはプロジェクトの設計判断を記録します。

## ルール

- ファイル名: `ADR-NNN-kebab-case-title.md`
- ステータス: `Proposed` / `Accepted` / `Deprecated` / `Rejected` / `Superseded by ADR-NNN`
- 廃止・上書きする場合は古いADRのステータスを更新し、新しいADRを追加する（削除しない）

## 索引

| No. | タイトル | ステータス | 日付 | 関連 |
|-----|---------|-----------|------|------|
| [ADR-001](ADR-001-voxel-based-shape-representation.md) | Voxelベースのシェイプ表現 | **Superseded by ADR-007** | 2026-03-20 | ADR-007 |
| [ADR-002](ADR-002-two-modeling-methods.md) | 2つのモデリングメソッド (Primitive Box / Sketch→Extrude) | Accepted | 2026-03-20 | ADR-004, ADR-007 |
| [ADR-003](ADR-003-orbit-control-middle-click.md) | Orbit コントロールを中クリックへ移行 | **Rejected** | 2026-03-20 | ADR-006 |
| [ADR-004](ADR-004-edit-mode-adapts-to-object-type.md) | Edit Mode がオブジェクトタイプに適応 | Accepted | 2026-03-20 | ADR-002, ADR-005 |
| [ADR-005](ADR-005-object-hierarchy-dimensional-classification.md) | 1D/2D/3D 次元分類によるオブジェクト階層 | Accepted | 2026-03-20 | ADR-004 |
| [ADR-006](ADR-006-right-click-cancel-context-menu.md) | 右クリック = キャンセル / コンテキストメニュー | Accepted | 2026-03-20 | — |
| [ADR-007](ADR-007-cuboid-based-shape-representation.md) | **Cuboidベースのシェイプ表現** | Accepted | 2026-03-20 | ADR-001 |
| [ADR-008](ADR-008-mode-transition-state-machine.md) | **モード遷移ステートマシン — 整合性ポリシー** | Accepted | 2026-03-20 | ADR-002, ADR-004 |
| [ADR-009](ADR-009-domain-entity-types-cuboid-sketch.md) | **ドメインエンティティ型: Cuboid / Sketch** | Accepted | 2026-03-20 | ADR-002, ADR-005, ADR-007 |
| [ADR-010](ADR-010-domain-entity-behaviour-methods.md) | **ドメインエンティティ振る舞いメソッド (DDD Phase 2)** | Accepted | 2026-03-20 | ADR-009 |
| [ADR-011](ADR-011-application-service-scene-service.md) | **ApplicationService 層の導入 — SceneService (DDD Phase 3)** | Accepted | 2026-03-20 | ADR-009, ADR-010 |

## 新しいADRを追加するには

1. 連番を採番 (`NNN = 最大番号 + 1`)
2. ファイルを作成: `ADR-NNN-title.md`
3. **この README の索引テーブルに行を追加**
4. 関連する既存ADRの `References` に言及を追加
5. コミット・プッシュ
