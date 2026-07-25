# 090. ロボットの同一性を名前から実体へ — 複数台の受け入れ、0 台を一級の状態に、grasp は選択された 1 台で解く

- Status: Accepted (実装済 — 契約 `packages/grasp-contract` / `core/` は不動)
- Date: 2026-07-25
- Deciders: yuubae215, Claude (pairing)
- Supersedes / Superseded by: なし (ADR-084 §2/§4 の「1-robot scope」前提を明示的に解除)
- 状態台帳: `docs/STATE_LEDGER.md` の「ロボット (台数)」行 (基数 `0..N` に確定) と
  「ロボット CF の TF ロール」行。本 ADR で台帳の §既知の負債 (2) を閉じた。
  遷移図の正本は `docs/STATE_TRANSITIONS.md` §Robot roster

## Context — Goal と力学 (§1.2 Goal)

要件は二つの問いとして来た:「grasp search でもどのロボットかを選択する必要があると思う」
「ロボットがない状態も受け入れられますか？」。性質へ持ち上げると Goal は三つ:

- **G1 — ロボットが指せること**: シーン内の各ロボットを、名前ではなく安定した識別子で
  指せる。「どのロボットか」という問い自体が成立する。
- **G2 — 解いた前提を偽らないこと**: grasp search の結果は、それを解いた前提 (どのロボット)
  を偽らない。前提が無いなら結果も出さない。
- **G3 — 0 台が正当な状態であること**: レイアウト作成中のシーンはロボットを持たなくてよく、
  その状態が安定して保持・往復する (勝手に 1 台に戻らない)。

### 力学 — 実測した現状

**(1) 同一性がマジック名である。** `robotFrames.js` はロボットを文字列
`ROBOT_BASE_FRAME_NAME = 'robot_base'` + `parentId === null` の duck-type で同定する。
この解決を **4 箇所が独立に再実装**している (`SceneService.ensureRobotFrames`,
`GraspController._resolveRobotDeclaration`, `HitTestService`, `AppController._setObjectVisible`)。
2 台目が入った瞬間に名前は一意でなくなり、4 箇所すべてが同時に壊れる。能力分岐を
プロパティ値 (名前) で行っている = 原則 #2 違反であり、同一性の源が 4 つある = §1.1 違反。

**(2) 0 台は既に到達可能で、無言である。** `AppController._deleteObject` が保護するのは
`Origin` フレームのみ。実測: Outliner の ✕ で `robot_base` を削除すると、子の `tcp` ごと
消え、確認ダイアログも toast も出ない。

**(3) 0 台は無言で偽の解を生む。** フレームが無いと `_resolveRobotDeclaration()` は `{}` を
返し、`GraspController` は `robot` キーごとワイヤから省く。すると
`core/easy_extrude_core/engine/pipeline.py:120` が既定値で

```python
Robot(base=Vec3(0,0,0), reach_min=0.0, reach_max=float("inf"), wrist_cone_half_angle=math.pi)
```

を構築する。**原点に立つ、無限リーチ・自由手首の幽霊ロボット**である。ユーザーには
「候補が出た」としか見えず、実機では 1 つも実行できない。入力は消費され、もっともらしい
何かが起きる — 原則 #11 が名指しする最悪の失敗形。

**(4) 0 台は安定ですらない。** `ensureRobotFrames()` は全シーン入口で冪等に「1 台へ修復」
する。実測: `robot_base` を削除 → ピック&プレイステンプレを読込 → `robot_base` が復活。
ユーザーの削除意思が入口規則に上書きされている (真実の源が scene ではなく seed 規則側に
ある = §1.1)。

**(5) 契約の非対称性が味方する。** `graspSearch.robot` は **request** 側の閉じたオブジェクト
(`additionalProperties: false`, `base` / `tcpOrientation`)。**response** には robot への参照が
一切無い (`contractVersion` / `candidates` / `diagnostics` のみ)。CLAUDE.md の統治どおり
request 側の変更は contractVersion 版上げを要さない。つまり **どう設計するか次第で契約を
一切動かさずに済む**。

