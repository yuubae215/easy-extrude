# 089. 起動ホーム画面 — 工程レイアウトテンプレ選択を起点にする（Blender 式スキップ設定つき）

- Status: Proposed
- Date: 2026-07-23
- Deciders: yuubae（オーナー）, Claude
- Supersedes / Superseded by: なし
- Related: ADR-067（ビューポート常設ステージ + 起動リビール）, ADR-051（Requirement Intake / Template Gallery）, ADR-063（選択優先インテーク）, ADR-065（体感層遊戯化 / tour FSM）, ADR-066（Motion Tier D）, ADR-045（External Layout API / Layout DSL）, ADR-055（Scene ⇄ Layout DSL Mutual）

## Context — Goal と力学（§1.2 Goal）

**Goal（性質）**: 初回にアプリへ対面したユーザーの「まず何をすればいいの?」という
起点の障壁を下げる。今の起動は `AppController` コンストラクタが `_addObject()` で
既定ボックス1個を置き、`setMode('object')` で **S-01（Object Mode・無選択）の空の
ビューポート**に直接着地する（`src/main.js` → `controller.start()`）。白紙のキャンバスは
自由だが「何から触るか」の圧が大きく、特に本アプリの主眼である**要件文脈 (Context DSL)**
は白紙から埋めるのが重い（ADR-051/063 が recall→recognition 化で緩和してきた課題の、
さらに手前にある「そもそもの初手」問題）。

**力学（既にある素材）**:
- `Context ▾ → New Project` の **Template Gallery**（ADR-051 Phase 2, `TemplateGallery.jsx`）
  — ただし選べるのは **Context DSL** のロボットセル群であって、工程の**空間レイアウト**ではない。
- **起動リビール** BootReveal（ADR-067, Tier D）— 起動時に生きた背景演出の下地が既にある。
- `compileLayout(dsl)`（純粋 / `src/layout/LayoutCompiler.js`）→ `SceneService.importFromJson(scene, {clear})`
  という **Layout DSL → シーン**の確立した読込経路（ADR-045/055）。
- **tour FSM**（ADR-065 Phase 6）の localStorage 設定流儀（`ee_tour`、`_persistTourFlag`）—
  「初回だけ / スキップ可能」の先例。

**位置づけ（層 / blast radius）**: これは起動フロー（app 最上位状態）に新しい入口を足す
決定。触るのは View 層（新 React オーバーレイ + uiStore の 1 スライス）と Controller の
boot 配線のみ。Domain / Service / 契約は不変（Layout 読込は既存の `importFromJson` を
そのまま使う）。**解法（IK / 干渉 / …）には一切触れない** — フロントの宣言と表示の範囲。

要件が「ゲームのスタート画面」という**解の形**で来たので、Goal（初手の障壁低減）へ
一段持ち上げた（§1.2）。派手なスプラッシュは Goal ではなく一手段にすぎず、より安い
「既存素材を起動時の一枚に束ねる」で足りる。

## Options considered

- **A: 起動ホーム画面（採用）** — 起動時に Layout テンプレのギャラリーをオーバーレイ表示。
  選択で `compileLayout → importFromJson(clear)` してエディタ（S-01）へ着地。Blender 式
  「起動時に表示しない」チェックで `ee_home` を残し、二回目以降はスキップ。空プロジェクト
  カードは既定シーンへそのまま抜ける逃げ道。
  - tradeoff: 起動 FSM に 1 状態足す。テンプレを数枚オーサリングする実コストが伴う
    （カード1枚では選ぶ喜びが出ない）。
- **B: 必須スプラッシュ（毎回・スキップ不可の演出画面）** — tradeoff: 3D エディタは
  「触り始めるまでの時間」が命。リピーターに毎回タイトルを挟むのは #11（入力を消費して
  何も起きない）の親戚で、必ず鬱陶しくなる。却下。
- **C: 現状維持（既定ボックスへ直行）** — tradeoff: 初手の障壁がそのまま。Goal 未達。
- **D: New Project（ADR-051 Gallery）を起動時に流用** — tradeoff: あれは Context DSL 用で
  「工程レイアウトを選ぶ」体験にならない。前者（レイアウト）を求める今回の Goal と
  中身がズレる。Home は Layout を扱う別入口とし、両者を混同しない（§1.1 一概念一名）。

## Decision — Strategy（§1.2 Strategy）

起動時の最上位 **Home（Launch）状態**を新設し、**工程レイアウトテンプレのギャラリー**を
その起点にする。

1. **新スクリーン S-19（Home / Launch）** — `SCREEN_DESIGN.md` に定義。全画面オーバーレイ
   （z-index は編集オーバーレイ群の上、PHILOSOPHY #26）。背景には BootReveal（ADR-067）を
   そのまま流し、生きたステージを覗かせる（ワクワクの源は既存演出の再利用で足りる）。
   カードは **Layout テンプレ**（`examples/layout_*.json`）+ **空プロジェクト**（逃げ道）。

2. **選択 → 単一の読込経路**: カード選択は `compileLayout(dsl) → importFromJson(scene, {clear:true})`
   の**既存の唯一の権威経路**に載せる（§1.1 / PHILOSOPHY #1）。新しい読込ロジックは
   増やさない。空プロジェクトは既定シーン（ボックス1個）へそのまま抜ける（現状の boot 結果）。
   着地は常に S-01。

