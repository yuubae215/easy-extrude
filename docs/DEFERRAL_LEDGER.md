# 残しの登録簿 (deferral ledger)

**「後でやる」と書かれたものの、宣言・満期・ticket の置き場所。** 正本は ADR-109。

## この文書の位置づけ (§1.1 — 第二の源にしない)

登録簿が持つのは **id / 所在 / 満期条件 / ticket / lane** の 5 列だけ。残しの*内容*の
正本は元の ADR・コード・順序表のままで、ここは**索引**である。内容を写したら第二の源になる。

## register は 2 本ある (ADR-123 D2)

| register | 対象 | ticket |
|---|---|---|
| **この登録簿** | **設計判断を伴う残し** — 実装の前に決めることが残っているもの | ADR 番号か段 (必須) |
| **GitHub Issues** | **機能要望** — 設計判断を伴わず、やるかどうかだけのもの | issue 番号 |

ADR-109 D5 は「レーンが違う残しを表から外さない — 外した瞬間に母集団の外が
再生産される」と警告している。**この警告は分けることではなく*黙って*分けることを
禁じている**、と読む。よって Issues レーンの存在と現在の委譲対象は **DEF-021** が
1 行で宣言する。

**限界 (推論させない):** 委譲行が覆うのは*委譲の事実*であって *Issue の個数*ではない。
個数はネットワークの向こうに在り、CI はオフラインで走るので数えない。実際 2026-08-12 に
#73 で **GitHub / ROADMAP / コードが三様に食い違っている**のを実測しており、Issues 側も
独立にドリフトする。**その照合は今日も人がやる。** 埋めていない穴として置く。

**この表は分母ではない。** 母集団は残しの*語彙* (`未着手` / `未実装` / `暫定` / `申し送り` /
`後続 PR` / `次セッション` / `保留` / `引き受けなかった` / `PROVISIONAL_UNTIL` / `DECLARED_GAPS`) から
`scripts/check-deferrals.mjs` が導出し、この表は「導出された母集団のうち**宣言された
もの**」に限る。表を分母にしたら、それ自身が母集団を持たない表 (`place-list`) になり、
「書き忘れた残し」が原理的に出てこなくなる (ADR-102)。

## 残しは「残りの作業を宣言する節」に書く (ADR-124)

`docs/**` では、**残りの作業を宣言する見出しの配下だけ**が母集団である
(`## 残し` / `Deferred` / `Future Work` / `Out of scope` / `Open questions` /
`引き受けなかったもの` など。キーワードは見出しの**先頭付近**に無ければならない —
narrative の見出しに紛れ込んだ語は主題ではなく修飾である)。`src/` `scripts/` は全行。

**なぜ絞ったか。** 2026-08-12 の実測で宣言外 99 件の内訳は **docs/adr 68 / docs その他 29 /
src 1 / scripts 0** で、コードに残っている残しは **1 件**だった。残りは「残しについて
*述べている*散文」で、**残しを片付けても減らず、残しについて考えるほど増える** —
ratchet が「ドキュメント量」を測っていた。絞った結果 99 → 1 になり、**0 へ向かえる数**に
戻った。初回実行で DEF-025 (`ADR-076 §Still deferred` に 5 か月在った) を掘り出している。

**したがって規則になる: 残しを書くなら、残しの節に書くこと。** narrative に書いた残しは
検査から見えない — これは交換条件であって事故ではない (反対側は Q3/Q4/Q6 が押さえる)。

## 主張である残しは GSN に住む (ADR-126)

| 種類 | 正本 | 例 |
|---|---|---|
| **知識的な残し** — 主張はあるが証拠が無い | **GSN の未支持 goal** (`support-exploring` / `support-unexplored`) | DEF-014 / 015 / 016 |
| **義務** — 雑務・移管・退役 | **この登録簿** / ADR の `Retires:` | DEF-021 (Issues 移管) / DEF-027 |

