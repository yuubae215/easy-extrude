# Motion Language — 動きの共通言語

すべてのエフェクトの土台。数式は easings.net 準拠(検証済み)。

## 1. イージングカタログ

JS実装 (そのままコピー可能):

```javascript
const PI = Math.PI, c1 = 1.70158, c3 = c1 + 1, c4 = (2 * PI) / 3;
const Ease = {
  outQuad:  x => 1 - (1 - x) * (1 - x),
  outCubic: x => 1 - Math.pow(1 - x, 3),
  outQuint: x => 1 - Math.pow(1 - x, 5),
  outExpo:  x => x === 1 ? 1 : 1 - Math.pow(2, -10 * x),
  inExpo:   x => x === 0 ? 0 : Math.pow(2, 10 * x - 10),
  inOutCubic: x => x < 0.5 ? 4*x*x*x : 1 - Math.pow(-2*x + 2, 3) / 2,
  outBack:  x => 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2),   // オーバーシュート
  outElastic: x => x === 0 ? 0 : x === 1 ? 1 :
    Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * c4) + 1,            // バネ
  inOutSine: x => -(Math.cos(PI * x) - 1) / 2,
};
```

CSS `cubic-bezier` 等価 (よく使うもの):

| 用途 | 関数 | CSS |
|---|---|---|
| UI応答の基本 | outCubic | `cubic-bezier(0.33, 1, 0.68, 1)` |
| キビキビ着地 | outExpo | `cubic-bezier(0.16, 1, 0.3, 1)` |
| 弾む登場 | outBack | `cubic-bezier(0.34, 1.56, 0.64, 1)` |
| 退場 | inCubic | `cubic-bezier(0.32, 0, 0.67, 0)` |
| 往復・ループ | inOutSine | `ease-in-out` で近似可 |
| CSS spring風 | — | `linear()` 関数でバネ波形をサンプル列挙 (modern browsers) |

GLSL では `p = 1.0 - pow(1.0 - p, 3.0);` (outCubic) と
`smoothstep(0.0, 1.0, p)` を基本形とする。

### 選定原則

- **登場・応答 = out系** (最初速く、最後ゆっくり)。人は開始の速さを「反応の良さ」と感じる。
- **退場 = in系** (加速して去る)。out系で退場させると未練がましく見える。
- **属性で使い分ける**: 位置は outExpo でキビキビ、スケールは outBack で弾み、
  opacity は outQuad で控えめ、と**同一要素でも属性ごとに変える**とリッチになる。
- **elastic/bounce は1画面1箇所まで**。多用すると玩具っぽくなる。

## 2. 時間スケール (Duration)

| スケール | 時間 | 例 |
|---|---|---|
| 即時フィードバック | 80–150ms | ボタン押下、トグル |
| マイクロ遷移 | 150–300ms | ホバー、ツールチップ、フォーカスリング |
| 要素の入退場 | 250–500ms | モーダル、トースト、カード |
| 画面遷移・メゾ振付 | 400–800ms | ページ遷移、リストのスタッガー全体 |
| マクロ演出 | 1.2–3s | ヒーロー実体化、シーントランジション |
| アイドルループ | 2–6s周期 | 浮遊、呼吸、シマー |

原則: **距離・面積が大きいほど長く、頻度が高い操作ほど短く**。
ユーザー操作を待たせる演出(ローディング以外)が 500ms を超えたらスキップ手段を用意。

## 3. コレオグラフィ (振付)

### スタッガー — 最重要技法

複数要素は同時に動かさない。基本形:

```javascript
items.forEach((el, i) => {
  el.style.transitionDelay = `${i * 40}ms`;         // 等間隔: 30–60ms/要素
});
// 上級: 減衰間隔 (最初は速く、後半詰める) — 大量要素でだれない
const delay = i => 200 * (1 - Math.pow(1 - i / n, 2));
// 空間基準: 中心やクリック点からの距離で遅延 (波紋状に伝播)
const delay = el => dist(el, origin) * 0.8; // ms/px
```

GLSL では頂点/タイルごとの hash を遅延に使う:
`float lp = clamp((uProgress - aDelay * 0.3) / 0.7, 0.0, 1.0);`
(全体進行 p から局所進行 lp への再マップ。この「0.3/0.7 分割」パターンは頻出)

### 予備動作・追従・セトル (ディズニー12原則の実装形)

- **Anticipation**: 大きく動く前に逆方向へ 3–5% 沈む (`scale 1→0.96→1.05→1`)
- **Follow-through**: 本体停止後、子要素(影・光・パーティクル)が 100–200ms 遅れて止まる
- **Settle**: 着地後の減衰振動。`x(t) = target + A * e^(-6t) * sin(12πt)` か outElastic で代替
- **Overlap**: 位置・回転・不透明度の開始/終了をずらす (すべて同時に始めない)

### シーケンス設計テンプレ (マクロ演出)

```
0%      トリガー (フラッシュ/音的アクセント: 1フレームの輝度スパイク)
0–15%   予備動作 (収縮・チャージ発光)
15–75%  主動作 (スタッガー付き本体変化)
75–95%  減速着地 (outExpo域)
95–100% セトル + 余韻 (パーティクル散り、リム光の減衰)
```

## 4. 揺らぎ (Idle / Organic motion)

静止禁止原則の実装。決定論的で位相の異なる正弦合成が基本:

```javascript
// 要素 i のアイドル: 周期と位相を要素ごとに変える
y = Math.sin(t * 0.8 + i * 1.7) * 4 + Math.sin(t * 1.3 + i * 0.9) * 2; // px
```

2つ以上の非整数比周波数を合成すると「ループ感」が消える。
GLSLなら `noise(vec3(pos * 0.5, uTime * 0.2))` での変位が同等。

## 5. prefers-reduced-motion

振付を設計したら必ず静的代替も設計する。移動・ズーム・視差・点滅を止め、
クロスフェード(opacityのみ、200ms程度)には置き換えてよい。実装は integration.md §a11y。
