# 073. 生成時に命名フォームを出さない — 高頻度スポーンは「ポンポン作って後で改名」

- Status: **Accepted**(2026-07-16 実装済 — Frame + マップオブジェクトの 2 経路）
- Date: 2026-07-16
- Deciders: yuubae215, Claude
- 関連: ADR-069（Frame 命名統一・#9 の単一命名源）、ADR-037（Origin CF 親子）、ADR-031（Map Mode drawState FSM）、ADR-072（Map 配置の undo 化）、PHILOSOPHY #11/#12

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

## 第 2 適用 — マップオブジェクト（同日、ユーザ「あとはマップオブジェクトかな」）

Map Mode（ADR-031）の描画 FSM は `idle → drawing → pending` の 3 状態で、`pending` は
**「名前を入力して確定」** 専用のゲートだった（左ツールバーに名前入力欄 + Confirm ボタン、
`pendingName` = 連番プレフィル）。だがジオメトリは pending に入る *前* に確定している:

- Point（Hub/Anchor）: 単クリック/タップ → geometry 確定 → pending
- Line（Route/Boundary）: 複数クリック後 RMB/Enter（PC）or ドラッグ（モバイル）→ 確定 → pending
- Region（Zone）: 矩形ドラッグ → リリース → 確定 → pending

つまり `pending` は Frame のダイアログと同じ「生成時の命名フォーム」であり、同じ根拠で不要。

**決定**: `pending` 状態を廃止し、ジオメトリ完成時に即時生成する（FSM は `idle → drawing`
の 2 状態に縮退 — ADR-031 更新）。

- `_enterPendingState` + `_confirmDrawing` を単一の `_createAnnotation(points)` に統合。
  名前は既存の per-type カウンタ（`nameCounters`）から `"<Type> N"`（例 `"Route 1"`）を
  無言採番 — ユーザ入力なし。生成後もツールは active のまま（連続配置＝「ポンポン」）。
- `createAddAnnotationCommand` の post-hoc push（undo 可能）・地面/屋根への平板シート
  （ADR-072 addendum `highestSurfaceZAt`）・スナップフラッシュは不変。
- 命名フォーム関連の死コードを除去: `pending`/`pendingName`/`pendingPoints`/
  `_showPendingPreview`、`UIView.getMapPendingName`/`setMapPendingNameInput`、uiStore の
  `mapPendingNameInput`/`showConfirm`/`pendingName`、`MapToolbar` の名前入力 + Confirm ボタン。
  ツールバーは「ツール群 + Cancel + Exit」だけになる。
- カメラ enter/exit のフライト・投影スワップ（ADR-072）は描画 FSM と直交で無改変。

## Consequences

- Frame（と同型の高頻度スポーン系）が入口を問わず摩擦なく連続生成できる。
- マップオブジェクト（注釈）も同様に、描いた瞬間に生成される（名前フォーム・Confirm 廃止）。
  Map Mode の描画 FSM は `pending` を失い 2 状態に。誤配置は undo で回収（後で改名も可能）。
- `SceneService.nextEntityName`（public delegate）は当面外部呼び出し者を失うが、
  ADR-069 が定めた「単一命名源」の公開 API 面として残す（将来の add 経路・コンソール
  API が使える）。内部の唯一源は `_nextEntityName`。
- 契約・schema・DSL 版・BFF は無改変（純クライアント UX 変更）。
- CODE_CONTRACTS「One Naming Source」ルールを「生成時フォーム無し」まで拡張し、マップ
  オブジェクトの `_createAnnotation` も対象に含めて更新。STATE_TRANSITIONS の Map Mode
  FSM を 2 状態に更新。ADR-031/072 の pending 参照を更新。
- Evidence: unit **653 pass** / typecheck clean / build clean / E2E **12 pass**（map テストは
  Confirm クリックを除去 — クリックで即生成を assert）。

## References

- ADR-069 — Frame 命名統一（`nextEntityName` の単一命名源導入）。本 ADR はその上に
  「生成時フォームを出さない」を積む。
- ADR-031 — Map Mode 相互作用モデル（`drawState` FSM）。本 ADR が `pending` を廃し 2 状態化。
- ADR-072 — Map 配置の undo 化（`createAddAnnotationCommand`）・地面/屋根平板・スナップ。
  生成トリガの内部だけ変わり、これらの契約は不変。
- ADR-037 — ユーザ CF は Solid の Origin CF の子（親解決ロジックは不変）。
- PHILOSOPHY #12（一続きのジェスチャ）、#11（無言失敗を出さない — 生成は必ずトースト）。
