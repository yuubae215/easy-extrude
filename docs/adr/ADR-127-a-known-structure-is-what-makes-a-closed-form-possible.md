# 127. 閉形式を可能にするのは「構造が既知であること」— UR の解析解を実 IK として注入する

- Status: Accepted (**`core/` 側 2026-08-14 / フロント配線 2026-08-14** — 運動学・解析解・ソルバ・契約宣言・配線に加え、フロントが `robot.kinematics` を送る配線 (ADR-128) まで入り、DEF-030 は決着した)
- Date: 2026-08-14
- Deciders: yuubae215, Claude
- Retires: なし
- 段: **G-3** (`docs/grasp/implementation-order.md`)。DEF-005 (ADR-081 Phase 4 = 実ソルバ差し替え) の最初の実現
- Supersedes / Superseded by: なし (`NaiveIkSolver` は退役させない — 宣言が無いときの既定として残る)

## Context — Goal と力学

**Goal:** *ワイヤに載る `ikSolvable` が、代理ではなくソルバの決定した事実になる。*

`NaiveIkSolver` の「可解」は「リーチ球殻に入り、手首コーンの角度以内」だった。
**関節限界も特異点も肘の姿勢も見ていない。** それでも `ikSolvable: true` は契約上
「ソルバが決定した事実」として載る (原則 #29)。契約中で最も弱い主張であり、しかも
弱いことがワイヤからは読めない — 形が正しいぶん、誤りは静かである。

力学が 3 つ揃っていた:

1. **UR は閉形式で解ける。** 軸 2/3/4 が平行という構造から位置と姿勢が代数的に分離でき、
   最大 8 解が得られる (Hawkins 2013 / ros-industrial `ur_kinematics`)。数値反復が要らない
   ので**決定的**で、「収束しなかった」という状態が存在しない。
2. **寸法は既にリポジトリに在る。** `public/robot/skeleton_arm.urdf` のヘッダが UR5e の
   公表 DH 値 (d1=0.1625 / a2=−0.425 / a3=−0.3922 / d4=0.1333 / d5=0.0997 / d6=0.0996) を
   宣言し、関節名も UR 慣例に揃えて「any future grasp-contract joint payload」を想定していた。
3. **継ぎ目も空いていた。** `IkSolver` Protocol の docstring が「実装は**解析的でも**
   ライブラリでも外部サービスでもよい」と書き、`NaiveIkSolver` 自身が「実 IK は将来
   差し替え」と宣言していた。**新しい設計ではなく、宣言済みの残し (DEF-005) の回収**である。

## Decision

### D1 — 運動学は **kind 判別の閉じた union** として request 契約に載せる

`robot.kinematics` に `kind: "universalRobots"` + 6 つの DH 長さ (+ 任意の関節限界)。
`gripper` (ADR-118) と同じ統治で、**kind が解法を選ぶ**: 閉形式は既知の構造に対してのみ
存在するので、任意のリンク寸法を渡せば解けるようになるわけではない。kind を足すのが
唯一の意図的な成長点で、そのとき版を上げる。

request 側の追加なので **`contractVersion` は 5 のまま** (ADR-083/084 の先例)。

### D2 — **機種名ではなく寸法**を運ぶ

`model: "ur5e"` にすると、解く側に「名前 → 寸法」の対応表が要る。その表は
**宣言する側が既に持っている数の第二の源**であり、機種が増えるたびに両側が育つ (§1.1)。
名前は運ばない。`core/` に機種表は無い。

### D3 — 宣言があるときだけ切り替える

宣言が無ければ `NaiveIkSolver` のまま。既存の呼び出しの答えは 1 つも変わらない
(ADR-084 §3 と同じ「宣言した瞬間にだけ挙動が変わる」規律)。ただし
**宣言が壊れているときは素朴判定へ落とさず throw する** — 「運動学を宣言したのに
代理で判定された」は宣言した側から見て嘘であり、無言の格下げは原則 #11 に触れる。

### D4 — 関節限界の不在は「無限」ではなく「検査していない」

`jointLimits` は任意。未宣言なら限界を**発明しない**。既定の ±2π を置くと
「限界が広い」と「限界を宣言していない」が同じ答えを出す (原則 #31)。

### D5 — 代表解は決定的に 1 つ選ぶ

段階0 が問うのは「解けるか」なので、8 解をワイヤに出さない。代表解は
**関節の総移動量が最小**の解 (同点は解の決定的な順序が破る)。順序ではなく量で選ぶのは、
入力がわずかに動いたときに代表解が飛ばないようにするため。

### D6 — フランジ frame の規約は **宣言**であって導出ではない

候補 `Pose(position, approach, roll)` をフランジの目標姿勢に写す規約を
`FLANGE_Z_IS_APPROACH` として名前つきで宣言する (フランジ +Z = approach、UR `tool0` の
慣例)。`pose_codec` の候補 frame は「+Z = −approach」という**別の gauge** を使っており、
両者は 180° 違う。どちらが正しいかはワイヤの外の取り決めなので、導出したふりをせず
宣言し、検査で焼く。roll の基準軸は `pose_codec` と同じ規則を使う (起点を 2 つ持たない)。

## Consequences

### 得られるもの

- `ikSolvable` が関節限界と実際の到達性を反映した事実になる。
- 反復解法と違い**収束失敗という状態が無い** — 空は「解が無い」だけを意味する。
- リーチ球殻 (`reach_min`/`reach_max`) の近似は、宣言された機種では冗長になる。

### DEF-030 の決着 (2026-08-14 — ADR-128)

3 項目とも同じ配線に乗ると宣言していたとおり、同じ PR で閉じた。

- **フロントが宣言を送るようになった。** `GraspController` が
  `robot.kinematics` を載せる。ここで初めて `ikSolvable` が関節限界を見た事実になる。
- **同じ 6 数が 2 箇所に在る問題は、写しを作らないことで消えた。** 引き受けた冗長を
  検査で縛る計画だったが、実装では 6 数を `skeleton_arm.urdf` から**読み出した**ので
  比較すべき第二の写しが存在しない。テストは読み出しが UR5e 公表値を再現することを
  釘付けし、URDF が別の腕へ書き換わった日に落ちる。
- **D6 の規約はフロントの描画と照合された。** 決着させられる外部の証人はアプリが
  *描く*形だけなので、`wrist_3_link` のフランジ面 visual が宣言軸 +Z に在ることを
  読み戻す (ADR-128 D7)。フランジの絵を裏返した日にビルドが落ちる。

### 残し — 引き受けなかったもの

- **ベースの姿勢 (回転) は契約に無い。** 現状 `robot.base` は位置だけ。傾けて据え付ける
  要件が出たら契約に足す判断が要る。無いものを既定で埋めていない。

### 検証 (証拠)

IK は多対一なので `IK(FK(q)) == q` は成り立たない (最大 8 解)。求めてよい同一性は
商の上の fixpoint = **`FK(IK(T)) == T`** で、原則 #28 がまさに名指ししている形。
健全性だけでは 1 解しか返さない実装も緑になるので、**完全性を別に問う**。

| 主張 | 問い所 | 状態 |
|------|-------|------|
| FK 自身が正しい (IK の物差し) | `test_forward_kinematics_at_zero_is_the_documented_home_pose` — DH から手計算した原点姿勢を IK と独立に固定 | ✅ |
| 健全性: 全解が目標に一致 | `test_every_solution_reaches_the_requested_pose` — 200 姿勢、最悪誤差 < 1e-9 (実測 7.2e-14) | ✅ |
| 完全性: 元の配置を取りこぼさない | `test_the_original_configuration_is_among_the_solutions` — 200/200 で復元 | ✅ |
| 一般姿勢で 8 解 | `test_a_generic_pose_has_eight_solutions` | ✅ |
| 空は「解が無い」 | `test_unreachable_pose_yields_no_solutions` | ✅ |
| 決定性 | `test_solution_order_is_deterministic` / `test_solver_is_deterministic_for_the_same_request` | ✅ |
| 限界の不在は検査の不在 | `test_undeclared_joint_limits_are_not_checked_rather_than_infinite` | ✅ |
| 未宣言の kind / 欠けた寸法で throw | `test_an_unknown_kinematics_kind_throws_rather_than_falling_back` / `test_a_missing_dh_length_throws_rather_than_defaulting` | ✅ |
| ベース並進を無視していない | `test_solver_accounts_for_the_robot_base_offset` | ✅ |
| **宣言が探索の答えに届く (経路)** | `test_the_declaration_actually_reaches_the_search_pipeline` — 関節を凍結する限界を宣言すると IK 段で全棄却。**ソルバ単体が正しくても `search()` が読んでいなければ何も起きない** (ADR-116 の「主経路が死んでいても計数は緑」を避ける) | ✅ |
| 規約がフロントの描画と一致 | `src/domain/robotKinematics.test.js` — URDF の `wrist_3_link` フランジ面が宣言軸 +Z に在ることを読み戻す (ADR-128 D7) | ✅ 2026-08-14 |
| 宣言が実際にワイヤへ届く (フロント) | `src/controller/GraspController.test.js` — BFF が受け取った request の上で assert | ✅ 2026-08-14 |

### 実装で分かったこと

**平面を取り違えても「それらしい」答えが出る。** 肘の 2 リンク問題を frame1 の x-z 平面で
解いていて、真値 θ3 = 1.100 に対し 1.149 が出た。**桁も符号も妥当なので、値を見ても
気づけない。** 正しくは x-y 平面 (α1 = π/2 が z1 を関節 2 の軸へ向けるので、リンクは
x-y 内で動き p13z は恒等的に 0)。捕まえたのは FK 往復で、**目視ではなく検査**である。
θ6 も atan2 の両引数の符号でちょうど π ずれていた — これも「もっともらしい角」だった。

この 2 件は D6 の警告と同じ形をしている: **自己整合な誤りは往復検査を通る。** θ3 が
捕まったのは往復の相手 (FK) を IK と**独立に**固定していたからで、両方を同じ思い込みで
書いていたら 1.149 のまま緑になっていた。だから FK の原点姿勢を手計算で焼く 1 本が要る。

## 参考

- Kelsey P. Hawkins, *Analytic Inverse Kinematics for the Universal Robots UR-5/UR-10 Arms*,
  Georgia Institute of Technology, 2013 (公開技術報告)。
- ros-industrial `universal_robot` の `ur_kinematics` が同じ導出を実装している。
  本実装は式から書き起こしたもので、コードは借用していない。

論証木: `docs/gsn/adr-127-a-known-structure-makes-a-closed-form.gsn`
