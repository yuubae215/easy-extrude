# 060. Grasp Contract のデータ構造統治 — 決定層は閉、pose は kind 判別の有界 union

- Status: Proposed
- Date: 2026-06-30
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

1. **決定/score 層 = 閉・厳密**: 契約が*約束*する事実のみ（rank + score）。
   `additionalProperties:false`、版管理。ここは「論理的に正しいデータ」を保証する側で、
   緩めない。

2. **pose 層 = 有界・命名済み・`kind` 判別 union**（opaque でも optional 兄弟でもない）:

   ```
   pose:
     kind: 'endEffector'                                  // 段1（ADR-059）
     frame: { position:[x,y,z], orientation:[x,y,z,w] }   // base/world 系の手先姿勢
   --- または ---
     kind: 'jointSpace'                                   // 段2（ADR-059）
     chainRef: string        // どの運動学連鎖（ロボット）か
     joints:   number[]      // 連鎖順の関節値
   ```

   `kind` は **閉じた集合**。新しい姿勢表現を足す＝ `kind` を 1 つ足す＝ `contractVersion` を
   上げる**意図的行為**（際限ない accretion ではない）。`optional` という語は消え、存在は
   判別子 `kind` が表し、各枝は意味で命名される（`endEffector.frame` / `jointSpace.joints`）。

3. **包含テスト（成長のガード, PHILOSOPHY #29）**: あるフィールドをワイヤに載せてよいのは
   *ソルバが決定した事実*のときだけ。**演出はクライアントで導出**し、ワイヤに足さない:
   - 接近ベクトル → `endEffector.frame` ＋規約からクライアントで導出。
   - ゴースト色・フェード・アニメ・表示用グリッパ幅 → クライアント所有（ADR-059）。
   これにより「可視化要求は*クライアント導出*を増やし、*契約*を増やさない」。

4. **適用順序（上流調整）**: 段1 を解除するには上流が `pose` を本 union の `endEffector` 枝へ
   移行し `contractVersion` を上げる。BFF は派生のみ（無改変方針, ADR-054）。本リポジトリの
   UI は ADR-057 の `PoseCandidate` 型を本 union 形へ更新して*消費*する（opaque へ触れない —
   §1.3）。

**変える/新設する契約**: 上流スキーマ（pose を kind union 化、`contractVersion` 上げ）。
本リポジトリ: 消費型の更新のみ、契約定義はしない。

## Consequences — Evidence と tradeoff（§1.2 Evidence）

**肯定的**:
- 命名の違和感を解消（`optional` → `kind` 判別の意味的枝）。
- 成長を統治（kind 追加＝版上げの意図的行為、演出はクライアント導出で契約に載らない）。
- ADR-059 段1/段2 が型安全に読める道が開く（opaque を脱する）。
- 厳密側（score）はそのまま、遊び側（ゴースト）はクライアントへ — PHILOSOPHY #29 の体現。

**受け入れるコスト / 否定的**:
- 上流契約の移行作業（pose union 化）と全消費者の追従が要る（版 pin で drift は検出可能）。
- kind 判別の分岐が増える（が、これは*意図した*成長点で、無秩序な optional より健全）。

**検証（証拠）**:
- 前例: score 層は既に `additionalProperties:false`（閉の見本、`grasp-search-response.schema.json`
  `$defs.scoreBreakdown`）。判別 union は ADR-056（`canonicalForm` の `kind` 判別）・ADR-057
  `GraspState`（判別共用体）で既に本リポジトリの語彙。
- 上流移行後、`test:contract` の conformance を kind 別インスタンスへ拡張して両端 drift を検出
  （ADR-054 の方針を継承）。
- **未充足（明示, §5）**: 上流スキーマは未改変。本 ADR は方針の確定で、実スキーマ変更＋
  `contractVersion` 上げは上流タスク。よって Proposed。

**波及（blast radius）**:
- 上流 `grasp-contract`: `grasp-search-response.schema.json` の `poseCandidate.pose` を
  kind union へ、`contractVersion` 上げ（**上流で実施**）。
- 本リポジトリ: `server/test/grasp.contract.test.js`（kind 別 conformance）、ADR-057 の
  `PoseCandidate`/消費コード、ADR-059 のゴースト消費。
- Docs: README index, CLAUDE.md（BFF と契約 節に統治方針を一言）, ADR-057/059 相互リンク。

## Lens notes

- **§1.1 真実の源は一つ**: 契約の正本は上流スキーマ。本 ADR は決定の記録（GSN 鎖）で、
  スキーマと二重化しない（ADR は *なぜ*、スキーマは *何* — 別レイヤ）。
- **§1.3 黒箱/契約 + 状態の明示（§1.4 の精神）**: pose を opaque（読めない）でも open bag
  （閉じない）でもなく **判別 union**（閉じた kind で読める）に — 不正/未定義状態を表現不能化。
- **PHILOSOPHY #29**: ワイヤ＝決定の厳密記録、クライアント＝演出の所有。包含テストが両者の
  越境（演出のワイヤ漏れ＝膨張）を止める。
- **§1.2 Goal と解の分離**: 「optional を足す」という解を「契約構造をどう統治するか」へ持ち上げ、
  膨張しない閉じた成長点（kind union）を選んだ。
