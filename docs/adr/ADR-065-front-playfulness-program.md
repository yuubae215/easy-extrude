# 065. 体感層の全面遊戯化プログラム — front は遊び場、back は証明のまま

- Status: Proposed (Phase 0–6 未実装 — 実装は後続セッション)
- Date: 2026-07-09
- Deciders: yuubae215, Claude
- Supersedes / Superseded by: なし (ADR-062 を廃止せず**拡張**する)
- References: ADR-062（三層方針 — 本 ADR の親。事実駆動演出の規律は無改変で継承）,
  ADR-064（rigor 側プログラム — Phase 4 の reduced-motion 境界を本 ADR Phase 1 が
  3D 層へ移設・延長）, ADR-061（惜しさメーター曲線）, ADR-059（空間ゴースト系譜）,
  ADR-058（無言 disabled 禁止・同一関数参照の検証境界）, ADR-047（ゴースト/リップル系譜）,
  PHILOSOPHY #29（Rigor on the Wire, Play in the Client）, #16（Discovery Is a Design
  Deliverable）, #14（入力衝突時のみ無効化）, #11（Silent Failures）, #9（確保/解放対称）,
  #4（視覚フラグ単独所有）, #25（ガードはサービス述語）, #26（エッジ占有）, #27（px+world ペア則）

## Context — Goal（§1.2）

ユーザ要望は「フロントはゲーム、バックは堅い証明」— フロント UI の遊び心とワクワク感の
**抜本的**強化である。ADR-062 が証明フィードバックループ（入力 → 証明層が事実を決定 →
契約が運ぶ → クライアントが演出を導出 → アハ体験）を全 UX 面の既定標準として確定し、
Context / Grasp 面では実証済み。しかし現状観測で 5 つの大きな空白が判明した:

1. **コアモデリング操作（S-01…S-10）に演出ゼロ** — 箱追加・Grab・押し出し・スナップ・
   Measure という*全ユーザが最初の 10 分で触る面*は emissive の瞬間色替えのみ。
   「ゲーム感」は Context / Grasp オーバーレイの奥に隠れており、そこに到達する前に
   ユーザは無味乾燥な入口を通過しなければならない。
2. **テーマ/トークン基盤の不在** — CSS ファイルゼロ、hex 直書きが約 30 コンポーネントに
   複製散在（`#3a7bd5` / `#22C55E` / `#d5a23a` / `#1a1a1a` …）。同じ色彩語彙が反復に
   よってのみ共有される = 暗黙の第二の源（核 §1.1 違反状態）。
3. **クロームが無味乾燥** — Header / InfoBar / ToolbarButton / ToastStack は無アニメの
   平板矩形。disabled は `opacity:0.35` のみ（クローム層にはまだ「無言の disabled」が残る）。
4. **3D tick ループが reduced-motion 非対応** — ADR-064 Phase 4 の境界は DOM 層
   （`FeedbackPrimitives.jsx` の単一 matchMedia）のみで、`GraspGhostView` 以下すべての
   3D 演出は無条件に動く。3D 演出を拡大する前にこの穴を閉じる必要がある。
5. **達成・節目の演出が `RippleEffect` 1 箇所のみ** — 全チェック green、conflict 全解消
   などの「勝った瞬間」が一行のテキスト変化でしか返らない。

**Goal（解でなく性質で — ADR-062 Lens notes と同じ持ち上げ）**:

1. **初回セッションの活性化** — 最初の 3 操作以内に「入力が世界を動かした」が視覚的に
   返る。ADR-062 の「入力が報われる」を、未到達だった直接操作面へ適用する。
2. **動きによる発見性** — 触れる場所・押せない理由が要素自身のモーションと様式から
   読める（#16 の新ゴール軸。#14/#25 の理由提示規律をクロームへ一般化）。
3. **遊びはシステム、即興ではない** — 1 つのトークン/モーション語彙で hex 手書き複製を
   止め、素のフォームへの退行と美観ドリフトを構造的に防ぐ（§1.1）。
