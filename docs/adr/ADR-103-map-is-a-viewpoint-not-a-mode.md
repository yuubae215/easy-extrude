# 103. Map はモードではなく視点 — 台帳の負債 #1 を「禁止」ではなく「再分類」で閉じる

- Status: Accepted (実装済み — 2026-08-02)
- Date: 2026-08-02
- Deciders: yuubae215, Claude
- Supersedes / Superseded by: なし (ADR-031 の Map Mode を再分類する)

## Context — Goal と力学 (§1.2 Goal)

**Goal:** 「モードの権威が二つある」状態を閉じる。ただし**不正状態を禁止するのではなく、
そもそも不正でなかったことに気づく**形で閉じる。

### 力学 — 台帳が自分で書いていた負債

`docs/STATE_LEDGER.md` §既知の負債 #1:

> **モードの権威が二つある。** `STATE_TRANSITIONS.md` §Top-level Modes は OBJECT / EDIT / MAP を
> 対等な 3 モードとして描くが、実装は `SceneModel._selectionMode` (2 値) と
> `MapModeController.state.active` (boolean) の直積。`edit` かつ `mapMode.active` は型として
> 表現可能で、これを禁じているのは遷移経路の慣習だけ。**3 値の enum 一つに畳めば**
> 不正状態が表現不能になる (§1.4)。

台帳の処方は「**畳んで禁止する**」だった。しかしこの処方には副作用がある —
畳むと **`edit` かつ真上から見る**が表現不能になる。それは実際には**やりたい操作**である
(平面配置を編集しながら歪みのない真上のビューで確認する)。

つまり欠陥は「2 つの変数が直積になっていること」ではなく、その一段上にある:

> **ビューのパラメータ (カメラの向き・投影) を、モードとしてモデル化したこと。**

論理の誤分類なので、物理側 (enum) で畳むと**誤分類が固定される**。核 §0「論理 → 物理の順」。

### 証拠 — カメラの入口は既に存在していた

`src/view/GizmoView.js:57`:

```js
this._canvas.setAttribute('aria-label',
  'World orientation gizmo: click an axis to snap the camera')
```

軸ギズモは既にクリックで視点スナップを持ち、ADR-068 で interruptible な eased flight まで
実装済み。**旧 Map モードのカメラは最初からギズモの中にあった** — Map モードは
「住所の要る機能」ですらなく、**既存コントロールの重複**だった。

同様に、Map で描く実体は既に通常のオブジェクトとして扱われている
(`src/controller/AppController.js:1813-1822` — `_updateLinkNetwork` は `scene.objects` 全件を
走査し、`AnnotatedLine` / `AnnotatedRegion` / `AnnotatedPoint` をノード種別として同じ
関係グラフに流し込む)。専用の置き場は最初から不要だった。

## Decision

**Map をモードから降ろし、3 つに分解して既存の棚へ戻す。**

| 旧 Map モードの構成要素 | 新しい住所 | 根拠 |
|---|---|---|
| 上からの正射カメラ | **軸ギズモ** (既存。Z 軸クリック) | 入口は既にあった。冗長な導線は高頻度操作にのみ許される |
| 投影方式 (正射 / 透視) | ギズモ隣の**小さなトグル** | 向きと**直交する**ビュー設定 (Fusion 360 / Onshape と同形) |
| Lynch 5 種の描画ツール | **「置く」グループ** (`+ 追加`) | 他のオブジェクトと同じ扱い |
| `Annotated*` 実体 | **通常のオブジェクト** | 実装は既にそうなっていた |

削除に際して**何も足さない**。`MapModeController.state.active` は消滅し、
`edit` × 真上から見るは**正当な組み合わせ**になる。

### 残るもの

`MapModeController.state.drawState` (`idle` / `drawing`) は**ツールの状態**として残る
(描画ジェスチャ中かどうか)。これはカメラともモードとも直交し、Sketch 描画と同じ位相にある。

