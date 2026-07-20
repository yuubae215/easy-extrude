# ADR-083: ロボット base position をユーザーが動かし、grasp-search 契約に正式に載せる

- Status: Accepted (実装済)
- Date: 2026-07-20
- 関連: ADR-074 (BFF <-> コアAPI 契約 / contractVersion bump 規則) / ADR-075 (段階0 判定エンジン:
  `robot.base` を IK/reach の基準点として既に使用) / ADR-078 (cone/approach の用語境界) /
  ADR-057 (Grasp Search UI パネル) / ADR-060 (契約データ統治: 決定層は閉)

## Context

`src/view/RobotStage.js` はロボット骨格を常にハードコード位置 `[-2, 2, 0]` に描画するだけで、
動かす手段がなかった。一方 `core/easy_extrude_core/engine/types.py` の `Robot.base` と
`engine/feasibility.py` (`within_reach` / `NaiveIkSolver`) は既にロボット base を reach/IK の
基準点として使っている — `problem_from_declaration()` (`engine/pipeline.py`) は単発
`/grasp/search` の open payload から `robot.base` / `reachMin` / `reachMax` /
`wristConeHalfAngle` を寛容に読んでいる。ただし公開契約
(`packages/grasp-contract/schema/grasp-search-request.schema.json`) の
`graspSearchDeclaration` はこれらを型として宣言しておらず (`additionalProperties: true`
で無検証に通っているだけ)、フロントからも一度も送られていなかった。

つまり「ロボットの base position が reach/IK に効く」経路は core 側に既に存在するが、
(a) 契約として宣言されておらず (b) ユーザーが動かす UI もなく (c) フロントからその値が
送られていない、という 3 つの欠落だった。

## Decision

1. **契約: `graspSearchDeclaration.robot` を型として追加する。** `base` (vec3) /
   `reachMin` / `reachMax` / `wristConeHalfAngle` を optional なプロパティとして宣言する。
   ADR-074 §3 の規則により、**optional フィールドの追加は contractVersion を上げない**
   (意味が変わるわけではなく、core が既に受理していた値を型で保証するだけ)。
2. **core/ は無変更。** `problem_from_declaration` は既にこのキーを読んでいるため、
   ソルバ側のロジック変更は不要 — 契約を型で追認するだけで済む。IK/reach の「解き方」は
   従来どおり `core/` の専有 (CLAUDE.md AI 向けガード)。
3. **フロント: robot base position をドメイン外の view/UI 状態として持つ。**
   Solid 等の DDD エンティティとは異なり、ロボットは「解の対象」ではなく検証用の
   read-only スケルトンなので、`uiStore` の header 系状態 (`robotVisible` と同じ並び) に
   `robotBase: [x, y, z]` を追加する。`RobotStage.setPosition(x, y, z)` で `THREE.Group`
   のトランスフォームを更新し、Header の Robot ボタン脇に X/Y の数値入力を出す
   (Z は地面 0 固定 — World coordinate system: XY 平面が地面)。
4. **`GraspController.runGraspSearch()` が `robot: { base: [...] }` をリクエストに含める。**
   ソルバは「宣言された器」を受け取るだけで、reach/IK の判定はソルバの専有のまま
   (decide/propose の動詞境界を侵さない — ロボット位置は *宣言*、reach 判定は *解*)。

## Consequences

- ユーザーはロボットをドラッグ/数値入力で動かせるようになり、grasp-search の結果
  (reach/IK フィルタ) がその位置を実際に基準にするようになる。
- 契約変更は optional 追加のみで contractVersion 据え置き。`packages/grasp-contract` の
  conformance test に `robot` ありなしの両方の example を足して drift を防ぐ。
- `reachMin`/`reachMax`/`wristConeHalfAngle` の UI (cone 編集含む) は ADR-078 が
  「申し送り」として残していた affordance の一部 — 本 ADR は base position のみを
  実装し、cone 半角などの残りは引き続き後続課題とする。
