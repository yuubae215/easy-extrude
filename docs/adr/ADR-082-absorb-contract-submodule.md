# ADR-082: 契約 submodule の repo 内吸収 — 壁は repo 分離ではなく CI ガードで守る

- Status: Accepted (実装済み — 本 ADR と同一コミット系列で移設・追従・検証まで完了)
- Date: 2026-07-19
- Deciders: yuubae215 (承認 2026-07-19) / 設計セッション
- Supersedes / Superseded by: ADR-074 **§6 (契約型の置き場所) のみ改訂** (契約の意味論・
  contractVersion ガード・導出規律は ADR-074 のまま有効)
- 関連: ADR-074 (BFF <-> コアAPI 契約) / ADR-064 (CI ゲート = 規律を機械で強制) /
  ADR-060 (契約統治: 閉層 + kind union) / ADR-079 (版上げ運用の先例) /
  ADR-081 (契約 v4 申し送り — 本 ADR で変更手順が repo 内完結になる)

## Context — Goal と力学 (§1.2 Goal)

Goal: **契約の壁 (単一正本・版付き・両側は導出のみ) を維持したまま、契約の物理的な
置き場所に起因する摩擦を除くこと。**

契約 `@easy-extrude/grasp-contract` は外部 repo `easy-extrude-contract` の git submodule
(`vendor/grasp-contract`) として vendor されてきた。外部化の構造的理由は「バックエンドが
別 repo にいた時代、両者のどちらにも属さない中立の置き場が必要だった」こと (ADR-074 §6)。
しかし monorepo 統合 (2026-07-19, `core/` 同居) で消費者は BFF (`workspace:*` + 型生成) と
core (pydantic binding + conformance テスト) の 2 者だけになり、**両方ともこの repo の中**
にいる。外部 repo に他の消費者は存在しない (ユーザ確認 2026-07-19)。

残っているのは摩擦の実証だけである: fresh clone で submodule 未初期化のまま core テストを
回すと conformance 系 11 件が落ちる (2026-07-19 本セッションで再現)。CI は 3 ジョブ全てに
専用の init ステップを持つ。CLAUDE.md は fresh clone 手順に `git submodule update --init`
を要求し続ける。

一方、**壁の本体は repo 分離ではない**: (a) JSON Schema が唯一の正本で BFF/core は導出・
binding のみ、(b) `contractVersion` の実行時ガード (不一致 400/502)、(c) conformance +
drift テスト。この 3 つはすべてテスト/CI で強制されており (ADR-064)、置き場所に依存しない。
デプロイ単位 (Pages フロント / BFF / コアAPI) は同一 repo でも今後分かれ得るため、
実行時ガード (b) は置き場所と無関係に維持が必要。

repo 分離が事実上担っていた唯一の固有機能は「契約を気軽に編集できない物理的摩擦」であり、
これは吸収時に等価な CI ガードで置換できる。

## Options considered

- **A: 現状維持 (外部 repo + submodule)** — tradeoff: 摩擦 (clone init / CI init / 2 repo
  往復の版上げ手順) が恒久化する。外部化の構造的理由は既に消滅しており、得るものは
  「編集しにくさ」だけ。却下。
- **B: `packages/grasp-contract` として repo 内へ吸収 + 契約壁 CI ガード新設 (採用)**
  — tradeoff: 「別 repo」という物理的摩擦を失う。CI ガード (schema 変更に
  contractVersion bump 必須) とレビュー規律で代替する。
- **C: 吸収して壁も撤廃 (契約を通常コードとして自由編集)** — tradeoff: 閉層・版付き契約の
  統治 (ADR-060/074) が崩壊し、「気軽に optional を生やす」無限成長が始まる。却下。

## Decision — Strategy (§1.2 Strategy)

