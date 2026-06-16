# ADR-046 (Draft) — Context DSL: 要件文脈の一級データ構造化と仕様への追跡可能コンパイル

**Status**: Draft (Proposed)
**Date**: 2026-06-10
**Updated**: 2026-06-11 — MVP 実装 (`src/context/`, ゴールデンテスト 8/8) を反映。interval の確定方式を worst-case 自動解決から **Decision エンティティ経由**に変更(§2.3 invariant 2、§7)。同日、可視化 PoC デモを ADR-047 として実装(`compileContext` の戻り値に `provenance[]` を追加 — additive)
**Related**: ADR-044 (5W1H Function Mapping), ADR-045 (External Layout API), ADR-037 (Body Frame), ADR-030 (SpatialLink), ADR-047 (Context Demo Layer), ADR-049 (Requirement / Conflict モデル — 本 DSL の L2.5 拡張), ADR-050 (Context-First Project Model — 本 DSL を正準アーティファクト化), ADR-052 (5W1H ユビキタス言語 — L2/L5 を Why ルートに統合), ADR-051 (要件入力)
**Implementation**: `src/context/` (Schema / Validator / Compiler), `examples/factory_context.json`, `pnpm test:context`

---

## 1. Context — なぜ layout/1.0 の上にもう一層必要か

ADR-045 の Layout DSL は「**確定した仕様**」を記述する語彙である。寸法は単一値、位置は確定座標、制約は成立済み。

しかし市場の課題は仕様の**手前**にある:

> 要件と仕様の齟齬。立会研修のため瑕疵の範囲が曖昧で、請求がなかなか確定しない。

バリデーションシナリオの原文を見ると、layout/1.0 では**表現が落ちる情報**が多数含まれている:

| 原文 | 情報の種類 | layout/1.0 での扱い |
|---|---|---|
| 「3m弱です」 | **区間値**(2.7〜3.0m、未実測) | 2800mm に**勝手に確定**される |
| 「100Vです」「3芯ソケット」 | 所与の現場事実(定格電流は**不明**) | AnnotatedPoint の名前に埋没 |
| 「設計する**必要があり**」 | **義務**(誰かの作業スコープ) | 表現不能 |
| 「ボルト締結する必要がある」 | 義務+検収対象(ボルト規格は**未定**) | jointType: fixed に**先回り確定** |
| 「バラバラに積み上がったワーク」 | **業務意図**(デパレ→整列) | 表現不能 |

齟齬とは、まさにこの「勝手に確定」「先回り確定」「埋没」「表現不能」の集合である。
**曖昧さを潰してから記録するのではなく、曖昧さのまま記録し、確定の履歴を残す**データ構造が必要。

これが Context DSL の設計目標であり、ADR-044 の写像を上流に一段延長する:

```
φ': NL(要件文脈) → Context DSL → Layout DSL → Scene JSON
                   ↑ここを一級市民にする
```

---

## 2. 概念モデル — ContextGraph

### 2.1 レイヤ構造(5W1H の上方拡張)

```
L0  Provenance   誰が・いつ・何を根拠に        (Actor, Source, Evidence)
L1  Given        現場の所与事実                 (Fact — measured / asserted / assumed)
L2  Intent       達成したい業務                 (Goal — 動詞+入出力+成功条件)
L3  Obligation   誰が何を設計・供給・施工するか  (作業スコープ = 瑕疵境界の単位)
L4  Specification 確定仕様                     (= layout/1.0、既存のまま)
L5  Acceptance   検収述語と立会記録             (静的チェック + 署名付き実測)
```

L4 は ADR-045 を**変更しない**。Context DSL は L0–L3, L5 を持ち、L4 へ**コンパイル**される。
L1 と L4 の間には **Decision**(§2.2)が立つ: 未確定の Fact を仕様で使える値に確定する行為そのものを一級データとして記録する。

### 2.2 メタモデル

