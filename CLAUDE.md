# easy-extrude

Three.js + Vite のサンプルプロジェクト。カスタム BufferGeometry による直方体のインタラクティブ編集シーン。GitHub Pages にデプロイ済み。

## 開発コマンド

```bash
pnpm install       # 依存パッケージのインストール
pnpm dev           # 開発サーバー起動 (http://localhost:5173)
pnpm build         # 本番ビルド (dist/ に出力)
pnpm preview       # ビルド結果のプレビュー
```

## 技術スタック

- **Three.js** - 3Dレンダリング
- **Vite** - バンドラー・開発サーバー
- **pnpm** - パッケージマネージャー
- **GitHub Actions** - CI/CD

## プロジェクト構成 (MVC アーキテクチャ)

```
easy-extrude/
├── index.html                        # エントリーポイント
├── vite.config.js                    # Vite設定 (base: '/easy-extrude/')
├── package.json
├── src/
│   ├── main.js                       # 起動エントリー: MVC を組み立てて start()
│   ├── model/
│   │   └── CuboidModel.js            # 純粋関数のみ (副作用なし)
│   ├── view/
│   │   ├── SceneView.js              # レンダラー・カメラ・コントロール・照明・グリッド
│   │   ├── MeshView.js               # 直方体メッシュ・ワイヤーフレーム・面ハイライト
│   │   └── UIView.js                 # DOM UI (モードボタン・ステータス・説明バー)
│   └── controller/
│       └── AppController.js          # 入力処理・アニメーションループ・MV 連携
└── .github/
    └── workflows/
        └── deploy.yml                # GitHub Pages デプロイワークフロー
```

## MVC 設計方針

| レイヤー | ファイル | 責務 |
|---|---|---|
| **Model** | `model/CuboidModel.js` | データ定義 (`FACES`, `createInitialCorners`) と純粋関数 (`buildGeometry`, `computeFaceNormal`, `computeOutwardFaceNormal`, `getCentroid`, `buildFaceHighlightPositions`, `toNDC`) |
| **View** | `view/SceneView.js` | Three.js シーン・WebGL レンダラー・OrbitControls の初期化と `render()` |
| **View** | `view/MeshView.js` | 直方体メッシュ・ワイヤーフレーム・BoxHelper・面ハイライト・押し出し表示ラインの更新 |
| **View** | `view/UIView.js` | DOM 要素の生成・モードボタン・ステータス表示・押し出し量ラベル・カーソル変更 |
| **Controller** | `controller/AppController.js` | マウス/キーボードイベント・レイキャスト・モード切替・アニメーションループ |

### 純粋関数と副作用の分離

- **純粋関数** (`CuboidModel.js`): 引数のみに依存し外部状態を変更しない
- **副作用** (View / Controller): DOM 操作・WebGL 描画・イベント登録・`requestAnimationFrame`

## シーン内容

- **カスタム BufferGeometry** による直方体 (8 コーナー × 6 面)
- **OrbitControls** によるマウス操作 (右ドラッグで視点回転)
- **オブジェクトモード** (O キー): 左ドラッグで移動 / Ctrl+ドラッグで Y 軸回転
- **面選択モード** (F キー): 面ホバーでハイライト / 左ドラッグで押し出し
- **グリッドヘルパー** と **方向ライト**

## GitHub Pages デプロイ

`main` または `master` ブランチへの push で自動デプロイ。

**ワークフロー:** `.github/workflows/deploy.yml`

デプロイ先 URL: `https://yuubae215.github.io/easy-extrude/`

### GitHub リポジトリ設定

1. Settings → Pages → Source を **GitHub Actions** に設定

## 変更時の注意

- `vite.config.js` の `base` はリポジトリ名と一致させること (`/easy-extrude/`)
- Three.js の addons は `three/addons/...` からインポート

## セッション履歴

- **2026-03-17**: `src/main.js` を MVC パターンにリファクタリング。純粋関数と副作用を分離し、`model/` / `view/` / `controller/` に分割。セッション完了。
- **2026-03-18**: ドキュメント更新。README.md を実装済み MVC 構成に合わせて全面改訂。CLAUDE.md の Model 純粋関数リストに `computeOutwardFaceNormal` を追記、MeshView・UIView の責務説明を実態に合わせて更新。
