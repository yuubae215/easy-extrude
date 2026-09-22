# 149. 初見は実写メッシュ — 軽量表示は常設のUIトグルで戻す選択にする

- Status: Accepted
- Date: 2026-09-22
- Deciders: yuubae215 (ユーザー要求), Claude Sonnet 5 (実装)
- Retires: GREP:src/controller/AppController.js::a\s+persistent\s+UI\s+control\s+is\s+future\s+work
- Supersedes / Superseded by: なし (ADR-148 の隣接決定 — 同じ 2 値軸の**既定**と**到達可能性**を扱う。ADR-148 自体は「どちらを描くか」の権威の話で、既定値そのものには触れていない)

## Context — Goal と力学(§1.2 Goal)

**Goal**: 957b06b で実装済みの UR5e 実写メッシュ (`realistic`) を、ユーザーが**追加の操作をせずに**体験できること。あわせて、帯域・パフォーマンスを優先したい利用者が軽量表示 (`skeleton`) へ**いつでも確実に**戻せること。解の形(「デフォルトをrealisticにする」「軽量化ボタンを足す」)で要求が来ているが、これは 1 つの性質「初見の質と、後からの制御可能性の両立」に持ち上がる — 前者だけなら既定を反転するだけで足り、後者を欠けば ADR-148 が可視化した「切替は常用操作になりうる」という前提が UI 無しのまま宙に浮く。