4. **ワイヤは無垢のまま** — 全フェーズの blast radius は `src/` クライアント内。
   `server/`・`schema/`・`vendor/grasp-contract`・Context DSL は全フェーズ無改変。
   これが「front は遊び場、back は証明」の不変条件化であり、`test:contract` と
   schema conformance テストが機械ガードであり続ける。

**力学・制約**: ユーザ決定として (a) モダリティは**視覚のみ**（音・ハプティクスは
ADR-062 非目標のまま将来の別 ADR）、(b) アニメ用ライブラリの導入は許容（ただし選定
根拠必須 — Options 参照）、(c) 優先面はコアモデリング / クローム / Context・Grasp 深化 /
オンボーディング・達成演出の 4 面すべて。

## Options considered

- A: **現状維持（ADR-062 の完了フェーズで打ち止め）** — tradeoff: 実装コストゼロだが、
  アプリの*最初の 10 分*が本プロダクトの差別化要素（証明フィードバックループ）を一切
  示さない。無味乾燥な入口を生き延びたユーザだけが遊びの面に到達する。
- B: **モーションフレームワーク一括採用（framer-motion + canvas-confetti 等）** —
  tradeoff: 実装は速いが、framer-motion（~50KB+ gz）は独自の reduced-motion 処理 =
  **第二の境界**を持ち込み ADR-064 Phase 4 の単一境界決定に違反する。ラッパー
  コンポーネント様式は inline-style 家風と衝突し、独自 rAF ループは Governor の管轄外。
  canvas-confetti は管理外のオーバーレイ canvas + 独自ループで #9（確保/解放対称）と
  `AppController._animate` の tick 所有権に反する。**却下は好みでなく境界根拠**であり、
  ここに記録して再燃を防ぐ。
- **C: 階層化されたクライアント専用プログラム、依存節約、7 フェーズ【採用】** —
  tradeoff: 手書きから始める設計コストを引き受けるが、境界（単一 reduced-motion・
  tick 所有権・zero-CSS 家風・GitHub Pages バンドル）をすべて保ったまま拡張できる。
  依存導入は下記の**名指しの escape hatch** に限定する。

### ライブラリ選定（C 案の内訳）

- **3D: 依存ゼロ恒久** — 既存の constructor-add → `tick(t, camera, renderer)` →
  `dispose()` 系譜（`RippleEffect` / `GraspGhostView` / `UncertaintyGhostView` 等 7+
  クラス）が既にアニメーションシステムである。react-three-fiber / drei はトリガ無き
  アーキテクチャ書き換え（核 §0/§5）。`THREE.MathUtils.damp/lerp` + 新設の純粋
  イージング math で計画内すべてを賄える。
- **DOM: Phase 1 は手書き** — 純粋 `src/view/MotionMath.js`（イージング曲線・臨界減衰
  バネ step・stagger スケジューリング — `node --test` 可）+ 小さな rAF フック。
  モーションは style オブジェクトを出力し（`flashStyle(tone, reduced)` と同形）、
  zero-CSS inline 家風に整合する。
- **名指しの escape hatch（核 §0 を依存にも適用）**: Phase 3 終了時点で「中断可能/可逆
  なバネアニメーション」を**3 面以上**で手書き重複していたら、`@react-spring/web`
  （~19KB gz、style-object API = inline 家風互換、アニメ設定を注入できるため単一
  reduced-motion 境界を自前に保てる）を**1 コミットの swap**で採用する。トリガが
  立たなければ導入しない。

## Decision — Strategy（§1.2）

**C** を採る。ADR-062 を廃止せず、**3 箇所だけ意図的に広げた**上で、7 フェーズの
段階展開プログラムとして確定する。

### 1. ADR-062 との関係 — 3 つの Widening

ADR-062 の規律（演出の入力は常に事実 / 純粋導出 + null degrade / 演出履歴は
component-local / ワイヤ・uiStore に演出状態を載せない / 判定再実装禁止 / 提案文でなく
強調）は**一字も変えず継承**する。本 ADR が新たに立法するのは 062 が沈黙していた
隣接 3 領域のみ:

