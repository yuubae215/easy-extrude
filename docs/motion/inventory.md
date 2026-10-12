# 演出の棚卸しと採点 (ADR-166 M1)

- 採点日: 2026-10-11 (物差しは「今の Claude の能力」で、時間とともに動く — 採点は日付つきでしか言えない。ADR-166 の assumption `TheYardstickMoves`)
- 母集団: `src/**` の非テストファイルのうち、モーション基盤 (`theme/motion` / `MotionMath` / `MotionGovernor`) か reduced-motion の境界 (`prefersReducedMotion` / `useReducedMotion`) を参照するもの、**または基盤を通らずに見た目の値を書き換えるもの** (`.opacity =`・色の `lerp`) — **62 ファイル** (M1 時点の 53 に、2026-10-12 に 2 本目の信号で 9 本を足した。当事者が「キューブのホバー・選択の切り替え・グラブ中のスナップ先への近づき」を名指したとき、それを描く `MeshView` が表に無かった — 基盤を参照するものだけを数える定義では、基盤を通らない最も古い層が**定義上**入らない)。手書きの一覧ではなく、`src/MotionInventoryCoverage.test.js` が構文から導出し、下の表のどれか 1 行にちょうど 1 回現れることを問う (原則 #31 — 表に無いファイルが増えたら落ちる)。
- 採点の根拠: コード読み (各ファイルの設計記述と、使っている曲線・時間)。2026-10-10 の実機撮影 (マップ注釈・背景) を加えた。**各演出の撮影は、作り直す PR の直前に刷新前の動画として撮る** (screencast DSL — ADR-160)。M1 の時点で 53 ファイル分を撮らなかったのは、作り直さない行 (A・対象外) まで撮る費用に見合わないため。

## 物差し

品質ゲート 5 条件 (`.claude/skills/animation-fx` Step 2) を列にし、満たす ✓ / 部分的 △ / 満たさない ✕ / 該当しない — で付ける。

| 記号 | ゲート | 問い |
|---|---|---|
| G1 | linear 禁止 | すべての補間に意図した曲線があるか。距離と α を別の曲線にしているか |
| G2 | 一斉動作の禁止 | 複数要素はスタッガーか位相ずらしか (N 個で lockstep しないか) |
| G3 | 境界と余韻 | 状態が切り替わる境目に、オーバーシュート・セトル・残像のどれかがあるか |
| G4 | 文脈の同時設計 | 単体で浮かず、背景・光・影と連動しているか |
| G5 | 停止状態を作らない | 待機中にも生命感があるか (reduced motion では静的な代替) |

判定: **A** 今の水準 (作り直さない) / **B** 部分的に古い (段のついでに直す) / **C** 作り直す。Tier は原則 #30 (F 事実 / A 操作可能性 / D 歓び)。

## 採点表

| ファイル | 演出 | Tier | G1 | G2 | G3 | G4 | G5 | 判定 | 今ならこう作る | 段 |
|---|---|---|---|---|---|---|---|---|---|---|
| `src/theme/motion.js`<br>`src/theme/tokens.js`<br>`src/view/MotionMath.js`<br>`src/view/MotionGovernor.js` | モーション基盤 (reduced-motion の境界・曲線・時間の語彙・一時演出の所有者) | — | — | — | — | — | — | 対象外 (基盤) | 演出ではなく基盤。M2 (2026-10-12) で `EASING` を役割の名前 (land / fade / exit / loop / spring) の明示曲線に選び直した (CSS 既定キーワードは語彙から外し、基盤の外の残りは `MotionIdentity.test.js` の ratchet)。`DURATION` は帯の中にあったので値は据え置き | M2 ✓ |
| `src/controller/AppController.js`<br>`src/controller/ContextController.js` | 時計の所有と配線 | — | — | — | — | — | — | 対象外 (配線) | 演出そのものではない (rAF の時計と、演出の起動の配線) | — |
| `src/view/SceneStage.js`<br>`src/view/StageMath.js` | 背景 (グラデーション・フォグ・グリッド・ダスト・床のグロー) | D | ✓ | — | ✓ | ✓ | ✓ | **A** (M2 で作り直し 2026-10-12) | ~~C: Void Grid 型のまま~~ → Studio 型の作業セル。放射グラデの地、舞台の光の光だまり (呼吸 = G5)、起動フライトの着地で光が入る (G3)、光源は `STAGE_LIGHT` の 1 つ (G4 — M3 の注釈と共有)。フォグが隠していたグリッドの端はグリッド自身のフェードへ | M2 ✓ |
| `src/view/BootReveal.js` | 起動時のカメラの飛び込み | D | ✓ | — | △ | △ | — | B | 曲線は良い。背景を替えたら、着地の瞬間に光が入る (境目の演出) を背景と一緒に作る | M2 |
| `src/view/CameraFlight.js` | 選んだ物へのカメラ飛行 (割り込み可) | D | ✓ | — | △ | — | — | A | 割り込み可能な飛行として今の水準。着地のセトルは足してもよいが、操作の邪魔になるので足さない判断も正当 | — |
| `src/view/LandingEffects.js`<br>`src/view/CommandFeedbackMath.js` | 実体の出現 (輪郭が組み上がる) と消滅 (ボクセルが散る) | F | ✓ | ✓ | ✓ | △ | — | B | 出現は今の水準。消滅も対で持つ (P9)。背景を替えたら、組み上がりの閃光の色と光を背景の光源へ揃える | M4 |
| `src/view/SelectPulse.js` | 選択の合図 (輪郭が膨らんで消える) | A | △ | — | △ | — | — | B | 拡大と α が同じ進行度から出ている (1 本の曲線)。小さいうちが一番明るい 2 曲線へ (ADR-093 D2 と同じ処方) | M4 |
| `src/view/SnapFlash.js`<br>`src/view/SnapFeedbackMath.js` | スナップが噛んだ瞬間の閃光 | A | ✓ | — | ✓ | △ | — | B | 振付は良い (素の線形フェードにしないと明記)。背景を替えたら光の色だけ揃える | M4 |
| `src/view/RippleEffect.js` | リンク成立の波紋 (球が広がって消える) | F | ✕ | — | ✕ | ✕ | — | **C** | 拡大 `1 + p·3` と α `0.8·(1−p)` がどちらも線形 — いちばん古い世代の演出。成立したリンクの 2 端から中点へ光が走って結ぶ (境目 = 結ばれた瞬間に閃光、余韻で線に沿って減衰) | M4 |
| `src/view/CelebrationField.js`<br>`src/view/CelebrationMath.js`<br>`src/components/Feedback/Celebration.jsx` | 達成の祝賀 (粒子の破裂と帯) | D | ✓ | ✓ | ✓ | △ | — | B | 事実の遷移だけで鳴る規律は今の水準。粒子の色と光を背景に揃える | M4 |
| `src/view/ExtrudeFrontView.js`<br>`src/view/ExtrudeFrontMath.js`<br>`src/controller/handler/FaceExtrudeHandler.js` | 押し出しの成長前線 (伸びている面の縁が光る) | A | ✓ | — | ✓ | ✓ | ✓ | A | アプリの名前の操作の境目として今の水準 (ADR-080) | — |
| `src/view/AnnotatedPointView.js`<br>`src/view/AnnotatedLineView.js`<br>`src/view/AnnotatedRegionView.js`<br>`src/view/MapVisualMath.js` | マップ注釈 (Zone / Route / Boundary / Hub / Anchor) | A | ✓ | ✓ | ✓ | ✓ | ✓ | **A** (M3a + M3b で作り直し 2026-10-12) | ~~C: Blueprint のハッチが斜めで縞に潰れ、Zone が画面でいちばん目立つ~~ → 床の光 (縁の光 + 光の幕を視角で受け渡す)、強さは役割 (Zone = 地)、光は舞台の光に寄せる (G4)、名札は EntityLabel (M3a)。選択は白い BoxHelper → 光が `land` で強まり床の光が育つ + 名札の強調、削除は光が `exit` で消える (P9 — 出現と対、退場中は選べない) (M3b)。残る未検証: Route / Boundary の実機撮影 (テンプレに実例が無い)。動画 `docs/motion/media/m3-map-annotations*.mp4` | M3a ✓ / M3b ✓ |
| `src/view/MapPreviewMath.js`<br>`src/controller/place/PlaceToolController.js` | 配置ツールのプレビュー (カーソルの呼吸・スナップの輪) | A | ✓ | — | ✓ | ✓ | ✓ | **A** (M3b 2026-10-12) | ~~B: 平坦な無照明の点と線~~ → 置く前も置いた後と同じ光: カーソルは事実色の芯 + 床の光だまり (Hub の halo と同じ白スプライトを `lightTint` で着色・加算)、線とスナップの輪は `lightTint`。曲線 (`MapPreviewMath`) は不変 | M3b ✓ |
| `src/view/GraspGhostView.js` | 把持候補のゴースト (手の形・進入の矢印) | F | △ | — | △ | △ | — | B | 候補の切り替えに境目が無い。ADR-158 の再生 (判定した標本を描く) と同じ段で、進入スライドの演出を見直す | M4 |
| `src/view/UncertaintyGhostView.js`<br>`src/view/RegionResolveEffect.js` | 不確定な区間の帯と、衝突が解けた瞬間の色替え | F | △ | — | ✓ | △ | △ | B | 解けた瞬間の赤 → 緑は良い。帯の待機は静止に近い — 「まだ決まっていない」を呼吸で言う | M4 |
| `src/view/RobotStage.js` | ロボットの描画 (骨格 / 実写の切替、近似の半透明) | F | — | — | ✕ | △ | — | B | 骨格から実写への切替に境目が無い (ADR-150 で一瞬の入れ替わりは消したが、読み込み中の状態に語りが無い)。ADR-164 D5 のフォールバックと一緒に、読み込み中・落ちた時の見せ方を作る | M4 |
| `src/view/MeshView.js` | **キューブ (Solid) の状態の手掛かり** — ホバー・選択・違反の自発光、グラブ中にスナップ先へ近づくと輪郭が暖色へ (2026-10-12 追加 — 当事者の名指し) | A / F | — | — | ✕ | △ | — | **C** | ホバー・選択・違反の切替は `emissive.set` で**一瞬で入れ替わる** (境目が無い)。接近の暖色は距離で決まる (時間ではない) が、`#F59E0B` はトークン外の 4 色目で、噛んだ瞬間の `SnapFlash` と語りが繋がっていない。今なら: 自発光を目標値へ短く追わせる (ホバー入り `land` ≈120ms・出 `fade` ≈180ms、選択は `SelectPulse` と同じ瞬間に着地、違反は最優先で即時 + 余韻)。接近は舞台の光 / `accent` の語で温め、噛む閾値で `SnapFlash` へ受け渡す (近づく → 噛む を 1 本の物語に)。reduced では切替は即時のまま読みを保つ | M4 |
| `src/view/CoordinateFrameView.js` | 座標フレームの選択・減光 (線の不透明度の切替) (2026-10-12 追加) | A | — | — | ✕ | — | — | B | 減光が一瞬で入れ替わる。`MeshView` と同じ「状態の手掛かりの追従」の純粋関数を共有する (実体ごとに追従を書き直さない) | M4 |
| `src/view/SpatialLinkView.js` | リンク線の張力の色・違反の脈動・成立のフラッシュ (2026-10-12 追加) | F | ✕ | ✕ | △ | △ | ✓ | **C** | 成立のフラッシュが線形 (`1 − 2t`)。違反の脈動は `Date.now()` を全リンクで共有 = N 本が**同位相で点滅** (lockstep)。reduced-motion の境界を読まない (原則 #30 の外で動く)。色は 5 つともトークン外。今なら: 位相は同一性から、フラッシュは `RippleEffect` の作り直し (2 端から中点へ光が走る) と一体で、reduced では静止した違反色 | M4 |
| `src/view/ParametricPreviewView.js` | パラメトリック配置プレビューの塗りの脈動 (2026-10-12 追加) | A | ✓ | ✕ | — | — | △ | B | 全部の塗りが同じ位相で呼吸 (lockstep)、reduced-motion の境界を読まない。配置ツールのプレビュー (`MapPreviewMath`) と同じ語彙・同じ境界に揃える | M4 |
| `src/view/RegionAuthoringWidget.js` | 領域作図ウィジェットの塗りの脈動 (2026-10-12 追加) | A | ✓ | — | — | — | △ | B | `sin(2t)` の呼吸が reduced-motion の境界を読まない。上と同じ処方 | M4 |
| `src/view/RegionGhostView.js` | 領域ゴーストのペルソナ絞り込みの減光 (2026-10-12 追加) | F | — | — | ✕ | — | — | B | 絞り込みの減光が一瞬で入れ替わる。`fade` で短く追わせる (絞り込みの因果が見える) | M4 |
| `src/view/OutlinerView.js`<br>`src/view/NodeEditorView.js` | アウトライナ行の目・削除アイコンの出し入れ、ノードエディタのレイヤ切替と選択の点滅 (DOM の不透明度) (2026-10-12 追加) | A | △ | — | ✕ | — | — | B | 不透明度が一瞬で入れ替わり、モバイルの行スライドは CSS 既定の `ease`。`EASING.fade` / `land` に揃える (React 側の Outliner と同じ段で) | M4 |
| `src/view/SceneView.js` | グリッドの不透明度 (静的な設定) と投影の切替 (2026-10-12 追加) | — | — | — | — | — | — | 対象外 (静的) | 動きを持たない (グリッドの不透明度は固定値、フェードはシェーダー内の空間の関数 — ADR-166 M2)。カメラの動きは `CameraFlight` / `BootReveal` の行 | — |
| `src/view/ChromeMath.js`<br>`src/components/Chrome/ChromePrimitives.jsx`<br>`src/components/Toolbar/ToolbarButton.jsx` | 画面の部品の押下・ホバー・作動中の呼吸 | A | ✓ | — | ✓ | — | ✓ | A | ばね (press / release) と作動中の呼吸は今の水準 | — |
| `src/components/Header/Header.jsx`<br>`src/components/Header/HeaderMenus.jsx`<br>`src/components/Header/ModeDropdown.jsx`<br>`src/components/AddMenu/AddMenu.jsx`<br>`src/components/ContextMenu/ContextMenu.jsx`<br>`src/components/LinkTypePicker/LinkTypePicker.jsx`<br>`src/components/ProjectionToggle/ProjectionToggle.jsx`<br>`src/components/InfoBar/InfoBar.jsx`<br>`src/components/UIShell.jsx` | メニュー・ドロップダウン・トグルの開閉 | A | △ | △ | △ | — | — | B | 開閉の多くが CSS の既定 `ease` (意図した曲線ではない) で、項目が一斉に出る。M2 の曲線の語彙に揃え、項目を浅いスタッガーで出す。`RobotAppearanceToggle` は ADR-164 D5 で撤去済み (2026-10-11 — 行から外した。代わりの `RobotMeshLoadingNotice` は動きを持たない) | M4 |
| `src/components/Feedback/FeedbackPrimitives.jsx`<br>`src/components/Chrome/DiscoveryCounters.jsx`<br>`src/components/Context/IntakePanel.jsx` | 証拠の閃光・トースト・カウンタの変化 | F | ✓ | — | ✓ | — | — | A | 事実の遷移だけで鳴り、reduced motion で読みが消えない — 今の水準 | — |
| `src/components/Grasp/GraspSearchPanel.jsx`<br>`src/components/Outliner/Outliner.jsx` | パネルの値の動き (スコアのバー・行の開閉) | A | △ | △ | — | — | — | B | バーの伸びと行の開閉が CSS の既定曲線。値が変わった行だけを短く光らせる (どこが変わったかを言う)。Grasp パネルは ADR-164 で縮むので、そのとき一緒に | M4 |
| `src/components/Home/HomeScreen.jsx`<br>`src/components/Onboarding/TourCard.jsx`<br>`src/components/ContextDemo/ContextInspector.jsx` | 起動ホーム・ツアーカード・デモの点滅 | D | △ | ✕ | △ | ✕ | ✕ | **C** | アプリの第一印象なのに、ホームのテンプレのカードは境目の色替えと 1px の浮きだけで静止している。デモの点滅は `ease-in-out infinite` の一斉。カードのプレビューに小さな動き (セルの中でロボットが 1 回動く) を持たせ、入場をスタッガーにし、背景 (M2) と同じ光で包む | M4 |

## 集計

| 判定 | 行 | ファイル |
|---|---|---|
| **C 作り直す** | 4 (リンクの波紋 / 起動ホーム / **キューブの状態の手掛かり** / **リンク線**) — 背景は M2 で A へ、マップ注釈は M3a で B → M3b で A へ | 1 + 3 + 1 + 1 = 6 |
| **B 部分的に古い** | 15 | 31 |
| **A 今の水準** | 7 | 18 |
| 対象外 (基盤・配線・静的) | 3 | 7 |
| 計 | 29 | **62** |

**いちばん効く 1 手は M2 (背景のアトモスフィアの選び直し)。** B の 11 行のうち 4 行 (起動の飛び込み・出現と消滅・スナップ・祝賀) が「背景を替えたら光と色を揃える」で終わる — 背景が単調な既定のままでは、どの演出も単体で浮く (G4)。C の背景と M3 のマップ注釈は同じ光源を共有するので、ADR-166 の順序 (M2 → M3 → M4) は採点からも支持される。M4 の最初の候補は、線形が残っている唯一の行の **リンクの波紋** と、第一印象の **起動ホーム**。

**追記 (2026-10-12):** 2 本目の信号で入った 9 本のうち、当事者が名指したキューブの状態の手掛かり (`MeshView` — ホバー・選択・違反が一瞬で入れ替わる / 接近の暖色がトークン外で `SnapFlash` と繋がっていない) は C。M4 の最初の候補に加える。同じく入った `SpatialLinkView` (違反の脈動が N 本同位相・reduced 境界の外) はリンクの波紋と同じ段で作り直す。追従の処方 (状態の目標値へ短く追わせる) は `MeshView` / `CoordinateFrameView` / `RegionGhostView` / DOM の 2 本で共有できるので、1 つの純粋関数として起こす。