## Consequences

**得るもの**

- **状態が 1 つ消える。** 不正状態 `edit ∧ mapMode.active` は禁止されるのではなく
  **表現する対象が無くなる**。§1.4「make illegal states unrepresentable」を、
  ガードではなく分類で達成する。
- **編集しながら真上から見られる。** 台帳の処方では失われていた操作が残る。
- 概念が増えない。3 つの構成要素はすべて**既存の棚**に収まる (原則 #10「モードが概念を減らすことがある」)。

**払うもの / 必須の随伴作業**

- `docs/STATE_LEDGER.md` — 「マップモード」行の削除、既知の負債 #1 を閉じる、
  「投影方式」行の追加 (2 状態・基数 1・権威はビュー)。
- `docs/STATE_TRANSITIONS.md` §Map Mode の改稿 (トップレベルモードは OBJECT / EDIT の 2 値へ)。
- `docs/SCREEN_DESIGN.md` S-14 / S-15 / S-16 の改稿 (画面ではなく**視点 + ツール**として書き直す)。
- `docs/LAYOUT_DESIGN.md` — Map Mode toolbar (`left:188px`, z:150) の削除。
  左端の共有資源が 1 つ空くので、Link Network / Tour カードの占有計算も見直す (原則 #26)。
- 既存の `?map` 系の入口・キーバインドがあれば、視点プリセットへの読み替え。

**未解決**

- Lynch 描画ツールは真上からでないと実質描けない。**ツール選択で視点を自動的に倒すと、
  それは裏口から復活したモード**になる。倒さない (ユーザーが自分でギズモを押す) を
  既定とするが、描きにくさが実測で問題になったら再検討する。

## 実装ノート (2026-08-02)

決定どおりに実装した。俯瞰の時点で見えていなかった点だけ記す (食い違いは隠さない — 原則 #19):

- **正射カメラは「切り替える」のではなく「導出する」形になった。** 起票時の想定は
  「投影方式をトグルで持つ」までで、ortho カメラ自身の姿勢を誰が持つかは書いていな
  かった。透視カメラ + `controls.target` から毎フレーム導出する形にしたので、ortho
  側に保存された姿勢も独立ズームもパンオフセットも存在しない = **ドリフトする対象が
  無い** (原則 #24)。副産物として orbit / dolly / pan / ピンチが両投影でそのまま効き、
  ADR-072 の出入りフライトと `_stagedPos` 外部書き込みガードは*不要になって*消えた。
- **消えた状態は 5 つ** — `active` / `frustumSize` / pan / pinch / `_savedView`。
  「削除に際して何も足さない」と書いたが、実際には**足さないどころか減った**。
- **`SceneStage.setFogSuspended()` も退役。** 旧 ortho カメラが固定 ~100 units 上空に
  居たことへの対処だったので、眼点が透視と同じになった時点で対象が消えた。
- **`DS_PENDING` を同時に削除** (台帳 §既知の負債 3)。退役した状態が enum に残る腐敗は
  *違反を見逃す* のではなく **緑を出す**ので、`RETIRED_MODE_SHAPES` として個数で数える
  形に降ろした (ADR-100 の `RETIRED_SELECTION_COLORS` と同形)。
- **未解決だった「ツール選択で視点を倒すか」は倒さないまま。** 実測で問題になったら
  再検討する、を維持している。

## References

- `docs/STATE_LEDGER.md` §既知の負債 1
- ADR-031 (Map Mode の導入) / ADR-073 (`pending` 廃止) / ADR-093 (Map 注釈の視覚言語)
- ADR-068 (ギズモの eased flight) / ADR-008 (モード遷移の状態機械)
- ADR-104 (所有権・提案・証憑 — 同じセッションの IA 再設計)
- `docs/ia-redesign/easy-extrude-wireframe-v3.html` 注釈⑧ (この判断の設計根拠)
