# 0006. 責務を private / public / contract の三リポジトリに分割する

- Status: Accepted
- Date: 2026-07-04
- Deciders: easy-extrude maintainers
- Supersedes / Superseded by: なし

## Context — Goal と力学(§1.2 Goal)

要件は解の形で来た(「private に証明ロジック、public にゲーム感覚 UI、contract に
カノニカルスキーマ」)。まず Goal へ持ち上げる:

1. **契約の中立性** — どちらの実装都合(証明ロジックの内部表現、UI の演出語彙)も
   契約に滲まない。契約の形の真実の源が一つに保たれる(§1.1)。
2. **UI の自由な進化** — public は「データ入力を辛くさせない」遊び心の体験
   (演出・アニメ・ゲーム感覚の入力補助)を、**契約変更なしに**際限なく足せる。
   演出需要は無限に増えるが、契約は有界のままでなければならない(ADR-0005 の上位 goal)。
3. **証明ロジックの秘匿と独立進化** — private のソルバ/推論は非公開のまま
   差し替え可能。公開面は「契約に適合する」ことだけ。
4. **消費側の体験** — 両 consumer(private の実装者・public の実装者)が、
   正準の形を一箇所で引き、コピペで始められ、送る前に検証できる。

力学: UI の演出と証明の内部表現は互いに無関係に高速に変わる。両者が同じ場所に
住むと、変化の速い側の語彙が契約へ滲む摩擦ゼロ経路ができる(暗黙の第二の源 §1.1 違反)。
また public は公開物、private は非公開物であり、可視性の境界も一致させる必要がある。

層マップ上の位置: これはコード内の層ではなく **リポジトリ = bounded context** の
境界決定。contract は Clean Architecture の最内殻に相当し、何にも依存しない。

## Options considered

- A: **モノレポ**(全部同居、ディレクトリで分ける)
  — tradeoff: 境界が規律頼みになり、演出/内部表現が契約へ滲む摩擦ゼロ経路が残る。
    公開/非公開の可視性分離ができない。却下。
- B: **二分割**(契約を private か public のどちらかに同居)
  — tradeoff: 契約が同居側の都合(リリース周期・語彙)に引かれ、中立でなくなる。
    もう片方は他人のリポジトリ内の一部に依存する非対称が生まれる。却下。
- C: **三分割** — private(証明 API ロジック)/ public(ゲーム感覚 UI + BFF)/
  contract(カノニカルスキーマのみ・実装なし・依存なし)
  — tradeoff: リポジトリが一つ増え、契約変更は必ず contract を経由する摩擦が生まれる。
    ただしその摩擦は *意図的*(契約の成長点を一点に集約する)。これを採用。

## Decision — Strategy(§1.2 Strategy)

責務を三リポジトリに分割し、依存を contract へ一方向に向ける。

- **contract(本リポ)**: カノニカルな契約スキーマ + 版 + 正準例 + 適合テストのみ。
  実装コードを持たず、何にも依存しない。consumer は型を生成し、契約を再定義しない。
- **private**: 証明/探索 API ロジック。score・evidence の値の産出側。非公開。
- **public**: ゲーム感覚 UI + BFF。入力体験と演出の所有者。演出は `frame` + 規約から
  クライアント導出し、ワイヤに載せない(ADR-0005 の包含テストを境界規則として維持)。
- 依存方向: private → contract、public → contract。逆向きの依存(contract が
  どちらかを参照する)は永続的に禁止。
- 既存の境界規則はこの分割の *施行手段* として維持する: 版は封筒で一点(ADR-0004)、
  pose は閉じた union で成長点は kind 追加のみ(ADR-0005)、recommendation は
  verdict を表現不能(schema の `additionalProperties:false`)。

## Consequences — Evidence と tradeoff(§1.2 Evidence)

- 肯定的:
  - 演出需要が契約を膨らませない(public 内で完結)。証明ロジックの差し替えが
    契約に波及しない(private 内で完結)。契約の成長点が一点に有界化。
  - 可視性境界(公開/非公開)と文脈境界が一致し、二重管理が消える。
- 受け入れるコスト / 否定的:
  - 契約変更は必ず本リポの PR + version bump + 両 consumer の追従を要する
    (lockstep 前提 — ADR-0004 と同じ前提に乗る)。
  - リポジトリ横断の変更(新エンドポイント追加など)は 3 リポに触る。
- 検証(証拠):
  - `test/contract.test.mjs`(23 件 green): 全 `examples/*.json` のスキーマ適合 +
    正準 version の pin、pose union の narrow、演出/verdict の密輸拒否
    (`sneakyVerdict` / `equivalent` / `ghostColor` が全て拒否される)。
  - `package.json` に依存なし(devDependency の ajv は検証専用)。
  - `.github/workflows/contract.yml` が PR ごとに同じ検証を強制。
  - トポロジ: `docs/architecture.mermaid`。
- 波及(blast radius):
  - リポジトリ境界そのもの。consumer の import 経路(`schema/*`, `examples/*`,
    `contract-version.json`)。CI。コードの形は不変(本 ADR は境界の *記録* であり、
    スキーマの意味変更を含まないため contractVersion は上げない)。

## 再検討のトリガ(いつ崩してよいか)

次のトリガが立ったときに限り、新しい ADR で境界を引き直す:

- **UI が証明の内部表現を必要とする実需**(frame + 規約からの導出で表現できない
  演出が実在する)。そのときは「kind を足す」(ADR-0005)を先に検討する —
  境界を壊すのは最後の手段。
- **lockstep デプロイの崩壊**(ADR-0004 のトリガと同じ)。契約の版戦略ごと再検討。
- **contract に実装(共有ライブラリ化した検証コード等)を置きたくなった**とき —
  それは「スキーマのみ」の不変条件を壊すので、置く前に ADR を起こす。

## Lens notes

- §1.1 DDD: bounded context = リポジトリ。同名異義(「pose」= 契約の決定事実 /
  UI の表示物)はこの境界で切る。
- §1.1 Clean Arch: contract が最内殻。依存は全て内向き(consumer → contract)。
- §1.3 層 + 契約: 封筒層 / ペイロード層 / 例・検証層の三層(詳細は .claude/CLAUDE.md)。
- §1.2 Goal 持ち上げ: 「三分割せよ」という解を、中立性・有界性・秘匿・体験の
  4 goal に還元してから採択した。
