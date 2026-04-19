# Roadmap

## Design Direction (2026-03-20, updated 2026-04-15)

This project is a **solid-body modeling application with a spatial relationship layer**. Each shape is a deformable solid defined by a LocalGeometry graph (vertices / edges / faces). Complex scenes are built by placing and deforming multiple solid objects alongside coordinate frames, measurement annotations, and spatial annotations. Entities are connected through typed `SpatialLink` edges — ranging from geometric constraints (`mounts`, `fastened`, `aligned`) that drive world-coordinate computation, to topological relationships (`contains`, `adjacent`, `above`, `connects`) and semantic annotations (`references`, `represents`). `CoordinateFrame` entities serve as explicit spatial-interface contracts between entities; they are created only when a relationship demands a named point or surface. See `docs/adr/` for detailed design decisions.

---

## Spatial Annotation System (ADR-029)

Generic 2D annotation entities for city, building, and part-level scales:
`AnnotatedLine` (linear), `AnnotatedRegion` (areal), `AnnotatedPoint` (point),
classified by place type: Route / Boundary / Zone / Hub / Anchor.

Domain layer (entities, registry, service, serializer) is complete.
The phases below cover the rendering and UI layers.

### Phase 1 — Rendering layer ✅ (2026-04-11)

| Task | Details | ADR |
|------|---------|-----|
| `AnnotatedLineView` | Three.js `Line2` (fat line) with configurable stroke color; BoxHelper for selection; Route particle + Boundary marching-ants animations | ADR-029, ADR-031 |
| `AnnotatedRegionView` | Three.js `Line2` closed ring + translucent fill `Mesh` (ShapeGeometry); Zone breathing fill + rim ring animation | ADR-029, ADR-031 |
| `AnnotatedPointView` | Flat `CylinderGeometry` marker + HTML label overlay; Hub sonar ping + Anchor crosshair pulse animations | ADR-029, ADR-031 |
| Wire views into `SceneService.create*` | Views constructed with place-type color and geometry; `dispose()` implemented | ADR-029 |
| `AppController` instanceof guards | Grab (G key) allowed; Edit Mode blocked; Stack blocked; rect-selection guard | ADR-029 |

### Phase 2 — Classification UI (N-panel + Outliner) ✅ (2026-04-08)

| Task | Details | ADR |
|------|---------|-----|
| Outliner type icons | `⟿` for AnnotatedLine, `⬡` for AnnotatedRegion, `⬤` for AnnotatedPoint | ADR-029 |
| Outliner place-type badge | Coloured badge next to name when `placeType` is set | ADR-029 |
| N-panel "Place Type" section | Badge + Set/Change button + clear button; shown for all three entity types | ADR-029 |
| Place-type picker overlay | Grouped list filtered by geometry type (`getPlaceTypesByGeometry`); search input | ADR-029 |
| `SetPlaceTypeCommand` wired to controller | `AppController` subscribes `objectPlaceTypeChanged`; forwards to OutlinerView | ADR-029 |

### Phase 3 — Creation UX ✅ (2026-04-11)

> **Superseded by ADR-031** for interaction model details.
> Implemented as Map Mode Phases M-1 to M-5 (ADR-031).

| Task | Details | ADR |
|------|---------|-----|
| "Annotate" submenu in Add menu (Shift+A) | Entries: Route, Boundary, Zone, Hub, Anchor (geometry type inferred from selection) | ADR-029 |
| Placement interaction model | Three-state drawing model (idle→drawing→pending→confirm); platform-differentiated | ADR-031 |
| Naming before confirm | Name input in Map toolbar during `pending` state; default "{PlaceType} N" | ADR-031 |
| Mobile toolbar for annotation placement | Fixed-slot layout during `drawing` + `pending`; Confirm + Cancel slots | ADR-024, ADR-031 |

---

## SpatialLink (ADR-030)

Typed semantic edges between annotated elements — makes spatial relationships
machine-readable in the scene graph. Design defined in ADR-029 §Out of scope;
full specification in ADR-030.

### Phase 1 — Domain layer ✅ (2026-04-09)

| Task | Details | ADR |
|------|---------|-----|
| `SpatialLink` domain entity | `id`, `sourceId`, `targetId`, `linkType` (`references` / `connects` / `contains` / `adjacent`); no geometry | ADR-030 |
| `SceneService.createSpatialLink()` / `detachSpatialLink()` / `reattachSpatialLink()` | Emits `spatialLinkAdded` / `spatialLinkRemoved`; stored in `SceneModel._links` | ADR-030 |
| `CreateSpatialLinkCommand` / `DeleteSpatialLinkCommand` | Undo/redo support; factory naming convention; detach/reattach pattern (no meshView) | ADR-030, ADR-022 |
| `SceneSerializer` + `SceneExporter` + `SceneImporter` | `"links": [...]` top-level array; scene version bump to 1.2; backward-compatible load (missing links → []) | ADR-030 |

