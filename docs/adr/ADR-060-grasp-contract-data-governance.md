# 060. Grasp Contract のデータ構造統治 — 決定層は閉、pose は kind 判別の有界 union

- Status: Accepted（upstream 実装・merge 済みとユーザ確認 — 2026-07-01。本リポジトリ側の追従〔submodule pin 更新・型再生成・消費コード〕は未着手、§追記参照）
- Date: 2026-06-30（本文起草）／2026-07-01（upstream 実装確認・本文更新）
- Deciders: yuubae215, Claude
- Supersedes / Superseded by: なし
- References: ADR-059（空間ゴースト — pose を消費する側）, ADR-057（Grasp UI — score-first）, ADR-054（BFF と契約 / 派生のみ）, ADR-056（判別と正規形の前例）, PHILOSOPHY #29（Rigor on the Wire, Play in the Client）
- 注: 契約の正本は上流 `@easy-extrude/grasp-contract`（JSON Schema）。本 ADR は **決定と統治方針の記録**であり、スキーマの実改変は *上流*で `contractVersion` を上げて行う（本リポジトリは契約を定義しない — §1.1 / CLAUDE.md「BFF と契約」）。

## Context — Goal と力学（§1.2 Goal）

ADR-059 を書く過程で二つの匂いが出た:
1. 「足そうとしている `optional` フィールド」という**命名の違和感** — `optional` はワイヤの
   *カーディナリティ*を名前にしただけで、ドメインの意味を表していない。
2. 「無限にエンティティが増えても困る」という**成長への不安** — 可視化要求が出るたびに
   候補へ optional 兄弟（`pose.tcp?`, `gripperWidth?`, `approachVector?` …）を足すと、契約が
   際限なく膨らみ「論理的に正しい決定の記録」でなくなる。

この二つは同じ根（PHILOSOPHY #29）。**Goal**: grasp contract のレスポンス構造を、
*厳密な決定の記録* として保ちつつ *可視化の成長で膨張しない* よう統治する。

**力学・制約**:
- 契約は上流所有（§1.1）。ここでは*消費形*と*統治方針*を決め、スキーマ変更は上流＋版上げ。
- ADR-059 は候補の姿勢を 3D ゴーストに使いたいが、現状 `response.pose` は **opaque**
  （`additionalProperties:true`）で UI が型安全に読めない。一方むやみに optional を生やすと
  膨張する。両者のジレンマを解く構造が要る。
- score 層（`withinReach`/`ikSolvable`/`interferenceFree`/`objectiveScores`/`totalScore`）は
  既に閉じている（`additionalProperties:false`）＝厳密側の見本。

## Options considered

- A: pose を opaque のまま（現状） — tradeoff: 膨張しないが UI が型安全に読めず ADR-059 が進めない。
- B: 候補へ optional 兄弟を都度追加（`pose.tcp?`, `joints?`, …） — tradeoff: 読めるが
  **無限成長**・命名が演出都合・閉じない（PHILOSOPHY #29 の漏れ）。
- **C: 二層化＋ pose を kind 判別の有界 union【採用】** — 決定/score 層は閉のまま、pose を
  *閉じた `kind` 集合*の判別 union に。tradeoff: kind 追加は版を上げる意図的行為（成長が統治される）。

## Decision — Strategy（§1.2 Strategy）

**C** を採る。レスポンスを*逆向きの規則を持つ二層*として統治する（PHILOSOPHY #29）。
**2026-07-01 追記のとおり、この形は upstream で実際に実装・merge 済み**（ユーザ確認、
§実スキーマ確定 節を参照）。

1. **決定/score 層 = 閉・厳密**: 契約が*約束*する事実のみ（rank + score）。
   `additionalProperties:false`、版管理。ここは「論理的に正しいデータ」を保証する側で、
   緩めない。

