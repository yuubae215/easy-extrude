# 🏛️ easy-extrude — Core Architecture & Meta Mental Model

Voxel-based 3D modeling app built with Three.js + Vite. Deployed to GitHub Pages.
For project structure, MVC design, and features see `README.md`.

## Constitutional Rules (read before any code change)

1. **DDD Entity Core** — the design center is always the domain entities in
   `src/domain/`. All other layers depend inward; domain depends on nothing.
2. **Pure / Side-Effect Separation** — every function and class must be clearly
   categorised as either a *pure computation* (deterministic, no I/O) or a
   *side-effectful operation* (DOM, Three.js, network, state mutation). Never mix.
3. **MVC coordination** — the Controller is thin; it translates input events
   into Model/Service calls and View updates. Business logic lives in Domain;
   rendering in View.
4. **Concurrency strategy** — distinguish *optimistic* (real-time, non-blocking)
   from *pessimistic* (consistency-critical, blocking) locking before
   implementing any async or high-frequency operation. See `docs/CONCURRENCY.md`.

## Document navigation

Before writing or modifying any code, consult the relevant documents.

| Trigger in prompt | Read first |
|-------------------|-----------|
| philosophy / principles / why we do it this way | `docs/PHILOSOPHY.md` |
| architecture / design / why | `docs/ARCHITECTURE.md`, then `docs/adr/README.md` |
| state machine / mode transition / state | `docs/STATE_TRANSITIONS.md`, ADR-008 |
| StateMachine class / FSM / editorStates / operation state constants / _opState | `src/core/StateMachine.js`, `src/core/editorStates.js`, ADR-039 |
| cache / derived state / lifecycle / UNINIT / STALE / freshness | `docs/STATE_TRANSITIONS.md` § Internal Component State Machines |
| new feature / implementation plan | `docs/ROADMAP.md`, then related ADRs |
| screen / information architecture / UI screens / what shows on screen | `docs/SCREEN_DESIGN.md` |
| layout / dimensions / z-index / responsive / breakpoint / toolbar slots | `docs/LAYOUT_DESIGN.md` |
| events / domain events / keyboard / pointer / touch / click | `docs/EVENTS.md` |
| controls / mouse / keyboard / orbit | ADR-003, ADR-006 |
| mode / edit mode / object mode / sketch | ADR-002, ADR-004, ADR-008 |
| object / hierarchy / 1D / 2D / 3D | ADR-005 |
| cuboid / shape / corners / geometry / extrude | ADR-007, ADR-002 |
| SceneModel / domain state / MVC / DDD | `docs/ARCHITECTURE.md` |
| mobile / touch / gesture / pointer / OrbitControls | ADR-023, `docs/code_contracts/interaction.md` |
| mobile toolbar / slot / spacer / UI layout | ADR-024, ADR-042, `docs/code_contracts/ui_layout.md` |
| unified entity transform / mental model / fixed-slot / grab rotate deselect add | ADR-042 |
| entity capability / instanceof / MeasureLine / ImportedMesh / CoordinateFrame | `docs/code_contracts/architecture.md` |
| visual flag / meshview / dispose / memory / Three.js cleanup | `docs/code_contracts/memory_management.md` |
| BFF / sceneStore / database / WebSocket / occt / STEP import | `docs/code_contracts/server_async.md` |
| concurrency / async / locking / isProcessing | `docs/CONCURRENCY.md` |
| validation / process / agent workflow / meta | `.claude/DEVELOPMENT.md` |

**`/adr <topic>`** — slash command to search the ADR index.

Create a new ADR when a design choice is non-obvious or hard to reverse.
Update `docs/adr/README.md` index whenever an ADR is added or superseded.

---

## Design change impact

When a new requirement arrives, update **all** documents marked ✅ below.
Documents marked ⚠️ need review but may not require changes.

| Requirement type | STATE_TRANSITIONS | SCREEN_DESIGN | LAYOUT_DESIGN | EVENTS | ARCHITECTURE | ADR | CODE_CONTRACTS | PHILOSOPHY |
|------------------|:-----------------:|:-------------:|:-------------:|:------:|:------------:|:---:|:--------------:|:----------:|
| **新しいモード / サブステートを追加** | ✅ | ✅ (全エリア) | ✅ (ツールバースロット) | ✅ (keyboard) | ⚠️ | ✅ ADR-008 更新 | ⚠️ §1 | — |
| **既存モードにサブ操作を追加** (grab, measure など) | ✅ (FSM §Formal Spec + `_opState` 遷移テーブル更新必須) | ✅ (ステータスバー・ツールバー行) | ⚠️ (スロット数変化なら ✅) | ✅ (pointer/keyboard 節) | — | ✅ ADR-039 参照 | ⚠️ §2 | — |
| **新しいエンティティ型を追加** (domain entity) | ⚠️ | ✅ (N パネル・アウトライナー行) | — | ✅ (objectAdded など) | ✅ (taxonomy 表) | ✅ 新 ADR | ✅ §1 | ⚠️ (§2 Type contract) |
| **新しい UI 画面 / パネルを追加** | ⚠️ | ✅ (画面 ID 追加) | ✅ (寸法・z-index) | ✅ (UI events 節) | — | ⚠️ | ⚠️ §3 | — |
| **キーボードショートカットを追加 / 変更** | — | ✅ (ステータスバー欄) | — | ✅ (keyboard 表) | — | — | — | — |
| **モバイル操作 / ジェスチャーを追加** | ✅ (touch FSM) | ✅ (モバイル差分表) | ✅ (ツールバースロット) | ✅ (touch 節) | — | ✅ ADR-023/024 更新 | ✅ §2, §3 | ⚠️ (§V Interaction) |
| **レイアウト寸法 / z-index 変更** | — | ⚠️ | ✅ | — | — | — | ✅ §3 | — |
| **新しいドメインイベントを追加** | — | — | — | ✅ (domain events 節) | ⚠️ | ⚠️ ADR-013 | — | — |
| **新しい Undo/Redo コマンドを追加** | — | — | — | ✅ (undo 表) | — | ⚠️ ADR-022 | ✅ §1 | — |
| **BFF API / WebSocket エンドポイント追加** | — | — | — | ⚠️ (wsConnected など) | ⚠️ | ✅ ADR-015/017 | ✅ §3.5 | — |
| **バグ修正** | ⚠️ | ⚠️ | ⚠️ | ⚠️ | — | — | ✅ (下記ルール参照) | ⚠️ (下記ルール参照) |