### Phase 2 — Scene graph integration ✅ (2026-04-09)

| Task | Details | ADR |
|------|---------|-----|
| `getSceneGraph()` extension | Include SpatialLinks as `relation: 'spatial'` edges with `linkType` field | ADR-030, ADR-028 |
| `SceneService.getLinksOf(entityId)` | Query helper: return all links where `sourceId` or `targetId` matches | ADR-030 |

### Phase 3 — Rendering ✅ (2026-04-09)

| Task | Details | ADR |
|------|---------|-----|
| `SpatialLinkView` | Three.js dashed line/arrow between source and target world centroids; updates per animation frame | ADR-030 |
| Color-coded by `linkType` | `references`=amber, `connects`=cyan, `contains`=violet, `adjacent`=slate | ADR-030 |
| Polymorphic interface completeness | No-op stubs for all AppController-called MeshView methods (PHILOSOPHY #17) | ADR-030 |

### Phase 4 — Creation UI ✅ (2026-04-09)

| Task | Details | ADR |
|------|---------|-----|
| Two-phase `L`-key link creation | Select source → `L` key → click target → linkType picker overlay → confirm | ADR-030 |
| N-panel "Spatial Links" section | List all links for selected entity with delete button per link | ADR-030 |
| Outliner badge for linked entities | Small `⟡` icon when entity participates in ≥ 1 SpatialLink | ADR-030 |
| `AppController` guards | Block Grab / Edit / Stack / Dup for `SpatialLink`; `showToast()` on blocked ops | ADR-030 |

---

## CoordinateFrame Phase C — Interface Contract Model (ADR-033)

CoordinateFrame は「空間的インタフェース契約」として再定義される。
Solid 作成時の auto-Origin 生成を廃止し、**SpatialLink の端点として必要になるとき**、
あるいは**ユーザーが明示的に作成**したときのみ CoordinateFrame を作成する。

全設計仕様は `docs/adr/ADR-033-coordinate-frame-phase-c.md` を参照。

### Phase C-1 — Auto-Origin 廃止（コード移行） ✅ (2026-04-15)

| Task | Details | ADR |
|------|---------|-----|
| `createCuboid()` から `createCoordinateFrame` 呼び出しを削除 | Solid 作成時に Origin フレームを自動生成しない | ADR-033 §1 |
| `extrudeSketch()` / `duplicateCuboid()` も同様に削除 | 3 箇所統一。既存シーンの "Origin" フレームは保持（後方互換） | ADR-033 §1 |
| `CODE_CONTRACTS §Auto Origin Frame` を更新 | "Superseded by ADR-033" と明記 | ADR-033 §1 |
| `CommandStack.clear()` 後の初期状態から Origin フレームを除去 | 初期 Solid に余分なエンティティが含まれない | ADR-033 §1 |

### Phase C-2 — PC 作成 UI ✅ (2026-04-15)

| Task | Details | ADR |
|------|---------|-----|
| N パネル「Frames」セクションに「+ Add Frame」ボタン | 対象 Solid 選択中に表示；`CreateCoordinateFrameCommand` を発行 | ADR-033 §5 |
| `L` キーフロー内の「New frame at…」オプション | 幾何学的リンク作成時にターゲットフレームを同時命名・作成 — 未実装 | ADR-033 §5, ADR-032 §8 |

### Phase C-3 — Mobile 作成 UI ✅ (2026-04-15)

| Task | Details | ADR |
|------|---------|-----|
| 長押しコンテキストメニューに「Add interface frame ⊞」 | Solid / Annotated\* を長押し → フレーム名入力 → 作成 | ADR-033 §5 |
| SpatialLink 作成フロー内の「New frame on this object」 | 「Link to…」タップ後に端点フレームを新規作成する分岐 — 未実装 | ADR-033 §5, ADR-032 §9 |

### Phase C-4 — ライフサイクル表示 ✅ (2026-04-15)

| Task | Details | ADR |
|------|---------|-----|
| Outliner / N パネルの「参照なし」バッジ | 参照 SpatialLink が 0 件の CoordinateFrame に `⊡` バッジを表示 | ADR-033 §4 |
| 削除警告ダイアログ | 参照 SpatialLink がある CF を削除しようとすると確認ダイアログ表示 | ADR-033 §4 |

---

## Geometric Host Binding — SpatialLink 空間拘束語彙 (ADR-032)

`SpatialLink` に幾何学的拘束カテゴリ（`mounts` / `fastened` / `aligned`）を追加し、
Map 要素・Solid・CoordinateFrame 間の空間関係を座標変換として実体化する。
linkType 語彙を英語前置詞体系（9 種）に整理し、位相的・意味的拘束も統一フレームワークで記述する。

全設計仕様は `docs/adr/ADR-032-geometric-host-binding.md` を参照。

> **前提**: ADR-033 Phase C-1（auto-Origin 廃止）が完了してから着手すること。
> CoordinateFrame が「インタフェース契約」として存在する状態で mounts を実装する。

### Phase H-1 — ドメイン層（linkType 拡張 + インデックス） ✅ (2026-04-15)

| Task | Details | ADR |
|------|---------|-----|
| `GEOMETRIC_LINK_TYPES` 定数を追加 | `['mounts', 'fastened', 'aligned']`；SceneService が毎フレーム座標変換を適用する対象 | ADR-032 §2 |
| linkType 語彙を 9 種に拡張 | カテゴリ A（幾何学的）/ B（位相的）/ C（意味的）に分類 | ADR-032 §2 |
| `SceneModel._mountsIndex` / `_mountedByIndex` を追加 | `addLink`/`removeLink` が自動維持；O(1) / O(k) クエリ | ADR-032 §3 |
| `getMountsLink(sourceId)` / `getMountedLinks(targetId)` | 既存 `getLinksOf()` に加えてマウント専用クエリを追加 | ADR-032 §3 |

### Phase H-2 — SceneService 座標変換 ✅ (2026-04-15)

| Task | Details | ADR |
|------|---------|-----|
| `_updateWorldPoses()` 内で `mounts` リンクを処理 | `hostPose = worldPoseOf(link.targetId)`（CF）→ 各頂点を変換 | ADR-032 §5 |
| マウント時の頂点空間変換（一度だけ） | `localVertex = H⁻¹ × worldVertex`；全頂点を上書き | ADR-032 §5 |
| マウント解除時のワールド座標復元 | `worldVertex = hostCurrentPose × localVertex`；SpatialLink 削除 | ADR-032 §5 |
| 循環検出と警告 | `mounts` グラフに閉路を検出した場合 → 循環エッジを無視してコンソール警告 | ADR-032 §(グラフ整合性) |

### Phase H-3 — コマンド（Undo / Redo） ✅ (2026-04-15)

| Task | Details | ADR |
|------|---------|-----|
| `MountAnnotationCommand(link, worldPositionsBefore, service)` | `execute()` = 頂点変換 + SpatialLink 作成；`undo()` = 頂点復元 + SpatialLink 削除 | ADR-032 §7 |
| 既存 `CreateSpatialLinkCommand` とは別コマンドとして実装 | マウントは「変換 + リンク」の不可分操作 | ADR-032 §7, ADR-022 |

### Phase H-4 — Grab 動作変更 ✅ (2026-04-15)

| Task | Details | ADR |
|------|---------|-----|
| マウント済み Annotated\* の Grab 平面をホストのローカル XY 平面に拘束 | 移動がホストフレームのローカル平面上に限定される | ADR-032 §6 |
| 未マウント Annotated\* の Grab 平面をワールド XY 平面に拘束 | 既存の Z 浮き上がりバグ修正も兼ねる | ADR-032 §6 |

### Phase H-5 — PC 作成 UI ✅ (2026-04-15)

| Task | Details | ADR |
|------|---------|-----|
| `L` キーフロー拡張：幾何学的拘束ではCF のみハイライト | `GEOMETRIC_LINK_TYPES` 選択時は CoordinateFrame 以外を半透明化 — 未実装 | ADR-032 §8 |
| Solid クリック時のガイドトースト | 「Add a frame to this object first」を表示 | ADR-032 §8 |
| linkType ピッカーの validation フィルタ | 選択エンティティ型の組み合わせに有効な linkType のみ表示 | ADR-032 §2 (validation) |

### Phase H-6 — Mobile 作成 UI ✅ (2026-04-15)

| Task | Details | ADR |
|------|---------|-----|
| 長押しコンテキストメニューに「Mount on frame ⊕」（Annotated\* 未マウント時） | `_mountPicking = { active: true, sourceId }` に遷移；CF を強調表示 | ADR-032 §9 |
| 「Unmount ⊗ \<フレーム名\>」（Annotated\* マウント済み時） | 確認なしで即時実行（Undo 可） | ADR-032 §9 |
| 「Link to... 🔗」（Solid / CoordinateFrame） | 既存 `_linkPicking` フローへ；validation 済み linkType のみ表示 | ADR-032 §9 |
| マウントピッキング中のステータスバー | 「Tap target frame (or empty space to cancel)」；Escape でキャンセル | ADR-032 §9 |

---

## CoordinateFrame Placement Policy (ADR-034)

Placement and initial pose policy for CoordinateFrame entities.
ADR-033 defines *when* to create a frame; ADR-034 defines *where* and *how*.
Key decisions: placement is unrestricted (face / edge / interior / vertex);
default = parent centroid + identity rotation; integrator holds authority over frame pose.

Full design rationale in `docs/adr/ADR-034-coordinate-frame-placement-policy.md`.

### Phase P-1 — Parent axes ghost during Grab ✅ (2026-04-19)

| Task | Details | ADR |
|------|---------|-----|
| `showParentAxesGhost(worldPos, worldQuat)` in `CoordinateFrameView` | Lazily created Three.js group of three dimmed dashed axis lines (X=red, Y=green, Z=blue); depth-test off; opacity 0.35; scaled every frame by `updateScale()` from parent camera distance | ADR-034 §2, §5 |
| `hideParentAxesGhost()` | Hides the group without disposing — reused on next grab | ADR-034 §5 |
| Wired into `AppController._startGrab()` | On CoordinateFrame grab: find parent, compute world centroid + quaternion, call `showParentAxesGhost()` | ADR-034 §5 |
| Wired into `_confirmGrab()` / `_cancelGrab()` | Call `hideParentAxesGhost()` unconditionally when active object is CoordinateFrame | ADR-034 §5 |
| `dispose()` cleanup | `scene.remove` + traverse dispose for ghost group | ADR-034 §5 |

---

## Spatial Node Editor Strategy (ADR-030 × ADR-016/017)

SpatialLink (ADR-030) と Node Editor (ADR-016/017) は、同じシーンオブジェクトに対する
**異なる抽象レベルのグラフ表現**である。

| レイヤー | エッジ種別 | 意味 | 効果 |
|---------|-----------|------|------|
| 幾何学的 (Geometric) | SpatialLink `mounts`/`fastened`/`aligned` | 空間拘束（位置・剛体・回転） | 毎フレーム座標変換を駆動（ADR-032） |
| 位相的 (Topological) | SpatialLink `contains`/`adjacent`/`above`/`connects` | 空間的構造関係 | グラフクエリ・解析のみ（ADR-032） |
| 意味的 (Semantic) | SpatialLink `references`/`represents` | 人間が読む意図・基準参照 | なし — アノテーションのみ（ADR-032） |
| 計算的 (Computational) | OperationGraph (BFF Phase D) | 形状依存関係 | サーバサイド計算を駆動 |
| 構造的 (Structural) | TransformGraph `'frame'` エッジ | SE(3) 親子 | 世界座標を駆動 |

三者はすでに `getSceneGraph()` (ADR-028) という統一データソースを共有している。
ADR-016 §4 の Extension path もこの方向を示唆している。

戦略的な機会は、**Node Editor パネルを三レイヤー統合グラフエディタとして育てる**ことにある。
それにより SpatialLink Phase 4 の `L` キー作成フローと、BFF Phase D の DAG 編集 UI が
「グラフに辺を追加する」同一 UX として収束し、二重実装を避けられる。

### Phase S-1 — Node Editor パネルへの統合シーングラフ表示 ✅ (2026-04-16)

| タスク | 詳細 | ADR |
|--------|------|-----|
| Node Editor が `getSceneGraph()` を読む | シーンエンティティをノード、`'frame'`/`'anchor'`/`'spatial'` エッジをレイヤー別に描画 | ADR-016, ADR-028, ADR-030 |
| エッジ視覚語彙 | SpatialLink は既存の linkType 配色 (amber/cyan/violet/slate) を継承; OperationGraph エッジは別スタイル (例: 白実線) | ADR-030, ADR-017 |
| レイヤーフィルタトグル | 各エッジ種別の表示/非表示を独立切替; 大規模シーンの視覚的複雑度を低減 | — |
| 読み取り専用 (Phase S-1) | 表示のみ; トポロジー編集は Phase S-2 以降 | — |

### Phase S-2 — Node Editor パネルでの SpatialLink 編集 ✅ (2026-04-16)

| タスク | 詳細 | ADR |
|--------|------|-----|
| ノード接続で SpatialLink 作成 | ソースノードの出力ポートからドラッグ → ターゲットノードの入力ポートにリリース → linkType ピッカーオーバーレイ → `CreateSpatialLinkCommand` | ADR-030 §8 (代替作成フロー) |
| エッジ選択で SpatialLink 削除 | 空間エッジをクリック選択（黄色ハイライト）→ Delete キー → `DeleteSpatialLinkCommand` | ADR-030, ADR-022 |
| `L` キーフローとの同期 | `_createSpatialLinkDirect()` を共有メソッドとして抽出; 両フローが同じ `CreateSpatialLinkCommand` を push | ADR-030 |

### Phase S-3 — 意味的エッジの計算的エッジへのアップグレード

> ⚠️ **着手前に新 ADR を作成すること。** 拘束ソルバーの設計（revolute / prismatic）は
> 非自明な設計選択を含むため、コードを書く前に ADR で設計を固める。

SpatialLink の意味型を起点に、段階的に「計算的効果を持つ構造」へ昇格させるパス。

| タスク | 詳細 | ADR |
|--------|------|-----|
| `references` → CoordinateFrame 親子化 | `references` エッジのコンテキストメニュー「親フレームとして昇格」→ `SpatialLink` を保持したまま `CoordinateFrame.parentId` を設定 | ADR-018, ADR-019, ADR-030 |
| `connects` → 拘束 (revolute / prismatic) | `connects` エッジから「拘束を追加」→ 拘束種別ピッカー → バックログの Revolute/Prismatic Constraint 実装を起動 | ADR-016 |
| アップグレードは非破壊的 | 元の SpatialLink は新しい構造的/計算的エッジと並存; ユーザーはいつでも降格できる | — |

> **設計上の注意**: アップグレードは SpatialLink を削除しない。意味的記述と計算的効果を
> 独立した関心として保持することで、PHILOSOPHY #3 (純粋計算と副作用の分離) を尊重する。

### Phase S-4 — 統合グラフ編集 (BFF Phase D Node Editor 項目を包含)

| タスク | 詳細 | ADR |
|--------|------|-----|
| DAG トポロジー編集 | Node Editor パネルで OperationGraph エッジを作成/削除; BFF Phase D の「Node Editor — DAG topology editing UI」を直接達成 | ADR-017 |
| 混在レイヤーグラフビュー | TransformGraph (構造) / SpatialLink (意味) / OperationGraph (計算) を単一キャンバス上にレイヤー切替表示 | ADR-016, ADR-028, ADR-030 |
| BFF Phase D 項目の置換え | Phase S-4 が完成したら「Node Editor — DAG topology editing UI」を BFF Phase D テーブルから削除し、このロードマップ項目に統合 | ADR-015, ADR-017 |

### アーキテクチャ上の前提

`getSceneGraph()` はすでに三レイヤー全体の統一データソースである。
Phase S-1 は新規データパイプライン不要 — Node Editor パネルの描画ターゲット追加のみ。
Phase S-2/S-3 は既存のコマンド/イベントシステムを拡張するだけで新規ドメイン概念を要しない。
**新 ADR は Phase S-3 (拘束ソルバー設計) および Phase S-4 (統合グラフ編集 UI) の着手前に作成する。**

---

## Map Mode Interaction Model (ADR-031)

Full design specification in `docs/adr/ADR-031-map-mode-interaction-model.md`.
Implements a unified three-state drawing model (`idle → drawing → pending → confirm`)
with platform-differentiated interaction and redesigned animations.

### Phase M-1 — Visual state language ✅ (2026-04-11)

| Task | Details | ADR |
|------|---------|-----|
| Pending state dashed line style | `AnnotatedLineView` / `AnnotatedRegionView`: `setPending(bool)` switches `LineMaterial` to dashed variant | ADR-031 §3 |
| Pending state opacity | Drawing=70%, Pending=90%, Confirmed=100% | ADR-031 §3 |
| Pending stops rubber-band | `_enterMapPendingState()` freezes preview; `_showPendingPreview()` renders static `LineDashedMaterial` | ADR-031 §1 |

### Phase M-2 — Naming before confirm ✅ (2026-04-11)

| Task | Details | ADR |
|------|---------|-----|
| Name input in Map toolbar during `pending` | `showMapToolbar(…, pendingName)` adds `<input>` when `pendingName !== null`; auto-focused | ADR-031 §4 |
| Default name generation | `_mapMode.nameCounters` per-type; default `"{PlaceType} {N}"` | ADR-031 §4 |
| Confirm with current name | `_mapConfirmDrawing()` calls `getMapPendingName()` to read toolbar input | ADR-031 §4 |

### Phase M-3 — Platform-differentiated interaction ✅ (2026-04-11)

| Task | Details | ADR |
|------|---------|-----|
| Mobile drag model (all types) | `pointerdown` → `mobileDragStart`; `pointerup` → pending (or cancel if < 8 px for Line/Region) | ADR-031 §2 |
| Mobile Line = 2-point straight line | `pendingPoints = [start, end]`; no multi-click | ADR-031 §2 |
| Mobile Region = axis-aligned rectangle | Drag-to-rectangle; enter `pending` on release | ADR-031 §2 |
| PC Region = drag-rectangle only | `mobileDragStart` used for PC Region too; multi-click polygon removed | ADR-031 §2 |
| Remove immediate confirms | All types enter `pending`; `_enterMapPendingState()` is the single confirm-entry path | ADR-031 §2, §3 |
| Remove chain drawing | After confirm: `drawState = 'drawing'`, `points = []`; no carryover | ADR-031 §5 |

### Phase M-4 — Endpoint snapping (PC) ✅ (2026-04-11)

| Task | Details | ADR |
|------|---------|-----|
| Collect snap candidates | `_mapPickPoint()` skips snap on mobile; PC-only via `_mapSnapToEndpoint()` | ADR-031 §6 |
| 20 px screen-space snap | `_mapSnapToEndpoint(…, snapPx = 20)` returns `{ snapped, point }` | ADR-031 §6 |
| Snap indicator ring | `_updateSnapRing()` creates/shows `THREE.Mesh` with `RingGeometry`; hidden when not snapping | ADR-031 §6 |

### Phase M-5 — Animation overhaul ✅ (2026-04-11)

| Task | Details | ADR |
|------|---------|-----|
| Route bug fix | `AnnotatedLineView`: stores `this._points`; `setPlaceType()` calls `_rebuildParticles(this._points)` | ADR-031 §8 |
| Zone strengthened fill breathing | `FILL_OPACITY_MIN = 0.15`, `FILL_OPACITY_MAX = 0.65`, 4 s sine | ADR-031 §8 |
| Zone rim ring | `THREE.RingGeometry` at boundary; scale 1.0×→1.08×, opacity 0.40→0, 3 s cycle | ADR-031 §8 |
| Anchor crosshair pulse | `THREE.LineSegments` (±X, ±Y, 0.18 m); scale 1.0×→1.3×, 4 s sine, opacity 0.55 constant | ADR-031 §8 |

---

## Map Mode — Mobile Bug Fixes

Issues discovered during 2026-04-11 session. Bug ① was fixed; ②–④ are deferred.

### ① cursor null on touch tap ✅ (2026-04-11)

`_mapMode.cursor` was only updated in `_onPointerMove`. On touch, `pointermove`
does not fire between taps, so `cursor` stayed `null` and `_updateMapPreview()`
returned early — no cursor dot or preview line appeared after any tap.

**Fix**: set `cursor = pt.clone()` and call `_updateMapPreview()` immediately
after adding a point in the tap paths (`_onPointerDown` line tool / region
polygon, `_onPointerUp` zone first-tap else-branch).

---

### ② Two-finger unintended multi-point addition — ✅ Superseded by ADR-031

Mobile Line/Region no longer uses multi-click vertex accumulation (ADR-031 §2: Mobile =
single drag gesture).  Multi-point addition paths are removed entirely, so the
`_activeDragPointerId` guard issue becomes moot.

---

### ③ Zone drag preview corrupted by second finger movement ✅ Superseded by ADR-031

The drag gesture now uses `mobileDragStart` (set on `pointerdown`) and `_activeDragPointerId`
to filter `pointerup`.  `_onPointerMove` already checks
`if (this._activeDragPointerId !== null && e.pointerId !== this._activeDragPointerId) return`
at the top of the handler (line ~3770), which covers the Map mode pointer-move path.

---

### ④ Zone polygon close threshold too small for touch — ✅ Superseded by ADR-031

Mobile Region is now drag-to-rectangle only (ADR-031 §2).  Multi-vertex polygon drawing
on Mobile is deferred to a future control-point editing mode.  The polygon-close tap path
no longer exists on touch, so the threshold issue is moot.

---

## Wasm Geometry Engine — remaining work (ADR-027)

Phases 1–4 are implemented (2026-04-05). See ADR-027 for full design and implementation details.

**Remaining Phase 3 candidates**

| Candidate Task | Description | ADR |
|---------------|-------------|-----|
| `run_monte_carlo(params)` | Simulation engine for urban / spatial analysis | ADR-027 |
| `build_boolean_union(a, b)` | CSG union — could replace server-side BFF round-trip for simple ops | ADR-027, ADR-017 |

**Phase 4 deferred**

| Task | Status | Details |
|------|--------|---------|
| Shared Wasm Memory | ⏸ Deferred | Requires `RUSTFLAGS="-C target-feature=+atomics,+bulk-memory,+mutable-globals"` (nightly Rust); architectural analysis in ADR-027 |
| Remove the one remaining copy | ⏸ Deferred | Blocked by shared Wasm memory above |

---

## BFF Phase D (ADR-015)

Phases A, B, C implemented (2026-03-21 to 2026-03-22). See ADR-015 and ADR-017 for details.

> **Priority to be determined after Phase C completion.**

| Candidate Task | Original Phase | ADR |
|---------------|----------------|-----|
| STEP geometry persistence (SceneSerializer extension) | C→D | ADR-015 |
| B-rep topology → graph | C | ADR-016 (open) |
| Frontend domain entities → cache-only | C | ADR-015 |
| GLTF / OBJ export (Geometry Service) | C | ADR-015 |
| Node Editor — DAG topology editing UI | C | ADR-017 |
| Delta-sync protocol (JSON Patch) | C | ADR-017 |
| Remove all domain computation from frontend | D | ADR-015 |
| Frontend unit tests — View / Controller only | D | ADR-015 |
| Independent Geometry Service scaling | D | ADR-015 |

---

## Backlog (frontend features)

| Priority | Item | Complexity | ADR / Notes |
|----------|------|-----------|-------------|
| ~~🔴 High~~ | ~~MeasureLine Edit Mode · 1D — endpoint drag to reposition after placement~~ ✅ 2026-04-17 | ~~Medium~~ | ADR-005 |
| ~~🟡 Medium~~ | ~~Right-click context menu (currently: cancel only)~~ ✅ 2026-04-17 | ~~Low~~ | ADR-006 |
| 🟡 Medium | Multi-face extrude (Shift+click) | Medium | — |
| 🟡 Medium | Export (OBJ / GLTF) | Low | Phase D via Geometry Service |
| 🟢 Low | CoordinateFrame assembly-mate positioning — `matchedFrameId` field; declare frame coincidence to drive object placement | High | ADR-021 |
| 🟢 Low | Node Editor — expose CoordinateFrame `translation`/`rotation` as editable node parameters | Medium | ADR-016, ADR-018 |
| 🟢 Low | Assembly groups (virtual TransformNode pivot) | Medium | ADR-016 |
| 🟢 Low | Revolute / prismatic constraints in Node Editor | High | ADR-016 |

## Mobile UX backlog

Mobile UX design decisions are formally documented in:
- **ADR-023** — Mobile Input Model (touch gesture model, device detection, OrbitControls strategy, confirmation lifecycle)
- **ADR-024** — Mobile Toolbar Architecture (fixed-slot layout, spacer pattern, mode-specific layouts)

Phases 1 and 2 completed 2026-03-28.

### Phase 3 — Advanced touch controls

| Priority | Item | Complexity | Notes |
|----------|------|-----------|-------|
| 🟢 Low | **Axis constraint buttons (during Grab)** — Switch Grab toolbar to `Confirm \| X \| Y \| Z \| Cancel` 5-button layout. X/Y/Z tap calls `_setGrabAxis()`. | Low | Object mode already uses 5 slots, width already unified |
| 🟢 Low | **Snap mode toggle (during Grab)** — Switch snap target (Vertex / Edge / Face) via toolbar during Grab (equivalent to desktop 1/2/3 keys) | Low | Grab active toolbar needs additional slots |
| 🟢 Low | **Help drawer** — Add "Gesture list / Shortcuts" page to hamburger menu. Mobile shows gestures, desktop shows keybindings. | Medium | Extend OutlinerView drawer or add separate drawer |

## UX Polish backlog

Bug fixes and improvement candidates identified during UX validation (2026-03-26).
Bugs are also tracked on GitHub Issues #69–#73.

### Bug fixes (Issues)

| Priority | Item | Issue | Complexity |
|----------|------|-------|-----------|
| ~~🔴 High~~ | ~~Tab key shows no toast when Edit Mode blocked for read-only objects~~ ✅ 2026-04-17 (MeasureLine now editable; `!activeObj` guard added) | [#69](https://github.com/yuubae215/easy-extrude/issues/69) | ~~Low~~ |
| ~~🔴 High~~ | ~~Stack button incorrectly enabled for ImportedMesh / MeasureLine~~ ✅ 2026-04-17 | [#70](https://github.com/yuubae215/easy-extrude/issues/70) | ~~Low~~ |
| ~~🟡 Medium~~ | ~~No cancel button in mobile toolbar during measure placement~~ ✅ (`_measure.active` branch added to `_updateMobileToolbar()`) | [#71](https://github.com/yuubae215/easy-extrude/issues/71) | ~~Low~~ |
| ~~🟡 Medium~~ | ~~R key (Rotate CoordinateFrame) missing from Object mode status bar hints~~ ✅ (`appendInfoHint('R', 'Rotate')` in `_refreshObjectModeStatus()`) | [#72](https://github.com/yuubae215/easy-extrude/issues/72) | ~~Low~~ |
| 🟢 Low | Modal dialogs lack label associations and keyboard navigation | [#73](https://github.com/yuubae215/easy-extrude/issues/73) | Medium |

### Improvement proposals

| Priority | Item | Complexity | Notes |
|----------|------|-----------|-------|
| ~~🟡 Medium~~ | ~~**A-1: Context-sensitive status bar**~~ ✅ — `R Rotate` hint for CoordinateFrame via `appendInfoHint()` in `_refreshObjectModeStatus()` | Low | — |
| 🟡 Medium | **A-2: Live coordinates during Grab** — Show centroid coordinates `X:1.25 Y:0.00 Z:0.50` in status bar during Grab | Low | Change only `_updateGrabStatus()` |
| 🟢 Low | **A-3: CoordinateFrame rotation arc guide** — Overlay arc in Three.js to indicate rotation axis during R key | Medium | Requires new Three.js geometry |
| 🟢 Low | **B-3: Measure label tap** — Tap on MeasureLine distance label to copy to clipboard or convert units | Low | `MeasureLineView` + click handler |
| 🟢 Low | **C-1: Measure Panel** — List all MeasureLines in N panel with naming and CSV export | High | UIView + OutlinerView extension |
| 🟢 Low | **C-2: Snap grid visualization** — Overlay grid lines during Ctrl+Grab | Medium | Three.js GridHelper subset |
| 🟢 Low | **C-3: CoordinateFrame TF tree visualizer** — Display parent–child frame relationships as arrows in 3D viewport | High | ADR-018, ADR-019 |

---

## Completed phases

Full implementation history in `docs/SESSION_LOG.md`. Detailed design rationale in the respective ADRs.

| Feature | Completion | ADR / Notes |
|---------|------------|-------------|
| CoordinateFrame Placement Policy (ADR-034) — Phase P-1: parent axes ghost during Grab (CoordinateFrameView + AppController) | 2026-04-19 | ADR-034 |
| Spatial Node Editor Phase S-2 — SpatialLink editing in Node Editor (port drag, edge delete, shared command) | 2026-04-16 | ADR-030, ADR-022 |
| Spatial Node Editor Phase S-1 — unified scene graph + layer filter toggles in Node Editor | 2026-04-16 | ADR-016, ADR-028, ADR-030 |
| Geometric Host Binding (ADR-032) — Phases H-1 to H-6: linkType 拡張・座標変換・Grab 拘束・Mobile/PC 作成 UI | 2026-04-15 | ADR-032 |
| CoordinateFrame Phase C (ADR-033) — Phases C-1 to C-4: Auto-Origin 廃止・作成 UI (PC+Mobile)・ライフサイクル表示 | 2026-04-15 | ADR-033 |
| SpatialLink — Design: Geometric Host Binding vocabulary (ADR-032 Proposed) | 2026-04-13 | ADR-032 |
| Spatial Annotation System — Phases 1 to 3 (Rendering layer, Classification UI, Creation UX) | 2026-04-11 | ADR-029, ADR-031 |
| Map Mode Interaction Model (Phases M-1 to M-5: three-state draw, naming, platform UX, snapping, animations) | 2026-04-11 | ADR-031 |
| Spatial Annotation System refactor (UrbanPolyline→AnnotatedLine etc.) | 2026-04-08 | ADR-029 |
| Coordinate Space Type Safety (Phases 1–3: instanceof hotfix → JSDoc brands → API separation) | 2026-04-07 | PHILOSOPHY #21, CODE_CONTRACTS |
| Wasm Geometry Engine (Phases 1–4: Rust/Wasm + Worker + COOP/COEP) | 2026-04-05 | ADR-027 |
| IFC Semantic Classification | 2026-04-01 | ADR-025 |
| Undo / Redo (Phases 1–4: Command pattern, all entity types) | 2026-03-27 | ADR-022 |
| Mobile UX (Phases 1–2: toolbar, gestures, long-press, onboarding) | 2026-03-28 | ADR-023, ADR-024 |
| BFF + Microservices (Phases A–C: BFF, WebSocket, STEP import, ImportedMesh) | 2026-03-21 to 2026-03-22 | ADR-015, ADR-017 |
| Entity taxonomy redesign (Cuboid→Solid, Sketch→Profile) | 2026-03-26 | ADR-020, ADR-021 |
| CoordinateFrame (Phase A: attach + auto-origin; Phase B: nested hierarchy + rotation) | 2026-03-23 | ADR-018, ADR-019 |
| Anchored Annotations & Scene Graph API | 2026-04-06 | ADR-028 |
| Save / Load Scene UI + SceneSerializer | 2026-03-26 | ADR-015 |
| MeasureLine (1D annotation with snap) | 2026-03-22 | ADR-021 |
| Scene JSON export + import (Ctrl+E / Ctrl+I) | 2026-03-31 to 2026-04-01 | ADR-015 |
| DDD Phases 1–6 (domain entities, events, graph model, sub-element selection) | 2026-03-20 | ADR-009–ADR-014 |
| MVC refactor, ROS world frame, Blender-style UI and controls | 2026-03-17 to 2026-03-19 | ADR-002–ADR-008 |
