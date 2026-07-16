# 073. 生成時に命名フォームを出さない — 高頻度スポーンは「ポンポン作って後で改名」

- Status: **Accepted**(2026-07-16 実装済）
- Date: 2026-07-16
- Deciders: yuubae215, Claude
- 関連: ADR-069（Frame 命名統一・#9 の単一命名源）、ADR-037（Origin CF 親子）、PHILOSOPHY #11/#12

## Context — Goal と力学（§1.2 Goal）

ユーザ feedback（2026-07-16）:

> 「Frame とかインスタンスがいくつも生成されるオブジェクトは、とりあえずポンポン
> 作りたい。なので、生成時に命名のフォームが出てきてほしくない。後で変更する前提でいい。」

現状（Explore で確認）:

- Frame 生成の全経路のうち、**モバイル長押しの `ContextMenuHandler.promptAddFrame`**
  と、それを共有する **CoordinateFrame N パネルの「+ Add Frame」（子フレーム追加、
  `UIStateManager` 経由の `_promptAddFrame`）** だけが、生成前に
  `showRenameDialog`（インライン命名モーダル）を出していた。
- 一方、**ビューポート配置（`FramePlacementHandler.confirm`）** と
  **Solid N パネルの `onAddFrame`** は、`createCoordinateFrame(parent, null)` を
  直接呼び、`_nextEntityName('Frame')` の自動連番で**無言即時生成**していた（ダイアログ無し）。

つまり同じ「Frame を足す」という 1 操作が、入口によって「フォームが出る／出ない」に
分岐していた（ADR-069 はこのダイアログを *正しく連番シードする* まで直したが、
ダイアログの存在是非は問うていなかった）。

**Goal**: *何個も生成する種類のエンティティ（Frame・将来のインスタンス系）は、
命名を生成のゲートにせず、摩擦なく連続生成できること。* 名前は後から変える前提でよい
（PHILOSOPHY #12「一続きのジェスチャ」＝作成に別ステップの入力を挟まない）。

## Decision

**全ての「Add」経路を無言自動命名に統一し、生成時の命名フォームを廃止する。**

- `ContextMenuHandler.promptAddFrame` から `showRenameDialog` を除去し、
  `createCoordinateFrame(effectiveParentId, null)` を直接呼んで即時生成する
  （`null` → サービス内部で `_nextEntityName('Frame')` が連番を採番＝単一命名源、
  ADR-069 #9）。undo/redo コマンド記録・生成後の選択（`_switchActiveObject`、
  ADR-069「_promptAddFrame Must Select Frame」契約）はそのまま維持。
- メソッド名 `promptAddFrame`／`_promptAddFrame` は互換のため据え置くが、もはや prompt
  ではない（docstring に明記）。`showRenameDialog` は **改名専用**（`promptRename`）
  に一本化。
- 改名は生成と切り離された別の意図的操作（長押し → Rename、N パネル）として残す。

## Options considered

**A. 全経路を無言自動命名に統一（採用）** — 上記。摩擦最小・全入口一貫。
名前は連番の仮名で始まり、必要な時だけ改名する。

**B. モバイルだけ据え置き（現状維持）** — 入口ごとの分岐が残り、「ポンポン作りたい」
という feedback に反する。棄却。

**C. 命名フォームを任意化（Enter で即スキップ）** — 依然として毎回モーダルが割り込む
＝ジェスチャが途切れる。摩擦の本質を解かない。棄却。

## Consequences

- Frame（と同型の高頻度スポーン系）が入口を問わず摩擦なく連続生成できる。
- `SceneService.nextEntityName`（public delegate）は当面外部呼び出し者を失うが、
  ADR-069 が定めた「単一命名源」の公開 API 面として残す（将来の add 経路・コンソール
  API が使える）。内部の唯一源は `_nextEntityName`。
- 契約・schema・DSL 版・BFF は無改変（純クライアント UX 変更）。
- CODE_CONTRACTS「One Naming Source」ルールを「生成時フォーム無し」まで拡張して更新。
- Evidence: unit **653 pass** / typecheck clean / build clean / E2E **12 pass**。

## References

- ADR-069 — Frame 命名統一（`nextEntityName` の単一命名源導入）。本 ADR はその上に
  「生成時フォームを出さない」を積む。
- ADR-037 — ユーザ CF は Solid の Origin CF の子（親解決ロジックは不変）。
- PHILOSOPHY #12（一続きのジェスチャ）、#11（無言失敗を出さない — 生成は必ずトースト）。