**(6)「ロボット」が既に二重にある。** `examples/layout_pick_place_cell.json` の `arm_robot`
(名前「単腕ロボット」、220×220×500 の Solid、`IfcTransportElement`) と、自動 seed される
`robot_base` CF (-2,2,0) は完全に無関係な二つの実体である。加えて `LayoutCompiler` に単位
換算が無いため、mm 系のテンプレ (1900 幅のセル) に (-2,2,0) の CF が刺さる。§1.1 違反が
既に存在しており、複数台化はこれを避けて通れない。

### 状態設計 (§1.4)

シーンのロボット集合は **0 / 1 / N** の 3 状態を持ち、不正遷移が事故になる (0 台のまま
grasp を解く = 幽霊ロボット)。閾値を越えているので、クラスより先に状態を確定する。

```
        ┌──────── seed (新規シーンのみ) ────────┐
        ▼                                       │
   ┌────────┐   add robot    ┌────────┐  add   ┌────────┐
   │ 0 (無) │ ─────────────▶ │ 1 (単) │ ─────▶ │ N (複) │
   └────────┘ ◀───────────── └────────┘ ◀───── └────────┘
        │      delete (要確認)      │    delete      │
        │                           │                │
   grasp: 拒否 (no-robot)      grasp: 自動選択   grasp: 明示選択が必要
```

