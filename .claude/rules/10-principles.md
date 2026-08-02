# 設計原則ダイジェスト (crystallized principles)

<!--
配置: グローバル版 ~/.claude/rules/10-principles.md / ポータブル版 <repo>/.claude/rules/10-principles.md
このコメントは context 注入前に除去される。
-->

実運用の証拠から一般化された設計法則。核(方法)とは別レーンの **結晶化した原則**(核 §4)。
- **系譜:** 正本(全文・事例・Yellow Cards)は原産リポジトリの `docs/PHILOSOPHY.md` 系譜に住む。
  canonical が運ぶのはこのダイジェストのみ — 導出物であり第二の源ではない(§1.1)。
  原則の追加・改稿は **正本 → ダイジェスト → canonical** の順。番号は正本と一致させる。
- **各リポジトリでの写像:** 原則→自リポジトリの固有名詞の対応は、各リポジトリが
  「§このリポジトリでの写像」節を**ローカルに追記**する(canonical へは持ち出さない)。
- **スコープ注記:** Interaction / UI の節(12–16, 22, 26, 27, 30)は空間・対話 UI を持つ
  プロジェクト向け。該当しないプロジェクトでは適用外として読み飛ばしてよい(削除はしない —
  番号の正本一致を保つ)。

## Design
1. **One Authoritative Entry Point** — 重要な状態遷移・不変条件維持の入口はちょうど一つ (公開 API)。内部手続きの直接呼び出しによるバイパス禁止。
2. **Type Is the Capability Contract** — 実体の能力分岐は型で行う。プロパティ値・文字列タグ・フラグで分岐しない。
3. **Pure / Side-Effect Separation** — 純粋計算と副作用を一つの関数に混ぜない。
4. **Every Visual Flag Has One Owner** — 各表示状態の書き手はちょうど一箇所。複数経路からの代入は最後の書き込み勝ちの競合を生む。
5. **Events, Not References** — 表示・入力層はドメインイベントを購読する。モデルへの逆参照・ポーリング禁止。
6. **Transformations Return New Instances** — 変換動詞は新実体を返し、源を変異しない (undo/redo が自然に成立する)。
25. **Guard Logic in Named Predicates** — ドメイン前提条件は名前付きの述語 (サービス層) に集約。ハンドラ内のインライン早期 return は host 環境の回避策にのみ許可。
30. **Motion Tier** — 動きは Fact (結果の証明) / Affordance (操作可能性) / Delight (歓び) のいずれかを実装前に宣言。役割を偽る動きと無統治 (所有者・予算・削減経路なし) の動きだけが不採用。motion 削減設定の読み取り境界は一箇所。

## Concurrency
7. **Locking Strategy Before Code** — optimistic (応答性優先・非ブロック) か pessimistic (整合性優先・ブロック) かを実装前に決める。場当たり混在は UI 凍結か無言のデータ破損を生む。
8. **Await at Its Layer** — 非同期呼び出しはその層で完結させる。未解決の結果 (Promise 等) をデータとして下流に通さない。
24. **Derive from Invariant Sources** — 周期計算の導出値を同じ計算の入力に戻さない。連続量なら閉路は誤差を毎周期蓄積し (エラーフィードバックループ)、離散判断なら分岐の間で振動する。**書き込みではなく周期で更新されるキャッシュはこの閉路の辺**であり、しかも読みの鮮度が実体種で変わるとコードを読んでも見えない。

## Memory / Lifecycle
9. **Symmetric Alloc/Dealloc** — 資源の確保と解放は同じモジュールに対で書き、同じコミットで入れる。
10. **Delete Softly, Dispose Late** — undo 生存が要る削除は不可視化で保持し、実解放は履歴スタックが手放すときに行う。

## Errors
11. **No Silent Failures** — ブロックされた操作は必ずユーザーに提示する。無言の no-op は禁止 (「入力は消費されたのに何も起きない」が最悪の失敗形)。

