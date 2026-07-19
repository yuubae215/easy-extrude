# 0007. grasp-search レスポンスに diagnostics(棄却ファネル)を載せる

- Status: Accepted
- Date: 2026-07-04
- Deciders: easy-extrude contract maintainers
- Supersedes / Superseded by: なし

## Context — Goal と力学(§1.2 Goal)

達成したい性質:
1. 探索が **空振り / 薄い結果**(候補ゼロ、または期待より少ない)で終わったとき、
   クライアントが「**なぜそうなったか**」を説明できる — 届かないのか、IK が解けないのか、
   干渉なのか、そもそも候補が生成されなかったのか。
2. その説明能力を **演出をワイヤに載せずに** 得る(Rigor on the Wire, Play in the Client の維持)。

力学: 現状、探索が候補ゼロで終わると応答は空の `candidates[]` だけを返す。消費側は
ゼロの **理由** を区別できず、「もう少し腕を伸ばせば届く」のか「入力が空」なのかを
説明できない。理由は *ソルバが決定した事実*(各段の棄却数、reach の near-miss)として
既に private 側に存在するが、契約がそれを運ぶ口を持たない = §1.1 の「事実はあるが源に
アクセスできない」状態。

層マップ上の位置: grasp-search service → BFF の出力契約
(`grasp-search-response.schema.json`)。この応答は 2 つの関心を運ぶ —
**決定/score 層**(per-candidate の判定事実)と **pose 層**(その幾何表現)。
本決定はそこに **探索全体の集計事実**(per-search)という第三の関心を、新しい閉じた
トップレベル層 `diagnostics` として足す。決定/score 層と pose union は触らない。

## Options considered

- A: **現状維持(空の `candidates[]` のみ)**
  — tradeoff: クライアントはゼロの理由を区別できない。Goal 1 を満たせない。却下。
- B: **棄却された候補そのもの(per-candidate の落選リスト)を応答に載せる**
  — tradeoff: 応答が候補数に比例して肥大する。かつ「なぜ落ちたか」の演出的説明を
    per-candidate で運ぶ誘惑を生み、境界(演出はクライアント)を崩す。却下。
- C: **演出込みの説明(「惜しい!」の文言・色・メーター・改善提案文)を契約に足す**
  — tradeoff: 演出をワイヤに載せる = ADR-0005/0006 の境界違反。契約が表示仕様の
    置き場になる。却下。
- D: **集計のみの閉じた `diagnostics`(棄却ファネル + reach の near-miss 数値)**
  — tradeoff: クライアントは自前で文言・色・メーターを導出する責務を負う。だが契約は
    *決定事実* だけを運び、応答サイズは候補数に依存しない(定数)。これを採用。

## Decision — Strategy(§1.2 Strategy)

応答トップレベルに **閉じた `diagnostics` オブジェクト**(`additionalProperties:false`)を
足し、**required** にする(producer は常に emit。消費側に有無分岐を強いない = §1.4 の
「不正状態を表現不能に」の精神を optional 分岐にも適用)。

- 運ぶのは **棄却ファネルの計数**(`candidatesGenerated`, `rejectedByReach`,
  `rejectedByIk`, `rejectedByInterference`, `feasible`, `returned`)と、
  **reach の near-miss**(`reachNearestMiss`: reach で落ちた候補が可達シェルを
  外した最小距離。何も reach で落ちなければ `null`)。
- **ファネル不変条件**: `candidatesGenerated = rejectedByReach + rejectedByIk +
  rejectedByInterference + feasible`(各段は排他、フィルタは短絡する)。
  `returned = min(feasible, topN)`。スキーマは算術を表現できないため、conformance
  データがこの不変条件を満たすことをテストで強制する。
- **包含テスト**(何を載せてよいか): ファネル計数と `reachNearestMiss` は *判定の
  決定事実* = 載せてよい。「惜しい!」の文言・色・メーター演出・パラメータ改善の
  提案文は **クライアント所有** = 契約に足さない。可視化要求はクライアント導出を
  増やし、契約を増やさない(ADR-0005 と同じ逆向き規則)。
- **near-miss の対称性は今回入れない**: IK / 干渉の near-miss は、ソルバ実装に依存
  しない決定事実として定義できるのが reach だけのため、`reachNearestMiss` のみとする。
  実需が立ったら別途 kind/フィールド追加を検討する(§0/§5 先回り禁止)。
- 決定/score 層(`scoreBreakdown`)と pose union は **触らない・緩めない**。
- 契約変更なので `contractVersion` を 2 → 3 に上げる。version 不一致は従来どおり
  封筒レベルで 400 で拒否(ADR-0004 の境界を維持)。

## Consequences — Evidence と tradeoff(§1.2 Evidence)

- 肯定的:
  - 消費側は空振り・薄い結果を *理由付きで* 説明できる(Goal 1)。演出は依然
    クライアント導出のまま(Goal 2 / G3 境界純度を維持)。
  - 応答サイズは候補数に依存しない(集計のみ、案 B の肥大を回避)。
  - `diagnostics` が閉じている(`additionalProperties:false`)ため、演出フィールドの
    密輸を継続的に拒否する。
- 受け入れるコスト / 否定的:
  - producer は常に `diagnostics` を計算・emit する責務を負う(required)。
  - クライアントは文言・色・メーターを自前で導出する(契約は数値までしか約束しない)。
  - reach 以外の near-miss を今は運べない(意図的な非対称。実需で再検討)。
- 検証(証拠):
  - `test/contract.test.mjs`(`npm run test:contract`)— 候補あり(数値 near-miss)/
    候補ゼロ(数値 near-miss)/ 候補ゼロ(`null` near-miss)の実インスタンスが
    スキーマに従うこと、未知フィールド入り `diagnostics` が
    `additionalProperties:false` で拒否されること、`diagnostics` 欠落と必須フィールド
    欠落が拒否されること、テストデータがファネル不変条件を満たすことを検証。全 green。
  - `contract-version.json` = 3、全 `examples/*.json` の封筒が 3 に追従。
- 波及(blast radius):
  - `schema/grasp-search-response.schema.json`(トップレベル `diagnostics` + required)。
  - `contract-version.json`(2 → 3)、`examples/*.json`(共有封筒の追従)。
  - 消費側(BFF / クライアント)は version 3 へ追従し生成型を更新。producer(private)は
    ファネルを算出して emit する必要がある。
  - recommendation 契約・score 層・pose union は無影響。

## Lens notes

- §1.1 真実の源は一つ: ファネル計数はソルバが決定した集計事実で、その源は private。
  契約はそれを運ぶだけで第二の源を作らない。演出はクライアント所有のまま。
- §1.3 層 + 契約: 同一応答に 3 層目(per-search の集計)を、決定/score 層・pose 層と
  同じ「閉・厳密」規則で名指しした。演出は依然どの層にも載せない。
- §1.4 不正状態を表現不能に: `diagnostics` を required にし、消費側に「有る/無い」の
  分岐を持たせない。閉オブジェクトで演出の混入形を表現不能にする。
- §0/§5 先回り禁止: near-miss は実装非依存に定義できる reach のみに限定し、IK/干渉の
  near-miss や per-candidate の落選理由は実需のトリガが立つまで足さない。
