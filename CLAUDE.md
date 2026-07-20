# 🏛️ easy-extrude — Core Architecture & Meta Mental Model

Voxel-based 3D modeling app built with Three.js + Vite. Deployed to GitHub Pages.
For project structure, MVC design, and features see `README.md`.

## Constitutional Rules (read before any code change)

1. **DDD Entity Core** — the design center is always the domain entities in
   `src/domain/`. All other layers depend inward; domain depends on nothing.
2. **Pure / Side-Effect Separation** — every function and class must be clearly
   categorised as either a *pure computation* (deterministic, no I/O) or a
   *side-effectful operation* (DOM, Three.js, network, state mutation). Never mix.
3. **MVC coordination** — the Controller is thin; it translates input events
   into Model/Service calls and View updates. Business logic lives in Domain;
   rendering in View.
4. **Concurrency strategy** — distinguish *optimistic* (real-time, non-blocking)
   from *pessimistic* (consistency-critical, blocking) locking before
   implementing any async or high-frequency operation. See `docs/CONCURRENCY.md`.

## スコープ境界 (レイヤ境界 — 2026-07-19 に repo 境界から改定)

grasp-search バックエンド (`core/`) の同居により、このリポジトリは
**フロント → 契約 → バックエンド** の 3 層 monorepo になった。かつて
「repo の外」で守っていた線は、いま **レイヤ間の線** として同じ強度で守る。

| レイヤ | 置き場所 | 責務 |
|--------|---------|------|
| フロント | `src/` (+ `schema/`, `examples/`) | ブラウザ 3D エディタ / Layout・Context DSL の公開スキーマ・コンパイラ・バリデータ / 決定的 core (`SynonymQuotient`・`CanonicalForm`) |
| 契約 | `packages/grasp-contract` (repo 内の中立正本 — ADR-082 で submodule から吸収) | BFF ⇄ コアAPI の I/O JSON Schema + `contractVersion` (ADR-074) |
| バックエンド | `server/` (BFF) + `core/` (Python 判定エンジン + FastAPI, uv 管理) | 制約の **解法**: 候補生成 → ドメイン段階フィルタ (リーチ/IK/把持性/可視性/干渉 — ADR-075/081) → 加重スコア (ADR-076)、propose-only レコメンドレーン (ADR-077)、bin-picking シーン層 (ADR-078) |

`templates/` は手書き完成 DSL テンプレ (契約形式リクエスト実例) = バックエンドレイヤ
付属の受け入れフィクスチャ (`core/tests/test_templates.py` が消費)。フロントの
`examples/` (Layout/Context DSL のギャラリー種) とは別物。

不変の規律 (repo 同居後も変わらない):

- **`src/` は解法を持たない。** IK / 干渉 / リーチ / 把持安定性の *解き方* は
  `core/` にのみ書く。フロントは DSL で `ik_solvable` 等の **参照名を宣言**し、
  結果は契約経由で受け取って表示するだけ。`src/` から `core/` を import する
  経路は存在しない (越境は必ず HTTP + 契約)。
- **decide / propose の動詞境界 (ADR-056/077)。** 等価/対応を **決定** するのは
  フロント側の決定的 core (キュレーション同義語商 + 正規形シグネチャ + 構造 diff +
  exact-color reconcile)。embedding / 類似度で **提案・ランキング** するのは
  `core/recommendation/` の propose-only レーンで、真偽値を返さない。辞書
  (`QUOTIENT_TABLE`) に行を足せばその語は決定的 core へ昇格する (正攻法の拡張点)。

## BFF と契約 (越境防止)

契約 (BFF ⇄ コアAPI の I/O) の正本は JSON Schema パッケージ
(`@easy-extrude/grasp-contract` = `packages/grasp-contract`、ADR-082 で submodule から
repo 内へ吸収) にある。BFF (TS) は Schema から型を *導出*、`core/` (Python) は pydantic を
Schema への *binding* として準拠テストで縛る — どちらも契約を *定義/拡張* しない。契約の
変更は Schema + `contract-version.json` を **同一 PR で** 更新する意図的な版上げ行為のみ
(schema 変更に版上げが無ければ CI `contract-wall` が fail — ADR-082。デプロイ単位間の
ズレは従来どおりコアAPI が 400 で即拒否 — ADR-074)。

