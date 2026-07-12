# Shader 2D — フルスクリーンGLSL (画像・画面のマクロ演出)

板ポリ1枚 + フラグメントシェーダーで画面/画像全体を加工する。
gl-transitions (community standard) の契約に準拠した設計にする。

## 実行基盤 (three.js を最小レンダラとして使う)

```javascript
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const mat = new THREE.ShaderMaterial({
  uniforms: {
    uProgress: { value: 0 }, uTime: { value: 0 },
    uFrom: { value: texA }, uTo: { value: texB },       // 遷移する2画像
    uResolution: { value: new THREE.Vector2(w, h) },
  },
  vertexShader: `varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = vec4(position, 1.0); }`,
  fragmentShader: FRAG,
});
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
```

テクスチャは `THREE.TextureLoader`。**アスペクト比補正**を必ず入れる
(cover相当: 短辺フィットでUVをスケール&センタリング)。DOM上の画像を
WebGLで置き換える場合は `getBoundingClientRect` で板をDOM位置に同期。

## 共通ノイズ関数 (fragment冒頭に貼る)

three-3d.md と同一の hash13/noise3 に加え、2D用:

```glsl
float hash21(vec2 p){ p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23); return fract(p.x * p.y); }
float noise2(vec2 p){ vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash21(i), hash21(i+vec2(1,0)), f.x),
             mix(hash21(i+vec2(0,1)), hash21(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5;
  for(int i = 0; i < 4; i++){ v += a * noise2(p); p *= 2.03; a *= 0.5; } return v; }
```

本格運用では LYGIA (`lygia.xyz`) や glsl-noise の simplex を #include/インライン。

## 1. 画像トランジション (gl-transitions式)

契約: `vec4 transition(vec2 uv)` が from→to を `progress` で混ぜて返す。

### ブロックグリッチ遷移 (RGBずれ付き — gl-transitions/GlitchMemories 系)

```glsl
vec4 transition(vec2 p) {
  vec2 block = floor(p / vec2(0.06));                    // ブロック量子化
  vec2 jitter = (vec2(hash21(block + floor(uProgress * 12.0)),
                      hash21(block.yx + floor(uProgress * 12.0))) - 0.5);
  float amp = 0.3 * sin(uProgress * 3.14159);            // 中盤で最大
  vec2 pr = p + jitter * amp * 0.2;
  vec2 pg = p + jitter * amp * 0.3;
  vec2 pb = p + jitter * amp * 0.5;                      // RGBで歪み量を変える=色収差
  return vec4(mix(texture2D(uFrom,pr), texture2D(uTo,pr), uProgress).r,
              mix(texture2D(uFrom,pg), texture2D(uTo,pg), uProgress).g,
              mix(texture2D(uFrom,pb), texture2D(uTo,pb), uProgress).b, 1.0);
}
```

### ノイズワイプ (燃える境界)

```glsl
vec4 transition(vec2 p) {
  float n = fbm(p * 5.0);
  float edge = smoothstep(n - 0.08, n, uProgress * 1.16 - 0.08); // 0..1を少し拡張
  vec4 col = mix(texture2D(uFrom, p), texture2D(uTo, p), edge);
  float rim = smoothstep(0.0, 0.15, edge) * smoothstep(0.3, 0.15, edge); // 境界帯
  col.rgb += uGlowColor * rim * 2.0;                     // 品質ゲート③: 境界発光
  return col;
}
```

### ディストーションワイプ

進行の中盤で両画像を `p + (noise2(p*3.0 + uTime)-0.5) * strength` で歪ませてから混ぜる。
`strength = sin(uProgress * PI) * 0.08`。ヒーロー画像の切替に最適。

## 2. ホバーディストーション (単一画像のインタラクション)

マウス位置 `uMouse` 周辺のUVを波紋状に押し出す:

```glsl
vec2 d = vUv - uMouse;
float dist = length(d * vec2(uResolution.x / uResolution.y, 1.0)); // アスペクト補正
float ripple = sin(dist * 40.0 - uTime * 5.0) * exp(-dist * 6.0) * uHover * 0.02;
vec4 col = texture2D(uFrom, vUv + normalize(d) * ripple);
```

`uHover` は JS 側で 0↔1 をバネ補間 (`v += (target - v) * 0.08` 毎フレーム)。
即値で切り替えないこと (品質ゲート①)。

## 3. 2Dディゾルブ / スキャン (3D版の平面移植)

three-3d.md の dissolve/scan フラグメントは `vPosition` を `vUv` に読み替えるだけで
テキスト・ロゴ・画像に適用できる。テキストは Canvas に描いて `CanvasTexture` 化し、
アルファを実体マスクとして使う:

```glsl
vec4 tex = texture2D(uFrom, vUv);
float n = fbm(vUv * 8.0);
if (n > uProgress || tex.a < 0.5) discard;
float edge = uProgress - n;
vec3 col = tex.rgb + uGlowColor * 3.0 * smoothstep(0.08, 0.0, edge);
```

## 4. 常時アイドル背景 (オーロラ / 星雲)

fbm を時間でドリフトさせ、2〜3色をグラデーションマップ:

```glsl
float v = fbm(vUv * 3.0 + vec2(uTime * 0.03, uTime * 0.015));
v += 0.4 * fbm(vUv * 7.0 - uTime * 0.02);
vec3 col = mix(uBg, uBaseColor, smoothstep(0.3, 0.7, v));
col = mix(col, uGlowColor * 0.6, smoothstep(0.65, 0.95, v));
```

ヒーローセクションの背景として最強のコスパ。opacity 0.5 程度で敷き、
`prefers-reduced-motion` では uTime を固定する。

## パフォーマンス

- フルスクリーンfragmentのコストは解像度に比例。`setPixelRatio(min(dpr, 1.5))` まで
  落としてよい (板ポリはジャギが目立たない)。
- fbm はオクターブ4まで。モバイルでは2–3。
- `texture2D` 呼び出し回数を意識 (グリッチのRGB分離で3回×2枚=6回が上限目安)。
