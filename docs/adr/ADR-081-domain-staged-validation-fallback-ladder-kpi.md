# ADR-081: ドメイン段階バリデーション (見える/届く/掴める) + 運用フォールバック階梯の設計時 KPI 検証

- Status: Accepted (Phase 1-3 実装済 2026-07-20 — §実施記録。Phase 3 の宣言 UI
  (3 ドメインカード / プリセット fork&tweak / カメラ写し取り) は同日の追記で完了。
  残: pick-sequence 集計レポート UI と Phase 4、Open 節の収束仮説)
- Date: 2026-07-19
- Deciders: yuubae215 (product) / 設計セッション
- Supersedes / Superseded by: なし (ADR-075 のパイプラインを拡張、ADR-079 の診断を一般化)
- 論証木 (GSN): `docs/gsn/adr-081-grasp-validation.gsn` — 本 ADR の Goal 到達は複数
  イテレーションを前提とするため、正当化の鎖 (§1.2) を証拠実行可能な GSN 論証木として
  外部化し、`/gsn-maintain` で証拠の鮮度を更新しながら育てる (仮説の反証・修正も同木に記録)
- 関連: ADR-049 (Requirement/Conflict — KPI/criterion/許容領域) /
  ADR-053 (ロボティクス KPI メソッド — KPI を埋める測定器) /
  ADR-057 (Grasp Search UI) / ADR-061 (Diagnostics ファネル UI) /
  ADR-063 (選択優先インテーク) / ADR-074 (BFF <-> コアAPI 契約) /
  ADR-075 (段階0 判定エンジン) / ADR-076 (HTTP 境界) /
  ADR-078 (bin-picking シーン層) / ADR-079 (判定の証明 funnel + near-miss)

## Context — Goal と力学 (§1.2 Goal)

### Goal を解の形から性質へ持ち上げる

きっかけの要件は「grasp search テンプレの精度を上げたい / UI で入力しやすくしたい /
バックエンドに grasp ロジック (Vision・Motion・Grasping のバリデーション) を入れたい」
という *解の形* で来た。持ち上げると、達成したい性質は一つに合流する:

> **Goal: ロボットオペレーションの実ラインでの出戻り (rework) を、設計時の通し検証で
> 最小化できること。** ユーザがレイアウト + ロボット + カメラ + グリッパを設定し終えた
> 時点で、ピッキング操作の成立性が 3 ドメイン — **見えるか (Vision) / 届くか
> (Path・Motion) / 掴めるか (Grasping)** — で通しで検証され、各ドメインの KPI
> (マージン) から「運用で どの深さのフォールバックまで戻るリスクがあるか」が読めること。

テンプレ精度・UI 入力性・バリデーション追加は、いずれもこの Goal の Strategy である
(それぞれ「検証の基準器を正しくする」「検証入力の宣言コストを下げる」「検証の判定能力
そのものを作る」)。

### 運用フォールバック階梯 — 「出戻りの深さ」がコストの単位

実ラインのロボットオペレーションプログラムは、失敗時にフォールバック戦略を階梯
(はしご) 状に駆け上がる。**戻る距離がそのままコスト**であり、最悪はレイアウト再設計まで
戻る:

| 階梯 | 運用時フォールバック | 出戻りコスト | 失敗が露見するドメイン |
|------|----------------------|--------------|------------------------|
| L1 | 同一対象の次候補姿勢で再試行 (topN の 2 位以下) | 秒 | どれでも |
| L2 | 次の対象へ移る (最上面順の次ワーク) | 秒〜分 | どれでも |
| L3 | 再認識・再撮像 (Vision リトライ、ビン揺すり等) | 分 | 見えるか |
| L4 | 動作パラメータ変更 (進入角・速度・退避点の教示し直し) | 時間 | 届くか / 掴めるか |
| L5 | 機器再配置 (基台位置・カメラ姿勢・治具・グリッパ交換) | 日 | 全ドメイン |
| L6 | レイアウト / セル再設計 | 週 | 全ドメイン (同時成立が不能) |

構造的観察が 3 つある:

1. **L1〜L3 は運用プログラムが自動で吸収すべき層**であり、実行時の正常な振る舞いに属する。
   一方 **L4 以上に達する失敗は、設計時に潰せたはずの失敗**である。本アプリの検証目標は
   「L4+ リスクの設計時可視化」に定まる。
