# 064. Rigor 側の遡及プログラム — CI ゲート化・DSL スキーマ昇格・未契約ワイヤの明示宣言・play の検証

- Status: Accepted (Phase 1 実装済 2026-07-08; Phase 2–4 後続)
- Date: 2026-07-08
- Deciders: yuubae215, Claude
- Supersedes / Superseded by: なし
- References: PHILOSOPHY #29（Rigor on the Wire, Play in the Client — 本 ADR はその **rigor 側**の全域展開。play 側の全域展開 = ADR-062 と対称）,
  #11（Silent Failures）, #19（Documentation Drift）, ADR-062（三層方針 — play 側 scope note）,
  ADR-060（Grasp 契約統治 — rigor の模範形）, ADR-054（BFF 素通し + エラーエンベロープ）,
  ADR-045（Layout DSL）, ADR-046（Context DSL）, ADR-015/017（BFF / WebSocket）, ADR-053（robotics WASM lane）

## Context — Goal と力学（§1.2）

2026-07-08 の横断レビューで、PHILOSOPHY #29 の**二つの半身の成熟度が非対称**であることが
確認された。play 側（体感層）は ADR-062 の scope note で全 UX 面の既定に昇格済みだが、
rigor 側（契約層の堅さ）は生まれた場所 — grasp スレッド（ADR-054/060）— の bounded
context に閉じたままである。具体的な事実:

- **CI がテストを 1 本も実行していない。** `.github/workflows/` は `deploy.yml` のみ
  （main への push トリガ、typecheck + build のみ）。PR 時には何も走らず、既存の
  434 テストと契約ドリフト番人 `pnpm test:contract` はマージのゲートになっていない。
  文書化された規律（CODE_CONTRACTS 全 80+ ルール）を守るのは善意だけである。
- **`test:context` が 34 テストファイルを手動列挙**している。新規テストの script
  追加漏れは *静かに実行されなくなる* — #11 が禁じる silent-failure 構造そのもの。
- **typecheck の実効範囲が `src/types/` + `src/domain/` の 2 ディレクトリのみ**
  （tsconfig include）。CI の "Type check" は AppController も context 層も見ていない。
- **Layout DSL / Context DSL が中立スキーマ成果物でない。** CLAUDE.md はこのリポジトリを
  「宣言とスキーマの層」「Layout DSL の公開スキーマ」と自己定義するが、実装は
  `LayoutDslSchema.js` / `ContextDslSchema.js` という JS 定数 + 手書きバリデータで、
  grasp-contract が受けた待遇（JSON Schema、`additionalProperties:false`、conformance +
  version-drift テスト）を受けていない。**リポジトリの本業と宣言されたものが、
  一番堅くない**。
- **BFF の 5 本のワイヤのうちスキーマ検証があるのは grasp の 1 本だけ。** ajv の import は
  `server/src/grasp/contract.js` のみ。`/api/scenes` は自由 JSON を無検証で永続化し
  （シーン文書の形はコメントにしか存在しない）、WebSocket メッセージ・STEP import も
  無スキーマ・無版管理。
- **play 側にも残欠が二つ**: 演出の実体（フラッシュ・ゴースト・メーターの見え方）は
  E2E ゼロで、純粋計算層のテストだけが体感を代弁している。`prefers-reduced-motion`
  への言及は 0 件 — 遊び心にアクセシビリティの逃げ道がない。

**Goal（解でなく性質で）**:

1. **文書化された規律は機械が強制する** — 契約・テスト・型の遵守が CI で検証され、
   赤い PR はマージできない。規律の守り手を人の記憶から構造へ移す（#19 の機械化）。
2. **rigor は全ワイヤの既定であり、例外は明示宣言される** — スキーマの無いワイヤは
   「意図的に対象外（理由と期限つき）」と ADR / コード上で宣言されているか、
   スキーマを持つかの二択。暗黙の例外を残さない（#11）。
3. **リポジトリの自己定義とスキーマ実装が一致する** — 「スキーマ層」を名乗る以上、
   Layout/Context DSL は grasp-contract と同格の閉じた版付きスキーマ成果物である。
4. **play は検証と逃げ道を持つ** — 体感層（このプロダクトの差別化要素）が黙って
   壊れない検証面を持ち、motion 設定を尊重する退行形を持つ。

**力学・制約**:

- **GitHub Actions の課金**: 本リポジトリは public であり、GitHub ホストの standard
  runner は **public リポジトリでは無料・分数無制限**（2026-01 時点の GitHub 料金
  ポリシー）。課金の崖は存在しない。仮に将来 private 化しても Free プランは
  2,000 分/月まで無料で、既定の spending limit が $0 のため**超過時は Actions が
  停止するだけで請求は発生しない**。既に `deploy.yml` が 2026-03 から毎 push で
  Rust ビルド込みの Actions を消費しており、追加の test ワークフローは同種の消費である。