```mermaid
classDiagram
    class Actor {
      +role: developer|maintainer|endUser|agent|customer
    }
    class Source {
      +kind: utterance|document|siteSurvey|photo|drawing
      +capturedAt
    }
    class Fact {
      +subject
      +quantity: Quantity
      +status: measured|asserted|assumed|unknown
      +evidence: Source[]
    }
    class Quantity {
      +value | interval[min,max)
      +unit
      +tolerance?
    }
    class Decision {
      +resolves: Fact
      +nominal
      +decidedBy: Actor
      +status: proposed|agreed|signed
      +rationale
    }
    class Goal {
      +verb: depalletize|place|fasten|connect|...
      +inputs / outputs
      +successCriteria
    }
    class Obligation {
      +deliverable
      +responsible: Actor
      +dependsOn: Fact[]|Obligation[]
      +defectScope: text
    }
    class TraceLink {
      +from: Fact|Goal|Obligation|Decision
      +to: layoutDsl element ref
      +kind: satisfies|derives|constrains
    }
    class AcceptanceCheck {
      +predicate
      +mode: static|witnessed
      +requires: factPath[]
      +record?: {measured, signedBy[], date}
    }
    class OpenQuestion {
      +raisedByRule
      +blocking: Obligation[]|AcceptanceCheck[]
    }
    Fact --> Source : evidence
    Decision --> Fact : resolves
    Decision --> Actor : decidedBy
    Obligation --> Actor : responsible
    TraceLink --> Fact
    AcceptanceCheck --> TraceLink : verifies
    OpenQuestion --> Fact : about
```

`AcceptanceCheck.blockedBy` はドラフト初版では手書きフィールドだったが、実装では**バリデータの計算結果**である。
人間が書くのは `requires: ["f_outlet.attrs.ratedCurrent"]`(この検収が依拠する Fact パス)のみで、
参照先が unknown / assumed ならバリデータが `blockedChecks` に積む。OpenQuestion と同じく「ブロックされているか」は入力ではなく出力。

### 2.3 憲法的不変条件(CODE_CONTRACTS 追記候補)

1. **No orphan spec** — L4 の全 entity / constraint は最低 1 本の TraceLink を持つ。トレース元のない仕様は「誰も頼んでいない仕様」= 齟齬の温床。(実装: Validator R3、コンパイルエラー)
2. **Interval は潰さない / 確定は Decision 経由のみ** — 「3m弱」は `interval: [2700, 3000)` のまま保持。仕様がこの値を使うには、`nominal`・`decidedBy`・`rationale` を持つ **Decision エンティティ**を立て、`{ "$decision": "d_bench_distance" }` で参照するしかない。`$fact` で interval を直接引くと**コンパイルエラー**。これにより「誰が・なぜ 2800 に確定したか」が必ずデータに残る。worst-case 値(ケーブルなら 3000、リーチなら 2700)は static 検査の評価点(`evaluateAt`)として併存する — 検証は安全側、仕様は意思決定済みの公称値、と役割を分ける。
3. **assumed / unknown を参照する AcceptanceCheck は blocked** — 確定前に検収項目が「合格」になることを型レベルで禁止する。(実装: Validator R5 + Compiler の `$fact` unknown 検査)
4. **瑕疵境界 = 署名済み Acceptance baseline との diff** — 検収記録に署名された時点のグラフをスナップショットし、以後の変更要求は新しい Obligation として積む。「立会で口頭変更→請求泥沼」の構造をデータ側で遮断する。(Phase 2)
5. **OpenQuestion はユーザーが書くものではなく、ルールが吐くもの** — 後述 §4。したがって `oq_*` 参照を入力(dependsOn 等)に書くことはできない。

---

## 3. Context DSL (context/0.1) — バリデーションシナリオの完全エンコード

正準エンコードは **`examples/factory_context.json`** にある(原文の各文を一切「善意の補完」をせずにエンコード。layout/1.0 と同じく宣言的 JSON、単位 mm、ROS REP-103)。
ここでは設計判断が現れる抜粋のみ示す。

**(a) 未確定は値として一級** — 定格電流・回路共有・耐荷重・専有面積実測は `"unknown"` のまま:

```jsonc
{ "ref": "f_outlet",
  "subject": "床敷設構内コンセント",
  "attrs": { "voltage": { "value": 100, "unit": "V" },
             "socket": "3芯ソケット",
             "ratedCurrent": "unknown",
             "circuitSharing": "unknown" },
  "status": "asserted", "evidence": ["src_brief"] }
```

**(b) 「3m弱」は interval のまま、確定は Decision で**:

```jsonc
// given
{ "ref": "f_outlet_to_bench",
  "subject": "コンセントから作業台設置位置までの距離 (「3m弱」)",
  "quantity": { "interval": [2700, 3000], "unit": "mm" },
  "status": "asserted" }          // ← 実測ではない

// decisions
{ "ref": "d_bench_distance",
  "resolves": "f_outlet_to_bench",
  "nominal": 2800,
  "decidedBy": "sier",
  "status": "proposed",
  "rationale": "「3m弱」区間 [2700, 3000) 内で配線余裕を確保しつつセル奥行を最小化する公称値" }
```

**(c) 仕様は inline layout/1.0 + 参照マーカー** — ドラフト初版の `layoutDslRef`(ファイル参照)ではなく、`specification.layout` に layout/1.0 形をインラインで持ち、数値の出自を 3 種のマーカーで残す:

```jsonc
"position": {
  "x": { "$decision": "d_bench_distance" },                 // → 2800(Decision 経由のみ)
  "y": 0,
  "z": { "$expr": "f_bench.attrs.height.value / 2" }        // → 400(発話の 800 まで遡れる)
},
"dimensions": {
  "x": { "$fact": "f_bench.attrs.top.x" }                   // → 500(所与事実の直接参照)
}
```

`$expr` は eval を使わない再帰下降パーサ(`+ - * / ( )` のみ)。`$fact` が `"unknown"` または interval に当たるとコンパイルエラー(invariant 2, 3)。

**(d) 検収は requires を宣言、blocked は計算**:

```jsonc
{ "ref": "a_power",  "mode": "witnessed",
  "predicate": "実負荷運転時電流 <= コンセント定格電流",
  "requires": ["f_outlet.attrs.ratedCurrent"] },            // ← unknown → 自動 blocked

{ "ref": "a_torque", "mode": "witnessed",
  "predicate": "全締結ボルトのトルク値が規定±許容内、合いマーク施工済み",
  "requires": ["f_bolt"] }                                  // ← status: assumed → 自動 blocked
```

**(e) 責任未合意も一級** — `o_power.responsible: "unassigned"` がそのまま入力になり、R4 が請求ブロックの OpenQuestion を吐く。

ゴールデン契約: `compileContext(factory_context.json).layoutDsl ≡ examples/factory_layout.json`(deepStrictEqual)、さらに既存 `compileLayout` を通した Scene JSON も一致(`src/context/ContextCompiler.test.js`、8/8)。
**要件文脈から出発しても、手書き仕様と bit 単位で同じシーンに到達する**ことが合格条件である。

---

## 4. OpenQuestion — このモデルの UX の核心

OpenQuestion は人間が起票するのではなく、**バリデーションルールが Given と Specification の照合から自動生成する**。「気づける人がレビューに居合わせたかどうか」に依存していた齟齬検出を、コンパイラの仕事にする。

### 4.1 MVP 実装済みルール (R1–R5) と実際の出力

`validateContext()` が本シナリオで生成するのは **OpenQuestion 5 件 + blockedChecks 2 件**:

| ref | ルール | 内容 | ブロック対象 |
|---|---|---|---|
| `oq_unknown_f_outlet_ratedCurrent` | R1: unknown-attr | コンセント定格電流が不明。**100V単相は協働ロボット級なら成立するが、多くの産業用ロボットは200V要求** — 機種選定そのものに跳ね返る要件ギャップ | a_power (R5) |
| `oq_unknown_f_outlet_circuitSharing` | R1: unknown-attr | 同一回路の共有負荷が不明 — 実負荷運転時のブレーカ落ちリスク | — |
| `oq_unknown_f_bench_loadCapacity` | R1: unknown-attr | 作業台の許容荷重が不明 vs プレート+ロボット+動作反力モーメント | — |
| `oq_unknown_f_cell_area_footprint` | R1: unknown-attr | セル専有面積が未実測(d_cell_bounds は SIer 提案値) | — |
| `oq_scope_o_power` | R4: unassigned-scope | 給電工事の責任区分が未合意 — **請求が確定しない典型箇所** | o_power |
| *(blocked)* `a_power` | R5: requires → unknown | 定格電流不明のため検収不能 | — |
| *(blocked)* `a_torque` | R5: requires → assumed | ボルト仕様が SIer 想定値(`f_bolt: assumed`)のまま | — |

