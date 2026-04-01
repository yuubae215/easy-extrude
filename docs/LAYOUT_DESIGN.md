# レイアウト設計 (Layout Design)

easy-extrude の UI コンポーネントの配置・寸法・レスポンシブ対応を定義する。

> **このドキュメントを更新するタイミング**
> - コンポーネントの寸法・position・z-index を変更したとき
> - 新しい UI 要素 (パネル、ドロワー、モーダルなど) を追加したとき
> - モバイルツールバーのスロット数や並びが変わったとき
> - レスポンシブブレークポイントを変更したとき

---

## レスポンシブブレークポイント

| 区分 | 条件 | 主な変更点 |
|------|------|----------|
| **デスクトップ** | `window.innerWidth >= 768` | サイドバー常時表示、ツールバー非表示 |
| **モバイル** | `window.innerWidth < 768` | サイドバーをドロワー化、ツールバー表示 |

> タッチ入力の判定は `matchMedia('(pointer: coarse)')` を使用する。
> `innerWidth` によるサイズ判定とは独立している。

---

## デスクトップレイアウト

```
0px ──────────────────────────────────────── 100vw
│
▼ 0px
┌─────────────────────────────────────────────────────────────┐  ← z:100
│  HEADER (fixed, h:40px)                                     │
│  [≡] [↶] [↷] [Mode▾] ─── status ─── [Export][Import][Save]│
└─────────────────────────────────────────────────────────────┘
▼ 40px
┌──────────┬─────────────────────────────────┬───────────────┐
│OUTLINER  │                                 │  N PANEL      │
│(fixed,   │     3D VIEWPORT (canvas)        │  (fixed,      │
│ w:200px) │     position: absolute          │   w:240px)    │
│          │     top:40px, bottom:0          │               │
│ z:100    │     left:200px                  │   z:100       │
│          │     right:240px                 │               │
│          │                                 │               │
│          │                    ┌──────────┐ │               │
│          │                    │  GIZMO   │ │               │
│          │                    │ (96×96px)│ │               │
│          │                    │ top-right│ │               │
│          │                    └──────────┘ │               │
└──────────┴─────────────────────────────────┴───────────────┘
▼ 100vh - 24px
┌─────────────────────────────────────────────────────────────┐  ← z:100
│  STATUS BAR (fixed, h:24px)                                 │
│  キーヒント / 操作ガイダンス                                  │
└─────────────────────────────────────────────────────────────┘
▼ 100vh
```

### コンポーネント寸法 (デスクトップ)

| コンポーネント | 寸法 | 位置 | z-index |
|---------------|------|------|---------|
| Header | w:100vw, h:40px | fixed top:0 left:0 | 100 |
| Outliner sidebar | w:200px, h:calc(100vh-64px) | fixed top:40px left:0 | 100 |
| N Panel sidebar | w:240px, h:calc(100vh-64px) | fixed top:40px right:0 | 100 |
| 3D Canvas | w:calc(100vw-440px), h:calc(100vh-64px) | absolute top:40px | 0 |
| Status bar | w:100vw, h:24px | fixed bottom:0 left:0 | 100 |
| Gizmo | w:96px, h:96px | absolute top:48px right:248px | 50 |
| Toast | w:auto, max-w:320px | fixed bottom:32px, 中央揃え | 150 |
| Context menu | w:auto | absolute (カーソル位置) | 200 |
| Mode dropdown | w:140px | absolute (ボタン直下) | 200 |

---

## モバイルレイアウト

