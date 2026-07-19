# UX Test Cases — SpatialLink Feature Set

> **注 (2026-07-19)**: 2026-04 時点のスナップショット。ケースの多くは現在も
> 有効だが、`linkType` 単一フィールドは ADR-038/043 で `jointType` +
> `semanticType` の二軸に分割済みであり、UI 文言・ボタン配置はその後の UX
> パス (ADR-062…073) で変わっている。再実施時は結果欄を再記録すること。

手動テスト用ケース集。ADR-030 / ADR-032 / ADR-043 / Node Editor S-1/S-2 を対象とする。

テスト環境: `pnpm dev` → http://localhost:5173  
ブランチ: `claude/spatiallink-ux-test-cases-vLMu1`

---

## 凡例

| 記号 | 意味 |
|------|------|
| ✅ | Pass |
| ❌ | Fail |
| ⬜ | 未実施 |
| PC | デスクトップ（マウス+キーボード） |
| MB | モバイル（タッチ） |

---

## 1. SpatialLink 基本 (ADR-030)

### SL-01 — L キー 2フェーズリンク作成（PC）

**前提**: Solid が 2 つ以上シーンに存在。Object モード。

| # | 操作 | 期待結果 |
|---|------|----------|
| 1 | Solid A を選択 | A がハイライト |
| 2 | `L` キーを押す | ステータスバーに「Click target entity」などのガイドが表示される |
| 3 | Solid B をクリック | リンクタイプピッカーオーバーレイが表示される |
| 4 | `references`（琥珀色）を選択 | ピッカーが閉じる |
| 5 | A と B の間に点線 + 矢印が表示されること | SpatialLinkView が黄橙（amber）で描画 |
| 6 | B を選択して N パネルを確認 | 「Spatial Links」セクションに `references` リンクが 1 件表示 |

**Pass / Fail**: ⬜

---

### SL-02 — リンクタイプ全種確認

**前提**: SL-01 の環境（Solid × 2 以上）

| # | リンクタイプ | 期待ビジュアル |
|---|-------------|---------------|
| 1 | `references` | 琥珀（amber） |
| 2 | `connects` | シアン（cyan） |
| 3 | `contains` | 紫（violet） |
| 4 | `adjacent` | スレート（slate） |

各リンクタイプについて SL-01 の手順でリンクを作成し、ビジュアルの配色を確認する。

**Pass / Fail**: ⬜

---

### SL-03 — SpatialLinkView: 点線 + 矢印

**前提**: SL-01 でリンク作成済み。

| # | 操作 | 期待結果 |
|---|------|----------|
| 1 | カメラをズーム・回転 | 点線が常に両エンティティ重心間を結ぶ |
| 2 | Solid A を Grab で移動 | A の移動に追随してリンク線がリアルタイムに更新される |
| 3 | 矢印の向きを確認 | 矢印は source → target の方向を指している |

**Pass / Fail**: ⬜

---

### SL-04 — Outliner バッジ

**前提**: SL-01 でリンク作成済み。

| # | 操作 | 期待結果 |
|---|------|----------|
| 1 | Outliner を確認 | A と B の行に `⟡` アイコンが表示されている |
| 2 | リンクをすべて削除 | `⟡` アイコンが消える |

**Pass / Fail**: ⬜

---

### SL-05 — N パネルからのリンク削除

**前提**: SL-01 でリンク作成済み。

| # | 操作 | 期待結果 |
|---|------|----------|
| 1 | B を選択 → N パネル「Spatial Links」セクションを開く | リンクが 1 件リスト表示されている |
| 2 | リンク行の削除ボタンを押す | リンクが N パネルから消える |
| 3 | ビューポートを確認 | 点線が消える |
| 4 | Outliner を確認 | `⟡` バッジが消える |

**Pass / Fail**: ⬜

---

### SL-06 — Undo / Redo

**前提**: SL-01 でリンクを 1 件作成した直後。

| # | 操作 | 期待結果 |
|---|------|----------|
| 1 | `Ctrl+Z`（Undo） | 点線が消える；Outliner バッジ消える |
| 2 | `Ctrl+Shift+Z`（Redo） | 点線が復元される；バッジ復元 |
| 3 | SL-05 でリンクを削除後に `Ctrl+Z` | リンクが復元される |

**Pass / Fail**: ⬜

---

### SL-07 — シーン保存・ロード（シリアライズ）

