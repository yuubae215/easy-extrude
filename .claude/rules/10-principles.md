# 設計原則ダイジェスト (PHILOSOPHY → kernel 統合, 2026-07-19)

これは `docs/PHILOSOPHY.md`(**正本**)の蒸留ダイジェスト — **導出物**であり第二の源ではない
(核 §1.1)。全文・事例・Yellow Cards・Index は正本を読む。原則の追加・改稿は正本 → 本ファイル
の該当行の順で行う。番号は正本と一致。

本文は **プロジェクト不変の語彙**で書く(canonical bundle へそのまま持ち出せる形)。
このリポジトリ固有の固有名詞・ファイルは末尾「§このリポジトリでの写像」にのみ置く。

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
24. **Derive from Invariant Sources** — 周期計算の導出値を同じ計算の入力に戻さない。導出→入力の閉路は誤差を毎周期蓄積する (エラーフィードバックループ)。

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

## Living Docs
19. **Documentation Drift Is a Bug** — バグ修正・設計判断のたび、欠けていた暗黙ルール/理由をルール台帳・ADR・原則集に反映してから commit する。
20. **Narrow Focus Beats Broad Scans** — 検証エージェントには小さな名前付きファイルリストを渡す。広域スキャンは注意を薄める。

---

## §このリポジトリでの写像 (canonical へは持ち出さない)

- #1: `setMode()` / 集約の公開 pose API (`restorePose`/`move`/`rotate`)
- #2: `instanceof Solid` 等 (JS 実行時型)
- #14: OrbitControls
- #18: `objectRemoved`/`objectAdded`
- #19: ルール台帳 = `docs/CODE_CONTRACTS.md` (+ `docs/code_contracts/*.md`)、原則集 = `docs/PHILOSOPHY.md`
- #30: motion 削減境界 = `src/theme/motion.js`、transient 所有者 = `MotionGovernor`