2. **どの階梯まで戻るかは、どのドメインの余裕 (マージン) が薄いかで予報できる。**
   例: reach margin が 2cm しかない設定は、ワーク位置の分散でリーチ縁を割った瞬間に
   L5 (基台再配置) 行きになる。可視率が 100% ぎりぎりの設定はビンが進むと L3 常連になり、
   タクトを食う。つまり **ドメイン別 KPI = 階梯リスクの予報値**。
3. **これは ADR-049 の KPI/criterion モデルの適用例そのもの**である。ドメイン検証の
   ファネル・near-miss (ソルバが決定した事実) から KPI を導出し、クライテリア (合格
   ライン) と突き合わせ、gap を階梯リスクとして提示する — 「要求の正体は KPI + クライ
   テリア」(ADR-049 §1) の grasp search への具体化。

### 現状の欠落 (段階0 エンジンの判定能力)

段階0 パイプライン (ADR-075: 候補生成 → リーチ → IK → 干渉 → 加重和スコア) を
3 ドメインへ写像すると:

| ドメイン | 現状 | 欠落 |
|----------|------|------|
| 見えるか (Vision) | **不在**。カメラのモデルがどこにもない | scene 層の top_z 順 (ADR-078) が「上 = 見える」の暗黙の代理をしているだけ。遮蔽の判定も可視率の測定も不能 |
| 届くか (Path・Motion) | 素朴版あり: リーチ球殻 (純粋) + naive IK (手首コーン) + 線分-球干渉。いずれも注入 Protocol 済み | 実 IK (関節限界・特異点) とメッシュ干渉は差し替え待ち。経路は pre_grasp→把持点の直線 1 本のみ |
| 掴めるか (Grasping) | **ハードゲート無し**。`grasp_stability` は soft スコア (法線と進入の内積) のみ | 開口幅・指クリアランス・対向面 (antipodal)・力閉包 (wrench cone) の判定が無い。「幾何的に掴めない」候補が上位に載り得る |

加えてテンプレ (`templates/bin-picking-thin-container/`) は障害物 12 個を**手書き**して
おり (ADR-078 が既に指摘した精度劣化の主因)、UI (`GraspSearchPanel`) の入力は生の数値
3 個 (reach/clearance/topN) で、カメラもグリッパも宣言できない。診断 (ADR-079) は
reach near-miss のみでドメイン別の「惜しさ」が測れない。

### 統治上の前提 (変えない壁)

- 解法 (可視性・IK・干渉・把持性の *解き方*) は `core/` のみ。フロントは DSL で参照名を
  宣言し、結果を契約経由で受け取る (CLAUDE.md スコープ境界)。
