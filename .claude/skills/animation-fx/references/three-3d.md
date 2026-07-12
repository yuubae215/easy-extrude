# Three 3D — オブジェクト実体化・群体・カメラ振付

共通uniform契約: `uProgress`(0=非実体,1=実体), `uTime`, `uBaseColor`, `uGlowColor`。
共通varying頂点シェーダーとユーティリティ(hash13/noise3/diffuse/fresnel)は下記を使用。

```glsl
// 共通vertex (scan/dissolve/glitch/hexgrid)
varying vec3 vPosition; varying vec3 vNormal; varying vec2 vUv;
void main(){ vPosition = position; vNormal = normalize(normalMatrix * normal);
  vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }

// 共通util (fragment冒頭)
float hash13(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0;
  return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise3(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash13(i),hash13(i+vec3(1,0,0)),f.x),
                 mix(hash13(i+vec3(0,1,0)),hash13(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash13(i+vec3(0,0,1)),hash13(i+vec3(1,0,1)),f.x),
                 mix(hash13(i+vec3(0,1,1)),hash13(i+vec3(1,1,1)),f.x),f.y),f.z); }
float diffuse(vec3 n){ return max(dot(n, normalize(vec3(0.5,0.8,0.5))), 0.25); }
float fresnel(vec3 n){ return pow(1.0 - abs(n.z), 2.5); }
```

## §materialization — 実体化・消滅6種

すべて `1.0 - uProgress` で消滅に反転可能な対称設計。

### 1. scan (デジタルスキャン)

```glsl
float scanY = -2.0 + uProgress * 4.0;          // 実寸は boundingBox から算出して渡す
float dist = vPosition.y - scanY;
vec3 col; float alpha;
if (dist > 0.0) {                               // 上=ホログラム縞
  float stripe = step(0.5, sin(vPosition.y * 45.0 + uTime * 2.0));
  col = uGlowColor * (0.2 + 0.6 * stripe);
  alpha = (0.15 + 0.15 * stripe) * max(0.0, 1.0 - dist * 1.5);
} else {                                        // 下=実体 (リム付き)
  col = uBaseColor * diffuse(vNormal) + uGlowColor * fresnel(vNormal) * 0.35;
  alpha = 1.0;
}
float ew = 0.18;                                // 境界レーザー
if (abs(dist) < ew) { float g = 1.0 - abs(dist)/ew;
  col = mix(col, uGlowColor * 2.5, g); alpha = max(alpha, g); }
gl_FragColor = vec4(col, alpha);
```

Material: `transparent:true, side:DoubleSide`。半透明の重なりに注意し対象は1体に。

### 2. dissolve (ノイズ・ディゾルブ)

```glsl
float n = noise3(vPosition * 4.5) * 0.7 + noise3(vPosition * 12.0) * 0.3; // 2オクターブ
if (n > uProgress) discard;
vec3 col = uBaseColor * diffuse(vNormal);
float edge = uProgress - n;
if (edge < 0.08) col = mix(col, uGlowColor * 3.0, 1.0 - edge / 0.08);
if (!gl_FrontFacing) col *= 0.25;               // 内殻を暗く=厚み感
gl_FragColor = vec4(col, 1.0);
```

opaque + DoubleSide。描画順の心配がなく最も汎用。魔法召喚・転送の第一候補。

### 3. particles (パーティクル・アセンブル)

頂点ごと遅延 + smoothstep着地が核心 (一斉移動はバニラ):

```glsl
// vertex
attribute vec3 aRandomPos; attribute float aDelay;
uniform float uProgress; varying float vLife;
void main(){
  float p = clamp((uProgress - aDelay * 0.3) / 0.7, 0.0, 1.0);
  p = p * p * (3.0 - 2.0 * p); vLife = p;
  vec3 pos = mix(aRandomPos, position, p);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = (12.0 / -mv.z) * (1.0 + (1.0 - p) * 3.0);
  gl_Position = projectionMatrix * mv; }
// fragment
uniform vec3 uGlowColor; varying float vLife;
void main(){ float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  gl_FragColor = vec4(uGlowColor * 1.5, (1.0 - d * 2.0) * (0.4 + 0.6 * (1.0 - vLife) + 0.4 * vLife)); }
```

