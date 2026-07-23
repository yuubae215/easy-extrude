<!--
  easy-extrude PR テンプレート — 核 §1.2（正当化の鎖）と #19（doc drift はバグ）を
  PR 記述に落とすための骨組み。各節を埋める（該当しない節は「N/A」を残す、削除しない）。
  見出しはそのまま、中身を差し替える。AI が起票する PR も同じ様式で書く。
-->

## What & Why（Goal ← Strategy）

<!-- 何を変えたか（1-2 行）と、それがどの Goal（欲しい性質）にどう効くか。
     要件が解の形で来ていたら Goal へ一段持ち上げてから書く（核 §1.2）。 -->

-

## ADR / 設計判断

<!-- 非自明・不可逆な設計選択がある PR は ADR 必須（新規 or 参照）。
     例: `ADR-088`（Accepted）。ADR が無く自明なら「自明変更 — ADR 不要」と明記。 -->

- 参照/新規 ADR:
- `docs/adr/README.md` インデックス更新: [ ] 済 / [ ] 不要

## Layer & Blast radius（波及範囲）

<!-- 触ったレイヤ（フロント `src/` / 契約 `packages/grasp-contract` / BFF `server/` /
     core `core/`）と、変更が届く範囲を一言で。越境（`src/`→`core/` の解法、
     決定的 core への提案ロジック混入）が無いことを確認。 -->

- 触ったレイヤ:
- 波及するモジュール:
- 契約（response/request スキーマ・`contractVersion`）への影響: なし / あり（版上げ済）

## Evidence（証拠 — 鎖を閉じる）

<!-- 完了はループの閉じ＋証拠を要する（核 §5）。実行した検証にチェック。 -->

- [ ] `pnpm test`（JS スイート）green
- [ ] `pnpm typecheck` クリーン
- [ ] `pnpm build` クリーン
- [ ] `pnpm test:context` / `pnpm test:contract` / `pnpm test:core`（該当時）
- [ ] 追加/更新したテスト:

## Docs / Rules drift（#19）

<!-- バグ修正・設計判断のたび、欠けていた暗黙ルール/理由を反映してから commit。 -->

- [ ] `docs/code_contracts/*.md`（+ index）更新 / 不要
- [ ] `docs/PHILOSOPHY.md` 原則の追加・研磨 / 不要
- [ ] 関連ドキュメント（NAVIGATION の Design change impact 表）更新 / 不要

## Notes for reviewers

<!-- レビュアが最初に見るべきファイル、既知の残課題、意図的スコープ外など。 -->

-
