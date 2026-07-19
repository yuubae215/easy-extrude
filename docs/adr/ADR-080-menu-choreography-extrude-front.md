# 080. 残余モーション空白の被覆 — ポップオーバー入場振付 + 押し出し成長前線

- Status: Accepted
- Date: 2026-07-19
- Deciders: yuubae215, Claude
- Supersedes / Superseded by: なし (ADR-065/066 の統治を継承し、Phase を追加する)

## Context — Goal と力学(§1.2 Goal)

ADR-065〜072 で体感層のモーション統治は完成している: transient は `MotionGovernor`
単一所有、reduced-motion は `src/theme/motion.js` 単一境界、実体ライフサイクルは
materialize/dissolve (volume design により pose 操作の着地は意図的無音)、chrome は
ChromeMath の Tier A 語彙 (press spring / breathe / enter-exit)。

animation-fx スキル (P1–P12) による棚卸しで、この統治の **適用が届いていない面**が
2 つ残ることを確認した:

1. **ポップオーバー/メニュー群が完全無演出。** `AddMenu` / `ContextMenu` /
   `ModeDropdown` / `LinkTypePicker` は 0 フレームでポップし、項目は一斉に現れ、
   hover にも transition がない。トースト・Header・Toolbar・Outliner が既に
   ChromeMath (Tier A) で動く中、同じ chrome 層の隣接面だけが素のままで、
   体感の一貫性が割れている (P3 伝播違反 = 品質ゲート2、P1 違反)。
2. **押し出しのドラッグ中に成長の演出がない。** アプリ名 (easy-extrude) の中核
   操作である face extrude は、ドラッグ中に数値ラベル (`ExtrusionLabel`) が出る
   のみ。「どの面が、いま、どれだけ勢いよく育っているか」という進行中の事実は
   画面のどこにも動きとして現れない (P4 境界の演出違反 = 品質ゲート3)。
   ※ 確定 *後* の無音は volume design (CODE_CONTRACTS「Landing Effects Speak
   Only Entity Lifecycle」) の意図的決定であり、本 ADR はそれに触れない。
   ここで扱うのはドラッグ *中* の affordance で、着地パルスとは別物。

**Goal (性質)**: (a) chrome 層の Tier A 語彙が全ポップオーバー面に一様に届き、
出現が「どこから生えたか」を語ること。(b) 押し出し操作の進行中、操作対象の境界
(成長前線) が操作の生死と勢いを語ること。いずれも既存統治 (単一 reduced-motion
境界・tier 宣言・judgment 偽装禁止) の内側で。

## Options considered

- **A: 2 Phase で被覆 — ChromeMath 拡張 + 成長前線ビュー(採用)** —
  Phase 1: ChromeMath にポップオーバー入場 (スケールフェード) と項目スタッガーの
  純粋導出を足し、4 メニューに適用。Phase 2: `ExtrudeFrontMath` (純粋) +
  ハンドラ所有の前線ビューで押し出し面のリムを速度比例発光させる。
  tradeoff: 新規純粋モジュール 2 つ分のテスト費用。
- **B: メニューだけやる (成長前線見送り)** — tradeoff: 安いが、看板操作の
  品質ゲート3違反が残る。棚卸しで最も価値が高いと判定した空白を放置。
- **C: framer-motion 等のライブラリ導入で一括** — tradeoff: 既存の
  ChromeMath/純粋導出 + inline style 規律と二重体系になる (§1.1 違反)。
  依存も増える。
- **D: 現状維持** — tradeoff: chrome 層の一貫性の割れと看板操作の無演出が残る。
  ADR-066 の Goal「UI は退屈であってはならない」に反する。

## Decision — Strategy(§1.2 Strategy)

**A を採用**。2 Phase を順に実装する。

### Phase 1 — ポップオーバー入場振付 (2D, Tier A)

- ChromeMath に純粋導出を追加: `popoverEnterMotion(reduced)` (アンカー起点の
  スケールフェード、`transform-origin` は呼び出し側が指定) と
  `itemEnterMotion(index, reduced)` (項目ごとの等間隔スタッガー ~20ms +
  easeOut 入場)。keyframes は `CHROME_CSS` に追記 (一箇所マウントの既存規律)。
- 適用面: `AddMenu` / `ContextMenu` / `ModeDropdown` / `LinkTypePicker`。
  項目 hover は既存 `tierAMotion` を再利用。
- Tier 宣言: **Tier A** (#30 一文テスト: 動きが止まると「メニューがどこから
  生えたか・項目が操作可能であること」が読めなくなる)。
- reduced-motion: `useReducedMotion()` (単一境界の hook) で `{}` に退化 —
  即時表示。情報はメニュー内容そのものなので静的代替は不要 (enterMotion と
  同じ判断)。

### Phase 2 — 押し出し成長前線 (3D, Tier A)

