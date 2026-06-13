# ADR-049 (Draft) — Requirement / Conflict モデル: KPI 由来の許容領域・衝突検出・交渉クラスター

**Status**: Draft (Proposed)
**Date**: 2026-06-13
**Updated**: 2026-06-13 — Phase 2 実装(R8 役割KPIカタログ、stated→derived 自動昇格、フォーム射影。`src/context/RoleKpiCatalog.js` / `AdmissiblePromotion.js` / `FormProjection.js` 新設、Validator に R8 + 昇格パイプライン、`examples/cell_phase2_context.json`、テスト 48/48)
**Updated**: 2026-06-13 — Phase 1 実装(`src/context/RequirementGraph.js`、Validator R6/R7/R9、Decision 拡張、`examples/cell_conflict_context.json`、テスト 32/32)
**Related**: ADR-046 (Context DSL), ADR-047 (Context Demo Layer), ADR-044 (5W1H), ADR-035 (Cycle Detection 前例), ADR-030 (SpatialLink)
**Implementation**: `src/context/RequirementGraph.js` (R6/R7), `src/context/ContextValidator.js` (R0'/R9/R8/Decision 拡張/昇格パイプライン), `src/context/AdmissiblePromotion.js` (stated→derived), `src/context/RoleKpiCatalog.js` (R8 カタログ), `src/context/FormProjection.js` (フォーム射影), `examples/cell_conflict_context.json` + `examples/cell_phase2_context.json`, `pnpm test:context`

---

## 1. Context — Context DSL は「欠落」を検出するが「矛盾」を検出しない

ADR-046 の Validator R1–R5 が検出するのはすべて**欠落**である: unknown な属性、
unassigned な責任区分、未確定 Fact に依存する検収。しかし要件齟齬のもう一方の主役は
**矛盾** — 複数の関係者がそれぞれの専門語彙で主張した要求が、両立しないケース — であり、
現行モデルには「要求」そのもののエンティティも、衝突の表現も検出もない。

ロボットセル設計での典型例:

| 立場 | 固有語彙での主張 | 共有設計変数への射影 |
|---|---|---|
| メカレイアウト | 設置基準・干渉回避・保全アクセス | ロボット基台位置 = 点または狭い領域 |
| ロボットモーション | 到達可能姿勢・特異点マージン | TCP 必要点 ⊆ リーチ包絡 → 基台位置の許容領域 |
| ハンドアイカメラ | 撮影距離に応じた分解能 (px/mm) | ワーキングディスタンス ∈ [d_min, d_max] |
| エンドエフェクタ | フランジから先の体積・質量 | TCP 周りクリアランス体積 → 許容領域をさらに削る |

重要な構造的観察が 3 つある:

1. **衝突は間接的に起きる。** 各人は自分の語彙で正しいことしか言っていない。矛盾は
   「同じ属性に違う値を書いた」形では現れず、**共有設計変数を経由して**初めて顕在化する。
   したがって検出は Fact 同士の比較ではなく、共有変数上の許容領域の交差判定でなければ
   ならない。これを外すと「気づける人がレビューに居合わせたか」依存に逆戻りする。
2. **要求の正体は KPI(評価関数)+ クライテリア(合格条件)である。** 許容領域は
   その前像 `{ x | criterion(kpi(x)) }` にすぎない。「設置位置はどこからどこまで OK か」
   は答えられないが、「何で評価するか・合格ラインはいくつか」は各分野の人が普段使って
   いる語彙そのものである。さらに衝突解消時に緩和されるのは領域ではなく**クライテリア**
   (0.1→0.15 mm/px)であり、KPI が残っていれば「緩和して何をいくら失ったか」が定量で
   Decision の rationale に入る。領域だけ持つモデルではこれが書けない。
3. **結合は物理が作る。** カメラ+ハンド質量 → 可搬選定 → 機種 → リーチ → 設置位置 →
   WD → レンズ → カメラ質量、と要求依存は一周し得る。これは設計ミスではなく問題の
   性質であり、「依存グラフはツリー/DAG であるべき」を**不変条件(エラー)にはできない**。
   検出すべきは循環そのものではなく、**ペアワイズ交渉では収束しない結合ブロック**
   (= 打ち合わせループの構造的正体)である。

これは ADR-046 の interval([2700, 3000) を潰さない)の自然な一般化である:
**1 次元区間 → n 次元許容領域、確定 → 多者衝突の解消**。

---

## 2. 概念モデル

### 2.1 追加エンティティ

```mermaid
classDiagram
    class Variable {
      +ref
      +unit
      +domain: interval | regionRef
    }
    class Requirement {
      +by: Actor
      +kpi: {name, expr, unit}
      +criterion: {op, value}
      +constrains: Variable[]
      +negotiability: must|should
      +admissible: derived | stated
    }
    class Conflict {
      <<validator output>>
      +between: Requirement[]
      +variable: Variable
      +admissibleSets
      +gap
    }
    class NegotiationCluster {
      <<validator output>>
      +requirements: Requirement[]
      +variables: Variable[]
      +actors: Actor[]
    }
    class Decision {
      +resolves: Fact | Conflict | Variable[]
      +relaxes?: {requirement, oldCriterion, newCriterion}
      +nominal | nominals{}
      +decidedBy: Actor[]
      +status: proposed|agreed|signed
    }
    Requirement --> Variable : constrains
    Conflict --> Requirement : between
    NegotiationCluster --> Conflict : contains
    Decision --> Conflict : resolves
    Decision --> Requirement : relaxes
```

- **Variable(共有設計変数)** — 複数の関係者の KPI が同じ物理量を参照するための
  名前空間。`v_camera_standoff` のような 1 次元量から始め、Phase 3 で領域
  (設置可能フットプリント等)へ拡張する。
- **Requirement** — `(kpi, criterion)` の組。L2 Intent(業務ゴール)と L4 Specification
  (確定仕様)の間、**L2.5** に位置する。`negotiability: must|should` は衝突解消時に
  「どちらが折れるか」の根拠となる。
- **Conflict / NegotiationCluster** — どちらも**人間が書くものではなく、バリデータが
  吐くもの**(OpenQuestion と同じ思想、ADR-046 invariant 5)。

### 2.2 憲法的不変条件(ADR-046 §2.3 の続番)

6. **許容領域は導出値** — 正準形は `{ x | criterion(kpi(x)) }` の機械導出
   (`admissible: derived`)。MVP では人間が領域を直接与えること(3D スケッチ入力を含む)
   を `admissible: stated` として許すが、KPI 裏付けのない stated 領域は R9 が
   OpenQuestion を吐く。Fact の `asserted → measured` 遷移と同型の
   `stated → derived` 昇格ライフサイクルを持つ。
   Phase 3 で許容領域はスカラー区間に加えて **AABB(軸並行ボックス)領域**を取る
   (`admissible.region: {axis:[lo,hi]}`、領域 Variable 上)。**Helly-2D の注意**:
   1 次元区間の Helly 性(同時空 ⇔ どれかの対が分離)は平面の凸集合一般には成立しない
   (Helly 数 3)が、AABB の交差は軸ごとに独立分解できるため軸ごとに 1 次元ロジックを
   再利用できる。凸ポリゴンのフットプリントは Phase 3 のスコープ外(R0' で却下)。
7. **Conflict / NegotiationCluster はルールが吐く**(R6 / R7)。入力に `conflict_*` /
   `nc_*` 参照を書くことはできない。
8. **交渉クラスターの解消は単一の n-ary Decision** — クラスター内の変数群はペアごとの
   Decision で逐次確定してはならない(A-B で決めた値が B-C で覆るループの遮断)。
   Decision は `resolves: Variable[]` + `nominals{}` で複数変数の同時確定を表現できる。
9. **契約の正準形はテキスト DSL** — 3D 可視化・3D スケッチは入力デバイスおよび
   evidence(`Source.kind: "sketch"`)であって契約物ではない。署名・baseline・diff
   (invariant 4)はすべてテキスト形式の context DSL に対して行う。3D で描かれた
   許容領域は必ずテキストの Requirement に変換されてから署名対象になる。

---

## 3. DSL 拡張スケッチ (context/0.2)

カメラ WD × リーチ衝突の最小エンコード:

```jsonc
"variables": [
  { "ref": "v_camera_standoff", "unit": "mm", "domain": [0, 2000] }
],
"requirements": [
  { "ref": "r_cam_resolution",
    "by": "vision_engineer",
    "kpi": { "name": "resolution", "expr": "sensor_px_h / fov_width(v_camera_standoff)", "unit": "px/mm" },
    "criterion": { "op": ">=", "value": 10 },        // 0.1 mm/px
    "constrains": ["v_camera_standoff"],
    "negotiability": "should",
    "admissible": { "interval": [200, 350], "source": "stated" } },  // Phase 2 で derived へ昇格

  { "ref": "r_wrist_singularity",
    "by": "robot_engineer",
    "kpi": { "name": "singularityMargin", "expr": "wrist_margin(v_camera_standoff)", "unit": "deg" },
    "criterion": { "op": ">=", "value": 15 },
    "constrains": ["v_camera_standoff"],
    "negotiability": "must",
    "admissible": { "interval": [380, 600], "source": "stated" } }
]
```

バリデータ出力(入力には書けない):

```jsonc
// R6 emit:
{ "ref": "conflict_v_camera_standoff",
  "between": ["r_cam_resolution", "r_wrist_singularity"],
  "variable": "v_camera_standoff",
  "admissibleSets": { "r_cam_resolution": [200, 350], "r_wrist_singularity": [380, 600] },
  "gap": [350, 380] }
```

解消(Decision の拡張、入力に書く):

```jsonc
{ "ref": "d_standoff",
  "resolves": "conflict_v_camera_standoff",     // ref はバリデータの決定的な命名規則に従う
  "relaxes": { "requirement": "r_cam_resolution",
               "oldCriterion": { "op": ">=", "value": 10 },
               "newCriterion": { "op": ">=", "value": 10 },
               "note": "レンズ f=16→25mm 変更で WD400 でも 10px/mm を確保(criterion 不変、KPI 式が変わる)" },
  "nominal": 400,
  "decidedBy": ["vision_engineer", "robot_engineer"],
  "status": "proposed",
  "rationale": "WD400: 特異点マージン 17°、レンズ変更費 +3 万円で分解能要求を満たす" }
```

`resolves` が Conflict を指す場合、参照整合は「現在のグラフで R6 が同名の Conflict を
再生成すること」で検証する(吐かれていない衝突を解消する Decision はエラー)。

仕様 (L4) からの参照は ADR-046 の `$decision` マーカーをそのまま使う —
`"x": { "$decision": "d_standoff" }`。**interval と同様、衝突中の変数を `$fact` /
`$variable` で直接引くとコンパイルエラー**(invariant 2 の拡張)。

---

## 4. 検出ルール (R6–R9)

| ルール | 入力 | 出力 | 実装時期 |
|---|---|---|---|
| **R6 conflict** | 同一 Variable を constrains する Requirement ≥2 の許容領域交差 | 交差が空 → `Conflict`(gap 付き) | Phase 1(1 次元 interval 交差は純粋計算で即実装可) |
| **R7 negotiation-cluster** | Requirement–Variable 二部グラフ | サイズ 2 以上の双連結成分 = `NegotiationCluster`(関与 actor・変数列挙 + 解消順序の提案) | Phase 1(グラフ走査のみ) |
| **R8 role-KPI-catalog** | 役割別必須 KPI カタログ × 存在する Actor | discipline X の Actor がいるのにカタログ必須 KPI を contributes する Requirement がない → OpenQuestion | Phase 2(済 — `RoleKpiCatalog.js`、Actor に `discipline` を additive 追加、`ctx.kpiCatalog` で上書き可) |
| **R9 stated-without-kpi** | `admissible.source === "stated"` かつ kpi/criterion 欠落 | OpenQuestion「この領域の根拠クライテリアは?」 | Phase 1 |

### R7 の形式化 — DAG であるべき、ではなく「結合ブロックの抽出」

二部グラフ `G = (Requirements ∪ Variables, constrains 辺)` が森(acyclic)であれば、
変数は葉から順に独立した Decision で確定できる(トポロジカル順 = 打ち合わせの直列化)。
**G に交互閉路がある**(例: r₁–v₁–r₂–v₂–r₁)とき、その双連結成分内の変数はどれを
先に決めても他方の交渉で覆る — これが「さらなるループ」の構造的正体である。

R7 の出力は**エラーではない**(結合は物理が作る — §1 観察 3)。出力は処方箋である:

> 「この {n} 件の要求({actor 列挙})は変数 {v…} を介して相互依存。ペアごとの調整では
> 収束しない。変数 {v…} を同時確定する合同 Decision が 1 件必要」

クラスターを 1 ノードに縮約したグラフは必ず DAG になるので、**Decision を積む順序
(= 会議の設計図)がグラフから導出できる**。これはシステム工学の DSM (Design
Structure Matrix) partitioning と同一の操作である。なお同型の循環検知は本コードベース
に前例がある(ADR-035 `_detectFastenedCycles()` — 検知してイベントを emit し、解消は
ユーザーに委ねる)。

---

## 5. 入力射影 — 聞き出しフォームと 3D authoring

「すべての要求を会話の最初期に抜け漏れなく聞き出す」を静的なフォーム設計で保証しようと
すると、フォーム自体がレビュー属人性の再発明になる。ADR-046 §5(同一グラフへの射影)を
入力側に延長する:

### 5.1 質問フォーム = 未充足ルールの射影

- フォームの質問項目は **現在のグラフに対する R1/R8/R9 の OpenQuestion 群を質問文に
  射影したもの**。静的な質問リストは存在しない。
- 全問に答える = 全ルールが沈黙する = フォームが空になる。**完了条件が機械判定可能**。
- 役割別 KPI カタログ(R8 の入力)はバージョン管理されたデータであり、「居合わせた人の
  記憶」から「レビュー可能な資産」への移動。カタログの欠落は次の現場の抜けとして
  顕在化し、カタログ更新で恒久対処される(CODE_CONTRACTS の運用と同じループ)。

### 5.2 3D authoring — 高次元の回答は描かせる

「設置位置の許容領域」「リーチ包絡」「WD 円錐台」は次元数的にフォームで答えられない。
ADR-047 のゴースト表示(出力射影)と同じビューを**入力ウィジェット**にする:

- Zone ドラッグ → 設置許容領域、円錐台ハンドル → WD 区間、球殻半径 → リーチ制約
- 変換先は同じ Requirement エンティティ(`admissible.source: "stated"`、
  `evidence: [{ kind: "sketch", … }]`)。フォーム入力と 3D 入力は同一グラフへの
  2 つの authoring 射影であり、データは分けない。
- **確定時にクライテリアを一問だけ差し戻す**: 3D で描かれるのは許容領域であって KPI
  ではない。根拠なしで受理すると §1 観察 2 の利点(緩和の定量化)が消えるため、
  R9 がスケッチ由来の stated 領域に OpenQuestion を立て、KPI が与えられたら
  `derived` へ昇格する。
- **契約はテキスト**(invariant 9): スケッチは evidence、署名対象は変換後のテキスト
  DSL。立会・baseline・diff の運用(invariant 4)に 3D バイナリを持ち込まない。

### 5.3 可視化(ADR-047 の延長)

- actor ごとに色分けした許容領域ゴーストを重畳 — **共通部分が空 = 衝突が目で見える**
- Conflict 解消は既存の Decision approval UI を流用(n-ary 対応のみ追加)
- ペルソナ射影に「衝突マトリックス(actor × Variable)」と「交渉クラスターと解消順序
  (R7 出力の DAG)」を追加

---

## 6. ADR-046 との整合

| ADR-046 の既存原則 | 本 ADR での一般化 |
|---|---|
| interval は潰さない(invariant 2) | 1 次元区間 → n 次元許容領域。衝突中の変数の直接参照はコンパイルエラー |
| 確定は Decision 経由のみ | 単一 Fact の確定 → 多者 Conflict / 変数集合の n-ary 同時確定 + `relaxes` 記録 |
| OpenQuestion はルールが吐く(invariant 5) | Conflict / NegotiationCluster もルールが吐く(invariant 7) |
| NL は入口であって保存形式ではない | 3D は入力デバイスであって契約物ではない(invariant 9) |
| asserted → measured の epistemic status | stated → derived の admissible status(invariant 6) |

L4(layout/1.0)は引き続き**無変更**。Requirement → TraceLink → 仕様要素の追跡も
既存メカニズムのまま(`kind: constrains`)。

---

## 7. Rejected Alternatives

**許容領域を一級の入力にする(KPI なし)** — 聞き出しが困難(「どこからどこまで OK か」
は専門家でも即答できない)で、衝突解消時に「何をいくら失って合意したか」が記録できない。
KPI+クライテリアが正準、領域は導出値(MVP の stated は昇格待ちの暫定)。

**依存グラフのツリー/DAG 制約を不変条件(コンパイルエラー)にする** — 結合は物理が作る
(可搬↔質量↔リーチの循環は問題の性質)。エラーにすると正当な要求セットが書けなくなる。
循環は検出して「合同 Decision が必要な交渉クラスター」として処方する(R7)。

**静的な質問フォームを設計する** — フォームの網羅性が新しい属人性になる。フォームは
未充足バリデーションルールの射影として動的に導出し、カタログ(R8)をバージョン管理する。

**3D シーン/スケッチを契約物にする** — 署名・baseline・diff が定義できない(ADR-046 が
自由記述 Markdown を退けたのと同じ理由)。3D は authoring 射影と evidence に限定。

**衝突をペアワイズの Decision で逐次解消する** — 交渉クラスター内では A-B の合意が B-C
で覆り、打ち合わせループが再生産される。クラスターは単一の n-ary Decision で同時確定
(invariant 8)。

**Conflict を人間の起票制にする** — OpenQuestion と同じ理由(ADR-046 §7)。検出が
属人化し、「レビューに気づける人が居合わせたか」依存に逆戻りする。

---

## 8. 段階導入

1. ~~**Phase 1**(純粋計算のみ、`src/context/` 内で完結):
   `variables[]` / `requirements[]` スキーマ追加、R6(1 次元 interval 交差)、
   R7(双連結成分)、R9、Decision の `resolves: conflict` + `relaxes` + n-ary
   `nominals{}`。ゴールデンテストにカメラ×リーチ衝突シナリオを追加。~~
   → **済**(2026-06-13、context/0.2。`examples/cell_conflict_context.json` +
   `ContextConflict.test.js` 20 件、既存ゴールデン 12 件と合わせ 32/32。
   R7 は Hopcroft–Tarjan 双連結成分の反復 DFS 実装。0.1 ドキュメントは
   `SUPPORTED_VERSIONS` でそのまま受理 — additive 拡張)。
2. ~~**Phase 2**: R8 役割別 KPI カタログ + フォーム射影(未充足 OpenQuestion → 質問文)。
   単調 KPI 式の区間逆像による `stated → derived` 自動昇格。~~
   → **済**(2026-06-13)。3 つの純粋計算モジュールを追加:
   ① `AdmissiblePromotion.js` — `source:"stated"` かつ閉形・単調な `kpi.expr` を持つ要求を、
   制約変数の domain 上でクライテリアを数値的に逆像(サンプリング + 二分法)して
   `derived` interval へ昇格。新 Map を返し入力は不変(PHILOSOPHY #6)。関数呼び出し
   (`fov_width(x)` 等)・非単調・非数値識別子・空集合は昇格せず黙って原型のまま返す
   (R9 が引き続き支配)。Validator では R0'(入力検証)の後・R6/R7/R9 の前に昇格を挟み、
   下流ルールは昇格後の集合(canonical 領域)で判定する。
   ② `RoleKpiCatalog.js` — discipline → 必須 KPI 名のバージョン管理カタログ
   (`role-kpi/1.0`)。Actor に additive な `discipline` フィールドを追加(coarse `role`
   では分野固有 KPI を表現できないため)。R8 は present な discipline ごとに、その分野の
   Actor が著者の要求群が必須 KPI 名を `kpi.name` で供給しているか検査し、欠落を
   `oq_rolekpi_<discipline>_<kpi>` として吐く。`ctx.kpiCatalog` で上書き可。
   ③ `FormProjection.js` — Validator の未充足 OpenQuestion(R1/R4/R8/R9)を質問文へ射影。
   静的な質問リストは持たず、全問回答 = 全ルール沈黙 = `projectForm()` が `[]`(完了が
   機械判定可能)。Validator 出力のみを読み、再検証しない。`examples/cell_phase2_context.json`
   + `ContextPhase2.test.js` 16 件、Phase 1 の 32 件と合わせ 48/48。
3. **Phase 3**: 領域 Variable(2D フットプリント / 3D 体積)、リーチ包絡・swept volume
   の近似述語(ADR-046 §4.2 の述語エンジンに合流)、3D authoring ウィジェット
   (ADR-047 のゴーストビュー双方向化)。
   → **純粋計算コア 済**(2026-06-13、context/0.3)。新規 2 モジュール:
   ① `RegionGeometry.js` — AABB 区間/ボックス交差の単一の真実。`intersectIntervals`
   (半開 `[min,max)` 判定の唯一の置き場)を軸ごとに再利用し `intersectBoxes` を構成。
   R6 を領域へ拡張: 領域 Variable 上の `admissible.region` を軸ごとに交差し、空軸が
   1 つ以上で衝突。`gap` はスカラーが従来どおり `[hi,lo]` 配列、領域は空軸のみの
   `{axis:[hi,lo]}` マップ(後方互換のためスカラー形は不変)。
   ② `PredicateEngine.js` — `no_overlap`(AABB 最小クリアランス、ADR-046 §4.2 の例)・
   `reach_covers`(球/円柱包絡)・`swept_volume`(カプセル列のサンプリング近似)の純粋
   述語。`{pass, violations}` を返し `pass:false` では throw せず、構造不正のみ
   `MalformedPredicate`。R5 は非ブロック時のみ述語を評価し `checkResults` に
   `pass|fail|blocked` を出す(ブロック検査はエンジンを走らせない)。`THREE` 非依存
   (bare `node --test` で読み込み可)。`examples/cell_region_context.json` +
   `ContextPhase3.test.js` 22 件、Phase 1+2 の 48 件と合わせ 70/70。
   → **3D authoring ウィジェット 済**(2026-06-13、§5.2 双方向化)。`ContextEditModel.js`
   (純粋 `applyAdmissibleEdit` — 領域/区間を `stated` admissible として新 ctx へ書き戻し、
   入力不変 PHILOSOPHY #6)+ `RegionAuthoringWidget.js`(地面上の AABB ゾーンをコーナー/
   中心ハンドルでドラッグ; setConflict で緑↔赤)。`ContextDemoController.enterAuthoring()`
   が `cell_region_context` を読み、各メカ/ビジョン担当の設置許容ゾーンをドラッグ可能ウィジェット
   として出す。ドラッグごとに `applyAdmissibleEdit → validateContext` をライブ実行し R6 衝突を
   再計算、ウィジェットを再着色 + Inspector の Conflict タブを更新。`AppController` の
   pointerdown/move/up は authoring 時に `_demoCtrl.onAuthor*` へ委譲(消費時のみ true)。
   契約はテキスト DSL のまま(invariant 9)、書き戻しは `source:"stated"`(R9 が引き続き支配)。
   テスト 72/72(編集モデル 2 件追加)、`vite build` 成功。
4. **Phase 4**: 衝突マトリックス / 交渉クラスター DAG のペルソナ射影 UI、
   n-ary Decision approval フロー。
