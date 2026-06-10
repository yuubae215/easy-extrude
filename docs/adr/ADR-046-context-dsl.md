# ADR-046 (Draft) — Context DSL: 要件文脈の一級データ構造化と仕様への追跡可能コンパイル

**Status**: Draft (Proposed)
**Date**: 2026-06-10
**Related**: ADR-044 (5W1H Function Mapping), ADR-045 (External Layout API), ADR-037 (Body Frame), ADR-030 (SpatialLink)

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
      +from: Fact|Goal|Obligation
      +to: layoutDsl element ref
      +kind: satisfies|derives|constrains
    }
    class AcceptanceCheck {
      +predicate
      +mode: static|witnessed
      +blockedBy: OpenQuestion[]
      +record?: {measured, signedBy[], date}
    }
    class OpenQuestion {
      +raisedByRule
      +blocking: Obligation[]|AcceptanceCheck[]
    }
    Fact --> Source : evidence
    Obligation --> Actor : responsible
    TraceLink --> Fact
    AcceptanceCheck --> TraceLink : verifies
    OpenQuestion --> Fact : about
```

### 2.3 憲法的不変条件(CODE_CONTRACTS 追記候補)

1. **No orphan spec** — L4 の全 entity / constraint は最低 1 本の TraceLink を持つ。トレース元のない仕様は「誰も頼んでいない仕様」= 齟齬の温床。
2. **Interval は潰さない** — 「3m弱」は `interval: [2700, 3000)` のまま保持。コンパイル時の幾何検証は **worst-case 側**(ケーブルなら 3000、リーチなら 2700)で行う。
3. **assumed / unknown を参照する AcceptanceCheck は blocked** — 確定前に検収項目が「合格」になることを型レベルで禁止する。
4. **瑕疵境界 = 署名済み Acceptance baseline との diff** — 検収記録に署名された時点のグラフをスナップショットし、以後の変更要求は新しい Obligation として積む。「立会で口頭変更→請求泥沼」の構造をデータ側で遮断する。
5. **OpenQuestion はユーザーが書くものではなく、ルールが吐くもの** — 後述 §4。

---

## 3. Context DSL (context/0.1) — バリデーションシナリオの完全エンコード

原文の各文を一切「善意の補完」をせずにエンコードする。layout/1.0 と同じく宣言的 JSON、単位 mm、ROS REP-103。

```jsonc
{
  "version": "context/0.1",
  "meta": { "name": "セル型工程の自動化置換", "baseline": null },

  "actors": [
    { "ref": "customer",  "role": "customer" },
    { "ref": "sier",      "role": "developer" },
    { "ref": "maint",     "role": "maintainer" },
    { "ref": "operator",  "role": "endUser" },
    { "ref": "broker",    "role": "agent" }
  ],

  "sources": [
    { "ref": "src_brief", "kind": "utterance", "by": "customer",
      "capturedAt": "2026-06-10" }
  ],

  "given": [
    { "ref": "f_cell_area",
      "subject": "セル型工程の専有面積",
      "quantity": { "footprint": "unknown" },
      "status": "asserted", "evidence": ["src_brief"] },

    { "ref": "f_outlet",
      "subject": "床敷設構内コンセント",
      "attrs": { "voltage": { "value": 100, "unit": "V" },
                 "socket": "3pin",
                 "ratedCurrent": "unknown",
                 "circuitSharing": "unknown" },
      "status": "asserted", "evidence": ["src_brief"] },

    { "ref": "f_outlet_to_bench",
      "subject": "コンセント〜作業台設置位置の距離",
      "quantity": { "interval": [2700, 3000], "unit": "mm" },
      "status": "asserted",        // ←「3m弱」。実測ではない
      "evidence": ["src_brief"] },

    { "ref": "f_bench",
      "subject": "既存作業台",
      "attrs": { "height": { "value": 800, "unit": "mm" },
                 "top": { "x": 500, "y": 300, "unit": "mm" },
                 "loadCapacity": "unknown",
                 "topMaterial": "unknown" },
      "status": "asserted", "evidence": ["src_brief"] }
  ],

  "intents": [
    { "ref": "g_automate",
      "verb": "replace",
      "summary": "セル1工程を自動化工程に置換する" },

    { "ref": "g_depal",
      "verb": "depalletize_and_place",
      "inputs":  { "from": "container_a", "state": "バラ積み" },
      "outputs": { "to": "container_b", "state": "格子へマトリックス整列" },
      "successCriteria": "全ワークが格子セルへ正姿勢で配置される",
      "parent": "g_automate" }
  ],

  "obligations": [
    { "ref": "o_baseplate_design",
      "deliverable": "ベースプレート設計(板厚30mm・作業台天面取付・ロボット締結穴)",
      "responsible": "sier",
      "dependsOn": ["f_bench", "oq_bolt_spec", "oq_bench_load"],
      "defectScope": "プレート強度・穴位置精度・天面への固定方法" },

    { "ref": "o_robot_mount",
      "deliverable": "ロボットのプレート上ボルト締結",
      "responsible": "sier",
      "dependsOn": ["o_baseplate_design"],
      "defectScope": "締結トルク・緩み止め" },

    { "ref": "o_power",
      "deliverable": "構内コンセントからの給電(3m弱区間の配線)",
      "responsible": "unassigned",       // ← 工事区分が未合意であることを明示
      "dependsOn": ["f_outlet", "f_outlet_to_bench", "oq_outlet_rating"],
      "defectScope": "unassigned" }
  ],

  "specification": {
    // ADR-045 examples/factory_layout.json をそのまま参照。
    "layoutDslRef": "examples/factory_layout.json",
    "trace": [
      { "from": "f_bench",            "to": "workbench",        "kind": "derives" },
      { "from": "o_baseplate_design", "to": "base_plate",       "kind": "satisfies" },
      { "from": "o_robot_mount",      "to": "constraint:robot_base→robot_mount", "kind": "satisfies" },
      { "from": "g_depal",            "to": "container_a",      "kind": "constrains" },
      { "from": "g_depal",            "to": "container_b",      "kind": "constrains" },
      { "from": "f_outlet",           "to": "floor_outlet",     "kind": "derives" },
      { "from": "f_outlet_to_bench",  "to": "constraint:floor_outlet→workbench_origin", "kind": "constrains" }
    ]
  },

  "acceptance": [
    { "ref": "a_plate_fit",   "mode": "static",
      "predicate": "footprint_within(base_plate, workbench_top)" },
    { "ref": "a_no_overlap",  "mode": "static",
      "predicate": "no_overlap(robot, container_a, container_b) on workbench_top" },
    { "ref": "a_reach",       "mode": "static",
      "predicate": "reach_covers(robot.tcp_envelope, container_a ∪ container_b)",
      "blockedBy": ["oq_robot_model"] },
    { "ref": "a_cable",       "mode": "static",
      "predicate": "cable_length(floor_outlet → robot_base) ≤ rated_cable",
      "evaluateAt": "worst_case(f_outlet_to_bench) = 3000mm" },
    { "ref": "a_power",       "mode": "witnessed",
      "predicate": "実負荷運転時電流 ≤ コンセント定格",
      "blockedBy": ["oq_outlet_rating"] },
    { "ref": "a_torque",      "mode": "witnessed",
      "predicate": "全締結ボルトのトルク値が規定±許容内、マーキング済み",
      "blockedBy": ["oq_bolt_spec"] },
    { "ref": "a_depal_cycle", "mode": "witnessed",
      "predicate": "g_depal.successCriteria を N サイクル連続達成" }
  ]
}
```

---

## 4. OpenQuestion — このモデルの UX の核心

OpenQuestion は人間が起票するのではなく、**バリデーションルールが Given と Specification の照合から自動生成する**。「気づける人がレビューに居合わせたかどうか」に依存していた齟齬検出を、コンパイラの仕事にする。

上記シナリオを `validateContext()` に通すと、以下が**自動で**吐かれるべきである:

| ref | 検出ルール | 内容 | ブロック対象 |
|---|---|---|---|
| `oq_outlet_rating` | `Fact.attrs に "unknown"` | コンセント定格電流が不明。**100V単相は協働ロボット級なら成立するが、多くの産業用ロボットは200V要求** — 機種選定そのものに跳ね返る要件ギャップ | a_power, o_power |
| `oq_bench_load` | 荷重連鎖ルール: stack された Solid 群の総質量 vs 支持体の `loadCapacity` | 作業台の許容荷重 vs プレート+ロボット+動作反力モーメント | o_baseplate_design |
| `oq_bolt_spec` | `jointType: fixed` なのに締結仕様 Fact が不在 | ボルト径・本数・トルク・プレート側タップか通し穴か | a_torque, o_robot_mount |
| `oq_distance_verify` | `status: asserted` の interval 量が constraint に参照されている | 「3m弱」は未実測。配線経路(床直行か壁沿いか)で実長は変わる | a_cable |
| `oq_robot_model` | `reach_covers` 述語が tcp_envelope 未定義 | ロボット機種未定のためリーチ検証不能 | a_reach |
| `oq_power_scope` | `Obligation.responsible: unassigned` | 給電工事の責任区分が未合意 — **請求が確定しない典型箇所** | o_power |

なお static 検査の一例として、確定済み寸法だけでも幾何チェックは可能:
天面 500×300 に対し、ロボット 220×220 + コンテナ 180×120 ×2 は X 方向 220+180=400≤500、Y 方向 120+120=240≤300 で**数値上は成立するが、隙間ゼロ前提**。`a_no_overlap` に最小クリアランス(例: 20mm)を足すと不成立になる — これこそ「図面が出てから揉める」やつをコンパイル時に表面化する例である。

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

## 6. easy-extrude への組み込み

```
src/
├── context/                  ← 新設(layout/ と同格の純粋計算層)
│   ├── ContextDslSchema.js
│   ├── ContextValidator.js   ← OpenQuestion 生成ルール群
│   └── ContextCompiler.js    ← compileContext(ctx) →
│                                { layoutDsl, openQuestions[], traceLinks[], blockedChecks[] }
├── layout/                   ← 既存、無変更
```

- **二段コンパイル**: `compileContext()` の出力 layoutDsl を既存 `compileLayout()` に渡す。各段で validate(PHILOSOPHY #11 のフェイルファスト)。
- **interpret --ai の再ターゲット**: LLM の生成先を layout/1.0 から context/0.1 に変更する。これは ADR-044 の制約(AI は安全語彙のみ生成)を強化する方向 — **AI に「3m弱」を 2800 に確定させる権限を与えない**。確定は人間の署名イベントとしてのみ起きる。
- **CLI**: `pnpm context check requirements.json` → OpenQuestion 一覧を exit code 付きで返す(CI に載る)。
- **GSN 投影(オプション)**: L2 Goal → GSN goal、AcceptanceCheck → solution、Fact(assumed) → assumption、Obligation → strategy 配下、と機械的に写像できる。瑕疵範囲を顧客と争う局面で、保証論証(assurance case)として `.gsn` を出力すれば既存の GSN Assurance ツールチェーンで可視化・レビューできる。

---

## 7. Rejected Alternatives

**layout/1.0 に provenance フィールドを足す** — 仕様語彙と要件語彙の混線。「未確定」を表現できない型に「未確定の出自」だけ足しても、interval や obligation は表現できない。層を分けるべき。

**OpenQuestion を人間の起票制にする** — 課題管理ツールの再発明になり、検出が属人化する。齟齬検出はバリデータの責務。

**自由記述の要件書(Markdown)+ LLM 抽出のみ** — 再現性がなく、署名・baseline・diff が定義できない。NL は入口であって保存形式ではない(ADR-045 と同じ理由で、構造化 DSL が安全な中間語彙)。

---

## 8. 次の一手(提案)

1. `ContextDslSchema` の JSON Schema 化と `validateContext()` の最小ルール 3 本(unknown 検出 / orphan spec / unassigned obligation)
2. 本シナリオを `examples/factory_context.json` として追加し、`compileContext` が既存 `examples/factory_layout.json` と**同一出力**になることをゴールデンテストに
3. 検収マトリックスの最小 UI(Outliner と同様のサイドパネル射影)