- ワイヤに載せるのは「ソルバが決定した事実」のみ。KPI の提示・階梯マッピング・演出は
  クライアント導出 (PHILOSOPHY #29 / ADR-060/079)。
- 契約の変更は正本 (`packages/grasp-contract` — ADR-082 で repo 内へ吸収済み) で
  contractVersion bump とともに行う (ADR-074/082。本 ADR 初稿の「上流 (外部 repo) で変更」
  は ADR-082 により「repo 内正本で版上げとともに変更」へ読み替え — 手順が同一 PR で
  完結する以外、統治は不変)。
- **リクエスト側とレスポンス側で統治が異なる**: `graspSearch` 宣言は open payload で
  厳密形は Layout DSL 正本 (layoutVersion) に属する。一方レスポンスの `ScoreBreakdown` /
  `diagnostics` は閉 (additionalProperties:false) で contractVersion 統治。→ camera /
  gripper の**宣言追加は契約版上げ不要**、**判定結果の露出は v4 版上げが必要**。

## Options considered

- **A: soft スコアの強化のみ (バリデーションを増やさない)**
  — tradeoff: 掴めない・見えない候補がスコア上位に混ざり続け、「なぜダメか」の事実が
  ファネルに現れない。KPI の分母 (棄却段別集計) が作れず階梯リスクが予報できない。却下。
- **B: ドメイン段階バリデーション (注入 Protocol の増段) + ファネル/near-miss のドメイン
  拡張 + KPI は ADR-049/053 の既存モデルに接続 (採用)**
  — tradeoff: 上流契約 v4 の版上げと BFF/UI の追従が要る。ただし ADR-079 (v3) と同じ
  「コア実装先行 → 上流版上げ → 消費追従」の順序で段階摘出できる。
- **C: 運用フォールバックをエンジンに内蔵する (全滅時の自動緩和・自動リトライをコアが実行)**
  — tradeoff: `visible: true` 等の wire 上のブールの意味が壊れる (緩和後の true と厳格な
  true が区別不能 = 決定事実の統治違反)。緩和は「パラメータを変えた新しいクエリ」として
  ユーザ判断に返すのが ADR-079 の思想 (無言の失敗禁止 #11 の双対: 無言の成功も禁止)。
  L1/L2 の運用フォールバックは既存機構 (topN = 「1位がダメな時のフォールバック」、
  pick-sequence の最上面順 = 「次の対象」) が既に正しい置き場を持つ。却下。
- **D: 現状維持** — tradeoff: 出戻りは実ラインで発覚し続ける。テンプレは「届くか」しか
  固定できず、掴めない候補を上位に返すツールに検証の商品価値は立たない。却下。

## Decision — Strategy (§1.2 Strategy)

### 1. パイプラインをドメイン段階に増段する (core/engine)

```
候補生成 → リーチ → 可視性(Vision) → IK → 干渉(Path) → 把持性(Grasp) → 加重和スコア → 上位N
```

- **安い順フィルタの原則 (ADR-075) を保つ**。挿入位置は naive 実装のコスト実測で確定し、
  実ソルバ差し替え時に再測する (可視性 naive は線分-球で干渉と同コスト帯、把持性 naive は
  幅比較 + サンプル対探索)。短絡棄却により棄却段は排他 — ファネル恒等式
  `generated = Σ rejected_by_* + feasible` は段が増えても保つ (テストで固定)。
- **各段は注入 Protocol + 外部依存ゼロの naive 既定** (既存 `IkSolver` /
  `CollisionChecker` パターンの一般化):
  - `VisibilityChecker` (新設): naive 既定 = カメラ位置→把持点の線分が障害物球に遮られ
    ないか (`distance_point_to_segment` 再利用)。カメラは `graspSearch` 宣言の `camera`
    (位置 + 任意で視軸/FOV) から読む。
  - `IkSolver` / `CollisionChecker` (既存): Protocol 不変のまま実装差し替えで精度向上
    (実 IK・カプセル/メッシュ干渉)。契約に出るのは bool と 0-1 値のみなので境界不変。
  - `GraspChecker` (新設): naive 既定 = グリッパ開口幅 ≥ 対象幅 + 指進入クリアランス +
    対向面 (antipodal) 対の存在、の幾何判定。グリッパは宣言の `gripper` (開口幅・指幅・
    指長) から読む。
- **ハードゲートと soft スコアの二層は保つ**: 掴める/掴めないは `GraspChecker` (ゲート)、
  どれくらい安定かは `grasp_stability` (objective)。後者の raw は wrench cone へ差し替える
  (ADR-075 予約済み、`OBJECTIVE_REGISTRY` 内で完結・契約不変)。
- **可視性はエンティティ粒度も持つ** (scene 層, ADR-078): 「そもそもカメラから見えない
  ワーク」は `targetable_entities` の絞り込みで対象候補から除く。候補粒度 (その把持点が
  見えるか) は engine のフィルタ段。top_z 順という代理が、カメラ宣言に基づく判定に昇格する。

### 2. 契約 v4 — 判定結果のドメイン露出 (上流変更の申し送り)

ADR-079 (v3) と同じ順序: **コア実装 + テスト先行 → 上流 Schema v4 → BFF/UI 追従**。

- `ScoreBreakdown` に `visible` / `graspable` を追加 (閉層なので上流でのみ変更可)。
- `diagnostics` に `rejectedByVisibility` / `rejectedByGrasp` を追加し恒等式を 5 段に拡張。
- **near-miss をドメイン別に一般化**: 既存 `reachNearestMiss` に加え、遮蔽マージン
  (可視棄却候補の最小遮蔽量) / 開口不足量 (幅棄却候補の最小不足幅) を追加。いずれも
  「幾何の決定事実」であり演出ではない (ADR-079 の包含テストを継承)。正式名は上流で確定。
- Layout DSL の hardConstraints 参照名に `visible` / `graspable` を追加 (layoutVersion 側)。
- `camera` / `gripper` の**宣言追加はリクエスト側 open payload** = layoutVersion 統治。
  contractVersion は上げない (エンジンは `robot`/`sampling` と同様に既知キーを寛容に読む)。

### 3. KPI 接続 — ファネル事実から階梯リスクへの決定的導出 (front)

- ドメイン KPI は ADR-049 の語彙 (KPI = 評価関数 / criterion = 合格条件) で表す。
  KPI 値はワイヤの事実からの**決定的導出**: 例
  可視率 = 1 − rejectedByVisibility / generated、リーチ余裕 = reach_margin 分布の下限、
  候補の厚み = feasible 数とスコア分布。導出はフロントの純粋関数
  (`GraspFunnelMath` の系譜) — 第二の源にしない (導出と明示, 核 §1.1)。
- **フォールバック階梯は KPI → 階梯リスクの純粋写像 (表引き)** としてフロントに置く。
  「どの KPI がどの criterion を割ると、運用でどの階梯まで戻るか」の対応表 = 提示層。
  embedding 等の曖昧写像は不要 (決定的 core の in-scope、propose レーン不使用)。
- **通し検証 = pick-sequence レポート**: ADR-078 の `POST /pick-sequence` で全ピックを
  回し、ピックごとのドメイン KPI を集計した「設定の健康診断」を検証の完了形とする。
  1 ピックの単発検索 (ADR-057) はその部分ビュー。
- 注意: ここで定義するのは KPI の**測り方**まで。イテレーションの**収束判定** (単側
  KPI では収束しない懸念と双対対の一致仮説) は未決であり「Open — KPI の双対性と
  収束仮説」節に隔離する。

### 4. テンプレ精度 — 基準器を手書きから導出へ

- テンプレを **scene 形式へ移行** (obstacles 手書き廃止 — ADR-078 Decision 2 の導出式で
  組む)。手書き再構築こそが現テンプレの精度劣化の主因であり、最も安い精度向上。
- テンプレに `camera` / `gripper` 宣言を追加し、README の手検証値を
  「見える/届く/掴めるを確認済み」の 3 ドメインへ拡張。`core/tests/test_templates.py` が
  新ファネル恒等式と KPI 期待値を受け入れテストとして固定する。
  **判定段の追加とテンプレ拡張は同じコミット系列で進める** (テンプレは新ドメインの
  受け入れフィクスチャを兼ねるため)。

### 5. UI — 宣言を選ばせ、診断で誘導する (ADR-057/061/063 の延長)

- 入力は **3 ドメインカード (見える/届く/掴める)** に再編: 各カードに有効トグルと最小
  パラメータのみ。ロボット・グリッパ・カメラは**プリセット選択 + fork & tweak**
  (ADR-063 の白紙入力不能の前提に合流)。
- **ビューポートの現在カメラを vision カメラ宣言へワンタップで写し取る**
  (「今この視点から見えるか」)。3D エディタであることが入力コストを最小化する。
- ファネル表示 (ADR-061) を 5 段化し、ドメイン別 near-miss メーターを追加。
  「どのドメインで全滅したか + どれだけ惜しいか」がそのまま入力ガイドになる。
- KPI → 階梯リスクの提示 (§3 の表引き) を検証レポートに重ねる:
  例「reach margin 0.02m — 運用でリーチ縁を割ると L5 (基台再配置) 相当」。

### 6. 実施フェーズ (段階摘出)

| Phase | 内容 | 契約影響 |
|-------|------|----------|
| 1 | core 増段 (Visibility/Grasp naive + Protocol) + 内部診断拡張 + scene 可視性絞り込み + テンプレ scene 形式移行 + camera/gripper 宣言 | なし (宣言は open payload / layoutVersion) |
| 2 | 上流 contract v4 (visible/graspable + ファネル 5 段 + ドメイン near-miss) + BFF 型再生成 + conformance | contractVersion 3→4 |
| 3 | UI: 3 ドメインカード + プリセット + カメラ写し取り + ファネル 5 段 + KPI/階梯レポート (pick-sequence 集計) | なし (提示層) |
| 4 | 実ソルバ差し替え (wrench cone / 実 IK / メッシュ干渉・遮蔽) | なし (Protocol 内) |

## Open — KPI の双対性と収束仮説 (H1/H2, 未決)

各ドメイン KPI は**その側からの主張にすぎない**、という構造的な懸念がある。可視率を
上げる操作 (カメラを対象へ寄せる) は共有設計変数 (カメラ姿勢) を介して他ドメインの
KPI (干渉クリアランス・進入角の自由度) を悪化させ得る。単側 KPI を順に満たしにいく
逐次改善は共有変数上でピンポンし、収束の保証がない — **収束は、KPI がその「双対位置」
の KPI と突き合わされて初めて判定できる**、というのが本節の仮説である。

名指しできる双対対は現時点で 2 種:

- **H1 — ドメイン間双対 (設計空間の中)**: ある KPI の双対位置 = **同じ共有設計変数に
  許容領域を張る他ドメインの KPI**。これは ADR-049 の機構そのもの (衝突は共有変数を
  経由して間接的に起きる / 検出は許容領域の交差判定) の grasp search への適用であり、
  収束シグナルの候補は (a) 共有変数上の**同時許容領域が非空**であること、
  (b) 支配フィルタ (ADR-061 dominantStage) が特定ドメインに固着せず**均衡**すること
  (感度 = シャドープライスの均衡の素朴な代理)。H1 が与えるのは**実行可能領域**
  (feasible な設計の集合) まで — その内側のどこが「良い」かは H1 では決まらない (下記改訂)。
- **H2 — 予報↔実績双対 (設計時と運用時の間)**: 設計時 KPI (ソルバ予報) の双対位置 =
  **運用時のフォールバック発生実績**。収束 = キャリブレーション (予報した階梯リスク
  分布と実績の一致度が上がること)。この gap こそがテンプレ/ソルバ忠実度の改善
  (= テンプレ精度向上) を駆動するフィードバックであり、アプリの長期的な収束は
  H2 で測るのが妥当と予想する。

**改訂 (2026-07-19 同日, 初稿の「類似度一致」を撤回)**: 収束の判定関数は一意には
立たない、と見立てを更新する。KPI は多軸ベクトル (MBTI の類比) であり、問題は
「双対 KPI と値が一致するか」ではなく「**多軸 KPI 空間のどの領域が、そのユーザに
とってのスイートスポットか**」である — 一意の最適解は存在しない。帰結は 3 つ:

- (a) アプリは「唯一の正解」を判定しない。提示するのは **KPI 空間内の現在位置**
  (ワイヤ事実からの決定的導出) と **ユーザ固有の許容領域との位置関係**であり、
  領域の正体は ADR-049 の criterion の個別化 (R8 役割 KPI カタログの延長 =
  役割別スイートスポットの原型) にほかならない。
- (b) スイートスポット領域の獲得は**泥臭いデータどり**でしか進まない部分と見る。
  予報 KPI ベクトル + ユーザの採否/調整 + (将来) 運用フォールバック実績のログ収集を
  一級の成果物として設計する — H2 (較正) がその回路であり、H2 の比重が上がる。
- (c) 蓄積データからの領域の**学習・提案**は曖昧写像なので propose-only レーン
  (`core/recommendation/`, 真偽値を返さない — ADR-077) の責務。**合格ラインの決定**は
  従来どおり明示 criterion (decide)。動詞境界 (ADR-056/077) はこの構図でもそのまま守れる。

位置づけ: H1/H2 は **Decision ではなく仮説**。本文の Decision (§1〜6) は仮説の
どちらに転んでも無駄にならない範囲 (ゲート増段・事実の露出・決定的導出) に限定して
ある。仮説の検証・反証・修正は GSN 論証木の `ByConvergence` 枝に記録する
(初稿「類似度一致」→ スイートスポット領域への Modify は記録済み)。確定した時点で
本 ADR を改訂または後続 ADR を起こす。

## Consequences — Evidence と tradeoff (§1.2 Evidence)

- 肯定的:
  - 「L4 以上の出戻り」を設計時に予報できる — 検証の商品価値が「候補リスト」から
    「設定の健康診断」へ上がる。
  - 候補ゼロの説明力がドメイン単位になり (ADR-079 の一般化)、入力の直し先が
    「見える/届く/掴める」のどれかまで即座に絞れる。
  - naive 既定によりゼロ依存で CI が回り、テンプレ受け入れテストが 3 ドメインを固定する。
  - 実ソルバ差し替え (Phase 4) が契約不変で閉じる — 精度向上の道が版上げから独立。
- 受け入れるコスト / 否定的:
  - 上流契約 v4 の版上げと BFF/UI の消費追従 (ADR-079 と同型の 2 段デプロイ)。
  - ファネル恒等式・conformance・テンプレ受け入れテストの更新量。
  - naive 可視性は球近似 (メッシュ遮蔽・視野角・被写界深度は Phase 4 以降)。naive 把持性
    は幾何のみ (摩擦・力制御は wrench cone 差し替えまで扱わない)。KPI の予報精度は
    naive 実装の忠実度が上限 — レポートに判定実装名を明記し過信を防ぐ。
  - 階梯リスク表は経験則の表引きであり、保証ではない (assurance case ではなく予報)。
- 検証 (証拠):
  - **GSN 論証木 `docs/gsn/adr-081-grasp-validation.gsn`** — 本欄の証拠を Goal 単位で
    実行可能コマンドに束ねた正準 (初期実行: core 全 106 テスト pass @ 755266a。
    evidence debt 92% = 未実装 Goal は ToBeDeveloped + 証拠予定 assumption)。
    `/gsn-maintain` で棚卸し・再実行する。
  - `core/tests/test_templates.py` — 各テンプレの 3 ドメイン手検証値の受け入れテスト。
  - ファネル恒等式 (5 段) のプロパティテスト (`test_engine.py` 系譜)。
  - 契約 v4 conformance (`test_contract_conformance.py`) + contractVersion drift テスト。
  - pick-sequence KPI レポートの手検証値 (thin-container テンプレで L 階梯の再現例を 1 つ
    固定: 例「カメラを壁側に寄せると可視率が落ち L3 リスクが立つ」)。
- 波及 (blast radius):
  - `core/easy_extrude_core/engine/` (feasibility/pipeline/objectives/candidates) +
    `scene/` (targetable 絞り込み) + `contract/models.py` (v4 追従)。
  - 上流 `@easy-extrude/grasp-contract` (v4) → `server/src/grasp/*.d.ts` 再生成。
  - `src/` — GraspSearchPanel / GraspFunnelMath / GraspController / uiStore (提示層のみ、
    判定の再実装は禁止)。
  - `templates/` 全テンプレ + `core/tests/` + `docs/` (NAVIGATION trigger 表、
    CODE_CONTRACTS 該当 detail)。

## 実施記録 (2026-07-20)

Phase 1〜3 を実装した (契約が repo 内正本になったため — ADR-082 — Phase 1/2 は同一
コミット系列で完結)。本文からの確定・具体化は 3 点:

1. **段の挿入位置はコスト実測で確定した** (Decision 1 の予告どおり)。naive 実測
   (テンプレ規模: 障害物 12 / サンプル 5、短絡なし最悪ケース) は
   リーチ ~1µs < IK ~5µs < 把持性 ~9µs < 可視性 ~49µs ≈ 干渉 ~50µs。よって実装順は
   **リーチ → IK → 把持性 → 可視性 → 干渉** (同コスト帯の可視性/干渉は本文の
   ドメイン順でタイブレーク)。本文 §1 の図はドメイン物語の名目順であり、実行順の
   正本は `core/easy_extrude_core/engine/pipeline.py` docstring (実測値つき)。
   排他棄却の帰属順として契約 v4 Schema の記述にも同順を明記した。
2. **near-miss の正式名は契約 v4 で確定**: `occlusionNearestMiss` (可視棄却の最小
   遮蔽量; 視野外のみの棄却は測れないので null) / `openingNearestMiss` (把持棄却の
   最小開口不足量; 接触対なしの棄却は null)。Protocol は bool でなく不足量 (0 =
   合格 / 正 = 不足 / inf = 測定不能) を返し、ゲートと near-miss を 1 計算で賄う。
3. **naive 把持ゲートの antipodal は凸代理**: 全表面サンプルを閉じ軸 (FRAME_CONVENTION
   の x 軸 — gauge は `pose_codec.frame_axes` が単一所有) へ射影した広がりを対象幅と
   し、両端サンプル対を対向接触面の代理とする。上面サンプルのみのテンプレでも
   幾何ゲートが成立する (真の antipodal 判定・wrench cone は Phase 4 の差し替え)。

実装点: engine 5 段化 + `VisibilityChecker`/`GraspChecker` naive 既定 (`feasibility.py`)、
契約 v4 (`packages/grasp-contract` + pydantic + BFF 型再生成 + conformance)、camera/gripper
宣言 (request open payload + scene 層 `GraspSettings`/wire)、エンティティ粒度の可視性
絞り込み (`scene/derivation.viewable_entities` — top_z 代理の昇格)、テンプレ scene 形式
移行 (`pick-sequence.request.json` 正本 + 導出一致の回帰テスト + L3 再現例)、提示層
(`GraspFunnelMath` 5 段化 + `GraspLadderMath` の KPI 決定的導出と階梯リスク表引き +
パネル 5 段/3 メーター/階梯表示)。Phase 3 の残り (3 ドメインカード入力・プリセット
fork&tweak・ビューポートカメラ写し取り・pick-sequence 集計レポート UI) と Phase 4
(実ソルバ差し替え) は未着手。証拠の正準は GSN 木 (ヘッダ参照) を更新済み。

### 追記 (2026-07-20, 同日続き) — Decision 5 の宣言 UI

3 ドメインカード入力・プリセット fork&tweak・ビューポートカメラ写し取りを実装した
(すべて宣言側の提示層 — 契約不変, open payload / layoutVersion 統治)。具体化 3 点:

1. **プリセットとギャップ述語は純粋カタログ一箇所** (`src/context/GraspDeclarationCatalog.js`)。
   アクティブなプリセット chip は値の同値性からの導出 (`matchingPresetId`) で、
   「カスタム化」フラグを持たない (編集 = fork, ADR-063/058 の白紙入力不能に合流)。
   各カードのギャップリストが Run の submit 述語 (理由を印字, 無言 disabled 禁止)。
   viewAxis 無しの fovHalfAngle 宣言は「無言で不活性な入力」になるため意図的にギャップ。
2. **カメラ写し取りは純粋/副作用の分割**: `GraspController.captureViewportCamera()` が
   `SceneView.activeCamera` を読み、導出 (視軸 = matrixWorld 第 3 列の負規格化、
   fov 半角 = 垂直 fov/2) は純粋関数 `visionFromViewportCamera` に委譲 —
   コントローラは THREE-free のまま。ortho (Map Mode) は fovHalfAngle null に退化、
   カメラ不在は null をパネルが明示報告 (推測宣言はしない)。
3. **未宣言カードはキー自体を省略** (vacuously-true ゲートの契約文言どおり)。off の
   カードはスロットを保ち、その帰結を明記する (Fixed Slots #15)。

pick-sequence 集計レポート UI は**未着手のまま残す**: BFF に pick-sequence ルートが
無く、契約パッケージにも pick-sequence Schema が無い (現状は core 内部 wire —
scene_models.py)。レポート UI はスキーマ追加 = contractVersion 版上げ行為を伴うため、
別チャンク (後続 PR) として切り出す。Phase 4 (実ソルバ差し替え) も未着手。

## Lens notes

- **様態 (BPMN/CMMN)**: 運用フォールバック階梯は事象駆動の裁量処理 = **CMMN**。だから
  自動シーケンスとしてコアに焼かない (Option C 却下の根)。一方、設計時の通し検証は
  決め打ちの逐次フロー = **BPMN** (候補生成→5 段フィルタ→スコア→集計) で、パイプライン
  実装が形に合う。
- **層 + 契約**: リクエスト側 (open payload, layoutVersion 統治) とレスポンス側
  (閉, contractVersion 統治) の非対称を明示した。宣言追加と結果露出で版上げの要否が
  分かれるのはこの非対称の帰結であり、Phase 1 を契約不変で切り出せる根拠。
- **状態機械 (§1.4)**: 階梯 L1〜L6 は状態機械ではなく**順序付きコストラベル** (遷移を
  実行するのは運用側プログラムで本アプリのスコープ外)。UI の grasp status
  (idle/compiling/solving/results/error) は不変。状態台帳への新規追記なし。
- **decide / propose 境界 (ADR-056/077)**: 5 段の判定はすべて decide (core/ のソルバ事実)。
  KPI → 階梯リスクは表引きの決定的導出でフロント in-scope。propose レーンは不使用。
- **真実の源 (§1.1)**: KPI はファネル/near-miss からの導出値であり第二の源にしない。
  階梯対応表はフロントの一箇所に置く (呼び出し箇所ごとのパッチ禁止)。
