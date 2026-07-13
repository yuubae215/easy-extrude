# 066. Motion Tier に Tier D「delight」を追加 — 遊び心を禁じず統治する

- Status: Accepted
- Date: 2026-07-12
- Deciders: yuubae215, Claude
- Supersedes / Superseded by: ADR-065 Widening 1（Motion Tier）を **amend**（全体の supersede ではない — 下記 Decision 参照）

## Context — Goal と力学（§1.2 Goal）

ADR-065 Widening 1 は Motion Tier 規則を鋳造し、PHILOSOPHY #30 として本則化した。
その境界判定は一文テスト:

> 「その動きが止まったとき、ユーザーが知れなくなることは何か? — 答えが『何もない』
> なら装飾であり不採用。」

この規則は当初、**演出過剰・判定の捏造・reduced-motion 退行**の 3 ドリフトを一括で
封じるために「何も語らない動き = 装飾 = 不採用」という二値で書かれた。実務上これは
うまく働き、Phase 1–2 の着地演出は「高頻度 × 結果が既に可視」を volume corollary で
装飾判定して黙らせるところまで洗練された。

**しかし二値の副作用**: 「事実にも能力にも紐づかない、歓びのための運動」——
セレブレーション、その瞬間を祝う一撃、サーフェスに生気を与える ambient な動き——を
**すべて装飾として一律禁止**する。これは #30 の *意図* を超えた抑止だった。

**Goal（性質に戻す）**: 要件は「序盤の抑止項目を外したい」という *解の形* で来たが、
達成したい性質は「**UI が退屈・無味であってはならない — 遊び心を表現できること。ただし
それが correctness 判定を偽装したり、統治を逃れて注意を食い潰したりしないこと**」。

この Goal を支える一次証言（Deciders の判断、2026-07-12）:

> 「前のセッションで実装した生成・削除エフェクト（materialize/dissolve ボクセルバースト・
> アウトライン構築）は感動した。あってよいものだと思う。UI はつまらなく、退屈なもので
> あってはならない。」

すなわち歓びの演出は *コスト* ではなく *価値* であり、二値ルールが誤ってその成長を
妨げていた。#30 は最新の項目（2026-07-10 追加）であって「序盤」ではないが、抑止の
効き方はユーザの体感どおりだった。

力学（保たなければならない不変条件）:
- #30 が束ねる **構造規則**——単一 reduced-motion 境界（`src/theme/motion.js`・grep 固定）と
  transient 単一所有者（`MotionGovernor`）と judgment 偽装禁止——は、抑止ではなく統治であり、
  外してはならない。これらは 4 本の CODE_CONTRACTS 規則が参照する。
- 変えたいのは「装飾 = 一律不採用」の *抑止* の一点のみ。

## Options considered

- **A: Tier D「delight」を新設し、抑止を再定義（採用）** — 歓びの演出を *許容される tier* と
  して名指し、全 tier と同じ統治（MotionGovernor 予算・reduced-motion 境界・judgment 偽装禁止）を
  課す。tradeoff: 「nothing → 不採用」の二値の単純さを失い、レビューで「許容される delight」と
  「無規律・欺瞞的な動き」を弁別する判断が要る。scarcity（volume 予算）で濫用を抑える。
- **B: 一文テストの文面だけ緩める（tier を新設しない）** — tradeoff: 歓びが *無名・無統治* の
  まま許され、「どこまでが OK か」が毎回再燃する（#30 が防いだはずのドリフト再発）。
- **C: #30 を完全削除** — tradeoff: 構造 corollary が失われ、参照する 4 本の CODE_CONTRACTS
  規則が孤児化。統治ごと捨てる過剰。
- **D: 現状維持（装飾禁止のまま）** — tradeoff: Goal（UI が退屈であってはならない）に反する。
  感動した既存エフェクトの拡張余地を塞ぎ、遊び心の成長を止め続ける。

## Decision — Strategy（§1.2 Strategy）

**A を採用**。PHILOSOPHY #30 を次のとおり改訂する（ADR-065 Widening 1 を *amend*）:

1. **Tier D — delight を新設**。意味 = 非命題的（occasion を刻む・surface に生気を与える:
   celebration・ambient・flourish）。統治 = *意図的かつ予算内* で許容し、全 tier と同じ
   `MotionGovernor` 所有 + 単一 reduced-motion 境界を課す; fact/affordance を読む位置には
   置かない（judgment forgery 禁止）; scarcity が価値ゆえ全 silence を埋めない。
2. **一文テストを routing に反転**。「nothing → 不採用」ではなく「nothing → 情報ではない →
   **Tier D として自己正当化せよ**（意図・予算・reduced 対応）」。旧文面は日付付きで引用保存し、
   *意図的改訂* であってドリフトでないことを残す（§1.1 履歴を書き換えない）。
3. **Forbidden を再定義**。「decoration = 何も伝えない = 不採用」→「**undisciplined /
   deceptive**（上位 tier の偽装 or 構造統治の逸脱）」。制約は「装飾禁止」→「未宣言・
   無統治・欺瞞的な動きの禁止」へ移る。
