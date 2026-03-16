# easy-extrude

> **Face Extrude をもっと手軽に、もっと楽しく。**

3Dモデリングの「押し出し (Extrude)」操作をブラウザだけで誰でも直感的に体験できるWebアプリを目指しています。
複雑なソフトウェア不要。開いてすぐ、3Dの世界へ。

**Live Demo:** https://yuubae215.github.io/easy-extrude/

---

## これは何？

「Face Extrude」とは、3Dモデルの面 (Face) を選んで押し出す操作のことです。
BlenderやMayaではおなじみのこの操作を、**ブラウザ上でEasyに**できるアプリを開発中です。

```
クリックして面を選択 → ドラッグして押し出す → 3Dシェイプの完成！
```

---

## 現在の状態

Three.js + Vite で構築したインタラクティブな3Dシーンのプロトタイプです。

- ExtrudeGeometry による星・ハート・矢印の3Dシェイプ
- OrbitControls によるマウス操作 (回転・ズーム・パン)
- PointLight のアニメーション
- パーティクルエフェクト
- フォグ・グリッド表示

---

## ロードマップ

- [ ] 任意の2Dシェイプを描いてExtrude
- [ ] 面セレクト → Face Extrude 操作
- [ ] エクスポート機能 (OBJ / GLTF)
- [ ] モバイル対応

---

## 開発に参加する

```bash
git clone https://github.com/yuubae215/easy-extrude.git
cd easy-extrude
pnpm install
pnpm dev
```

開発サーバーが http://localhost:5173 で起動します。

## 技術スタック

| ツール | 役割 |
|--------|------|
| [Three.js](https://threejs.org/) | 3Dレンダリング |
| [Vite](https://vitejs.dev/) | バンドラー・開発サーバー |
| [pnpm](https://pnpm.io/) | パッケージマネージャー |
| GitHub Actions | CI/CD → GitHub Pages 自動デプロイ |

---

Made with Three.js
