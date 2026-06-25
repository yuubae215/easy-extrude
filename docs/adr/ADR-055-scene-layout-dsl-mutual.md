# ADR-055 — Scene ⇄ Layout DSL Mutual: a Normal-Form Inverse for the Geometry Layer

**Status**: Accepted (Phase 1 実装済 — 2026-06-22)
**Date**: 2026-06-22
**Related**: ADR-045 (External Layout API — `compileLayout`), ADR-052 (5W1H Mutual — 同義語商上の構造同型), ADR-050 (Context-First Project Model — 正準は Context, シーンは導出), ADR-057 (UI→DSL→BFF Grasp walkthrough — 正準抽出点 `getCompiled().layoutDsl`), ADR-040 (Solid primary triple), ADR-037 (Auto Origin Frame), ADR-038 (SpatialLink taxonomy), ADR-056 (Computable Structural Isomorphism — scene fixpoint を doc 層の正規形シグネチャへ一般化)

**Implementation (Phase 1)**:
- `src/layout/LayoutDecompiler.js` — pure・THREE-free・`node --test` 可。`decompileLayout(sceneJson) → {dsl, warnings}` = `compileLayout` の逆射。
- `src/layout/LayoutCompiler.js` / `LayoutValidator.js` / `LayoutDslSchema.js` — Solid に **additive** な `rotation` 任意フィールド（layout/1.0 内・バージョン非昇格）。
- `src/layout/LayoutDecompiler.test.js`（9 件）— **scene fixpoint**・正規形・Origin 折り畳み・名前空間復元・rotation 往復・unconvertible 報告。
- `package.json` に `test:layout`。`tsc --noEmit`・`vite build`・`test:context`（264/264）クリーン。

---

## 1. Context — シーンと DSL は「入力の仕方の違い」だが、逆射が無い

ユーザの観察: *Context であろうが Scene であろうが入力の仕方の違いでしかない。* ジオメトリ層
（What/How）に限れば、これは正しい — **シーンは本質的にコンパイル済みの Layout DSL** である。
にもかかわらず、データフローは一方向だった:

```
Layout DSL (layout/1.0) ──compileLayout──▶ Scene JSON v1.3 ──importFromJson──▶ 3D Scene
```

逆向き（Scene → DSL）が無いため、直接編集／手組みしたシーンを DSL として取り出せず、
「シーンと DSL を相互（Mutual）な 2 つの入力面として扱う」ことができなかった。

## 2. Decision — `compileLayout` の逆射を「正規形までの Mutual」として実装する

`compileLayout` は**多対一**である: `strategy`（linear/grid/stack/radial/manual）は同じ座標へ畳まれ、
`ref` は `slug()` で id へ畳まれる。したがって**バイト同一の逆射は原理的に不能** — これは ADR-052 が
NL⇄doc について既に解決した状況（「**同義語で割った商の上での構造同型**」）と同じ形である。本 ADR は
その**幾何版**を採る:

> **Mutual = 正規形（normal form）までの構造同型。** 逆射は**正準代表**を選ぶ:
> `strategy:'manual'` ＋ 明示 `position`、`ref` は生成 id の接頭辞を剥がして復元（既に slug 済みなので
> 再コンパイルで安定。元の人間可読 ref テキストは正規化で失われる）。

意味のある不変条件は **scene fixpoint law**:

```
compileLayout(decompileLayout(scene)) ≡ scene      （Layout-DSL で表現可能な任意のシーンについて）
```

`examples/factory_layout.json` を fixture に golden test 化（`compileLayout∘decompileLayout∘compileLayout`
が `compileLayout` と deep-equal）。多くの DSL が 1 つのシーンへ写るが、逆射は**1 つの代表**を返す。

### 2.1 逆射のアルゴリズム（`compileLayout` の鏡像）

- **id → ref 逆引き**: `ENTITY_PREFIX`（`solid_`/`cf_`/`al_`/`ar_`/`ap_`）を剥がす（`buildRefMap` の逆）。
  規約外 id は ref = id（honest fallback）。
- **Solid**: `localCorners` の軸ごと max−min から `dimensions` を復元、`position` 直写し、
  `orientation` → `rotation`（恒等なら省略）。
- **CoordinateFrame（ADR-037 の入れ子を解く）**:
  - name `'Origin'` ＋ 親が Solid → **自動生成 Origin として折り畳み（出力しない）**。
  - 親が Origin CF → 親 Solid の `frames[]` へ折り込む。
  - 親が null ／別 CF → top-level `CoordinateFrame` エンティティ（`parentRef`）。
