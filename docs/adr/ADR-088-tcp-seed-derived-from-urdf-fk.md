# 088. robot_base→tcp の既定 seed を URDF スケルトンの FK から導出する（真実の源を URDF に一本化）

- Status: Proposed
- Date: 2026-07-23
- Deciders: yuubae215, Claude
- Supersedes / Superseded by: なし（ADR-084 §2 / ADR-085 の tcp seed 実装を精緻化）

## Context — Goal と力学（§1.2 Goal）

**達成したい性質**: 「ロボットの工具点（tcp フレーム）の既定位置は、可視化されている
アームの手先（フランジ）と常に一致する」を、**人手の同期に依存せず**構造的に保証する。

現状（ADR-084 §2 / ADR-085 の実装、本ブランチで tcp をベースから手先へ移した直後）は
この性質を **手作業で** 満たしている：

- スケルトンの運動学は `public/robot/skeleton_arm.urdf`（UR5e リンク変換）に在る。
- レストポーズ（関節角）は view 層の `RobotStage._applyRestPose` に在る。
- tcp の既定ローカル位置は `ROBOT_FRAME_DEFAULTS[tcp] = (-0.717,-0.133,0.346)` という
  **定数**で、これは上二つから私がオフラインで計算した順運動学（FK）の**出力を書き写した値**。

ここに §1.1（真実の源は一つ）違反の芽がある。フランジ位置という一つの事実が
「URDF＋レストポーズ（本来の源）」と「手写しの定数（第二の源）」の二箇所に在り、
**URDF かレストポーズを変えると定数が黙ってズレる**（tcp が手先から外れるが、テストも型も
検知しない — silent drift、PHILOSOPHY #11 の構造的失敗形）。コメントで「coupled pair、
変えたら再計算」と縛っているのは、規律を人手に外注している状態にほかならない。

**この決定が許される前提（ガードの正確な読み）**: FK を `src/` で計算することは
スコープ内である。CLAUDE.md の AI 向けガード「解法は `core/`」が守るのは
**grasp-search の判定エンジン**（候補生成→段階フィルタ〔リーチ/IK/把持性/可視性/干渉〕→
加重スコア、decide/propose の動詞境界）であって、**可視化のための FK 一般ではない**。
純粋 FK は既に `src/robotics/Kinematics.js`（`forwardKinematics(chain, q)`）に存在し、
ADR-053 §3 が「初期形はこれ」と明示的に bless している（重い総当たり/Monte-Carlo は
BFF `ComputeBackend`、FK・可視化ループはフロント、という ADR-053 の非対称）。本 ADR は
その FK を seed 導出に再利用するだけで、新しい解法を `src/` に持ち込まない。

**層マップ上の位置**: 影響は フロント（`src/`）内に閉じる。契約（`packages/grasp-contract`）は
不変 — tcp の**向き**だけがワイヤに載る（`tcpOrientation`、GraspController）ため、既定
**位置**の導出方法を変えても response/request いずれのスキーマにも触れない。

## Options considered

- **A: レストポーズ + スケルトン運動学を JS の `chain` データとして持ち、`forwardKinematics`
  で毎回導出。** tradeoff: URDF の関節原点を JS 側にも書くことになり、**URDF と JS chain の
  二重管理**が生まれる。手写し定数を消す代わりに、より広い（全関節原点の）第二の源を作る
  ので §1.1 違反がむしろ悪化。**却下。**

- **B: 真実の源を URDF に一本化し、URDF を解析して `chain` を得て `forwardKinematics` で
  導出。**（本命） tradeoff: URDF テキストの解析経路と、レストポーズの置き場所の整理が要る
  （下記コストへ）。ただし関節運動学の権威は URDF ただ一つに保たれる。

- **C: 現状維持（定数 + 「変えたら再計算」コメント）。** tradeoff: 実装ゼロだが §1.1 の
  silent drift 芽が残る。将来 URDF やレストポーズを触る人（＝ロボットを差し替える最も
  自然な変更）が、無関係に見える定数を直し忘れて tcp が手先から外れる。**却下。**

## Decision — Strategy（§1.2 Strategy）

**B を採る。tcp の既定 seed を「URDF（唯一の運動学ソース）＋共有レストポーズ」からの
純粋 FK として導出し、書き写しの定数を廃する。**

1. **URDF を単一ソースに保つ。** `public/robot/skeleton_arm.urdf` をビルド時に文字列として
   バンドル（Vite `?raw` import）し、実行時 fetch を避ける。RobotStage は従来どおり
   urdf-loader で同じファイルを描画に使う（描画も seed も同一ソースから導出 — §1.1）。

