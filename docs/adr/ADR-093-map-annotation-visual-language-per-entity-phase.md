# 093. Map 注釈の視覚言語を刷新 — アニメーションの位相を実体の同一性から導き、「基数 N の lockstep」を構造で消す

- Status: Accepted (実装済 — ADR-031 §8 のアニメーション表を置き換え。相互作用モデル §1-§7 は不変)
- Date: 2026-07-25
- Deciders: yuubae215, Claude (pairing)
- Supersedes / Superseded by: ADR-031 §8「Animations」を置き換える (ADR-031 の §1-§7 = 相互作用モデルは有効。ADR-066 Tier 分類と ADR-065 reduced-motion 境界を無改変で継承)
- 状態台帳: `docs/STATE_LEDGER.md` の「Map 注釈ビュー (motion)」行 (基数 `0..N` — **本 ADR の欠陥はこの列が空だったこと**)

## Context — Goal と力学 (§1.2 Goal)

要件はユーザの感想として来た: 「Map オブジェクトの見た目をもっとリッチにしたい。
他の見た目をアップグレードしたらマップが置いていかれた。シンプルでわかりやすくは
できていると思う。当時は感動したけど、今は他に見劣りする。」

解の形ではなく **感想** で来ているので、まず Goal へ持ち上げる:

- **G1 — 同一の品質基準**: Map 注釈が、ADR-065/066/067 以降に書かれた表面
  (`SceneStage` のダスト・グロー、`LandingEffects` の voxel 組み立て、
  `MapPreviewMath` の二周波ブリーズ) と *同じ運動語彙* で描かれること。
  「置いていかれた」の正体は主観ではなく、実装世代の差である。
- **G2 — 意味を変えないこと**: place type の意味 (Route=流路 / Boundary=障壁 /
  Zone=領域 / Hub=結節 / Anchor=基準) と違反アラーム (ADR-043) の読み取りを
  1 mm も変えない。リッチ化は Tier A/F の主張を上塗りしてはならない。
- **G3 — 退行しない a11y**: reduced motion で情報が消えないこと。

### 力学 — 「見劣り」の原因を原則で名指しする

`git log` が示す通り、Map 注釈 (ADR-029/031, 2026-04) は ADR-065 (motion 統治,
2026-07) より **3 か月古い**。差は好みではなく規律の有無だった:

| 症状 | 違反 | 実装上の事実 |
|------|------|-------------|
| 「機械っぽい」 | **P3 伝播** (一斉動作の禁止) | 全アニメの位相が生の `t` 由来 → **すべての Hub が同一フレームで ping し、すべての Zone が同位相で呼吸する** |
| 「安い」 | **P1 タメツメ** | sonar は `scale = 1 + phase*3`, `opacity = 1 - phase` の **linear** |
| 「浮いている」 | **P7 文脈の同時設計** | `SceneStage` は accent glow を背景・ダスト・リムライトで共有するが、注釈は加算合成に一切参加せず、しかも Map mode は fog 停止 (ADR-072) = アプリ内で最も平坦な画面 |
| 「死んでいる」 | **P8 生命感** | 全個体が同一パラメータ。ADR-031 §8 は Boundary を「No animation」と明記 |
| a11y 欠落 | **#30/#11** | 3 view とも `prefersReducedMotion()` を **見ていない** (ADR-065 以降の view は全て見る) |

## Decision

### D1 — 位相は実体の同一性から導く (核心)

新モジュール `src/view/MapVisualMath.js` (純粋・THREE 非依存・`node --test`) の
全フレーム関数が、実体ごとの `phase ∈ [0,1)` を引数に取る。`phase` は
`phaseFor(entityId)` = FNV-1a + fmix32 アバランチで、**同一性からのみ**導く。

なぜ同一性か: 幾何 (位置) から導くとドラッグ中に毎フレーム位相が飛び、名前から
導くとリネームで飛ぶ。id は `SceneService` が所有する唯一の安定同一性であり、
この関数は id を発明しない (§1.1)。id を持たない呼び出しは `phase = 0` に落ち、
単一実体のシーンは従来と同一に見える。

**これは装飾ではなく構造修正である。** lockstep は「1 個で試すと絶対に見えない」
欠陥で、まさに **原則 #31 (基数 0/N は状態だが状態に見えない)** の現れ。
アニメーションは 1 個の Hub に対しては正しく、N 個に対して壊れていた。

### D2 — 曲線は必ず 2 本以上、役割ごとに別のイージング

距離と α を別曲線にする (P1)。Hub ping = `easeOutCubic` 距離 × `(1-p)^3` α、
Zone rim = `easeOutCubic` × `(1-p)^2`、fill = `breathe()` (sin², ループ継ぎ目なし)、
entry = `easeOutBack` scale × `easeOutCubic` opacity。

**曲線の組み合わせは検証で決めた**: 最初の実装は `easeOutExpo` 距離 ×
`(1-p)^2.2` α で、リングが即座に最大半径へ達してそこで留まって褪せる = 4 個の
Hub が 4 つの巨大なグレーのドーナツになった (ブラウザで確認)。ping は
**小さいときに最も明るい**必要がある。§2 の Act → 再 Observe が効いた箇所。