- 純粋モジュール `src/view/ExtrudeFrontMath.js`: ドラッグ速度 → リム発光強度の
  写像 (速度比例 + 上限クランプ)、静止時の減衰カーブ (P2 余韻)、confirm/cancel
  後のフェードアウト包絡。決定的・THREE-free・`node --test`。
- ビュー `ExtrudeFrontView` (仮称): face extrude 中の押し出し面の 4 エッジを
  `LineSegments` でリム表示し、強度を上記導出で駆動。overlay-only
  (実体 emissive に触れない — 既存規律 #4)、実体バウンズ比例 (#27)。
- 所有権: **`FaceExtrudeHandler` がライフタイムを所有** (start で生成、
  confirm/cancel で破棄)。ライフタイムを誰かが追跡している以上、
  MotionGovernor transient には **しない** (governor は「誰も追跡しない
  transient」専用 — CODE_CONTRACTS 規則の通り)。
- reduced-motion: 開始時に単一境界から一度サンプル (per-spawn 規律)。
  reduced では静的リムハイライト (「この面を押し出し中」という情報は保持、
  速度発光だけ落とす — #30/#11)。
- Tier 宣言: **Tier A** (動きが止まると「押し出しが生きていること・勢い」が
  読めなくなる)。数値の権威は引き続き `ExtrusionLabel` (前線は大きさを
  語らない — judgment 偽装禁止)。
- volume design は不変: 着地 (`Face Extrude` label) の無音は維持。前線は
  ドラッグ終了とともに消える = 着地パルスを追加しない。

**契約への影響**: なし (体感層のみ。ワイヤ・schema・DSL・BFF 不変 — #29 play 側)。

**非目標**: pose 着地の無音解除 (volume design 維持) / ambient idle の追加
(P11 抑制 — CAD 系で常時運動は閲覧の敵) / 新 tier の新設 (Tier A で足りる)。

## Consequences — Evidence と tradeoff(§1.2 Evidence)

- 肯定的:
  - chrome 層の Tier A 語彙が全ポップオーバーに一様適用され、体感の一貫性が
    閉じる。新しいメニューを作るときの規範 (「ChromeMath から導出する」) も
    明確になる。
  - 看板操作 (押し出し) が品質ゲート3 (境界の演出) を満たす。
  - どちらも既存統治の内側 (単一境界・純粋導出・tier 宣言) で、統治は無傷。
- 受け入れるコスト / 否定的:
  - 純粋モジュール 2 面のテスト維持費。
  - メニュー入場 ~120ms は「開いた瞬間クリック」を僅かに遅らせて見せる
    (pointer-events は初フレームから有効にし、演出は視覚のみ = 操作を
    ブロックしない、で緩和)。
- 検証(証拠):
  - `ChromeMath.test.js` 拡張: popover/item 導出の reduced 両分岐 + スタッガー
    単調性。
  - `ExtrudeFrontMath.test.js` 新設: 速度→強度クランプ、減衰の単調減少、
    reduced 分岐、包絡の終端 0。
  - 既存 `src/theme/motion.test.js` (grep 固定) が単一境界の不分岐を機械保証。
  - smoke E2E は既存の extrude パスが通ることで配線の生死を保証 (視覚断言は
    追加しない — #20)。
- 波及(blast radius):
  - Phase 1: `src/view/ChromeMath.js`(+test), `AddMenu.jsx`, `ContextMenu.jsx`,
    `ModeDropdown.jsx`, `LinkTypePicker.jsx`。
  - Phase 2: `src/view/ExtrudeFrontMath.js`(+test), 新ビュー,
    `FaceExtrudeHandler.js`, `src/theme/tokens.js` (duration/color token 追加時)。
  - ドキュメント: `docs/adr/README.md` 索引、CODE_CONTRACTS (実装後、
    所有権規則に追記が要る場合のみ)。

## Lens notes

- **§1.2 Goal へ持ち上げ**: 初期棚卸しの提案 (削除ディゾルブ・undo パルス等) は
  実装済み事実と volume design の照合で棄却し、「統治の適用が届いていない面」
  という性質レベルの Goal に持ち上げてから空白を再特定した。
- **§1.1 真実の源は一つ**: メニュー入場は ChromeMath へ *追記* (第二のモーション
  体系を作らない)。速度→強度写像は ExtrudeFrontMath のみが持つ。
- **黒箱/契約**: FaceExtrudeHandler の start/applyPreview/confirm/cancel という
  既存の入出力面は不変 — 前線ビューはその通知に載る観測者。
- **様態**: 両 Phase とも事象駆動 (メニュー開閉・ドラッグ) = CMMN 的。逐次
  フローの変更なし。状態機械 (§1.4): 新規状態なし (前線ビューの生死は
  S_FACE_EXTRUDE の既存状態に完全従属)。