4. **構造 corollary と Underlies フッタは無改変**。単一 reduced-motion 境界・transient
   単一所有者・参照 CODE_CONTRACTS 4 規則はすべて有効のまま。Tier D は加算的で既存規則と
   非衝突（Landing Effects が生死のみ語るのは Tier F の設計判断であって delight 禁止ではない;
   celebration の発火は既存 `CelebrationMath` の committed 遷移トリガ = transient 所有者規則と整合）。

**契約への影響**: なし。これは体感層の設計規律（PHILOSOPHY / CODE_CONTRACTS チャネル）の
改訂であり、ワイヤ契約・schema・DSL 版・BFF には触れない（#29「rigor はワイヤ、play は
クライアント」の play 側のみ）。

**ADR-065 との関係**: ADR-065 は全体としては有効（プログラム完結・全 corollary 保持）。
本 ADR は Widening 1 の tier 表と一文テストの *一箇所* を amend する。ADR-065 Widening 1
節に「Amended by ADR-066」の相互リンクを付す（表そのものは履歴として残す — 書き換えない）。

## Consequences — Evidence と tradeoff（§1.2 Evidence）

- **肯定的**:
  - 遊び心（歓びの演出）が *許容され、かつ統治される* — 感動した materialize/dissolve/
    celebration に原則上の居場所ができ、今後の delight は「Tier D として宣言し予算を払う」
    という明確な拡張点を得る。
  - 統治は無傷 — reduced-motion 単一境界・transient 単一所有者・judgment 偽装禁止は残り、
    参照 CODE_CONTRACTS 4 規則は有効。既存の CI grep テスト・単体テストは影響を受けない。
  - 制約が「no decoration」から「no undeclared / ungoverned / deceptive motion」へ *鋭く* なり、
    レビュー時の問いが「これは装飾か?」から「これは *どの tier* を宣言し、統治を払っているか?」
    へ変わる（lookup が減らず、むしろ表現の幅が広がる）。
- **受け入れるコスト / 否定的**:
  - 二値の単純さを失う: 「許容される delight」と「無規律・欺瞞的」の弁別はレビュー判断を要する。
    → 緩和: volume/scarcity corollary（delight も予算を消費・routine 高頻度への祝祭は
    パーティ帽のノイズ）+ 単一所有者 + reduced 境界 が濫用の歯止め。
  - **delight creep のリスク**: 歓びを全 silence に撒くと価値が失われる（まさに旧文面が
    over-correct で禁じたもの）。→ 「Why it matters」に *undisciplined delight* として明記。
- **検証（証拠）**:
  - ドキュメント専用変更（コード無改変）— test/build は非対象。
  - #30 全文の目視レビューで tier 表・routing test・volume corollary・Why it matters・Index の
    整合を確認済み。
  - 既存実装が新 tier と *既に整合* であることの機械的裏付け: `CelebrationMath` は committed 遷移
    トリガ（`prev=null` は発火なし）+ `MotionGovernor.spawn` + reduced-motion 対応で、Tier D の
    統治要件を満たしている（ADR-065 Phase 4 の実装・テスト済）。構造 corollary 無改変ゆえ
    `src/theme/motion.test.js` の grep 固定と関連単体テストは不変。
- **波及（blast radius）**:
  - `docs/PHILOSOPHY.md` #30（本文 + Index 行）、`CLAUDE.md`（#30 doc-nav ポインタ + trigger
    キーワード）、`docs/adr/ADR-065`（Widening 1 に相互リンク + References）、`docs/adr/README.md`
    索引。
  - CODE_CONTRACTS 規則: **変更なし**（参照は有効のまま）。コード・schema・DSL 版・BFF・
    grasp-contract: **変更なし**。

## Lens notes

- **§1.1 真実の源は一つ / 履歴を書き換えない**: stated principle の反転は 1 ADR = 1 決定に
  従い新規 ADR で起こす。ADR-065 Widening 1 の旧表は残し、pointer で相互リンク。PHILOSOPHY
  内でも旧文面を日付付き引用で保存（第二の源を隠さず表に出す §5 / #19）。
- **§1.2 Goal へ持ち上げ**: 「抑止項目を外す」（解）→「UI は退屈であってはならない・歓びを
  表現できる・ただし偽装/無統治は不可」（性質）。この持ち上げが、完全削除（C）ではなく
  統治を保つ amend（A）を選ばせた。
- **黒箱 / 契約**: 体感層の内部規律の変更であり、ワイヤ契約の入力→出力・不変条件は不変
  （#29 play 側のみ）。
- **状態機械（§1.4）**: 本決定は lifecycle を含まない（Motion Tier は分類規律であって
  実体の状態機械ではない）。

## References

- ADR-067(ビューポート常設ステージ + 起動リビール)— 本 ADR が新設した Tier D の最初の適用実績。
