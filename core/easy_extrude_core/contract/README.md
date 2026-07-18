# contract/ (BFF <-> コアAPI の I/O 契約)

ADR-074 (`docs/adr/ADR-074-bff-core-api-contract.md`) の型を Python で表現したもの。
**契約の型 + `contractVersion` ガードのみ。** 判定エンジン (IK/干渉/リーチ/スコア計算) は含まない。

## 中身
- `version.py`: `CONTRACT_VERSION` と `check_contract_version()` (不一致なら例外 -> 端で 400)。
- `models.py`: 入出力の型。
  - 入力 `GraspSearchRequest`: `graspSearch` 宣言 + `layout_version` (public スキーマ参照) + `contract_version`。
  - 出力 `GraspSearchResponse`: 上位N件 (`PoseCandidate`) + 各候補の `ScoreBreakdown`。

## 線引き (混ぜない)
- Layout DSL (hardConstraints / objectives) の詳細スキーマは public/共有パッケージの正本に属する。
  ここでは二重定義せず `layout_version` で参照する。
- objective スコアは絶対基準で 0-1 正規化済みを契約として強制 (テンプレ間比較可能性 = 商品価値)。

## 正本との関係 (ADR-074 §6)
契約の **正本は中立 repo (`@easy-extrude/grasp-contract`) の言語非依存 JSON Schema**。
コア側では submodule `vendor-contract` として pin して参照する。この pydantic は
その **Python binding**。`core/tests/test_contract_conformance.py` が実インスタンスを
wire 形 (camelCase) にして JSON Schema と突き合わせ、drift を検知する。

共有パッケージは外部の中立 repo (easy-extrude-contract) に移設済み。BFF (TypeScript) も
同じ JSON Schema から型を導出する。参照の安全な向きはコア -> 中立物 (外部)。
