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
| mobile toolbar / slot / spacer / UI layout | ADR-024, `docs/code_contracts/ui_layout.md` |
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
| **既存モードにサブ操作を追加** (grab, measure など) | ✅ (FSM 追加) | ✅ (ステータスバー・ツールバー行) | ⚠️ (スロット数変化なら ✅) | ✅ (pointer/keyboard 節) | — | ⚠️ | ⚠️ §2 | — |
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

- **2026-04-17**: Feature — MeasureLine Edit Mode · 1D (Backlog 🔴 High): `MeasureLineView` per-dot materials + `setEndpointHover(index)`/`clearEndpointHover()`; `AppController._endpointDrag` state; `_enterEditMode1D()` → `editSubstate='1d'`; endpoint hover detection + camera-facing drag plane; drag confirms via `createMoveCommand` post-hoc push. `canEdit` allows MeasureLine; `canStack` excludes ImportedMesh/MeasureLine (bug #70). Bug #69 resolved (MeasureLine now editable; `!activeObj` guard). UIView `'1d'` shortcuts. Docs: STATE_TRANSITIONS, EVENTS, SCREEN_DESIGN, CODE_CONTRACTS, ROADMAP updated.
- **2026-04-16**: Feature — Spatial Node Editor Phase S-2 (ADR-030): topology editing in Node Editor. Port drag-to-create: output port drag → `_dragState` + `svg.setPointerCapture()` + temp yellow dashed line; `pointerup` → `_hitInputPort()` (14 px) → `onLinkRequested` callback → `showLinkTypePicker` → `_createSpatialLinkDirect()` (new shared method, extracted from `_confirmSpatialLink()`). Edge delete: spatial edge click → `_selectedEdge` (yellow highlight + SVG focus) → Delete key → `onDeleteSpatialLink` callback → `DeleteSpatialLinkCommand`. Both flows push same `CreateSpatialLinkCommand`. ROADMAP Phase S-2 complete.
- **2026-04-15**: Feature — ADR-032 Geometric Host Binding Phases H-1–H-6 + ADR-033 Phase C-3/C-4 (continued): `GEOMETRIC_LINK_TYPES` constant; `SceneModel._mountsIndex/_mountedByIndex`; `getMountsLink()`/`getMountedLinks()`; `SceneService._mountLocalPositions` + per-frame `_updateMountedAnnotations()`; `mountAnnotation()`/`unmountAnnotation()`/`remountAnnotation()`/`syncMountedPosition()`; `MountAnnotationCommand`; Grab plane constraint to host XY; `_computeValidLinkTypes()` validation; `showConfirmDialog()` UIView method; CoordinateFrame delete warning; `_mountPicking` state + Escape key; long-press "Mount on frame ⊕" / "Unmount ⊗" / "Add interface frame ⊞". ADR-032 Phases H-1 to H-6 complete.
- **2026-04-11**: Feature — ADR-031 Map Mode Phases M-1 to M-5: three-state `drawState` (idle/drawing/pending) with `_enterMapPendingState()`; naming-before-confirm (`showMapToolbar` name input, per-type counters); platform differentiation (Mobile = single drag, PC = multi-click Line / drag Region / click Point); chain drawing removed; endpoint snapping PC-only 20 px with `_updateSnapRing()`; Route particle bug fixed; Zone fill 0.15→0.65 + rim ring; Anchor crosshair pulse. See ADR-031.
- **2026-04-11**: Design — ADR-031 Map Mode Interaction Model & Visual Language: three-state model (idle→drawing→pending→confirm); Mobile = single drag for all types; PC = multi-click Line + drag-rectangle Region; naming-before-confirm in toolbar; endpoint snapping on PC (20 px, Line endpoints + Region vertices); visual language (drawing=solid 70%, pending=dashed 90%, confirmed=solid 100%); animation overhaul (Route bug-fix, Zone rim ring, Anchor crosshair-pulse). See ADR-031.
- **2026-04-11**: Bugfix — Map Mode tap on touch: `cursor` was null between taps (no `pointermove` on touch), causing `_updateMapPreview()` to early-return — no visual feedback after tap. Fixed by setting `cursor = pt` + calling `_updateMapPreview()` in all three tap-place paths. Remaining mobile issues ②–④ documented in ROADMAP.md "Map Mode — Mobile Bug Fixes".
- **2026-04-09**: Feature — SpatialLink Phase 3 + 4 (ADR-030): `SpatialLinkView` dashed line + directional arrowhead, color-coded by linkType; `SceneService._linkViews` Map + `_entityWorldCentroid()` + `_updateSpatialLinkViews()` per-frame; full polymorphic no-op interface (PHILOSOPHY #17). Creation UI: `L` key two-phase flow → `showLinkTypePicker()` overlay → `_confirmSpatialLink()`; `_hitAnyEntityForLink()` with bounding-box fallback; Outliner `⟡` badge via `setObjectLinked()`; N-panel "Spatial Links" section; AppController guards for SpatialLink. ROADMAP Phase 3 + 4 complete.
- **2026-04-09**: Feature — SpatialLink Phase 1 + 2 (ADR-030): `SpatialLink` domain entity; `SceneModel._links`; `SceneService.createSpatialLink()` / `detachSpatialLink()` / `reattachSpatialLink()` / `getLinksOf()`; `CreateSpatialLinkCommand` + `DeleteSpatialLinkCommand`; serialization v1.2 with `links[]`; `getSceneGraph()` emits `relation:'spatial'` edges. ADR-030 Accepted.
- **2026-04-08**: Refactor — Spatial Annotation System (ADR-029 supersedes ADR-026): `UrbanPolyline/Polygon/Marker` → `AnnotatedLine/Region/Point`; `LynchClassRegistry` → `PlaceTypeRegistry`; categories Path/Edge/District/Node/Landmark → Route/Boundary/Zone/Hub/Anchor; `lynchClass` field → `placeType`; all service methods, events, commands, view classes, and serialization updated. SpatialLink design consideration documented in ADR-029.
- **2026-04-07**: Feature — Coordinate Space Type Safety Phase 2: `WorldVector3`/`LocalVector3` branded JSDoc types in `src/types/spatial.js`; `corners` annotated on all domain entities; `_worldPoseCache` + computation locals annotated in SceneService; `tsconfig.json` + `pnpm typecheck` + CI gate. Bugfix — `AnnotatedLine/Region/Point.fromPoints()` called `new Vertex(id)` without position, causing runtime TypeError; fixed to `new Vertex(id, p.clone())`.
- **2026-04-05**: Feature — Wasm Phase 4: COOP/COEP via `public/coi-serviceworker.js`; `index.html` SW registration + one-shot reload; `SharedArrayBuffer` now available on GitHub Pages. Shared Wasm memory deferred (requires nightly Rust); architectural analysis added to ADR-027.
