# 059. Grasp 候補の空間ゴースト — 数値を「掴める姿」に翻訳する（段階化）

- Status: Proposed（追記 2026-07-01: 門1 は upstream 実装済みとユーザ確認 — 下記参照。段1 の実装自体はまだ未着手のため Status は Proposed のまま）
- Date: 2026-06-30
- Deciders: yuubae215, Claude
- Supersedes / Superseded by: なし
- References: ADR-057（Grasp UI — score-first / G3 を deferred）, ADR-053（ロボティクス測定器 / urdf-loader を deferred / `Kinematics.js` FK）, ADR-047（ゴースト系譜の視覚語彙）, ADR-054（UI→DSL→BFF→grasp）, ADR-045（Layout DSL = 宣言と幾何）, ADR-060（pose の kind 判別 union — 門1 の構造。2026-07-01 upstream 実装済みと確認）, grasp-contract（response `pose` の所有 — 上流）

**追記（2026-07-01）**: ユーザが upstream `@easy-extrude/grasp-contract` の実ファイルを提示し、
門1（`pose` の `kind:'endEffector'`/`kind:'jointSpace'` union）が**実装・merge 済み**である
ことを確認した（詳細は ADR-060「実スキーマ確定」節）。ただし (a) `position`/`orientation` は
**配列形**（ADR-060 が当初示した擬似コードのオブジェクト形ではない — 消費コードは配列で
読む）、(b) `frame` の基準系（world か base link か）は upstream スキーマの記述でも
**未確定のまま**（段1 実装前に要確認・要仮置き）、(c) 本セッションはネットワーク制限で
`vendor/grasp-contract` submodule を pull できず、本リポジトリ側の pin 更新・型再生成・
消費コードは**まだ着手していない**。よって門1 は「上流で解除された」が「本リポジトリで
消費できる状態」にはまだない — 段1 の実装着手は次のいずれかを待つ: submodule pin 更新
（ネットワークアクセス可能な環境から）、または少なくとも `frame` 基準系の確認。

## Context — Goal と力学（§1.2 Goal）

ADR-057 は grasp 結果を score-first（`objectiveScores` バー）で出し、**空間価値 G3（候補→3D 姿勢）
は依存ブロックゆえ deferred** とした。本 ADR はその G3 を扱う。

要件は「フルゴースト」という解の形で来た。§1.2 で *性質* へ持ち上げる:

**Goal**: grasp 候補という *opaque で数値的* な出力を、ユーザが直感的に把握できる
**「どこを・どの向きから掴むか」の felt な空間的答え**に翻訳し、UI を「触ってみたくなる」
ものにする。数値は感覚に翻訳されない — ゴーストが現れ手先が対象へ寄る視覚は、API の価値を
体感に変える（ADR-047 が既にゴーストを価値にしている延長）。Goal は「ロボットを描く」ことでは
なく「空間的直感を立てる」こと（だから段階化で安い段を先に払える）。

**観測（§2 Observe、実コード）**:
- クライアントに**ロボットモデルが無い**: `src/robotics/Kinematics.js` に FK の*計算*
  （`forwardKinematics(chain, q)`）は在るが、入力の **リンクツリー・リンクメッシュ・
  シーン内ベース姿勢が無い**（examples/layout に robot link tree 無し）。
- 契約 `response.pose` は **opaque**（`$defs.poseCandidate.pose` = `additionalProperties:true`,
  "shape owned by the service implementation"）。候補の TCP 姿勢も関節値も既知形で来る保証が無い。
- ADR-057 の FSM は既に `selectedRank`（候補選択席）を用意済 — ゴーストの**接続点**はある。