**Widening 1 — モーション階層規則（Motion Tier）**

| Tier | 意味 | 統治 |
|------|------|------|
| **Tier F — 事実駆動演出** | 「あなたの操作が効いた/惜しい/ダメ」 | ADR-062 無改変（事実 → 純粋導出 → null degrade） |
| **Tier A — アフォーダンス・モーション**【新設】 | 「ここで操作できる/できない理由」 | 下記規則 |
| **禁止 Tier — 装飾** | 何も伝えない環境モーション | 不採用（背景パーティクル・ロゴ脈動等） |

Tier A（hover 呼吸・押下バネ・アクティブツールの微発光・ドラッグハンドルのシマー・
様式化された locked 状態）は**事実でなく能力**を伝えるため 062 の管轄外だった。規則:

- Tier A モーションは（インタラクション状態 × そのコントロールを enable している
  **同一関数参照**のゲート述語）の純関数である（#25 / #14 / ADR-058 の一般化）。
- 判定・結果・正解の示唆を一切演出しない（「光るボタン = 正しい答え」の暗示は Tier F
  の越権 = 事実の捏造）。
- ドメイン状態を持たない（stateless）。
- reduced-motion では静的な様式化状態へ退行する（情報は保持 — #11）。

境界判定の一文テスト: **「その動きが止まったとき、ユーザーが知れなくなることは何か?」
— 答えが「何もない」なら装飾であり不採用**。idle モーションはアフォーダンスである
ときに限り許される（呼吸するハンドルは「掴め」と言っている = Tier A; 揺れるヘッダは
何も言っていない = 装飾）。

この規則は Phase 0–1 実装時に PHILOSOPHY 新原則（#30 候補）+ CODE_CONTRACTS 行として
鋳造する。Tier A は既にクローム・オンボーディング・3D ハンドルの 2 文脈以上に跨るため、
Yellow Card ではなく本則候補である。

**Widening 2 — セレブレーション・プリミティブ**

ADR-062 が却下したバッジ（= 事実から導出されない**永続**状態）とは別物として、
セレブレーションを合法化する:

> セレブレーション = **直前に起きた事実「遷移」の高演出レンダリング**。
> 一過性・component-local・予算制（同時最大 1）・永続禁止・ワイヤ禁止。

- 入力はレベルや累計ではなく**遷移**（全チェックが pass に**なった**、conflict 集合が
  ∅ に**なった**、全 OpenQuestion が**消化された**）。初期ロードの状態は遷移ではない
  （このテストを純粋層に必ず持つ）。
- **セッション内事実は正当な事実** — CommandStack の深さ、「このセッションの最初の
  箱」は観測可能な正直なクライアント状態であり捏造ではない。**セッション横断**の
  実績（「通算 100 個目」）は永続化を要する = バッジ臭 = 不採用。
- 覚えていなければ表示できないものはバッジであり、禁止のまま。

**Widening 3 — プレゼンテーション「設定」の永続**

- 表示**設定**（オンボーディングツアーの dismiss、モーション量の好み等）は
  localStorage への client-local 永続を許す。
- 表示**履歴/実績**（前回スナップショット・達成記録）はどこにも永続しない —
  062 の「演出履歴は component-local」は無改変。

この区別により Phase 6（ツアー）が 062 と矛盾せず成立する。

### 2. 段階ロードマップ（7 フェーズ、各独立出荷可、レバレッジ順）

