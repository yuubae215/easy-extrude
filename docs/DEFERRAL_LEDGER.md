# 残しの登録簿 (deferral ledger)

**「後でやる」と書かれたものの、宣言・満期・ticket の置き場所。** 正本は ADR-109。

## この文書の位置づけ (§1.1 — 第二の源にしない)

登録簿が持つのは **id / 所在 / 満期条件 / ticket / lane** の 5 列だけ。残しの*内容*の
正本は元の ADR・コード・順序表のままで、ここは**索引**である。内容を写したら第二の源になる。

**この表は分母ではない。** 母集団は残しの*語彙* (`未着手` / `暫定` / `申し送り` /
`後続 PR` / `次セッション` / `保留` / `引き受けなかった` / `PROVISIONAL_UNTIL` / `DECLARED_GAPS`) から
`scripts/check-deferrals.mjs` が導出し、この表は「導出された母集団のうち**宣言された
もの**」に限る。表を分母にしたら、それ自身が母集団を持たない表 (`place-list`) になり、
「書き忘れた残し」が原理的に出てこなくなる (ADR-102)。

## 更新規則 (必須)

- 残しを**書いたら**行を足す。`未着手` と書いて行を足さなければ Q1 の ratchet が上がる。
- 残しを**片付けたら**行を消し、`UNDECLARED_BASELINE` を実測値へ**下げる**。
  下回りも fail するのは、baseline が古いままだと「今いくつ残っているか」が再び
  記憶の中の数になるから (ADR-103 — 退役の腐敗は違反を*見逃す*のではなく緑を出す)。
- **満期は条件で書く。日付でも「次の段」でもない。** 満期を*他人の判断*に相乗りさせると
  空振りする — ADR-106 は満期を「Phase 5 が決める」に置き、Phase 5 は入口を決めて器の
  住所を決めなかったため、2026-08-03 に満期が無言で過ぎた (ADR-112 §力学 2)。
- **ticket 欄は空にできない。** 段を持たない項目は誰も実装しない (原則 #31)。
  ADR 番号か段のどちらかで、**実在**が検査される (辿れない参照は空欄より悪い)。
- `lane` は催促の速度を分けるためだけに在る。**レーンが違う残しを表から外さない** —
  外した瞬間に「母集団の外」が再生産される (ADR-109 D5)。

## 台帳

凡例 — lane: `ia` = IA 再設計 (段を持つ) / `contract` = 契約レーン / `core` = 判定エンジン /
`app` = エディタ本体。

| id | 所在 | 満期 (条件) | ticket | lane |
|---|---|---|---|---|
| DEF-001 | `src/view/DocIntake.js` · `src/view/FloorTabs.js` · `src/store/uiStore.js` · `src/controller/ContextController.js` · `src/components/Doc/DocIntakeLayer.jsx` · `docs/adr/ADR-112-the-document-intake-address-becomes-permanent.md` | 文書の入口の恒久住所が決まったとき (ADR-112 が Accepted)。**満期は 1 度空振りしている** — 元は ADR-108 を指していた | ADR-112 / Phase 5.2 | ia |
| DEF-002 | `src/view/HeaderEntrances.js` · `docs/adr/ADR-110-grasp-is-a-check-beside-its-subject-not-an-object-of-the-floor.md` | `FLOOR_TARGETS` の全行が下部の器を開くようになったとき | ADR-110 / Phase 5.1 | ia |
| DEF-003 | `docs/ia-redesign/03-implementation-order.md` · `docs/adr/ADR-111-the-outliner-has-a-semantic-side.md` | Outliner の意味側 (v8 注釈②) が実装され、住所を持たない選択可能種が 0 個になったとき | ADR-111 / Phase 3.6 | ia |
| DEF-004 | `docs/adr/ADR-060-grasp-contract-data-governance.md` | `Kinematics.js` の連鎖順が契約側 `jointSpace.joints` の順序と一致する契約として doc に名指しされたとき。**他の 4 項目は 2026-08-04 に完了/消滅を確認済み** | ADR-060 | contract |
| DEF-005 | `docs/adr/ADR-081-domain-staged-validation-fallback-ladder-kpi.md` | Phase 4 (実ソルバ差し替え) と pick-sequence 集計レポート UI が出たとき。収束仮説の検証も同段 | ADR-081 | core |
| DEF-006 | `docs/adr/ADR-078-bin-picking-scene-entities.md` · `docs/adr/ADR-077-recommendation-similarity-lane.md` | `contract/scene_models.py` (pydantic) が暫定正本でなくなったとき = 正本 JSON Schema 追加 → conformance → BFF 配線が済んだとき | ADR-078 | contract |
| DEF-007 | `docs/adr/ADR-079-search-diagnostics-proof.md` | ファネル診断の wire 追加に BFF / UI が消費追従したとき (エンジン側は完了済み) | ADR-079 | contract |
| DEF-008 | `src/DanglingSelfCallCensus.test.js` | `DECLARED_GAPS` が空になったとき (`_saveScene` / `_loadScene` / `_triggerStepImport` / `_confirmPivotSelect` の 4 件 — いずれも「メソッドを 1 本足す」ではなく機能の設計判断を伴う) | ADR-098 | app |
| DEF-009 | `docs/adr/ADR-091-default-doc-first-intake-system-owned-refs.md` | ADR-091 が Accepted になり実装されたとき。**現在 `src/` からの参照 0 件**で、段も持たない (IA レーンの外なので段の検査の母集団に入らない) | ADR-091 | app |
| DEF-010 | `docs/adr/ADR-094-link-network-tf-tree-fused-origin-node.md` | 事業木への接続が保留されている `.gsn` の枝が solution として吊られたとき | ADR-094 | app |

## 覆えていないもの (限界の宣言 — 推論させない)

- **語彙を使わない残しは捕まらない。** 英語の `TODO` / `// later` / 何も書かずに残す —
  この検査は「**宣言する気のある残し**」に対しては完全だが、それ以外には無力である。
  語彙を足せば前 2 者は入る (`DEFERRAL_VOCAB` に行を足す = baseline が動く意図的な行為)。
- **Draft の ADR (ADR-043 / 044 / 046) は行を持たない。** `Draft` は「残し」ではなく
  「まだ決めていない決定」であり、満期の対象が異なる (実装の遅れではなく判断の未成熟)。
  **これは推論ではなく宣言である** — 将来 Draft を残しとして扱うなら、行を足すのではなく
  この段落を書き換えること。
- **覆う粒度はファイル単位である。** 行を 1 つ足すとそのファイル内の以後の残しも
  「宣言済み」に数えられる。所在欄に行番号を書いても検査はファイルまでしか見ない —
  行番号は人が辿るためのもので、機械が数える鍵ではない (行番号は編集のたびにずれる)。

---

**問い所:** `pnpm test:deferrals` (`scripts/check-deferrals.mjs` の 4 つの問い —
Q1 ratchet / Q2 満期 / Q3 ticket / Q4 逆向き)。
**正本:** `docs/adr/ADR-109-a-deferral-is-a-declaration-not-a-memory.md`