**二つの門（律速）**:
- **門1 — 契約の姿勢フィールド（上流所有, §1.1）**: ゴーストには候補の姿勢が *既知の型*で
  要る。今は opaque。上流 `@easy-extrude/grasp-contract` が `pose` を **kind 判別の有界 union**
  へ移行し（ADR-060: 段1=`kind:'endEffector'` の手先 frame、段2=`kind:'jointSpace'` の関節値）
  `contractVersion` を上げる必要がある。**これは `optional` 兄弟の追加ではない** — 命名は意味で
  （`endEffector.frame`）、成長は kind 追加＝版上げの意図的行為に統治される（PHILOSOPHY #29）。
  **本リポジトリは契約を定義しない** — 追加後の型を *消費* するだけ。UI は型付き契約フィールド
  のみ読み、opaque へ手を伸ばさない（§1.3 黒箱）。
- **門2 — ロボットモデルの出所（段2 のみ）**: 多関節ゴーストはリンクツリー＋幾何＋ベース姿勢が
  クライアントに要る。**これはスコープ内**（ロボット幾何は「宣言と幾何」であって制約解法では
  ない — ADR-045）: Layout DSL/シーンがロボットを宣言として持てばよい（ADR-053 が deferred に
  した urdf-loader 経路）。段1（手先だけ）は門2 を要しない。

## Options considered

- **A: 段1（TCP/グリッパゴースト）→ 段2（多関節）の段階化【採用】** — tradeoff: 安い段を先に
  払い直感を早く立てる。段2 は門2 を別途要する。
- B: 一気に多関節ロボット（urdf-loader） — tradeoff: 価値最大だが門1（関節値）＋門2（モデル）を
  同時に払う重さ。最初の体感が遠い。
- C: 3D をやらず score 止まり — tradeoff: 痛み（数値は感覚に翻訳されない）が残る。Goal 不達。

段2 のライブラリ副選択（採用後に決める）:
- **urdf-loader**（gkjohnson, three-mesh-bvh と同作者・MIT・Three.js ネイティブ）= 本物 URDF＋
  メッシュ忠実。`setJointValue` で姿勢付け（描画用 FK 自前不要）。
- **自前・様式化** = 既存 `Kinematics.js` FK ＋プリミティブ（箱/円柱）でリンクを様式描画。
  資産パイプライン不要・**ゲーム調に映える**。写実忠実が要らなければこちらが軽い。

## Decision — Strategy（§1.2 Strategy）

**A（段階化）** を採る。

1. **段1 — TCP/グリッパゴースト（先）**: 門1 の *軽い形* だけ要する = 上流が `pose` の
   **`kind:'endEffector'` 枝**（`frame: { position, orientation }`、ADR-060）を提供し
   `contractVersion` を上げる。UI はそれを読み、**様式化グリッパ・グリフ＋接近方向ベクトル**を
   手先 frame に置き、**掴む対象をハイライト**。接近ベクトルは frame ＋規約から*クライアント導出*
   （ワイヤに足さない — PHILOSOPHY #29）。ロボット全身もメッシュも urdf-loader も**不要**
   （変換ひとつ）。ADR-057 の `selectCandidate(rank)`/`selectedRank` がドライバ — 候補を
   hover/選択するとゴーストがフェードインし、空間的に「どこを・どの向きから」が立つ。

2. **段2 — 多関節ゴースト（後）**: 門1（関節値＋関節順）＋門2（クライアントのロボットモデル）を
   要する。姿勢付けは **既存 `Kinematics.js`（様式化プリミティブ）** か **urdf-loader（本物）**。
   腕が対象へ伸びるアニメ＝最大の体感。門2 のロボット宣言（Layout DSL のロボットエンティティ）は
   それ自体が成果物で、別 ADR に切り出す余地。

3. **所有と対称性**: ゴーストは専用ビュー `GraspGhostView`（読み取り専用 = ADR-047 の*出力*射影、
   `RegionGhostView`/`UncertaintyGhostView` と同族）に置き、`GraspController` が**単独所有**
   （選択時に生成・`exit`/`contextEnd` で破棄 — PHILOSOPHY #4/#9）。3D 副作用はここだけ。

4. **スコープ規律**: UI は宣言と表示のみ・解かない。姿勢は *型付き契約フィールド*から読み、
   opaque pose に触れない（門1 が満たされるまでゴーストを出さない・偽の姿勢を捏造しない —
   PHILOSOPHY #11 / §1.3）。

