# 0004. 全エンドポイントで単一の contractVersion を共有し、不一致は封筒で 400

- Status: Accepted
- Date: 2026-06-29
- Deciders: easy-extrude contract maintainers
- Supersedes / Superseded by: なし

## Context — Goal と力学(§1.2 Goal)

達成したい性質:
1. consumer (BFF / 各サービス) と provider が **同じ契約世代**を見ていることを、
   ペイロードを解釈する前に**確実に検出**できる (drift を早期に弾く)。
2. エンドポイントが増えても、版管理の事実が**増殖しない** — 「いま何版か」の権威ある
   場所が一つに保たれる (§1.1 真実の源は一つ)。

力学: このリポジトリは複数の I/O 契約 (grasp-search request/response、recommendation
request/response、今後増えうるエンドポイント) を一つのパッケージで配る。各契約が
個別に版を持つと、「grasp は v2 だが recommendation は v1」のような**版の組合せ爆発**が
生まれ、consumer は各エンドポイントごとに整合を確かめねばならない。一方この repo の
consumer は全て内製で、契約変更時に**一斉 (lockstep) デプロイ**できる。つまり「あるエンド
ポイントだけ古い版で読み続けたい」という要求は今は存在しない。

層マップ上の位置: 全 request/response 契約に共通して載る **封筒 (envelope) フィールド**
`contractVersion`。これは個々のエンドポイントのペイロード層より一段外側の関心であり、
ペイロードを読む前に評価される境界条件。

## Options considered

- A: **エンドポイント別バージョン** (各 schema が独立した version 軸を持つ)
  — tradeoff: 版の組合せを consumer が管理する必要が生まれる。lockstep デプロイできる
    今の体制では表現力が過剰 (§5 トリガなしの先回りモデリング)。却下。
- B: **semver (major/minor/patch) を今入れる**
  — tradeoff: additive と breaking を区別できるが、封筒で**一律ハードリジェクト**する以上
    観測挙動は版番号の大小だけで決まり、区別しても今は挙動が変わらない。区別が効くのは
    「旧 consumer を生かしたまま additive に成長させる」ときだけで、その需要は未発生。却下。
- C: **単一の単調増加整数を全エンドポイントで共有し、不一致は封筒レベルで 400**
  — tradeoff: 「あるエンドポイントだけ別版」を表現できないが、その需要が無い今は損失ゼロ。
    版の権威が一点 (`contract-version.json`) に畳まれ、整合判定が最も単純。これを採用。

## Decision — Strategy(§1.2 Strategy)

契約世代は **単一の単調増加整数**とし、**全エンドポイントで共有**する。

- 権威ある源は一つ: ルートの `contract-version.json` (`{ "contractVersion": N }`)。
  grasp / recommendation を含む全 request/response がこの**同じ**整数を封筒に載せる。
  エンドポイントを足しても per-endpoint の版軸は導入しない (§1.1)。
- **不一致は封筒レベルで 400** — `contractVersion` が一致しない要求は、ペイロード
  (pose・proposals 等) を解釈する**前に**ハードリジェクトする。整合判定はペイロード層に
  漏らさない (層の分離: 封筒 → ペイロードの一方向)。
- additive (フィールド/kind 追加) と breaking (削除/意味変更) を**区別せず**、どちらも
  同じ +1 bump に畳む。封筒で一律に弾く以上、区別は観測挙動を変えない。
- 契約を変えるときは「schema を編集し `contract-version.json` を +1」する。これが唯一の
  版前進操作。

## Consequences — Evidence と tradeoff(§1.2 Evidence)

- 肯定的:
  - 「いま何版か」の権威が一点に畳まれ、consumer は単一整数の一致だけ確かめればよい。
  - エンドポイントを足しても版管理の事実が増殖しない (組合せ爆発を回避)。
  - 不一致がペイロード解釈の手前で弾かれ、drift が型エラーでなく明示的な 400 になる。
- 受け入れるコスト / 否定的:
  - 一つのエンドポイントの additive な変更でも、共有整数が上がるため**全 consumer**が
    版追従を迫られる (lockstep 前提だから許容)。
  - 「旧 consumer が未知 kind を無視して読み続ける」を**表現できない** (additive と
    breaking が封筒で同じ扱いのため)。今はその需要が無い。
- 検証(証拠):
  - `contract-version.json` が単一の `contractVersion` 整数を保持 (現在 2)。
  - 全 schema (`grasp-search-request` / `grasp-search-response` /
    `recommendation-request` / `recommendation-response`) が封筒に整数
    `contractVersion` を持ち、同一の源を参照する旨を記述。
    `grasp-search-request.schema.json` は "Mismatch is rejected with 400" を明記。
  - `test/contract.test.mjs` は `contract-version.json` の単一値を読んでレスポンスを
    組み立て、その値でスキーマ適合を確認 (`npm run test:contract`、全 12 件 green)。
- 波及(blast radius):
  - 全 request/response 契約の封筒。`contract-version.json` (唯一の版前進点)。
  - 新規エンドポイントを足す変更はこの決定を再検討せず、同じ整数に相乗りする。

## 細粒度化はいつ正当化されるか(トリガ)

エンドポイント別バージョン / semver / バージョンネゴシエーションへ細粒度化するのは、
次のトリガが立ったときに限り、そのとき新しい ADR を起こす:

- **lockstep デプロイできない consumer が現れる** (外部/第三者公開、または
  ローリングデプロイで旧新 consumer を一時併存させたい)。このとき初めて「additive なら
  旧 consumer は読み続けられる」を *表現* する価値が生まれる。
- **エンドポイントごとに独立した成長速度**が実需になる (片方だけ頻繁に breaking する等)。

それまでは単一の共有整数 + 封筒 400 を**意図的に維持**する。ADR-0005 (pose の kind union 化)
もこの境界の上に乗り、「kind を足す = この共有整数を +1」に畳んでいる。

## Lens notes

- §1.1 真実の源は一つ: 版の権威は `contract-version.json` 一点。per-endpoint 版や
  semver 軸という第二の源を作らない。
- §1.3 層 + 契約: `contractVersion` は封筒層の境界条件で、ペイロード層より外側。
  不一致判定をペイロード解釈に漏らさない (一方向の依存)。
- §5 ガードレール: lockstep 前提が崩れていない以上、semver / per-endpoint 版は
  トリガなしの先回りモデリング。実需 (上記トリガ) が立つまで入れない。
