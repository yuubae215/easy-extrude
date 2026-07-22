# ADR-084: TCP 姿勢基準の許容角判定 + ロボット base/TCP の CoordinateFrame 実体化

- Status: Accepted (全 Phase 実装済 — Phase 1 core + Phase 4 契約 2026-07-21;
  Phase 2-3 フロント entity 化 + Header/`uiStore.robotBase` 撤去 2026-07-21)
- Date: 2026-07-20
- 関連: ADR-083 (ロボット base position を grasp-search 契約に載せる — 本 ADR は
  そのフロント側実装 (`uiStore.robotBase` + Header 手打ち入力) を置き換える) /
  ADR-081 (ドメイン段階バリデーション — 「届くか (Plan/Motion)」ドメインの幾何接地を
  本 ADR が具体化する、Proposed のまま) / ADR-078 (cone=許容角 と approach=進入角の
  用語境界 — 本 ADR は cone の**基準軸**を変えるが用語境界そのものは維持) /
  ADR-074 (契約統治: request 側は open payload/layoutVersion 統治、response 側は
  contractVersion 統治という非対称) / ADR-018/034 (CoordinateFrame エンティティと
  配置ポリシ)

## Context — Goal (§1.2)

> **Goal: grasp-search の判定が、実際にシーンへ配置された幾何を根拠にできること。**
> 「候補が本当に届くか」を確かめるには、ロボットが空間のどこにあり、どの向きで
> グリッパを構えているかを知らねばならない。それが宣言に無ければ、PoC を通しても
> 「検証OKかどうか判断できない」— これが本 ADR の出発点になった指摘。

現状 3 つのギャップがある。

1. **幾何が宣言にべた書き** (ADR-083 で追加した `graspSearch.robot.base` を含む):
   ロボット位置がLayout DSLのentityと無関係な生座標として`graspSearch`宣言に直接
   書かれている。Layout DSLは幾何の正本 (`src/domain/CoordinateFrame.js` 等) を
   すでに持っているのに、grasp宣言側だけ別の生座標を持つのは真実の源の分裂 (核 §1.1)。
2. **許容角 (cone) の基準軸が代理指標**: `engine/feasibility.py::NaiveIkSolver.solve()`
   は `to_target = (candidate.pose.position - robot.base).normalized()` を cone の
   基準軸として使っている — つまり「ロボット base からその候補への方向」を、
   本来测るべき「グリッパ (TCP) がどちらを向いているか」の代理にしている。関節を
   持たない素朴モデルなので厳密なIKは要らないが、代理軸は TCP の実際の姿勢とは無関係。
3. **ADR-083 のフロント実装は経由地**: `uiStore.robotBase` + Header の X/Y 手打ち入力は
   ad-hoc な view/UI 状態で、DDD Entity Core (CLAUDE.md 第一原則) の外に置かれている。
   ロボットを動かす操作は本来、既存の `CoordinateFrame` entity 編集機構
   (ADR-018/019/033/034 が持つ配置・回転編集 UI) に合流すべき。

## Decision — Strategy (§1.2)

### 1. ロボット base と TCP を `CoordinateFrame` entity として実体化する

新しい entity 種別は起こさない — `schema/layout-1.0.schema.json` の `entity.type` に
既にある `"CoordinateFrame"` を 2 個体使う (`position`+`rotation` フィールドは
既存スキーマにそのまま存在: `layout-1.0.schema.json:106-108`)。

- `robot_base` CF: 位置のみが意味を持つ (向きは reach 計算に使わない、現状維持)。
- `tcp` CF: 位置 **+ 姿勢 (quaternion)** が意味を持つ。関節/キネマティックチェーンは
  **モデル化しない** — `robot_base` と `tcp` は独立した2つの自由なフレームであり、
  どちらかを動かしても他方は追従しない (今回はモーション計画のスコープ外、既存の
  `semanticType: "mounts"` 拘束で将来つなぐ余地は残すが今は使わない)。

Robot ボタン脇の Header X/Y 入力 (ADR-083 実装分) は撤去し、ロボット位置編集は
既存の CoordinateFrame N-panel 編集 UI に統合する。`uiStore.robotBase` state も
撤去 (第二の源だったものを正本の domain entity に一本化)。

### 2. grasp 宣言は entity 参照を持たない — 名前規約 + 既存の compile round-trip での解決

