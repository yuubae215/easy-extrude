# Session Log

Full history of all development sessions. See `CLAUDE.md` for the 3 most recent entries.

---

- **2026-04-01**: Bugfix — CI build failure: `SetLynchClassCommand` was imported with a class-style name in `AppController.js`, but `src/command/SetLynchClassCommand.js` exports a factory function `createSetLynchClassCommand`. Fixed import and call site. Added "Command Factory Naming Convention" rule to `docs/code_contracts/architecture.md` and `docs/CODE_CONTRACTS.md` to prevent recurrence.

- **2026-04-01**: Feature — Lynch urban classification system for 2D map objects (ADR-026). Added three new persistent 2D domain entities (`UrbanPolyline` for Path/Edge, `UrbanPolygon` for District, `UrbanMarker` for Node/Landmark) implementing the LocalGeometry interface (ADR-021). Added `LynchClassRegistry` (5 entries with geometry-type constraints, parallel to `IFCClassRegistry`) and `SetLynchClassCommand` for undo/redo. `SceneService` gains `createUrbanPolyline/Polygon/Marker()`, `setLynchClass()`, and emits `'objectLynchClassChanged'`. `SceneSerializer` handles all three new DTOs. `SCREEN_DESIGN.md` extended with S-11–S-16 (planned UX for N-panel Lynch class section, Outliner badges, placement modes). `ROADMAP.md` updated with Lynch UI Phases 1–3. Rendering layer (`meshView = null`) deferred to next session.

- **2026-04-01**: Documentation — Translated `docs/SCREEN_DESIGN.md`, `docs/LAYOUT_DESIGN.md`, and `docs/EVENTS.md` from Japanese to English. Replaced ASCII-art layout diagrams in SCREEN_DESIGN and LAYOUT_DESIGN with Mermaid `block-beta` diagrams (information areas, desktop layout, mobile layout); non-layout ASCII art (N panel fields, Outliner rows, z-index stack) kept as code blocks.

- **2026-04-01**: Documentation — 画面情報設計・レイアウト設計・イベント設計書を新規作成。`docs/SCREEN_DESIGN.md`（10画面の情報エリア定義）、`docs/LAYOUT_DESIGN.md`（寸法・z-index 階層・モバイルツールバースロット設計）、`docs/EVENTS.md`（ドメインイベント・ポインター・キーボード・タッチ・UI イベント全網羅）を追加。あわせて `CLAUDE.md` に「要求タイプ → 更新すべき設計書」の変更影響マトリクスと4ステップ更新チェックリストを追加。各設計書の冒頭に「いつ更新するか」のトリガーを明記。

- **2026-04-01**: Bugfix — Mobile header overflow: Export/Import buttons were clipped on narrow screens because `_nToggleBtn`'s `marginLeft:auto` consumed all remaining flex space. Replaced both buttons on mobile with a single `_moreMenuBtn` (⋯) that opens a dropdown containing Export and Import. `_headerStatusEl` changed from `display:none` to `visibility:hidden` on mobile so it still acts as a `flex:1` spacer, right-aligning ⋯ and N without needing `marginLeft:auto`. MENTAL_MODEL §3 and `3_ui_layout.md` updated with "Mobile Header Overflow" rule.

- **2026-04-01**: Feature — Scene JSON import. New `src/service/SceneImporter.js` (pure function: parse/validate export JSON, versions 1.0 and 1.1). `SceneService.importFromJson()` reconstructs all entity types (Solid, Profile, MeasureLine, CoordinateFrame, ImportedMesh); merge mode remaps all IDs to avoid collision with the existing scene. `SceneExporter.js` upgraded to v1.1: ImportedMesh entries now include a `geometry` field with Base64-encoded position/normal/index buffers (enabling full round-trip); `SceneSerializer.js` now exports `f32ToBase64`/`u32ToBase64` helpers. `AppController._triggerImportSceneJson()` handles the file picker and `_handleImportJsonText()` shows the import modal. `UIView` gains an Import header button (`Ctrl+I`), `onImportJson()` callback, and `showImportModal()` promise-based modal with Clear / Merge / Cancel options; skipped objects are reported in the completion toast.

Older entries: `docs/SESSION_LOG_2026-03.md`