**変える/新設する契約**: 本リポジトリでは **なし**。門1 は *上流*での pose kind union 化（ADR-060）＋
`contractVersion` 上げ（ここでは消費するだけ）。門2 の robot 宣言は Layout DSL の追加（別 ADR 候補）。

## State machine（§1.4 の適用判定）

新規 FSM は**起こさない**。ゴーストは ADR-057 の `GraspState`（`results.selectedRank`）から
*導出される射影*に過ぎず、不正遷移でデータ破損は起きない（§1.4 発動条件を満たさない →
§5 過剰モデリング禁止）。接続席（`selectedRank`）は既存。段1/段2 の差は門の充足度で決まる
能力ゲートであって状態ではない。

## Consequences — Evidence と tradeoff（§1.2 Evidence）

**肯定的**:
- 候補が「掴める姿」になり直感が立つ（Goal）。ADR-057 G3 を埋める。
- 段1 は変換ひとつで安い（門1 の軽い形のみ、門2 不要）。最初の体感が早い。
- ゴースト系譜（ADR-047）と既存 `Kinematics.js` FK を再利用。3D 所有は 1 ビューに閉じる。

**受け入れるコスト / 否定的**:
- 門1 は**上流契約変更**が要る（本リポジトリ外の調整コスト。満たされるまで段1 も出せない）。
- 段2 は門2（Layout DSL のロボット宣言＝新規宣言作業）＋ urdf-loader 依存 *または* 様式化
  レンダラ＋アニメ調整。
- 「近いロボットモデルが無い」段2 は門2 が払われるまで未提供（正直に保留 — PHILOSOPHY #11）。

**検証（証拠）**:
- `Kinematics.js` FK は既存テスト下（`Robotics.test.js`）— 段2 の姿勢計算は再利用可能。
- 段1 は変換＋グリフのビューで、TCP 入力を与えれば単体検証可能。
- **未充足（明示, §5、2026-07-01 更新）**: 門1 自体は upstream 実装済みとユーザ確認済み
  （ADR-060 参照）だが、(a) 本セッションはネットワーク制限で `vendor/grasp-contract` を
  pull できず本リポジトリの submodule pin・型再生成・消費コードは未着手、(b) `frame` の
  基準系（world/base link）が upstream 記述でも未確定、の 2 点が段1 実装着手の残りの
  前提。この 2 点が解消されてから段1 に入る、が正しい順序（証拠なき完了禁止）。

**波及（blast radius）**:
- 上流 `grasp-contract`（門1: pose の kind union 化 ADR-060 ＋ `contractVersion`）— **ここでは変えず調整**。
- 新規 `src/view/GraspGhostView.js`（段1: グリッパ/TCP グリフ）。
- `src/controller/GraspController.js`（`selectCandidate` → ゴースト生成/破棄の配線）。
- 段2: Layout DSL のロボット宣言（別 ADR 候補）、urdf-loader 採否、`Kinematics.js` 様式化レンダラ。
- examples（ロボットを含む例）。Docs: README index, CLAUDE.md, CODE_CONTRACTS, SCREEN_DESIGN。
  ADR-057/053 の References に相互リンク。

## Lens notes

- **§1.1 真実の源は一つ**: 契約は上流所有（門1 は上流で・ここは消費）。ロボット幾何は Layout DSL に
  宣言（門2、宣言層ゆえ in-scope）。ゴーストの接続席は `selectedRank` 一点。
- **§1.3 黒箱/契約**: 型付き契約フィールドのみ読み、opaque pose に触れない。門1 未充足なら出さない。
- **§1.4 / §5**: 新 FSM を起こさず、ゴーストは `selectedRank` の導出射影。過剰モデリング禁止。
- **§1.2 Goal と解の分離**: 「ロボットを描く」でなく「空間的直感を立てる」へ。段階化で安い段
  （TCP ゴースト）を先に払い、フル多関節は門が揃ってから。
