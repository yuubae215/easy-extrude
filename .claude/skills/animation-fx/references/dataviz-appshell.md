# Dataviz & App Shell — 業務UIの振付

ダッシュボード、管理画面、開発ツールなど「情報密度の高いUI」の入場・遷移・
インタラクション。派手さではなく**構造の理解を助ける動き**が目的。
装飾過多は業務UIでは逆効果 — 品質ゲートは満たしつつ、振幅は控えめに。

## 1. アプリシェルの入場オーケストレーション

原則: **各領域は「自分が属する方向」から入る**。ヘッダーは上から、フッターは下から、
左右サイドバーはそれぞれの側から、メインコンテンツはフェードアップ。
方向が意味を持つので、全部フェードインで済ませない。

```css
.shell { transition: transform .6s cubic-bezier(0.16,1,0.3,1), opacity .45s ease-out; }
.from-top{transform:translateY(-102%);opacity:0} .from-left{transform:translateX(-102%);opacity:0}
.ready .shell { transform:none; opacity:1; }
/* 領域間は80-100msずつずらす: header→left→right→footer */
.ready #lside { transition-delay:90ms; } .ready #footer { transition-delay:260ms; }
```

シーケンス標準形 (合計~1.2s、体感は速い):

```
0ms     シェル骨格 (header/sidebars/footer が滑り込む、90ms間隔)
~340ms  メニュー項目スタッガー (45ms/項目、translateX -14px→0)
~480ms  メインのカード群フェードアップ (90ms/カード)
~700ms〜 カード内コンテンツ (グラフ・チャート・ツリー) が各自の振付を開始
```

再入場 (Replay/ルート遷移) は `.ready` を外し **強制reflow (`void el.offsetHeight`)**
を挟んでから付け直す。これを忘れると transition が発火しない。

メニューの選択インジケータは `::before` の縦バーを `scaleY(0→1)` outBack で。
項目間の移動は FLIP かインジケータ要素の `translateY` 追従 (micro-2d.md)。

## 1b. レスポンシブ・シェル (モバイルは振付の対象が変わる)

固定幅サイドバーをモバイルにそのまま持ち込むと**メインが潰れる**。レイアウトと振付は
セットで切り替える:

- **モバイル (~1023px)**: サイドバーは `position:fixed` のドロワー化 (幅 `min(78vw, 280px)`)
  + バックドロップ (黒55% + 軽blur、opacityのみのtransition)。メインは全幅。
  ヘッダーにトグル (☰ / 通知アイコン) を出す。
- **入場振付から除外**: ドロワーは「入場時に閉じている」のが正しい状態。
  `.ready .shell { transform:none }` が閉状態を上書きして勝手に開く事故に注意 —
  サイドバーの振付ルールは `@media (min-width:1024px)` 内に置き、モバイル側は
  id セレクタで閉状態を定義する (詳細度で上書きを防ぐ)。
- **開くたびに中身を再スタッガー**: ドロワー open 時に項目を WAAPI で
  `translateX(∓14px)→0` 40ms間隔、`fill:'backwards'` (delay中の初期状態を保証)。
  CSSクラス方式だと2回目以降に発火しないため、開閉はWAAPIが確実。
- 片方を開くときはもう片方を閉じる。バックドロップタップで全閉。
- 検証はDevToolsのモバイル幅だけでなく**実機の縦画面比率**で行う
  (グラフのviewBox縮小によるラベル可読性もここで確認)。

## 2. ノードグラフ (SVG)

### 出現の3段振付

1. **ノード**: `transform-box:fill-box; transform-origin:center` を付けた `<g>` を
   scale 0→1.12→1 の pop で。**遅延はグラフの深さ (トポロジカル順) に比例**させる —
   データの流れる方向に出現が伝播し、構造が読める。
2. **エッジ**: 接続元ノードの出現後に stroke-dash 描画 (canvas-svg.md §4)。
   直線でなく水平ベジェ `M ax ay C mx ay, mx by, bx by` (mx=中点) で結ぶ。
3. **フローパーティクル**: エッジ描画完了後、`path.getPointAtLength(len * t)` で
   小さな発光ドットを流す (t += dt*speed, mod 1)。端では `min(t, 1-t)*8` で
   フェードさせ出入りを柔らかく。速度は edge ごとに乱数幅を。

### インタラクション: 依存ハイライト

hover したノードに**接続するエッジを hot (発光色・太く)、無関係を dim (opacity .15)**。
逆の発想 (関係あるものを光らせるだけ) より、無関係を沈める方が視認性が高い。
ノード側も同様に dim。transition .25s で出入りとも滑らかに。

## 3. チャート

### バーチャート

`<rect>` に `transform-box:fill-box; transform-origin:bottom` を与え
`scaleY(0→1)`、outBack、50–60ms スタッガー。**height をアニメしない**
(scaleYはコンポジタ完結、heightはSVG再計算)。グラデ塗り (`<linearGradient>` 縦) と
hover の `filter:brightness(1.4)` で仕上げ。

### ラインチャート

折れ線は stroke-dash 描画 (1000–1200ms, outExpo系)。3点セットで質が跳ねる:
1. **先端ドット**: 描画進行に合わせ `getPointAtLength` で発光ドットが線を先導
2. **エリアの追い焚き**: 塗り (`fill:url(#grad)` 縦フェード) は線の完了間際に
   opacity 0→1 (overlap原則)
3. イージングは線とドットで同じ関数を使い同期させる

### 数値カウンター (KPI)

`Math.round(target * easeOutExpo(p))` のロールアップ、800–1000ms。
`toLocaleString()` で桁区切り。増減の差分更新は前回値からの補間にする。

### 値の更新 (静的入場後)

データ更新時は再入場アニメを繰り返さない。バーは scaleY の差分 transition (300ms
outCubic)、ラインは path morph (アンカー数固定なら d 補間可)、カウンターは差分ロール。

## 4. 階層図 / ツリー

- 遅延は **表示順 + 深さの複合**: `delay = base + i*55ms + depth*40ms`。
  親→子の順に開いていく感覚が出る。
- 各行は translateX(-10px)→0 + フェード (インデント方向と逆から入れない)。
- 接続線は等幅フォントの `│ ├─ └─` で十分実用。SVG化するなら線も dash 描画。
- 展開/折りたたみ: 子要素の height アニメは grid-template-rows `0fr→1fr` 技法
  (`.wrap{display:grid;transition:grid-template-rows .35s} .inner{overflow:hidden}`)
  が transform 縛りの唯一の例外として許容。行自体はスタッガー付きフェード。

## 5. この領域固有の注意

- **SVG要素のCSS transform には `transform-box: fill-box` が必須** (無いと原点が
  SVG左上になり scale が吹き飛ぶ)。最頻出の事故。
- アニメ対象ノードは ~200個まで。それ以上のグラフは Canvas/WebGL 描画に切替。
- 業務UIは繰り返し見られる。入場演出は**初回とReplayのみ**にし、ルーティング内の
  再訪では短縮版 (シェル省略・コンテンツのみ 300ms) を用意する。
- スクロールで現れるカードは IntersectionObserver + 同じ `.go` クラス設計で
  トリガーだけ差し替える (進行度契約)。
- 数値・ラベルは動いている間も読めること。テキスト自体を回転・拡縮しない。