> **PHILOSOPHY column rule**: mark ⚠️ only when the same root value has been
> violated in **two or more unrelated contexts**. A single bug → CODE_CONTRACTS.
> A recurring pattern across contexts → extract or update a PHILOSOPHY principle.

### 更新チェックリスト (コードを書く前に実行)

```
1. 上の表で ✅ の列を確認
2. 各ドキュメントの対象セクションを読む (Document navigation 表を参照)
3. 非自明な設計選択 → 新 ADR を作成、docs/adr/README.md インデックスを更新
4. コード変更後 → ✅ ドキュメントを更新してから commit
```

---

## After fixing a bug

After every bug fix, **before committing**, ask these two questions in order:

**Q1 — Rule missing?**
> "Did this bug exist because an implicit rule was missing or misunderstood?"

If yes → add the rule to the relevant `docs/code_contracts/*.md` detail file,
then update the summary row in `docs/CODE_CONTRACTS.md` index.
Use the criteria in CODE_CONTRACTS's "What belongs here" section.
When in doubt, add it — stale entries are easier to clean up than missing ones.

**Q2 — Pattern repeating?**
> "Have we violated the same *underlying value* in two or more unrelated places?"

If yes → this signals a missing or under-specified principle in `docs/PHILOSOPHY.md`.
Either add a new principle or sharpen an existing one. Link it to the CODE_CONTRACTS
rules it underlies. See PHILOSOPHY's "When to update" table for exact triggers.

If **almost** (same value, but only 1 context so far) → add a row to the
**Yellow Cards** table in `docs/PHILOSOPHY.md`. A Yellow Card is a first strike:
it records the candidate principle and its first context so it can be found
when the second violation surfaces. Without this, single-context patterns are
forgotten and PHILOSOPHY never grows.

## Development commands

```bash
pnpm install   # install dependencies
pnpm dev       # dev server → http://localhost:5173
pnpm build     # production build → dist/
pnpm preview   # preview production build
```

## World coordinate system

**ROS world frame** (+X forward, +Y left, +Z up). Right-handed. Matches ROS REP-103.
Three.js `camera.up = (0,0,1)`. XY plane (Z=0) is the ground plane.

@docs/CODE_CONTRACTS.md

## Notes for changes

- `vite.config.js` `base` must match the repo name (`/easy-extrude/`)
- Three.js addons must be imported from `three/addons/...`

@docs/PHILOSOPHY.md

## Session history

Full log → `docs/SESSION_LOG.md`

- **2026-06-04**: Refactor — VanillaJS → React 段階的移行 Phase 5 完了（Strangler Fig ブリッジ最終クリーンアップ）。`UIViewBridge` の JavaScript Proxy を削除し全メソッドを明示的定義に置換；undo/redo UX バグ修正（`uiStore` に `undoEnabled`/`redoEnabled` 追加、`Header.jsx` の Undo/Redo ボタンに `disabled` 適用）；重複 toast バグ修正（`_view.showToast()` 呼び出し削除）；`UIView.js` を 3516 行→43 行に削減（`ICONS` + `setCanvas`/`setCursor` のみ残存）；`OutlinerBridge` をネイティブビューなし対応に変更；`main.js` から `OutlinerView` import を削除。
- **2026-06-04**: Refactor — VanillaJS → React 段階的移行 Phase 4 完了（Outliner + Onboarding）。`OutlinerBridge` 新規作成（OutlinerView をラップ、dual-write ブリッジ）；`Outliner.jsx` 新規作成（DFS pre-order ツリー描画、インライン rename、ドラッグ&ドロップ reparent、IFC/PlaceType/SpatialLink/⊡ バッジ、モバイル drawer）；`Onboarding.jsx` 新規作成（mobile-only 初回ジェスチャーヒント、4 秒 auto-dismiss）；`UIViewBridge` に `_reactOnboarding` フラグ + `showOnboardingIfNeeded()` オーバーライド追加；`uiStore.js` に outliner + onboarding スライス追加；`UIShell.jsx` に 2 コンポーネント追加；`main.js` で `OutlinerBridge` と両フラグを有効化。
- **2026-06-03**: Refactor — VanillaJS → React 段階的移行 Phase 3 完了（小オーバーレイ群 7 点）。`ContextMenu` React 化（長押し/右クリックコンテキストメニュー）；`AddMenu` React 化（Shift+A メニュー）；`LinkTypePicker` React 化（L キー SpatialLink 型ピッカー、SEMANTIC_META 色マップ）；`SemanticSuggestion` React 化（ADR-041 サジェストバナー、6 秒 auto-dismiss）；`DragSuggestionTooltip` React 化（ドラッグ中 non-interactive ツールチップ）；`ImportProgress` React 化（インポート進捗バー）；`ImportModal` React 化（JSON インポート戦略ダイアログ、`ModalLayer` の `type:'import'` ブランチ、Promise-based bridge）。`UIViewBridge` に 5 フラグ＋ブリッジメソッド追加；`uiStore.js` に 12 アクション追加；`main.js` で全フラグ有効化。
