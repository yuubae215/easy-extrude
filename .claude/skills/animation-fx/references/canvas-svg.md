# Canvas 2D & SVG — 有機的・生成的な2D表現

DOMでは重い/表現できない領域。粒子・軌跡・流体風・線画・形状モーフを扱う。

## Canvas 2D セットアップ定石

```javascript
const dpr = Math.min(devicePixelRatio, 2);
function fit() {
  const { width, height } = canvas.parentElement.getBoundingClientRect();
  canvas.width = width * dpr; canvas.height = height * dpr;
  canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   // 以降は CSS px で描ける
}
```

## 1. パーティクルシステム (基準実装)

構造: プール (固定長配列 + 使い回し)、`update(dt)` と `draw()` の分離、
経過は必ず `dt` ベース (フレームレート非依存)。

```javascript
class Particle {
  spawn(x, y) {
    this.x = x; this.y = y;
    const a = Math.random() * Math.PI * 2, s = 40 + Math.random() * 160;
    this.vx = Math.cos(a) * s; this.vy = Math.sin(a) * s - 60;  // 上方バイアス
    this.life = this.maxLife = 0.6 + Math.random() * 0.9;
    this.size = 1 + Math.random() * 3;
  }
  update(dt) {
    this.life -= dt;
    this.vy += 220 * dt;                    // 重力
    this.vx *= Math.pow(0.4, dt);           // 空気抵抗 (指数減衰、dt非依存)
    this.vy *= Math.pow(0.6, dt);
    this.x += this.vx * dt; this.y += this.vy * dt;
  }
  draw(ctx) {
    const t = this.life / this.maxLife;     // 1→0
    ctx.globalAlpha = t * t;                 // easeInで消える
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size * (0.5 + t * 0.8), 0, 7);
    ctx.fill();
  }
}
```

**クールの鍵**:
- `ctx.globalCompositeOperation = 'lighter'` (加算合成) で光の重なりを作る
- 残像: 全消去せず `ctx.fillStyle='rgba(7,10,19,0.18)'; ctx.fillRect(...)` で薄塗り
  → トレイルが自動的に生まれる (背景色と合わせること)
- サイズ・寿命・速度は必ず乱数幅を持たせる (均質=バニラ)

## 2. フローフィールド (流れ場) — マクロ寄りの有機表現

数千点をノイズ由来のベクトル場に従わせる。simplex/perlin が無くても
サインの合成で十分に有機的:

```javascript
function field(x, y, t) {
  const a = Math.sin(x * 0.006 + t * 0.3) + Math.cos(y * 0.008 - t * 0.2);
  return a * Math.PI;                        // 角度場
}
// update: 角度 θ = field(p.x, p.y, t) に向けて速度をゆっくり回頭
p.vx += Math.cos(th) * 30 * dt; p.vy += Math.sin(th) * 30 * dt;
```

残像塗り (上記0.06〜0.1程度の薄さ) と 1px の `lineTo` 描画で「絹糸」になる。
画面外に出た粒子はランダム位置に再スポーン。粒子数はデスクトップ 2000–4000、
モバイル 800 目安。

## 3. Canvas テキスト分解/集合 (2D版パーティクル・アセンブル)

`ctx.fillText` → `getImageData` でアルファ>128 の画素を 3–4px 間引きでサンプル →
各点をターゲットとするパーティクルに `mix(random, target, ease(lp))`。
3D版 (three-3d.md) と同じ「頂点ごと遅延 + smoothstep着地」契約を使う。
ロゴ画像でも同じ手法が使える (drawImage → getImageData)。

## 4. SVG — 線画・モーフ・グーイ

### パス描画 (draw-on)

```javascript
const len = path.getTotalLength();
path.style.strokeDasharray = len;
path.style.strokeDashoffset = len;
path.animate([{strokeDashoffset: len}, {strokeDashoffset: 0}],
  { duration: 1200, easing: 'cubic-bezier(0.16,1,0.3,1)', fill: 'forwards' });
```

複数パスは長さ比例の duration + スタッガーで「手描き感」。
描画ヘッドに `<circle>` を `getPointAtLength(len * p)` で追従させ発光させると格段に映える。

### 形状モーフ

`d` 属性のアニメは**アンカー数が一致するパス同士のみ**補間可能。
一致しない場合は多い方に合わせてダミーアンカーを挿入するか、flubber系の
補間ロジックを小さく自前実装。CSS `d: path("...")` 補間は対応環境なら最短。

### グーイフィルタ (メタボール風融合)

```html
<filter id="goo">
  <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="blur"/>
  <feColorMatrix in="blur" mode="matrix"
    values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -9" result="goo"/>
  <feComposite in="SourceGraphic" in2="goo" operator="atop"/>
</filter>
```

円が近づくと液体のように融合する。ナビ展開、ローダー、液体ボタンに。
stdDeviation とアルファ行列の `19 -9` が粘度パラメータ。

### タービュランスによる歪み

`<feTurbulence baseFrequency="0.015 0.03" numOctaves="2">` + `<feDisplacementMap scale="S">`
の `S` を 0↔30 でアニメすると「電波の乱れ」「水面」になる。
baseFrequency を `<animate>` でゆっくり変えると常時ゆらめく。

## 5. Canvas と DOM の使い分け

| 条件 | 選択 |
|---|---|
| 要素 < 50、レイアウトと連動 | DOM (micro-2d.md) |
| 粒子 50–5000、軌跡・加算合成 | Canvas 2D |
| 粒子 > 5000、画像の画素操作、3D | WebGL (shader-2d.md / three-3d.md) |
| 線画・形状そのものの変形、フィルタ | SVG |