**力学 1 (発見可能性 — 原則 #16)**: `957b06b`/`6483b09`/ADR-148 で `realistic` スタイルは完成していたが、到達経路が `window.__easyExtrude.setRobotAppearance('realistic')` というブラウザコンソール API 1 本のみだった。`src/controller/AppController.js:939` 自身が `// Console-level for now; a persistent UI control is future work.` と明言しており、実装済みの機能が UI から**発見不能**だった。二次操作の発見可能性を成果物として扱う原則 #16 はコンテキストジェスチャの文脈だが、ここではそれ以前の話 — 一次的な見た目設定なのに入口が無かった。

**力学 2 (ネットワークコストの反転)**: `RobotStage` は「~9 MB を遅延 fetch」という理由で `skeleton` (プリミティブ円柱、ゼロネットワーク) を既定にしていた (`src/domain/robotVisualStyle.js` の docstring)。この既定を反転すると、ロボットを追加するたび ~9 MB の fetch が走る。これは原則 #11 (無言の失敗禁止) の裏返しでもある — 遅い回線でロードが失敗した場合、ユーザーに**見える形で**提示し、なおかつ**手動で軽量側へ戻す手段**を持たせなければ、ネットワークコストの反転を許容できる設計にならない。

**力学 3 (所有権は動かさない — 原則 #4)**: ADR-148 が確立した「シーンが描く既定スタイルの唯一の書き手は `RobotStageSet._renderStyle`」という設計は変えない。今回変えるのは**その初期値**と**書き手を呼ぶ経路の数**(コンソール1本 → コンソール+UIボタンの2本、ただしどちらも最終的に `RobotStageSet.setRenderStyle()` という同じ唯一の書き手に収束する)。

**力学 4 (状態台帳)**: 対象の実体「腕の描画スタイル」は `docs/STATE_LEDGER.md` に既に行を持つ(基数 2、閾値未満)。今回は値と到達経路が変わるだけで、状態の種類も遷移も増えないため新しい状態機械は起こさない — 台帳の記述だけ実測に合わせて更新する。

**力学 5 (ADR-148 の GONE trigger)**: ADR-148 の GSN (`docs/gsn/adr-148-the-scene-not-the-stage-owns-which-arm-is-drawn.gsn`) は `TheWriteItselfStillNeedsABrowserAndWeSaySo` (state `ToBeDeveloped`) の中で、disposal 計測 (`WebGLRenderer.info.memory.geometries` を往復切替の前後で読む) を将来investigateする条件として「`Console-level for now` 行が消えるとき = 往復切替が常用操作になったとき」を非公式に名指ししていた。本 ADR はまさにその行を消す (`Retires:` 欄)。disposal 計測そのものを実装するかどうかは、原則 #29 の二状態でいえば契約ありでも明示的対象外でもなく **まだ決めていない**(保留)— renderer を露出する設計コストを伴う別判断であり、本 ADR の scope 外にある。`docs/DEFERRAL_LEDGER.md` DEF-042 として正式に登録する(満期条件は「実装するかどうかの判断自体が外部条件」のため散文 — Q5 baseline を実測へ更新)。

## Options considered
- A: 既定を `realistic` に反転し、`skeleton` へ戻す常設 UI トグルを新設する(採用)
- B: 既定は `skeleton` のまま、`realistic` に切り替える UI トグルだけを新設する — tradeoff: 実写メッシュが「発見すれば見られる」機能のままで、ユーザーが要求した「初見で実写」を満たさない
- C: 現状維持(コンソール API のみ) — tradeoff: 原則 #16 の発見可能性違反が残り、実装済み機能が実質使われない

## Decision — Strategy(§1.2 Strategy)

**Option A を採用。**

1. **既定値の反転**: `RobotStageSet` コンストラクタの `this._renderStyle` を `ROBOT_RENDER_STYLE.SKELETON` から `ROBOT_RENDER_STYLE.REALISTIC` へ変更する。これは ADR-148 が定めた「シーンの宣言」の**唯一の書き手**(`src/view/RobotStageSet.js`)の初期値を変えるだけで、書き手の数も所有権の構造も変えない。
   `RobotStage` 自身のコンストラクタ既定 (`this._renderStyle = SKELETON`) は**変更しない** — これは同期的・ゼロネットワークで組み立てられる「ブート状態」であり、`RobotStageSet.sync()` が生成直後に `setRenderStyle(this._renderStyle)` を呼んでシーンの宣言を採用する(ADR-148 D1 が既に持つ経路)。2 つの「既定」(stage 自身の ctor 既定と、シーンが宣言する既定)を混同しない設計はそのまま維持する。

2. **常設 UI トグルの新設**: `ProjectionToggle.jsx`(ADR-103 — 画面端占有・callbacks 登録・store 反映の型)と同型のコンポーネント `RobotAppearanceToggle` を新設し、`ProjectionToggle` の直下に配置する。`gizmoRightOffset` を共有し、画面端は共有資源という原則 #26 を保つ。
   - ボタンは 2 状態トグル(片道ボタンにしない — 原則 #31: 「軽量化ボタン」だけだと `realistic` に戻す経路が UI に無いままになり、今回消す欠陥の再発になる)。
   - 書き込み経路: `RobotAppearanceToggle` → `callbacks.onRobotAppearanceChange` → `UIViewBridge.onRobotAppearanceChange` → `AppController` → `RobotStageSet.setRenderStyle()`(唯一の書き手、不変)。
   - `RobotStageSet.setRenderStyle()` は要求時に `_renderStyle` を**同期的に楽観更新**してから非同期ロードする実装(ADR-148 既存)なので、`AppController` 側もこれに倣い、呼び出し直後に `uiStore.robotAppearance` を楽観的に更新し、**全 stage が失敗した場合のみ**実測のロールバック後の値で上書きする。失敗時は `showToast({ type: 'error' })` で原則 #11 を満たす(無言の失敗にしない)。
   - 起動時、`AppController` は `RobotStageSet.renderStyle`(初期値 `realistic`)を読んで `uiStore.robotAppearance` を同期する。

3. **コンソール API は残す**: `window.__easyExtrude.setRobotAppearance` はデバッグ・e2e (`robot-appearance.spec.js`) が依存しているため削除しない。UI 経路とコンソール経路はどちらも `RobotStageSet.setRenderStyle()` に収束するので、書き手が 2 つになるわけではない(原則 #4 は保たれる)。
   `// Console-level for now; a persistent UI control is future work.` の行は嘘になるため削除する(本 ADR の `Retires:`)。

4. **ドキュメント更新**: `docs/STATE_LEDGER.md` の「腕の描画スタイル」2 行 (117/118) を既定値・到達経路の実測に合わせて更新。`docs/DEFERRAL_LEDGER.md` に DEF-042 を追加し、ADR-148 GSN の disposal 計測investigateを正式に登録する。

## Consequences — Evidence と tradeoff(§1.2 Evidence)

- **肯定的**: 初見でUR5eの実写メッシュが見える(ユーザー要求の核)。軽量表示への復帰が常設 UI から確実に到達可能になり、原則 #16 違反が消える。ADR-148 が構築した「宣言は唯一・非同期は settled/pending で判定」という設計を一切変えずに済む(既定値と到達経路だけの変更)。
- **受け入れるコスト**: シーンへロボットを追加するたび、初回は ~9 MB の fetch が走る(オフライン/低速回線での体感遅延)。0 台のシーンでは fetch されない(`sync()` は stage 生成時にのみロードするため)。ロードが全滅した場合は `skeleton` へロールバックしトーストで提示する(既存の `RobotStageSet.setRenderStyle` の失敗時ロールバックに乗る — 新しい失敗モードを追加しない)。
- **検証(証拠)**:
  - `e2e/robot-appearance.spec.js` の「boot declares the bundled skeleton — the zero-network default」を実測の新既定 (`realistic`) へ更新し、テスト名も反映する。
  - 新規 e2e: 起動直後に `robotAppearance().declared === 'realistic'`、`RobotAppearanceToggle` クリックで `skeleton` へ切り替わり `declared === 'skeleton'` になること、再クリックで `realistic` に戻ること。
  - `docs/gsn/adr-149-the-first-look-is-realistic-lightweight-is-a-standing-choice.gsn`(本 PR で併設)。
- **波及(blast radius)**: `src/view/RobotStageSet.js`(初期値のみ)、`src/domain/robotVisualStyle.js`(コメントのみ)、新規 `src/components/RobotAppearanceToggle/RobotAppearanceToggle.jsx`、`src/components/UIShell.jsx`(マウント追加)、`src/store/uiStore.js`(`robotAppearance` フィールド + action)、`src/view/UIViewBridge.js`(`onRobotAppearanceChange`/`setRobotAppearance`)、`src/controller/AppController.js`(配線 + コメント削除)、`e2e/robot-appearance.spec.js`、`docs/STATE_LEDGER.md`、`docs/DEFERRAL_LEDGER.md`。契約 (`packages/grasp-contract` / `server/` / `core/`) には触れない — view 層とその直下の UI 層のみ。

## Lens notes(任意)

**黒箱**: `RobotStageSet.setRenderStyle(style): Promise<void>` の入出力契約(楽観更新 → 非同期ロード → 全滅時ロールバック)は ADR-148 で既に確立済みで、本 ADR はこの黒箱の**内側**を一切変更しない。新しい呼び出し元(UI ボタン)を 1 つ増やすだけ。
**層 + 契約**: React コンポーネント層 → `uiStore`/`callbacks` 層 → `AppController` → `view/RobotStageSet` の 4 層構造は `ProjectionToggle`/ADR-103 が確立した既存の契約をそのまま再利用しており、新しい境界を作らない。
