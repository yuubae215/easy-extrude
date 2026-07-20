# 0008. grasp-search をドメイン段階 (見える/届く/掴める) へ拡張する — contractVersion 4

- Status: Accepted
- Date: 2026-07-20
- Deciders: easy-extrude contract maintainers
- Supersedes / Superseded by: なし (ADR-0007 の diagnostics 層を拡張。0007 が
  「実需が立ったら」と保留した near-miss の対称化を、実需 (repo 側 ADR-081) を
  受けて実行するもの)

## Context — Goal と力学(§1.2 Goal)

達成したい性質 (repo 側 ADR-081 の契約面): 設計時の通し検証が 3 ドメイン —
**見えるか (Vision) / 届くか (Path) / 掴めるか (Grasp)** — で説明できること。
段階0 エンジンが可視性ゲート (camera 宣言) と把持性ゲート (gripper 宣言) を得たため、
その *ソルバ決定事実* を運ぶ口が契約に要る。0007 と同じ力学:「事実は private 側に
あるが契約が口を持たない」。

リクエスト側とレスポンス側で統治が非対称である点は ADR-081 の確定どおり:
`graspSearch` 宣言は open payload (layoutVersion 統治) なので **camera / gripper の
宣言追加は版上げ不要** (ADR-083 の robot と同じ typed optional 化)。一方レスポンスの
`scoreBreakdown` / `diagnostics` は閉層 (contractVersion 統治) なので、判定結果の
露出は**版上げを要する**。

## Options considered

- A: 現状維持 (v3 のまま新ゲートの棄却を運ばない) — tradeoff: 可視/把持で棄却された
  候補が「消えた」ようにしか見えず、ファネル恒等式も private 側と食い違う。却下。
- B: 新段を `rejectedByInterference` 等へ合算して v3 形を保つ — tradeoff: 決定事実の
  改竄 (帰属の嘘)。診断の説明能力が Goal に届かない。却下。
- C: **5 段ファネル + ドメイン別 near-miss + score 5 判定を required で追加し
  contractVersion 3 → 4 (採用)** — tradeoff: 消費側 (BFF/UI) の追従が要る。閉層の
  required 追加なので版上げは必然 (ADR-0004 の封筒拒否が移行を守る)。

## Decision — Strategy(§1.2 Strategy)

- `diagnostics` に `rejectedByVisibility` / `rejectedByGrasp` (required) を追加し、
  恒等式を 5 段に拡張: `candidatesGenerated = rejectedByReach + rejectedByVisibility +
  rejectedByIk + rejectedByInterference + rejectedByGrasp + feasible`。段は排他で、
  短絡順はエンジンのコスト実測順 (reach → IK → grasp → visibility → interference —
  帰属を決める事実として Schema description に明記)。
- **near-miss の対称化 (0007 の保留解除)**: `occlusionNearestMiss` (可視棄却の最小
  遮蔽量; 測定可能な棄却が無ければ null — 視野外は測れない) / `openingNearestMiss`
  (把持棄却の最小開口不足量; 接触対なしは測れないので null)。いずれもソルバ実装に
  依存しない幾何の決定事実で、0007 の包含テストを通る。IK/干渉の near-miss は
  依然定義できないため入れない (非対称の理由は不変)。
- `scoreBreakdown` に `visible` / `graspable` (required) を追加。camera/gripper
  未宣言のリクエストでは空虚に true (どちらのケースかはリクエスト自身が運ぶ)。
- リクエスト側は `camera` (position + 任意 viewAxis/fovHalfAngle) / `gripper`
  (maxOpening + fingerClearance) を **typed optional** で追加 (閉オブジェクト)。
  宣言のみ — 判定はサービス側 (0006 の責務分割)。
- 演出 (可視率の色・メーター・階梯リスクの文言) は従来どおりクライアント導出で
  契約に足さない (0005/0007 の逆向き規則)。
- `contractVersion` 3 → 4。封筒不一致は従来どおり 400 (ADR-0004)。

## Consequences — Evidence と tradeoff(§1.2 Evidence)

- 肯定的: 空振りの説明がドメイン単位になり、演出なしで「どのドメインで・どれだけ
  惜しく」死んだかを運べる。閉層 + required 追加なので v3 消費者は封筒で確実に弾かれる
  (無言の誤読なし)。
- 受け入れるコスト: BFF 型再生成と UI の 5 段追従 (repo 側で同一 PR 完結 — ADR-082)。
  可視/把持の near-miss は「測れない棄却」で null になり得る (消費側は null 分岐を持つ)。
- 検証 (証拠): `npm run test:contract` — examples の v4 準拠 + 5 段恒等式 +
  score の required 5 判定 + camera/gripper の optional/closed 検査。repo 側
  `core/tests/test_contract_conformance.py` (pydantic binding) と
  `server/test/grasp.contract.test.js` (BFF 導出) が両端で drift を縛る。
- 波及: `schema/grasp-search-{request,response}.schema.json`, `contract-version.json`,
  `examples/*`, 消費 2 端 (BFF `.d.ts` 再生成 / core pydantic)。