2. **pose 層 = 有界・命名済み・`kind` 判別 union**（opaque でも optional 兄弟でもない）:

   ```
   pose:
     kind: 'endEffector'                                          // 段1（ADR-059）
     frame:
       position:    [x, y, z]         // base/world frame（下記「frame の基準系」参照 — upstream 記述は未確定のまま）
       orientation: [x, y, z, w]      // 単位クォータニオン
   --- または ---
     kind: 'jointSpace'                                           // 段2（ADR-059）
     chainRef: string          // どの運動学連鎖（ロボット宣言。未確定＝門2、別 ADR）か
     joints:   number[]        // 連鎖順の関節値（`Kinematics.js` の chain 順と一致）
   ```

   **表現形（配列 vs オブジェクト）— 訂正履歴**: 本 ADR は 2026-07-01 の最初の改訂で
   「本リポジトリの既存規約（Layout DSL `Solid.rotation:{x,y,z,w}`）に合わせオブジェクト形
   `{x,y,z}`/`{x,y,z,w}` にすべき」と記していたが、同日中にユーザが upstream の実装済み
   スキーマ（下記）を提示し、**実際には配列形 `[x,y,z]`/`[x,y,z,w]` で実装・merge 済み**
   であることが判明した。**この訂正提案は撤回する**。契約は上流所有（§1.1）であり、
   本リポジトリ内部の慣習は契約の形を決める根拠にならない — grasp-contract は
   Three.js/本リポジトリの語彙に縛られない中立なワイヤ形式であり、配列形は他言語・他
   ツールチェーン（Python/C++ の grasp-search 実装側など）とも相性がよい選択として妥当。
   **本リポジトリの消費コードは配列形を前提に実装する**（`frame.position[0..2]`,
   `frame.orientation[0..3]`）。§1.1「真実の源は一つ」を破ったのは今回の ADR 側の
   先走りであり、上流実装確定後は上流の形が唯一の正（このドキュメント内の推奨ではない）。

   **frame の基準系（未確定のまま — 要 upstream 確認）**: `position`/`orientation` の
   基準系は upstream スキーマの記述でも **"base/world frame" のまま両論併記**であり、
   2026-07-01 時点で実装側が world とベースリンクのどちらを意図しているか**確定していない**。
   段1（ADR-059）はロボットのリンクツリー・ベース姿勢をクライアントに持たない（門2 未充足）
   ため、**world frame（CLAUDE.md「World coordinate system」＝ ROS REP-103）であることを
   前提にゴーストを配置する設計を推奨**するが、これは upstream への確認が取れるまでの
   **作業仮説**にとどめる。もし実際は「ロボットのベースリンク相対」であった場合、ロボットが
   world 原点に無いレイアウトでゴーストが黙って誤配置される（PHILOSOPHY #11 の変種 — 数値は
   来るがフレームの取り違えは例外を出さない）。**ADR-059 段1 の実装に着手する前に、
   upstream 側（またはスキーマの `description` フィールド更新）でこの一語を確定させることを
   本 ADR の残作業として明記する**。

   `kind` は **閉じた集合**。新しい姿勢表現を足す＝ `kind` を 1 つ足す＝ `contractVersion` を
   上げる**意図的行為**（際限ない accretion ではない）。`optional` という語は消え、存在は
   判別子 `kind` が表し、各枝は意味で命名される（`endEffector.frame` / `jointSpace.joints`）。
   各枝は他方のプロパティを持てない（`additionalProperties:false`、次節の実スキーマ参照）。

3. **包含テスト（成長のガード, PHILOSOPHY #29）**: あるフィールドをワイヤに載せてよいのは
   *ソルバが決定した事実*のときだけ。**演出はクライアントで導出**し、ワイヤに足さない:
   - 接近ベクトル → `endEffector.frame` ＋規約からクライアントで導出。
   - ゴースト色・フェード・アニメ・表示用グリッパ幅 → クライアント所有（ADR-059）。
   これにより「可視化要求は*クライアント導出*を増やし、*契約*を増やさない」。

4. **適用順序（上流調整）**: 段1 を解除するには上流が `pose` を本 union の `endEffector` 枝へ
   移行し `contractVersion` を上げる — **2026-07-01 にユーザ確認済みでこれは実現済み**。
   BFF は派生のみ（無改変方針, ADR-054）。本リポジトリの UI は ADR-057 の `PoseCandidate`
   型を本 union 形へ更新して*消費*する（opaque へ触れない — §1.3）。この追従作業（submodule
   pin 更新・型再生成・消費コード）自体は、本セッション/環境が upstream リポジトリへの
   ネットワークアクセスを持たない（後述）ため未着手。

**変える/新設する契約**: 上流スキーマ（pose を kind union 化、`contractVersion` 上げ）—
**実施済み（upstream, 2026-07-01 ユーザ確認）**。本リポジトリ: 消費型の更新のみ、契約定義
はしない（次節「残作業」）。

## 実スキーマ確定（2026-07-01, ユーザ提示・upstream 実装済みと確認）

2026-07-01、ユーザが upstream `@easy-extrude/grasp-contract` の実ファイル（本人が実際の
リポジトリから直接確認・提示）を提示し、**すでに実装・merge 済み**であることを確認した。
本セッションのツールは `vendor/grasp-contract` submodule への `git submodule update`
を試みたが `403`（ネットワークポリシー）でブロックされ、GitHub MCP も
`yuubae215/easy-extrude` のみにスコープされているため、**本セッションはこの内容を
自動ツールで独立検証できていない** — 以下はユーザの提示内容をそのまま正として扱う
（§1.2 Evidence として: 自動テストや型検査ではなく人による目視確認である旨を明示する。
証拠の質としては前者より弱く、本リポジトリ側での `pnpm test:contract` 実行による
機械的再確認は追って必要）。

