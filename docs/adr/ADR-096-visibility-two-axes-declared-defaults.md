# 096. 可視性を「永続 (eye) × 文脈 (選択)」の直交 2 軸にし、既定を種ごとに宣言する — 目が開いているのに何も見えない状態を消す

- Status: Proposed
- Date: 2026-07-26
- Deciders: yuubae215, Claude (pairing)
- Supersedes / Superseded by: なし (ADR-087 の「eye が唯一の所有者」を CoordinateFrame へ拡張して完成させる)

## Context — Goal と力学 (§1.2 Goal)

当事者の観測:「エンプティレイアウトで、ロボットは最初不可視なんだけど、**tcp は目が
開いている**。しかしビューポートに表示はされていない。UI の選択と表示が合ってないのでは?」

合っていない。持ち上げた Goal:

- **G1 — UI が語る可視性は、実際の描画と常に一致する。** 行の eye は「今どうなって
  いるか」の忠実な表示であって、初期値の飾りではない (原則 #4 — 表示状態の書き手は
  ちょうど一箇所 / 原則 #23 — アクセサは自身で鮮度を保証する)。
- **G2 — トグルは必ず何かを変える。** eye を 1 回押して何も起きない状態が存在しない
  (原則 #11 — 入力が消費されたのに何も起きないのが最悪の失敗形)。

### 力学 — 現状の 2 経路と、行が持つ「種」

CoordinateFrame の軸の可視性には、互いを知らない**書き手が 2 つ**ある:

| 経路 | 書き手 | 寿命 | eye を読むか | eye を書くか |
|------|--------|------|-------------|-------------|
| 永続 | `OutlinerView` の eye → `AppController._setObjectVisible` → `SceneService.setObjectVisible` → `meshView.setVisible()` | 永続 | — | ○ (行の flag) |
| 文脈 | 選択 → `SelectionManager.showFrameChain` / `showGeometryFrameTree` / `hideFrameChain` → `meshView.showFull()` / `showDimmed()` / `hide()` | 選択が続く間 | ✕ | ✕ |

そして `CoordinateFrameView` は生成時 `this._group.visible = false` (「hidden until
explicitly shown」)、`OutlinerView._createRow` の行は `visible: true` を**ハードコードした
種**として持つ。行は view を一度も読まない。

観測された症状は、この 3 つの事実の合成として厳密に予測できる:

1. **起動直後、`tcp` 行の eye は開いているが軸は描かれていない。** 行の `true` は
   view から導出した値ではなく既定値だから。**行は最初から嘘をついている**
   (原則 #31 — 正当な 0 は推論させず宣言させる。ここは「既定値で埋めた」側の失敗)。
2. **その eye を 1 回押すと何も起きない。** ハンドラは `!item.visible` = `false` を送り、
   既に非表示のものを非表示にする。2 回目でようやく軸が出る (原則 #11)。
3. **`robot_base` 行の eye だけが閉じている。** ブート経路の `_hideRobotByDefault()` が
   ロボット 1 台につき **base フレームだけ**に `_setObjectVisible(id, false)` を打つから
   (ADR-089 follow-up: 空シーンに腕が 1 本立っているのはノイズ)。`tcp` は同じ「1 台の
   ロボット」の一部なのに、伏せる操作の対象になっていない。
4. **eye を開けても、別の実体を選択した瞬間に軸が消え、eye は開いたまま残る。**
   `hideFrameChain()` が `activeFrameChain` の全フレームに `meshView.hide()` を打ち、
   eye を読まないから。ADR-087 が「eye が唯一の所有者」と宣言した契約は、**スケルトンに
   ついてだけ**閉じており、CF 軸については成立していない。

### 位置

presentation / chrome 層の決定。ドメイン・契約・DSL には触れない (原則 #29)。
ADR-087 (可視性の所有者を Outliner eye へ)、ADR-094 (LINK NETWORK パネルの
`forceHidden × collapsed` 直交 2 軸) と同じ棚の決定であり、**ADR-094 で既に採った形を
CF 軸へ適用する**のが本 ADR の骨子。

## Options considered

- **A: 行の初期値を view から読む (`isVisible()` を生やす)** — tradeoff: 症状 1・2 は
  消えるが、書き手が 2 つある根 (症状 4) は残る。しかも行が view をポーリングする形に
  なり、選択のたびに行の glyph が点滅する。原則 #5 (Events, Not References) にも逆行。
- **B: 選択駆動の文脈表示を廃し、eye だけを唯一の所有者にする** — tradeoff: 症状は
  全部消えるが、「Solid を選ぶとその CF 軸が出る」という ADR-087 §G1 の視覚的裏づけ
  (キューブもロボットも同じ読み方) を失う。当事者が学習済みの主要な発見経路を壊す。
- **C: 直交 2 軸 + 既定の宣言 (採用)** — 可視性を `explicit` (ユーザー所有・永続) ×
  `contextual` (選択所有・一時) の 2 軸に分け、**実際の描画は 2 軸の合成を 1 箇所で
  計算する**。eye は `explicit` 軸だけを書き、選択は `contextual` 軸だけを書く。
  行の glyph は `explicit` 軸を忠実に表示する。CF の `explicit` 既定は**宣言して**
  `false` にする。tradeoff: 軸が 1 本増える (台帳の行が増える)。行の glyph が
  「今描かれているか」ではなく「常時表示を要求しているか」を意味するようになるので、
  文脈表示中の実体は「eye は閉じているが薄く見えている」状態を取りうる。
- **D: 現状維持** — tradeoff: G1/G2 とも未達。ADR-087 が宣言した所有権が CF について
  嘘のまま残る。

## Decision — Strategy (§1.2 Strategy)

**案 C。** ADR-094 が LINK NETWORK パネルに対して採った「ハンドラは**軸**を所有し、
ピクセルは所有しない」を CF 軸の可視性へ横展開する。

1. **2 軸を明示する。**
   - `explicit: boolean` — ユーザーが「常に見せろ」と言ったか。唯一の書き手は
     Outliner の eye (`AppController._setObjectVisible`)。永続 (シーンに残る)。
   - `contextual: 'full' | 'dimmed' | null` — 選択文脈が要求する一時表示。唯一の
     書き手は `SelectionManager` の frame-chain 系メソッド。選択が変われば消える。
2. **合成は 1 箇所。** `applyFrameVisibility(entityId)` が両軸を読んで
   `meshView` の可視性と不透明度を決める唯一の場所になる (原則 #4)。
   `SelectionManager` も `_setObjectVisible` も `meshView` を直接叩かない。
   描画規則: `explicit || contextual !== null` で表示、不透明度は
   `contextual === 'dimmed' && !explicit` のときだけ dimmed。
3. **既定を種ごとに宣言する (既定値で埋めない — 原則 #31)。**

   | 実体種 | `explicit` の既定 | 宣言の根拠 |
   |--------|------------------|-----------|
   | Solid / ImportedMesh / Annotated* / MeasureLine | `true` | 外形そのもの。見えないと存在が分からない |
   | CoordinateFrame (ユーザー CF・body frame・`tcp`) | **`false`** | 軸は文脈表示が既定。常時出すと空間がノイズで埋まる。ADR-087 で確立した「選択 → 接地 CF が出る」がまさに `contextual` 軸 |
   | CoordinateFrame (`robot_base`) — **ブート seed 由来** | **`false`** | 空シーンに腕 1 本はノイズ (ADR-089 follow-up)。今日 `_hideRobotByDefault()` が手続きで実現していることを、seed 側の**宣言**に降ろす |
   | CoordinateFrame (`robot_base`) — **`addRobot()` 由来** | **`true`** | ユーザーが今その操作をしたのだから、何も現れないのは原則 #11 |

   `robot_base` の 2 行が別値なのが重要: 既定は「種」ではなく「**どの入口から生まれたか**」で
   決まる。`ensureRobotFrames({ seed: true })` と `addRobot()` の区別は ADR-090 で既に
   存在するので、新しい概念は要らない — 既存の区別に既定を紐づけるだけ。
4. **`_hideRobotByDefault()` を削除する。** 3 の宣言に吸収されるので、ブート経路の
   手続き的な後始末が 1 つ消える (§1.1 — 同じ事実の第二の源を残さない)。
   同時に「ロボット 1 台 = base + tcp + スケルトン」を伏せる単位も揃う: `tcp` の
   `explicit` 既定が `false` になるので、症状 1 の「tcp だけ目が開いている」が
   **特別扱いなしに**消える。
5. **行の glyph の意味を明文化する。** eye = `explicit` 軸 (「常に見せる」)。
   文脈表示中であることは行では表さない (3D 側で既に dimmed + X-ray として見えている)。
   トグルは常に `explicit` を反転するので、必ず何かが変わる (G2)。

## Consequences — Evidence と tradeoff (§1.2 Evidence)

- **肯定的:**
  - G1 — 行の値が種ではなく軸そのものになるので、起動直後から嘘をつかない。
  - G2 — トグルは `explicit` を反転する = 必ず状態が動く。「1 回押しても何も起きない」が
    構造的に表現不能になる。
  - ADR-087 が宣言した「可視性の所有者は Outliner eye ちょうど 1 箇所」が、
    スケルトンだけでなく CF 軸についても真になる。
  - ブートの手続き `_hideRobotByDefault()` が消え、既定が seed 側の宣言 1 行になる。
  - 選択が変わっても、ユーザーが明示的に開いた軸は消えなくなる (症状 4)。
- **受け入れるコスト / 否定的:**
  - 状態が 1 実体につき 2 軸になる (台帳に行が増える)。平坦な 3 状態に畳む誘惑があるが、
    畳むと「文脈表示中にユーザーが明示表示を要求した」が表現不能になる — ADR-094 の
    `forceHidden × collapsed` を平坦化できなかったのと同じ理由。
  - eye が「今見えているか」ではなく「常時表示を要求しているか」を意味するので、
    文脈表示中は「閉じた eye の実体が薄く見えている」状態がありうる。これは仮説として
    GSN に立てる (反証されたら行に文脈表示のマークを足す方向で回収)。
  - シリアライズ範囲の判断が要る: `explicit` はシーン JSON に往復させるか。往復させると
    scene JSON にフィールドが 1 つ増える (presentation 状態をワイヤに載せる方向 —
    原則 #29 の観点では載せない側が既定)。**本 ADR では往復させない** (セッション内
    状態) と決め、要件が立てば別 ADR。
- **検証 (証拠):** 論証木は `docs/gsn/adr-096-visibility-two-axes.gsn` (goal ごとの
  支えの正本はそちら)。起票時点の証拠は**すべて未来形**であり、そう宣言している。
  実装時に閉じる予定の検査:
  - 純粋関数 `frameVisibility({explicit, contextual})` の真理値表テスト (2 × 3 = 6 通り
    全部)。合成が 1 箇所にあることの機械側の問い所。
  - ブート回帰: 起動直後に `explicit` が `true` の CoordinateFrame が **0 個**である
    こと (原則 #31 — 「在るもの」を辿らず種別を列挙して個数を検査する形)。
  - トグル回帰: 任意の実体で eye を 1 回押すと `explicit` が必ず反転すること。
  - 選択回帰: `explicit === true` の CF は、他の実体を選択しても描画され続けること。
- **波及 (blast radius):** `src/controller/SelectionManager.js` (frame-chain 系が
  `meshView` を直接叩くのをやめる)、`src/controller/AppController.js`
  (`_setObjectVisible` / `_hideRobotByDefault` 削除 / seed 側の宣言)、
  `src/view/OutlinerView.js` (行の flag が軸になる)、`src/view/CoordinateFrameView.js`
  (`showFull`/`showDimmed`/`hide`/`setVisible` の 4 入口 → 合成 1 入口)、
  `src/service/SceneService.js` (`setObjectVisible`)、`docs/STATE_LEDGER.md`
  (CF 可視性の行を新設 — 基数 `0..N`)。契約・DSL・ワイヤは無改変。

## Lens notes

- **§1.1 真実の源:** 「この軸は今描かれているか」の権威は合成関数ただ 1 つ。
  eye と選択はそれぞれ**入力軸**を持つだけで、ピクセルは持たない。
- **§1.4 状態機械:** 軸が 2 本 (boolean × 3 値 = 6 状態) だが、**遷移に guard が無く
  不正遷移も存在しない** (どの軸もいつでも独立に動ける) ため、状態機械の節は起こさず
  台帳の行 + 真理値表テストで閉じる。§1.4 の発動条件は「3 状態以上」だけでなく
  「不正遷移が事故になる」との論理和であり、後者が立たないケース。
- **原則 #31 の現れ方:** 本件の欠陥は「0 が状態に見えない」の**鏡像** — 行が既定値
  `true` で埋められていたために「まだ誰も何も言っていない」という状態が
  「見えている」と区別できなかった。基数の欄が空だったのと同じ失敗が boolean の
  既定値で起きている。

## References

- ADR-087 (CF 接地オブジェクトモデル + ロボット可視性を Outliner へ) — 「eye が唯一の所有者」の宣言。本 ADR はそれが CF 軸について未完だった部分を閉じる
- ADR-094 (LINK NETWORK を TF ツリーへ回帰) — `forceHidden × collapsed` の直交 2 軸 + 合成 1 箇所という、本 ADR が横展開する形の先例
- ADR-090 (ロボットの同一性を名前から実体へ) — `seed` 由来と `addRobot()` 由来の区別、および基数 N の fixture
- ADR-089 (起動ホーム画面) follow-up — 空シーンでロボットを伏せる既定の出どころ
- ADR-037 (Auto Origin Frame) — body frame も CoordinateFrame として同じ既定に従う
- PHILOSOPHY #4 (表示フラグの単一所有者), #11 (無言の失敗の禁止), #23 (アクセサが鮮度を所有), #31 (基数ゼロ / 既定値で埋めない)