3. **Blender 式スキップ設定**: Home 内に「起動時に表示しない」チェック。ON で
   localStorage `ee_home='skip'` を残す（tour の `ee_tour` と同じ**表示設定**の流儀、
   ADR-065 Widening 3）。起動時にフラグがあれば Home を開かず直接エディタへ。再表示の
   導線はヘッダに常設スロットで置き（**Layout ギャラリーを開く**項目）、隠れ機能にしない
   （PHILOSOPHY #15 固定スロット / #11 無言禁止）。

4. **Home FSM**（`STATE_TRANSITIONS.md` に設計）: `uiStore.home` を
   `null | { status: 'open' }` の判別 union で丸ごと差し替え（tour / wizard と同じ流儀）。
   唯一の書き手は `AppController`（PHILOSOPHY #5）。View は読むだけで
   `onSelectLayoutTemplate(id)` / `onStartEmptyProject()` / `onToggleHomeSkip(bool)` /
   `onCloseHome()` を叩く。スキップ設定はフラグ（localStorage）であって FSM 状態ではない
   （§1.1 導出/設定を状態に混ぜない）。

5. **Motion tier**: Home の入場は **Tier D（delight）**として MotionGovernor 経由で
   spawn し、`prefers-reduced-motion` では最終状態が全て（BootReveal と同じ規律、
   ADR-066/067）。カード hover は Tier B（affordance）。所有者・予算・削減経路は
   `src/theme/motion.js` の一箇所（PHILOSOPHY #30）。

6. **テンプレ資産**: `examples/` に工程レイアウトの種を追加（本 ADR と同時に下書き 3 枚 +
   既存 `factory_layout.json` = 計 4 カード）。`layout/1.0` の valid な DSL で、数値・配置は
   オーナーが後から直す叩き台（validator + compileLayout で疎通確認済み）。カタログは
   ADR-051 の `TEMPLATE_CATALOG` に倣った静的リスト（実装フェーズで `LayoutTemplateCatalog`
   として起こす）。

**ADR-051 Template Gallery との関係（越境防止 / §1.1）**: あちらは **Context DSL** の
「New Project」モーダル、こちらは **Layout DSL** の**起動入口**。扱うワイヤも入口も別。
将来ここから「レイアウトを起点に Context を後追いで足す」導線を繋ぐ余地はあるが、本 ADR の
スコープ外（Home は "場を選んで着地" までを保証する）。

## Consequences — Evidence と tradeoff（§1.2 Evidence）

- **肯定的**: 初手が recall（白紙入力）から recognition（並んだ工程から選ぶ）に変わる。
  既存の読込経路・演出・設定流儀を再利用するため新規ロジックが薄い。テンプレ資産は
  受け入れフィクスチャとしても二重に効く。
- **受け入れるコスト / 否定的**: 起動 FSM に 1 状態増える。工程レイアウトを数枚
  オーサリング・保守する継続コスト（カード1枚では体験が寂しいため質・枚数が要る）。
  Home をスキップ可能にする＝初回以外は従来と同じ起動時間に戻す設計判断（意図的）。
- **検証（証拠）**:
  - テンプレ 3 枚（`layout_pick_place_cell` / `layout_conveyor_line` / `layout_palletizing`）+
    既存 `factory_layout` を `validateLayoutDsl` + `compileLayout` で疎通確認済み
    （それぞれ objects=15/9/17/15, links=5/3/5/5, valid=true）。
  - 実装フェーズの受入: (i) `ee_home='skip'` 時は Home を開かず S-01 へ、(ii) カード選択で
    シーンが選択レイアウトに置換され S-01 着地、(iii) `prefers-reduced-motion` で入場演出が
    最終状態即時、(iv) 再表示導線がヘッダ固定スロットに常在。ADR-086 の boot 決定的スライス
    （起動時 ReferenceError 不在）を Home 経路でも維持。
- **波及（blast radius）**: `src/main.js` / `AppController` の boot 配線、`uiStore` に `home`
  スライス 1 本、新 React コンポーネント（HomeScreen）、`examples/layout_*.json`、
  ヘッダの再表示スロット。Domain / Service / 契約 / 解法（`core/`）は不変。

## Lens notes

- **様態（§1.3）**: Home は「決め打ちの逐次フロー」= BPMN 的（開く→選ぶ/空→着地）。
  裁量分岐は「選ぶ or 空 or スキップ設定」の 3 手のみで、CMMN 的事象駆動ではない。
  ゆえに軽量な 2 状態 FSM + 設定フラグで十分（過剰モデリング回避、核 §5）。
- **状態台帳（§1.4）**: app 最上位の表示状態台帳に `home`（open / null）を追記。tour・wizard・
  demo と同じ「presentation を丸ごと差し替える判別 union」パターンに揃える（一貫性）。
- **黒箱**: Home の入力→出力は「(テンプレ id | 空 | スキップ) → 着地シーン + 設定フラグ」。
  シーン生成の内側（compileLayout）には手を伸ばさず契約（importFromJson の入力 JSON）に依存。
