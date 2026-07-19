---
name: animation-fx
description: >
  Design and build production-quality 2D & 3D animation effects at every scale — from micro
  UI interactions (buttons, hovers, loaders, toasts, text reveals) to macro hero scenes
  (WebGL shader transitions, particle systems, 3D materialization, cinematic camera work).
  Covers CSS/WAAPI, Canvas 2D, SVG, fullscreen GLSL shaders, and Three.js/R3F. Use this
  skill WHENEVER the user asks for any animation, transition, motion, or visual effect —
  "アニメーション", "エフェクト", "動きをつけて", "かっこよく", "ヌルヌル動く", "演出",
  "トランジション", "パーティクル", "実体化", "出現/消滅", hover effects, loading states,
  page transitions, scroll effects, particles, glitch, dissolve, hologram — even if they
  just say "make it feel alive" or "add some polish". Linear tweens and vanilla opacity
  fades are forbidden by this skill; consult it before writing ANY animation code.
---

# Animation FX — 2D/3D・ミクロ/マクロ統合エフェクト設計

UIのホバー1つから、フルスクリーンWebGL演出までを同じ品質基準で作るためのスキル。
easings.net / gl-transitions / LYGIA / three.js examples の設計を下敷きにしている。

## Step 1: スケール × 次元 でルーティング

まず要求を下の行列に置き、該当セルの reference を読む。**複数セルにまたがる案件は
両方読む** (例: ヒーロー3D + UIコントロールパネル → three-3d.md と micro-2d.md)。

|  | **2D** | **3D** |
|---|---|---|
| **ミクロ** (単一要素、<600ms、操作への応答) | ボタン/ホバー/リップル/トグル/ローダー/トースト/文字送り → `references/micro-2d.md`。**ヒット/斬撃/衝撃波/ダメージ数字などゲームフィール → `references/game-vfx.md`** | 単一オブジェクトの浮遊・回転・ホバー反応 → `references/three-3d.md` §micro |
| **メゾ** (コンポーネント群、リスト、画面内遷移) | スタッガー入場/FLIP/View Transitions/SVG描画・モーフ/Canvasパーティクル → `references/micro-2d.md` + `references/canvas-svg.md`。**ノードグラフ/チャート/階層図/アプリシェル(header/footer/sidebar/menu)の入場振付 → `references/dataviz-appshell.md`** | インスタンシング群体、テキスト3D化 → `references/three-3d.md` §instancing |
| **マクロ** (画面全体、ヒーロー演出、シーン遷移) | フルスクリーンシェーダートランジション/画像ディストーション/グリッチ → `references/shader-2d.md` | 実体化・消滅・召喚/カメラ演出/ポスプロ → `references/three-3d.md` + `references/postfx-scene.md` |

**全セル共通で最初に読む (この順で)**:
1. `references/principles.md` — **抽象レイヤー**。媒体非依存の12原則 (P1-P12) と
   双方向対応表。設計は必ず「要求→原則→実装」の順で降りる。
2. `references/motion-language.md` — 共通語彙 (イージング・時間・振付)。

**具体レイヤー**: `examples/` に原則注釈付きの完成サンプル3本
(blade-trail=2Dゲーム / metamorph=3Dシェーダー / appshell-dataviz=業務UI)。
新規実装の出発点として読み、冒頭コメントの原則マップで principles.md へ戻れる。

**実装環境の選定と定石**: `references/integration.md`
(CSSで足りるか / Canvasか / WebGLか の判断基準、環境別テンプレ、性能・後始末・a11y)

## Step 2: アンチバニラ品質ゲート (交渉不可)

「動いてはいるが安い」を防ぐ5条件。完成前に全てを満たすこと:

1. **linear 禁止** — すべての補間に意図したイージングを与える。UI応答は easeOut系、
   退場は easeIn系、往復は easeInOut系、物理感は spring/back/expo。根拠は motion-language.md。
2. **一斉動作の禁止** — 複数要素は必ずスタッガー(時間差)か位相ずらし。
   粒子・文字・リストアイテムが同時に動いた瞬間、既製品感が出る。
3. **境界と余韻の演出** — 状態が切り替わる「境目」こそ主役。エッジ発光、オーバーシュート、
   着地後のセトル(微振動の減衰)、残像・トレイルのどれかを入れる。
4. **文脈の同時設計** — エフェクト単体で浮かせない。2Dなら背景・影・ぼかしの連動。
   3Dは postfx-scene.md の**アトモスフィア・メニュー(Void Grid/Studio/Horizon/
   Nebula/Blueprint/Abyss)から題材に合わせて選ぶ**。フォグ+グリッドを無思考の
   デフォルトにしない — 全作品が同じテイストになるのは品質ゲート違反。
5. **停止状態を作らない** — 待機中もアイドルモーション(呼吸するようなスケール、
   微小な浮遊、シマー)を仕込む。ただし `prefers-reduced-motion` では静的代替に切替。

## Step 3: 共通インターフェース契約

すべてのエフェクトは正規化された進行度 `p ∈ [0,1]` を入力とする純関数的設計にする。
- 2D: `applyProgress(p)` / CSS はカスタムプロパティ `--p` 経由
- GLSL: `uniform float uProgress`(+揺らぎ用 `uTime`)
- 逆再生 (`1-p`) で消滅/退場になるよう対称に設計する
- 再生制御(自動往復・スライダー・スクロール連動)はエフェクト本体から分離する

これにより「スクロール駆動に変えたい」「ボタン起動にしたい」が差し替えだけで済む。

## Step 3.5: 抽象と具体の行き来 (このスキルの使い方そのもの)

- **下り (設計)**: 要求を原則の言葉に翻訳してから実装を選ぶ。
  例:「削除に手応え」→ P4境界+P6時間操作+P2余韻 → shatter + stop + 火花のうねり。
