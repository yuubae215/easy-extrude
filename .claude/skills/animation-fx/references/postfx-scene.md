# PostFX & Scene — 仕上げの視覚設計

シェーダーが正しくても、シーンと後処理が素朴だと台無しになる。3D と 2Dシェーダー共通。

## 1. 3色カラーシステム

背景 / 実体(base) / 発光(glow)。発光色は高彩度、背景は黒でなく「ほぼ黒の寒色/暖色」。

| プリセット | 背景 | base | glow | 雰囲気 |
|---|---|---|---|---|
| Cyber Blue | `#070a13` | `#1e293b` | `#3b82f6` | SF標準、外さない |
| Toxic Grid | `#050d08` | `#14261c` | `#22c55e` | ハッカー、マトリックス |
| Synthwave | `#12081a` | `#2a1a3a` | `#e83d84` | レトロフューチャー |
| Amber Protocol | `#120c04` | `#2d2412` | `#f59e0b` | 軍用HUD、警告 |
| Ghost White | `#0a0c10` | `#334155` | `#e2e8f0` | ミニマル、ホログラム |
| Ember | `#140806` | `#3a1d14` | `#f97316` | 灼熱、召喚魔法 |

glow はUI(ボタン・ゲージ・影)、リムライト、ダスト、シェーダー uniform の全てに
同一の `THREE.Color` / CSS変数を共有させて連動させる。ユーザー変更可能にするのが標準。

## 2. シーンドレッシング必須4点セット (3D)

```javascript
scene.background = new THREE.Color(bg);
scene.fog = new THREE.FogExp2(bg, 0.08);                          // ①奥行きの霧
const grid = new THREE.GridHelper(20, 40, '#1e293b', '#0f172a');
grid.position.y = -1.5; scene.add(grid);                          // ②グリッド床
// ③浮遊ダスト: Points 200点, size 0.03, opacity 0.4, depthWrite:false, 微小回転
// ④三点照明: Ambient 0.15 + 白キーライト 0.8 + 逆側から glow色ライト 0.5
```

床の代替: グリッドの代わりに「反射風」(オブジェクトを y 反転複製 + opacity 0.15 +
黒へのグラデーションフェード) を敷くと高級感が跳ねる。コストほぼゼロ。

## 3. トーンマッピングと発光

`renderer.toneMapping = THREE.ACESFilmicToneMapping` を必ず有効化。
本スキルの発光係数 (glow × 1.5〜3.0) はこれが前提。無効だと白飛びする。

### Bloom (使える環境)

EffectComposer + UnrealBloomPass: `strength 0.5–0.8, radius 0.4, threshold 0.85`。
strength 1.0 超は素人っぽく滲むので禁止。

### フェイクブルーム (CDN r128 の three.min.js のみ等)

①発光部の輝度を2.5–3.0倍 ②フレネルリム加算 ③AdditiveBlending のダスト/スプライトを
発光源近傍に配置。この3点で「滲んで見える」状況を作る。本スキルのGLSL係数は
フェイク前提で調整済み。

## 4. フィルミックな画面全体後処理 (2Dシェーダーで自作可)

フルスクリーン板ポリ最終パスに以下を薄く重ねると一気に「作品」になる:

```glsl
vec3 col = texture2D(uScene, vUv).rgb;
// ビネット
float vig = smoothstep(0.9, 0.3, length(vUv - 0.5));
col *= 0.4 + 0.6 * vig;
// フィルムグレイン (毎フレーム変化)
col += (hash21(vUv * 1000.0 + uTime) - 0.5) * 0.05;
// 色収差 (端ほどRGBサンプル位置をずらす) — 演出強調時のみ強く
vec2 dir = vUv - 0.5;
col.r = texture2D(uScene, vUv + dir * 0.004 * uAberration).r;
col.b = texture2D(uScene, vUv - dir * 0.004 * uAberration).b;
// 走査線 (サイバー系のみ)
col *= 0.96 + 0.04 * sin(vUv.y * uResolution.y * 3.14159);
```

`uAberration` は通常 0.3、衝撃の瞬間 (実体化完了・被弾) に 2.0 へスパイク→減衰させる
のが「効果音の視覚版」。グレインは 0.03–0.06 の範囲厳守 (それ以上はノイズ画質に見える)。

## 5. UIクローム (デモページ規約)

- ダークUI一択。Tailwind なら slate-900/950 基調、border slate-800、角丸 lg–xl。
- 数値・進行度は `font-mono`、ラベルは `uppercase tracking-wider text-[10px]`。
- 必須: エフェクト切替 / 進行度スライダー+再生停止 / グラデーションゲージ /
  base・glow カラーピッカー / 選択エフェクトの実装原理を説明する解説パネル。
- 見出しは `bg-clip-text` グラデーション、キャンバス上オーバーレイは
  `backdrop-blur` + 半透明。
- モバイル: キャンバス `h-[45vh] min-h-[320px]`、パネル縦積み、スライダー thumb 16px+。