| # | フェーズ | 目標 | 主要ファイル | 事実源 | 新純粋モジュール |
|---|---------|------|-------------|--------|-----------------|
| **0** | **デザイントークン** | 色/時間/イージング/z-index の単一源。hex 複製慣習の廃止 | 新 `src/theme/tokens.js`; `docs/LAYOUT_DESIGN.md` パレット表 | n/a（基盤） | `tokens.js` + LAYOUT_DESIGN との**ドリフトテスト**（ADR-064 §1.1 と同手法: md を parse して定数一致を機械検証） |
| **1** | **MotionGovernor — reduced-motion の 3D 延長** | DOM/3D 双方の単一モーション権威。ADR-064 の穴（tick ループ非対応）を閉じる | 新 `src/theme/motion.js`（単一 matchMedia を**移設** — `FeedbackPrimitives.jsx` は再 export で境界は分岐せず移動）; 新 `src/view/MotionGovernor.js`; 新 `src/view/MotionMath.js`; `AppController._animate` | 環境事実（media query）+ アクティブ演出数 | `MotionMath.js`（easing / spring step / stagger） |
| **2** | **コアモデリングループ演出（旗艦）** | S-01…S-10 がついに報われる: 箱スポーンのポップ、押し出しの成長リップル、スナップのクリックフラッシュ、Grab 解放の settle、undo の巻き戻しゴースト、選択パルス | 新 `src/view/LandingEffects.js`（RippleEffect 系譜・独自オーバーレイ — emissive 不可侵 #4、#27 ペア則）; 新 `src/view/CommandFeedbackMath.js`; `AppController` | ドメインイベント（`objectAdded`/`geometryApplied` 等）+ CommandStack **着地**（楽観プレビュー中は発火しない — 事実は常に*確定した*操作）+ スナップ係合状態 | `CommandFeedbackMath.js`（イベント → 演出記述子 `{kind, anchor, tone}`; malformed → null #11） |
| **3** | **クローム刷新 + disabled-as-quest** | Header/Toolbar/InfoBar/Toast を Tier A 語彙で in-place 刷新（新エッジパネル禁止 #26）。`opacity:0.35` を「様式化ロック状態 + 未充足ゲート述語の理由表示」へ | `src/components/{Header,Toolbar,InfoBar}/`、Toast、`UIShell.jsx` | Tier A: ゲート述語のみ（enable 判定と同一関数参照 #25） | `MotionMath.js` へ追加（hover 呼吸曲線・押下バネ） |
| **4** | **セレブレーション** | 全チェック green 遷移・conflict → ∅・全質問消化・セッションコマンド節目の「勝った瞬間」 | 新 `src/components/Feedback/Celebration.jsx`（DOM バースト、`FeedbackDefs` パターン）; 新 `src/view/CelebrationField.js`（3D インスタンスパーティクル、RippleEffect 系譜）; `ChecksPanel` / `ConflictMatrix` 配線 | 事実**遷移**: 既存 `checkTransitions` / `settledRefs` / conflicts 署名 + CommandStack 長（セッション事実） | `CelebrationMath.js`（遷移述語 `allGreenTransition(prev,cur)` 等; 「初期ロードは遷移ではない」テスト必須; null degrade） |
| **5** | **Context/Grasp 深化** | 既に豊かな面に振付を足す: grasp 結果の三拍リビール（接近→閉指→スコア）、conflict セル解消の 3D 対応物（領域 recolor→dissolve）、不確実バンド崩壊の演出強化 | `GraspGhostView` / `RegionGhostView` / `UncertaintyGhostView`、`GraspGhostMath` | 不変（契約結果・`validateContext().conflicts`・interval 事実）— **振付だけ**追加 | `GraspGhostMath` へ stage timeline 導出（reduced 時は最終段へジャンプ） |
| **6** | **オンボーディングツアー（デスクトップ）** | シーン事実から「次のアフォーダンス」を導出する漸進ヒント: 空シーン → Add をパルス → 最初のオブジェクト → Grab をパルス → …。モバイル限定だったジェスチャヒントの構造的一般化 | 新 `src/components/Onboarding/` デスクトップツアー; uiStore に判別共用体 FSM スライス; `docs/STATE_TRANSITIONS.md` | シーン事実（オブジェクト数・選択・コマンド履歴深さ）が step 適格性を決定; dismiss は Widening 3 の設定永続 | `TourMath.js`（事実 → 適格ステップ; null = ヒント無し — 間違ったヒントは出さない #11） |

