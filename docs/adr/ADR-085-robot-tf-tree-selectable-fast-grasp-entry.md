# ADR-085: ロボットを TF 親子ツリーで接地し、直接選択可能にし、grasp-search を無フォームで開く

- Status: Accepted (全 3 点 実装済 2026-07-22)
- Date: 2026-07-22
- Deciders: yuubae215
- Supersedes / Superseded by: なし（ADR-084 §2 の「独立2フレーム」簡素化を **改訂** —
  相互リンク。ADR-084 自体は supersede しない）
- 関連: ADR-084 (robot base/TCP を CoordinateFrame entity 化・TCP 姿勢基準の cone) /
  ADR-083 (robot base を grasp 契約に載せる) / ADR-055 (Scene ⇄ Layout DSL 無損失
  round-trip) / ADR-051 (テンプレギャラリー = New Project) / ADR-018/034 (CoordinateFrame
  配置ポリシ) / PHILOSOPHY #21 (座標空間の静的区別) / #22 (ヒットテストは狭スコープ優先)

## Context — Goal と力学(§1.2 Goal)

> **Goal: ロボットが「シーンの中の、直接触れて動かせる、正しく座標接地された一体の物」
> として振る舞い、その掴み判定 (grasp-search) に儀式なしで到達できること。**

オーナーからの 3 点の指摘 = いずれも「ロボットが世界から遊離して感じる」という同じ
根本の別側面:

1. **grasp-search が遠い**: 現状フォームを地道に埋めて Context を作らないと
   grasp タブに到達できない。空シーン(初期キューブのみ)から Header ▾ の
   "Grasp Search…" を押すと `!ctxService.loaded` で **行き止まりのトースト**
   (「New Project で作れ」)が出るだけ。例テンプレ経由の無フォーム経路 (ADR-051) は
   あるのに導線が奥まっている。
2. **ロボットがビューポートで選択できない**: キューブは選べるのに骨格は選べない。
   骨格 (`RobotStage`) は `SceneView` が持つ **描画専用デコレーション**で
   `scene.objects` に無いため、`HitTestService.hitAnyObject()` の走査対象外 —
   腕/胴をクリックしても素通しになる。選択できるのは足元の小さな `robot_base`
   ギズモだけ。
3. **TCP / robot の親子が概念とズレる**: TCP はロボット座標系で表現される点だから
   `robot_base` が親であるべき。また robot は初期キューブと同じ world(world gizmo と
   同じ、ビューポート中心が原点)を親とすべき。現状 ADR-084 §2 は `robot_base` と
   `tcp` を **独立した2つの world 親フレーム**にしており(どちらを動かしても他方が
   追従しない)、標準の TF ツリー world → robot_base → tcp から外れている。

力学 / 位置づけ: 3 点とも view/controller 層 + Layout DSL 契約(front レイヤ内)に閉じる。
`core/`(解法)には触れない — 越境なし。点3だけが幾何の正本 (§1.1) と無損失
round-trip (ADR-055) に関わる非自明・不可逆(スキーマ追加)な判断。

## Options considered

**点3(TCP 親子化)**
- A: `tcp` を `robot_base` の子にする(TF ツリー) — tradeoff: ADR-084 §2 の簡素化を
  覆し、Layout DSL に CF→CF の親リンク表現 (`parentRef`) を足す必要がある。だが
  world 姿勢解決 (`_updateWorldPoses`) は CF→CF 連鎖を既に完全対応、grasp の姿勢解決も
  `worldPoseOf` 経由なので合成は自動。標準ロボティクスの直感に一致。**採用**。
- B: 独立2フレームのまま維持 — tradeoff: base を動かしても TCP が置き去りという
  反直感が残る。オーナー指摘の出発点を解決しない。却下。

**点2(選択可能化)**
- A: 骨格クリックを `robot_base` プロキシ選択に解決(骨格は view のまま) — tradeoff:
  骨格を最低優先のヒットに足すだけ。RobotStage を entity 化しない = 軽い。**採用**。
- B: 骨格を本物の scene entity にする — tradeoff: URDF リンク群を domain 化する大工事。
  段階0スコープ超過(関節/キネマティクスは非モデル化のまま)。却下。