```
0px ──────────────── 100vw
│
▼ 0px
┌──────────────────────────────────┐  ← z:100
│  HEADER (fixed, h:40px)          │
│  [≡][↶][↷][Mode▾]···[status]···[⋯][N]│
│        ↑↑                            │
│        UndoRedo                       │
└──────────────────────────────────┘
▼ 40px
┌──────────────────────────────────┐
│                                  │
│   3D VIEWPORT (canvas)           │
│   top:40px                       │
│   bottom:86px (toolbar height)   │
│   w:100vw                        │
│                                  │
│              ┌──────────┐        │
│              │  GIZMO   │        │
│              │ (96×96px)│        │
│              │ top-right│        │
│              └──────────┘        │
│                                  │
└──────────────────────────────────┘
▼ 100vh - 86px
┌──────────────────────────────────┐
│  INFO BAR (fixed, h:26px)        │  ← z:100
│  (モバイルのステータステキスト)   │
└──────────────────────────────────┘
▼ 100vh - 60px
┌──────────────────────────────────┐  ← z:100
│  MOBILE TOOLBAR (fixed, h:60px)  │
│  [Btn1]  [Btn2]  [Btn3]  [Btn4] │
└──────────────────────────────────┘
▼ 100vh


── ドロワー (オーバーレイ) ──────────────────

OUTLINER DRAWER (スライドイン、左から)
  position: fixed
  top:40px, bottom:0, left:0
  w:200px
  z:110  ← ヘッダーより上

N PANEL DRAWER (スライドイン、右から)
  position: fixed
  top:40px, bottom:0, right:0
  w:240px
  z:110
```

### コンポーネント寸法 (モバイル)

| コンポーネント | 寸法 | 位置 | z-index |
|---------------|------|------|---------|
| Header | w:100vw, h:40px | fixed top:0 left:0 | 100 |
| 3D Canvas | w:100vw, h:calc(100vh-126px) | top:40px | 0 |
| Info bar | w:100vw, h:26px | fixed bottom:60px left:0 | 100 |
| Mobile toolbar | w:100vw, h:60px | fixed bottom:0 left:0 | 100 |
| Outliner drawer | w:200px, h:calc(100vh-40px) | fixed top:40px left:0 | 110 |
| N Panel drawer | w:240px, h:calc(100vh-40px) | fixed top:40px right:0 | 110 |
| Toast | w:auto, max-w:280px | fixed bottom:**96px**, 中央揃え | 150 |
| Context menu | w:auto | absolute (タップ位置) | 200 |
| Gizmo | w:96px, h:96px | absolute top:48px right:8px | 50 |

> **Toast の bottom** はツールバー (60px) + 余白 (36px) = **96px** を確保すること。
> デスクトップ (ツールバーなし) は bottom:32px。

---

## ヘッダー内部レイアウト

### デスクトップ
```
[≡] [↶↷] │ [Mode▾] │ ──flex:1── status ──flex:1── │ [Export] [Import] [Save/Load]
```

### モバイル
```
[≡] [↶↷] │ [Mode▾] │ visibility:hidden(flex:1スペーサー) │ [⋯] [N]
```

- `_headerStatusEl` は `display:none` ではなく **`visibility:hidden`** を使う。
  → `flex:1` スペーサーとして機能し続けるため。`display:none` にするとレイアウトが崩れる。

---

## モバイルツールバー スロット設計

ツールバーは状態ごとに **固定スロット数** を維持する。
スロットが埋まらない場合は `{spacer: true}` で埋め、レイアウトシフトを防ぐ。

| アプリ状態 | スロット1 | スロット2 | スロット3 | スロット4 | スロット5 |
|-----------|---------|---------|---------|---------|---------|
| grab.active | ✓ Confirm | Stack | ✕ Cancel | — | — |
| faceExtrude.active | ✓ Confirm | ✕ Cancel | — | — | — |
| **Object Mode** (無選択) | + Add | Edit(disabled) | Delete(disabled) | — | — |
| **Object Mode** (選択あり) | + Add | Edit | Delete | — | — |
| **Object Mode** (Frame 選択) | Rotate | Grab | Delete | Add Frame | spacer |
| Edit · 2D-Sketch | ← Object | Extrude(disabled) | — | — | — |
| Edit · 2D-Extrude | ✓ Confirm | ✕ Cancel | — | — | — |
| Edit · 3D | ← Object | Vertex | Edge | Face | Extrude(disabled*) |

`*` Face が editSelection に含まれると Extrude が有効化される。

---

## z-index 階層

```
z:200  ── モーダルダイアログ (リネーム, 単位変換)
        ── ドロップダウンメニュー (モードセレクター, ⋯メニュー, 追加メニュー, コンテキストメニュー)

z:150  ── Toast 通知

z:110  ── ドロワー (Outliner, N Panel) ← ヘッダー上に重なる

z:100  ── ヘッダー (fixed top)
        ── モバイルツールバー (fixed bottom)
        ── ステータスバー / Info bar (fixed bottom)

z:50   ── ギズモ (Three.js canvas 上のオーバーレイ)

z:10   ── Three.js ラベル (MeasureLine 距離ラベル)

z:0    ── 3D キャンバス (Three.js renderer)
```

