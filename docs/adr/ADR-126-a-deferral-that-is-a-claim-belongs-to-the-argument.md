# 126. 主張である残しは論証木に住む — GSN の「宣言された未支持」に母集団・個数・満期を与える

- Status: Accepted (実装済み 2026-08-12 — `scripts/check-gsn-debt.mjs` の 4 つの問いが CI gate で走る)
- Date: 2026-08-12
- Deciders: yuubae215, Claude
- Retires: GREP:docs/DEFERRAL_LEDGER.md::DEF-023
- Supersedes / Superseded by: なし (ADR-109 の登録簿と役割を分ける。ADR-123 D2 が
  register を 2 本に分けた続きで、3 本目ではなく**境界の引き直し**である)

## Context — Goal と力学 (§1.2 Goal)

**Goal:** *「証拠が無い」という事実が、散文ではなく構造として持たれ、個数が数えられ、
証拠が現れた日に機械が言う。*

出発点はユーザーの提案である —「残しとかって GSN の要素として書いておいたら忘れずに
管理されないですか? 散文にすると忘れるんですよね? GSN の構造の一部にしといて、
GSN 自体も hook にすれば良いのでは?」

**半分は既にそうなっていた。そして残り半分が欠けていた。**

### 力学 1 — GSN は既に残しを構造として持っている

`docs/gsn/*.gsn` には `support-exploring` / `support-unexplored` の goal が **30 個**ある。
中身は残しそのもので、しかも**満期条件まで書かれている**:

```
goal AbsentCentreOfMassNeverBecomesTheCentroid
labels support-exploring
    assumption KeyAbsenceTestWillSettleIt
    summary "未着手。決着させる検査は、重心なしのリクエストで com_offset の鍵が出ないこと。…"
```

**「未着手」+「決着させる検査は〜」= 残し + 満期。** しかも型のあるノードなので、
ADR-123 / ADR-124 が苦しんだ語彙・記法の問題が最初から無い。ユーザーの直観は正しい。

### 力学 2 — しかし hook は半分しか出来ていなかった

`gsn_tool.py` を読むと:

- `check_goal_support` は支えが 0 で**未宣言**なら error。**宣言済み
  (`support-exploring` + 検査を名指しした assumption) なら永久に緑**。
- `check_artifacts` は存在しない artifact を hard error にするが、それは `solution` の
  下だけ。`assumption` の下は**意図的に warning** (「planned but not yet written は正当」)。

つまり **「宣言された未支持」に満期が無い**。名指しした検査が実在するようになっても
何も落ちない。**ADR-109 力学 1 (満期が無言で過ぎる) が GSN レーンでそのまま
再生産されていた** — しかも 30 個ある。

個数を数える ratchet も無い。`report` モードは exploring / unexplored を集計するが
`pnpm test:gsn` はそれを走らせないので、**印字ですらなかった** (ADR-115 の一段下)。

`.claude/rules/10-principles.md` の #31 写像は「`pnpm test:gsn` (支えの無い goal)」と
書いているが、実際に覆えているのは**未宣言のゼロ**だけである。

### 力学 3 — 同じ事実が既に 2 か所にある (§1.1 違反)

| 事実 | 登録簿 | GSN |
|---|---|---|
| ADR-120 D1 が `core/` に残っている | DEF-013 | `assumption RealSolverStillDividesByEveryWeight` |
| ADR-121 が未実装 | DEF-015 (**1 行**) | exploring goal **3 個** |
| ADR-119 が未実装 | DEF-014 (1 行) | exploring goal 2 個 |
| ADR-122 が未実装 | DEF-016 (1 行) | exploring goal 3 個 |

**粒度は GSN のほうが正しい。** DEF-015 は 1 行だが、実際には 3 つの別々の未支持ゴール
である。登録簿の行は ADR-123 で `未実装` を語彙に足した結果として生まれたもので、
新しい情報を運んでいない — **登録簿が自分の census を満たすために行を増やしていた**。

### 力学 4 — 母集団の穴が前提を壊している

DEF 行 22 本のうち **11 本**の ticket ADR に `.gsn` が存在しない (ADR-015 / 017 / 027 /
032 / 044 / 060 / 064 / 076 / 078 / 079 / 091)。GSN を primary にすると、木が無い ADR の
残しは**定義上見えなくなる**。`.claude/skills/adr/SKILL.md` は「ADR を起票するなら GSN も
起こす(無条件)」と既に宣言しているのに、**それを問う機械が無い** — 規律が在ることと、
守られたかを数える場所が在ることは別の事実である (ADR-115 と同じ形)。

## Options considered

- **A: 残しを全部 GSN へ寄せる** — tradeoff: 力学 4 の穴をそのまま継承する。加えて
  DEF-021 (14 件を Issues へ移す) や `Retires:` は「システムが妥当である理由」ではなく
  **義務**であり、assurance case に入れると論証木が「やること表」で汚れる。
- **B: 登録簿に一本化し GSN は論証だけ** — tradeoff: 既に GSN に書かれている 30 個を
  散文へ写す作業になる。**構造から散文へ退化させる**ので方向が逆。
- **C: 種類で分ける + GSN 側に欠けている 3 つを足す【採用】** — 知識的な残し
  (主張はあるが証拠が無い) は GSN、義務は登録簿。そのうえで GSN に母集団・個数・満期を
  与える。tradeoff: 「これは主張か義務か」の判断が要る (下記 assumption)。

## Decision — Strategy (§1.2 Strategy)

### D1 — 種類で分ける。**GSN は主張、登録簿は義務**