知識的な残しの行は**内容を書かず GSN ノードを指す**。登録簿は ADR-109 が元々
「索引であって内容の正本ではない」と設計しており、その設計に戻すだけである。
粒度も GSN のほうが正しい — DEF-015 は 1 行だが、ADR-121 の木には**3 つの別々の
未支持ゴール**が在る。

**個数と満期は `pnpm test:gsn-debt` が問う** (G1 母集団 / G2 個数 / G3 満期の機械可読性 /
G4 満期切れ)。`pnpm test:gsn` が問うのは**未宣言のゼロ**で、別の問いである。

## 更新規則 (必須)

- 残しを**書いたら**行を足す。`未着手` と書いて行を足さなければ Q1 の ratchet が上がる。
- 残しを**片付けたら**行を消し、`UNDECLARED_BASELINE` を実測値へ**下げる**。
  下回りも fail するのは、baseline が古いままだと「今いくつ残っているか」が再び
  記憶の中の数になるから (ADR-103 — 退役の腐敗は違反を*見逃す*のではなく緑を出す)。
- **満期は条件で書く。日付でも「次の段」でもない。** 満期を*他人の判断*に相乗りさせると
  空振りする — ADR-106 は満期を「Phase 5 が決める」に置き、Phase 5 は入口を決めて器の
  住所を決めなかったため、2026-08-03 に満期が無言で過ぎた (ADR-112 §力学 2)。