要点（提示された `grasp-search-response.schema.json` より抜粋・要約）:
- `pose` は `oneOf` による `kind` 判別 union（`poseEndEffector` / `poseJointSpace`）。
  両枝とも `additionalProperties:false` — 本 ADR の Strategy C と一致。
- `poseEndEffector`: `{ kind:'endEffector', frame: cartesianFrame }`。
- `poseJointSpace`: `{ kind:'jointSpace', chainRef: string, joints: number[] }` — 命名は
  本 ADR / ADR-059 の草案語彙とそのまま一致。
- `cartesianFrame`: `{ position: number[3], orientation: number[4] }` — **配列形**
  （上の「表現形 — 訂正履歴」参照）。`description` は "a base/world frame" のまま
  （**基準系は upstream スキーマ自体でも未確定**）。
- `poseCandidate.pose` は引き続き `required` に含まれない（トップレベル optional）—
  本 ADR の想定と一致（移行期の未提供候補を許容）。
- スキーマは `discriminator` キーワード（OpenAPI 由来、JSON Schema 2020-12 の標準語彙では
  ない）を併記しているが、本リポジトリの Ajv インスタンスは
  `new Ajv2020({ allErrors: true, strict: false })`（`server/src/grasp/contract.js`）—
  `strict:false` は未知キーワードを無視するため、コンパイルは壊れない（実装済みコードを
  読んで確認済み、これは本セッションで検証可能だった数少ない自動確認点）。

**本リポジトリ側の残作業（この確認だけでは完了しない）**:
1. `vendor/grasp-contract` submodule pin をこのスキーマを含む upstream コミットへ更新
   （本セッションはネットワーク制限で実行不可 — ネットワークアクセスを持つ環境/セッション
   で `git submodule update --init --recursive` の上、コミットして push する必要がある）。
2. `pnpm --filter easy-extrude-bff run gen:contract-types` で
   `server/src/grasp/contract.{request,response}.d.ts` を再生成（現在の d.ts は ADR-054
   実装当時のスナップショットのままで `pose?: {[k:string]: unknown}` の opaque 形 — 上の
   確認された union 形と食い違ったまま）。
3. `src/components/Grasp/GraspSearchPanel.jsx` の `c.pose?.joints` 非構造的参照を、
   `c.pose?.kind === 'jointSpace'` 判別 → `.joints`（配列） / `c.pose?.kind === 'endEffector'`
   → `.frame.position`/`.frame.orientation`（各長さ 3/4 の配列）を読む形へ更新。
4. `server/test/grasp.contract.test.js` に `kind` 別 conformance fixture を追加し、
   実際に取得したスキーマに対して `pnpm test:contract` を実行して機械的に整合性を確認
   （現状はユーザの目視確認のみ、上記の証拠強度の限界を埋める）。
5. `frame` の基準系（world か base link か）を upstream に確認し、ADR-059 段1 の
   `GraspGhostView` 実装前に確定させる。

## Consequences — Evidence と tradeoff（§1.2 Evidence）

**肯定的**:
- 命名の違和感を解消（`optional` → `kind` 判別の意味的枝）。
- 成長を統治（kind 追加＝版上げの意図的行為、演出はクライアント導出で契約に載らない）。
- ADR-059 段1/段2 が型安全に読める道が開く（opaque を脱する）— **upstream 実装済みで
  実現している**。
- 厳密側（score）はそのまま、遊び側（ゴースト）はクライアントへ — PHILOSOPHY #29 の体現。

**受け入れるコスト / 否定的**:
- 上流契約の移行は完了済みだが、**本リポジトリ側の追従（submodule pin・型再生成・消費
  コード）はこの環境のネットワーク制限により本セッションでは実行できない**（上の「残作業」）。
- kind 判別の分岐が増える（が、これは*意図した*成長点で、無秩序な optional より健全）。
- `frame` の基準系が upstream スキーマの記述でも未確定のまま残っている（要確認事項として
  明示、黙って推測で埋めない — PHILOSOPHY #11）。

