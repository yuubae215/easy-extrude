# Integration — 環境判断・組み込み・性能・a11y

## 1. 実装環境フローチャート

```
要素<50 かつ DOMレイアウトと連動        → CSS/WAAPI (micro-2d.md)
線・形状そのものの変形、液体的融合       → SVG (canvas-svg.md)
粒子50–5000、軌跡、加算合成             → Canvas 2D (canvas-svg.md)
画像/画面全体の歪み・遷移、粒子>5000    → WebGL 板ポリ (shader-2d.md)
3D形状、カメラ、ライティング            → three.js (three-3d.md)
```

迷ったら軽い方 (上) を選ぶ。CSSで達成できる表現にWebGLを持ち出さない —
維持コストと初期化時間が跳ね上がる。逆に Canvas 2D で1万粒子は選定ミス。

## 2. 環境別テンプレ

### A. スタンドアロン HTML / Claude Artifacts

```html
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"></script>
```

**r128 の制約**: `CapsuleGeometry` なし (r142+) → Cylinder/Sphere/TorusKnot で代替。
OrbitControls はグローバル `THREE.OrbitControls`。ES modules 版と混在させない。
EffectComposer 系も examples/js 版が必要 (無ければフェイクブルームへ)。

React Artifact 内では OrbitControls import 不可 → ポインタで自前オービット、
または autoRotate をカメラ円軌道 (`cos/sin(t)`) で再現。

### B. モダン three (npm / importmap)

`three/addons/` から OrbitControls・EffectComposer・UnrealBloomPass を import。
書き味は同じだが r150+ では `outputColorSpace = THREE.SRGBColorSpace` を明示。

### C. React Three Fiber

```jsx
const uniforms = useMemo(() => ({ uProgress: {value:0}, uTime: {value:0},
  uBaseColor: {value: new THREE.Color(base)}, uGlowColor: {value: new THREE.Color(glow)} }), []);
useFrame((state, delta) => {
  matRef.current.uniforms.uProgress.value = progressRef.current; // refで受ける
  matRef.current.uniforms.uTime.value = state.clock.elapsedTime;
});
```

- uniforms を render ごとに再生成しない (`useMemo` 依存配列は空)
- progress を React state で毎フレーム更新しない (再レンダー地獄)。
  ref 経由で更新し、UI表示だけ throttle した state に
- 色変更は `uniforms.uGlowColor.value.set(hex)` (オブジェクト差し替え不可)

### D. CSS のみ (ライブラリゼロ)

進行度契約は CSS カスタムプロパティで実現:

```css
.fx { --p: 0; opacity: var(--p);
      transform: translateY(calc((1 - var(--p)) * 24px)); }
```

`el.style.setProperty('--p', v)` を rAF で easing しながら書く。
`@property --p { syntax: '<number>'; }` 登録で transition 直接適用も可 (対応環境)。

## 3. アニメーションループの責務分離 (全環境共通)

```javascript
const clock = { last: performance.now() };
let progress = 0, dir = 1, isPlaying = true;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - clock.last) / 1000, 0.05); clock.last = now; // スパイク防止
  if (isPlaying) {
    progress += dt * speed * dir;
    if (progress >= 1) { progress = 1; dir = -1; }
    if (progress <= 0) { progress = 0; dir = 1; }
  }
  fx.setProgress(progress);   // ①エフェクト同期
  fx.update(dt);              // ②uTime・パルス減衰
  ui.sync(progress);          // ③ゲージ・%表示 (DOM書き込みはここに集約)
  render();
}
```

イベントリスナーは状態変数を書くだけ (single source of truth)。
スライダー値を毎フレーム parse しない。タブ非表示時は dt クランプで暴走を防ぐ
(長時間なら `visibilitychange` で一時停止)。

## 4. リサイズ (モバイルで潰れる事故の回避)

```javascript
function onResize() {
  const { width, height } = container.getBoundingClientRect(); // window基準にしない
  camera.aspect = width / height; camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 200));
setTimeout(onResize, 100);          // レイアウト確定前の0px計測対策
```

コンテナに CSS `min-height` 必須 (例 `h-[45vh] min-h-[320px]`)。
`renderer.setPixelRatio(Math.min(devicePixelRatio, 2))` (フルスクリーン板ポリは1.5可)。

## 5. 破棄 (SPA/React では省略不可)

```javascript
function dispose() {
  cancelAnimationFrame(rafId);
  window.removeEventListener('resize', onResize);
  scene.traverse(o => { o.geometry?.dispose();
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
      m?.dispose(); Object.values(m ?? {}).forEach(v => v?.isTexture && v.dispose()); });
  });
  renderer.dispose(); controls?.dispose();
}
```

ジオメトリ切替時 (形状ボタン等) も旧 geometry を `dispose()`。
attribute を追加した geometry (particles) は切替のたび再生成。

## 6. 性能予算

| 項目 | 予算 |
|---|---|
| CSSアニメ対象プロパティ | transform / opacity / filter のみ。`will-change` は動く直前に付け終わったら外す |
| DOM同時アニメ要素 | ~50。超えるなら Canvas へ |
| Canvas 2D 粒子 | desktop 4000 / mobile 800 |
| WebGL 粒子 (Points) | 頂点流用 3千–1万は無風。10万超は attribute+GPU計算前提 |
| フルスクリーンfragment | fbm オクターブ4まで、texture2D 6回/px 目安 |
| draw call | ヒーロー演出で <60。群体は InstancedMesh 必須 |
| `discard` 多用シェーダー | 単一ヒーローは無問題。複数体・全画面は注意 (early-Z 無効) |

## 7. GLSL の落とし穴 (実戦で踏んだものを蓄積)

- **予約語を変数名に使わない**: WebGL1では通るのにWebGL2(GLSL ES 3.0)で
  コンパイルエラーになる語がある。特に踏みやすいのは
  `active` `filter` `input` `output` `common` `partition` `sample` `buffer` `shared`
  `resource` `precision` `smooth` `flat` `patch`。
  演出系で使いたくなる名前ばかりなので、`flashAmt` `blurAmt` `inputUv` のように
  修飾を付けて回避する。three.js はWebGL2優先でコンテキストを取るため必ず顕在化する。
- サンプラー(`sampler2D`)は三項演算子・関数引数の動的分岐に使えない。
  両方サンプルして `mix()` するか、UVオフセット側に条件を畳み込む。
- `if (x) discard;` 多用は early-Z を無効化する (性能予算表参照)。
- 整数除算・`%` はGLSL ES 1.0に無い。`mod()` と `floor()` で書く。
- ループ回数は定数のみ (ES 1.0)。fbm のオクターブは `const int` で。

## 8. アクセシビリティ (省略不可)

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

```javascript
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
if (reduced) { isPlaying = false; progress = 1; fx.setProgress(1); } // 完成状態で静止
```

- 移動・ズーム・視差・点滅 → 停止 or 200ms クロスフェードに置換
- 3D演出は「実体化済みの静止画 + autoRotate停止」を代替とする
- 明滅系 (glitch等) は 3回/秒 を超える点滅を出さない (光感受性発作対策)
- 装飾 Canvas/SVG には `aria-hidden="true"`、意味を持つなら `role="img"` + label