**(2026-07-20 レビューで簡素化)** 当初案の明示 `refs.robotBaseEntity`/`refs.tcpEntity`
フィールドは持たない。今回のスコープは1ロボット限定 (複数台/選択UIは無し) なので、
`GraspController` が `scene.objects` を `name === "robot_base"` / `name === "tcp"` の
**名前規約**で検索するだけで曖昧さなく解決できる。複数ロボットが要る段になったら
その時点で明示参照フィールドを足す (トリガが立ってから — kernel §0、先出し回避)。

`GraspController.runGraspSearch()` は Step A (DSL → BFF `compileLayout` の
round-trip 検証) で既に `scene.objects[]` を得ている。この直後に名前規約で該当
entity を `scene.objects` から引き当て、ワールド姿勢を解決してから `core/` へ送るペイロードに
生座標として埋め込む (`robot.base` = 解決済み position、`robot.tcpOrientation` =
解決済み quaternion)。**`core/` は entity を一切知らない** — 段階0エンジンの単純さは
無傷 (解決は UI/BFF 境界の adapter 責務、CLAUDE.md AI 向けガードの「解法は core/」を
崩さない)。

ワールド姿勢解決 (`transformGraph` の親子連鎖をたどって local translation/rotation を
合成する処理) は **フロント側**に置く — 判断基準は「重い総当たり計算 (候補探索の
reach/IK/干渉フィルタ) だけが `core/` に逃がすべき対象で、そうでない軽い決定的計算
(数段のquaternion合成) はUIフィードバックの速さを優先してフロントに置く」。この
処理はまさに `SceneService._updateWorldPoses()`/`_worldPoseCache` が既に毎フレーム
相当の頻度で行っているものと同一なので、`GraspController` から `SceneService` の
既存ロジックを呼べる形に切り出して再利用する (BFF側の再実装は第二の源になるため
やらない — §1.1)。BFF (`server/`, Node.js — Rustではない) は今回の解決処理には
関与しない。重い計算 (候補生成 × フィルタ) は従来通り `core/` (Python, 別プロセス) が
担う一方、姿勢解決はそれとは別種の軽量処理としてフロントに留める。

### 3. `NaiveIkSolver` の cone 基準軸を TCP 姿勢由来に変更

`Robot` (`engine/types.py`) に `tcp_orientation: Optional[Quaternion]` を追加
(新規 `Quaternion` 型を `core/` に導入 — 現状 `[qx,qy,qz,qw]` の生リストしかない
箇所を named type 化。`pose_codec.py` の axis-order 慣例 `[x,y,z,w]` を踏襲し、
grasp-contract wire の `cartesianFrame.orientation` と揃える)。

**FORWARD_AXIS = +X** (TCP の body frame でグリッパが向く方向)。これは
`pose_codec.py` の `-Z` gauge とは **無関係の別概念**であることを明記する —
`pose_codec.py`の`-Z`は candidate 個別の frame を round-trip 可能な四元数へ
encode/decode するための任意の内部 gauge (ロボットの物理的な向きとは無関係)。
対して TCP の `+X` は CLAUDE.md が定める世界座標系の正準 (ROS REP-103: +X前方/
+Y左/+Z上) に合わせた、ロボット実体の body-frame 規約 (URDF流の前方軸)。この2つの
`軸=前方` という言葉を安易に同一視して使い回さない — 別の場所で別の目的のために
選ばれた別の gauge であり、たまたま同じ役割の名前を持つだけ。

**必ず ROS 正準ワールド座標系を経由してから比較する**: `tcp_orientation` は
(§2 の解決ステップで) `transformGraph` を根までたどってワールド姿勢に完全合成
**済み**の四元数として `core/` に渡る — ローカル (親相対) の回転のまま送らない。
`core/` 側は「ワールド座標系で表現された quaternion」という前提だけを信頼し、
どの親フレーム由来かは一切関知しない (これが解決をフロント側に閉じ込める理由でもある —
`core/`はentityもtransformGraphも知らない)。

`NaiveIkSolver.solve()` の基準軸を変更:

```python
FORWARD_AXIS = Vec3(1.0, 0.0, 0.0)  # TCP body frame の前方 = +X (ROS/URDF 慣例)

# 現状 (代理軸): to_target = (candidate.pose.position - robot.base).normalized()
# 変更後: tcp_orientation (ワールド座標系で解決済み) で FORWARD_AXIS を回転した
#         ものを基準軸にする -- pose_codec.py の -Z gauge とは無関係
reference_axis = robot.tcp_orientation.rotate(FORWARD_AXIS) if robot.tcp_orientation else \
    (candidate.pose.position - robot.base).normalized()   # 後方互換フォールバック
angle = angle_between(reference_axis, candidate.pose.approach)  # approach はワールド系の生ベクトル、gauge 無関係
if angle > robot.wrist_cone_half_angle + _EPS:
    return None
```

