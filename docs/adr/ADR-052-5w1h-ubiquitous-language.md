# ADR-052 — 5W1H ユビキタス言語: NL ⇄ データの Mutual 構造（Why ルートの正準ツリー）

**Status**: Accepted (Phase 1 実装済 — 2026-06-16)
**Date**: 2026-06-16
**Related**: ADR-046 (Context DSL — 正準形), ADR-044 (5W1H Function Mapping — φ 準同型), ADR-049 (Requirement/Conflict — KPI/criterion/gap/admissible), ADR-047 (Context Demo Layer), ADR-050 (Context-First Project Model), ADR-051 (Requirement Intake)
**Implementation**: 構造契約の明文化（本 ADR §2.1）＋ φ⁻¹（来歴復元）の足場。新データ構造は追加しない（既存の散在情報を単一の構造契約へ統合する）。

Phase 1 完了 (2026-06-16):
- `src/context/ProvenanceTree.js` — 純粋・入力不変・THREE-free の `buildWhyTree(ctx)` と
  `recoverProvenance(ctx, entityRef)`（φ⁻¹）。`intents[].parent` / `requirements[].kpi/criterion/
  constrains` / `decisions[].resolves/relaxes` / `obligations[].dependsOn` / `acceptance[].requires` /
  `specification.trace[]` / layout 内の `$fact`/`$decision` マーカーを、Why→How→What の単一の
  型付きノード＋エッジグラフ（各エッジは派生(What 側)→源泉(Why 側)）へ統合。シーンの導出
  エンティティから Why（KPI/criterion/Intent）を機械的に遡る。
- `src/service/ContextService.js` — `whyTree()` / `recoverProvenance(sceneId)`（`_refToId` を逆引きして
  シーンエンティティ id → 正準 layout ref → 純粋 `recoverProvenance` へ委譲。サービスは純粋ロジックを
  持たない — PHILOSOPHY #3）。
- `src/context/ProvenanceTree.test.js`（14 件）+ `ContextService.test.js`（+3 件）。
  factory（Intent ルート）と cell_conflict（Requirement/KPI ルート）の双方の Why 形状を検証。
- 計 181/181、`tsc --noEmit`・`vite build` クリーン。
- 残（後続）: シーン操作 → 来歴提示の UI（インスペクタへの Why パンくず）、NL ⇄ doc 往復、
  同義語商の正規化辞書拡張（ADR-044 `why.keywords`）。

---

## 1. Context — シーン射影は「なぜ」を捨てるため、データ単独では NL 文脈と Mutual にならない

ADR-050 は「プロジェクトの正準アーティファクトは Context DSL ドキュメント、3D シーンは
`compileContext → compileLayout → importFromJson` で導出される出力射影」と定めた（不変条件9、
ADR-049）。この帰結を突き詰めると、**シーン側のデータ構造（CF ツリー＋SpatialLink）だけでは
正準 doc の情報が構造的に欠落する**ことが分かる。

具体的に、`compileLayout` が取り出すのは **What（エンティティ・CF・facts）と How（操作・
SpatialLink 制約）** だけであり、**Why（KPI・クライテリアと実測の Gap・及第点の達成 = Acceptance・
Intent）は射影に現れない**。CF ツリーは ROS TF の運動学的足場、SpatialLink は意味的・運動学的
制約のグラフ — どちらも「何が・どう繋がるか」は表せるが「なぜそうあるべきか（どの KPI を、
どのクライテリアで、どれだけの Gap を許して満たそうとしているか）」を持たない。

このため:

- **逆向き（データ → 意図）が成立しない。** シーンを読んでも、その配置がどの要求の帰結かを
  復元できない。
- **NL 文脈と自動機側データ構造が一方向の射影に堕ち、Mutual にならない。** 自然言語で語られた
  文脈（5W1H）は Why を含むが、データに落とす段で Why が落ちると、両者は構造保存の関係を失う。

Context DSL（ADR-046）は L0–L5 の層として Why に相当する情報（L2 Intent / L5 Acceptance）を、
ADR-049 は KPI・criterion・admissible 領域・gap を既に**保持している**。問題はそれらが
**「Why をルートにした単一の構造」として明文化されていない**点である。L4 = layout/1.0 へ
コンパイルする射が What/How だけを掬うため、Why は doc に残るがシーンには落ちない。

> 観察: 正準 doc は DDD の**ユビキタス言語**である。ユビキタス言語であるなら、それは
> 自然言語側の文脈構造（5W1H）と、自動機側のデータ構造の**双方を同型に貫く単一の構造**で
> なければならない。さもなくば「同じ言葉で語っているのに、片方では落ちる情報がある」状態になる。

---

## 2. Decision — 正準 doc を「Why ルートの 5W1H ツリー」として契約化し、φ を同義語商上の構造同型に保つ

### 2.1 正準構造 = Why ルートの 5W1H ツリー

正準 Context DSL ドキュメントの構造的読みを、ADR-044 の per-operation 5W1H グラフ
（Why → How → What）を**文脈全体へ一般化したツリー**として明文化する。

```
Why  (ルート)  — KPI / criterion / 実測との Gap / 及第点の達成(Acceptance) / Intent
  │             (ADR-049 KPI·criterion·admissible·gap + ADR-046 L2 Intent · L5 Acceptance)
How  (中間)    — それを達成する関数・操作・SpatialLink 制約
  │             (ADR-044 How · ADR-038 jointType · ADR-030 SpatialLink)
What (葉)      — 具体的なエンティティ・CF・facts
                (ADR-040 Solid · CF ツリー · ADR-046 L1 Given)
```