- 禁止遷移: **入口通過による 0 → 1 の自動修復** (現状の `ensureRobotFrames` の挙動)。
- 各状態で grasp の guard が変わるため、guard は名前付き述語に集約する (原則 #25)。

## Options considered

- **A: 現状維持 (1 台固定・名前同一性)** — tradeoff: G1/G2/G3 いずれも未達。特に力学 (3) の
  幽霊ロボットは複数台化とは独立に残るバグであり、放置は #11 の常態化。
- **B: ワイヤに robot 配列を載せ、core が全台横断で解く** — tradeoff: response に「どの
  ロボットの候補か」を足す必要があり、**contractVersion 5 への版上げ + 両側の導出/準拠テスト
  を同一 PR で** (ADR-082/084 §4, CI `contract-wall`)。さらに「どのロボットにやらせるか」
  という *オーサリング判断* をソルバ側へ移すことになり、「ワイヤに載せるのはソルバが決定した
  事実のみ」(原則 #29 / ADR-060) に反する。「全台横断で最良の1台を提案してほしい」という
  要件が実際に立てば妥当だが、今は立っていない (§5 過剰モデリング禁止)。
- **C: フロントが同一性と選択を持ち、ワイヤは単数のまま (採用)** — tradeoff: 「全台横断で
  最良を出す」は今回やらない。ただし C は B を捨てる選択ではなく **B の前提**でもある
  (識別子が無ければ配列も作れない)。

## Decision — Strategy (§1.2 Strategy)

**案 C。** 五点。

1. **同一性を名前から実体へ移す (#2 / §1.1)。** `robot_base` というマジック名を同一性の
   根拠にするのをやめ、ロボットを安定した id を持つ 1 つの型付き集約として表す。現在
   4 箇所に散った duck-type 解決を `robotFrames.js` の単一の解決点へ寄せる (名前による
   解決は、既存シーン・既存 `.ctx.json` を読むための後方互換経路としてのみ残す)。

2. **台数を明示状態にし、自動修復をやめる (§1.4 / §1.1)。** `ensureRobotFrames()` の
   「全シーン入口で 1 台へ修復する」を「**新規シーンにのみ 1 台 seed する**」へ弱める。
   ユーザーが削除した 0 台が入口通過で戻るのは、真実の源が scene ではなく seed 規則に
   ある状態であり、G3 と両立しない。

3. **grasp search に robot 選択を持たせる。ただしワイヤは単数のまま。** panel に選択 UI を
   置き、`GraspController` が選択された 1 台を解決して、**今と同じ形の**
   `graspSearch.robot { base, tcpOrientation }` を送る。0/1 台のときは選択を自動化して
   UI に出さない (原則 #15 — スロットは保つ)。

   ここが本 ADR の要点である: **id をワイヤに載せる必要は無い。** core は「この幾何の
   ロボットで解け」と言われれば足り、同一性はフロント側の関心にとどまる。これは
   ADR-084 の「`core/` は実体を知らない — 解決済みの world 位置/四元数だけを受け取る」を
   そのまま維持する形であり、原則 #29 に最も忠実。結果として
   **契約 (`packages/grasp-contract`) と `core/` は本 ADR で一切変更しない**
   (contractVersion 据え置き、request スキーマの編集すら不要)。

4. **0 台を一級の状態として受け入れ、ゲートで明示的に止める (#11 / #25)。**
   `runGraspSearch` は選択ロボットが解決できないとき、既存の `no-layout` と同じ形で
   `status: 'no-robot'` + 理由つき toast を出して**走らせない**。幽霊ロボット既定を踏む
   経路を無くす。`core/` 側の既定値は後方互換のため残す (他の呼び出し元があるため) が、
   フロントが `robot` 未宣言のまま投げることは無くなる。

5. **削除を「禁止」ではなく「確認」にする。** `robot_base` の削除は 0 台への遷移なので、
   `Origin` と同じ無条件禁止にはしない (消せることは G3 の要求)。既存の dangling-link
   確認と同じ `showConfirmDialog` 経路に載せ、「無言で消える」だけを潰す。

**スコープ外 (別 ADR 候補):** 力学 (6) の二重「ロボット」— テンプレの `arm_robot` Solid を
実ロボット実体に統合すること、および Layout DSL の単位統治 (mm ↔ シーン単位)。本 ADR は
同一性と台数の決定に限る。B (全台横断ソルブ) も要件が立った時点で別 ADR。

## Consequences — Evidence と tradeoff (§1.2 Evidence)

- **肯定的**: G1 — 2 台目を足せる形になる。G2 — 幽霊ロボットで解かなくなる (力学 (3) の
  解消は複数台化と独立した価値)。G3 — 0 台が安定して往復する。加えて、契約・`core/` を
  一切動かさないため CI `contract-wall` も両側準拠テストも巻き込まない = 問題に見合う
  一番安いレンズで済む (核 §0)。
- **受け入れるコスト**: 「全台横断で最良のロボットを提案する」は出来ない (B の領域)。
  N 台時にユーザーが 1 台選ぶ手間が増える (0/1 台では自動選択で隠す)。`ensureRobotFrames`
  の弱体化により、「必ず `robot_base` が在る」前提に乗っていた経路は 0 台を扱えるように
  する必要がある (下記 blast radius)。
- **検証 (証拠)** — 実装完了時点で、Proposed 時の未来形はすべて実行可能な証拠に置換した。
  - *測定済み (実装前の欠陥として)*: 力学 (2) 削除の無ガード = E2E 実測 (削除後に
    `robot_base` / `tcp` の行数 0、確認ダイアログ・toast なし)。力学 (3) 幽霊ロボット既定 =
    コード参照 `core/easy_extrude_core/engine/pipeline.py:120` + 前面の省略経路
    (旧 `GraspController.js:221`)。力学 (4) 再 seed = E2E 実測 (削除 → テンプレ読込 →
    `robot_base` 復活)。力学 (5) 契約の非対称性 = スキーマ実測 (request `robot` は
    `additionalProperties:false` の閉objects、response に robot 参照ゼロ)。
  - *G1 同一性 (実装済)*: `src/domain/robotFrames.test.js` — 宣言ロールが名前に優先する
    (両方向)、同名 2 台が別実体として解決される、tcp の対応付けが `parentId` で行われる、
    レガシー (role 欄なし) が名前で 1 台だけ解決される。
    Scene ⇄ Layout DSL の往復は `src/layout/LayoutDecompiler.test.js`
    (`robotRole` の fixpoint + 「ロールを持たない CF は欄を出さない」)。
    E2E: 2 台目を Shift+A → Robot で追加でき、ROBOT バッジが両方に付き、undo で
    base+tcp が対で消える (`e2e/smoke.spec.js`)。
  - *G2 前提を偽らない (実装済)*: `src/controller/GraspController.test.js` — 0 台は
    `no-robot` で停止し **BFF 呼び出し 0 回**、N 台で未選択も同様、選択後は
    *その* ロボットの base/tcp がワイヤに載り、形状は単数のまま (`robots` / `robotId` 不在)、
    削除済み選択は黙って再利用されず落ちる。
  - *G3 0 台の安定 (実装済)*: E2E — 削除は「Delete Robot」確認を出し、確定後は
    base/tcp とも行 0、**テンプレ読込後も復活しない**。加えて
    `src/RobotRosterAuthority.test.js` が seed 呼び出しの **個数**を数え、boot 経路以外の
    seed を落とす (0 台を再び表現不能にする「最短の修正」を機械が拒否する — Q3)。
  - *契約不動 (実装済)*: `pnpm test:contract` 23 pass、`packages/grasp-contract` と
    `core/` の diff ゼロ、`contractVersion` 据え置き。
  - *回帰網 (実測)*: `pnpm test` 743 pass / `pnpm test:context` 478 pass /
    `pnpm typecheck` clean / `pnpm test:adr` 91 OK / `pnpm build` OK /
    `pnpm test:e2e` 16 pass (新規 2 本含む)。
  - GSN 論証木の併設 (Proposed 時の提案) は **不要になった**: 未来形の証拠が
    テスト/CI に降りたため、鎖は `.gsn` の外で実行可能になっている (§5 — トリガの
    消えたレンズをインスタンス化しない)。ADR-081 のように証拠が複数イテレーション
    未来形のまま残る判断では引き続き有効。
- **実装のかたち (Proposed からの差分)**: 同一性の担体は `CoordinateFrame.robotRole`
  (`'base'|'tcp'|null`) — *宣言されたロール*であり、読むのは `robotFrames.js` の解決点
  だけ、外の層は型付き `Robot` 集約で分岐する (原則 #2 の意図: タグを呼び出し側の分岐に
  漏らさない)。roster の view 側は `RobotStageSet` (1 スケルトン/1 ロボット、
  `sync()` が生成と破棄を対で持つ — 原則 #9) に移し、単一 `RobotStage` の
  「最後の書き込み勝ち」を構造的に無くした。0 台からの復帰路として Add メニューに
  `Robot` を追加した (これが無いと 0 台は状態ではなく罠になる)。
- **波及 (blast radius)**: `src/domain/robotFrames.js`(同一性の単一解決点),
  `src/service/SceneService.js`(`ensureRobotFrames` の seed 条件),
  `src/controller/GraspController.js`(`_resolveRobotDeclaration` / `runGraspSearch` の guard),
  `src/controller/HitTestService.js`, `src/controller/AppController.js`
  (`_setObjectVisible` / `_hideRobotByDefault` / `_syncRobotStage` / `_deleteObject`),
  `src/view/RobotStageSet.js`(新規) + `SceneView`(単一インスタンス → N),
  `src/components/Grasp/GraspSearchPanel.jsx`(選択 UI), `src/store/uiStore.js`(`no-robot` 状態),
  `src/components/Outliner/Outliner.jsx`(ROBOT バッジをロール駆動へ),
  `src/command/AddRobotCommand.js`(新規 — base+tcp 対の undo),
  `src/domain/CoordinateFrame.js`(`robotRole`) + `SceneSerializer` / `LayoutCompiler` /
  `LayoutDecompiler` / `schema/{scene-1.3,layout-1.0}.schema.json`(ロールの往復)。
  **不変**: `packages/grasp-contract/`, `core/`, `server/`。

## Lens notes

- **層 + 契約 (§1.3)**: 本決定の要は「同一性をどの層に置くか」。フロント (宣言と表示) に
  置けば契約は不動、ワイヤ (契約) に置けば版上げ。原則 #29 の「ワイヤはソルバが決定した
  事実のみ」から前者を採る。CLAUDE.md の AI 向けガード (解法は `core/`、フロントは宣言と
  表示) とも整合する — 「どのロボットか」は宣言側の語彙。
- **状態機械 (§1.4)**: 上記 0/1/N を先に確定。閾値判定は「3 状態以上 + 不正遷移が事故」の
  両方に該当。禁止遷移「入口通過による 0 → 1」を名指ししたことが決定 2 を導いた。
- **様態 (§1.3)**: ロボットの追加・削除・選択は逐次フロー (BPMN) ではなく、実体ごとの
  状態 + 事象で駆動される (CMMN) → 実体ごとの状態機械へ分解する形が合う。
- **真実の源 (§1.1)**: 本 ADR が潰す第二の源は二つ — 同一性の 4 重実装と、seed 規則が
  scene を上書きする構造。残る一つ (テンプレの `arm_robot` Solid vs `robot_base` CF) は
  スコープ外として明示的に繰り越す。
