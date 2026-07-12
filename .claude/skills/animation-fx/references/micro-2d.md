# Micro 2D — CSS / WAAPI マイクロインタラクション

対象: 単一〜数十要素、<800ms、DOM上の演出。原則 **transform / opacity / filter のみ**を
動かす (コンポジタ完結でリフローなし)。width/height/top/left/margin のアニメは禁止。

## 1. ボタン・押下フィードバック (即時系の基準実装)

```css
.btn {
  transition: transform 150ms cubic-bezier(0.33,1,0.68,1),
              box-shadow 150ms cubic-bezier(0.33,1,0.68,1);
}
.btn:hover  { transform: translateY(-2px); box-shadow: 0 6px 20px -6px var(--glow); }
.btn:active { transform: translateY(0) scale(0.97); transition-duration: 80ms; }
```

要点: hover と active で **duration を変える** (押下は80msで即応)。
発光影 (`--glow` に半透明のアクセント色) が「安いボタン」との分水嶺。

### リップル (クリック波紋)

クリック座標に円要素を生成し `scale(0→2.5)` + `opacity 0.35→0`、600ms outQuad、
終了で remove。`overflow:hidden` + `pointer-events:none` を忘れない。

### 磁気ホバー (magnetic)

```javascript
el.addEventListener('pointermove', e => {
  const r = el.getBoundingClientRect();
  const dx = e.clientX - r.left - r.width/2, dy = e.clientY - r.top - r.height/2;
  el.style.transform = `translate(${dx*0.25}px, ${dy*0.25}px)`; // 追従係数0.2–0.3
});
el.addEventListener('pointerleave', () =>
  el.animate([{transform: el.style.transform},{transform:'translate(0,0)'}],
    {duration: 500, easing: 'cubic-bezier(0.34,1.56,0.64,1)'})  // outBackで弾んで戻る
    .onfinish = () => el.style.transform = '');
```

## 2. Spring (バネ) — WAAPI で GSAP なしに実現

`linear()` イージング (modern) にバネ波形をサンプルして渡す:

```javascript
function springLinear(stiffness = 180, damping = 12, steps = 60) {
  const w0 = Math.sqrt(stiffness), zeta = damping / (2 * Math.sqrt(stiffness));
  const wd = w0 * Math.sqrt(1 - zeta * zeta);
  const pts = Array.from({length: steps + 1}, (_, i) => {
    const t = i / steps * 1.0;
    return (1 - Math.exp(-zeta * w0 * t) *
      (Math.cos(wd * t) + (zeta * w0 / wd) * Math.sin(wd * t))).toFixed(4);
  });
  return `linear(${pts.join(',')})`;
}
el.animate([{transform:'scale(0.5)'},{transform:'scale(1)'}],
  {duration: 700, easing: springLinear(), fill: 'both'});
```

`linear()` 非対応環境へのフォールバックは `cubic-bezier(0.34,1.56,0.64,1)`。

## 3. 入退場の振付 (メゾ)

### スタッガー入場 (リスト/カード)

```css
.card { opacity: 0; transform: translateY(24px) scale(0.98); }
.card.in {
  opacity: 1; transform: none;
  transition: opacity 400ms ease-out,
              transform 500ms cubic-bezier(0.16,1,0.3,1); /* transformだけ長く=overlap */
  transition-delay: calc(var(--i) * 45ms);
}
```

JS側で `el.style.setProperty('--i', i)`。IntersectionObserver でビューポート入りに `.in` 付与
すればスクロール駆動になる (進行度契約: トリガーの差し替えだけで済む構造)。

### FLIP (レイアウト変化を transform に変換)

並べ替え・展開など「レイアウトが変わる」アニメの唯一の正攻法:

```javascript
const first = el.getBoundingClientRect();
mutateDOM();                                    // クラス変更・並べ替え等
const last = el.getBoundingClientRect();
const dx = first.left - last.left, dy = first.top - last.top;
const sx = first.width / last.width, sy = first.height / last.height;
el.animate([
  { transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})` },
  { transform: 'none' }
], { duration: 450, easing: 'cubic-bezier(0.16,1,0.3,1)' });
```

### View Transitions API (対応環境ならページ/状態遷移の第一候補)

```javascript
if (document.startViewTransition) {
  document.startViewTransition(() => updateDOM());
} else { updateDOM(); }
```

共有要素は両状態に同じ `view-transition-name` を与えるとモーフする。
`::view-transition-old/new(name)` にカスタム keyframes を当てて質感を上げる。

## 4. テキスト演出

### 文字単位リビール

文字を `<span>` 分割 (`aria-hidden` を分割側に付け、元テキストは sr-only で保持):
`translateY(1.1em)` + `clip-path: inset(0 0 -0.2em 0)` の親で隠し、
スタッガー 25–40ms/字、outExpo 600ms で立ち上げる。blur(8px)→0 を重ねると上質。

### スクランブル (ハッカー風文字送り)

```javascript
const CHARS = '!<>-_\\/[]{}—=+*^?#ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function scramble(el, text, dur = 900) {
  const start = performance.now();
  (function tick(now) {
    const p = Math.min((now - start) / dur, 1);
    const fixed = Math.floor(text.length * (1 - Math.pow(1 - p, 3))); // outCubic
    el.textContent = text.slice(0, fixed) + [...text.slice(fixed)]
      .map(c => c === ' ' ? ' ' : CHARS[Math.random() * CHARS.length | 0]).join('');
    if (p < 1) requestAnimationFrame(tick);
  })(start);
}
```

確定済み部分と揺らぎ部分の境界(品質ゲート③)がこの演出の主役。
確定直後の文字に一瞬 `text-shadow: 0 0 12px var(--glow)` を与えると更に良い。

## 5. 状態表示 (ローダー・スケルトン・トースト)

- **スケルトンシマー**: `background: linear-gradient(90deg, #1e293b 25%, #334155 50%, #1e293b 75%); background-size: 200% 100%;` を `background-position 200%→-200%` で 1.8s ループ。
- **トースト**: 入場 `translateY(16px)+scale(0.96)→none` outBack 450ms、
  退場 inCubic 250ms で下へ。複数枚は既存を 8px ずつ押し上げる (FLIPで)。
- **プログレスバー**: 値の変化は 300ms outCubic で追従させ、完了時に
  一瞬の輝度パルス (`filter: brightness(1.6)` → 1、200ms) を入れる。

## 6. アイドル (静止禁止の実装)

```css
@keyframes float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-6px) } }
.hero-badge { animation: float 3.4s ease-in-out infinite; }
```

複数要素には `animation-delay: calc(var(--i) * -0.7s)` で位相をばらす
(負のdelayは「途中から再生」なので開始時の同期も起きない)。