**前提**: SL-01 で `connects` リンクを作成済み。

| # | 操作 | 期待結果 |
|---|------|----------|
| 1 | Export（JSON ダウンロード）を実行 | ファイルに `"links": [...]` が含まれている |
| 2 | シーンをクリアして Export した JSON をインポート | リンクが復元され、点線が表示される |
| 3 | N パネルでリンク確認 | `connects` リンクが正しく表示 |

**Pass / Fail**: ⬜

---

### SL-08 — AppController ガード（SpatialLink エンティティへの操作ブロック）

**前提**: SL-01 でリンク作成済み（SpatialLink 自体は直接選択できないことを確認）。

| # | 操作 | 期待結果 |
|---|------|----------|
| 1 | G キー（Grab）をリンク選択状態で試みる | トースト表示でブロック、またはそもそもリンク自体を選択不可 |

**Pass / Fail**: ⬜

---

## 2. 意味的移動ガードレール（ADR-038 × ADR-041）

### SL-09 — Semantic Move Guardrail (PC / fastened リンク)

**前提**: CF A を CF B に `fastened` でリンク（SL-15 参照）。

| # | 操作 | 期待結果 |
|---|------|----------|
| 1 | Fastened source CF（B）の親 Solid を選択 | Object 選択 |
| 2 | G キーで Grab 開始 | 警告トースト「移動が空間的意図に反します」など表示され、Grab がブロックされる |

**Pass / Fail**: ⬜

---

## 3. Geometric Host Binding — Mounts (ADR-032)

### SL-10 — Mount: モバイル長押しメニュー

**前提**: AnnotatedLine（Route など）がシーンに存在。CoordinateFrame も存在。MB 環境。

| # | 操作 | 期待結果 |
|---|------|----------|
| 1 | Route を長押し（≥ 400 ms） | コンテキストメニューが「Mount on frame ⊕」を含む |
| 2 | 「Mount on frame ⊕」をタップ | ステータスバーに「Tap target frame (or empty space to cancel)」が表示 |
| 3 | 対象 CF をタップ | `mounts` リンクが作成される；SpatialLinkView が表示 |

**Pass / Fail**: ⬜

---

### SL-11 — Mount: Grab をホスト局所 XY 平面に拘束

**前提**: SL-10 でマウント済みの Route。

| # | 操作 | 期待結果 |
|---|------|----------|
| 1 | マウント済み Route を Grab | ドラッグがホスト CF の局所 XY 平面に拘束される（Z 方向には浮かない） |
| 2 | ホスト CF を回転させて Route も回転後に Grab | 拘束平面がホスト CF の局所 XY に追随する |

**Pass / Fail**: ⬜

---

### SL-12 — Unmount: モバイル長押しメニュー

**前提**: SL-10 でマウント済み。MB 環境。

| # | 操作 | 期待結果 |
|---|------|----------|
| 1 | マウント済み Route を長押し | コンテキストメニューに「Unmount ⊗ \<フレーム名\>」が表示 |
| 2 | タップ | `mounts` リンクが削除される；undo 可能 |

**Pass / Fail**: ⬜

---

### SL-13 — 未マウント Annotated の Grab: ワールド XY 平面

**前提**: AnnotatedLine（Route）が存在、マウントなし。

| # | 操作 | 期待結果 |
|---|------|----------|
| 1 | Route を Grab | ドラッグがワールド XY 平面（Z=0）に拘束され、Z 方向に浮かない |

**Pass / Fail**: ⬜

---

## 4. Geometric Host Binding — Fastened CF (ADR-032 Phase H-7)

### SL-14 — Fastened リンク作成（PC）

**前提**: Solid に 2 つの CF（CF_source, CF_target）が存在。PC 環境。

| # | 操作 | 期待結果 |
|---|------|----------|
| 1 | CF_source を選択 | Object 選択 |
| 2 | `L` キー → CF_target をクリック | ピッカーに `fastened` が選択肢として表示される |
| 3 | `fastened` を選択 | リンク作成；SpatialLinkView に接続線 |

**Pass / Fail**: ⬜

---

### SL-15 — Fastened 拘束ソルバー動作

**前提**: SL-14 で fastened リンク作成済み。CF_target が別の Solid の子。

| # | 操作 | 期待結果 |
|---|------|----------|
| 1 | CF_target の親 Solid を移動 | CF_source（および CF_source の親 Solid）がリアルタイムに追随する |
| 2 | CF_target 親 Solid を回転 | CF_source も追随して回転する |
| 3 | Undo | 移動・回転が元に戻る |

