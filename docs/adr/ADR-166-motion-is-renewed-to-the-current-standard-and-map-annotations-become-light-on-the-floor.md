# 166. 演出を今の水準へ作り直す — マップ注釈は床に当たった光にする

- Status: Proposed
- Date: 2026-10-11
- Deciders: yuubae215, Claude
- 段: 本 ADR の M1〜M4 (下の §段)。IA 再設計の順序表には載せない (画面の住所を変えないため)
- Retires: なし — 宣言していた `GREP:src/view/AnnotatedRegionView.js::The\sBlueprint\sdevice` (製図台の装置 = 対角ハッチ・コーナー登録マーク) は M3a (2026-10-12) で退役済み。本 ADR は M4 (M4c・M4d) が残るので Proposed のまま (M3b・M4a・M4b は 2026-10-12 に実施) — Proposed の Retires は「在らねばならない」と問われるため、満期の来た行をここで閉じる
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
| **M4 残りの演出** | M1 の採点が低い順に作り直す。4 本に割った (当事者合意 2026-10-12): **M4a 状態の手掛かりの追従** (キューブのホバー・選択・違反・接近、座標フレームの減光、領域ゴーストの絞り込み — **実施 2026-10-12**) → **M4b リンク** (波紋 + リンク線を一体で — **実施 2026-10-12**) → **M4c 起動ホーム** → **M4d B の残り** | M1 の表の全行が「今の水準」になるか、残す理由が書かれている。**M4a の結果**: 下の「M4a で決めたこと」、3 行が A へ (`docs/motion/inventory.md`)。**M4b の結果**: 下の「M4b で決めたこと」、C の 2 行を 1 行に束ねて A へ |

M3 は M2 の後に置く — 床の光は M2 で決める背景の光源を共有するので、先に作ると光源が 2 つになる (§1.1)。
M3 は 2 本に割った (当事者合意 2026-10-12): `exiting` の状態追加と見た目の刷新が同じ差分に混ざるとレビューできないため。

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
| イージング族 | 役割で引く `EASING.land / fade / exit / loop / spring`。CSS 既定の `ease` 系は語彙から外し、基盤の外に残る 16 箇所は ratchet で数える |
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

**触らない:** 契約、`core/`、注釈の意味 (place type の分類と違反アラーム — ADR-043)。

## Lens notes

- 原則 #30: 床の光は注釈の分類を読ませる Tier A (Affordance) のまま。演出を足しても Fact を上塗りしない。
  reduced motion の読み取り境界は `src/theme/motion.js` の 1 か所を継承。
- 原則 #31: N 個の注釈が同位相で動く lockstep を構造で消した ADR-093 D1 を継承する。棚卸し (M1) の
  母集団は import から導出し、手書きの一覧にしない。
- 原則 #27: 床の光の寸法は「画面 px 目標 + world 上限」の対で決める (mm スケールのセルでも 100 m の
  site plan でも同じ見え)。