- **上り (学習)**: 参考資料・偶然の発見・エラーは、まず「原則レベルで何が新しいか」を
  特定してから principles.md に還元する (既存原則への具体化行の追加 or P13〜の新設)。
  必ずデモで検証してから書く。
- **両面説明 (納品)**: 成果物は「どの原則を、どの実装で具体化したか」を抽象・具体の
  両レベルで説明する。原則名はユーザーとの共通語彙になる。
- 迷ったら examples/ の注釈ヘッダを見る — 原則⇔コードの対応が実物で確認できる。

## Step 4: クリエイティブ・パートナーシップ (振る舞いの原則)

実装屋ではなくアニメーションのプロとして振る舞う。開発中にユーザーの提案・感想・
偶然の発見 (バグの副産物が面白い見た目になった等) が出たら、受動的に反映するだけで
なく**積極的に膨らませる**:

1. **核の言語化** — その提案の何が効いているのかを一言で特定する
   (「境界の明滅が"不安定さ"を演出している」等)。
2. **2方向の展開を具体で提示** — 堅実案 (既存の質を上げる延長) と大胆案
   (演出の構造ごと変える飛躍) を、実装イメージが湧く粒度で1つずつ。
3. **品質ゲートで統合** — 膨らませた案も5条件と a11y を満たす形に落とす。

ネガティブな感想 (「単調」「安っぽい」) は最高の入力。原因をゲート違反として
特定し、対処をその場のパッチで終わらせず設計原則に昇格させる。

**このスキル自身が成長対象である。** 持ち込み資料・エラー・偶然の発見・新カテゴリは
`references/evolution.md` の成長プロトコル (入口→分類フロー→昇格基準→検証義務→
健全性予算→系譜) を通してスキル本体に還元する。成長の全履歴は
`references/changelog.md` にあり、矛盾解決の一次資料になる。追加だけでなく
廃止も同じ真剣さで行う (予算超過はスキルの死)。

## Step 5: 完成チェックリスト

- [ ] 品質ゲート5条件をすべて満たしている
- [ ] アトモスフィアを題材から選んだ (直前の作品と同じ組合せになっていない)
- [ ] GLSL予約語 (`active` `filter` `input` `output` 等) を変数名に使っていない (integration.md §7)
- [ ] `prefers-reduced-motion: reduce` で本質機能が保たれる(integration.md §a11y)
- [ ] CSSアニメは transform/opacity/filter のみ(レイアウトプロパティを動かしていない)
- [ ] Canvas/WebGL は devicePixelRatio 対応 + `getBoundingClientRect` リサイズ
- [ ] モバイル縦画面で確認した: 固定幅サイドバー等はドロワー化しメインを全幅に (dataviz-appshell.md §1b)
- [ ] デモには進行度スライダー or トリガーボタンがあり、0↔1 を何度でも再現できる
- [ ] 色は3色システム(背景/実体/発光)で、発光色の変更が全要素に連動する
- [ ] 破棄処理がある(rAFのcancel、geometry/material/テクスチャのdispose、listener解除)

## reference 一覧

| ファイル | 内容 | 読むタイミング |
|---|---|---|
| `references/principles.md` | **抽象レイヤー**: 12原則カタログ + 原則⇔実装の双方向対応表 + 行き来の作法 | **常に最初** |
| `examples/*.html` | **具体レイヤー**: 原則注釈付き完成サンプル (2Dゲーム/3Dシェーダー/業務UI) | 新規実装の出発点 |
| `references/evolution.md` | **成長プロトコル**: 知見の入口→分類→昇格基準→検証義務→健全性予算→矛盾解決→廃止 | 知見をスキルに還元する時 |
| `references/changelog.md` | 成長の系譜 (v1.0〜)。何がきっかけで何が生まれたかの一次資料 | 矛盾解決・経緯確認時 |
| `references/motion-language.md` | イージング全カタログ(数式付き)、時間スケール、スタッガー振付、予備動作/追従/セトル | **常に最初** |
| `references/micro-2d.md` | CSS/WAAPIマイクロインタラクション、spring近似、FLIP、View Transitions、テキスト演出 | 2Dミクロ〜メゾ |
| `references/canvas-svg.md` | Canvas2Dパーティクル/トレイル/フローフィールド、SVG線画・モーフ・グーイ | 2Dメゾ、有機的表現 |
| `references/game-vfx.md` | インパクトの解剖学(6層)、ヒットストップ、trauma式シェイク、ズームパンチ、斬撃アーク/衝撃波/スパーク/ダメージ数字 | ゲーム、ガチャ演出、攻撃感のあるUI |
| `references/dataviz-appshell.md` | アプリシェル入場オーケストレーション、ノードグラフ(深さ伝播pop+エッジ描画+フロー粒子)、バー/ライン/KPIカウンター、階層ツリー | ダッシュボード・業務UI |
| `references/shader-2d.md` | フルスクリーンGLSL: gl-transitions式トランジション、画像歪み、2Dディゾルブ/グリッチ、ノイズ関数集 | 2Dマクロ |
| `references/three-3d.md` | 3D実体化6種(scan/dissolve/particles/wireframe/glitch/hexgrid)、カールノイズ粒子、インスタンシング、頂点変位、カメラ振付 | 3D全般 |
| `references/postfx-scene.md` | シーンドレッシング、配色プリセット、Bloom/フェイクブルーム、グレイン/収差/ビネット | 3Dおよびシェーダー2Dの仕上げ |
| `references/integration.md` | 環境判断フローチャート、CSS/WAAPI/Canvas/three(r128・modern)/R3Fテンプレ、性能予算、a11y、破棄 | 実装開始前 |