- PR CI は速くなければ使われない。WASM はコミット済み artifact（ADR-053 §11 の規律）を
  使えば、PR CI に Rust/Emscripten ツールチェーンは不要。
- Layout/Context DSL の正本は**本リポジトリ**（grasp-contract と違い upstream 分離は
  不要 — スコープ境界「宣言とスキーマはここ」）。スキーマ化は分離ではなく形式の昇格。
- 運用の堅さ（JWT secret 必須化・CORS 制限・WS 認証・シーンのユーザースコープ）は
  「型の堅さ」と別種の決定であり、1 ADR = 1 決定（§1.1）に従い**本 ADR から除外**し、
  別 ADR（BFF Phase C セキュリティ）へ委譲する。

本 ADR は新機能の決定ではなく、ADR-062 と対をなす**プログラム決定**である:
#29 の rigor 側を全ワイヤへ遡及し、両半身の成熟度を対称化する。

## Options considered

- A: **現状維持（rigor は grasp スレッドの局所規律のまま）** — tradeoff: 実装コスト
  ゼロだが、契約遵守が善意依存のまま残り、次のワイヤ・次のテストファイルで同じ
  非対称が再生産される。`test:contract` という既存の番人すら動いていない状態を
  容認する。
- B: **一括フルレトロフィット（全ワイヤのスキーマ化 + E2E 完備を単一フェーズで）** —
  tradeoff: scenes/WS は Phase C で再設計される可能性が高く、捨てるワイヤに完全な
  スキーマを書くのは過剰モデリング（核 §5）。ビッグバンは検証不能（§2: ループは
  証拠で閉じる）。
- **C: 段階遡及プログラム — CI ゲートを先頭に、価値の濃い順に 4 フェーズ【採用】** —
  tradeoff: フェーズ間で一時的に「宣言済みだが未施工」の面が残るが、各フェーズが
  独立に証拠で閉じられる。

## Decision — Strategy（§1.2）

**C** を採る。rigor 側の既定を次のように確定する:

> **すべてのワイヤ（HTTP ルート・WS メッセージ・ファイル形式・DSL）は、
> (a) 閉じた版付きスキーマと CI 上の conformance テストを持つか、
> (b)「意図的に rigor 対象外」であることを理由・期限つきで明示宣言するか、
> のどちらかである。第三の状態（暗黙の無契約）は存在しない。**

### Phase 1 — CI ゲート化（規律の機械化。最優先・最小コスト）

1. `ci.yml` を新設: トリガは `pull_request` + `push: main`。ジョブは
   ①全単体テスト ②`test:contract` ③`typecheck` ④`vite build`（コミット済み WASM
   artifact を使用 — Rust ツールチェーン不要）。`concurrency` + `cancel-in-progress` +
   `timeout-minutes` で消費を抑える。
2. `pnpm test` を新設し **glob 実行**（`node --test "src/**/*.test.js"`）に置き換える。
   手動列挙の `test:context` は互換のため残してよいが、CI は glob を回す —
   テストファイルの追加漏れという silent-failure 構造の除去（#11）。
3. `pnpm build` から `build:wasm` を外し、`build:full`（wasm 再生成込み）へ分離する。
   CLAUDE.md「WASM build lanes are not needed for `vite build`」と package.json の
   矛盾を script 側を直して解消する（#19）。`deploy.yml` も committed artifact を
   使う形へ揃え、「コミット済み artifact が配信される」を単一の真実にする（§1.1）。

### Phase 2 — DSL スキーマ昇格（本業の rigor 化）

`layout/1.0` と `context/0.4` を JSON Schema 成果物へ昇格する。grasp-contract と同形:
`additionalProperties:false`、版フィールド、examples/ を入力とする conformance テスト。
置き場所はリポジトリ内パッケージ（例 `schema/`）— 正本はここなので submodule 分離は
しない。既存 JS バリデータ（`LayoutValidator` / `ContextValidator` の構造検査部分）は
スキーマから**導出**するか、スキーマとの**同値テスト**で拘束する — 二重定義のドリフトを
CI が検出する形にする（§1.1: 真実の源は Schema 一つ）。R6/R9 等の意味論検査は
JS バリデータに残る（スキーマは形の契約、validator は意味の契約 — 責務は分かれる）。

### Phase 3 — 未契約ワイヤの明示宣言

BFF の残り 3 ワイヤに対し二択を確定する:

- `/api/scenes`: **rigor 対象**。scene JSON v1.3 をスキーマ化し、書き込み時に ajv 検証
  （不正 JSON は 400）。読み出しガードだけの現状は片側検証で、DB がゴミの受け皿になる。
