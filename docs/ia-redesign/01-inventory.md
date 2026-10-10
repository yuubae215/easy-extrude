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

---

## 追補 — v8 以降に増えた機能 (v9 の段階1, 2026-10-10)

v8 (2026-08-02) の後、把持・ロボットの ADR (ADR-114〜163) が約 60 本入ったが、
ワイヤーフレームは更新されていない。ここではその間に**画面へ出た機能だけ**を足す。
上の表と同じく**意図的にグループ分けしていない** (並びは意味を持たない)。

抽出元: `src/components/Grasp/GraspSearchPanel.jsx` (2011 行)、`src/components/NPanel/`、
`src/components/Home/`、`src/components/RobotAppearanceToggle/`、`src/components/ProjectionToggle/`、
ADR-114〜163、および実機 (1440×900) のスクリーンショット。

「現在の住所」が **住所なし** の行は、機能 (またはその受け皿) が設計されているのに
画面のどこにも入口が無いもの。**未実装** は ADR / 残しの台帳で宣言済みだが、まだ画面に無いもの。
この 2 種を省くと、*在る入口*を辿る棚卸しになり、無い入口は出てこない (原則 #31)。

| # | 機能 | 現在の住所 |
|---|------|-----------|
| 49 | ワークの質量・重心を宣言する | N Panel › Checks › Grasp candidates… (選択中の**ロボット**の下) |
| 50 | ロボットの見た目を実写 / 軽量で切り替える | ジャイロ下のトグル (REAL) |
| 51 | 把持探索を走らせる (Run) | N Panel › Checks › Grasp candidates… |
| 52 | 3D で面をクリックして進入面を入力する | **未実装** (DEF-047) |
| 53 | ハンドの種別 (平行 / 吸着) と形を宣言する | Grasp パネル内 (主語は tcp) |
| 54 | 候補を一覧・並び替え・選ぶ | Grasp パネル内 |
| 55 | 選んだ候補の姿勢を腕がとる (プレビュー) | 3D ビュー |
| 56 | カメラ (見えるか) を宣言する / 今の視点を使う | Grasp パネル内 › Seen |
| 57 | 孤児になった宣言 (実体が消えた宣言) を見る | **住所なし** (DEF-035) |
| 58 | 目的の重み 4 本 (reach / clearance / stability / hold) と topN を決める | Grasp パネル内 |
| 59 | 画面で足した物に宣言すると、その物 (と連結成分) が文書へ入る | 宣言の押下の副作用 + トースト (ADR-159/163) |
| 60 | 掴む対象を選ぶ | Grasp パネル内 (pick one of N) |
| 61 | 把持仕様を宣言する (名前・対象の手・進入面・接触面・領域) | Grasp パネル内 (主語はワーク) |
| 62 | 干渉を動作の相ごとに見る / 全相分析を走らせる | Grasp パネル内 |
| 63 | 投影 (透視 / 正射) を切り替える | ジャイロ下のトグル (PERSP / ORTHO) — #23 の後継 |
| 64 | 吸着の保持力を宣言する | Grasp パネル内 |
| 65 | 診断ファネル・near-miss・リスクを見る | Grasp パネル内 (結果の下) |
| 66 | リーチ包絡を宣言する | Grasp パネル内 › Reached |
| 67 | 面ラベル・把持仕様の絵・手の形を 3D で確かめる | 3D ビュー (パネルの hover で点灯) |
| 68 | 相の時系列を再生する | **未実装** (ADR-158 Proposed) |
| 69 | 引き上げ (lift) を宣言する | Grasp パネル内 |
| 70 | TCP / robot_base の名札を見る | 3D ビュー (EntityLabel) |
| 71 | 容器 (外寸 + 内寸) の寸法を画面で変える | **未実装** (DEF-055) — いまは DSL / テンプレからのみ |
| 72 | プロジェクト境界の確認 (失うものがあるときだけ) | 確認ダイアログ (ADR-134) |
| 73 | バックエンドが無いことを知る (スタブ表示) | Grasp パネル内のバッジ |

### 住所が変わった既存の行

| # | 機能 | v8 の住所 | 現在の住所 |
|---|------|-----------|-----------|
| 23 | 2D Map に入る | ヘッダー Map ボタン | ジャイロ下の投影トグル (#63, ADR-103) |
| 37 | 把持候補を探索する | Context ▾ → Grasp Search | N Panel › Checks (ADR-110) |
| 38 / 39 | Export / Import | ヘッダー (ファイル ▾) | ヘッダー Export ▾ / Import ▾ (ADR-108) |
| 43 / 44 | テンプレから始める | Layouts / 起動ホーム | Start ▾ / 起動ホーム — **開くと文書になる** (ADR-162) |