## Interaction
12. **One Continuous Gesture** — 主要な空間操作は一つの途切れないジェスチャで完結させる。多段のボタン列に分解しない。
13. **Touch Has No Hover** — タッチはホバーを経由しない。押下前の hover 状態を仮定せず、押下時点で再ヒットテストする。
14. **Disable Shared Controls Only on True Conflict** — 共有ナビゲーション操作を無効化してよいのは、同一の入力ジェスチャを完全消費する操作の間だけ。
22. **Narrower Scope Wins in Hit-Testing** — ヒットテストはユーザーが狙う最小スコープ優先 (子を親より先に)。ツールギズモは無関係実体の選択を遮らない。

## UI
15. **Fixed Slots** — 状態によって UI 要素を削除・移動しない。使えない操作は disabled + placeholder で位置を保つ。
16. **Discovery Is a Deliverable** — 二次操作は文脈ジェスチャ (long-press 等) で発見させる設計を成果物として扱う。
26. **A Screen Edge Is a Shared Resource** — 画面端に固定される要素は端を占有する。占有オフセットは全占有状態から一箇所で計算する (呼び出し箇所ごとのパッチ禁止)。
27. **Screen-Space Size, World-Space Cap** — オーバーレイマーカーの寸法は「画面 px 目標 + シーン由来の world 上限」の対で決める。どちらか単独は鏡像の同一バグ。

## Contracts
17. **Complete Polymorphic Interfaces** — 多態的に呼ばれるメソッドは全実装型に存在させる (no-op 可)。欠落は入力ハンドラを無言で中断させる。
18. **Emit the Event, Then Swap** — 標準経路外の実体置換でも、対応するライフサイクルイベント (削除→追加) を必ず発行する。
21. **Coordinate Spaces Statically Distinguished** — 座標空間 (Local/World 等) は型・API 形状で静的に区別する。命名規約やレビューに頼らない。
23. **Accessors Own Freshness** — 導出状態のアクセサは自身で鮮度を保証する。呼び手に事前 refresh を要求する規約は N-1 箇所で破られる。
28. **Mutual = Round-Trip Up to Normal Form** — 多対一の相互変換に逆写像の同一性を求めない。商・正規形を名指しし、その上の fixpoint / 同型で検証する。
29. **Rigor on the Wire, Play in the Client** — ワイヤ (API・ファイル形式・DSL) は閉じた版付き契約で「決定された事実」のみ運ぶ。演出・提示はクライアントで導出し、契約に足さない。全ワイヤは「契約あり」か「明示的対象外宣言」の二状態のみ。
31. **Zero Is a State That Does Not Look Like One** — `mode`/`status` は値を持つ欄なので状態として認識されるが、基数 (0 個・N 個) には欄が無い。不在は検査対象のノードを持たないため、*在るもの*を辿る検査は必ず素通りする。**必要な種別を列挙して個数を検査**し、正当な 0 は推論させず**宣言**させる (既定値で埋めない / 台帳の基数列を空にしない)。同型が一段上にもある: 種ごとの既定表は**未宣言の種で throw** する (fall-through は「宣言された既定」と「誰も考えなかった種」を区別不能にする = *決定*の不在)。

## Living Docs
19. **Documentation Drift Is a Bug** — バグ修正・設計判断のたび、欠けていた暗黙ルール/理由をルール台帳・ADR・原則集に反映してから commit する。
20. **Narrow Focus Beats Broad Scans** — 検証エージェントには小さな名前付きファイルリストを渡す。広域スキャンは注意を薄める。

---

## §このリポジトリでの写像 (canonical へは持ち出さない)

本リポジトリが**原産** — 上の「系譜」が指す正本は同一 repo 内の `docs/PHILOSOPHY.md`。