| 種類 | 正本 | 例 |
|---|---|---|
| **知識的な残し** — 主張はあるが証拠が無い | **GSN の未支持 goal** | ADR-119/121/122 の未実装、ADR-120 D1 |
| **義務** — 雑務・移管・退役 | 登録簿 / `Retires:` | DEF-021 (Issues 移管)、DEF-027、`Retires:` |

登録簿は ADR-109 が元々「**索引**であって内容の正本ではない」と設計している。
だから知識的な残しの行は**内容を書かず GSN ノードを指す**。行を消すのではなく、
所在を GSN に向ける — 「一覧が 1 つ」という登録簿の価値は保ちつつ、内容の二重化を止める。

### D2 — `.gsn` の母集団を cutoff で閉じる。**ADR-126 以降は必須**

遡及しない (歴史 ADR 125 本に木を書くのは churn に対して得るものが無い) — `Retires:` を
ADR-125 以降に切ったのと**同じ判断**である。cutoff より前で「木を書かないと決めた」ものは
`DECLARED_TREELESS` に理由つきで宣言する。**今日は 0 件** — 誰もまだ判断していない。
**判断していないことと、判断して不要としたことは違う**ので、空であることを宣言しておく。

### D3 — 宣言された未支持の**個数**を ratchet で縛る (G2)

超えても下回っても fail。「宣言された未支持」に欄が無ければ、30 が 60 になっても
誰も気づかない (原則 #31 — 正当な非ゼロは 0 に見えない)。

### D4 — 未支持 goal に**満期**を持たせる (G3 / G4)

exploring goal の子 `assumption` の `summary` に、**登録簿と同じ語彙**で書く:

```
assumption KeyAbsenceTestWillSettleIt
summary "未着手。決着させる検査は … 満期=GREP:core/tests/test_engine.py::com_offset"
```

名指しした検査が実在するようになった日に **G4 が落ちる** = 「exploring を solution へ
昇格させよ」。証拠が在るのに `support-exploring` のままだと、論証木は実際より**弱く**
見える — 退役の腐敗の鏡像で、こちらは*過少申告*として緑を出す。

trigger を持たない exploring の個数は G3 が ratchet で縛る (Q5 と同じ形)。

**文法と評価器は `scripts/expiry-trigger.mjs` ただ 1 箇所へ切り出した** (§1.1)。
GSN 側で同じ文法を書きそうになった — それは ADR-123 §実装で分かったこと 2 で見つけた
ばかりの欠陥 (「同じ文法で読む」とコメントして実物は写し) の再生産だった。

## Consequences — Evidence と tradeoff (§1.2 Evidence)

**Evidence:**

- `pnpm test:gsn-debt` — 木 31 本 / 宣言された未支持 **30 個** / うち exploring 27 個 ·
  満期が機械可読 1 個・散文のみ 26 個 / 満期切れ 0 件。CI の gate ジョブで毎 PR 走る。
- **変異で確認済み** — `core/tests/test_engine.py` に `com_offset` を含む検査を足すと
  G4 が ADR-121 の goal を名指しして fail し、戻すと緑。満期は実際に発火する。
- `pnpm test:gsn` (未宣言のゼロ) と `pnpm test:gsn-debt` (宣言されたゼロ) は**別の問い**で、
  両方 CI に居る。

**実装で分かったこと:**

- **`support-` prefix で数えてはいけない。** 初版は `startsWith('support-')` で数えて
  **57 個**を報告した (実測 30)。原因は**第 3 のラベル `support-verified`** で、これは
  「支えが在る」= *逆の意味*である。prefix は「support について何か言っている」しか
  意味せず、**符号を持たない**。種を列挙し、未宣言の種で落とす形にした
  (`EXPLICIT_DEFAULTS` と同じ — 原則 #31)。
- **前段の棚卸しで grep が数えた「31」は 1 件多かった。** adr-105 の summary が散文の
  中で `support-unexplored` に**言及**していたためである。ADR-124 が名指しした
  「言及と宣言を区別できない」欠陥が、**その ADR を書いた本人の計測にも出た**。
  ラベルを構造として読めば 30。

**Tradeoff (引き受けたもの):**

- **「主張か義務か」の判断は人がする。** D1 の分類に機械的な判定はない。
  誤って義務を GSN に入れれば論証木が汚れ、主張を登録簿に入れれば粒度が粗くなる。
- **パーサは字下げベースの素朴なもの。** `gsn_tool.py` が文法の正本で、こちらは
  「goal の labels と子 assumption の summary」しか読まない。文法が変われば落ちる
  (黙って 0 件になるより落ちるほうがよい — G2 は下回りでも fail する)。

### 引き受けなかったもの (宣言する — 推論させない)

- **cutoff 前の 11 本の木は書いていない。** D2 のとおり遡及しないと決めたが、
  その 11 本の ADR に紐づく残しは GSN 側からは見えないままである。登録簿がそれを
  受け続ける (だから D1 は「登録簿を畳む」ではなく「役割を分ける」なのである)。
- **既存 26 個の exploring に満期を後付けしていない。** 1 個 (ADR-121) だけ機構の実証
  として付けた。残りは書ける番地が決まっていないものが多く、嘘の trigger を書くより
  G3 の予算として数える。

## Lens notes

- **原則 #32 (義務は発火事象の側に置く)** の適用でもある。GSN の満期は「証拠が現れる」
  という事象に紐づいており、証拠の出現は repo の中で観測できる。
- **§1.1** — 力学 3 は同じ事実が 2 か所にある状態だった。消せない複製 (登録簿の一覧性は
  価値がある) は、ADR-124 D3 と同じく**指す形**にして内容の二重化だけを止める。
- **原則 #31** — この ADR の 4 つの問いはすべて「不在を数える」形である。G1 は木の不在、
  G2 は証拠の不在、G3 は満期の不在、G4 は昇格の不在。
