# 0005. grasp-search の pose を kind 判別 union 化する

- Status: Accepted
- Date: 2026-06-29
- Deciders: easy-extrude contract maintainers
- Supersedes / Superseded by: なし

## Context — Goal と力学(§1.2 Goal)

達成したい性質:
1. 消費側 (BFF / クライアント) が grasp-search レスポンスの `pose` を **型安全に読める**。
2. 可視化要求が出るたびに `pose` へ optional フィールドが生え、契約が **際限なく膨らむ**
   ことを防ぐ (有界性)。

力学: `pose` は現状 opaque (`additionalProperties: true`) で、消費側は実装詳細に推測で
依存していた。一方で可視化 (接近ベクトル・ゴースト色・グリッパ幅表示・アニメ) の需要は
無限に増える。これらを契約に載せると、契約が表示仕様の置き場になり境界が崩れる。

層マップ上の位置: grasp-search service → BFF の出力契約 (`grasp-search-response.schema.json`)。
この契約は 2 つの関心を運ぶ — **決定/score 層** (ソルバが論理的に決めた事実) と
**pose 層** (その決定の幾何学的表現)。両者は統治規則が逆向きである。

## Options considered

- A: **opaque のまま** (`additionalProperties: true`)
  — tradeoff: 型安全に読めない。消費側が実装にカップルする。却下。
- B: **optional 兄弟フィールドの束** (`position?`, `joints?`, `chainRef?`, …を併置)
  — tradeoff: どの組合せが有効かをスキーマが表現できず、不正状態が表現可能になる
    (§1.4 違反)。可視化要求のたびに optional が増え、有界性を失う。却下。
- C: **kind 判別 union** (閉じた kind 集合の `oneOf` + 各枝 `additionalProperties:false`)
  — tradeoff: kind を増やすには contractVersion を上げる必要がある = 意図的な成長点が
    一点に集約され、有界になる。これを採用。

## Decision — Strategy(§1.2 Strategy)

`pose` を **閉じた kind 判別 union** にする (Rigor on the Wire, Play in the Client)。

- 枝は実需の 2 つから始める:
  - `kind: "endEffector"` → `frame: { position:[x,y,z], orientation:[x,y,z,w] }`
  - `kind: "jointSpace"` → `chainRef: string`, `joints: number[]`
- kind は閉じた集合 (`oneOf` + `discriminator.propertyName = kind`)。各枝は
  `additionalProperties:false`。フィールドの存在は判別子 kind が表す
  ("optional" という設計語をスキーマに持ち込まない = §1.4 不正状態を表現不能に)。
- **包含テスト**: ワイヤに載せてよいのは「ソルバが *決定* した事実」だけ。演出
  (接近ベクトル・色・フェード・グリッパ幅) はワイヤに載せず、クライアントが
  `frame` + 規約から導出する。帰結: 可視化要求は *クライアント導出* を増やし、
  *契約* を増やさない。契約の唯一の意図的成長点は「kind を 1 つ足す」こと。
- 決定/score 層 (`scoreBreakdown`: withinReach / ikSolvable / interferenceFree /
  objectiveScores / totalScore) は **触らない**。`additionalProperties:false` を維持し、
  verdict や演出の混入を引き続き拒否する (逆向きの規則: こちらは閉・厳密のまま)。
- pose を union 化したので `contractVersion` を 1 → 2 に上げる。version 不一致は
  従来どおり 400 で拒否 (ADR-0004 の境界を維持)。

## Consequences — Evidence と tradeoff(§1.2 Evidence)

- 肯定的:
  - 消費側は `kind` で narrow して型安全に読める (判別 union)。
  - 不正状態が表現不能 (endEffector に joints を混ぜる等はスキーマが拒否)。
  - 契約の成長が「kind を足す = version を上げる」一点に有界化される。
- 受け入れるコスト / 否定的:
  - 新しい表現形が要るたび contractVersion を上げる必要がある (意図的な摩擦)。
  - 消費側は演出を自前で導出する責務を持つ (契約は frame までしか約束しない)。
- 検証(証拠):
  - `test/contract.test.mjs` (`npm run test:contract`) — 両 kind の実インスタンスが
    スキーマに従うこと、判別 union として narrow して読めること、unknown kind /
    opaque / 混在枝 / 必須欠落 / quaternion 長さ誤りが拒否されること、score 層が
    引き続き未知フィールドを拒否することを検証。全 12 件 green。
- 波及(blast radius):
  - `schema/grasp-search-response.schema.json` (`poseCandidate.pose` と新規 `$defs`)。
  - `contract-version.json` (1 → 2)。
  - 消費側 (BFF / クライアント) は version 2 へ追従し、生成型を更新する必要がある。
  - recommendation 契約・score 層は無影響。

## バージョン粒度のトリガ(細粒度化はいつ正当化されるか)

本決定は contractVersion を **単一の単調増加整数 + 不一致は封筒レベルで 400** という
既存モデル (README / ADR-0004) の上に乗せ、これを **意図的に維持**する。「kind を足す」も
「kind を変える/消す」も同じ 1 bump に畳む。封筒で一律ハードリジェクトする以上、additive と
breaking を区別しても観測挙動は変わらず、semver (major/minor/patch) やエンドポイント別
バージョンを今入れるのは §0/§5 (トリガなしの先回りモデリング禁止) に反する。

細粒度化 (semver = major:breaking / minor:additive、あるいはバージョンネゴシエーション) が
正当化されるのは、次のトリガが立ったときに限る — そのとき初めて新しい ADR を起こす:

- **lockstep デプロイできない consumer が現れる** (外部/第三者、社外公開、または
  ローリングデプロイで旧新クライアントを一時併存させたい)。この時、「kind の追加なら
  旧クライアントは未知 kind を無視して読み続けられる」を *表現* したくなる。今は全 consumer が
  内製で一斉デプロイ可能、かつ 400 が pose を読む前に弾くため、この表現力は不要。

それまでは、契約の唯一の意図的成長点は「kind を 1 つ足す = contractVersion を +1」のまま。

## Lens notes

- §1.1 真実の源は一つ: pose の形はスキーマが唯一の源。演出はクライアント所有とし、
  契約に第二の源を作らない。
- §1.4 状態/不正状態を表現不能に: optional 兄弟 (案 B) は不正な組合せを表現可能に
  してしまう。判別 union は kind ごとに有効な形を一意に閉じる。
- §1.3 層 + 契約: 同一レスポンス内の 2 層 (決定/score 層 と pose 層) を、逆向きの
  統治規則 (閉・厳密 / 閉じた union) で名指しした。
