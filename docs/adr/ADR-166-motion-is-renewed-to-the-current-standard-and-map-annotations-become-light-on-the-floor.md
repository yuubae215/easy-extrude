# 166. 演出を今の水準へ作り直す — マップ注釈は床に当たった光にする

- Status: Accepted (2026-10-14 — M4d4 で M1〜M4 のすべての段を実施。採点表の B は段を持たない `GraspGhostView` の 1 行だけ — ADR-158 の段 G-9 (未着手) への申し送りで、理由と満期は DEF-069 = ADR-158)
- Date: 2026-10-11
- Deciders: yuubae215, Claude
- 段: 本 ADR の M1〜M4 (下の §段)。IA 再設計の順序表には載せない (画面の住所を変えないため)
- Retires: PATH:src/view/OutlinerView.js — React の Outliner に置き換わってからどこからも new されていなかった DOM の Outliner (M4d4 で削除。採点表はこの死んだファイルの演出を採点していた)。M3a で宣言していた `GREP:src/view/AnnotatedRegionView.js::The\sBlueprint\sdevice` (製図台の装置) は M3a (2026-10-12) で退役済みで、満期の来た行はそのとき閉じた
- Supersedes / Superseded by: ADR-093 を部分的に置き換える (D3 Blueprint アトモスフィアの部分だけ — M3a で実施 2026-10-12。D1 位相を同一性から導く・D2 曲線 2 本・D6 reduced motion は継承)

## Context — Goal と力学 (§1.2 Goal)

### 要求 (当事者、2026-10-10)

> 古くなったマップアニメーションの刷新も計画してください
> (大胆案で) … あなたの別のセッションでのモーションアニメーションのスキルを見ると、今のリポジトリの
> アニメーションなどの演出が古く感じたため、古いと表現しました。
> (スキルというのは) ユーザ作成のスキルではなく、Claude 自体の能力のことね

**Goal:** *アプリの演出が、今の Claude が作れる水準で揃っている。マップ注釈は、どの投影・どの角度から
見ても読め、実写のロボットと同じ空間にいるように見える。* 物差しはリポジトリ内のスキルの版ではなく、
**今の Claude の能力**である。

### 力学 — 前提が 3 つ消え、隣の世代が上がった

ADR-093 (2026-07-25) は Map 注釈を一度刷新した。注釈のコード (`src/view/Annotated*View.js` /
`MapVisualMath.js`) は 2026-08-02 から触られていない。その後に起きたこと:

1. **前提にした画面が消えた。** ADR-093 D3 の Blueprint 装置は真上から見る Map モード用だった。
   ADR-103 (2026-08-02) で Map モードは視点に格下げされ、注釈はずっと透視の 3D にいる。斜めから見ると
   ハッチは縞模様に潰れ、シールを貼っただけに見える (2026-10-10 の実機撮影)。
2. **隣の見た目の世代が上がった。** ロボットは実写メッシュ (ADR-149)、TCP 等の名札は EntityLabel
   (ADR-155)。注釈の名札だけが別の作り。
3. **使われ方が変わった。** テンプレでは Zone が「セルの床全体」として使われ、画面でいちばん大きく
   鮮やかな要素が、いちばん重要度の低い物になっている。

アプリ全体についても: 背景 (`SceneStage`) はグラデーション + フォグ + グリッド + ダストで、
`.claude/skills/animation-fx` が v1.1 で「毎回フォグで単調」として退けた組み合わせのまま。
モーション・アイデンティティ (イージング族・時間尺度・振付・アトモスフィア・3 色) は CLAUDE.md に
一度も決められていない — 演出ごとにばらばらに方向が選ばれてきた。リポジトリ内の animation-fx は
v1.8 (2026-08-02) で止まっている。

ADR-093 が積み残した 2 つ (注釈の消滅演出 = P9 対称、選択時の見せ方) も手つかず。

## Options considered

- **A (堅実案): Blueprint を残し、斜めから読めるようにする** (角度でハッチを薄める、Zone を抑える) —
  tradeoff: リスクが小さいが、製図台の語彙が実写の空間に馴染まない問題は残る。
- **B (大胆案): Blueprint をやめ、注釈を「床に当たった光」にする** — Zone は光だまりの縁、Route は床を
  流れる光、Anchor / Hub は床のスポット。光源は SceneStage が既に持つ加算スプライトを共有する —
  tradeoff: ADR-093 D3 を置き換える。背景の雰囲気の決定 (M2) に依存する。
- **C: 注釈だけ直し、アプリ全体の演出は触らない** — tradeoff: 「古い」の原因 (方向性が一度も決まって
  いない) が残り、次の刷新でまた置いていかれる。
- **D: 現状維持**。

当事者は **B** を選び、範囲をアプリ全体の演出へ広げた。

## Decision — Strategy (§1.2 Strategy) — 案 B + 全体の棚卸し

### 物差し

物差しは**今の Claude の能力**。各演出を「今ならこう作る」と比べて採点する。品質ゲート 5 条件
(linear 禁止 / 一斉動作の禁止 / 境界と余韻 / 文脈の同時設計 / 停止状態を作らない) と、原則 #30 の
Tier (Fact / Affordance / Delight) は従来どおり守る。棚卸しで出た差分のうち再利用できるものは
`.claude/skills/animation-fx` にも書き戻す (スキルの成長プロトコル)。

### §段

| 段 | 中身 | 完了条件 |
|---|---|---|
| **M1 棚卸し** (**実施 2026-10-11**) | モーション基盤 (`src/theme/motion.js`・`MotionGovernor`・`MotionMath`) か reduced-motion の境界を参照する演出を、品質ゲート・Tier・「今ならこう作る」との差で採点した表を作る。各演出の撮影 (screencast DSL — ADR-160) は、作り直す PR の直前に刷新前の動画として撮る | 表のファイル = 母集団 (構文から導出)。**結果は `docs/motion/inventory.md`** — 53 ファイル・21 行、C 4 行 (背景 / リンクの波紋 / マップ注釈 / 起動ホーム)。2026-10-12 に母集団を追補して 62 ファイル・29 行 (基盤を通らずに見た目を書き換えるもの — キューブの状態の手掛かり `MeshView` ほか)、census は `src/MotionInventoryCoverage.test.js` |
| **M2 方向性を決める** (**実施 2026-10-12**) | モーション・アイデンティティ 5 軸を当事者と決め、CLAUDE.md に「モーション・アイデンティティ」節として固定する。背景 (SceneStage) のアトモスフィアを Void Grid 型から選び直す | CLAUDE.md に節があり、5 軸が埋まっている。**結果**: 節は CLAUDE.md、軸の母集団は animation-fx Step 1.5 から導出して `src/MotionIdentity.test.js` が問う |
| **M3a マップ注釈 = 床の光** (**実施 2026-10-12**) | 案 B。注釈の名札を EntityLabel に揃える (名札の仕組みを 1 つに — ADR-155 D1 の続き)。投影・角度に依らず読める (見る角度を `MapVisualMath` の入力にする)。Zone の強さを役割で決める。Blueprint 装置を退役 | 純粋層テスト (位相の同一性・linear 禁止・reduced motion のフレーム一致を継承 + 角度の入力 + 役割の表)。刷新前後の静止画 `docs/motion/media/m3a-*.png` (動画は M3b の後に M3 全体で撮る) |
| **M3b 選択・消滅・置く前** (**実施 2026-10-12**) | 選択時の見せ方 (BoxHelper の白い箱 → 光が強まって `land` で着地)、消滅演出 (P9 — ライフサイクルに `exiting`、論理の可視性と描画の可視性を 2 欄に分ける)、配置プレビュー (`MapPreviewMath`) を同じ光で描く | `exiting` の状態機械 (STATE_TRANSITIONS)、hit-test が退場中の注釈を拾わないこと、刷新前後の動画。**結果**: 下の「M3b で決めたこと」、実機の静止画 `docs/motion/media/m3b-*.png`。**動画は得られていない** — 下の「分かったこと」 |
| **M4 残りの演出** | M1 の採点が低い順に作り直す。4 本に割った (当事者合意 2026-10-12): **M4a 状態の手掛かりの追従** (キューブのホバー・選択・違反・接近、座標フレームの減光、領域ゴーストの絞り込み — **実施 2026-10-12**) → **M4b リンク** (波紋 + リンク線を一体で — **実施 2026-10-12**) → **M4c 起動ホーム** (**実施 2026-10-13**) → **M4d B の残り** — 4 本に割った (当事者合意 2026-10-13): **M4d1 待機の呼吸の統治** (**実施 2026-10-13**) → **M4d2 選択の合図** (**実施 2026-10-13**) → M4d3 舞台の光に揃える — 2 本に割った (当事者合意 2026-10-13): **M4d3a 光と曲線** (**実施 2026-10-13**) → **M4d3b ロボットの読み込みの語り + 接地影** (**実施 2026-10-13**) → **M4d4 DOM の開閉** (**実施 2026-10-14**)。`GraspGhostView` は段を持たない (ADR-158 — DEF-069) | M1 の表の全行が「今の水準」になるか、残す理由が書かれている。**M4a の結果**: 下の「M4a で決めたこと」、3 行が A へ (`docs/motion/inventory.md`)。**M4b の結果**: 下の「M4b で決めたこと」、C の 2 行を 1 行に束ねて A へ。**M4c の結果**: 下の「M4c で決めたこと」、C の最後の 1 行が A へ (C は 0 行)。**M4d1 の結果**: 下の「M4d1 で決めたこと」、B の 3 行が A へ (B は 10 行)。**M4d2 の結果**: 下の「M4d2 で決めたこと」、B の 1 行が A へ (B は 9 行)、A の 2 行 (キューブ・座標フレーム) の残しが閉じた。**M4d3a の結果**: 下の「M4d3a で決めたこと」、B の 4 行が A へ (B は 5 行)、A の 3 行 (不確定の帯・プレビュー・領域作図) の G4 の残しが閉じた。**M4d3b の結果**: 下の「M4d3b で決めたこと」、B の 1 行 (ロボットの描画) が A へ (B は 4 行)、A の 1 行 (キューブ) の M2 の残し (接地影) が閉じた。**M4d4 の結果**: 下の「M4d4 で決めたこと」、B の 3 行が A へ (B は段を持たない `GraspGhostView` の 1 行だけ — 完了条件を満たした)、CSS 既定曲線は 11 → 0 で ratchet から禁止へ |