エラー(コンパイル拒否)になるもの: R2 dangling-trace(存在しない要件への trace.from)、R3 orphan-spec(TraceLink のない仕様要素)。

### 4.2 未実装ルール(Phase 2 — 検出力のギャップとして明示)

ドラフト初版の表にあった以下は**まだ機械検出されない**:

| ref(予定) | 検出ルール(予定) | 内容 |
|---|---|---|
| `oq_distance_verify` | `status: asserted` の interval 量が constraint / Decision に参照されている | 「3m弱」は未実測。配線経路(床直行か壁沿いか)で実長は変わる。現状は Decision の rationale に残るのみで、**実測を促す OQ は出ない** |
| `oq_bench_load` | 荷重連鎖ルール: stack された Solid 群の総質量 vs 支持体の `loadCapacity` | R1 の unknown 検出はあるが、**何が載るから問題なのか**の連鎖は未実装 |
| `oq_robot_model` | `reach_covers` 述語の tcp_envelope 未定義検出 | ロボット機種未定のためリーチ検証不能。`a_reach` は述語実行エンジンが Phase 2 のため、**MVP のシナリオデータからも除外されている** — エンジン実装時に acceptance へ復帰させること |

> **述語実行エンジン 実装済**(2026-06-13、ADR-049 Phase 3 `src/context/PredicateEngine.js`)。
> `no_overlap` / `reach_covers` / `swept_volume` を純粋述語として評価し、R5 は非ブロック時に
> `checkResults` へ `pass | fail | blocked` を出す(ブロック検査はエンジンを走らせない)。
> `a_reach` / `a_no_overlap` は構造化 `predicate` オブジェクトとして acceptance に復帰可能
> (`examples/cell_region_context.json` 参照)。上表の `oq_distance_verify` / `oq_bench_load`
> はまだ未実装。

なお static 検査の一例として、確定済み寸法だけでも幾何チェックは可能:
天面 500×300 に対し、ロボット 220×220 + コンテナ 180×120 ×2 は X 方向 220+180=400≤500、Y 方向 120+120=240≤300 で**数値上は成立するが、隙間ゼロ前提**。`a_no_overlap` に最小クリアランス(例: 20mm)を足すと不成立になる — これこそ「図面が出てから揉める」やつをコンパイル時に表面化する例である(述語実行は ADR-049 Phase 3 `PredicateEngine.js` で実装済)。

---

## 5. ペルソナ別プロジェクション

「すべてのユーザ」の UX は、**同一グラフへの 4 つの射影**として設計する。データを分けない。見せ方だけ変える。

| ペルソナ | 射影 | 主要ビュー |
|---|---|---|
| 開発者 | L1–L4 + TraceLink | DSL diff、trace graph、static check 結果(CI) |
| メンテナンスマン | L1(utilities)+ L4 | 給電系統・クリアランス・締結トルク表・銘板情報を 3D シーンにオーバーレイ |
| エンドユーザ | L2 + L5 | 3D シーン + 検収チェックリスト(緑/赤/blocked) |
| 仲介エージェント | L3 × L5 マトリックス | **Obligation × AcceptanceCheck の表 = 請求確定トリガー**。全 witnessed check に署名が揃った Obligation 行から請求可能 |

この最後の射影が市場課題への直接回答になる: 「請求がなかなか確定しない」のは、確定条件がデータとして存在しないからであり、`∀check ∈ obligation.acceptance: check.record.signedBy ⊇ {customer, sier}` という**機械判定可能な述語**に置き換える。

---

## 6. easy-extrude への組み込み(MVP 実装済み)