1. **移設**: submodule `vendor/grasp-contract` を廃止し、内容を通常の workspace パッケージ
   `packages/grasp-contract/` としてコミットする (ADR-074 §6 実装当初の位置に戻る)。
   パッケージ名 `@easy-extrude/grasp-contract` と BFF の `workspace:*` 依存は不変 —
   BFF/core のコード変更は参照パス (型生成スクリプト / `contract_pkg.py`) のみ。
   外部 repo `easy-extrude-contract` はアーカイブする (ユーザ操作、repo 外)。
2. **統治は不変 (読み替えのみ)**: Schema が唯一の正本 / BFF は導出のみ / core は binding を
   準拠テストで縛る / 閉層 + kind 判別 union (ADR-060) — すべて従来どおり。従来の
   「契約は上流で変更し contractVersion を上げる」は「**契約は `packages/grasp-contract` で
   contractVersion bump とともに変更する**」に読み替える。契約変更が要る作業での手順は
   「Schema + `contract-version.json` + 両側の導出/準拠テストを同一 PR で更新」になる
   (2 repo 往復が消える)。
3. **契約壁 CI ガード新設**: PR で `packages/grasp-contract/schema/` に差分があるのに
   `contract-version.json` に差分が無ければ CI を fail させる (`contract-wall` ジョブ)。
   repo 分離が担っていた「気軽に編集させない」を機械で強制する (ADR-064 の原則:
   規律は記憶でなく機械で)。
4. **ドキュメント追従**: CLAUDE.md (層表 / AI ガード / Notes)・README・ARCHITECTURE・
   CODE_CONTRACTS (index + detail)・ADR-074 ヘッダ・ADR-081 の該当記述を同一系列で更新
   (Documentation Drift Is a Bug — PHILOSOPHY #19)。

## Consequences — Evidence と tradeoff (§1.2 Evidence)

- 肯定的:
  - fresh clone と CI から submodule init が消える (clone 直後にテストが素通しで green)。
  - 契約変更 (例: ADR-081 の v4) が同一 PR で Schema + 両側テストと一緒に回り、レビューが
    一望できる。実行時ガードは残るため、運用でのデプロイスキューは従来どおり 400 で検知。
- 受け入れるコスト / 否定的:
  - 物理的摩擦の喪失 → CI ガード + レビュー規律で代替 (ガードが守るのは「版上げ忘れ」
    だけであり、「安易な契約拡張」自体はレビューの責務のまま — ADR-060 の統治意識は必要)。
  - 汎用 CI ガードは `schema/` 配下しか見ない: schema 外の意味変更 (例 examples のみ) は
    ガード対象外 (従来どおり conformance テストが受け持つ)。
- 検証 (証拠):
  - 移設後 `pnpm test:contract` green + `core: uv run pytest` green (submodule init なし)。
  - `contract-wall` ガードのロジックをローカルで模擬 diff により検証 (schema のみ変更 →
    fail 判定 / schema + version 変更 → pass 判定)。
  - `pnpm install` 後の lockfile が workspace パスの移動のみを差分に持つこと。
- 波及 (blast radius):
  - `.gitmodules` / `pnpm-workspace.yaml` / `pnpm-lock.yaml` / `server/package.json` /
    `core/tests/contract_pkg.py` / `.github/workflows/ci.yml` /
    CLAUDE.md / README.md / docs/ARCHITECTURE.md / docs/CODE_CONTRACTS.md /
    docs/code_contracts/{architecture,server_async}.md / ADR-074 / ADR-081 / GSN 論証木。

## Lens notes

- **§1.1 真実の源は一つ**: 正本は移動するだけで一つのまま。submodule pin (gitlink) と
  外部 repo HEAD という「二つの位置指示」が消えるぶん、むしろ源の指し方は単純になる。
- **層 + 契約 (§1.3)**: レイヤ構造 (フロント → 契約 → バックエンド) は不変。変わるのは
  契約レイヤの*物理配置*のみで、依存方向・導出規律は据え置き。
- **黒箱**: BFF/core から見た契約の入出力 (パッケージ名での import / Schema ファイル形状)
  は不変 — 参照パスの 2 箇所以外、両側のコードは無変更で通る。