**Pass / Fail**: ⬜

---

### SL-16 — Fastened: TC Drag ブロック（fastened source CF）

**前提**: SL-14 で fastened リンク作成済み。PC 環境。

| # | 操作 | 期待結果 |
|---|------|----------|
| 1 | Fastened source CF を TC（TransformControls）でドラッグ | 警告トーストが表示され、TC ドラッグが実質ブロックされる（CF は動かない） |

**Pass / Fail**: ⬜

---

### SL-17 — Fastened: R キー回転ブロック（fastened source の親 Solid）

**前提**: SL-14 で fastened リンク作成済み。

| # | 操作 | 期待結果 |
|---|------|----------|
| 1 | Source CF の親 Solid を選択 | Object 選択 |
| 2 | `R` キーで回転開始 | 警告トーストが表示され、Rotate がブロックされる |

**Pass / Fail**: ⬜

---

### SL-18 — Unfasten（Mobile 長押しメニュー）

**前提**: SL-14 で fastened リンク作成済み。MB 環境。

| # | 操作 | 期待結果 |
|---|------|----------|
| 1 | Fastened source CF を長押し | コンテキストメニューに「Unfasten ⊗」が表示 |
| 2 | タップ | 拘束が解除される；CF_source はその時点の世界ポーズに固定される |
| 3 | Undo | 拘束が復元される |

**Pass / Fail**: ⬜

---

## 5. 2D/3D Semantic Validation — bounded_by / クリアランス (ADR-043 Phase 1)

### SL-19 — bounded_by リンク作成（AnnotatedLine → Solid）

**前提**: AnnotatedLine（Route）と Solid が近接してシーンに存在。PC 環境。

| # | 操作 | 期待結果 |
|---|------|----------|
| 1 | Route を選択 | 選択ハイライト |
| 2 | `L` キー → Solid をクリック | ピッカーに「500mm」「1000mm」「no gap」プリセットが表示される |
| 3 | 「1000mm」を選択 | `bounded_by` リンクが作成される |
| 4 | Route と Solid が 1000mm 以上離れている場合 | SpatialLinkView が通常ビジュアル（赤パルスなし） |
| 5 | Solid を Route に近づけて 1000mm 未満にする | SpatialLinkView が赤パルス点滅に変わる |

**Pass / Fail**: ⬜

---

### SL-20 — クリアランス違反アニメーション

**前提**: SL-19 でクリアランス違反状態。

| # | 確認項目 | 期待結果 |
|---|----------|----------|
| 1 | SpatialLinkView の色 | 0xEF4444 ↔ 0xFF9999 の lerp で赤く点滅 |
| 2 | 点線の dash サイズ | 縮小している（密になる） |
| 3 | Solid を 1000mm 超に引き離す | 赤パルスが消え、通常ビジュアルに戻る |

**Pass / Fail**: ⬜

---

## 6. 2D/3D Semantic Validation — Zone 包含チェック (ADR-043 Phase 2)

### SL-21 — contains リンク作成（AnnotatedRegion → Solid）

**前提**: Zone（AnnotatedRegion）と Solid がシーンに存在。PC 環境。

| # | 操作 | 期待結果 |
|---|------|----------|
| 1 | Zone を選択 | 選択ハイライト |
| 2 | `L` キー → Solid をクリック | ピッカーに `contains` が表示される |
| 3 | `contains` を選択 | リンクが作成される |

**Pass / Fail**: ⬜

---

### SL-22 — Zone 包含判定: 内側 → 外側

**前提**: SL-21 で `contains` リンク作成済み。Solid が Zone 内部に存在。

| # | 操作 | 期待結果 |
|---|------|----------|
| 1 | Solid が Zone 内に完全に収まっている | Solid は通常カラー（赤 tint なし）；SpatialLinkView 通常 |
| 2 | Solid を Grab して Zone 外に移動 | Solid に赤 emissive tint が付く；SpatialLinkView 赤パルス |
| 3 | Solid を Zone 内に戻す | 赤 tint が消える |

**Pass / Fail**: ⬜

---

### SL-23 — Zone 包含: 選択 blue と constraint red の合成

**前提**: SL-22 で違反状態。