**点1(高速導線)**
- A: 無 Context で grasp を開いたら robot-cell スターターを自動ロードして grasp タブへ
  直行 — tradeoff: 初期シーン(捨てても良いブートキューブ)を置換するが、失う Context
  作業は無い。トーストで明示(無言スワップにしない、#11)。**採用**。
- B: New Project ギャラリーを開くだけ — tradeoff: 非破壊だが依然2クリック+手動で
  grasp を再度開く必要。速くない。却下。
- C: 現状維持(行き止まりトースト) — 却下(Goal 不達)。

## Decision — Strategy(§1.2 Strategy)

### 1. ロボット TF ツリー world → robot_base → tcp(ADR-084 §2 改訂)

- `robot_base`: world 親(root)のまま。既定 world 位置 `[-2,2,0]`(原点中心の初期
  キューブに埋まらない逃げ)を維持 — world gizmo と同じ world 座標系にいる事実は
  従来どおり成立。
- `tcp`: `robot_base` の **子**。translation/rotation は robot_base ローカル。既定
  local `[0,0,0]`/identity(base と一致、world 姿勢は改訂前と不変 = ソルバ挙動を
  無言で変えない)。base を動かす/回すと tcp が追従する。
- **Layout DSL に `parentRef` を追加**(additive、`layoutVersion` 据え置き —
  ADR-055/`LayoutDslSchema.js` の「1.0 内加算成長」先例)。standalone CF に
  `parentRef` があれば `position`/`rotation` は親ローカルオフセット、無ければ world
  姿勢(=従来の robot_base)。compiler が ref→id 解決、decompiler が親リンクを
  emit、validator が存在/自己参照を検査 → **無損失 round-trip** (§1.1)。
- grasp の tcp 解決 (`GraspController._resolveRobotDeclaration`) は `parentId===null`
  制約を tcp から外し **名前ルックアップ**(robot_base の子を優先、旧 world tcp は
  fallback)。world quaternion は `worldPoseOf` が親連鎖を合成するので、回転した base が
  wrist-cone 基準軸を回すようになる(ADR-084 §3 の意図を強化)。
- 旧 .ctx.json の world 親 tcp は `ensureRobotFrames()` が **world 姿勢保存のまま**
  robot_base 下へ一度だけ再親化(lossless upgrade)。

### 2. 骨格を選択可能に(robot_base プロキシ)

`RobotStage.raycast()` を公開し、`HitTestService.hitRobotStage()` が骨格ヒットを
`robot_base` CoordinateFrame に解決。`_onPointerDown` / contextmenu / dblclick /
hover カーソルで **最低優先の fallback**(CF ギズモ・実 entity の後)として拾う —
大きな骨格ボリュームが小さな標的を遮らない(#22)。骨格は view 専用のまま(§1.1:
姿勢の正本は robot_base entity)。

### 3. 無フォーム高速導線

`GraspController.openGrasp()` は無 Context 時、行き止まりトーストの代わりに
`ContextController.quickStartExample('cell_robotics')` で robot-cell スターター
(geometry + reach/gripper 宣言 → Run が即有効)を非同期ロードし、negotiation 起動後に
grasp タブを開く。openGrasp の末尾(layout ガード + idle seed + タブ選択)は
`_openGraspTab()` に抽出し両経路で共有。THREE-free テストレーンの最小 ctxCtrl
(`quickStartExample` 無し)は従来の誠実なトーストへ degrade。

## Consequences — Evidence と tradeoff(§1.2 Evidence)

- 肯定的: (1) 1 クリックで grasp-search に到達。(2) 腕/胴クリックで robot 選択 →
  N-panel で位置/姿勢編集に直結。(3) base を動かすと TCP が追従、標準 TF に一致し
  幾何の正本が親子で一貫。`parentRef` で将来の多段ロボットチェーンにも拡張可能。
- 受け入れるコスト: Layout DSL に `parentRef` を1つ追加(閉層への optional 兄弟では
  なく親リンクなので統治上は素直)。ADR-084 §2 の「独立」記述を本 ADR で改訂。
- 検証(証拠):
  - `pnpm test` = **693 passed**(front 全体、回帰なし)。うち新規:
    - `LayoutDecompiler.test.js`: tcp=robot_base 子の parentRef + local pose の
      round-trip と scene fixpoint、validator の dangling/self/non-CF 拒否。
    - `GraspController.test.js`: 子 tcp の解決、旧 world tcp の fallback 解決、
      無 Context → quickStart → grasp タブ、loader 無し時の誠実 degrade。
  - `pnpm typecheck` clean。`node schema/tools/validate.mjs layout-1.0` conforms。
  - BFF は同一 `compileLayout` を import(server/src/services/LayoutService.js)し
    独自 schema 検証を持たない → grasp の compile round-trip は parentRef を素通し
    (契約 `contractVersion` 不変、`contract-wall` 非該当)。
- 波及(blast radius): `src/domain/robotFrames.js`, `SceneService.ensureRobotFrames`,
  `GraspController`(openGrasp/_resolveRobotDeclaration), `ContextController.quickStartExample`,
  `HitTestService`, `RobotStage`, `AppController`(pointerdown/contextmenu/dblclick/hover),
  `LayoutCompiler`/`LayoutDecompiler`/`LayoutValidator`, `schema/layout-1.0.schema.json`。
  `core/` は不変。

## Lens notes

- §1.1 無損失: 点3は round-trip 保存が必須(§1.1「分解は lossless」)なので、live
  シーンの親子化だけでなく DSL 表現 (`parentRef`) まで足して初めて完了とした。
- #22 狭スコープ優先: 骨格は大ボリュームゆえ最低優先の fallback に置き、実 entity を
  遮らない。
- 様態: grasp 導線は逐次フロー(BPMN)— openGrasp は declare→(quickstart)→tab の
  決め打ち分岐。#11: 自動ロードはトーストで明示(無言スワップ禁止)。