- **Annotated{Point,Line,Region}**: `placeType` 保持で復元。
- **SpatialLink → constraints[]**: `sourceId`/`targetId` を id→ref 逆引き（`<ref>_origin`・frame 名前空間込み）。
  link id は再コンパイルで index から再生成（source/target で同定）。
- エンティティは**シーンの object 配列順**で構築 → 再コンパイルが同じ object 順を生む（fixpoint に必須）。

### 2.2 表現力の追加（足し込み）— Solid `rotation`

唯一の実ジオメトリ・ギャップ: `compileLayout` は `orientation: IDENTITY_QUATERNION` を直書きし、
Layout DSL の Solid に**回転フィールドが無い**ため、回転した Solid を DSL で表現できず往復で失われていた。
**Solid に任意 `rotation: {x,y,z,w}`** を追加（既定＝恒等）。`frames`/`placeType`/`parentRef` を増設したのと
同じく **layout/1.0 内の additive 拡張（バージョン非昇格）** — 厳格等価のバリデータが既存 `layout/1.0`
（`factory_context.json` の `specification.layout` を含む）を拒否しないため、版を上げない。

ジオメトリの表現力はそれ以外**シーン側が上位集合**（v1.3 が直列化の正本）なので、足し込みは
**DSL/コンパイラ側**に入り、シーン直列化フォーマットは無改変。

### 2.3 表現できないものは**報告**する（黙って落とさない — PHILOSOPHY #11）

Layout DSL に対応エンティティが無いシーン型 — **ImportedMesh / MeasureLine / Profile**（base64 幾何・
測定エンティティ。人間/LLM が書く DSL の語彙外）— は `warnings[]` に積む（`{id, type, reason}`）。
scene fixpoint は「Layout-DSL で表現可能なシーン」に限定され、残りは隠さず表面化する。これら型を
DSL エンティティとして増設するのは後続フェーズ。

## 3. スコープ境界 — Context は正準のまま（ADR-050/052 を破らない）

`decompileLayout` は**純粋関数**であり、**Context を使わないオーサリング経路**（直接組んだ／手編集した
シーンを DSL へ書き出す）のためのものである。**Why/Context（KPI・criterion・Gap・Intent・Acceptance・
provenance マーカー）は一切復元しない** — シーンはそれらを持たない（ADR-052 §1）。

**Context doc がロードされている間、正準 Layout DSL は引き続き
`ContextService.getCompiled().layoutDsl`（ADR-057）であり、シーン逆コンパイルではない。** これは
ADR-050 §2.1 / ADR-052 §2.4 が棄却した「正準が 2 つになり乖離する」を避けるための線引きである。
本 ADR は `decompileLayout` を Context フローへ配線**しない**（Phase 1 は UI サーフェスも追加しない）。

| 代替案 | 採否 | 理由 |
|---|---|---|
| **正規形までの逆射（本決定）** | ✅ 採択 | scene fixpoint で Mutual を保証。ADR-052 と同じ「商/正規形までの構造同型」 |
| バイト同一の逆射 | ❌ 棄却 | `compileLayout` が多対一ゆえ原理的に不能 |
| `decompileLayout` を Context フローの正準抽出点にする | ❌ 棄却 | 正準が 2 つになり乖離（ADR-050/052）。Context 時は `getCompiled().layoutDsl` のまま |
| ImportedMesh 等を base64 込みで DSL 化 | ⏸ 後続 | 人間/LLM 可読 DSL の語彙を肥大化。今は `warnings[]` で honest 報告 |

## 4. Consequences

### Positive
- **Scene と Layout DSL が双方向の入力面になる**（ジオメトリ層）。手組みシーン → DSL 書き出しが可能。
- **回転した Solid が往復可能**（additive `rotation`）。
- **ADR-052 の Mutual 観が一段強化**: NL⇄doc（同義語商）に続き、Scene⇄DSL（正規形）も「商/正規形までの
  構造同型」という同一レンズで説明できる（PHILOSOPHY 候補原理）。

### Negative / Trade-offs
- **正規形まで**: `strategy` の意図（linear/grid/…）は復元されず `manual` に畳まれる。元の ref テキストも
  正規化される。これは設計どおり（バイト同一は不能）。
- **部分被覆**: ImportedMesh/MeasureLine/Profile は未対応（`warnings[]`）。
- 規約外 id（手組みの非 `prefix_` id）は ref=id へ正規化され、scene fixpoint はそのシーンに対しては
  id 正規化を伴う（compileLayout 由来の規約的シーンでは厳密に成立）。

### 後続（任意）
- DSL エンティティ型の拡張（ImportedMesh/MeasureLine/Profile）。
- 非 Context オーサリング経路の UI サーフェス（シーン → DSL エクスポート）。
- `strategy` 推定（manual 以外の正規形候補）— 必要になれば。