| # | 操作 | 期待結果 |
|---|------|----------|
| 1 | 違反中の Solid を選択 | 赤 tint（0x550000）と選択 blue（0x112244）が合成された色になる（紫寄りの暗い赤） |
| 2 | 選択解除 | 赤 tint のみ残る |

**Pass / Fail**: ⬜

---

### SL-24 — contains リンク削除で tint クリア

**前提**: SL-22 で違反状態（Solid が Zone 外）。

| # | 操作 | 期待結果 |
|---|------|----------|
| 1 | N パネルから `contains` リンクを削除 | 即座に赤 tint が消える |

**Pass / Fail**: ⬜

---

## 7. Hub タクトタイム見積もり (ADR-043 Phase 3)

### SL-25 — Route→Hub リンク作成

**前提**: AnnotatedLine（Route）と AnnotatedPoint（Hub）がシーンに存在。PC 環境。

| # | 操作 | 期待結果 |
|---|------|----------|
| 1 | Route を選択 | 選択ハイライト |
| 2 | `L` キー → Hub（AnnotatedPoint）をクリック | ピッカーに「30s / 60s / 120s」プリセットが表示される |
| 3 | 「60s」を選択 | リンクが作成される；`properties.deadline = 60` |

**Pass / Fail**: ⬜

---

### SL-26 — タクトタイム: N パネル表示

**前提**: SL-25 でリンク作成済み。

| # | 操作 | 期待結果 |
|---|------|----------|
| 1 | Hub（AnnotatedPoint）を選択 → N パネル確認 | タクト見積もり秒数が表示される（緑 = OK / 赤 = 未達） |
| 2 | Route を長くして経路長を増やす（deadline/speed を超える状況） | N パネルが赤表示になる |

**Pass / Fail**: ⬜

---

### SL-27 — Hub 違反時のビジュアル

**前提**: SL-26 でタクト未達（赤）状態。

| # | 確認項目 | 期待結果 |
|---|----------|----------|
| 1 | AnnotatedPointView（Hub マーカー） | 赤変色している |
| 2 | ソナーパルス周期 | 約 0.6 s 周期で点滅している（通常より速い） |

**Pass / Fail**: ⬜

---

## 8. Anchor 公差ツリー検証 (ADR-043 Phase 4)

### SL-28 — Anchor → CF の references リンク作成

**前提**: AnnotatedPoint（Anchor）と CoordinateFrame がシーンに存在。PC 環境。

| # | 操作 | 期待結果 |
|---|------|----------|
| 1 | Anchor を選択 | 選択ハイライト |
| 2 | `L` キー → CF をクリック | ピッカーに `references` と「±1mm / ±5mm / ±10mm」プリセットが表示される |
| 3 | 「±5mm」を選択 | リンクが作成される |

**Pass / Fail**: ⬜

---

### SL-29 — Anchor 公差評価

**前提**: SL-28 でリンク作成済み。

| # | 操作 | 期待結果 |
|---|------|----------|
| 1 | Anchor と CF が 5mm 以内の場合 | N パネルに緑表示で `Xmm / ±5mm` |
| 2 | CF を 5mm 超に移動 | N パネルが赤表示；Anchor マーカーが赤変色 |
| 3 | 違反時のクロスヘアパルス周期 | 約 1 s（通常 4 s より速い） |

**Pass / Fail**: ⬜

---

## 9. Spatial Node Editor (ADR-030 × ADR-016/017 Phase S-1/S-2)

### SL-30 — Node Editor: シーングラフ表示

**前提**: Solid、CF、SpatialLink（任意）がシーンに存在。

| # | 操作 | 期待結果 |
|---|------|----------|
| 1 | Node Editor パネルを開く | シーンエンティティがノードとして表示される |
| 2 | SpatialLink が存在する場合 | 対応するエッジが linkType の配色で表示される |
| 3 | レイヤーフィルタトグルを切り替える | 該当エッジ種別が表示/非表示される |

**Pass / Fail**: ⬜

---

### SL-31 — Node Editor: ポートドラッグでリンク作成

**前提**: SL-30 の環境。

| # | 操作 | 期待結果 |
|---|------|----------|
| 1 | ソースノードの出力ポートからドラッグ | 黄色の点線（ゴーストライン）が表示される |
| 2 | ターゲットノードの入力ポートにドロップ | リンクタイプピッカーが表示される |
| 3 | `connects` を選択 | リンクが作成される；ビューポートにも点線が表示される |