---

## N パネル 内部レイアウト

```
┌─────────────────────────────────┐
│  [×] Close (モバイルのみ)        │
├─────────────────────────────────┤
│  ITEM  プロパティグループ        │
│  ─────────────────────────────  │
│  Name:                           │
│  ┌───────────────────────────┐  │
│  │ Cube                      │  │
│  └───────────────────────────┘  │
│  Description:                    │
│  ┌───────────────────────────┐  │
│  │                           │  │
│  └───────────────────────────┘  │
├─────────────────────────────────┤
│  TRANSFORM  ─────────────────── │
│  Location (World):               │
│  X: [  1.00]  Y: [  0.00]       │
│  Z: [  0.00]                     │
│  Rotation (RPY, deg):            │
│  R: [  0.0]  P: [  0.0]         │
│  Y: [  0.0]                      │
└─────────────────────────────────┘
```

- 数値フィールドは読み取り専用 (直接編集不可)
- N パネルの幅: 240px
- グループ見出しは `font-size:11px, opacity:0.6`

---

## アウトライナー 内部レイアウト

```
┌─────────────────────────────────┐
│  SCENE HIERARCHY                 │
├─────────────────────────────────┤
│  □ Cube           [○] [✕]       │  ← Solid
│  □ Cube.001       [○] [✕]       │  ← Solid
│    ├ ⊕ Origin    [○] [✕]       │  ← CoordinateFrame (indent 12px)
│    └ ⊕ Frame.001 [○] [✕]       │  ← CoordinateFrame (indent 12px)
│  ⊡ Sketch.001     [○] [✕]      │  ← Profile
│  ── Measure.001   [○] [✕]      │  ← MeasureLine
│  ▲ Import.001     [○] [✕]      │  ← ImportedMesh
└─────────────────────────────────┘
```

- アイコン凡例: `□` Solid / `⊡` Profile / `──` MeasureLine / `⊕` CoordinateFrame / `▲` ImportedMesh
- インデント: CoordinateFrame は親の下に 12px インデント
- 行の高さ: 28px
- アクティブ行: `background: #3d3d6b`

---

## カラーパレット

| 用途 | カラー |
|------|--------|
| 背景 (ヘッダー, パネル) | `#242424` |
| 背景 (セカンダリ) | `#2b2b2b` |
| 背景 (ボタン) | `#383838` |
| ボーダー | `#4a4a4a` |
| テキスト (プライマリ) | `#e0e0e0` |
| テキスト (セカンダリ) | `#888888` |
| アクセント (選択中) | `#3d3d6b` / `#5c5cff` |
| 危険 (Delete) | `#c04040` |
| 成功 (Confirm) | `#3a7a3a` |
| 3D 面ハイライト | 水色 (Three.js マテリアル) |
| Measure ライン | アンバー (#f5a623) |
| CoordinateFrame 軸 | X:赤 `#e05252` / Y:緑 `#52e052` / Z:青 `#5252e0` |

---

## アニメーション・トランジション

| 要素 | アニメーション | duration |
|------|-------------|---------|
| ドロワー スライドイン/アウト | `transform: translateX()` | 200ms ease |
| ドロップダウン 表示/非表示 | `display: block/none` (即時) | — |
| Toast 表示 | `opacity: 0 → 1` | 150ms |
| Toast 非表示 | 5000ms 後に `opacity: 1 → 0` | 300ms |
| ボタン ホバー | `background` 変化 | 即時 |

---

## 関連ドキュメント

- `docs/SCREEN_DESIGN.md` — 各画面の情報設計
- `docs/STATE_TRANSITIONS.md` — 状態遷移
- `docs/adr/ADR-023-mobile-input-model.md` — モバイル入力モデル
- `docs/adr/ADR-024-mobile-toolbar-architecture.md` — モバイルツールバー設計方針
- `.claude/mental_model/3_ui_layout.md` — UI レイアウトのコーディングルール