**移行・版数（migration）**:
- これは **破壊的変更**（`pose` が opaque `additionalProperties:true` の bag から閉じた
  `oneOf` union へ）。緩衝用の `kind:'unstructured'`／レガシー branch は upstream の
  実装でも**設けられていない**（union は閉じたまま） — 本 ADR が推奨した「意図的に
  緩衝枝を設けない」方針と一致。`contractVersion` bump が唯一の移行ゲートで、
  `checkContractVersion`（`server/src/grasp/contract.js`）の既存の厳密拒否（不一致は
  400）がそのまま境界を強制する。
- 現時点で本リポジトリの消費コードは `pose` を**構造的に検証していない**
  （`GraspSearchPanel.jsx` は `c.pose?.joints` を存在すれば表示するだけの非構造的参照）
  ため、後方互換コストは低い。残る移行手順は「本リポジトリで submodule pin 更新 →
  `gen:contract-types` 再生成 → 消費コード更新（上の一覧）→ `pnpm test:contract` 緑」の
  一直線（BPMN 的、分岐なし）。

**検証（証拠）**:
- 前例: score 層は既に `additionalProperties:false`（閉の見本、
  `grasp-search-response.schema.json` `$defs.scoreBreakdown`）。判別 union は ADR-056
  （`canonicalForm` の `kind` 判別）・ADR-057 `GraspState`（判別共用体）で既に本リポジトリの
  語彙 — upstream の命名（`kind`/`endEffector`/`jointSpace`/`chainRef`/`joints`）もこの
  語彙とそのまま一致している。
- **upstream 実装済み・merge 済み — ユーザによる目視確認（2026-07-01）**。ただし本セッションの
  自動ツールによる独立検証は未実施（ネットワーク制限、上記）— 証拠強度としては
  「ユーザ提示のファイル内容の転記確認」止まりであり、`pnpm test:contract` の機械的
  green は依然として**未充足（明示, §5）**。よってこの ADR は「決定は Accepted（実現済み
  という意味で）」だが「本リポジトリでの機械的検証・追従実装」は次セッション送り。

**波及（blast radius）**:
- 上流 `grasp-contract`: `grasp-search-response.schema.json` の `poseCandidate.pose` を
  kind union へ — **実施済み（上記確認）**。
- 本リポジトリ（未着手、上の「残作業」1〜5 と同一）:
  - `vendor/grasp-contract` submodule pin。
  - `server/src/grasp/contract.response.d.ts`（`gen:contract-types` 再生成）。
  - `src/components/Grasp/GraspSearchPanel.jsx`（`kind` 判別＋配列アクセスへ）。
  - `server/test/grasp.contract.test.js`（kind 別 conformance fixture）。
  - `src/robotics/Kinematics.js` の `chain`/`movableJoints` 順序と `jointSpace.joints` の
    連鎖順が一致する契約を、段2 実装時に doc コメントで明示。
  - ADR-057 の `PoseCandidate` 消費、ADR-059 のゴースト消費（`GraspGhostView` 新設時の
    入力、frame 基準系の upstream 確認が前提）。
- Docs: README index（Status 更新）, CLAUDE.md（履歴・BFF と契約節）, ADR-059 相互リンク
  更新（門1 実現済みへ）。

## Lens notes

- **§1.1 真実の源は一つ**: 契約の正本は上流スキーマ。本 ADR は決定の記録（GSN 鎖）で、
  スキーマと二重化しない（ADR は *なぜ*、スキーマは *何* — 別レイヤ）。**今回、この ADR
  自身が「本リポジトリの内部規約に契約を合わせるべき」と一時的に真実の源を混同しかけた
  ことも記録として残す** — 契約は上流が決め、本リポジトリの内部規約（Layout DSL の
  ベクトル表現など）は契約の形に影響しない。
- **§1.3 黒箱/契約 + 状態の明示（§1.4 の精神）**: pose を opaque（読めない）でも open bag
  （閉じない）でもなく **判別 union**（閉じた kind で読める）に — 不正/未定義状態を表現不能化。
  upstream 実装がこれをそのまま実現している。
- **PHILOSOPHY #29**: ワイヤ＝決定の厳密記録、クライアント＝演出の所有。包含テストが両者の
  越境（演出のワイヤ漏れ＝膨張）を止める。
- **§1.2 Goal と解の分離**: 「optional を足す」という解を「契約構造をどう統治するか」へ持ち上げ、
  膨張しない閉じた成長点（kind union）を選んだ。実現によって Goal 達成の Evidence が得られた。
- **証拠の質（§1.2 Evidence の誠実さ）**: 「ユーザが upstream ファイルを提示した」ことは
  「upstream が実装した」ことの強い状況証拠だが、本セッションのツールによる独立検証
  （clone・schema 適用・conformance test 実行）ではない。この差を曖昧にしない —
  完了主張は証拠で閉じる（核 §2 OODA の Act→再 Observe）。