2. **純粋な URDF→chain パーサを `src/robotics/` に新設。** URDF の `<joint>` 群を
   `forwardKinematics` が要求する `{ joints:[{type,axis,origin:{xyz,rpy}}], tcp? }` 形へ
   写す小さな純関数（THREE 非依存・DOM 非依存 = `node --test` 可）。urdf-loader は THREE
   オブジェクトを生むため test lane で使えない＝この用途には別の純パーサが正しい。対象は
   自前の統制された URDF サブセットのみ（box/cylinder/revolute）なので小さく保てる。

3. **レストポーズを共有データへ持ち上げる。** 現在 `RobotStage._applyRestPose` にのみ在る
   関節角を、両者（RobotStage の描画・seed の FK）が読む一つの定数（`robotFrames.js` 近傍の
   ロボット構成データ）にする。これでフランジの二入力（運動学＝URDF、姿勢＝レストポーズ）が
   それぞれ単一ソースになる。

4. **seed を導出値として明示する。** `SceneService.ensureRobotFrames` は
   `forwardKinematics(parseUrdfChain(urdfText), restPose)` の位置を tcp のローカル
   translation に設定する。`ROBOT_FRAME_DEFAULTS[tcp].position` の**手写し定数は削除**
   （向きは identity のまま — ワイヤ契約不変）。導出はバンドル文字列の同期パースで済み、
   ensureRobotFrames の同期性を壊さない。

## Consequences — Evidence と tradeoff（§1.2 Evidence）

- **肯定的**: フランジ位置の権威が URDF＋レストポーズの一箇所に戻る。ロボットを差し替える
  （URDF 変更）／レストポーズを変える、いずれでも tcp が自動追従し、手写し定数の再計算義務が
  消える。将来 UR5e→他機種の URDF 差し替えが「ファイル 1 つの入れ替え＋レストポーズ調整」で
  完結し、離れた定数を直し忘れるクラスのバグが**構造的に**発生しなくなる。

- **受け入れるコスト / 否定的**: (1) 小さな URDF パーサを新規に持つ保守対象が増える
  （ただし自前サブセット限定）。(2) レストポーズを view から共有データへ移す小リファクタが要る。
  (3) パーサは自前 URDF の書式前提なので、外部の任意 URDF には未対応（意図的スコープ — 
  一般 URDF 対応は非目標）。

- **検証（証拠、実装フェーズで満たす）**:
  - `parseUrdfChain` の単体テスト（`skeleton_arm.urdf` → 期待 chain）＋
    `forwardKinematics(chain, restPose)` のフランジ位置が現行 seed `(-0.717,-0.133,0.346)` と
    一致（本ブランチで urdf-loader 実レンダリングと一致を実測済 — この値が回帰の基準）。
  - レストポーズを変えた fixture で「seed が追従し、手写し定数が残っていない」ことを固定。
  - 既存 `GraspController.test`（`tcpOrientation:[0,0,0,1]` / `base:[-2,2,0]`）が不変で
    通ること＝ワイヤ契約への非波及の証拠。
  - 全 JS スイート green + `vite build` クリーン。
  - ※ 現時点では上記は未実行（Proposed）。Accepted 後に実装フェーズで満たす。

- **波及（blast radius）**: `src/robotics/`（新パーサ）, `src/domain/robotFrames.js`
  （tcp 定数削除＋レストポーズ定数化）, `src/view/RobotStage.js`（共有レストポーズを読む）,
  `src/service/SceneService.js`（ensureRobotFrames の seed 導出）。契約パッケージ・BFF・
  `core/`・response/request スキーマには**非波及**。

## Lens notes

- **§1.1（真実の源は一つ）が本 ADR の主レンズ。** 決定の全体が「フランジ位置の第二の源
  （手写し定数）を消し、URDF＋レストポーズという本来の源に一本化する」の一点。Option A が
  却下なのは、第二の源を狭い定数からより広い JS chain へ**移すだけで消していない**ため。
- **依存方向（Clean Arch）**: 導出を service 層の純関数呼び出しに置くことで、domain（tcp 実体）が
  view（THREE スケルトン）に依存する矢印を作らずに済む。FK は純粋計算なので domain 純度も保つ。
- **黒箱**: `forwardKinematics` の入力→出力（chain＋q → SE(3) pose）と不変条件は既存テストで
  特性化済み。本 ADR はその境界の内側に手を入れない（再利用のみ）。
- **ガード明確化の記録**: 「FK-for-visualization はフロント可、grasp-search の解法は `core/`」の
  区別を Context に明記した（ADR-053 の非対称の再確認）。これは CLAUDE.md ガードの*読み*の
  精緻化であり、ガード自体の緩和ではない（PHILOSOPHY #19 documentation drift の是正）。