JS: ランダム初期位置は一様球殻分布 (`θ=2πu, φ=acos(2v-1), r=2+rand*2.5`)、
`aDelay = Math.random()`。Material: `transparent, depthWrite:false, AdditiveBlending`。
仕上げ: p>0.85 で薄い実体メッシュ(dissolve流用)をクロスフェード。

### 4. wireframe (骨組み→面張り)

`WireframeGeometry` の LineSegments と Solid Mesh の2層時間差:
0–50% ワイヤーが scale 0.7→1.0 + フェードイン / 50–100% 面 opacity↑・ワイヤー20%へ退く。
Solid は素の Standard にせず fresnel リムを `onBeforeCompile` で注入すること。

### 5. glitch (ブロック明滅スポーン)

```glsl
vec3 block = floor(vPosition * 6.0);
float h = hash13(block);
float flicker = step(0.5, fract(uTime * 8.0 + h * 7.0));
if (h > uProgress + 0.15) discard;              // 未出現
bool unstable = h > uProgress - 0.1;            // 明滅帯
if (unstable && flicker < 0.5) discard;
vec3 col = uBaseColor * diffuse(vNormal);
if (unstable) { col = mix(col, uGlowColor * 2.0, 0.7);
  col.r += sin(uTime * 40.0) * 0.15; col.b -= sin(uTime * 40.0) * 0.15; } // 簡易RGBずれ
gl_FragColor = vec4(col, 1.0);
```

### 6. hexgrid (ヘックスシールド)

UVを六角タイリングし、タイルhash遅延で1枚ずつ出現+枠線発光+出現フラッシュ:

```glsl
vec4 hexTile(vec2 uv){ const vec2 s = vec2(1.0, 1.7320508);
  vec4 c = floor(vec4(uv, uv - vec2(0.5, 1.0)) / s.xyxy) + 0.5;
  vec4 h = vec4(uv - c.xy * s, uv - (c.zw + 0.5) * s);
  return dot(h.xy,h.xy) < dot(h.zw,h.zw) ? vec4(h.xy, c.xy) : vec4(h.zw, c.zw + 0.5); }
// main:
vec4 t = hexTile(vUv * 10.0);
float id = hash13(vec3(t.zw, 0.0));
float appear = smoothstep(id, id + 0.08, uProgress);
if (appear <= 0.001) discard;
float edgeDist = 0.5 - max(abs(t.x), abs(t.y * 0.8660254 + t.x * 0.5));
float border = smoothstep(0.06, 0.02, edgeDist);
vec3 col = uBaseColor * diffuse(vNormal);
col = mix(col, uGlowColor * 1.8, border * 0.8);
col += uGlowColor * 2.5 * (1.0 - appear);
gl_FragColor = vec4(col, 0.85 * appear + border * 0.15);
```

球/カプセル形状に。transparent + DoubleSide。

### 複合レシピ

- 召喚: dissolve(0–80%) → 全面フラッシュ1発 (`col += uGlowColor * uPulse`、JS側で減衰)
- 転送装置: particles(0–70%) + scan(70–100%)。後段は `(p-0.7)/0.3` に再マップ
- 撃破: glitch を逆再生 + 同時に破片パーティクル放出 (canvas-svg.md の物理を3D化)

## §swarm — カールノイズ群体 (数万粒子の有機的な流れ)

発散のないベクトル場 = カールノイズ。粒子が「流体のように」舞う定番:

```glsl
// vertex内: noise3 の勾配から擬似カールを合成
vec3 curl(vec3 p){
  const float e = 0.1;
  float nx1 = noise3(p + vec3(0,e,0)), nx2 = noise3(p - vec3(0,e,0));
  float ny1 = noise3(p + vec3(0,0,e)), ny2 = noise3(p - vec3(0,0,e));
  float nz1 = noise3(p + vec3(e,0,0)), nz2 = noise3(p - vec3(e,0,0));
  return normalize(vec3(nx1-nx2, ny1-ny2, nz1-nz2) / (2.0*e) +
                   vec3(0.3, 0.1, -0.2)); // 定常流を足すと方向性が出る
}
vec3 pos = position + curl(position * 0.8 + uTime * 0.15) * uAmp;
```

CPU物理なしで数万点が動く。実体化(§materialization 3)のアイドル状態としても優秀:
`uAmp = (1.0 - uProgress) * 0.5 + 0.03` (完成後も微小に漂わせる=静止禁止)。

## §instancing — 大量オブジェクトの振付

`InstancedMesh` + インスタンス属性で、数千キューブの波・グリッド起伏・ロゴ集合:

```javascript
const mesh = new THREE.InstancedMesh(geo, mat, N);
const dummy = new THREE.Object3D();
function update(t) {
  for (let i = 0; i < N; i++) {
    const x = (i % side) - side/2, z = Math.floor(i / side) - side/2;
    const y = Math.sin(x * 0.5 + t * 2) * Math.cos(z * 0.5 + t * 1.3) * 0.8; // 波
    dummy.position.set(x * 0.5, y, z * 0.5);
    dummy.scale.setScalar(0.9 + y * 0.3);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
}
```

N>5万や色まで動かす場合はインスタンス属性 + シェーダー側計算に移行。
出現演出は「中心からの距離で遅延」(motion-language.md の空間スタッガー) が鉄板。

## §vertex-displacement — 頂点変位 (脈動・液体・音反応)

```glsl
// vertex: 法線方向にノイズ変位。uAmpを進行度や音量に接続
float d = noise3(position * 2.0 + uTime * 0.4);
vec3 displaced = position + normal * d * uAmp;
```

IcosahedronGeometry(1, 32) など高分割ジオメトリで。変位後の法線は
`computeVertexNormals` 不可なので、fragment 側は fresnel + マットキャップ風で誤魔化すか
数値微分で再計算。uAmp 0.15–0.3 で「生きている球体」、1.0 超で液体金属。

## §camera — カメラ振付 (マクロ演出の完成度を分ける)

- **導入ドリー**: 実体化と同時に `camera.position.z` を 7→4.5 へ outExpo。
  対象の完成 (p=1) とカメラ静止を同フレームに合わせる。
- **常時オービット**: OrbitControls `autoRotate = true, autoRotateSpeed = 0.8`。
- **視線の余韻**: lookAt 対象を実座標でなく遅延追従点にする:
  `target.lerp(realTarget, 1 - Math.pow(0.001, dt))` — カメラに「重さ」が生まれる。
- **手ぶれ (subtle)**: `camera.position.x += noise系(t) * 0.01`。ゲーム的臨場感。
  reduced-motion では無効化。

## §micro — 3Dミクロ (単一オブジェクトの応答)

ポインタ追従チルト + ホバー発光。バネ補間で即値変更しない:

```javascript
let tx = 0, ty = 0;                              // 目標
el.addEventListener('pointermove', e => { tx = (e.clientX / innerWidth - 0.5) * 0.6;
                                          ty = (e.clientY / innerHeight - 0.5) * 0.4; });
// ループ内: 現在値→目標のバネ (dt非依存の指数追従)
mesh.rotation.y += (tx - mesh.rotation.y) * (1 - Math.pow(0.002, dt));
mesh.rotation.x += (ty - mesh.rotation.x) * (1 - Math.pow(0.002, dt));
mat.uniforms.uHover.value += ((hovering ? 1 : 0) - mat.uniforms.uHover.value) * 0.08;
```
