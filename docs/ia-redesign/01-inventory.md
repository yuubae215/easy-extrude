# 機能インベントリ (IA 再設計 段階1)

実装から抽出した現行機能の全リスト。**意図的にグループ分けしていない** —
書き手が自然に取る順序は「実装の近さ」であり、段階2(グルーピング)の
答えを先に渡してしまうため。並びは意味を持たない。

抽出元: `src/components/Header/Header.jsx`, `src/components/AddMenu/AddMenu.jsx`,
`src/components/Context/ContextLayer.jsx`, `docs/SCREEN_DESIGN.md`, `docs/LAYOUT_DESIGN.md`

| # | 機能 | 現在の住所 |
|---|------|-----------|
| 1 | Box を置く | AddMenu (Shift+A) |
| 2 | Sketch を置く | AddMenu |
| 3 | Coordinate Frame を置く | AddMenu |
| 4 | Robot を置く | AddMenu |
| 5 | Measure Line を置く | AddMenu (M) |
| 6 | STEP をインポート | AddMenu |
| 7 | 移動 (Grab, 軸ロック, スタック補助) | G キー / モバイルツールバー |
| 8 | 回転 | R キー |
| 9 | 複製 | Shift+D |
| 10 | 削除 | X キー / Outliner 行 / ツールバー |
| 11 | Undo / Redo | ヘッダー (モバイル) / Ctrl+Z |
| 12 | Sketch → 押し出し (2D Extrude) | Edit Mode 2D |
| 13 | 面を押し出し (Face Extrude) | Edit Mode 3D (E) |
| 14 | 頂点/辺/面の選択 | Edit Mode 3D (1/2/3) |
| 15 | スナップ (幾何) | Ctrl 押下中 |
| 16 | 階層ツリーを見る/選ぶ | Outliner (左 200px) |
| 17 | 表示/非表示 | Outliner 行の eye |
| 18 | 名前・説明の編集 | N Panel (右 240px) |
| 19 | 位置・姿勢の数値確認 | N Panel (読み取り専用) |
| 20 | 視点操作 / 軸ギズモ | ビューポート + 右上ギズモ |
| 21 | 矩形選択 | ビューポートドラッグ (デスクトップ) |
| 22 | SpatialLink の関係グラフを見る | Link Network Overlay (左下) |
| 23 | 2D Map モードに入る | ヘッダー Map ボタン |
| 24 | Lynch 5 種の空間注釈を描く | Map 左ツールバー |
| 25 | 衝突行列を見る (actor × variable) | Context ▾ → Negotiate → Matrix タブ |
| 26 | 解消順序を承認する | 同 → Cluster タブ |
| 27 | 未解決の問い (OQ) に答える | 同 → Questions タブ |
| 28 | 受け入れ判定を見る | 同 → Checks タブ |
| 29 | ある実体の来歴を辿る (Why) | 同 → Why タブ |
| 30 | 文書全体を俯瞰する | 同 → Overview タブ |
| 31 | 誘導インテーク (ウィザード) | 同 → Wizard タブ |
| 32 | パラメトリック資産を形作る | 同 → Assets タブ |
| 33 | Actor/変数/要求を直接入力 | 同 → Intake タブ |
| 34 | 自然言語から取り込む | 同 → Intake タブ内 |
| 35 | 許容領域を 3D でドラッグ編集 | Context ▾ → Author |
| 36 | 許容領域ゴーストを見る | Context ▾ → Region Ghosts |
| 37 | 把持候補を探索する (Grasp Search) | Context ▾ → Grasp Search → Grasp タブ |
| 38 | シーンを Export / Import (JSON) | ヘッダー |
| 39 | シーンをサーバに Save / Load | ヘッダー (BFF 接続時のみ) |
| 40 | Geometry DAG を編集 (Node Editor) | ヘッダー Nodes (BFF 接続時のみ) |
| 41 | Context を Import / Save (.ctx.json) | Context ▾ |
| 42 | 新規プロジェクト (Context テンプレ) | Context ▾ → New Project |
| 43 | レイアウトテンプレから始める | ヘッダー Layouts (= Home 画面) |
| 44 | 起動時ホーム画面 | 起動時オーバーレイ (S-19) |
| 45 | 操作ツアー (5 クエスト) | 左下カード (S-18, デスクトップのみ) |
| 46 | チュートリアル (6 ステップの物語) | Context ▾ → Tutorial |
| 47 | 例を種として複製・編集 (fork) | Template Gallery カード内 |
| 48 | モード切替 (Object / Edit) | ヘッダー Mode ▾ |
