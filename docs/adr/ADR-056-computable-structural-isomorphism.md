# ADR-056 — Computable Structural Isomorphism on the Synonym Quotient: Canonical Form, Diff, Reconcile

**Status**: Accepted (実装済 — `src/context/CanonicalForm.js` ＋ `node --test`)
**Date**: 2026-06-23
**Related**: ADR-052 (5W1H Mutual — 同義語商上の構造同型を *宣言*; 本 ADR はそれを *計算可能* にする), ADR-055 (Scene⇄DSL の scene fixpoint — 幾何層の正規形; 本 ADR は doc 層の正規形へ一般化), ADR-044 (φ 準同型 NL→doc), ADR-050 (Context-First — 正準は Context doc), ADR-051 (NlIntake の `canonical` スタンプ = 前脚フック), ADR-049 (KPI/criterion/Gap — 同一性ペイロード)

> **当初は設計のみ**として起案された (2026-06-23)。同日中に `src/context/CanonicalForm.js`
> （純粋・THREE-free・`node --test`）＋テストとして実装され、Status を **Accepted** へ昇格。
> 下記 §6「実装」を参照。

---

## 1. Context — 「商上の構造同型」は宣言されたが、どこにも *計算* されていない

ADR-052 は Mutual（NL ⇄ doc の相互変換）を **「同義語で割った商の上での構造同型」** と定義し、
ADR-055 はその幾何版を **scene fixpoint**（`compileLayout(decompileLayout(scene)) ≡ scene`）として
*計算可能* にした。しかし **doc 層（Why を担う 5W1H 構造）の同型そのものは、どこにも計算されていない** —
それは golden test の逸話的等価でしか観測されない、暗黙の契約のままである。

一方、その同型を組み立てるための**2 つの実在する部品**は既にあるが、互いに結合していない:

- **商（quotient）** = `src/context/SynonymQuotient.js`。`canonicalKey(term)` が表層語を同値クラス
  代表キーへ畳む。`QUOTIENT_TABLE` がキュレーション辞書。
- **構造（structure）** = `src/context/ProvenanceTree.js`。`buildWhyTree(ctx)` が正準 doc を
  型付き 5W1H DAG `{nodes:[{id,layer,kind,ref,label,data}], edges:[{from,to,relation}], roots}` へ
  統合（`_up` 上方隣接マップ付き、layer ∈ `['why','how','what']`）。

ユーザの意図: この 2 部品を結ぶ **計算可能な構造同型** を、**ジオメトリと自然言語のレコメンド
システムの基盤** にしたい。**DSL が機械との契約** であり、その契約は決定的でレビュー可能でなければ
ならない。必要な操作は 3 つすべて: ① 往復検証、② 等価判定/差分、③ 2 つの異なる入力（NL 由来 vs
シーン/幾何由来）の突き合わせ（reconcile）。

## 2. Decision — 正規形シグネチャを計算し、その上に 3 操作を載せる

**正準 doc を「商で割った 5W1H グラフ」へ写し、ref 名と順序に不変な正規形シグネチャを計算する。**
これは ADR-055 の scene fixpoint を **doc 層へ一般化**したもの — 幾何の正規形が `strategy:'manual'`＋
明示座標であったように、doc の正規形は **「商ラベル付きグラフの色細分化標準形」** である。

### 2.1 商（ラベルの正規化）— 決定的・キュレーション辞書のみ

各ノード `kind`・各エッジ `relation`・`criterion.op` を `canonicalKey` / `localizeOperator` で正規化する。
**ドメイン名詞（robot / reach / カメラ 等）は意図的に商の外**（逐語のまま比較）— これは ADR-052 §2.2 が
既に確立した境界であり、**埋め込みを *core で拒否* する地点**でもある（§5）。`NlIntake` が fact へ付与する
additive `canonical = {subject, attr}`（ADR-051 Phase 4 / ADR-052 §2.2）を、ノード単位の商フックとして
再利用する（新フィールドを増やさない）。

### 2.2 正規形 = ref 名・順序に不変なシグネチャ（Weisfeiler–Leman 流の色細分化）

異なる作者の 2 つの doc（NL オーサリング vs シーン/幾何由来）は **異なる `ref` 文字列**を持つ。
ゆえに正規形は **ref をキーにできない**。色細分化（color refinement）で構造だけを掴む:

```
初期色 c0(n) = hash( canonicalKey(n.kind),  identityPayload(n) )
反復     c_{k+1}(n) = hash( c_k(n),  sortedMultiset{ (canonicalKey(e.relation), c_k(m))
                                                      | e: n→m が up-edge, m が隣接 } )
安定するまで反復（色の分割が変わらなくなったら停止）。
docSignature(ctx) = sortedMultiset{ c_∞(n) | n ∈ nodes }      // 集合シグネチャ
rootSignature(ctx) = c_∞(whyRoot)                              // 根付き変種（Why apex）
```

- **`identityPayload(n)`** = ノードの *同一性に属する* 正準スカラのみ（criterion なら `op`＋`value`、
  requirement の KPI なら正規化済み `expr`）。ラベル文字列やドメイン名詞は同一性に含めない（商の外）。
- **不変条件**: `docSignature(a) === docSignature(b)` ⇔ a と b は **商の上で構造同型**（WL 同値）。
- **正直な注記**: WL は *実用上の* 標準形である。一般グラフでは WL 同値 ⊋ 同型だが、ここの対象は
  **根付き・ほぼ木の小規模 DAG** なので実質厳密。本 ADR は **「WL 同値までの正規形」** と明記し、
  実装フェーズのテストで裏取りする（誇張した「完全標準形」とは主張しない — PHILOSOPHY #28）。

### 2.3 3 つの操作（ユーザの 3 目的）

| 操作 | 定義 | 何の基盤か |
|---|---|---|
| **往復検証 verify** | `docSignature(φ(NL doc)) === docSignature(構造復元)` | ADR-052 Mutual を *計算された不変条件* に格上げ。幾何層は ADR-055 の scene fixpoint が担当（シーンは Why を落とす — ADR-052 §1） |
| **差分 diff** | 細分化色でノードを整列 → 層（Why/How/What）別に added/removed/changed を型付き出力 | 「同義語まで畳んだ上で何が変わったか」 |
| **突き合わせ reconcile** | 2 doc の **同一色ノード間の最大マッチング** → 対応 `refA ↔ refB` | 将来のマージ、および幾何⇄NL レコメンダの整列基盤 |

`reconcile` の対応マップ（`refA ↔ refB`）が、**異なる 2 入力面を結ぶ決定的な縫い目**になる。

### 2.4 確定した出力形（モジュール公開 API）

新規・純粋・THREE-free・`node --test` 可: `src/context/CanonicalForm.js`。**出力形（canonical form /
verify / diff / reconcile の出力）を以下に確定する**（DSL = 機械契約ゆえ出力もバージョン付き・シリアライズ
可能・決定的）:

- **`canonicalForm(ctx) → { version, docSignature, rootSignature, roots, nodes }`** = 確定した正規形出力。
  `version = CANONICAL_FORM_VERSION ('canonical-form/1.0')`（house style: `context/0.4` / `layout/1.0`）。
  `roots = [{ ref, kind, color }]`（Why apex、ref ソート）、`nodes = [{ ref, kind, layer, color }]`
  （layer→color→ref で決定的ソート）。**`Map` を含まず・内部 `data`/`label`/id を漏らさない JSON シリアライズ
  可能形**。ノード同一性は doc 意味のある `(kind, ref)`（構成上一意）。
- **`canonicalSignature(ctx) → { docSignature, rootSignature, colorOf: Map, nodes, roots }`** = 内部
  プリミティブ（`Map` ベース、`structuralDiff`/`reconcile` が直接消費）。シリアライズ出力は `canonicalForm` を使う。
- **`verify(a, b) → { equal, rootEqual, docSignature:{a,b}, rootSignature:{a,b} }`** = §2.3 *verify* の確定出力。
  `equal = docSignature(a) === docSignature(b)`（ADR-052 Mutual の計算された不変条件）。不一致の *中身* は
  `structuralDiff` が説明する。
- **`structuralDiff(a, b) → { why, how, what }`**（各 layer `{ added, removed, changed }`、項は
  `{ ref, kind, color }` / `{ ref, kind, fromColor, toColor }`）= 版間（id 安定）の差分鍵。
- **`reconcile(a, b) → { pairs:[{refA, refB, color, layer}], unmatchedA:[…], unmatchedB:[…] }`**（unmatched 項は
  `{ ref, kind, color, layer }`）= 作者間（色のみ）の対応鍵。

`buildWhyTree`（ProvenanceTree）＋ `canonicalKey`/`operatorSymbol`（SynonymQuotient）に**のみ**依存。
**新しい doc フィールドを増やさない**（ProvenanceTree の「データ構造を足さない」先例に倣う — シグネチャは
保存せず合成する）。diff/reconcile の **UI 配線は別フェーズ**（本 ADR は純粋層の確定出力まで）。

## 3. スコープ境界 — 決定的 core は in-scope、曖昧マッピングの提案/ランキングは out-of-scope