順序根拠: **0–1 は基盤**（以降のすべてがトークンと Governor を消費する）。**2 が最大
レバレッジ**（最も無味乾燥な面 × 初回体験ゴール）。**3 → 4** はセレブレーションが
クロームの原始（バースト/フラッシュ様式）を再利用するため。**5–6 は独立に切り捨て可**
（5 は既に 062 のループが回っている面の深化 = 最低レバレッジと明記）。

Phase 6 の uiStore スライス追加は 062 の「演出状態を uiStore に載せない」と矛盾しない:
ツアーの**進行**はユーザに見えるモードを持つアプリ状態（FSM）であり、演出の
**表示履歴**ではない。この区別を実装 ADR 追記時に CODE_CONTRACTS 行として明文化する。

### 3. 本 ADR が鋳造する named rules（実装フェーズで正式化）

1. **Motion Tier 規則**（Tier F / Tier A / 禁止装飾 + 一文テスト）→ PHILOSOPHY #30 候補
   + CODE_CONTRACTS 行。
2. **MotionGovernor = 単一モーション権威**: コードベース全体で matchMedia 呼び出しは
   ちょうど 1 箇所（grep 可能なテストで固定）。reduced 時の 3D は**終端状態を即描画**
   （情報保持 — 無言スキップ禁止 #11）。同時 transient 演出数の予算 + #9 対称の evict。
3. **トークンモジュール = 色/時間の単一源**: hex 複製慣習を退役。「触った行はトークン
   必須」の日和見移行ルール。LAYOUT_DESIGN パレット表とドリフトテストで機械束縛。
4. **セレブレーション規則**: 事実*遷移*入力・一過性・予算 1・永続禁止・ワイヤ禁止。
   セッション事実は正当、セッション横断は不採用。
5. **disabled-as-quest**: disabled コントロールは未充足ゲート述語の理由を描画し、
   その述語は enable 判定と同一関数参照（ADR-058 のクローム一般化）。
6. **設定 vs 履歴の永続線引き**: 表示設定は localStorage 可、表示履歴/実績はどこにも
   永続不可。

## 非目標（やらないこと）

- ポイント・バッジ・レベル等、永続する gamification 状態（ADR-062 の却下を維持）。
- 音・ハプティクス等の新モダリティ（ADR-062 非目標のまま — 将来の別 ADR）。
- 契約・Context DSL・scene schema への演出フィールド追加（全フェーズで
  `test:contract` / schema conformance が機械拒否し続ける）。
- クライアント側での判定再実装・提案文の生成（ADR-056/062 のスコープ境界維持）。
- テーマ切替機構（dark 専用のまま — トリガが立つまで作らない、核 §5）。
- framer-motion / canvas-confetti の導入（Options B の境界根拠により却下確定）。

## Consequences — Evidence と tradeoff（§1.2）

- **肯定的**: 「front は遊び場、back は証明」が全 UX 面で成立する。特に初回セッションの
  直接操作が即座に報われるため、証明フィードバックループへ到達する前の離脱面が消える。
  トークン + Governor により、以後の新 UI 面は演出語彙を再発明せず消費するだけになる
  （062 の「素のフォームへの退行防止」がクローム・3D にも構造化される）。
- **受け入れるコスト**: 手書きモーション基盤の設計コスト（escape hatch はトリガ制）。
  各演出追加時に Tier 判定（F か A か装飾か）+「事実の出所」確認の設計規律。
  クローム刷新は視覚差分が大きく、E2E アサーション設計に注意を要する。