- #1: `setMode()` / 集約の公開 pose API (`restorePose`/`move`/`rotate`) / 選択の公開 verb (`SelectionManager.selectOnly` ほか — ADR-099)
- #2: `instanceof Solid` 等 (JS 実行時型)
- #14: OrbitControls
- #24: pose を計算する側の入力 = セグメント開始の写し + 要求 delta。禁じられた形 (live プローブ / `_worldPoseCache`) の個数を問う所 = `src/PosePolicyOwnership.test.js` の `POSE_COMPUTING_METHODS` × `LIVE_PROBES` (ADR-101)
- #18: `objectRemoved`/`objectAdded`
- #19: ルール台帳 = `docs/CODE_CONTRACTS.md` (+ `docs/code_contracts/*.md`)、原則集 = `docs/PHILOSOPHY.md`
- #30: motion 削減境界 = `src/theme/motion.js`、transient 所有者 = `MotionGovernor`
- #31: 基数の累積器 = `docs/STATE_LEDGER.md` の基数列 (核 §1.4)、機械側の問い所 = `pnpm test:gsn` (支えの無い goal) と `src/RobotRosterAuthority.test.js` / `src/domain/robotFrames.test.js` (0 台のロボット — ADR-090) と `src/view/MapVisualMath.test.js` (N 個の注釈が同位相 = lockstep — ADR-093。1 と N は別世界で、設計されていたのは片方だけだった) と `src/PosePolicyOwnership.test.js` (pose を書く入口の個数 — ADR-097。規則を持つ経路ではなく**持たない経路**が欠陥だったので、実装を読んでも見えない) と `src/SelectionOwnership.test.js` (選択を書く入口の個数 — ADR-099。窓は 5 つに見えて実は undo コールバックの中に 4 つ複製されており、*窓*を辿る数え方では出てこなかった) と `src/controller/SelectionManager.test.js` (文脈可視性の**強度**の上界 = `FULL(claim) === 選択集合` — ADR-099。1 個で書いた強度規則を N へ持ち込んだ形で、`4N` と `N` は N=1 で一致するので 1 個の fixture では区別不能。回帰は N=25 を焼く) と `src/theme/tokens.test.js` (**宣言の外にある色の個数** — ADR-100。数えるべきは在るトークンではなく *宣言されていない* hex で、在るものを辿る検査は定義上それを見ない。選択を描く窓も *窓*を辿ると 6 つ、**種類を列挙**すると 9 つだった) と `src/CensusCoverage.test.js` (**列挙表そのものの個数** — ADR-102。原則 #31 の道具が 6 ファイル 15 表に増え、*表*を辿る数え方では「表の外に最初から在ったもの」が出てこなかった。母集団を持たない表 = `place-list` を**語彙から消す**ことで、次の place-list を書けなくする。数えるべきは表の行ではなく *表が覆えていない* 個数で、母集団は呼び出し閉包・token の消費者・const の構文から**導出**する — 人の記憶が母集団の権威でなくなる)。と `src/ProjectionAxisOwnership.test.js` (**退役した形の個数** — ADR-103。`DS_PENDING` が廃止後も 3 リリース enum に残ったように、退役の腐敗は違反を*見逃す*のではなく **緑を出す**。だから消したこと自体を数える。同ファイルは投影を書く入口の個数も問う — かつてそれは「モード」という名前で 3 つの軸を 1 変数に潰していた)。と `scripts/check-adr-status.mjs` (**段を持たない ADR の個数** — 起票済み ADR を辿っても順序表の段を辿っても、*無い段*は出てこない。ADR-107 は帰結として起票されたのに順序表のどこにも現れないまま commit された。母集団は「順序表と同じディレクトリを参照している ADR」という構文から導出する)。未宣言の種で throw する表 = `EXPLICIT_DEFAULTS` (ADR-096) / `PLACEMENT_BY_KIND` (ADR-097) / `SUPPORT_SURFACE_BY_KIND` (ADR-102 — 載る側の鏡像)。**正当な非ゼロを宣言させる予算** = ratchet のベースライン (ADR-100 — 「宣言外は 0 であるべきだが今は 203 色ある」を隠さず定数にし、超えても下回っても fail させる)