これは本リポジトリの既存の線引き（`CLAUDE.md` の **`## スコープ境界`** = 「宣言とスキーマ」層、制約の
**解法 (solving)** は外部 grasp-search service）と**同じ形の境界**であり、本 ADR で明文化して同所に追記する。

| 層 | スコープ | 担当 |
|---|---|---|
| 決定的 core: キュレーション商（`QUOTIENT_TABLE`）＋正規形シグネチャ＋diff＋exact-color reconcile | ✅ **in-scope** = スキーマ/契約（DSL レベルの機械契約）。**等価を *決定* する** | 本リポジトリ |
| 曖昧マッピングの提案・ランキング層（商で解決できない語を embedding / コーパス / 外部知で対応付ける、類似度で並べる） | ❌ **out-of-scope** = 解法の一種。**提案するだけで決定しない** | 外部サービス/システム（grasp-search service と同じパターン） |

**境界の本質**: 決定的な正規形は *yes/no と対応* を**決める**。外部レコメンダは、商が解決できない曖昧語に
ついて *候補辞書行* や *類似度ランキング* を **提案する** だけで、core の内部判定には決して入らない。
キュレーション辞書に行を足せば商が広がり、その語は決定的 core へ昇格する（ADR-052 §2.2 の拡張点）。

## 4. Alternatives considered

| 代替案 | 採否 | 理由 |
|---|---|---|
| **色細分化シグネチャ（本決定）** | ✅ 採択 | ref 名/順序に不変・決定的・純粋。ADR-052/055 と同じ「商/正規形までの構造同型」レンズ（PHILOSOPHY #28） |
| 正規形を `ref` でキーする | ❌ 棄却 | 異なる作者の 2 doc は ref が違う → 往復検証も reconcile も成立しない |
| core に embedding/コーパスを入れて曖昧語も畳む | ❌ 棄却 | pure/THREE-free/`node --test` とスコープ境界（解法は外部）を破る。曖昧対応付けは外部の *提案* 層へ |
| シグネチャを doc に永続フィールドとして持つ | ❌ 棄却 | ProvenanceTree 先例 = 合成して保存しない。正準の二重化（ADR-050/052）を避ける |
| 完全グラフ同型（厳密標準形）を core に実装 | ⏸ 後続 | 一般には NP 困難。対象は小規模根付き DAG ゆえ WL で実質十分。必要なら根付き構造で締める |

## 5. Consequences

### Positive
- **ADR-052 の Mutual が *計算された不変条件* になる** — 逸話的 golden test から、`docSignature` 等価という
  機械検証可能な性質へ。ADR-055（幾何）と合わせ、幾何層と doc 層の両方で「正規形までの Mutual」が計算可能に。
- **diff / reconcile が、幾何⇄NL レコメンドシステムの決定的な基盤**になる（DSL = 機械契約）。
- **スコープ境界が一段鮮明化** — 「決定的に *決める* core」と「曖昧を *提案する* 外部」の線が文書化され、
  `## AI 向けガード` で強制される。

### Negative / Trade-offs
- **WL 同値までの正規形**: 一般グラフでは厳密同型と一致しないが、対象規模では実質厳密（§2.2 注記）。
- **商の外の語は逐語比較**: 真に異なるドメイン語で同じ物を指す 2 doc は、辞書を足すまでマッチしない —
  これは意図した境界（埋め込みを誘惑される、まさにその地点を core で断る）。
- **設計のみ**: 本 ADR にコードは無い。`CanonicalForm.js` ＋テストは後続フェーズ。

### 後続（任意）
1. 往復検証テスト（`φ(NL)` と構造復元の `docSignature` 一致）を ADR-052 の anecdotal golden に追加。
   ※ 本フェーズで `CanonicalForm.test.js` が ref 不変性・順序不変性・構造感度・diff/reconcile を裏取り済。
2. `QUOTIENT_TABLE` の語彙拡張（決定的 core を広げる正攻法）。
3. 外部レコメンド lane の I/O 契約（提案候補のスキーマ）— 必要になれば、grasp-contract と同じ submodule 流儀。
4. diff/reconcile を UI（Context レイヤ）へ配線（現状は純粋層のみ — 配線は別フェーズ）。

## 6. 実装（2026-06-23）

新規 **`src/context/CanonicalForm.js`**（純粋・THREE-free・入力不変・`node --test`）。`buildWhyTree`
（ProvenanceTree）と `canonicalKey`/`operatorSymbol`（SynonymQuotient）に**のみ**依存し、**新しい doc
フィールドを増やさない**（シグネチャは合成して保存しない — ProvenanceTree 先例）。

