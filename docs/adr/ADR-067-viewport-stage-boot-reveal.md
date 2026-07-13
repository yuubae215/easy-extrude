# 067. ビューポート常設ステージ + 起動リビール — Tier D の最初の適用

- Status: Accepted
- Date: 2026-07-13
- Deciders: yuubae215, Claude
- Supersedes / Superseded by: なし(ADR-066 Tier D の最初の適用実績; ADR-065 の統治を無改変で継承)

## Context — Goal と力学(§1.2 Goal)

ユーザ指示(2026-07-13): 「リポジトリを見渡し、成長分野を見つけよ。3D CAD の堅い
テーマから、ゲームのような感動する UX・多くの人が触りたくなる画面へ」。要件は
方向性の形で来たので、性質へ持ち上げる:

**Goal**: *ユーザが全フレーム見続ける画面そのものが、開いた瞬間から「触りたい」と
感じさせる生気を持つこと。* ただし ADR-065/066 が確立した統治(単一 reduced-motion
境界・transient 単一所有者・judgment 偽装禁止・予算)を 1 mm も逸脱しないこと。

**ギャップ分析(成長分野の特定)**: ADR-065 の全 7 フェーズは Tier F(証明
フィードバック・着地演出・スナップフラッシュ)と Tier A(クローム)に投資した。
一方で **ビューポートの舞台そのもの** — 背景・奥行き・雰囲気・光・起動の瞬間 —
は素の Three.js のまま残った: フラット単色背景(`0x1a1a2e`)、フォグなし、
環境粒子なし、Ambient+Directional の二灯のみ、起動は無演出のカット表示。
これは ADR-066 以前は #30 旧文面(「何も語らない動き = 装飾 = 不採用」)が
封じていた領域であり、Tier D 新設によって初めて正当に着手可能になった
**最大の未開拓成長分野**である。

力学(保つべき不変条件):
- 演出は非命題的(Tier D)— fact/affordance の読み取り位置に置かない。
- 既存 Tier F 色語彙(選択 emissive・ゴースト・フラッシュ)の見えを壊さない
  (トーンマッピング変更は全マテリアルの再調整を要するため今回見送り)。