**後方互換フォールバックを明示的に持つ**: `tcp_orientation` が宣言されない場合 (既存
テンプレ・既存呼び出し) は現行の base→candidate 代理軸のまま — 挙動を無言で変えない
(#11 の双対、無言の成功変化も禁止)。`tcp_orientation` を宣言した瞬間にだけ新しい
判定に切り替わる。両方とも wrist-cone の**用語**は変わらない (ADR-078 の cone/approach
分離は維持)。

### 4. 契約: `graspSearch.robot` に `tcpOrientation` を optional 追加 + `plan{}` への前倒しラップ

request 側は open payload / layoutVersion 統治 (ADR-074 §5, ADR-081 が明示した
非対称) なので **contractVersion は据え置き**。`packages/grasp-contract` の
`grasp-search-request.schema.json` に `robot.tcpOrientation: [number,number,number,number]`
(x,y,z,w — response 側 `cartesianFrame.orientation` と同じ配列・軸順) を追加する。

**ADR-081 のデータ構造を今どこまで前倒しするか (2026-07-20 レビュー)**: 全部の
先出しはトリガなしの過剰モデリング (kernel §5) — `camera`/`gripper` 宣言は
Visibility/Graspチェッカーが存在しない今作ると空の入れ物になるので **やらない**。
一方、今まさに触っている judgement パラメータ (`reachMin`/`reachMax`/
`wristConeHalfAngle`) は「後で `sense`/`act` が生えたときにもう一度動かす」二度手間を
避けるため、**今のうちに `plan{}` へラップする** (ADR-081がSense/Plan/Actの3ドメイン軸を
採用する前提に前倒しで揃える。空の`sense{}`/`act{}`は作らない):

```
graspSearch: {
  plan: { reachMin, reachMax, wristConeHalfAngle },   // judgement params (旧 robot.*)
  robot: { base: [x,y,z], tcpOrientation: [x,y,z,w] }, // 解決済み生幾何 (entityから)
  objectiveWeights: {...}, topN: 5
}
```

`refs` (entity参照) は明示フィールドとして**持たない** — 今回のスコープは1ロボット
限定 (関節/複数台はモデル化しない) なので、`GraspController`が`scene.objects`を
`name === "robot_base"` / `name === "tcp"` で検索するだけで足り、選択UIや`refs`フィールドの
曖昧さを持ち込まない。複数ロボット対応が要る段になったら、その時点で`refs`を足す
(トリガが立ってから — kernel §0)。

## Options considered

- **A: TCP を導入せず、既存の base→candidate 代理軸のまま** — tradeoff: 「掴める」判定が
  グリッパの実姿勢と無関係のまま。ロボットを回転させても cone 判定が変わらないという
  直感に反する挙動が残る。却下 (今回の出発点そのものを解決しない)。
- **B: TCP を導入するが、関節/キネマティックチェーンも同時にモデル化する** — tradeoff:
  段階0エンジンのスコープを大きく超える (実IK・特異点・関節限界は ADR-081 Phase4 の
  「Still deferred」領域)。ユーザの明示指示 (「一旦モーションや各関節を考慮しない」)
  にも反する。却下 (今回はやらない)。
- **C: TCP entity 参照 + 姿勢基準の cone、後方互換フォールバック付き (採用)** —
  tradeoff: `core/` に `Quaternion` 型と回転演算を新規導入する分だけ実装コストが乗るが、
  幾何の正本が一本化され (§1.1)、UIのentity編集機構に合流できる。フォールバックにより
  既存テンプレ・既存呼び出しは無傷。

## 実施フェーズ (段階摘出、ADR-081 §6 と同形)

| Phase | 内容 | 契約影響 | 状態 |
|-------|------|----------|------|
| 1 | `core/`: `Quaternion`型 + `Robot.tcp_orientation` + `NaiveIkSolver`基準軸変更 (フォールバック込み) + テスト | なし (open payload) | **実装済** (2026-07-21) |
| 2 | フロント: `robot_base`/`tcp` CoordinateFrame entity の既定自動生成 (ADR-073パターン) + `SceneService`のワールド姿勢解決ロジックの再利用可能な切り出し | なし | **実装済** (2026-07-21) |
| 3 | フロント: `GraspController`が名前規約でentity解決 → `plan{}`/`robot{}`構造で送信、Header X/Y入力 + `uiStore.robotBase`撤去 | なし (契約は Phase 1 で追加済みのoptionalフィールドを使うだけ) | **実装済** (2026-07-21) |
| 4 | 契約: `grasp-search-request.schema.json`に`plan{}`/`tcpOrientation`追加、conformance test、BFF型再生成 | contractVersion据え置き (optional) | **実装済** (2026-07-21) |

### Phase 1 + 4 の実装メモ (2026-07-21)

- `core/`: `engine/types.py` に不変 `Quaternion` 型 (軸順 `[x,y,z,w]`、`normalized`/
  `rotate`/`from_list`/`as_list`) と `angle_between(a,b)` (退化は π) + `Vec3.cross` を追加。
  `Robot.tcp_orientation: Quaternion | None` を追加。`NaiveIkSolver.solve` は
  `FORWARD_AXIS = +X` を `tcp_orientation` で回した軸を cone 基準にし、未宣言なら
  旧 base→candidate 代理軸へフォールバック (挙動を無言で変えない)。
- 契約: `grasp-search-request.schema.json` に閉じた `plan{reachMin,reachMax,
  wristConeHalfAngle}` と `robot.tcpOrientation:[x,y,z,w]` を optional 追加
  (contractVersion 据え置き — request 側 open payload、ADR-083 の先例と同型)。
  adapter (`problem_from_declaration`) は judgement param を `plan{}` 優先で読み、
  旧 `robot.*` へフォールバック。BFF `.d.ts` を `gen:contract-types` で再生成。
- 証拠: `core` pytest 137 passed (engine の Quaternion/回転/TCP cone/フォールバック/
  plan 優先 を含む 8 ケース追加)、grasp-contract conformance 全 green
  (plan/tcpOrientation の optional・closed・malformed を追加)。

Phase 1→core実装を先行させ、Phase 2/3→フロント追従という順序はADR-079/081が既に
使った「コア実装+テスト先行 → 契約 → 消費追従」と同型。

### Phase 2-3 の実装メモ (2026-07-21)

- **世界フレームの一級化**: `CoordinateFrame` の `parentId` は `null` を許容するように
  なった (旧不変条件「never null」を改訂)。`SceneService._updateWorldPoses()` の
  親なし分岐が、親を持たないフレームの `translation`/`rotation` を **そのまま世界姿勢**
  として cache するので、`worldPoseOf()` が world フレームにも効く (ROS TF の根)。
- **既定自動生成**: `src/domain/robotFrames.js` が正準名 (`robot_base`/`tcp`) と既定姿勢
  (base=ADR-083 既定 `[-2,2,0]`、tcp は同位置+単位回転) を保持。`SceneService`に
  `createWorldFrame(name, pose)` (親なし CF 生成) と `_ensureRobotFrames()` (名前で冪等)
  を追加し、`importFromJson()` 末尾 (`_ensureOriginFrames` の直後) で毎回呼ぶ — 新規
  シーンは 2 フレームを seed、保存済み `.ctx.json` からの復元は no-op (ADR-073 無言命名)。
- **Layout DSL 往復**: standalone (world-parented) CF を schema の `position`+`rotation`
  で表現 (ADR-084 §1 = 既存フィールド再利用)。`LayoutCompiler` は `position`→scene CF の
  `translation`/`parentId:null` に写像、`LayoutDecompiler` は親なし CF を
  `{position, rotation}` で schema-clean に出力 (旧 `parentRef`/`translation`/`declaredBy`
  出力は schema 非適合だったので廃止)。`LayoutDecompiler.test.js` に robot_base/tcp の
  往復 + scene fixpoint + validator 適合テストを追加。
- **GraspController**: `_resolveRobotDeclaration()` が `scene.objects` を名前規約で引き、
  `SceneService.worldPoseOf()` で world 姿勢を解決 → `robot.base`/`robot.tcpOrientation`
  を組む (解決できたキーだけ載せる = 未解決なら core の §3 フォールバックに委ねる)。
  judgement params は `params.plan` があれば `plan{}` に載せる (フロントは現状収集しない
  ので通常は省略、core 既定に委ねる — kernel §5 の先出し回避)。
- **撤去**: `uiStore.robotBase`、`UIViewBridge.onRobotBaseChange`、Header の X/Y 入力
  (`RobotPositionInputs`)、`AppController` の該当配線、`GraspSearchPanel` の生座標表示。
  `RobotStage` は `setPosition(x,y,z)` を `setPose(position, quaternion)` に替え、
  `AppController._syncRobotStage()` が毎フレーム `robot_base` CF の world 姿勢へ追従させる
  (base フレーム参照は cache、離脱時のみ再走査)。
- 証拠: JS 全 688 tests green (LayoutDecompiler 往復 + GraspController robot 解決/
  フォールバックの新規ケース含む)、`pnpm build` green、`test:contract` 23 green、
  `core` pytest 137 green (core/契約は本 Phase で不変)。

## Consequences

- 肯定的:
  - 「ロボットの向き」がgrasp判定に実際に効くようになり、ユーザの直感と一致する。
  - 幾何の正本が Layout DSL の CoordinateFrame entity に一本化され、ADR-083 の
    ad-hoc UI state が解消される。
  - `core/` の契約非関知 (entityを知らない) が守られ、段階0エンジンの単純さは無傷。
- 受け入れるコスト:
  - `core/` に `Quaternion` 型 + 回転演算のテストが要る (新規の数値安定性の懸念:
    正規化・ジンバルロックはquaternion演算なら基本的に回避できるが、テストで確認する)。
  - `SceneService`のワールド姿勢解決ロジックを`GraspController`から再利用可能な形に
    切り出す小さなリファクタが要る (現状はSceneService内部に閉じている可能性がある —
    実装着手時に確認)。
  - ロボットentity化に伴い、Header X/Y入力 + `uiStore.robotBase` の撤去 (ADR-083 分の
    後退) が要る — 一時的にUIの行き来が発生する。
- 明示的にやらないこと (Still deferred): 関節/キネマティックチェーン、実IK、
  wrench cone 安定性 (いずれも ADR-081 Phase4 の管轄のまま)。

## Phase 2-3 の再開メモ (2026-07-21 確定 — 実装済、下記は設計時のメモ)

Phase 2-3 (フロント entity 化) 着手前に確定していた設計点 (実装は上記メモ参照):

- **`robot_base`/`tcp` entity は Layout DSL に一本化 (シリアライズする)** — 非シリアライズ
  な既定ステージ扱いにはしない。これが本 ADR の狙い (§1.1 幾何の正本を Layout DSL の
  CoordinateFrame に一本化) に沿う唯一の選択。よって既定自動生成した 2 つの CF は
  Scene ⇄ Layout DSL の round-trip (ADR-055) と `.ctx.json` の両方に載る。
- 影響確認が要る先 (着手時): テンプレの round-trip テスト (`core/tests/test_templates.py`
  と front の `LayoutDecompiler.test.js`)、outliner 表示、undo/redo、CF N-panel 編集 UI、
  ADR-073 の無言自動命名パターンでの既定生成箇所。
- 解決ロジックは既存の `SceneService.worldPoseOf(frameId)` を `GraspController` から
  再利用する (ワールド姿勢は position + quaternion で既に得られる — §2 の切り出しは
  新規実装ではなく公開メソッド呼び出しで足りる可能性が高い、着手時に確認)。
- 送信: 名前規約 (`name === "robot_base"` / `"tcp"`) で scene から解決 → `plan{}` +
  `robot.base`/`robot.tcpOrientation` (Phase 4 で契約追加済みの optional) に載せる。
- 撤去: Header の X/Y 入力、`uiStore.robotBase`、`UIViewBridge.onRobotBaseChange`、
  `AppController` の該当配線、`RobotStage.setPosition` の uiStore 由来呼び出し
  (RobotStage は `robot_base` CF のワールド姿勢追従に切り替える)。

## Decided (2026-07-20 レビューで確定)

- **`robot_base`/`tcp` entity の既定生成**: 新規プロジェクトで手動配置させず、
  `RobotStage`と対応する既定entityをADR-073の「無言自動命名」パターンでテンプレ的に
  自動生成する。
- **`FORWARD_AXIS` = +X**: ROS/URDF慣例、CLAUDE.mdの世界座標系正準 (+X前方) と一致。
  `pose_codec.py`の`-Z`とは無関係の別gauge (上記 §3 に理由を明記済み)。

## Lens notes

- **真実の源 (§1.1)**: 本ADRの主眼はまさにこれ — grasp宣言の生座標を廃し、
  Layout DSL entityを幾何の唯一の正本にする。
- **decide/propose境界 (ADR-056/077)**: 変わらず全量decide。entity解決は決定的な
  座標変換であり、曖昧写像ではないのでpropose laneは無関係。
- **状態機械 (§1.4)**: grasp status FSM (idle/compiling/solving/results/error) は
  不変。entity解決はcompiling段階の内部処理として増えるのみで新状態は増えない。