M3 は M2 の後に置く — 床の光は M2 で決める背景の光源を共有するので、先に作ると光源が 2 つになる (§1.1)。
M3 は 2 本に割った (当事者合意 2026-10-12): `exiting` の状態追加と見た目の刷新が同じ差分に混ざるとレビューできないため。

**M4d4 で決めたこと (2026-10-14、当事者合意 — 俯瞰の推奨 3 点「死んでいた `OutlinerView` は削除して退役」「ratchet は B 行の外の 7 件も含めて 0 にし禁止へ」「メニューは即時に閉じる (退場の状態を足さない)」に「はい、合意です！」):**

| 問い | 決定 | 正本 |
|---|---|---|
| 採点表の処方と実物の食い違い | 処方を書き直してから直した。`OutlinerView` は**死んでいた** (どこからも new されない — `FloorContainerCensus.test.js` が出現 0 を確かめていた)。Header 系の 4 つのポップオーバーは ADR-080 で既に「起点から膨らむ + スタッガー」で、残りは `HeaderMenus` の面だけ。Grasp のバーは既に `land`、「値が変わった行を光らせる」は `DeltaChip` が言っていた | `docs/motion/inventory.md` |
| 死んだファイル | **削除** (Retires: PATH)。誰も見ない画面の演出を磨くのは仕事ではない。同じ PR で、色の ratchet (719 → 699)、`FloorContainerCensus` の対象外宣言とその根拠の検査、`tokens.test.js` の選択の描き手の表、JSDoc の参照を下げた | — |
| ノードエディタの点滅 (1 語 2 事実) | **割った**。形の更新 (`geometry.update`) は選択を 400 ms 借りて元に戻していた — 選択が 2 つの事実を描き、その間に選んだノードは無言で巻き戻された (原則 #4 の最後の書き込み勝ち)。いまは自分の欄 `_flashedAt` (ノードごとに 0..1、全体で 0..N) を持つ光の重ねで、舞台の光が `fade` で消える (`DURATION.flash`)。SVG は変化のたびに描き直すので**経過時間で置く** (負の delay) — 描き直しで光が始めからやり直さない。reduced では同じ時間だけ静かな光を保つ | `FeedbackMath.updateFlash` / `NodeEditorView._flashNode` |
| メニューの面 | `HeaderMenus` の面を他のポップオーバーと同じ `popoverEnterMotion` (起点 = トリガの右下、`spring` — 許された 1 か所) にし、行は `itemEnterMotion` のスタッガー、ホバーは `fade` | `ChromeMath` |
| メニューの閉じ方 | **即時** (退場の演出を足さない)。閉じた時点で利用者は次へ移っており、退場は応答を遅らせるだけ。足せばメニューごとに「閉じつつある」第 3 の状態が生まれる — `OverflowMenuState` の閉が段を持てない形 (ADR-113) を壊す | — |
| 引き出し | `drawerMotion(open, reduced)` — **曲線が向きに従う**: 来るときは `land`、去るときは `exit` (Outliner と N パネルが同じ源を読む)。どちらも `ease` だった | `ChromeMath.drawerMotion` |
| 値のバー | `barMotion` を 1 つの源に (Grasp パネルだけが `land`、余裕のメーターと取り込みの進捗は `ease` — 写しが 3 つで曲線が 2 つだった) | `ChromeMath.barMotion` |
| B 行の外の 7 件 | 閃光 `flashStyle` → `fade`、取り込みパネルのバッジの弾み → `land`・展開 → α `fade` + 位置 `land`・カードのホバー → `fade`。この行 (`FeedbackPrimitives` / `IntakePanel`) は G1 ✓ の A と採点されていた — M4d3a と同じ採点の訂正 | — |
| ratchet → 禁止 | 既定曲線の個数は **0** で、増えも減りもしないものは予算ではなく禁止なので、ratchet を禁止の検査に変えた。そのとき既定曲線の **2 つ目の形** — 曲線を書かない `transition: 'opacity 0.15s'` (ブラウザは黙って `ease` を使う) — が数えられていなかったと分かり (3 件: ツールバーのボタン・パラメトリック資産のカード・実体の名札)、両方の形を数える | `src/MotionIdentity.test.js` |
| 機械が問う所 (Q3) | `MotionIdentity.test.js` (既定曲線 0 — キーワードと無言の両方、読み手の liveness)、`NodeEditorFlash.test.js` (選択の書き手はメソッド単位で 2 つ — 構築と `_selectNode`。旧コードに当てると 2 件とも落ちる)、`FeedbackMath.test.js` (`updateFlash` の舞台の光・`fade`・経過時間・終わり・reduced)、`ChromeMath.test.js` (`drawerMotion` の向き・`barMotion`)、`MotionInventoryCoverage.test.js` (母集団 70 — 死んだファイルが消え、reduced を読むようになった 3 本が入った) | — |

**語彙 (原則 #33):** 「このノードはいま更新された」が言えなかった — 選択の語を借りていた (1 語 1 事実の違反) ので、選択から**割った**。光・`fade`・`land`・`exit` の語は在ったので足していない。足した関数 (`updateFlash` / `drawerMotion` / `barMotion`) は語ではなく、散っていた写しの源を 1 つにしたもの。

**M4d4 で分かったこと (原則 #19):**
- **書かなかった曲線は欄を持たない。** ratchet は既定曲線を「キーワードの個数」で数えていたので、曲線を**書かない**行 — ブラウザが黙って `ease` を選ぶ行 — はノードを持たず、11 → 0 の間ずっと見えなかった (原則 #31 の形: 在るものを辿る数え方は無いものを素通りする)。禁止に変えるときに「時間はあるのに曲線の語が無い行」として数える形を足した。新しい原則ではなく #31 の事例なので、原則は足していない。
- **採点表は死んだファイルも採点する。** 母集団は構文から導出しているので「基盤を参照する」ファイルは入るが、「マウントされている」ことは問わない。死んだファイルは 2 つの検査 (`FloorContainerCensus` の出現 0 と採点表) にまたがって生き残っていた — 片方は死を知っていて、もう片方は知らなかった。マウントを母集団の条件にするのは過剰 (一般には導出できない) なので、検査は足していない。M1 の「構造的に見逃すもの」の宣言に加える。
- **一時的な合図が持続する状態の書き手を借りる形** (ノードエディタの点滅が選択を借りる) は、M4d2 の「度合いの読み手に変えた瞬間に効かない書き手が生まれる」と同じ原則 #4 の事例。検査はメソッド単位で数える形 (M4d3b) をそのまま使った。

**実機:** Chromium の実機 (vite dev) で、Header の `Start ▾` の面が `eaPopoverEnter` (spring 150 ms・起点 `right top`) で出て、行が 0 / 24 / 48 … ms のスタッガー (`land`) で並ぶこと、375 px の Outliner の引き出しが閉では `exit`・開では `land` の `transition` を持つことを読み出した。CSS の時計を 0.08 倍に落とした中間フレーム (行が上から順に現れている) — `docs/motion/media/m4d4-menu-slowed-clock.png`。e2e は smoke / mobile-reach / criteria-hearing の 58 本が緑。**検証できていないこと:** メニュー・引き出しの見えの良し悪し (人の目)、時間軸の動画 (M3b と同じ理由)、ノードの光の配線 (BFF の `geometry.update` を出すスタックを上げていない — 純粋層のテストと書き手の個数の検査のみ)。

**M4d3b で決めたこと (2026-10-13、当事者合意 — 俯瞰の推奨 3 点「影は Solid と腕の台座 (`ImportedMeshView` は残し)・真下に落ちる」「DOM の `LOADING…` は残す」「腕は `fade` 0.3 s で入り、光は同じ瞬間に `exit`」に「All good, please go ahead!」):**

| 問い | 決定 | 正本 |
|---|---|---|
| 待つ間に何を言うか | **どこ**に来るか。腕は初見まで非表示 (ADR-150 D2) なので、台座の床 (base フレームの Z=0) に舞台の光の点を置く。DOM の `LOADING…` は**なぜ**を言うので残す — 2 つは別の事実で、第二の源ではない | `RobotRevealMath.BEACON` |
| 光の形と呼吸 | 色は `STAGE_LIGHT.color` (光は 1 つ)、径は台座 (Ø150 mm) の 2 倍。`unresolved` (4 s — まだ決まっていない) で `lo..hi` を呼吸し、位相はロボットの id (N 台が同時に読み込んでも揃わない)。reduced では中央で静止 | `beaconFrame` / `IDLE_PERIOD.unresolved` |
| 着地 | 腕は `fade` (不透明度) で 0.3 s かけて入り、光は同じ瞬間に `exit` (保ってから去る、0.85× へ) で消え、消え切ったら解放する (基数 1 → 0、原則 #9)。読み込みが落ちて骨格を見せるときも同じ着地 (骨格も初見)。reduced では即時 | `ARM_REVEAL_CUE` / `BEACON_CUE` |
| 状態の数 | **増やさない**。初見は論理 2 状態 (待機 / 表示済み) のまま、着地は時計から導く**描画の度合い** (M4a の「目標と度合いの 2 欄」と同じ形)。3 状態にしないので状態機械の図は起こさない | STATE_LEDGER「腕の初見」 |
| 腕の不透明度の書き手 | **`_writeLook` 1 つ** = 素材の不透明度 × 未検証の半透明 (ADR-144 D4) × 到着。`_setUnverifiedLook` と `setToolMount` は事実を書いて `_writeLook` を呼ぶだけになった (M4d2 の教訓: 度合いの読み手を足すと、外の直接の書き手は次のフレームで上書きされる) | `RobotStage._writeLook` |
| 接地影の光源 | 光は 1 つ — 床の光だまりは上から来るので影は**真下**に落ちる (接地影)。リムは輪郭を分ける逆光で影を作らないので、2 つ目の影の源ではない。色は光を抜いた床 `backdropEdge` (新しい色を足さない) | `GroundShadowMath.SHADOW` |
| 接地影の形 | 描いたジオメトリの点を床へ射影した最小面積の外接長方形 (回した箱は回した影)、縁は smoothstep で柔らかく、浮くと `fade` の減衰 (1 − x)² で薄まり縁が広がる。長さはすべて足跡に比例 (mm と m で同じ絵 — 原則 #27)。平らなスケッチ・床より下の体は影を落とさない。腕は台座の丸で、到着と一緒に濃くなる | `footprintOf` / `groundShadowFrame` / `robotFootprint` |
| 範囲 | Solid / Profile (`MeshView`) と腕。`ImportedMeshView` は別クラスで、点群が大きく足跡の計算を毎回の差し替えで払う設計を別に決める必要があるので**残し** (`ImportedMeshView` は動きを持たず inventory の母集団の外 — 影を持たないことは STATE_LEDGER「接地影」の行が言う) | — |
| 機械が問う所 (Q3) | `RobotRevealMath.test.js` (光の色 = 舞台の光・周期・N 台の位相・reduced・退場の中点 0.875 = inCubic・到着の中点 0.75 = outQuad)、`GroundShadowMath.test.js` (色・回した箱の面積・浮きの中点 0.25・mm/m・0 の場合)、`RobotStageLook.test.js` (腕の素材を書くメソッドの個数 — 旧コードに当てると落ちる)、`e2e/robot-appearance.spec.js` (止めた間は光が在り影が無い、着地後は光が解放され影が在る、失敗でも光が消える) | 各テスト |

**語彙 (原則 #33):** 「腕はここに来る」は既に在る語 (舞台の光・`unresolved`・`fade` / `exit`・同一性の位相) で言えた — 線だけをつないだ。足した語は**接地影** 1 つ (M2 で名指しして残した語) で、高さという事実に画素を与えるもの。

**M4d3b で分かったこと (原則 #19):**
- **書き手の数え方は「メソッド単位」が効く。** 腕の素材の不透明度を書く行は 3 つのメソッドに散っていたが、どれも `material.opacity = …` という同じ形で、行を grep しても「どこが書いてよいか」は言えない。数える単位をメソッドにすると (`RobotStageLook.test.js`)、許された書き手の**集合**を宣言でき、空の集合も fail にできる (原則 #31)。M4d2 の「度合いの読み手に変えた PR は、その画素の外の書き手を数える」をここでは**実装の前に**当てた (欠陥は出荷していない — 予防なので原則も Yellow Card も足していない。#4 の検査の形の 1 例)。

**実機:** e2e (Chromium、URDF の取得を止める) で、待つ間の光の存在・影の不在、着地後の光の解放・影の存在を確かめた。**検証できていないこと:** 実機での見え (人の目 — 光の明るさと影の濃さの値は当て推量で、撮影していない)、時間軸の動画 (M3b と同じ理由)、Solid の接地影の e2e (純粋層のテストと配線の読みのみ)。

**M4d3a で決めたこと (2026-10-13、当事者合意 — 俯瞰の推奨 3 点「M4d3 を 3a 光と曲線 / 3b 読み込みの語り + 接地影 に割る」「読み込み中は台座の床に舞台の光の点」「地の色は状態のトーン、白く飛ぶ所だけ舞台の光」に「推奨案に賛成」):**

| 問い | 決定 | 正本 |
|---|---|---|
| 閃光の色 | **白く飛ぶ所は舞台の光。** 一時演出の記述子は `color` (状態のトーン = 事実) と `flash` (= `STAGE_LIGHT.color`) の 2 欄を持ち、境目の瞬間は `flash` へ寄る。出現・消滅の私的な白 `0xffffff` (2 箇所) は退役。スナップは中心の火花 (噛んだ点) が光で、輪は経路のトーン。祝賀の粒子は光の中で生まれ、トーンへ冷める | `CommandFeedbackMath.lifecycleDescriptor` / `SnapFeedbackMath.snapFlashDescriptor` / `CelebrationMath.celebrationDescriptor` の `flash` |
| 地の色 | **状態のトーンのまま** (`lightTint` で光を混ぜない)。注釈 (M3a) は常に在る「場所」なので光に寄せたが、一時演出の色は「何が起きたか」の事実で、混ぜると出現の緑と祝賀の緑が別の色になる | 同上の `color` |
| 曲線 | 不透明度・色の減衰はすべて `fade` (outQuad を 1 → 0 に読む = (1 − x)²) — 閃光の立ち上がりと減衰、出現の消え際、火花の蒸発、スナップの 3 つの減衰、祝賀の α。祝賀の飛行は `land`、大きさは `exit` (保ってから去る) | `voxelFlash` / `voxelEnvelope` / `sparkScale` / `snapFlashFrame` / `particleFrame` |
| 祝賀の一斉 | 粒子ごとに出現の黄金比の散らし (`particleProgress` — `voxelDelay` / `localProgress` を共有、散らしの語彙は 1 つ)。DOM は飛行 (`land`) と α・光 (`fade`) を 2 本のアニメーションに割った | `particleProgress` / `Celebration.jsx` |
| 起動の飛び込み | コードは変えない。処方の「着地の瞬間に光が入る」は M2 の `StageMath.lightOn` が既に実装していた | `StageMath.lightOn` |
| A 行の色 (M4d1 の G4 の残し) | 手写しの状態色をトークンへ: 領域作図 `#10b981` → `factTone`・`#cc3333` → `dangerTone`、不確定の帯 `#d5a23a` → `cautionTone`・提案の青 → `infoTone`、プレビューの青 → `infoTone`、領域の衝突の赤 `GAP_COLOR` → `dangerTone` | `COLOR` |
| 機械が問う所 (Q3) | 3 つの記述子の `flash` が `STAGE_LIGHT.color` に等しく `color` と異なること (各純粋層テスト)、減衰が `fade` であること (中点の値を焼く — 線形なら中点は 0.5)、祝賀の N 粒子が N 個の時計を持つこと。白の直書きと CSS 既定曲線は 2 つの ratchet が数える (`tokens.test.js` 731 → 719、`MotionIdentity.test.js` 13 → 11) | 各 `*.test.js` |

**語彙 (原則 #33):** 語は在った (`STAGE_LIGHT`・`land` / `fade` / `exit`・`voxelDelay`)。足したのは記述子の欄 `flash` 1 つで、これは新しい語ではなく「閃光は何色か」という既に在る事実に居場所を与えたもの — それまでは view の中の白の直書きで、記述子 (事実の源) から見えなかった。

**M4d3a で分かったこと (原則 #19):**
- **採点の ✓ はコードを読んだ証拠ではなかった。** 出現・スナップ・祝賀の 3 行は G1 (linear 禁止) に ✓ が付いていたが、3 行とも不透明度の減衰は素の線形だった (スナップの行は「素の線形フェードにしないと明記」とまで書いていた — ファイルの冒頭の設計記述を読み、曲線の式を読んでいなかった)。M1 の採点の根拠は「コード読み (各ファイルの設計記述と、使っている曲線・時間)」で、**記述は意図を、式は事実を言う** — 採点は式の側を読む。いまは 3 つの減衰を中点の値で焼いた (線形なら中点は 0.5 なので、検査の書き方が「線形ではない」を主張する)。 1 文脈 (この採点表) なので PHILOSOPHY の Yellow Cards に行を足した。
- **起動の飛び込みの処方は M2 が満たしていた。** M4d1 の「処方の文は満期を持たない」と同じ形 (原則 #32 — 義務を発火事象の側に置かなかった) — 採点表の処方は、それを満たした段 (M2) の側から読み返されなかった。新しい原則ではなく #32 の事例なので、原則は足していない。

**実機:** 撮っていない (下の検証できていないことを参照)。e2e の smoke (演出の reduced 境界を含む) と、純粋層・ratchet のテストで確かめた。**検証できていないこと:** 実機での見え (人の目)、時間軸の動画 (M3b と同じ理由)、祝賀の 3D 場 (`CelebrationField` は 10 操作の節目でしか鳴らない) の実機描画。

**M4d2 で決めたこと (2026-10-13、当事者合意 — 俯瞰の推奨 3 点「大きさは `land`・α は `fade`」「回転中に輪郭を隠す 1 行は削除」「3 行を 1 PR で」に「3点ともおすすめで」):**

| 問い | 決定 | 正本 |
|---|---|---|
| 合図の曲線 | 大きさは `land` (outExpo、1 → 1.35×)、不透明度は `fade` (outQuad を 1 → 0 に読む = (1 − p)²、0.9 → 0)。**2 本の曲線** (ADR-093 D2) — 旧実装は 1 本の `easeOutCubic` の進行度が大きさと α の両方を運んでいた。いまは小さいうちがいちばん明るく、育ちきる頃には静かになる。reduced では 1.15× / 0.5 の輪郭で静止 (従来どおり) | `SelectPulseMath.selectPulseFrame` |
| 選ばれ続けている輪郭 | 切替 (`visible = sel`) をやめ、**自発光と同じ選択の度合い**を不透明度として読む — 自発光・合図・輪郭が同じ瞬間に着地し、手放しは `fade` で消える。度合いの源は `MeshView._syncEmissive` の `SELECTION_CUE` 1 つ (輪郭のための第二の区間は作らない — §1.1)。隠れた実体は度合いに依らず輪郭を出さない | `MeshView._writeOutline` |
| 回転中に輪郭を隠す 1 行 | **削除**。輪郭が AABB の `BoxHelper` で回転とずれていた時代の回避策で、いまの輪郭は OBB の辺そのもの (`applyPreviewRotation` → `updateGeometry` が毎フレーム作り直す)。しかも `MeshView` の外のもう 1 人の書き手で (原則 #4)、度合いを読む輪郭では次の tick に黙って上書きされ**効かない書き手**になる | `RotationHandler.start` |
| 座標フレームの接続線 | `showConnection(dimmed)` の引数をやめ、線は**フレーム自身の減光の度合い** (`DIM_CUE`) を読む — 軸と同じ `fade` で暗くなる。減光の事実は `applyVisibility` で既に届いており、引数は同じ事実の 2 回目の伝達だった (第二の源) | `CoordinateFrameView._writeConnection` |
| 機械が問う所 (Q3) | `meshView.boxHelper.visible =` の代入が `src/` に **0 個** (書き手は `MeshView._writeOutline` だけ) | `src/SelectionOwnership.test.js` `SELECTION_WRITE_RULES` |

**語彙 (原則 #33):** 語は在った (`land` / `fade`・`SELECTION_CUE`・`DIM_CUE` — M2 / M4a)。足りなかったのは線で、M4a が作った度合いが 3 つの画素 (合図の 2 曲線・輪郭・接続線) にまだ届いていなかった。語は足していない。

**M4d2 で分かったこと (原則 #19):**
- **効かない書き手は、度合いの読み手に変えた瞬間に生まれる。** 回転の開始が輪郭を直接隠す 1 行は、輪郭が真偽値だった間は「最後の書き込み勝ち」でたまたま動いていた。輪郭が `tick(t)` で度合いを読むようになると、同じ 1 行は次のフレームで上書きされ、何もしない行になる — 演出を追従に変える PR は、その画素の**外の書き手を数える**ところまでが仕事 (M4a の `RotationHandler` の残しはこの形だった)。検査を `SELECTION_WRITE_RULES` に 1 行足した。
- **触らなかった輪郭**: `ImportedMeshView` / `MeasureLineView` の選択の輪郭は今も切替のまま。採点表の母集団 (基盤か reduced 境界を参照、または `.opacity =`・色の `lerp`) の外にあるので行を持たない — キューブと見比べると着地の有無が違う。

**実機:** 撮っていない。合図は 0.36 s・輪郭の着地は 0.24 s で、時計を落とさない静止画 1 枚では 2 曲線の差は見えない。証拠は純粋層のテスト (`SelectPulseMath.test.js` — 大きさと α が別の曲線であること・小さいうちが明るいこと・reduced で静止) と配線の読みのみ。**検証できていないこと:** 実機での見え (人の目)、時間軸の動画 (M3b と同じ理由)。

**M4d1 で決めたこと (2026-10-13、当事者合意 — 俯瞰の推奨 2 点「M4d を 4 本に割り、別の ADR が作り直す行は段を持たない」「M4d1 から」に「両方おすすめで」):**

| 問い | 決定 | 正本 |
|---|---|---|
| なぜ M4d1 が先頭か | 残りの B で ✕ を持つのは待機の呼吸だけで、原則 #30 の不採用条件「無統治の動き」に当たる — reduced の境界の外 (2 つ)、N 枚が同位相 (1 つ)、速さがフレーム率 (1 つ)。他の段は色・曲線を揃える仕事で、急がない | `docs/motion/inventory.md` §M4d の割り方 |
| 待機の値の形 | 時計 `t` だけの関数。位相は同一性 (`phaseFor` — ADR-093 D1)、曲線は `loop` (`breathe` = inOutSine の往復)。reduced では範囲の**中央**で静止 — 極値ではなく、平均して見えていた値 (「生きている」の事実は残り、動きだけが消える) | `IdleMotionMath.idleLevel` / `idleBreath` |
| 周期 | 宣言された表 `IDLE_PERIOD`: `breach` 2 s (破れた限界)・`draft` 3 s (手で直している形)・`unresolved` 4 s (まだ決まっていない値)。急ぐものほど短い。どれも待機帯 2〜6 s。M4b の `BREACH_PERIOD` はこの表の 1 行に移した (源は 1 つ) | `IDLE_PERIOD` |
| 同一性 | プレビューの箱 = DSL の `ref`、作図ウィジェット = 要求の `ref`、デモの帯 = `entityRef`、聞き取りの帯 = 唯一の枠の名前 `intake` (0..1 で doc の同一性をまだ持たない — 既定値で埋めず、枠の名前を**宣言**した) | 呼び手 (`ContextController` / `ContextDemoController`) |
| 掴んだリンクの破線 | `+= 0.018`/呼び出しを退役。掴んだ瞬間のループ時計を `SceneService._grabClockStart` に刻み、`dashMarch(t − start)` (速さ 1.08 単位/s = 旧 60 fps の値)。ループの外の呼び出し (キャッシュの補充) が破線を進めていた欠陥も同時に消えた。reduced では破線が止まり、張力の色が「引っ張られている」を言う (reduced の判断は view — 境界の読み手は view に置く) | `dashMarch` / `SpatialLinkView.update(…, grabElapsed, …)` |
| 機械が問う所 (Q3) | 見た目の欄 (`opacity` / `emissiveIntensity` / `dashOffset`) を同じ行の `Math.sin` で揺らす行と、数値リテラルを `+=` する行が、純粋層 (`*Math.js`) の外に **0 個** | `src/MotionIdentity.test.js` §4 |

**語彙 (原則 #33):** 語は在った (`loop`・待機帯・同一性の位相 — M2 / ADR-093 / M4b)。足りなかったのは線で、3 つの view が同じ文「ここは生きている」を 3 つの周期・3 つの境界の扱いで書き直していた。語を 1 つの表にまとめた (`IDLE_PERIOD` — 第二の源を作るのではなく、散っていた源を 1 つにした)。

**M4d1 で分かったこと (原則 #19):**
- **俯瞰の「段を持たない 3 行」のうち 2 行は、もう待つものが無かった。** 俯瞰では `RobotStage` (ADR-164 D5) と Grasp パネル (ADR-164 で縮む) を段なしとしたが、台帳を引くと ADR-164 は既に Accepted で D5 も縮小も PR1 (2026-10-11) で入っていた。採点表の処方の文が「ADR-164 と一緒に」と書いたまま古くなっていた — 処方の文は満期を持たないので、事象 (ADR-164 の実施) の側から読み返されなかった (原則 #32 の形)。2 行はそれぞれ M4d3 / M4d4 へ入れ、本当に待つ `GraspGhostView` だけを DEF-069 (満期 = ADR-158) にした。
- **新しい検査は旧コードの 4 箇所のうち 3 箇所を捕まえた。** 捕まえなかった 1 つ (`ParametricPreviewView` — 値を変数に入れてから代入) は検査の宣言した死角。行単位の検査は形を数えるので、形を変えれば通る — 検査が守るのは「書き直すとき手が自然に `IdleMotionMath` へ向かう」ことまで。

**実機:** 撮っていない。待機の呼吸は周期 3〜4 s・振幅 ±0.04〜0.06 の不透明度で、静止画 1 枚では「位相が散る」も「reduced で中央」も見えない。証拠は純粋層のテストと配線の読みのみ。**検証できていないこと:** 実機での見え (呼吸が速すぎ / 遅すぎないか — 人の目)、時間軸の動画 (M3b と同じ理由)。

**M4c で決めたこと (2026-10-13、当事者合意 — 俯瞰の推奨 3 点「間取りの上面図」「ホバーは舞台の光」「バッジは loop 2 s・位相は同一性から」をすべて採用):**

| 問い | 決定 | 正本 |
|---|---|---|
| カードが何を言うか | 名前と説明文 (思い出させる) に加えて **上面図** (見て分かる)。Zone は光だまりの縁 (M3a の床の光と同じ語)、Solid は足跡、ロボットのベースは舞台の光の点、Anchor は分類色の点。M1 の処方「セルの中でロボットが 1 回動く」は解の形だったので Goal「一目でどんなセルか分かる」まで戻した。ロボットを動かすには運動学と実写メッシュをカードごとに立ち上げることになり、Goal に対して重すぎる | `LayoutPlanMath.layoutPlan` |
| 図の源 | DSL を読み直さず、**クリックで読み込むのと同じコンパイル済みシーン** (`compileLayout`) から導出する。コンベアの駅は戦略 (`linear`) が位置を決めるので、DSL には位置が無い。図は AppController が一度だけ導出して store (`launchHomePlans`) へ置き、カードは描くだけ (ADR-062 Phase 5 の TemplateGallery の前例)。コンパイルは純粋層 (`layoutPlanOf`) の中で行う — AppController がコンパイルする形は ADR-162 が退役させた | `layoutPlanOf` / `AppController._layoutPlans` |
| 種と基数 | 種ごとの役割表 (`PLAN_ROLE_BY_TYPE`) は未宣言の種で throw (原則 #31)。枠はロボットのベースだけを描き、判定は `isRobotBaseFrame` を呼ぶ (同一性の述語は 1 箇所)。描く物が 0 個なら `null` (空の枠は描かない)。Empty のカードは「図なし」を宣言する。親の鎖が切れた枠は推測の位置に描かない | `PLAN_ROLE_BY_TYPE` |
| 大きさ | 枠 120 × 64 に一様に収める — mm のセルと m のセルが同じ図になる (M4b の教訓、原則 #27) | `PLAN_FRAME` |
| 振付 | カードは読み順にスタッガー (`itemEnterMotion` — 目は左上から入る、それが「触った点」の代わり)。図は**光の落ちる所** (ロボットのベース、無ければセルの中央) から外へ、カードの着地の後に `fade` で点く (広がり 160 ms) | `planLightDelay` / `itemEnterDelay` |
| 指したカード | **舞台の光**が当たる: 枠が `stageLight` に、外側に淡い光、図の光だまりが強まる (色と光 = `fade`、浮き = `land` + spring — `tierAMotion`)。強調色 `accent` は「操作の対象」なので使わない (まだ何も選ばれていない)。旧ホバーの青 `#3a7bd5` と名前の青 `#7fb2ff` は退役 | `HomeScreen` |
| 待機 | カードの光だまりは舞台と**同じ呼吸** (`STAGE.breath` の周期・深さ)、位相はテンプレの id から (N 枚が揃わない — G5) | `poolBreathTiming` |
| 暗幕 | 手書きの rgba を退役し、舞台の地 (`BACKDROP` — 中心の位置と 2 色) を半透明にしたもの。起動の部屋と同じ部屋に立つ | `HomeScreen` |
| デモのバッジ | `ease-in-out infinite` 1.2 s・全部同位相 → **注意の呼吸** `attentionBreath`: リンクの違反と同じ `BREACH_PERIOD` 2 s・`loop`、位相は印の同一性 (衝突の ref・変数・属性)。`pulse` は真偽値から**同一性の名前**に変えた — 呼び手が名前を渡さなければ呼吸しない (位相の源を省けない形) | `ChromeMath.attentionBreath` |
| ツアーのカード | 直さない (A)。入場は既に `enterMotion` (`land`)、色はトークン、事実 (`factTone`) と操作中の段 (`accent`) の塗り分けも宣言済み | — |

**語彙 (原則 #33):** 「カードを見ればどんなセルか分かる」が言えなかった — カードの語は名前と説明文だけで、語が実物のどこを指すかを見る手段が無かった (検査 4) ので、**上面図**を足した。光・呼吸・スタッガー・位相の語は M2〜M4b で在ったので足していない (線をつないだだけ)。

**M4c で分かったこと (原則 #19):**
- **入場の fill が浮きを消していた (既存の潜在的な不具合)。** `itemEnterMotion` は `both` で最後のキーフレーム (`transform: none`) を入場の後も持ち続け、要素自身の inline の `transform` に勝つ。メニューの項目は浮かないので見えなかったが、カードに使うとホバーの浮きが一度も動かない。1 つの欄に書き手が 2 人 (原則 #4 — アニメーションの fill も書き手)。遅延の間 opacity 0 を持てれば足りるので `backwards` にし、`ChromeMath.test.js` が forwards / both でないことを問う。
- **退役の検査が、プレビューの形で戻りかけた退役形を止めた。** 初版では AppController が `layoutPlan(compileLayout(dsl))` を呼び、ADR-162 の `Retires:` の GREP (`AppController.js::compileLayout(dsl)`) が `pnpm test:adr` で落ちた。プレビューは読み込みではないが、コントローラにコンパイルさせない理由 (DSL を捨てる読み込み口を作らない) はそのまま当てはまる。GREP を避ける改名ではなく、コンパイルを純粋層 `layoutPlanOf` に移して答えた。

**実機:** dev サーバの実機 (本物の時計) で刷新前後とホバーを撮った — `docs/motion/media/m4c-home-before-after.png`。CSS アニメーションの時計を 0.08 倍に落として (CDP `Animation.setPlaybackRate`) 入場の中間フレームを撮った — `docs/motion/media/m4c-home-light-on-slowed-clock.png` (ロボットの近くの物から点き、コンベアの両端・パレットの箱・工場セルの縁が後から点く)。**検証できていないこと:** デモのバッジの呼吸の実機撮影 (純粋層のテストと 5 つの呼び手の読みのみ)、時間軸の動画 (M3b と同じ理由)、図が当事者に「そのセルに見える」か (人の目 — 静止画を見て判断してほしい)。

**M4b で決めたこと (2026-10-12、当事者合意 — 俯瞰の推奨 3 点「波紋を割る」「色はトークンへ」「呼吸は `loop` 2 s」に「3点ともおすすめで」):**

| 問い | 決定 | 正本 |
|---|---|---|
| 1 語 2 事実 | `RippleEffect` は「リンクが結ばれた」と「ここに物が現れた」(デモの承認・段階的な種明かし) を兼ねていた。**割った**: 成立は新設の `LinkBindEffect`、`RippleEffect` は「ここに現れた」だけを言い、大きさ `land`・α `fade` に直した (曲線だけ — 形は M4d) | `LinkBindEffect` / `rippleFrame` |
| 成立の形 | 光が 2 端から中点へ `land` で走る (`BIND_TRAVEL` = `SELECT_LAND` 0.24 s — 選択と同じ tempo)。**1 つの進捗が両端を運ぶので、出会いは構成上同時**。出会いが境目 (G3): 閃光が `land` で広がり、閃光と線に沿った余韻が `fade` で消える (`BIND_AFTERGLOW` 0.3 s)。色は種の色を舞台の光で照らした色 (`lightTint` — M3a と同じ 1 つの光)。reduced は出会いの点と線を静止した光で同じ時間だけ示す | `LinkMotionMath.bindFrame` |
| 線の書き手 | setter (`setHighlighted` / `setViolated`) は目標だけを記録し、`update(…, t)` → `_applyLook` が色・不透明度・破線・矢印の唯一の書き手。旧 `triggerFlash` (線形の `1 − 2t`) は退役 — 線の画素を 2 人が書いていた。最初の時計つき update より前は目標で静止 | `SpatialLinkView._applyLook` |
| 追従 | 強調は `SELECTION_CUE` (着地 `land`・手放し `fade`)、違反は `VIOLATION_CUE` (即時 + 余韻 0.3 s)。**張力と深刻度は距離なので時間で追わない** (M4a の接近の色と同じ判断) | `CueFollowMath` (共有) |
| 時計 | 描画ループの `t` を `SceneService._updateWorldPoses(t)` が `_linkClock` に写す。ループ外の呼び出し (pose cache の補充) は最後の時計を再利用する — 区間を打ち直さない。線は `Date.now()` / `performance.now()` を読まない (テストが問う) | `SceneService._linkClock` |
| 違反の呼吸 | `loop` (sin² = inOutSine の往復 = `breathe`)、周期 2 s (待機帯 2〜6 s の中。旧 ≈ 0.8 s は警報に近かった)。位相は `phaseFor(link.id)` (ADR-093 D1)。reduced と壊れた時計では呼吸が止まり違反色で静止 | `breachPulse` |
| 色 | トークン外の 5 色を宣言された語へ: 張力・深刻度の中間 = `cautionTone`、違反 = `dangerTone`、呼吸の明るい側 = `dangerTone` を舞台の光で 50% 照らした色、未知の種 = `entityDefault` | `LINK_TONES` |
| 大きさ | 玉の半径は**リンクのスパンから**導出 (`bindRadius` = スパン × 0.05) | `bindRadius` |

**語彙 (原則 #33):** 「結ばれたことを光で言う」が言えなかった — `RippleEffect` が 2 つの事実を運んでいた (1 語 1 事実の違反) ので割った。強調・違反の追従、同一性からの位相、光の色は M4a・ADR-093・M2 の語が既に在ったので、**語は足していない** (線をつないだだけ)。

**M4b で分かったこと (原則 #19):**
- **旧波紋は既定のシーンで一度も見えていなかった。** 実機で時計を落として撮ったところ、玉も閃光も写らなかった。既定のシーンは mm (カメラは約 780 先) で、半径の固定値 0.15 は 0.15 mm。リンクの成立の儀式は出荷以来、見える単位のシーンでしか見えていなかった。world の固定値だけで寸法を決めた形 (原則 #27 の鏡像の片方)。玉の大きさをリンクのスパンから導出し、テストが「mm のシーンと m のシーンで同じ比」を問う。デモ側の `RippleEffect` は呼び手が実体の寸法から半径を渡しているので影響は無い。
- **旧実装は違反が解けても不透明度が残っていた。** 違反の分岐は不透明度を書くが、解けたときに戻す書き手は `setHighlighted` だけだった (呼ばれるまで 0.8 のまま)。毎フレーム全ての欄を純粋関数から書く形にしたので、この種の取り残しは構造上起きない。

**実機:** 時計を 1/12 に落とした実機 (本物の時計) で、L キーからリンクを結び、2 つの玉が走って出会い、閃光が広がって消え、余韻の線が破線へ戻るまでを撮った — `docs/motion/media/m4b-link-bind-slowed-clock.png`。**検証できていないこと:** 違反の呼吸・強調の追従・張力の色の実機撮影 (純粋層のテストと配線の読みのみ — 違反を作るテンプレの手順を持っていない)、時間軸の動画 (M3b と同じ理由)。**残し**: 掴んでいる間の破線の行進 (`_dashTimer += 0.018`/フレーム) はフレーム率に依存したまま (動きの意味は張力の色が運ぶ) — M4d で時計へ。

**M4a で決めたこと (2026-10-12、当事者合意 — 俯瞰の推奨 2 点「M4 を 4a→4b→4c→4d に割る」「接近の色は snapTone」に「両方おすすめで」):**

| 問い | 決定 | 正本 |
|---|---|---|
| 追従の源 | M3b の選択の区間 (`retargetSelection` / `selectionLevel`) を**移して一般化**する。複製しない — `MapVisualMath` は同名の adapter を残し、マップ注釈の選択の振る舞いは不変 (両脚 `land` のまま) | `CueFollowMath` (`retargetCue` / `cueLevel` / `settledCue` / `blendLayers`) |
| 曲線と時間 | 到着は入力への応答なので `land` (outExpo)、手放しは `fade` (outQuad)。ホバー到着 0.15 s (DOM の `DURATION.hover` と同じ tempo)、選択到着 0.24 s (マップ注釈と同じ `SELECT_LAND` — 1 つの事実)、手放し 0.2 s、違反は**即時** (Tier F — 事実はイーズインしない) で余韻 0.3 s、減光は `fade` 両方向。すべて応答帯 ≤ 300 ms。3D の `fade` 曲線 `easeOutQuad` を `MotionMath` に足した | `HOVER_CUE` / `SELECTION_CUE` / `VIOLATION_CUE` / `DIM_CUE` |
| 優先順位 | 違反 > 選択 > ホバーの合成は残し、その上に度合いを乗せる (層の合成 — 満ちれば強い方が勝つ、間は連続) | `blendLayers`、`MeshView._syncEmissive(t)` |
| 書き手 | setter は目標 (真偽値) を記録するだけ、画面は `tick(t)` だけが書く。AppController の描画ループが Solid / Profile / 座標フレームを毎フレーム tick する (母集団は `_scene.objects` のまま — 増えた義務は 1 行ずつ) | `MeshView.tick` / `CoordinateFrameView.tick` / `RegionGhostView.tick` |
| 最初の状態 | 画面に現れる瞬間・最初の tick より前の設定は**着地済み**で始める (開いた瞬間に暗転を演じない) | `settledCue` |
| 接近の色 | `#F59E0B` (トークン外の 4 色目) → `snapTone` (噛んだ瞬間の `SnapFlash` と同じ色)。近づく → 噛む が 1 色の物語になる。接近は距離で決まるので時間の追従はかけない (かけると手より遅れる) | `MeshView.setApproachWarmth` |

**語彙 (原則 #33):** 「ホバーした箱は短く温まり、離れたら少し遅れて冷める」が言えなかった — `_hovered` / `_selected` が「目標」と「画面の値」を兼ねていた (1 語 1 事実の違反)。語は**足していない**: M3b で起こした区間がその語で、置き場所を共有モジュールに移しただけ。「近づく → 噛む」は色の語 `snapTone` が既に在ったので、線をつないだだけ。

**M4a で分かったこと (原則 #19):**
- **書き手を tick に移すと、settled の書き込みが目標の変化を飲み込む。** 座標フレームの初版は `applyVisibility` の中で「今の値を書く」ために時計なしで区間を作り直しており、壊れた時計は着地を意味するので、減光は毎回一瞬で終わっていた (追従が書かれているのに一度も動かない)。setter では**目標だけ**を書き、区間を作り直すのは tick だけにした — 例外は画面に現れる瞬間 (着地済みで始めるのが正しい)。
- **毎フレーム書く値に `needsUpdate` を付けると、毎フレームシェーダを作り直す。** 座標フレームの `_applyXray` は呼ばれる頻度が低い前提で常に `needsUpdate = true` を立てていた。追従で毎フレーム呼ばれるようになったので、program が変わる (transparent / depthTest が切り替わる) ときだけ立てる。

**実機:** 時計を 1/12 に落とした実機 (本物の時計) で、選択の解除 (fade)・ホバー (land)・選択 (land — `SelectPulse` と同じ瞬間) の中間フレームを撮った — `docs/motion/media/m4a-cube-cues-slowed-clock.png` (面の平均色が 122 → 116 → 103 → 98 → 97 と数フレームかけて下がる)。**検証できていないこと:** 座標フレームの減光・領域ゴーストの絞り込み・グラブの接近の色の実機撮影 (純粋層のテストと配線の読みのみ)、時間軸の動画 (M3b で仮想時間の録画の時計が単調でないと分かっている)。**残し**: キューブの選択の輪郭 `boxHelper` は切替のまま (書き手が `RotationHandler` にもあり、`SelectPulse` の行と一緒に M4d)。座標フレームの親子の接続線は呼び手が値を渡す別の書き手なので切替のまま (M4d)。

**M3b で決めたこと (2026-10-12、当事者合意 — 俯瞰の推奨 3 点に「はい、お願いします」):**

| 問い | 決定 | 正本 |
|---|---|---|
| 1 欄 2 事実 | `visible` を割る: 論理 **`present`** (view の `visible` getter — hit-test・数え上げが読む) と描画 **drawn** (相から導出、`_setDrawn` が唯一の書き手) | `MapVisualMath` `PHASE_TRAITS` (相ごとに宣言、未宣言で throw) |
| ライフサイクル | `entering` / `idle` / **`exiting`** / `hidden` の 4 相。純粋 reducer (`lifecycleShow` / `lifecycleHide` / `lifecycleStamp` / `lifecyclePhase`) が唯一の書き手で view は保持するだけ。表示中への再 show は再入場しない。一度も描かれていない注釈の hide は即 `hidden` | STATE_TRANSITIONS §Map annotation motion |
| 退場の形 | 光が消える: `exit` 曲線 (inCubic) で opacity 1→0、scale 1→0.85、`EXIT_FADE` 0.22 s。名札は即座に消す。削除のボクセル dissolve (ADR-065) はそのまま重ねる — dissolve は**出来事**、光の消灯は**物の退場**を言う (dissolve の見直しは M4) | `lifecycleEnvelope` |
| 退場中の undo | 入場をやり直す (逆再生しない — 相が 1 本で済む) | `lifecycleShow` |
| 誰が退場を tick するか | AppController の `_exitingAnnotations`。`objectRemoved` で入れ (原則 #32)、`objectAdded` と drawn=false で出す。MotionGovernor には預けない (予算で間引かれると描かれたまま凍る) | `AppController` |
| 選択の見せ方 | BoxHelper を退役。光の強さ ×1.4 + 床の光の大きさ ×1.15 + 線幅を、`land` (outExpo) `SELECT_LAND` 0.24 s で動く度合い `selectionLevel` が運ぶ。区間は「変化の時点の度合い・時刻・目標」の写し — 途中反転は画面上の光から続く、同じ要求 2 回で再開しない。名札は `setHighlighted` (書き手は `setObjectSelected` 1 つ)。`updateBoxHelper()` は no-op で残す (原則 #17 — コマンドが全 view に呼ぶ) | `retargetSelection` / `selectionLevel` / `selectedEmphasis` |
| 置く前 | カーソルは事実色の芯 + 床の光だまり (Hub の halo と同じ白スプライトを `lightTint` で着色・加算)、線とスナップの輪は `lightTint`。曲線 `MapPreviewMath` は不変 | `PlaceToolController._updatePreview` |

**語彙 (原則 #33):** 「消した注釈は光が消えるように退場し、その間はもう選べない」が言えなかった — `visible` が
「ユーザーにとって在る」と「描かれている」を兼ねていた (1 語 1 事実の違反) ので、`present` と drawn に割った。
「選択の途中」を言う語も無かった (`selected` は真偽値) ので、度合い `selectionLevel` を起こした。光の語
(`lightTint` / `STAGE_LIGHT`) は M2/M3a で在ったので、置く前のプレビューは線をつないだだけ。

**M3b で分かったこと (原則 #19):**
- **退場は放っておくと再生されなかった。** 描画ループは `_scene.objects` だけを歩き、soft delete は
  `detachObject` で実体をそこから外す。相を足しただけでは退場中の view は誰にも tick されず、光が凍る。
  2 欄に割る設計の段階で、tick の**母集団**が変わることを数えて見つけた (原則 #31 の形 — 外された物は
  *在るもの*を辿るループに現れない)。
- **名札の強調は位置を消していた (既存の不具合)。** `EntityLabel.setHighlighted` が `transform: scale(1.18)` を
  直接書き、位置を運ぶ `translate3d` を上書きしていた。カメラが静止していると dead-zone filter が位置を
  書き直さないので、強調した名札は画面の隅に張り付く (minimap のホバー連動で CF の名札に潜在していた)。
  1 つの style 欄に 2 人の書き手 (原則 #4)。`_writeTransform()` を唯一の書き手にし、
  `src/view/EntityLabel.test.js` が「強調しても位置が残る・静止カメラでも残る」を問う。
- **仮想時間の録画では 220 ms の退場が撮れなかった。** screencast (ADR-160) で刷新前後を撮ったところ、刷新後の
  動画で注釈が退場なしに消えた。調べると Playwright の偽の時計の下で、描画ループが view に渡す `t` が単調でなく
  (8.036 → 7.91 → 7.84 … 8.054 → 7.92 → 8.164)、±0.2 s 跳ねていた — 退場そのものと同じ長さなので、相が丸ごと
  飛ばされる。2 つのことをした: (1) 時計が刻印より**戻った**ら退場の始まりとして扱う (`lifecyclePhase` は
  `e < 0` を「終わった」と読んでいた — 本番の `performance.now` は単調なので到達しないが、時計の後退で退場が
  消えるのは誤り。テスト「a clock that steps backward does not skip the exit」)。(2) 退場を飛ばした動画は
  **嘘の画面になるので commit しない**。証拠は実機 (本物の時計) を 1/12 に落とした静止画
  `docs/motion/media/m3b-exit-slowed-clock.png` と、選択・削除・undo の静止画 `m3b-select-delete-undo.png`。
  `t` が 2 系列に交互に並ぶ形は、偽の時計の下で描画ループが 2 本走っている可能性を示すが、**確かめていない**
  (dev の StrictMode 二重マウントか、偽の rAF の挙動か)。録画の道具側の課題として残す。
- **GSN の満期の名前は実装で変わった。** 起票時に満期を `GREP:…::exitFrame` と書いたが、退場だけでなく入場も
  運ぶ包絡なので `lifecycleEnvelope` になった。満期の GREP ではなく goal の昇格 (support-verified) で決着させ、
  `check-gsn-debt.mjs` の baseline を 51 → 50 に下げた。

**検証できていないこと:** Route / Boundary の見た目 (M3a と同じく、テンプレに実例が無い)。退場の中間フレームは
実機で時計を 1/12 に落として静止画で確認した。M3 全体の動画 (M3a で約束した) は仮想時間の録画が退場を飛ばすため未取得 — シナリオ `tools/screencast/scenarios/m3-map-annotations.screencast.json` は残し、道具が単調な時計を保証できたら撮る。

**M3a で決めたこと (2026-10-12、当事者合意 — 「M3a からおすすめで」):**

| 問い | 決定 | 正本 |
|---|---|---|
| 床の光の形 | **2 つの形を視角で受け渡す**。床に寝る**縁の光** (縁で明るく内へ消える — 光だまりの縁が境界) と、縁に立つ**光の幕** (床で明るく上へ消える)。真上からは床が、斜めからは幕が読みを運び、`floor + curtain ≥ 1` がどの角度でも成り立つ | `FloorLightGeometry.edgeBand / lightCurtain`、`MapVisualMath.floorLightGains` |
| 見る角度 | `viewElevation = abs(forward·Z)` (真上 1、床すれすれ 0)。AppController が毎フレーム 1 回、描いたばかりの world 行列から読む (割り当て 0) | `MapVisualMath.viewElevation` |
| 強さ | 面積ではなく**役割**。Zone = `ground` (いちばん静か)、他は `mark`。選択 ×1.4、違反は絶対値 1.6 で全役割の上 (Tier F は Tier A に勝つ)。未宣言の種は throw | `EMPHASIS_BY_PLACE_TYPE` / `emphasisFor` |
| 光の色 | 分類色 (事実) を舞台の光へ 30% 寄せる。色相は分類なので支配的チャネルを変えない (テストが種ごとに問う) | `lightTint` (← `StageMath.STAGE_LIGHT`) |
| Boundary | 垂直ハッチ tick を退役し、壁に立つ光の幕へ。ADR-093 D4 の crest (壁を伝う光) は幕の上で継承 | `boundaryLightFrame` (旧 `boundaryTickFrame`) |
| Anchor | 目盛りと 45° datum square を退役。十字の芯と hold-and-kick は残し、床の光は Hub より**絞った硬いスポット** | `AnnotatedPointView` |
| 名札 | 3 つの手書き div を EntityLabel に。アクセントは分類色 | `EntityLabel` |

**語彙 (原則 #33):** 「Zone は地、印は前、違反は最前面」を言う語が無く、強さが Zone の fill 帯・halo の base・rim の peak の
数値に散っていた → **強さの段** (`ground` / `mark`) と修飾子 (`selected` / `urgent`) を 1 つの表にした。
「見る角度」は入力として存在しなかった → `viewElevation` を起こした。光の語は M2 の `STAGE_LIGHT` が既に在ったので足していない。

**M3a で分かったこと (原則 #19):** 役割の表を書いた初回のテストが、`selected` の mark (1.0 × 1.4 = 1.4) が `urgent` (1.35) を
上回ることを出した — 「違反は最前面」を散文で決めても、乗算の修飾子と絶対値の修飾子が交差する所で破れる。
「違反は選択された最も明るい印より明るい」を全種の直積で問う形にして、urgent を 1.6 に上げた。
既存の不具合も 1 つ消えた: `setContainsViolated` が `LineMaterial.color` に数値を代入していた (Color を置き換えて
しまう) — 色の書き手を各 view の `_applyColors()` 1 つに集めたことで、違反・分類変更・解除の 3 経路が同じ書き方になった (原則 #4)。
**検証できていないこと:** Route と Boundary の見た目はテンプレに実例が無く、実機の撮影をしていない (純粋層のテストのみ)。

**M1 で分かったこと (起票時の見込みからの追記 — 原則 #19):** 母集団は起票時に書いた「約 33 ファイル」ではなく **53**。
起票時はモーション基盤を import するファイルだけを数えていたが、reduced-motion の境界 (`useReducedMotion`) を
読む React 部品が 20 本あった。採点では B の 11 行のうち 4 行が「背景を替えたら光と色を揃える」で終わり、
M2 (背景の選び直し) がいちばん効く 1 手であることが表からも支持された。M4 の最初の候補は、線形の補間が
残っている唯一の行 (リンクの波紋) と、第一印象の起動ホーム。

**M1 の母集団の追補 (2026-10-12 — 原則 #31):** 当事者が「キューブのホバー・選択の切り替え、グラブ中のスナップ先への
近づき」の見直しを求めたとき、それを描く `MeshView` は表に無かった。母集団を「モーション基盤を参照するもの」で
定義したため、**基盤を通らずに動く最も古い層が定義上入らなかった**。2 本目の信号 (見た目の値 — `opacity`・色の補間 —
を書き換えるもの) を足して 53 → 62 ファイルにし、`MeshView` (C) と `SpatialLinkView` (C — 違反の脈動が N 本同位相、
reduced 境界の外) を含む 9 本を採点した。どちらも M4 の最初の候補に加える。

**M2 で決めたこと (2026-10-12、当事者合意 — 「提案通りで良い」):**

| 軸 | 決定 |
|---|---|
| アトモスフィア | **Studio 型の作業セル**。フォグ・ダストを退役。背景は作業のある所が明るい放射グラデ、床に舞台の光の光だまり (6 秒周期の浅い呼吸)、同じ光をリムに。光は起動フライトの着地で入る (`lightOn` は `DURATION.bootReveal` から導出)。グリッドは事実なので残し、光の外で床に溶ける (`GRID_FADE` — フォグが隠していた端を自分で畳む) |
| イージング族 | 役割で引く `EASING.land / fade / exit / loop / spring`。CSS 既定の `ease` 系は語彙から外し、基盤の外に残る 16 箇所は ratchet で数える (M4d4 で 0 になり禁止へ) |
| 時間スケール | きびきび (応答 ≤ 300ms、マクロは起動の 1 回、待機 2〜6s) — 既存の `DURATION` は帯の中にあったので値は変えない |
| 振付パターン | 位相は同一性から (ADR-093 D1)、スタッガーは触った点からの距離順 |
| 3色システム | 地 = グラファイト紺 (`backdropCenter` / `backdropEdge` / `grid*`)、強調 = `accent` の 1 色、光 = `stageLight` |

**語彙 (原則 #33):** 「床の光は背景と同じ光源」を言える語が無かった (光は `stageGlow`・リム・床のグローに散っていた)。
**舞台の光** (`StageMath.STAGE_LIGHT`) を 1 語として起こし、`COLOR.stageLight` を読むのは StageMath だけであることを
`StageMath.test.js` が数える — M3 の床の光はここを読む。`stageGlow` は光であってグローではないので改名した。
`backdropTop / Mid / Deep` は縦グラデの語だったので、放射グラデの `backdropCenter / Edge` へ割り直した。

**M2 で分かったこと (原則 #19):** フォグは雰囲気であると同時に、グリッドの遠い端を隠す**機能**を持っていた。
フォグだけを消すとグリッドの端が地平線まで鋭く走る (刷新後の初回撮影で発見)。機能の側を名指しして
グリッド自身のフェードに移した — 装置を退役させるときは、その装置が黙って担っていた機能を数える。
**残し:** 実体ごとの接地影 (Studio 型の定石) は実体の view に触るので M4 へ。

## Consequences — Evidence と tradeoff (§1.2 Evidence)

### 得られるもの

- 演出の方向が CLAUDE.md の 1 か所に固定され、次の演出はそれに従う (置いていかれる原因が消える)。
- マップ注釈が実写の空間で読め、透視でも正射でも同じ意味で読める。
- 名札の仕組みが 1 つになる。

### 払うもの

- ADR-093 D3 の装置 (ハッチ・コーナーマーク) を捨てる。
- 背景を変えると、既存の演出すべての見え方が変わる (M4 の範囲が広がりうる)。
- 「今の Claude の能力」は時間とともに動く物差しで、M1 の採点は日付つきでしか言えない。

### 検証 (証拠)

論証木: `docs/gsn/adr-166-motion-is-renewed-to-the-current-standard.gsn`
(goal ごとの支えの正本。起票時点ですべて support-exploring、満期は機械可読)。

### 波及 (blast radius)

| 触るもの | 中身 |
|---|---|
| `src/view/Annotated*View.js` / `MapVisualMath.js` / `FloorLightGeometry.js` (新設) / `AppController` (視角を渡す) | M3a — 床の光、角度の入力、役割の強さ、名札の統一 (**実施**)。`DecalTextures.hatchTexture` は `GraspDeclarationView` が使うので残した |
| `src/view/SceneStage.js` / `StageMath.js` / `SceneView.js` (グリッドのフェード) / `src/theme/tokens.js` (地の色・舞台の光・`EASING`) | M2 — 背景のアトモスフィアと曲線の語彙 (**実施**) |
| `CLAUDE.md` | M2 — モーション・アイデンティティ節 |
| `.claude/skills/animation-fx/` | M1〜M4 で得た再利用できる知見の書き戻し |
| `docs/STATE_LEDGER.md` | 「Map 注釈ビュー (motion)」行 — 基数 `0..N` の位相の扱いは継承、角度の入力を追記 (M3 の PR)。M3b で 4 相と 2 欄・退場中の母集団を追記 |
| `src/view/Annotated*View.js` / `MapVisualMath.js` / `EntityLabel.js` / `AppController` (`_exitingAnnotations`) / `PlaceToolController` | M3b — ライフサイクル 4 相と 2 欄、選択の着地、BoxHelper の退役、名札の強調が位置を消す不具合の修正、置く前のプレビューの光 (**実施**)。hit-test のロジックは触っていない (退場中の注釈はモデルの外にいて、`visible` は `present` を返す) |

| `src/view/CueFollowMath.js` (新設) / `MotionMath.js` (`easeOutQuad`) / `MapVisualMath.js` (adapter) / `MeshView.js` / `CoordinateFrameView.js` / `RegionGhostView.js` / `AppController` (tick を 2 行) | M4a — 状態の手掛かりの追従、接近の色 (**実施**)。当たり判定・選択の書き手 (`SelectionManager`)・接近の強さの計算 (`computeApproachWarmth`)・`SnapFlash` の曲線は触っていない |
| `src/view/LinkMotionMath.js` / `LinkBindEffect.js` (新設) / `SpatialLinkView.js` / `RippleEffect.js` / `LinkCreationHandler` / `SceneService` (`_linkClock`、`id` を渡す) / `AppController` (`_updateWorldPoses(t)`) | M4b — リンクの成立・強調・違反 (**実施**)。違反の判定 (`_evaluateClearanceLinks`)・リンクの作成と undo・LINK NETWORK パネル・デモの呼び手 (`ContextDemoController`) は触っていない |
| `src/view/LayoutPlanMath.js` (新設) / `src/components/Home/HomeScreen.jsx` / `ChromeMath.js` (`attentionBreath` / `itemEnterDelay`、入場の fill を `backwards`) / `ContextInspector` の `Badge` と 4 つの呼び手 / `uiStore` (`launchHomePlans`) / `AppController` (`_layoutPlans`) | M4c — 起動ホームの上面図・光・スタッガー、デモのバッジの呼吸 (**実施**)。stage の取得 (`claimStage` / `releaseStage`)・テンプレの読み込み経路 (`docFromLayout` → `loadContext`)・カタログ・ツアーの進行・BootReveal は触っていない |
| `src/view/OutlinerView.js` (削除) / `NodeEditorView.js` (`_flashedAt`・`_flashNode`・レイヤ切替) / `FeedbackMath.js` (`flashStyle` の曲線・`updateFlash`) / `ChromeMath.js` (`drawerMotion`・`barMotion`・`eaLightOff`) / `HeaderMenus.jsx` / `Outliner.jsx` / `NPanel.jsx` / `GraspSearchPanel.jsx` / `ChecksPanel.jsx` / `ImportProgress.jsx` / `IntakePanel.jsx` / `ToolbarButton.jsx` / `ParametricAssetPanel.jsx` / `EntityLabel.js` / `MotionIdentity.test.js` (ratchet → 禁止) | M4d4 — DOM の開閉と既定曲線の禁止 (**実施**)。メニューの開閉の状態 (`OverflowMenuState`)・選択の書き手 (`SelectionManager`)・ノードエディタのグラフの導出と編集・引き出しの開閉の書き手 (`uiStore`)・下端の占有 (`EdgeOccupancy`) は触っていない |
| `src/view/RobotRevealMath.js` / `GroundShadowMath.js` / `GroundShadow.js` (新設) / `RobotStage.js` (`tick`・`_writeLook`・光・影) / `RobotStageSet.js` (`tick`・`id` を渡す・e2e の読み出し) / `MeshView.js` (`_writeShadow`) / `AppController` (tick を 1 行、`robotAppearance()` に 2 欄) | M4d3b — 読み込み中の光、腕の着地、接地影 (**実施**)。読み込みの寿命 (`setRenderStyle` の token・`_pendingStyle`・失敗の経路)・関節と preview の決定・`RobotMeshLoadingNotice`・舞台の光 (`StageMath`)・`ImportedMeshView` は触っていない |
| `CommandFeedbackMath.js` (`flash`・`sparkScale`・`fade` の減衰) / `LandingEffects.js` / `SnapFeedbackMath.js` / `SnapFlash.js` / `CelebrationMath.js` (`flash`・`particleProgress`) / `CelebrationField.js` (インスタンスごとの色) / `Celebration.jsx` / `RegionAuthoringWidget.js` / `UncertaintyGhostView.js` / `ParametricPreviewView.js` / `RegionGhostMath.js` (`GAP_COLOR`) | M4d3a — 光と曲線 (**実施**)。演出を出す条件 (`lifecycleDescriptor` のラベル表・`snapTransition`・`pickCelebration`)・`MotionGovernor` の予算・`BootReveal` / `StageMath`・`RobotStage`・`MeshView` は触っていない |
| `src/view/SelectPulseMath.js` (新設) / `SelectPulse.js` / `MeshView.js` (輪郭) / `RotationHandler` (1 行の削除) / `CoordinateFrameView.js` (接続線) / `SceneService` (`showConnection()` の引数) | M4d2 — 選択の合図の 2 曲線、輪郭の着地、接続線の減光 (**実施**)。選択の書き手 (`SelectionManager` の書き込み順・`reassertHighlight`)・合図を出す条件 (主選択の Solid に入った瞬間だけ)・`ImportedMeshView` / `MeasureLineView` の輪郭は触っていない |
| `src/view/IdleMotionMath.js` (新設) / `LinkMotionMath.js` (`breachPulse` を表の 1 行へ) / `ParametricPreviewView.js` / `RegionAuthoringWidget.js` / `UncertaintyGhostView.js` / `SpatialLinkView.js` (`grabElapsed`) / `SceneService` (`_grabClockStart`) / `ContextController`・`ContextDemoController` (`id` を渡す) | M4d1 — 待機の呼吸の統治 (**実施**)。帯の収束の曲線 (`collapsing` / `fading`)・`RegionResolveEffect`・張力の計算・プレビューと作図の色 (G4 は M4d3)・配置の確定の経路は触っていない |

**触らない:** 契約、`core/`、注釈の意味 (place type の分類と違反アラーム — ADR-043)。

## Lens notes

- 原則 #30: 床の光は注釈の分類を読ませる Tier A (Affordance) のまま。演出を足しても Fact を上塗りしない。
  reduced motion の読み取り境界は `src/theme/motion.js` の 1 か所を継承。
- 原則 #31: N 個の注釈が同位相で動く lockstep を構造で消した ADR-093 D1 を継承する。棚卸し (M1) の
  母集団は import から導出し、手書きの一覧にしない。
- 原則 #27: 床の光の寸法は「画面 px 目標 + world 上限」の対で決める (mm スケールのセルでも 100 m の
  site plan でも同じ見え)。