**Pass / Fail**: ⬜

---

### SL-32 — Node Editor: エッジ選択・削除

**前提**: SL-31 でリンク作成済み。

| # | 操作 | 期待結果 |
|---|------|----------|
| 1 | Node Editor 上のエッジ（SpatialLink 線）をクリック | エッジが黄色ハイライトされる |
| 2 | `Delete` キーを押す | リンクが削除される；ビューポートの点線も消える |
| 3 | `Ctrl+Z` で Undo | リンクが復元される |

**Pass / Fail**: ⬜

---

### SL-33 — Node Editor と L キーの同期

**前提**: SL-30 の環境。

| # | 操作 | 期待結果 |
|---|------|----------|
| 1 | L キーフローでリンクを作成 | Node Editor にも即座にエッジが追加される |
| 2 | Node Editor でリンクを削除 | ビューポートの点線も即座に消える |

**Pass / Fail**: ⬜

---

## 10. エッジケース・回帰テスト

### SL-34 — リンク参加エンティティを削除

**前提**: SL-01 でリンク作成済み（A references B）。

| # | 操作 | 期待結果 |
|---|------|----------|
| 1 | Solid B を選択して `Delete` | B が削除される；SpatialLinkView の点線も消える；クラッシュなし |
| 2 | Undo | B が復元される；点線も復元される |

**Pass / Fail**: ⬜

---

### SL-35 — 循環マウント検出

**前提**: AnnotatedRegion X をフレーム A にマウント。

| # | 操作 | 期待結果 |
|---|------|----------|
| 1 | フレーム A を X に再びマウントしようとする | 循環検出でブロックされる（コンソール警告 or トースト） |

**Pass / Fail**: ⬜

---

### SL-36 — 複数 contains リンクの OR 合成

**前提**: Zone 1、Zone 2、Solid が存在。

| # | 操作 | 期待結果 |
|---|------|----------|
| 1 | Zone 1 → Solid（contains）+ Zone 2 → Solid（contains）のリンクを作成 | 2 件のリンク |
| 2 | Solid を Zone 1 の外、Zone 2 の内側に移動 | 少なくとも Zone 2 が包含しているため、violation なし（OR 合成） |
| 3 | Solid を両 Zone の外に移動 | violation（赤 tint） |

**Pass / Fail**: ⬜

---

### SL-37 — fastened CF と選択 blue の合成（視覚ステート）

**前提**: SL-14 で fastened リンク作成済み。

| # | 操作 | 期待結果 |
|---|------|----------|
| 1 | Source CF を選択 | 選択ハイライトのみ（拘束違反なし → 青） |
| 2 | Source CF の親 Solid を回転させて constraint が戦う状態を作る（制限事項確認） | ガード警告が先に出てブロックされる（§SL-17 参照） |

**Pass / Fail**: ⬜

---

### SL-38 — シリアライズ: 全リンクタイプ保存・ロード

**前提**: `references` / `connects` / `contains` / `adjacent` / `bounded_by` / `fastened` / `mounts` のリンクが混在するシーンを構築。

| # | 操作 | 期待結果 |
|---|------|----------|
| 1 | Export（JSON） | `"links"` 配列に全種類が含まれる |
| 2 | シーンをクリアして Import | 全リンクが復元される；SpatialLinkView が表示される |
| 3 | fastened 拘束が再アクティブ | ロード直後から拘束ソルバーが動作している |

**Pass / Fail**: ⬜

---

## 集計

| カテゴリ | テスト数 | ✅ | ❌ | ⬜ |
|----------|----------|-----|-----|-----|
| SpatialLink 基本 (ADR-030) | 8 | — | — | 8 |
| 意味的移動ガードレール | 1 | — | — | 1 |
| Mounts (ADR-032) | 4 | — | — | 4 |
| Fastened CF (ADR-032 H-7) | 5 | — | — | 5 |
| bounded_by / クリアランス (ADR-043 P1) | 2 | — | — | 2 |
| Zone 包含 (ADR-043 P2) | 4 | — | — | 4 |
| Hub タクトタイム (ADR-043 P3) | 3 | — | — | 3 |
| Anchor 公差 (ADR-043 P4) | 2 | — | — | 2 |
| Node Editor S-1/S-2 | 4 | — | — | 4 |
| エッジケース | 5 | — | — | 5 |
| **合計** | **38** | — | — | **38** |
