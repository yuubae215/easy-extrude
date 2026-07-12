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
| **ミクロ** (単一要素、<600ms、操作への応答) | ボタン/ホバー/リップル/トグル/ローダー/トースト/文字送り → `references/micro-2d.md` | 単一オブジェクトの浮遊・回転・ホバー反応 → `references/three-3d.md` §micro |
| **メゾ** (コンポーネント群、リスト、画面内遷移) | スタッガー入場/FLIP/View Transitions/SVG描画・モーフ/Canvasパーティクル → `references/micro-2d.md` + `references/canvas-svg.md` | インスタンシング群体、テキスト3D化 → `references/three-3d.md` §instancing |
| **マクロ** (画面全体、ヒーロー演出、シーン遷移) | フルスクリーンシェーダートランジション/画像ディストーション/グリッチ → `references/shader-2d.md` | 実体化・消滅・召喚/カメラ演出/ポスプロ → `references/three-3d.md` + `references/postfx-scene.md` |

**全セル共通で最初に読む**: `references/motion-language.md`
(イージング・時間設計・振付=コレオグラフィの共通言語。ここを飛ばすとバニラになる)

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
4. **文脈の同時設計** — エフェクト単体で浮かせない。2Dなら背景・影・ぼかしの連動、
   3Dならフォグ・床・ダスト・リムライト (postfx-scene.md の4点セット)。
5. **停止状態を作らない** — 待機中もアイドルモーション(呼吸するようなスケール、
   微小な浮遊、シマー)を仕込む。ただし `prefers-reduced-motion` では静的代替に切替。

## Step 3: 共通インターフェース契約

すべてのエフェクトは正規化された進行度 `p ∈ [0,1]` を入力とする純関数的設計にする。
- 2D: `applyProgress(p)` / CSS はカスタムプロパティ `--p` 経由
- GLSL: `uniform float uProgress`(+揺らぎ用 `uTime`)
- 逆再生 (`1-p`) で消滅/退場になるよう対称に設計する
- 再生制御(自動往復・スライダー・スクロール連動)はエフェクト本体から分離する

これにより「スクロール駆動に変えたい」「ボタン起動にしたい」が差し替えだけで済む。

## Step 4: 完成チェックリスト

- [ ] 品質ゲート5条件をすべて満たしている
- [ ] `prefers-reduced-motion: reduce` で本質機能が保たれる(integration.md §a11y)
- [ ] CSSアニメは transform/opacity/filter のみ(レイアウトプロパティを動かしていない)
- [ ] Canvas/WebGL は devicePixelRatio 対応 + `getBoundingClientRect` リサイズ
- [ ] デモには進行度スライダー or トリガーボタンがあり、0↔1 を何度でも再現できる
- [ ] 色は3色システム(背景/実体/発光)で、発光色の変更が全要素に連動する
- [ ] 破棄処理がある(rAFのcancel、geometry/material/テクスチャのdispose、listener解除)

## reference 一覧

| ファイル | 内容 | 読むタイミング |
|---|---|---|
| `references/motion-language.md` | イージング全カタログ(数式付き)、時間スケール、スタッガー振付、予備動作/追従/セトル | **常に最初** |
| `references/micro-2d.md` | CSS/WAAPIマイクロインタラクション、spring近似、FLIP、View Transitions、テキスト演出 | 2Dミクロ〜メゾ |
| `references/canvas-svg.md` | Canvas2Dパーティクル/トレイル/フローフィールド、SVG線画・モーフ・グーイ | 2Dメゾ、有機的表現 |
| `references/shader-2d.md` | フルスクリーンGLSL: gl-transitions式トランジション、画像歪み、2Dディゾルブ/グリッチ、ノイズ関数集 | 2Dマクロ |
| `references/three-3d.md` | 3D実体化6種(scan/dissolve/particles/wireframe/glitch/hexgrid)、カールノイズ粒子、インスタンシング、頂点変位、カメラ振付 | 3D全般 |
| `references/postfx-scene.md` | シーンドレッシング、配色プリセット、Bloom/フェイクブルーム、グレイン/収差/ビネット | 3Dおよびシェーダー2Dの仕上げ |
| `references/integration.md` | 環境判断フローチャート、CSS/WAAPI/Canvas/three(r128・modern)/R3Fテンプレ、性能予算、a11y、破棄 | 実装開始前 |
