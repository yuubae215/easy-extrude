# 087. CF 接地オブジェクトモデルの統一 + ロボット可視性を Outliner の所有下へ (ヘッダートグル撤去)

- Status: Accepted
- Date: 2026-07-22
- Deciders: yuubae215, Claude (pairing)
- Supersedes / Superseded by: なし (ADR-037 / ADR-084 / ADR-085 を統合的に前面化)

## Context — Goal と力学 (§1.2 Goal)

要件は解の形で来た:「全ての外形オブジェクトは CF (CoordinateFrame) を基準に生成
されるべき。ヘッダーのロボット表示切替ボタンは不要。CF を構成しその原点に外形を置く、
という考え方のほうが UI が散らかりにくい」。

これを性質に持ち上げると Goal は二つ:

- **G1 — 一貫した空間的メンタルモデル**: ユーザーが「シーン内の各外形は一つの座標系
  (CF) に接地している」という単一の読み方でシーンを理解できること。キューブとロボットで
  読み方が割れない。
- **G2 — chrome の非散らかり**: 表示状態の制御が実体ごとに一箇所 (原則 #4 / #15) に
  集約され、ヘッダーに実体特化のトグルが増殖しないこと。

力学として重要な既存事実 (この決定はモデルを *作る* のではなく *前面化* する):

- **CF 接地はすでに内部の正本**。ADR-037 で全 Solid は生成時に自動 `Origin` CF を持ち、
  ADR-084/085 でロボットは `robot_base`/`tcp` の CF に完全接地。world pose は全実体で TF
  ツリーから導出される (§1.1 単一幾何源)。したがって「CF 基準生成」はデータモデル上
  すでに成立しており、変えるべきは *オーサリングの見せ方* と *chrome* だけ。
- 直前のバグ修正 (`SelectionManager.showFrameChain` の two-rooting) で、ロボット
  (`robot_base`) やロボット接地フレームも、Solid と同様に「選択 → その CF 軸が出る」よう
  統一された。これで G1 の視覚的裏づけは選択時に成立している。
- ヘッダーのロボット表示トグルは `uiStore.robotVisible` を単独で所有し、スケルトンの
  可視性を握る唯一の経路だった。一方 `robot_base` は Outliner に eye アイコン付きで既に
  現れているのに、その eye は CF 軸しか制御していなかった (スケルトン地の可視性と分離)。

blast radius: `Header.jsx`(ボタン撤去)、`uiStore.robotVisible` / `UIViewBridge.onRobotToggle`
(死配線の除去)、`AppController._setObjectVisible`(robot_base の eye でスケルトンを制御)。
契約 (ワイヤ/DSL) には触れない — これは presentation/chrome 層の決定 (原則 #29)。

## Options considered

- **A: フル CF-first** — 起動時は空シーン。ユーザーがまず CF を作り、その原点に外形を
  載せる。スターターキューブ撤去。tradeoff: モデルは最も統一されるが、Easy Extrude の
  オンボーディングの核 (起動即マニピュレート可能な何かがある) を失い、新規ユーザーの
  ハードルが上がる。Goal の逆方向のコストが大きい。
- **B: 現状維持** — tradeoff: G1(ロボットとキューブで選択時の見え方が割れる — バグ修正
  前) と G2(ヘッダーに実体特化トグル) が未達のまま。
- **C: 中間路線 (採用)** — CF 接地は選択時に前面化 (バグ修正で既達)。スターターキューブは
  *維持* しつつ「Origin フレームに載った外形」として提示。ヘッダーのロボットトグルは
  撤去し、可視性を `robot_base` エンティティの Outliner eye (他の全実体と同じ所有者) へ
  寄せる。tradeoff: オンボーディングを保ちつつ G1/G2 を満たすが、「全外形を CF-first で
  明示生成」までは踏み込まない (内部モデルは既にそうなので、明示 UI 化は別途 YAGNI)。

## Decision — Strategy (§1.2 Strategy)

**案 C。**

1. **ヘッダーのロボット表示切替ボタンを撤去** (`Header.jsx`)。付随して死ぬ
   `uiStore.robotVisible` と `UIViewBridge.onRobotToggle`、`AppController` の
   `onRobotToggle → robotStage.setVisible` 配線を除去 (§1.1 第二の源を残さない)。
2. **ロボットスケルトンの可視性を `robot_base` エンティティの Outliner eye が所有する**
   (原則 #4 — 各表示状態の書き手はちょうど一箇所)。スケルトンは `robot_base` の
   *幾何* (ADR-084 §2) なので、その実体の eye が幾何ごと表示/非表示を握るのが自然。
   `AppController._setObjectVisible(id, visible)` が `id === robot_base` を検知して
   `robotStage.setVisible(visible)` も駆動する (CF 軸は既存の `service.setObjectVisible`
   が担う)。
3. **スターターキューブは維持** (Easy Extrude のオンボーディング)。CF-first の空シーンには
   しない — CF 接地は選択時の前面化と Origin CF の常在 (ADR-037) で概念的に成立済み。

「CF を構成しその原点に外形を置く」という明示オーサリングフロー (フル CF-first, 案 A) は
本 ADR のスコープ外とする (将来要件が立てば別 ADR)。

## Consequences — Evidence と tradeoff (§1.2 Evidence)

- 肯定的: G1 — キューブもロボットも「選択するとその接地 CF が出る」で読み方が統一。
  G2 — 可視性制御が実体ごとに Outliner eye 一箇所に集約 (#4/#15)、ヘッダーから実体特化
  chrome が消える。死状態 `robotVisible` の除去で第二の源が一つ減る (§1.1)。
- 受け入れるコスト: ロボットの表示切替が「ヘッダーの目立つボタン」から「Outliner の
  eye」に移り発見性はやや下がる。ただし他の全実体と同じ場所なので学習は一度きり
  (原則 #16 の対象は二次操作であり、ここは一次的な可視性トグルの一貫配置を優先)。
- 検証 (証拠):
  - `src/domain/robotFrames.test.js` — `isRobotBaseFrame` が world 直付けの root
    robot_base のみを true とし、tcp / 非 root / 他名 / nullish を false とすることを検証
    (`_setObjectVisible` と `_syncRobotStage` はこの述語を共有 = §1.1 単一定義)。
    `AppController` は JSON import 属性の都合で `node --test` 直 import 不可のため、
    可視性ルーティングの核である述語を純粋ユニットとして検証する方式を採る。
  - `grep` で `robotVisible` / `onRobotToggle` の参照が 0 になったこと (死配線除去の証拠)。
  - JS 全テスト `node --test "src/**/*.test.js"` green、`tsc --noEmit` clean。
- 波及 (blast radius): `Header.jsx`, `uiStore.js`, `UIViewBridge.js`,
  `AppController.js`(`_setObjectVisible` / 旧 line 740 除去)。契約・DSL・core/ は不変。

## Lens notes

- **層 + 契約**: 本決定は view/chrome 層に閉じる。ワイヤ契約 (grasp-contract) にも
  Layout DSL にも触れない — presentation はクライアントで導出 (原則 #29 / CLAUDE.md
  「統治」)。ゆえに contractVersion bump 不要。
- **原則 #4 (Every Visual Flag Has One Owner)**: 「ロボットが見えているか」の書き手を
  ヘッダートグルと Outliner eye の二経路から `robot_base` の eye 一つへ収斂させる、が
  本決定の核。
- **状態機械**: `robotVisible` は 2 状態の単純フラグで不正遷移が事故にならない (§1.4 の
  発動条件未満) ため状態機械化は不要 — むしろ実体 (`robot_base`) の可視性へ吸収して
  独立フラグを消す方向が正しい。
