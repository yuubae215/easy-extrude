# easy-extrude

Three.js + Vite のサンプルプロジェクト。ExtrudeGeometry を使った3Dシェイプのインタラクティブシーン。GitHub Pages にデプロイ済み。

## 開発コマンド

```bash
npm install        # 依存パッケージのインストール
npm run dev        # 開発サーバー起動 (http://localhost:5173)
npm run build      # 本番ビルド (dist/ に出力)
npm run preview    # ビルド結果のプレビュー
```

## 技術スタック

- **Three.js** - 3Dレンダリング
- **Vite** - バンドラー・開発サーバー
- **GitHub Actions** - CI/CD

## プロジェクト構成

```
easy-extrude/
├── index.html              # エントリーポイント
├── vite.config.js          # Vite設定 (base: '/easy-extrude/')
├── package.json
├── src/
│   └── main.js             # Three.jsシーン本体
└── .github/
    └── workflows/
        └── deploy.yml      # GitHub Pages デプロイワークフロー
```

## シーン内容

`src/main.js` に以下の要素を実装:

- **ExtrudeGeometry** による3Dシェイプ (星・ハート・矢印)
- **OrbitControls** によるマウス操作
- **PointLight** アニメーション (周回)
- **パーティクル** (浮遊する点群)
- **フォグ** と **グリッドヘルパー**

## GitHub Pages デプロイ

`main` または `master` ブランチへの push で自動デプロイ。

**ワークフロー:** `.github/workflows/deploy.yml`

デプロイ先 URL: `https://yuubae215.github.io/easy-extrude/`

### GitHub リポジトリ設定

1. Settings → Pages → Source を **GitHub Actions** に設定

## 変更時の注意

- `vite.config.js` の `base` はリポジトリ名と一致させること (`/easy-extrude/`)
- Three.js の addons は `three/addons/...` からインポート
