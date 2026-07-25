# 2026-07-25 — コンテキスト既定値の探索（ADR-091 §1 の値を獲得する）

様式は `docs/dogfooding/README.md`。**この時点では空のフォーム** — 当事者が触りながら埋める。
埋まった内容が GSN 木 `docs/gsn/profit-growth.gsn` の
`DefaultsAreAcceptableToPractitioner` の証拠になり、`assumption DefaultsFromDogfooding`
を置き換える。

## 環境

- コミット: <触ったときの `git rev-parse --short HEAD`>
- 起動: `pnpm dev:stack` → http://localhost:5173/easy-extrude/
- 触った画面: <Home / Context (intake · wizard · checks) / grasp-search>

## 獲得した値（既定値候補）

`createDefaultCellDoc()` に入れる候補。「なぜ」の欄が埋まらない値ほど既定値に向く
（考えずに通せる値だから）。逆に強い理由がある値は、ユーザ固有なので既定値にしない。

| 対象 | 入れた値 | なぜその値にしたか | 既定値にしてよいか |
|------|---------|------------------|-----------------|
| actor（誰が要件を持つか） | | | |
| variable（何を決めるか）と domain | | | |
| requirement の KPI | | | |
| criterion（op と閾値） | | | |
| admissible interval | | | |
| camera 宣言 | | | |
| gripper 宣言 | | | |
| robot base / TCP | | | |

## 詰まり（改善候補）

| どこで | 何が起きた／何が分からなかった | 期待した挙動 |
|--------|---------------------------|------------|
| | | |

## 判定結果

grasp-search が返した内容（候補数・ファネルの棄却段・階梯リスク）と、それを見て
考えを変えた点:

<記入>

## この探索から ADR-091 に返す修正

<既定文書の構成・訂正 UI・ref 扱いのどこを変えるべきか。ADR-091 を改稿する材料>