これは新しいデータ構造の追加ではない。既に doc に散在する L2 Intent / L5 Acceptance（ADR-046）、
KPI / criterion / admissible / gap（ADR-049）、Why/How/What（ADR-044）を、**単一の Why ルート
ツリーという構造契約**へ統合する明文化である。

**KPI/Gap/Acceptance がツリーの頂点に来る**ことが要点である。シーンの幾何や制約は、頂点にある
「何を、どのクライテリアで、どれだけの Gap を許して達成するか」の下位（How/What）に位置づく。
従来は L4（仕様）が事実上の頂点に見えていたが、L4 は Why から導出される射影であって頂点ではない。

### 2.2 Mutual の形式的定義 — 同義語商上の構造同型

ADR-044 の φ : M_intent → M_code は意図的に**多対一・全射**（"move"/"配置する"/"drag" → 1 つの
`grab-move`）であり、表層語までは逆写像できない。したがって「Mutual」を**表層語の復元**と定義すると
原理的に達成不能になる。本 ADR は Mutual を次のように定義する:

> **Mutual = 同義語で割った商の上での構造同型。** φ は準同型（構造保存・多対一）であり、
> φ⁻¹ は表層語を捨てるが **5W1H ツリー（Why の来歴）を完全に復元する**。すなわち
> 意味構造のレベルで NL ⇄ データは双方向に保たれる。

これは ADR-044 の φ⁻¹「マクロ記録（CommandStack → FunctionDescriptor[]）」を、操作列だけでなく
**文脈全体の来歴復元**へ一般化したものに相当する。Why ルートツリーが doc に保持される限り、
データから「なぜ」を機械的に取り戻せる。

| 性質 | 成立するか | 理由 |
|------|-----------|------|
| φ : NL → doc が準同型（合成保存） | ✅ | ADR-044 §Mathematical Foundation（φ(A∘B)=φ(A);φ(B)） |
| φ が全単射（表層語まで同型） | ❌ | 同義語を畳むため多対一・全射（ADR-044） |
| φ⁻¹ が同義語商上の構造同型（Why ツリー復元） | ✅（目標） | doc が Why ルートツリーを保持する限り成立 = 本 ADR の契約 |
| シーン（CF＋SpatialLink）単独で Why を復元 | ❌ | What/How 射影で Why が落ちる（§1） |

### 2.3 正準性の再確認

`scene` は導出射影にすぎず Why を持たない（ADR-049 不変条件9 を再確認）。保存・diff・署名は
**doc に対して**行う（ADR-050 §2/§5 と一貫）。Link Network 等のシーン由来ビューは
「Why を保持したまま What/How を導出する射の像」であり、そこに Why が見えないのは**正常**である
（ADR-048 §2.2.1 の「複数親」混乱と同じく、射影の性質であって欠陥ではない）。

### 2.4 採択した代替案と棄却した代替案

| 代替案 | 採否 | 理由 |
|---|---|---|
| **Why ルート 5W1H ツリーを正準構造契約に**（本決定） | ✅ 採択 | NL ⇄ データが同義語商上で Mutual。既存の散在情報の統合で新データ不要 |
| シーン側に Why をミラー（CF/SpatialLink に KPI メタを付与） | ❌ 棄却 | 正準が 2 つになり乖離（ADR-050 §2.1 と同じ誤り）。シーンは導出のまま保つ |
| Mutual を「表層語まで全単射」と定義 | ❌ 棄却 | 同義語の存在ゆえ原理的に達成不能。構造同型（商）が正しい目標 |

---

## 3. Consequences

### Positive
- **入力 UX が Why ファーストになる**（ADR-051 の土台）。要件入力はまず KPI/Gap/及第点（Why）を
  捕捉し、幾何は導出。要件ファーストが構造から自然に導かれる。
- **CF＋SpatialLink 単独の lossy 性が原理的に説明される**（ADR-048 §2.2.1 の射影性質を上位概念で裏付け）。
- **φ⁻¹（来歴復元）の足場**が定義され、将来「シーン操作 → 要求の来歴提示」「NL ⇄ doc 往復」が
  構造契約として実装可能になる（ADR-044 マクロ記録の一般化）。

### Negative / Trade-offs
- doc の構造的読みを Why ルートツリーに固定するため、純粋層の射影・検証は「Why を頂点に置く」
  読み替えに追従する必要がある（既存テストは無改変で再利用できる範囲を維持）。
- 同義語商の正規化（synonym → 正準キーワード）の品質に φ⁻¹ の有用性が依存する（ADR-044 の
  `why.keywords` 二言語辞書を拡張点とする）。

---

## 4. References
- ADR-044 — 5W1H Function Mapping（φ 準同型・φ⁻¹ マクロ記録の原典）
- ADR-046 — Context DSL（L0–L5、L2 Intent / L5 Acceptance、正準形）
- ADR-049 — Requirement/Conflict（KPI / criterion / admissible / gap）
- ADR-048 §2.2.1 — Link Network の構造関係（What/How 射影の像）
- ADR-050 — Context-First Project Model（doc が正準・シーンは導出）
- ADR-051 — Requirement Intake（本 ADR の上に乗る入力 UX）
