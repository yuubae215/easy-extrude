---
name: adr
description: >
  Use whenever the user wants to write, draft, propose, update, accept, or supersede
  an Architecture Decision Record (ADR) — i.e. to record an architecture/design decision
  and its rationale, capture why an approach was chosen, or document a tradeoff.
  Triggers on: "ADR", "architecture decision", "decision record", "record this decision",
  "なぜこの設計か残す", "設計判断を記録", "意思決定記録", supersede / deprecate an existing ADR.
  Do NOT use for general code edits or for non-decision docs (README, design overview).
---

# ADR authoring

ADR は不変核 §1.2「正当化の鎖」(GSN)を文書として物質化したもの。対応:
Context = **Goal / 力学**、Decision = **Strategy**、Consequences = **Evidence + tradeoff**。
かつ §4「設計された契約」チャネルの版管理成果物。

## 書く前に(設計判断の規律を先に通す)
1. **Goal へ持ち上げる(§1.2)。** 要件が解の形(「キューで」「マイクロサービスで」)で
   来ていたら、達成したい *性質* に戻してから選択肢を並べる。より安い解があり得る。
2. **関係するレンズを当てる(§1.3–1.4 / 核 §3 のトリガ)。** 少なくとも:
   - グラフ: この決定の blast radius(波及するノード/契約)。
   - 層 + 契約: どの境界の契約を変える/新設するか。
   - 黒箱: 影響コンポーネントの 入力→出力・不変条件は保たれるか。
   - 様態: 関わるフローは BPMN(逐次)か CMMN(事象駆動)か。
   - 状態機械(§1.4): 関わる実体に lifecycle/mode があるなら、状態・遷移・禁止遷移を
     クラスより先に。決定が状態設計を含むなら ADR 本文にも残す。
3. **真実の源は一つ(§1.1)。** 1 ADR = 1 決定。既存決定を覆すなら新規 ADR を起こし、
   旧 ADR の Status を `Superseded by ADR-NNNN` にして相互リンクする。履歴は書き換えない。
4. **証拠を具体に(§1.2 / §5)。** Consequences の検証欄は主張でなく test / bench /
   proof / 参照で埋める。埋まらない判断は Proposed 止まりにし、欠落を明示する。

## 置き場所・命名
- パス: `docs/adr/NNNN-kebab-title.md`(NNNN は 4 桁ゼロ詰め連番)。
- 既存の最大番号 +1 を採番(`ls docs/adr/` で確認)。`docs/adr/` が無ければ作る。
- 索引 `docs/adr/README.md` があれば 1 行追記。プロジェクト CLAUDE.md の Goal ツリーから
  対応する G に ADR 番号を紐付けると §1.2 の鎖が辿れる。

## Status ライフサイクル
`Proposed → Accepted → (Superseded by ADR-NNNN | Deprecated)`
新規作成時の既定は **Proposed**。ユーザが採択を明言したら Accepted。

## テンプレート(これを埋めて出力する)

```markdown
# NNNN. <decision title>

- Status: Proposed
- Date: YYYY-MM-DD
- Deciders: <names / roles>
- Supersedes / Superseded by: <ADR-XXXX / なし>

## Context — Goal と力学(§1.2 Goal)
達成したい性質を *解でなく性質* で書く。制約・力学・前提。
この決定がグラフ/層マップ上のどこに位置するか。

## Options considered
- A: <案>  — tradeoff: <…>
- B: <案>  — tradeoff: <…>
- C: <do nothing / 現状維持>  — tradeoff: <…>

## Decision — Strategy(§1.2 Strategy)
選んだ案。Goal をどう達成するか。変える/新設する契約があれば明記。

## Consequences — Evidence と tradeoff(§1.2 Evidence)
- 肯定的: <…>
- 受け入れるコスト / 否定的: <…>
- 検証(証拠): <test / bench / proof / 参照。主張は不可>
- 波及(blast radius): <影響するノード・契約>

## Lens notes(任意)
適用した構造レンズと所見。様態判定(BPMN/CMMN)の根拠など。
```

## 出力後
- 新規/更新した ADR ファイルを提示し、Status と番号を一言添える。
- Accepted で実装を伴う場合のみ、別途コードへ進む(ADR だけのセッションでは進めない)。