- **満期が機械可読に書けるなら書く。trigger は 4 形ある** (ADR-123 D5 + 実装で足した
  4 形目)。散文だけの満期は Q2 にとって存在しないのと同じなので、trigger を持たない
  行の個数は Q5 が ratchet で縛る — **書けないこと自体は正当**だが、黙って 0 件に
  見えることは許さない (原則 #31)。

  | 形 | 満期の意味 |
  |---|---|
  | `満期=ADR-NNN` | その ADR が `Accepted` になったとき (ADR-109 D6) |
  | `満期=PATH:<path>` | そのパスが**存在するようになった**とき |
  | `満期=GREP:<path>::<regex>` | そのファイルにパターンが**現れた**とき |
  | `満期=GONE:<path>::<regex>` | そのファイルからパターンが**消えた**とき |

  正規表現に**リテラル空白と `|` は使えない** (この表の区切りとして食われる)。
  `\s` は使えるので `DECLARED_GAPS\s*=\s*\[\]` のようには書ける。
  嘘の trigger を書かないこと: ADR-060 のように**とうに Accepted で、残っているのは
  追従**という行に `満期=ADR-060` を書けば「満期は去年過ぎた」と主張することになる。
  辿れない参照は空欄より悪い。
- **ticket 欄は空にできない。** 段を持たない項目は誰も実装しない (原則 #31)。
  ADR 番号か段のどちらかで、**実在**が検査される (辿れない参照は空欄より悪い)。
- `lane` は催促の速度を分けるためだけに在る。**レーンが違う残しを表から外さない** —
  外した瞬間に「母集団の外」が再生産される (ADR-109 D5)。

## 台帳

凡例 — lane: `ia` = IA 再設計 (段を持つ) / `contract` = 契約レーン / `core` = 判定エンジン /
`app` = エディタ本体。

| id | 所在 | 満期 (条件) | ticket | lane |
|---|---|---|---|---|
| DEF-004 | `docs/adr/ADR-060-grasp-contract-data-governance.md` | `Kinematics.js` の連鎖順が契約側 `jointSpace.joints` の順序と一致する契約として doc に名指しされたとき。**他の 4 項目は 2026-08-04 に完了/消滅を確認済み** | ADR-060 | contract |
| DEF-005 | `docs/adr/ADR-081-domain-staged-validation-fallback-ladder-kpi.md` | Phase 4 (実ソルバ差し替え) と pick-sequence 集計レポート UI が出たとき。収束仮説の検証も同段 | ADR-081 | core |
| DEF-006 | `docs/adr/ADR-078-bin-picking-scene-entities.md` · `docs/adr/ADR-077-recommendation-similarity-lane.md` | `contract/scene_models.py` (pydantic) が暫定正本でなくなったとき = 正本 JSON Schema 追加 → conformance → BFF 配線が済んだとき | ADR-078 | contract |
| DEF-007 | `docs/adr/ADR-079-search-diagnostics-proof.md` | ファネル診断の wire 追加に BFF / UI が消費追従したとき (エンジン側は完了済み) | ADR-079 | contract |
| DEF-008 | `src/DanglingSelfCallCensus.test.js` · `src/CensusCoverage.test.js` | `DECLARED_GAPS` が空になったとき (`_saveScene` / `_loadScene` / `_triggerStepImport` / `_confirmPivotSelect` の 4 件 — いずれも「メソッドを 1 本足す」ではなく機能の設計判断を伴う)。当のファイルが「表が空になったら `DECLARED_GAPS` ごと消す」と書いているので満期は**消滅**で、満期=GONE:src/DanglingSelfCallCensus.test.js::DECLARED_GAPS | ADR-098 | app |
| DEF-009 | `docs/adr/ADR-091-default-doc-first-intake-system-owned-refs.md` | ADR-091 が Accepted になり実装されたとき (**満期=ADR-091**)。**現在 `src/` からの参照 0 件**で、段も持たない (IA レーンの外なので段の検査の母集団に入らない) | ADR-091 | app |
| DEF-010 | `docs/adr/ADR-094-link-network-tf-tree-fused-origin-node.md` | 事業木への接続が保留されている `.gsn` の枝が solution として吊られたとき | ADR-094 | app |
| DEF-014 | `docs/gsn/adr-119-a-target-is-a-contract.gsn` · `docs/adr/ADR-119-a-target-is-a-contract-and-where-to-grasp-is-an-input.md` | ADR-119 が Accepted になったとき (**満期=ADR-119**)。掴む対象の契約化 — `target`/`obstacles`/`sampling` が `additionalProperties:true` を素通りしている。**2026-08-11 起票、2026-08-12 に登録** (`未実装` が語彙に無かったので、それまで宣言済みにも宣言外にも数えられていなかった — ADR-123 D7) | ADR-119 | contract |
| DEF-015 | `docs/gsn/adr-121-centre-of-mass-is-declared.gsn` · `docs/adr/ADR-121-centre-of-mass-is-declared-estimation-is-a-lane.md` | ADR-121 が Accepted になったとき (**満期=ADR-121**)。**DEF-013 (ADR-120 D1) が先** — 重心不在で全候補が不当に低く見える状態を先に直さないと、`com_offset` を足しても意味が読めない | ADR-121 | core |
| DEF-016 | `docs/gsn/adr-122-pickable-and-yield-are-two-questions.gsn` · `docs/adr/ADR-122-pickable-and-yield-are-two-questions.md` | ADR-122 が Accepted になったとき (**満期=ADR-122**)。pickable と歩留まりの分離 + `POST /pick-sequence` への入口。DEF-014 / DEF-015 とは独立 | ADR-122 | core |
| DEF-017 | `docs/adr/ADR-032-geometric-host-binding.md` | 同 ADR §Out of scope が挙げる `fastened` constraint-solver の実装が入ったとき (同じソルバーがこの問題も閉じるので独立した満期を持たない)。**2026-08-12 に `docs/ROADMAP.md` の frontend backlog 🟡 から移設** — 制約ソルバーを要する = 設計判断つきなので Issues レーンではない | ADR-032 | app |
| DEF-018 | `docs/adr/ADR-027-wasm-geometry-engine.md` | Shared Wasm Memory: `+atomics,+bulk-memory,+mutable-globals` が **stable Rust** で通るようになったとき (**外部条件なので trigger を書けない**)。「remaining copy の除去」はこれにブロックされ独立の満期を持たない。`run_monte_carlo` / `build_boolean_union` は *candidate* であって決定ではないので**判断の未完了**側 (ADR-123 D3) | ADR-027 | app |
| DEF-019 | `docs/adr/ADR-015-bff-microservices-architecture.md` | Geometry Service 側の 4 項目 (STEP 永続化 / B-rep→graph / GLTF・OBJ export / delta-sync) に着手が決まったとき。**2026-08-12 の Phase D 再評価で 9 項目中 4 項目を廃止した残り** — 「Priority TBD after Phase C」の満期は Phase C 完了 (2026-04-15) に到来しており、4 か月間誰も判定しなかった (ADR-123 §力学 1) | ADR-015 | app |
| DEF-020 | `docs/adr/ADR-017-websocket-session-geometry-service.md` | ROADMAP §Phase S-4 自身が「**新 ADR は Phase S-3 / S-4 の着手前に作成する**」と宣言しているので、満期は実装ではなく**その ADR が起票されたとき**。`NodeEditorView.js` は Phase S-2 まで (OperationGraph は読み取りのみ、編集経路 0 件)。BFF Phase D 表と §Phase S-4 の**二重登録を畳んだ**もの — 条件つき退役は誰も実行しない | ADR-017 | app |
| DEF-021 | `docs/ROADMAP.md` · `docs/adr/ADR-124-a-ratchet-that-counts-prose-measures-documentation.md` | **委譲行** (ADR-123 D2)。機能要望 14 件を GitHub Issues へ移すこと。移管が済んで §未移管 の節が消えたときが満期: 満期=GONE:docs/ROADMAP.md::未移管 。**覆うのは委譲の事実であって Issue の個数ではない** — 個数はネットワークの向こうで CI は数えない (限界宣言は §register は 2 本ある) | ADR-123 | issue |
| DEF-022 | `docs/adr/ADR-044-5w1h-function-mapping.md` | ADR-044 の判断が閉じたとき (**満期=ADR-044**)。φ 準同型は 2 か月 Draft のまま。**実装は 1 行も無い** — `FunctionRegistry.js` / `FunctionMatcher.js` / `SpatialCommandParser` はどれも存在せず、`src/` の 5 ファイルは*言及*である (ADR-123 §力学 3)。ADR-052 が φ を 5W1H 語彙全体へ一般化した結果、引用だけが増えた | ADR-044 | app |
| DEF-024 | `docs/adr/ADR-123-a-deferral-is-not-written-in-one-notation.md` | コミット済み WASM 成果物の鮮度検査が入ったとき。`test:wasm` (cargo) と `test:robotics-wasm` は CI に無く、source を編集して再生成を忘れても緑になる。現在ズレてはいない (source・成果物とも #340 / 2026-07-22)。ADR-064 Phase 1 が意図的に決めた形なので違反ではないが、問う場所が無い。満期は CI が cargo を走らせ始めたとき: 満期=GREP:.github/workflows/ci.yml::cargo | ADR-064 | app |
| DEF-025 | `docs/adr/ADR-076-core-api-endpoint-layer.md` | TS 側の HTTP 往復 conformance (BFF が中立 Schema に突き合わせる) が public 配線回で入ったとき。**2026-08-12 に Q1 の見出し絞り込み (ADR-124) が初回実行で見つけた** — `## Still deferred` 節に 5 か月在ったが、99 件の散文に埋もれて誰にも見えていなかった | ADR-076 | contract |
| DEF-027 | `docs/adr/ADR-125-an-obligation-belongs-to-the-event-that-fires-it.md` | **段の完了**を退役の発火事象にできるようになったとき。今日の発火は ADR の Status 遷移だけなので、「Phase N が完了したら消す」は D4 の二段構え (登録簿 → 起票された ADR の `Retires:`) を通る。順序表の段に**完了状態の機械可読な表現が無い**のが理由 (`- [x]` はあるが段の単位では読めない)。段が発火事象になれば D4 の迂回は不要になる | ADR-125 | app |
| DEF-028 | `docs/adr/ADR-126-a-deferral-that-is-a-claim-belongs-to-the-argument.md` | cutoff (ADR-126) より前で木を持たない **11 本**の ADR (ADR-015/017/027/032/044/060/064/076/078/079/091) に `.gsn` を書くか、`DECLARED_TREELESS` に「書かない」と理由つきで宣言したとき。それまでその 11 本に紐づく残しは GSN 側から見えず、登録簿が受け続ける (だから ADR-126 D1 は「登録簿を畳む」ではなく「役割を分ける」)。既存 26 個の exploring への満期の後付けも同段 — 今日は機構の実証として 1 個だけ付けた | ADR-126 | app |
| DEF-011 | `docs/adr/ADR-113-one-claim-on-the-screen.md` | 2 つのギャラリー (起動ホーム = Layout DSL / New Project = Context DSL) の**語彙の作り分け**が済んだとき — 見出し・説明・破壊性の書き方が区別され、読み取り専用の表示 (`Unexamined`) の出口がシーン置き換えを伴うことが押す前に分かること。ADR-113 は**構造の側**だけを閉じた (2 枚同時が表現不能) ので、語彙は未着手 | ADR-113 | ia |

## 覆えていないもの (限界の宣言 — 推論させない)

- **語彙を使わない残しは捕まらない。** 英語の `TODO` / `// later` / 何も書かずに残す —
  この検査は「**宣言する気のある残し**」に対しては完全だが、それ以外には無力である。
  語彙を足せば前 2 者は入る (`DEFERRAL_VOCAB` に行を足す = baseline が動く意図的な行為)。
- ~~**Draft の ADR (ADR-043 / 044 / 046) は行を持たない。**~~ **2026-08-12 に撤回**
  (ADR-123 D3)。この段落は「将来 Draft を残しとして扱うなら、行を足すのではなく
  この段落を書き換えること」と自分で指定していたので、その指定どおりに書き換える。

  **撤回の理由 — 除外の*根拠*が 3 本中 2 本で偽だった。** 除外は「`Draft` は残しでは
  なく*まだ決めていない決定*であり、満期の対象が異なる (実装の遅れではなく判断の
  未成熟)」を根拠にしていた。実測すると **ADR-043 は Phase 1〜4 すべて実装済み**
  (本文の §Deferred が 3 項目とも自分で `✅ Implemented` と書いている)、**ADR-046 は
  `src/context/` 一式 + ゴールデン 8/8** で、どちらも未成熟ではなかった。台帳が実物より
  遅れていたのではなく、**実物が台帳を追い越していた**。ADR-103 の言う退役の腐敗と
  同型で、除外の腐敗も違反を*見逃す*のではなく緑を出す。2 本は Accepted へ昇格した。

  **新しい規則:** Draft / Proposed の ADR は残しの母集団に入り、行と満期を持つ
  (DEF-022 = ADR-044 が現在の唯一の Draft)。ただし **満期は「実装が入ったとき」では
  なく「判断が閉じたとき」で書く** — Draft の残しは実装の遅れではなく決定の未完了
  だからである。ADR-109 のこの区別自体は正しく、偽だったのは*当てはめ*のほうだった。

  **実装が先行している Draft は禁止しない — 数えて宣言させる** (Q6)。実装して初めて
  設計が決まる探索的 MVP は実在し、ADR-046 がまさにそれだった (MVP を書いて初めて
  interval の確定方式が Decision エンティティ経由だと決まった)。マージを止める gate に
  していたら **ADR-046 は書けなかった**。しかも gate は今回の 2 件を 1 件も防げない —
  どちらも実装先行ではなく **Status の上げ忘れ**である。宣言表は
  `scripts/check-deferrals.mjs` の `DRAFT_WITH_IMPLEMENTATION`。
- **言及と宣言を区別できない。** この検査は「ここに残しが在る」と「この文が残しについて
  **述べている**」を同じ 1 つの hit として数える。覆う粒度がファイル単位なので、
  片付けて行を消すと、その行が覆っていた散文 — 決着した残しを記述する文 — が母集団へ
  **戻る**。2026-08-05 に実測: ADR-110/111/112 で 3 件片付けたら宣言外が 31 → 71 へ*増えた*。
  検査に合わせて散文を書き換えるのは履歴を消す行為なので、実測値をそのまま焼いた。
  **これは「残し」ではなく検査の粒度の欠陥**なので、この表ではなく
  `docs/PHILOSOPHY.md` の Yellow Cards 表が累積器である (1 例目を記録済み・2 例目で昇格)。
  問われる場所は `pnpm test:deferrals` Q1 の失敗メッセージ — baseline を上げようとする
  瞬間であり、それが唯一その判断が起きる瞬間だから (憲法 Q3)。
- **覆う粒度はファイル単位である。** 行を 1 つ足すとそのファイル内の以後の残しも
  「宣言済み」に数えられる。所在欄に行番号を書いても検査はファイルまでしか見ない —
  行番号は人が辿るためのもので、機械が数える鍵ではない (行番号は編集のたびにずれる)。
- **散文の満期は、来たことを機械が知らない。** 現在 8 行 (DEF-004〜008 /
  010 / 011) の満期条件は ADR の採択に対応しないので `満期=ADR-NNN` を持たない。Q5 が
  この予算を個数で縛るが、**縛るのは個数であって条件の真偽ではない** — 「Phase 4 が
  出たとき」が本当に来たかどうかは、今日も人が見るしかない。ここは埋めていない穴として
  宣言しておく。
  DEF-013 (2026-08-12 追加 / **2026-08-14 決着**) は `GREP:` trigger が実際に発火した
  **最初の例**である。満期は「`core/tests/test_engine.py` に『評価不能』を名前に持つ検査が
  現れたとき」で、`weighted_sum` を直したコミットがその検査を同時に置いたので、満期の到来と
  片付けが同じ commit に落ちた — **散文で書いていたら「実ソルバはまだか」を人が思い出す必要が
  あった行**が、書く形を得た 2 日後に自分で閉じた (ADR-123 D5 の狙いどおり)。
  DEF-011 (2026-08-04 追加) が 7 行目である。DEF-012 (2026-08-08 追加) は同日中に満期を迎えて消えた —
  ADR-116 が Accepted・実装済みになったため。**登録から決着まで 1 日**で、
  機械可読な満期 (`満期=ADR-116`) が実際に発火した最初の例である。
  **分母は 2026-08-05 に 11 → 8 へ下がった**
  (DEF-001 / 002 / 003 の満期 `満期=ADR-112` / `=ADR-110` / `=ADR-111` が来て、3 行とも
  片付いたので削除した)。機械可読な満期を持つ行が減ったのは*成功*であって後退ではない —
  trigger は満期が来たら消える設計なので、残っているのは常に「まだ来ていない満期」である。
  分子 7 が動かず分母だけ下がるのはそのためで、Q5 の予算は個数で縛る以上ここも
  推論させず書いておく。満期は「読み取り専用の表示を押した先が
  シーンを置き換えることが押す前に分かる」ことで、**ADR の採択ではなく画面の状態**が
  条件なので trigger を書けない。ADR-113 を書けば「ADR-113 が Accepted になった日に
  満期」と主張することになるが、ADR-113 は構造の側だけを閉じており語彙は未着手のまま
  Accepted なので、それは嘘の trigger になる (この登録簿が最も嫌う形)。

---

**問い所:** `pnpm test:deferrals` (`scripts/check-deferrals.mjs` の 5 つの問い —
Q1 ratchet / Q2 満期 (コード側 `PROVISIONAL_UNTIL` + 登録簿の `満期=ADR-NNN`) /
Q3 ticket / Q4 逆向き / Q5 満期の機械可読性)。**CI の gate ジョブで毎 PR 走る。**
**正本:** `docs/adr/ADR-109-a-deferral-is-a-declaration-not-a-memory.md`