### D3 — Blueprint アトモスフィアを Map mode に採る

`SceneStage` (ADR-067) が Void Grid 系 (fog + grid + dust) を占めているので、
Map mode = **製図台** として別の装置を選ぶ (同じ装置の無思考な再利用は品質ゲート
違反):

- Zone: 対角ハッチ層 (`DecalTextures.hatchTexture()`) がゆっくりドリフト。
  ハッチのピッチは **領域自身の bbox** から導く (`repeat = HATCH_LINES / extent`)
  ので、mm スケールのセルでも 100 m の site plan でも同じ見えになる (#27)。
- Zone: 各頂点に L 字のコーナー登録マーク。
- Boundary: 進行方向 +90° 側に垂直ハッチ tick。壁として読める。
- Anchor: 目盛り付き測量十字 + 45° datum square。
- Hub/Anchor: 加算合成の床グロー (プール) — `SceneStage` と同じ sprite レシピを
  共有し、注釈が「舞台に照らされている」ように見える (P7)。

fill の上限は ADR-031 §8 の 0.65 → 0.46 に **下げた**。ハッチと eased rim が
「領域」の読みを担うので、濃いウォッシュは下の幾何を隠すだけだった (P11 抑制)。

### D4 — Boundary の「静止」を撤回する

ADR-031 §8 は Boundary を意図的に無アニメとした (「barrier セマンティクス」)。
撤回する: 静止は障壁を意味せず、単に死んで見える (品質ゲート5)。代わりに
**crest が壁を伝わって tick を順に持ち上げる** — 空間スタッガー (P3) で、
1 tick あたり数値 1 つ、アロケーション 0 (頂点カラー属性の in-place 更新)。
tick の輝度は 0 にならない (0.25 が下限): ハッチは *情報* なので常に読める。

### D5 — Route の隊列は「速度差」ではなく「位置の揺らぎ」で崩す

comet head + テーパーする trail (余韻 P2) を 1 個の `InstancedMesh` (1 draw call)
で描く。隊列の崩し方は **検証で覆した**: 最初は head ごとに速度をずらしたが、
速度差は積分されるので 30 秒後には全 bead が 1 箇所に固まり Route の半分が空に
なった (ブラウザで確認)。位置に有界な wobble を掛ければ平均間隔は永久に均等な
まま、どの bead も名目位置に居ない。

### D6 — reduced motion は「静止した手掛かり」に落とす

各フレーム関数が `reduced` を受け、動きだけを落として **見えは保つ**
(パークしたリング / 凍結ハッチ / 中間帯の fill / 停止した bead)。読み取りは
単一境界 `src/theme/motion.js` から (view が `matchMedia` を直接読まない規律を継承)。

## Consequences

**Positive:**
- 「置いていかれた」の原因が主観ではなく実装世代差として特定され、閉じた。
- lockstep が構造的に不可能になった (位相が同一性由来なので、実体が増えるほど散る)。
- 3 view が初めて reduced-motion 境界に参加した (a11y の穴が閉じた)。
- ADR-067 の sprite レシピが `DecalTextures` に一本化された (第二の源の予防)。

**Negative / Trade-offs:**
- Zone あたり mesh が 2 枚増える (hatch + corner ticks)、Hub あたり 2 枚
  (halo + 2 本目の ring)。Route は逆に減った (6 mesh → 1 InstancedMesh)。
- `DecalTextures.radialSprite()` はモジュール所有のキャッシュで **dispose しない**
  (#9 に対する意図的な非対称)。色数で有界であり、そのことをモジュール冒頭に明記した。
- ADR-031 §8 の具体数値は歴史記述になった (§8 の表は本 ADR で置換)。

**Deferred:**
- Hub/Anchor の選択時 disclosure 強化 (現状は BoxHelper のまま)。
- 注釈の消滅演出 (`LandingEffects` の lifecycle レーンに載せる案) — 生成側の
  entry pop だけを先に入れた。P9 対称設計としては未完で、次の一手はここ。

## Evidence (§1.2 の鎖を閉じる)

- `src/view/MapVisualMath.test.js` (32 tests): lockstep 不能性 (兄弟 id の位相間隔
  > 1%)、**linear 禁止をアサート** (ping/rim の中点被覆率)、ループ継ぎ目の連続性、
  bead が線上に留まること、crest が壁を伝わり巻き回すこと、そして
  **`FRAME_FUNCTIONS` 表がモジュールの実 export を網羅していること** —
  reduced 分岐を忘れた新 export はテストが落とす (#31 の「種別を列挙して個数を検査」)。
- ブラウザ検証 (Playwright + Chromium, 1280×800, Hub×4 / Anchor×2 / Route /
  Boundary / Zone): 改修前は 4 個の Hub のリング半径が**完全に一致** (lockstep の
  実写)、改修後は 4 個すべて異なる半径。reduced motion では 0.9 秒離れた 3 フレームが
  **バイト一致** かつ全要素が可読 (#30/#11 の証拠)。
- `pnpm test` 771 pass / `pnpm typecheck` clean (`BootWiring` 含む)。