- **`canonicalSignature(ctx) → {docSignature, rootSignature, colorOf, nodes}`** — §2.2 の色細分化。
  - 初期色 `c0(n) = hash(kindLabel(n.kind), identityPayload(n))`。`kindLabel`/`relationLabel` は
    `canonicalKey` で商正規化（商外は逐語）。
  - **`identityPayload`** = criterion の `op`（商正規化）＋`value`、KPI の **正規化 `expr`**＋`unit`。
    `expr` は識別子/ref パスを `_` プレースホルダへ畳む **ref 不変な式形**（例
    `f_camera.attrs.sensor_px_h / fov_width(v_standoff)` → `_/_(_)`）にして、ref リネームが
    シグネチャへ漏れないようにする（§2.2 の ref 不変性）。ラベル・ドメイン名詞は同一性に含めない。
  - **固定ラウンド数 `WL_ROUNDS = 16`** の WL 反復（doc 依存の早期停止にしない — 早期停止は sink ノードの
    ハッシュ回数を doc ごとに変え、**異なる 2 doc 間で色が比較不能**になるため。reconcile/diff は
    クロス doc の色比較が前提）。小規模根付き near-tree DAG の直径 ≪ 16 ゆえ実質完全細分化。
  - `docSignature` = 全ノード最終色の sorted-multiset のハッシュ。`rootSignature` = Why ルート色の
    sorted-multiset のハッシュ。ハッシュは自前 FNV-1a 32bit（Unicode 安全・import 不要）。
- **`structuralDiff(a,b) → {why,how,what}`** — 各層で**色によりノードを整列**（一致色＝無変更で除外）、
  残余を `id` でペア化して **same-id-different-color ⇒ `changed`**、それ以外を `added`/`removed`。
  各項は型付き（`{ref,kind,color}` / `{ref,kind,fromColor,toColor}`）。diff は版間（id 安定）の鍵、
  reconcile は作者間（色のみ）の鍵という役割分担。
- **`reconcile(a,b) → {pairs,unmatchedA,unmatchedB}`** — **同一色ノード間の最大マッチング**。同色クラス内は
  構造的に区別不能ゆえ任意ペアが妥当で、決定性のため `ref` ソートでペア化。`pairs[{refA,refB,color,layer}]`
  が異なる 2 入力面を結ぶ決定的な縫い目（幾何⇄NL レコメンダの整列基盤）。

**出力形の確定（2026-06-23 追補）**: §2.4 のとおり、宣言だけで未実装だった **`verify`**（往復検証/等価判定の
確定出力 `{equal, rootEqual, docSignature:{a,b}, rootSignature:{a,b}}`）を実装し、正規形の**確定した
シリアライズ出力 `canonicalForm(ctx)`**（`{version, docSignature, rootSignature, roots:[{ref,kind,color}],
nodes:[{ref,kind,layer,color}]}`、`CANONICAL_FORM_VERSION = 'canonical-form/1.0'`）を追加。`canonicalSignature`
は内部プリミティブとして維持し、**加法的に `roots`（Why apex node-id 配列）を返す**ようにして `canonicalForm`
がそれを `{ref,kind,color}` へ射影できるようにした（既存テストは非破壊）。`canonicalForm` は `Map` を含まず内部
`data`/`label`/id を漏らさない（消費側・将来の外部レコメンド lane が読む安定な機械契約）。diff/reconcile の
出力形は既に型付き・シリアライズ可能で、本追補では契約として確定（コード本体は無改変）。

**テスト** `src/context/CanonicalForm.test.js`（**25 件**、`pnpm test:context` に組込）= 既存 17 件（決定性／
**ref 名・順序不変性**／**実変化への感度**／diff／reconcile／純粋性）に加え、**`canonicalForm`**（version
スタンプ・`canonicalSignature` と一致・JSON 往復で `Map`/内部フィールド非漏洩・決定性・Why roots・ref 不変）と
**`verify`**（clone/リネーム同型で `equal:true`、criterion 値変更で `equal:false` かつ署名相違）の 8 件。
`test:context` 計 **289/289**、`tsc --noEmit`・`vite build` クリーン。

**スコープ境界（§3）どおり**: 本実装は決定的 core（商＋正規形＋diff＋exact-color reconcile）に徹し、
曖昧語の embedding/類似度ランキングは一切含まない（外部 *提案* 層の責務）。`CLAUDE.md` の `## スコープ境界`
／`## AI 向けガード`／ナビ表は ADR-056 起案時に既に追記済。