- `/api/ws`（geometry セッション）と `/api/import`（STEP）: **暫定対象外を宣言**。
  各ルート冒頭コメントと本 ADR に「dev-phase・Phase C（BFF 再設計）で契約化 or 廃止」
  と期限つきで記す。宣言があることが (b) の要件 — 無言の無契約とは区別される。
- 運用セキュリティ（secret 必須化・CORS・WS auth・ユーザースコープ）は別 ADR へ
  （本 ADR の References に追補予定）。

### Phase 4 — play 側の残欠（検証と逃げ道）

1. `FeedbackPrimitives` に `prefers-reduced-motion` 対応: `flashAnim` / `LandingFlash` /
   opacity パルスは motion 削減時、アニメなしの静的な色・アイコン変化へ退行する
   （情報は失わない — 演出の意味はフラッシュではなく「事実が変わった」の通知）。
2. Playwright スモーク E2E を CI の別ジョブに追加: 起動 → box 追加 → undo →
   テンプレート読み込み → negotiate タブ表示、程度の最小往復。体感層の配線が
   黙って死んでいないことだけを検証する（網羅は狙わない — #20）。

### PHILOSOPHY #29 への scope note 追記

ADR-062 が play 側で行ったのと対称に、rigor 側の scope note を #29 に追記する:
「rigor は grasp ワイヤの property ではなく全ワイヤの既定。例外は明示宣言される」。

## Consequences — Evidence と tradeoff（§1.2）

- **肯定的**: 既存の 434 テスト + `test:contract` という*すでに書かれた資産*が
  ゲートとして機能し始める（新規テスト作成ではなく配線だけ）。リポジトリの自己定義
  （スキーマ層）と実装が一致する。#29 の両半身が対称になり、新しいワイヤ・新しい
  入力面のどちらにも既定形が存在する状態になる。
- **受け入れるコスト**: PR ごとの CI 待ち時間（public につき金銭コストはゼロ、
  時間コストのみ — WASM 再ビルド排除で数分に収まる見込み）。スキーマと JS バリデータの
  二重管理リスク（→ 導出 or 同値テストで CI が拘束）。E2E の flakiness 管理
  （→ スモーク最小限に留める）。
- **検証（証拠）**:
  - Phase 1: 故意に失敗するテストを含む PR が**マージ不能**になることを 1 回実証する。
    glob 実行のテスト数が手動列挙時の実行数以上であることを CI ログで確認。
    **実装時のローカル証拠 (2026-07-08)**: glob `node --test "src/**/*.test.js"` = 443 テスト
    = 手動列挙の合計（`test:context` 434 + `test:layout` 9）と全件一致（漏れゼロ）。
    `test:contract` 16/16、`typecheck` クリーン、`vite build` は Rust ツールチェーン
    なしで 4 秒（committed artifact）。CI が必要とする submodule は
    `vendor/grasp-contract` のみ（robotics-wasm の vendor 3 本は不要）。
    ※「赤い PR がマージ不能」の完成には GitHub 側で branch protection
    （required status check = `gate`）の設定が必要 — リポジトリ管理者の操作。
  - Phase 2: `examples/*.json` 全件が新スキーマの conformance テストを通る。
    スキーマ違反サンプル（余剰フィールド）が **fail する**ことをネガティブテストで示す。
  - Phase 3: `/api/scenes` への不正 JSON 書き込みが 400 を返すテスト。対象外ワイヤの
    宣言コメントの存在。
  - Phase 4: reduced-motion 環境での退行形の描画テスト + E2E スモーク green。
- **波及（blast radius）**: `.github/workflows/`、`package.json` scripts、
  `src/layout/` / `src/context/` のバリデータ、`server/src/routes/scenes.js`、
  `FeedbackPrimitives.jsx`、`docs/PHILOSOPHY.md` #29、CLAUDE.md（Notes for changes の
  WASM 記述）。契約 (`vendor/grasp-contract`) とドメイン層は無改変。

## Lens notes

- **§1.1 真実の源**: 「テストの実行対象」（手動列挙 vs ファイルシステム）、「配信される
  WASM」（committed artifact vs CI 再ビルド）、「DSL の形」（JS 定数 vs スキーマ）の
  三箇所で第二の源が暗黙に存在していた。本 ADR は三つとも単一の源に畳む。
- **§1.3 層 + 契約**: 変えるのは検証層の配置のみで、層構造そのものは不変。
  grasp ワイヤで実証済みの形（Schema → 導出 → conformance → CI）を他ワイヤへ写像する。
- **様態**: 遡及プログラムは BPMN（フェーズ逐次）。ただし Phase 3 の宣言は Phase C
  再設計という外部事象待ちの CMMN 的要素を含むため、「期限つき宣言」という形で
  逐次フローに繋いだ。