- mm スケールシーンでも成立(PHILOSOPHY #27)。
- ADR-065 の実装予算(バンドル ≤+20KB gz 累計・依存追加 0)の残りに収める。

## Options considered

- **A: 常設ステージ(SceneStage)+ 起動フライト(BootReveal)を統治内で実装(採用)**
  — 背景グラデーション・深度フォグ・フロアグロー・決定論ダスト 2 層・リムライト +
  セッション開始 1 回のカメラ進入。tradeoff: 常設 tick のコスト(毎フレーム
  ~130 sin + 2 draw call)と、fog による既存色のわずかな沈み。
- **B: ポストプロセス(EffectComposer + Bloom/ビネット/グレイン)** — tradeoff:
  レンダーパイプライン全体が変わり、全 Tier F 演出色とスクリーン射影系
  (HTML ラベル・オーバーレイ)の再検証が必要。ACESFilmic 前提の再調整も同時に
  発生し blast radius が過大。トリガ(核 §3)が立っていない重レンズ。
- **C: エンティティ側の演出強化(ホバーグロー・アイドル浮遊)** — tradeoff:
  実体の見た目は Tier F/A の判定面(選択・スナップ・ガードレール)と重なり、
  judgment forgery のリスク管理が難しい。舞台より先にやる理由がない。
- **D: 現状維持** — tradeoff: Goal に反する。ADR-066 が開いた許容を実績ゼロの
  まま放置し、「Tier D の宣言と統治の払い方」の前例が育たない。

## Decision — Strategy(§1.2 Strategy)

**A を採用**。二つの Tier D 演出を、それぞれ既存の所有権パターンに割り当てる:

1. **SceneStage(常設・ambient)** — `src/view/SceneStage.js`。
   - 内容: 縦グラデーション背景(CanvasTexture・生成 1 回)/ `FogExp2` 深度フォグ
     (背景中間色と同調)/ グリッド下の加算フロアグロー(`COLOR.accentActive` —
     クロームと同一のグロー色を共有)/ 決定論ダスト 2 層(近層 48・遠層 84、
     金角螺旋 + `hash01` 格子、Math.random 不使用、位相・速度が粒子ごとに異なる
     = 一斉動作なし)/ 逆側からの寒色リムライト。
   - **所有権: 永続アニメーションビュー**(GraspGhostView と同じ規則)。所有者は
     `SceneView`(生成・dispose)。`scene.background` / `scene.fog` の書き手は
     SceneStage ただ一人(#4)。tick は `AppController._animate` から毎フレーム。
   - **reduced-motion**: 単一境界の `onReducedMotionChange` を購読し、ドリフトを
     凍結・entry フェードを即着地。静的ステージ(グラデ・フォグ・グロー・静止
     ダスト)は残る — 静的キューへの退行であり消失ではない(#30/#11)。
   - **スケール**: `SceneView._updateGridScale` の 10 冪スケールに追従
     (`setScale`)。フォグ密度は逆数で薄まり、相対的な深度フェードがシーン
     スケール不変(#27)。
2. **BootReveal(一回性・occasion)** — `src/view/BootReveal.js`。
   - セッション開幕 1 回だけ、カメラが引き・高み・ヨー旋回から既定構図へ
     コンポーズダウンする(dolly=outExpo / orbit・lift=outCubic の属性別イージング)。
     `flightFrame(p≥1) ≡ {0,0,0}` を機械テストで拘束 — 既定の起動構図をビットまで
     保存し、ステージは最終ポーズを所有しない。
   - **所有権: transient** — `MotionGovernor.spawn` 経由(reduced 注入・予算)。
     reduced では飛行せず最終ポーズが全て(Phase 5 と同じ「reduced = 最終段」)。
   - **ユーザ優先の割込み契約**: 最初のキャンバス pointerdown / wheel /
     context ロードが `finish()` で即着地(ヒットテストがカメラを読む前)。
     加えて **external-write ガード** — 前フレームの自筆位置とカメラが不一致なら
     (fitCameraToSphere 等が動かした)、復元せず自ら退く。予算 eviction の
     `dispose()` もこのガードで安全。`?demo=context` 起動はフライト自体を張らない。
3. **純粋層** — `src/view/StageMath.js`(THREE-free・決定論)。ダスト配置/ドリフト
   (非整数比 2 周波)/ entry エンベロープ(層スタガー)/ フォグ密度 / フライト
   フレーム。`StageMath.test.js` 14 本で決定論・クランプ・単調性・恒等着地・
   属性別カーブを拘束。
4. **契約への影響: なし** — ワイヤ・schema・DSL 版・BFF 無改変(#29 play 側のみ)。
   tokens に `DURATION.bootReveal` を追加(COLOR 追加なし = パレット drift テスト
   非影響)。

## Consequences — Evidence と tradeoff(§1.2 Evidence)

- **肯定的**:
  - 画面の第一印象と常時の見えが「堅い CAD」から奥行きと生気のある舞台に変わる
    (グラデ背景に沈む地平・漂う微光・リムで縁取られた実体)。
  - Tier D の **適用前例**が立つ: 「宣言(ADR)・所有者(永続=SceneView /
    transient=Governor)・reduced 静的キュー・予算」の払い方のテンプレート。
  - 既定カメラ構図・全 Tier F/A 演出・契約は無改変。
- **受け入れるコスト / 否定的**:
  - 毎フレームの常設コスト(~130 sin + 2 draw call + バッファ更新)。InstancedMesh
    級の規模ではなく実測で問題なし。
  - フォグにより遠景の既存色がわずかに背景へ沈む(意図した深度キュー)。
  - dev サーバ等の遅いロードではフライト序盤がモジュールロードに食われ、体感が
    後半の減速だけになる(outExpo の性質)。プロダクションビルドでは先頭から見える。
- **検証(証拠)**:
  - unit 635 pass(+14 新規 StageMath)/ typecheck clean / contract 23 pass /
    E2E smoke 7 pass(grab・stack・reduced パス含む — 割込み・mm スケール経路は
    既存テストが踏む)/ pageerror 0。
  - バンドル **+1.95KB gz**(390,764 → 392,756; ADR-065 累計 ≈+14KB / 予算 ≤+20KB、
    依存追加 0)。
  - 実機スクリーンショット(headless Chromium): 通常起動 = フライト途中フレーム →
    既定構図に恒等着地・ダスト entry / reduced = 静的ステージ + 即最終構図。
- **波及(blast radius)**:
  - 新規: `src/view/StageMath.js`(+test)・`SceneStage.js`・`BootReveal.js`。
  - 変更: `SceneView.js`(stage 生成・背景/フォグ委譲・`_updateGridScale` 連動)、
    `AppController.js`(spawn・tick・finish フック 3 箇所)、`src/theme/tokens.js`
    (`DURATION.bootReveal`)。
  - ドキュメント: CODE_CONTRACTS §1 に 1 規則、CLAUDE.md doc-nav 1 行。

## Lens notes

- **§1.2 Goal へ持ち上げ**: 「ゲームのような画面に」(方向)→「全フレーム見る舞台が
  生気を持つ・統治は不変」(性質)。この持ち上げが B(ポスプロ全面刷新)を
  トリガなしの重レンズとして退けた。
- **§1.1 真実の源**: `scene.background`/`scene.fog` の書き手を SceneStage に一本化
  (#4)。グロー色は `COLOR.accentActive` を消費し第二の源を作らない。
  reduced-motion 読みは単一境界(`src/theme/motion.js`)のまま。
- **状態機械(§1.4)**: BootReveal は 2 状態(active/done)で不正遷移が無害 —
  boolean のままとし状態機械にしない(過剰モデリング禁止 §5)。
- **黒箱**: OrbitControls の入出力契約(position 手動書き + `update()` の恒等性)は
  fitCameraToSphere が既に依存している既知の性質のみ利用。外部書込みは
  ガードで検出し譲る(カメラの権威は常に「最後に意図を持って書いた者」)。
