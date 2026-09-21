# 144. クライアントの腕プレビューは「未決定の埋め合わせ」であって「もう一つの解法」ではない

- Status: Proposed
- Date: 2026-09-21
- Deciders: yuubae215, Claude (pairing)
- Retires: なし — 純粋加法的な追加。ADR-135 が確定した `reachSolution` 判定・IK チップ表示・
  `RobotStageSet.previewSolution()` の唯一入口はどれも無改変のまま残り、`solved` 以外の場合に
  新しい入力経路を 1 つ足すだけ(消える既存コードが無い)。
- Supersedes / Superseded by: なし(ADR-135 の続き — ADR-135 の decide 側は一切変更しない)

## Context — Goal と力学(§1.2 Goal)

**Goal(解ではなく性質):** GitHub Pages(および `core/` を起動していないローカル環境全般)で
grasp-search の候補を選んだとき、腕がおおよそどんな配置になりそうかを画面上で確認できる。
ただし「これは実際に到達可能な解である」という主張は一切しない — 権威の無い近似は
権威のふりをしてはならない(原則 #11 の裏返し)。

**現状の力学:**

- ADR-135 で `GraspController._syncArmPreview()` (`src/controller/GraspController.js:786`) が
  `candidate.score.reachSolution.kind === 'solved'` のときだけ `RobotStageSet.previewSolution()`
  へ関節角を渡す配線を確定した。`reachSolution` は `core/` の `UniversalRobotsIkSolver.solve()`
  だけが計算する、契約上の**決定された事実**(kind 判別の閉 union、`packages/grasp-contract`)。
- GitHub Pages のデプロイ(`.github/workflows/deploy.yml:53` の `pnpm build:stub`)は
  `VITE_GRASP_STUB=1` で `mocks/graspStub/` を使う。スタブは意図的に IK を解かず、常に
  `reachSolution: { kind: 'undeclared' }` を返す(ADR-135 実装時の差分1、および `solve.js:375`)。
  静的ホスティングである以上 `core/`(Python)を動かせないので、これは環境の欠陥ではなく
  トポロジ上の必然。
- CLAUDE.md のスコープ境界は明確: 「`src/` は解法を持たない。IK / 干渉 / リーチ / 把持安定性の
  *解き方* は `core/` にのみ書く」。したがって `UniversalRobotsIkSolver` の解析解をそのまま
  JS に移植する、という選択肢はこの境界に正面から触れる。
- 一方で **ADR-053**(ロボティクス KPI メソッド)は、GitHub Pages 単体で検証できる「測定器」
  として FK サンプリング(`src/robotics/Kinematics.js: sampleConfigs` / `forwardKinematics`)を
  クライアント側にすでに許容している。ただし ADR-053 は §7.1/§10.1/§11.5 で毎フェーズ
  「IK ソルバ(KDL)は使わない」「IK / 特異点 Jacobian / 可動ソルバは非目標」と**繰り返し明記**
  しており、許されているのは FK 到達点群への最近傍判定(boolean `reachable` / 数値 `margin`)
  であって、関節配置そのものを解くことではない。

**層マップ上の位置:** 本 ADR の変更は**すべて `src/` の内側**(表示層)に閉じる。
`core/`・`packages/grasp-contract`・`server/`(BFF)はどれも触らない。`contractVersion` は
不変。ADR-053 がすでに切っている「front 側の測定器(近似・非権威)」というレーンを、
FK サンプリングの**新しい消費先**(boolean ではなく関節ベクトル)として一段拡張する形になる
— 「decide は core/、propose/近似は front の非権威レーン」という ADR-056/077 の動詞境界
(decide/propose)と同型の切り分けを、grasp-search の腕プレビューにも適用する。

```mermaid
flowchart LR
  subgraph "core/ (権威 = decide)"
    A["UniversalRobotsIkSolver.solve()"]
  end
  subgraph "契約 (不変)"
    B["reachSolution\nkind: solved | undeclared"]
  end
  subgraph "src/ (表示層)"
    C{"kind === 'solved'?"}
    D["RobotStageSet.previewSolution\n(authority: 'solved')\n= 既存 ADR-135 配線・無改変"]
    E["ローカル FK サンプル探索\n(ADR-053 sampleConfigs の再利用・新規解法なし)"]
    F["RobotStageSet.previewSolution\n(authority: 'approximate')\n= 本ADRで足す新しい枝"]
  end
  A --> B --> C
  C -- "yes(core/が決定済み)" --> D
  C -- "no(undeclared — GH Pagesは常にここ)" --> E --> F
```

## Options considered

- **A(採用): 既存の FK サンプリング(ADR-053)を関節ベクトル探索に転用し、型で権威を分けた
  近似プレビューを `reachSolution.kind !== 'solved'` のときだけ表示する。**
  — tradeoff: 精度はサンプリング分解能に依存し、特異点・干渉は一切考慮しない粗い近似になる。
  ただし新しい解法方程式を一切書かないので、`src/` は解法を持たないという境界を越えない。
- **B: `UniversalRobotsIkSolver` の解析的 IK を JS に移植してクライアントにも持つ。**
  — tradeoff: 同じ計算(UR の閉形式解析解)を Python と JS の 2 か所に書くことになり、
  真実の源が 2 つに分裂する(§1.1 違反)。CLAUDE.md の AI ガードが名指しする「IK の解き方を
  `src/` に書く」その形そのもの。却下。
- **C: `core/`+BFF をどこか(Cloud Run 等)にデプロイし、GitHub Pages からもそこを叩く。**
  — tradeoff: 本来の3層構成をそのまま満たす一番正しい解だが、常時稼働インフラのホスティング
  コスト・運用が発生し、「静的サイトだけで完結する」という GitHub Pages 選定の前提から外れる
  デプロイ位相の決定であって、本 ADR の Goal(ゼロ追加インフラで近似確認したい)とは別の意思
  決定。排他ではないので将来別 ADR で検討してよいが、今回のスコープには含めない。
- **D: 現状維持。** — tradeoff: GitHub Pages 版では腕が恒久的に動かないまま。Goal 未達。

## Decision — Strategy(§1.2 Strategy)

**D1. 新しい解法を書かず、ADR-053 が既に持つ FK サンプリングを関節ベクトル探索に転用する。**
`src/robotics/Kinematics.js` の `sampleConfigs`(可動関節を limit 内でグリッドサンプル、
`MAX_SAMPLE_CONFIGS` で総当たり爆発をガード済み)と `forwardKinematics` を使い、候補の
エンドエフェクタ frame(`candidate.pose` が `kind:'endEffector'` のとき)に対して**最も近い
FK 結果を持つサンプル済み関節配置**を選ぶ。方程式を立てて解く「ソルバ」を新設するのではなく、
ADR-053 がすでに許容し実装済みの「測定器」の**出力を変える**(boolean/margin → 関節ベクトル)
だけ。距離が許容誤差を超えたら **配置なし(`null`)を返す**(近いだけの誤った配置を無理に
出さない — 原則 #11 の裏返しをここでも守る)。

**D2. 権威を型で分ける(原則 #2 — フラグや同名キーでなく型で分岐)。**
クライアント近似の結果は、契約の `reachSolution`(`kind: 'solved'|'undeclared'`)とは
**別のフィールド名・別の形**で表す。例:

```js
// 契約由来(core/ が決定した事実、無改変)
{ kind: 'solved', joints: [...] }        // reachSolution
{ kind: 'undeclared' }

// クライアント専用(本ADRで新設、契約に一切乗らない)
{ origin: 'clientApproximate', joints: [...], toleranceMm } | null
```

`kind` という判別子を再利用しない・`additionalProperties` の形も変えることで、契約側の
`reachSolution` を検証するコード(ajv 等)に近似結果を誤って渡しても構造的に通らないように
する。近似結果はワイヤに一切乗らず(`packages/grasp-contract` 無改変)、`core/` にも送らない。

**D3. ゲート条件は「core/ が決めたか」1 つだけ(§1.1 — 環境フラグを新設しない)。**
「GitHub Pages かどうか」を検出する第二の信号は作らない。`reachSolution.kind !== 'solved'`
という**既存の唯一の事実**をそのままゲートに使う。GitHub Pages は単にこの条件が恒常的に
真になる環境というだけで、ローカルの `pnpm dev:stack` で `robot.kinematics` が UR 形状で
ないロボットを使った場合も同じ枝に自然に乗る(一貫した一般化であり特別扱いではない)。

**D4. 書き手は増やさず、唯一の入口の引数を拡張する(原則 #4 は不動)。**
`RobotStageSet.previewSolution(robotId, joints|null)`(ADR-135 D3/D4 で確定した唯一の入口)
は削除・複製せず、第二引数を `{ authority: 'solved'|'approximate', joints } | null` へ拡張する
形で近似を受け付ける。表示材質・色などの**視覚差(演出)の書き手はこのメソッド 1 箇所のまま**
— `authority` に応じてゴースト調(破線・低彩度・キャプション)を出し分けるのもここでのみ行う。
呼び出し側(`GraspController._syncArmPreview`)は `solved` → D1 済みの経路(無改変)、
`undeclared` → D1 の近似探索、を切り替えて渡すだけ。

**D5(明示的にやらないこと)。** UR 解析的 IK の JS 移植(却下案 B)。`core/`+BFF の外部
ホスティング(却下案 C、排他ではないが別 ADR)。近似結果を `ikSolvable` チップや
`reachSolution` へ昇格させること、あるいは近似の存在を理由に `mocks/graspStub/` 自体を
「解けたことにする」よう書き換えること(スタブは「IK を解いていない」という事実を今後も
正直に `undeclared` で返し続ける — ADR-135 が守った「誰も決めていない腕を捏造しない」を
近似導入後も維持する)。

## Consequences — Evidence と tradeoff(§1.2 Evidence)

**肯定的:**
- GitHub Pages のデモで腕がまったく動かない、という Goal 未達の状態を解消できる —
  追加インフラ費用ゼロで実現できる(却下案 C と違い常時稼働サーバが要らない)。
- 新しい解法ロジックを一切書かない。ADR-053 がすでに正当化・実装した FK サンプリングの
  **消費先を変えるだけ**なので、「`src/` は解法を持たない」境界を一度も越えない。
- 型分離(D2)により、近似結果が契約の `reachSolution` に構造的に混入できない — 将来の
  実装者が「動くから」と近似値を `solved` として送り返すような取り違えを型が防ぐ。

**受け入れるコスト / 否定的:**
- 近似はサンプリング分解能に依存する粗い配置で、特異点・自己干渉・障害物干渉は一切考慮しない。
  「本物っぽく見えて実は違う」状態は原則 #11 に反するリスクがあるため、実装時は視覚的に
  明確な区別(色・破線・キャプション「未検証の概算」等)を D4 の唯一入口に必ず持たせる必要が
  ある — これを怠ると近似が権威を騙る事故になる。
- サンプル探索は `MAX_SAMPLE_CONFIGS` 有限個からの最近傍選択なので、許容誤差を満たす配置が
  無ければ **何も表示しない(rest のまま)** ことを明示的に選ばなければならない。「とりあえず
  一番近いものを出す」という無言のフォールバックは禁止(原則 #11)。
- `RobotStageSet.previewSolution` の引数形状が変わるため、既存呼び出し箇所・テストの更新が
  要る(ただし書き手の数は増えない — D4)。

**検証(証拠):** 論証木は `docs/gsn/adr-144-an-approximate-preview-is-not-a-second-solver.gsn`
(goal ごとの支えの正本はそちら)。本 ADR は Proposed であり、以下は実装 PR で閉じる予定の
検証(現時点では全て未来形):

- `reachSolution.kind === 'solved'` のとき近似探索が一切呼ばれないことのユニットテスト(D3)。
- 近似結果の形が契約の `reachSolution` スキーマに対して ajv 上 invalid になることのテスト
  (D2 の型分離が構造的に効いていることの機械的証拠 — 「別の名前を使った」という主張だけでは
  弱く、実際にスキーマが拒否することを焼く)。
- 許容誤差を超えたら `null`(rest のまま)になることのテスト(原則 #11 のフォールバック禁止)。
- `RobotStageSet.previewSolution` が引数拡張後も唯一の書き手であることの確認(ADR-135 D3 の
  性質が壊れていないこと)。
- `pnpm test:contract` が無改変で green のまま(D2 — 契約に一切触れていないことの証拠)。

**波及(blast radius):** 新設: FK サンプリングを転用する純粋モジュール(`src/robotics/`
配下、THREE-free)。変更: `src/controller/GraspController.js`(`_syncArmPreview` に
`undeclared` 枝を追加)、`src/view/RobotStageSet.js`(`previewSolution` の引数形状拡張と
`authority` に応じた視覚出し分け)。**触らない**: `packages/grasp-contract/*`・`core/*`・
`server/*`・`mocks/graspStub/*`(スタブは `undeclared` を返し続ける — 正直さを変えない)。

**状態台帳(核 §1.4):** 実装コミットで `docs/STATE_LEDGER.md` の「腕が描く関節配置
(骨格プレビュー)」行を更新する必要がある(ADR-135 が確定した `rest`/`preview` の 2 値に、
`preview` 側の権威サブ次元 `solved`/`approximate` が乗る形になる見込み)。ADR のみの本セッション
では台帳は編集しない(核 §4 — 状態の権威更新はコードと同じコミットで行う)。

## Lens notes

- **§1.1 真実の源は一つ**: 却下案 B を退けた理由はまさにこれ — UR の解析解を Python と JS の
  2 か所に書けば、同じ計算に 2 つの源ができる。ADR-127 が `core/` に確定した唯一の計算者を
  複製しない。
- **原則 #2 型は能力の契約**: 近似結果を `kind` ではなく `origin` という別の判別子・別の形で
  表すことで、フラグや同名キーでの取り違えを構造的に防ぐ。
- **原則 #4 表示状態の書き手は一つ**: `RobotStageSet.previewSolution` の引数を拡張するだけで、
  2 つ目の書き手は作らない。
- **原則 #11 無言の失敗禁止**: 許容誤差を超えた近似は「一番近いものを出す」ではなく明示的に
  「無い」を返す。
- **原則 #29(ワイヤは厳格・クライアントは演出)**: 近似はどこまでも「クライアントの演出」に
  留め、契約(ワイヤ)には一切追加しない — ADR-0005/060 の統治をそのまま踏襲。
- **層 + 契約(§1.3)**: 変更は `src/` の内側だけに閉じることを図(mermaid)で確認した。
  ADR-053 がすでに切っていた「front 側の測定器レーン(近似・非権威)」を一段拡張する形で、
  新しい境界を作らずに既存の decide/propose の動詞境界(ADR-056/077)へ素直に合流させた。