- **リスクと緊張（明示）**:
  1. **バンドル予算**: プログラム全体 ≤ **+20KB gz**（3D 分は 0）。各フェーズの証拠に
     `vite build` サイズ差分を記録。escape hatch 発動時はこの予算から消費。
  2. **E2E flakiness**: アサーションは構造/存在のみ（アニメ中間ピクセル禁止）。
     reduced-motion パスが決定的経路を兼ねる。非ゲートの `e2e` ジョブ維持（#20、
     ADR-064 の隔離を保つ）。
  3. **過剰モデリング防止（核 §5）**: テーマ切替なしのトークン、汎用アニメ FW なしの
     Governor、ウィザードエンジンなしのツアー — 各基盤は Phase 2–6 が消費する分まで。
     成長はトリガ名指し。
  4. **契約圧力の事前拒否**: 「サーバが節目を教えるべき」型の要求はセレブレーション
     規則で先回り拒否（062 の `meterColor` 密輸拒否と同じ姿勢）。
  5. **Tier A 濫用**: 「光るボタン = 正解の暗示」への漂流 — 一文テスト + レビュー
     チェック項目（「このモーションは結果を主張していないか?」）で抑止。
  6. **`_animate` 性能**: 演出予算・インスタンス化パーティクル・dispose 対称（#9）。
     最悪ケース = undo/redo 連打は Governor の evict が吸収。
  7. **情報遅延の上限**: 振付（Phase 5）が事実の提示を **~1 秒**超遅延させることを
     禁止 — 遊びは学習速度の手段であり逆ではない（#29）。
- **検証（受け入れ基準、フェーズ共通）**: (a) 新純粋モジュールは `src/view/*Math.js`
  系譜の `node --test` を持つ、(b) E2E スモーク（reduced-motion パス含む）green 維持、
  (c) `vite build` クリーン + サイズ差分記録、(d) `test:contract` + schema conformance
  green = 契約無改変の機械証明、(e) `tsc --checkJs` クリーン。
- **波及（blast radius）**: `src/theme/`（新設）、`src/view/`（Governor + 演出クラス +
  純粋 math）、`src/components/`（クローム + Celebration）、`AppController._animate`、
  uiStore（Phase 6 のみ）。**契約 / BFF / ドメイン / スキーマ / DSL 版は全フェーズ無改変**。
- **ドキュメント影響（各フェーズの実装時に更新をスケジュール）**: PHILOSOPHY（Motion
  Tier 原則 — Phase 0–1 時）、CODE_CONTRACTS（Governor 所有・トークン規則・
  セレブレーション規則・disabled-as-quest）、LAYOUT_DESIGN（パレット表のトークン束縛 —
  Phase 0; Animations 表 — Phase 3）、SCREEN_DESIGN（disabled 理由表示 — Phase 3;
  ツアー画面 ID — Phase 6）、STATE_TRANSITIONS（ツアー FSM — Phase 6）、EVENTS
  （新ドメインイベントは**追加しない**想定 — Phase 2 は既存イベントを消費; 追加が
  必要になった場合のみ該当行を適用）。

## Lens notes

- **§1.2（Goal への持ち上げ）**: 要望は「ゲームのようなフロント」という解の形で来たが、
  Goal は「初回セッションから入力が報われる + 発見性 + 語彙の単一源 + ワイヤ無垢」の
  4 性質。バッジ型 gamification が再び最小解にならないのは ADR-062 と同じ理由
  （演出は決定された事実の導出でなければ嘘になる）。
- **様態判定（§1.3）**: プログラム全体の展開は BPMN（逐次フェーズ）、各演出ループは
  CMMN（事象駆動）。新しい状態機械は Phase 6 のツアー FSM のみ（3 状態以上 +
  誤ヒントが体験事故 → §1.4 トリガ成立）。
- **§1.1（真実の源）**: トークンモジュールは「反復による色彩語彙の共有」という暗黙の
  第二の源を単一源へ畳む。matchMedia の単一呼び出し site も同型（境界は移動しても
  分岐しない）。
- **依存判断への核 §0 適用**: ライブラリは「先回りで導入しない」— escape hatch の
  トリガ（3 面以上の手書き重複）が観測されたときだけ、記録済みの候補
  （`@react-spring/web`）を 1 コミットで採る。