```
src/
├── context/                  ← 新設(layout/ と同格の純粋計算層)
│   ├── ContextDslSchema.js   ← 定数・不変条件の定義
│   ├── ContextValidator.js   ← R1〜R5 ルール = OpenQuestion 生成器
│   ├── ContextCompiler.js    ← compileContext(ctx) →
│   │                            { layoutDsl, openQuestions[], blockedChecks[], trace[] }
│   └── ContextCompiler.test.js ← ゴールデンテスト (node:test, 8件)
├── layout/                   ← 既存、無変更
examples/
├── factory_context.json      ← 本シナリオの context/0.1 正準エンコード
└── factory_layout.json       ← ゴールデン(ADR-045、無変更)
```

- **二段コンパイル**: `compileContext()` の出力 layoutDsl を既存 `compileLayout()` に渡す。各段で validate(PHILOSOPHY #11 のフェイルファスト)。ゴールデンテストで全鎖一致を担保(`pnpm test:context`、8/8 パス)。
- **interpret --ai の再ターゲット**(Phase 2): LLM の生成先を layout/1.0 から context/0.1 に変更する。これは ADR-044 の制約(AI は安全語彙のみ生成)を強化する方向 — **AI に「3m弱」を 2800 に確定させる権限を与えない**。確定は Decision(decidedBy = 人間の Actor)としてのみ起きる。
- **CLI**(Phase 2): `pnpm context check requirements.json` → OpenQuestion 一覧を exit code 付きで返す(CI に載る)。
- **GSN 投影(オプション)**: L2 Goal → GSN goal、AcceptanceCheck → solution、Fact(assumed) → assumption、Obligation → strategy 配下、と機械的に写像できる。瑕疵範囲を顧客と争う局面で、保証論証(assurance case)として `.gsn` を出力すれば既存の GSN Assurance ツールチェーンで可視化・レビューできる。

---

## 7. Rejected Alternatives

**interval を worst-case でコンパイル時に自動確定する(本ドラフト初版の案)** — golden の 2800 は worst-case(2700/3000)からは導出できず、また「誰が・なぜその値に決めたか」がデータに残らない。確定を Decision エンティティ(nominal + decidedBy + rationale + proposed/agreed/signed ライフサイクル)に分離し、worst-case は static 検査の評価点(`evaluateAt`)に役割を限定した。invariant 2 の実装としてもこちらが素直。

**layout/1.0 に provenance フィールドを足す** — 仕様語彙と要件語彙の混線。「未確定」を表現できない型に「未確定の出自」だけ足しても、interval や obligation は表現できない。層を分けるべき。

**OpenQuestion を人間の起票制にする** — 課題管理ツールの再発明になり、検出が属人化する。齟齬検出はバリデータの責務。

**自由記述の要件書(Markdown)+ LLM 抽出のみ** — 再現性がなく、署名・baseline・diff が定義できない。NL は入口であって保存形式ではない(ADR-045 と同じ理由で、構造化 DSL が安全な中間語彙)。

---

## 8. 次の一手

1. ~~`ContextDslSchema` の JSON Schema 化と `validateContext()` の最小ルール~~ → **済**(R1–R5、2026-06-11)
2. ~~本シナリオを `examples/factory_context.json` として追加し、`compileContext` が既存 `examples/factory_layout.json` と**同一出力**になることをゴールデンテストに~~ → **済**(8/8、`pnpm test:context`)
3. §4.2 の未実装ルール 3 本(asserted-interval 実測促し / 荷重連鎖 / tcp_envelope)と `a_reach` のシナリオ復帰
4. static 述語(`footprint_within` 等)の実行エンジン
5. baseline スナップショット・Decision 署名イベント・diff(瑕疵境界の運用、invariant 4)
6. ~~検収マトリックスの最小 UI(Outliner と同様のサイドパネル射影)~~ → **済**(ADR-047 Context Inspector — Given/OpenQuestions/Decisions/Trace/Acceptance タブ + デモオーバーレイ、2026-06-11)
7. `interpret --ai` の生成先を context/0.1 へ切替
