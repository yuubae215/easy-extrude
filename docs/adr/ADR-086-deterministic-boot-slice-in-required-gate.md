# 086. e2e は非必須のまま、boot 保証の決定的スライスだけを必須 gate に落とす

- Status: Accepted (実装済 — PR #341)
- Date: 2026-07-22
- Deciders: yuubae215, Claude
- Supersedes / Superseded by: なし (ADR-064 Phase 4 の e2e 分離判断を *補完* する — 覆さない)

## Context — Goal と力学 (§1.2 Goal)

達成したい性質: **「アプリが起動時に即死する」クラスの回帰は、必ずマージ前に機械が止める。**
かつ **その保証は誤検知でチームの開発速度を落とさない** (2 つの力学の両立)。

きっかけは ADR-085 の回帰 (PR #341 で修正)。`src/service/SceneService.js` の
`ensureRobotFrames()` が `ROBOT_BASE_FRAME_NAME`/`TCP_FRAME_NAME` を import 忘れのまま
参照し、`AppController` コンストラクタが起動ごとにそれを呼ぶため
`ReferenceError` でアプリ構築が丸ごと落ち、Three.js シーンが立つ前に停止 —
「React 外枠だけ、キャンバス真っ黒」で本番デプロイまで到達した。

なぜ既存の網をすり抜けたか (blast radius = CI の 3 ゲート):

- `pnpm typecheck` (`tsconfig.json`) は `checkJs` を `src/types/` + `src/domain/` に
  限定 (ADR-064 / Phase 2 決定)。service/controller/view のランタイム層は型チェック
  対象外なので、未解決の名前を `tsc` が見なかった。
- `pnpm test` は boot スタックを一度も組み立てない (純関数・ドメイン単体が中心)。
- 唯一 boot を実ブラウザで検証する Playwright smoke (`e2e/smoke.spec.js` の
  「boots without a page error」) は、**ADR-064 Phase 4 の意図的判断で非必須の
  別ジョブ** に置かれていた (カメラフライト等タイミング依存テストのフレーキーが
  型/契約ゲートを巻き込まないため)。

ここで解を急ぐと「e2e を必須に格上げ」に飛びつきやすい。しかしそれは ADR-064 が
避けたフレーキー巻き込みを再導入する。Goal に戻すと、必要なのは *e2e 全体の格上げ*
ではなく **boot 即死だけを止める決定的な判定** である。

## Options considered

- **A: e2e ジョブ全体をブランチ保護の必須チェックに格上げ** —
  tradeoff: boot 保証は必須化されるが、同ジョブ内のフライト/ドラッグ等の
  タイミング依存テストのフレーキーがそのままマージゲートに乗る。ADR-064 が
  意図的に避けた誤検知問題の再導入。開発速度を落とす力学に反する。
- **B: boot 保証の決定的スライスだけを切り出し、必須 `gate` に静的テストとして落とす** —
  tradeoff: 捕まえるのは「未解決の名前 / 存在しない import」クラスに限定される
  (メソッド不在の TS2339 等は対象外)。が、ブラウザ不要・約 5 秒・ゼロフレークで、
  ADR-064 の e2e 分離判断と両立する。
- **C: 現状維持 (e2e 非必須のまま、追加ガードなし)** —
  tradeoff: 同型の import 忘れ boot crash が今後も型/単体をすり抜けてデプロイに
  到達しうる。「起動即死は必ず止める」Goal を満たさない。

## Decision — Strategy (§1.2 Strategy)

**B を採る。e2e は非必須のまま据え置き、boot 保証のうち決定的に判定できる最小
スライス — 「起動時に未解決の識別子で ReferenceError を出さない」— だけを必須
`gate` に静的テストとして移す。**

具体:

- `src/BootWiring.test.js` (必須 `gate` = `pnpm test` 配下) が全ランタイム `.js` を
  TypeScript チェッカにかけ、**解決系の診断だけ** で fail する:
  TS2304/TS2552 (未解決の値名) と TS2305 (対象モジュールに無い named import)。
  深い型診断 (TS2339 property-does-not-exist, TS2345 …) は無視 — 型負債を増やさず、
  純粋に「boot が ReferenceError を投げ得ない」ことだけを主張する。
- `typescript` を pinned devDependency 化。環境の ambient `tsc` が非推奨の no-op
  シム (v6.0.2) で、ガードも `pnpm typecheck` も当てにならなかったため、実
  コンパイラ (5.7.3) を固定して両者を確定的にする。

3 層の役割分担が確立する (真実の源は一つ — §1.1):

| 層 | ジョブ | 必須 | 守るもの | 判定の性質 |
|----|--------|------|---------|-----------|
| BootWiring | `gate` | ✅ | 起動が未解決識別子で即死しない | 決定的・ブラウザ不要 |
| typecheck | `gate` | ✅ | `types`/`domain` の厳密な型 | 決定的 |
| e2e smoke | `e2e` | ❌ (据え置き) | React+Three.js+コマンドスタックの生きた配線 | 実ブラウザ・タイミング依存 |

## Consequences — Evidence と tradeoff (§1.2 Evidence)

- **肯定的**: import 忘れ / 未定義名 / 不正 named import による boot crash が必須
  ゲートで止まる。ADR-064 の「e2e はフレーキーゆえ非必須」判断と矛盾せず両立
  (フレーキーな部分を必須側に持ち込まない)。ambient `tsc` が no-op シムだった
  latent fragility も解消。
- **受け入れるコスト / 否定的**: BootWiring は「存在しないメソッド呼び出し」
  (TS2339) は **対象外** — このサブクラス (過去の Sketch ボタン回帰) は引き続き
  非必須の e2e smoke が唯一の砦。TS2339 まで必須ゲートに含めると、型注釈が緩い
  ランタイム層で誤検知が増えるトレードオフがあるため意図的に線を引いた。
  また `typescript` の版固定分、依存が 1 つ増える。
- **検証 (証拠)**:
  - `src/BootWiring.test.js` — 修正を戻すと ADR-085 の該当行を file:line 付きで
    赤くすることを確認 (TS2304 × 5)、修正済みツリーでは green。
  - `pnpm test` 694 件 pass (693 + 本ガード 1)。`pnpm typecheck` は実 TS 5.7.3 で
    既存 strict 設定を変更なく pass。
  - PR #341 CI: `gate` / `e2e` / `core` / `contract-wall` 全て success。
  - 台帳: `docs/code_contracts/architecture.md` §Boot-Wiring Guard +
    `docs/CODE_CONTRACTS.md` 索引 (バグ修正後 Q1 / PHILOSOPHY #19)。
- **波及 (blast radius)**: CI `gate` ジョブ (テスト時間 +~5s)、`package.json` /
  `pnpm-lock.yaml` (typescript devDep)、ランタイム層全 `.js` が本ガードの検査対象に
  入る (現状 green)。ブランチ保護設定・e2e ジョブ構成は変更しない。

## Lens notes

- **様態 (BPMN vs CMMN)**: CI ゲート群は決め打ちの逐次パイプライン (BPMN) だが、
  本 ADR の判断自体は「フレーキー度という *状態* で、どの保証をどのゲートに割り当てるか」
  という分類問題。決定的か否かを軸に保証を層へ写像した。
- **契約 (§1.3 層 + 契約)**: 「boot は ReferenceError を投げない」を必須ゲートの
  新しい契約として名指しし、実ブラウザ配線の契約 (e2e) とは別の強度・別のジョブに
  分離した。1 つの保証を 1 つのゲートが所有する (§1.1)。
- **一般化可能な原則**: *フレーキーな検証スイートを丸ごと必須化 vs 全部非必須化の
  二択にしない。決定的に判定できる部分スライスを切り出して必須ゲートに落とし、
  タイミング依存の残りは非必須に据え置く。* 同種の議論が再燃したときの参照点。