統治 (ADR-060 / PHILOSOPHY #29): ワイヤに載せるのは *ソルバが決定した事実* のみ
(score 層は閉 `additionalProperties:false`、pose は **kind 判別の有界 union**)。
演出 (接近ベクトル・ゴースト色・アニメ) はクライアントで *導出* し、契約に足さない
(`optional` 兄弟を生やさない = 無限成長の防止)。新しい姿勢表現は kind を 1 つ足す =
版を上げる意図的行為。

## AI 向けガード

「制約の解法」に当たるコード (IK / 干渉 / リーチ / 安定性の解き方) を **`src/` に**
書こうとしたら、**作業を中断**し「解法はバックエンドレイヤ `core/` の責務です
(フロントは宣言と表示のみ — 越境は契約経由)」と促して `core/` 側へ誘導すること。
`core/` 内での解法実装は in-scope (ADR-075 の pure/副作用規律に従う)。

同様に、**embedding / コーパス / 外部知による曖昧マッピングの提案・ランキング** を
`src/` の決定的 core に混ぜようとしたら、**作業を中断**し「それは `core/recommendation/`
の propose-only レーンの責務です (決定は `SynonymQuotient`/`CanonicalForm`、提案は
lane — 動詞境界 ADR-056/077)」と促すこと。lane は真偽値 (等価か否か) を決して返さない。
キュレーション辞書 (`QUOTIENT_TABLE`) への行追加と決定的な `CanonicalForm` は
フロント側 in-scope。

契約 (`packages/grasp-contract`) を **contractVersion bump なしで** 編集しようとしたら
中断 — 契約変更は Schema + `contract-version.json` + 両側の導出/準拠テストを同一 PR で
更新する版上げ行為としてのみ行う (ADR-082/074。閉層に `optional` 兄弟を生やさない統治
ADR-060 は従来どおり)。

## Document navigation

コード変更前に関連ドキュメントを引く。キーワード → 「まず読む」の全索引は
**`docs/NAVIGATION.md`** (on-demand — 自動ロードしない)。主要な入口だけ挙げる:

| Topic | Read first |
|-------|-----------|
| philosophy / 原則 #N | `docs/PHILOSOPHY.md` (正本; 常時 load のダイジェストは `.claude/rules/10-principles.md`) |
| architecture / design / why | `docs/ARCHITECTURE.md` → `docs/adr/README.md` (`/adr <topic>` で検索) |
| state machine / mode / FSM | `docs/STATE_TRANSITIONS.md`, ADR-008/039 |
| screen / UI / layout | `docs/SCREEN_DESIGN.md`, `docs/LAYOUT_DESIGN.md` |
| events / input | `docs/EVENTS.md` |
| concurrency / async | `docs/CONCURRENCY.md` |
| 実装ルール | `docs/CODE_CONTRACTS.md` (index → detail 必要分のみ) |
| 上記以外のキーワード | `docs/NAVIGATION.md` の trigger 表 |

**`/adr <topic>`** — slash command to search the ADR index.

Create a new ADR when a design choice is non-obvious or hard to reverse.
Update `docs/adr/README.md` index whenever an ADR is added or superseded.

---

## Design change impact

新しい要件が来たら `docs/NAVIGATION.md` §Design change impact の表で ✅ 対象ドキュメントを
確認し、コード変更後に更新してから commit する。非自明・不可逆な設計選択は新 ADR +
`docs/adr/README.md` インデックス更新。

## After fixing a bug

commit 前に二問を順に問う (核 §1.2 / 原則 #19):

- **Q1 — Rule missing?** 暗黙ルールの欠落が原因なら → `docs/code_contracts/*.md` detail に
  追記し、`docs/CODE_CONTRACTS.md` index の行を更新。迷ったら足す。
- **Q2 — Pattern repeating?** 同じ根本価値の違反が **2+ の無関係な文脈**にあれば →
  `docs/PHILOSOPHY.md` の原則を追加/研磨 (+ `.claude/rules/10-principles.md` の該当行)。
  1 文脈のみなら PHILOSOPHY の **Yellow Cards** 表に行を足す (2 例目で昇格)。

## Development commands

```bash
pnpm install   # install dependencies
pnpm dev       # dev server → http://localhost:5173
pnpm build     # production build → dist/
pnpm preview   # preview production build
```

バックエンド (grasp-search) を含むフルスタック:

```bash
pnpm dev:all                              # BFF (3001) + vite (5173)
cd core && uv sync --extra dev --extra serve   # 初回のみ (Python は uv 管理)
cd core && uv run python -m easy_extrude_core.api  # コアAPI (4001 = BFF upstream 既定)
pnpm test:core                            # core の pytest (契約準拠テスト含む)
```

コアAPI の URL/認証は env 注入 (`GRASP_SEARCH_URL` / `GRASP_API_INTERNAL_TOKEN`) —
repo に焼かない (ADR-076)。

## World coordinate system

**ROS world frame** (+X forward, +Y left, +Z up). Right-handed. Matches ROS REP-103.
Three.js `camera.up = (0,0,1)`. XY plane (Z=0) is the ground plane.

**コード変更前に `docs/CODE_CONTRACTS.md` の該当セクションを読むこと**（自動ロードしない —
index 表で該当領域を特定し、detail ファイル `docs/code_contracts/*.md` を必要分だけ読む）。

@docs/CLAUDE_FABLE5_BEHAVIOR.md

## Notes for changes

- `vite.config.js` `base` must match the repo name (`/easy-extrude/`)
- Three.js addons must be imported from `three/addons/...`
- WASM build lanes are **not** needed for `pnpm build` (= `vite build` only; both lanes ship committed artifacts in `src/engine/`, and CI/deploy consume those artifacts — ADR-064 Phase 1, ADR-053 §11). To regenerate them run `pnpm setup:toolchain` once (installs wasm-pack + Emscripten SDK + inits `robotics-wasm/vendor` submodules), then `pnpm build:full` (Rust wasm regen + vite build) or the individual lanes `pnpm build:wasm` (Rust) / `pnpm build:robotics-wasm` (C++ KDL+ruckig → `src/engine/robotics-wasm/`). On a fresh clone run `git submodule update --init --recursive` before the C++ build.
- The neutral I/O contract `@easy-extrude/grasp-contract` lives **in-repo** at `packages/grasp-contract` (a pnpm-workspace package the BFF depends on as `workspace:*` — absorbed from the former git submodule, ADR-082; no submodule init needed for it anymore). The BFF only *derives* from it: `pnpm --filter easy-extrude-bff run gen:contract-types` regenerates the committed `.d.ts` from the schema, and `pnpm test:contract` runs the conformance + contractVersion-drift tests. Editing the contract is a deliberate versioned act: change the schema together with a `contractVersion` bump in the same PR (CI `contract-wall` fails otherwise).

設計原則: 蒸留ダイジェストは `.claude/rules/10-principles.md`(kernel 統合済み 2026-07-19、
常時 load)。正本 (全文・事例・Yellow Cards) は `docs/PHILOSOPHY.md` — 原則番号 #N の
詳細が要るときだけ該当節を読む。

## Session history

廃止 (2026-07-19)。セッションで起きたことの正準は git log、設計判断の正準は ADR、
導出ルールの正準は CODE_CONTRACTS / PHILOSOPHY — 履歴をここに複製しない (核 §1.1)。
Orient は `git log --oneline -15` + `docs/adr/README.md` で行う。
旧全文は `docs/SESSION_LOG.md` (凍結アーカイブ) に残存。
