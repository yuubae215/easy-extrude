# Dogfooding — 当事者が実際に触って値を獲得する場

ADR-091 の既定文書 (`createDefaultCellDoc()`) に入れる**具体的な値**は、机の上では決まらない。
grasp-search を実際に通した当事者が「これは訂正しなくていい」と判断した値だけが既定値になる
資格を持つ。この立場は ADR-081 の `ConvergenceBySweetSpot`（一意の最適解は存在せず、
実データ較正で領域を獲得する）と同じもので、既定値の獲得はその小さな一例である。

このディレクトリは、その探索の**手順**と**記録**を置く。GSN 木
`docs/gsn/profit-growth.gsn` の枝 `DefaultsAreAcceptableToPractitioner` の証拠がここに育つ。

## 環境の起動

フルスタック 3 プロセス（コアAPI → BFF → vite）を 1 コマンドで:

```bash
pnpm dev:stack
```

初回のみ、依存の用意が要る:

```bash
pnpm install
cd core && uv sync --extra dev --extra serve
```

起動後のポート:

| プロセス | URL | 役割 |
|---------|-----|------|
| vite | http://localhost:5173/easy-extrude/ | ブラウザ 3D エディタ（触る場所） |
| BFF | http://localhost:3001 | 契約検証 + 転送（`POST /api/grasp/search`） |
| コアAPI | http://127.0.0.1:4001 | 判定エンジン（`POST /grasp-search`） |

`pnpm dev:all` は BFF + vite だけでコアAPI を上げないため、grasp-search は 503 になる。
grasp を触る探索では `dev:stack` を使う。

コンテナや別マシンのブラウザから触る場合は vite を LAN に出す必要がある。`dev:stack` の
既定は localhost バインド（露出はユーザの明示的な選択にする）なので、露出版を使う:

```bash
pnpm dev:stack:host   # vite だけ --host 付き。BFF とコアAPI は localhost のまま
```

UI を介さず経路だけ確認したいときは、正本テンプレを直接投げるのが最短:

```bash
curl -s -X POST http://127.0.0.1:3001/api/grasp/search \
  -H 'Content-Type: application/json' \
  --data @templates/bin-picking-thin-container/grasp-search.request.json
```

## 探索の進め方（1 セッション = 1 記録ファイル）

1. `pnpm dev:stack` で起動し、ブラウザで Home → Context → grasp-search を通す。
2. **入力のたびに「なぜその値にしたか」を書き留める。** 値そのものより、値を選んだ
   ときの根拠が既定値の設計材料になる（根拠が「なんとなく」なら、それは既定値に
   してよい値である可能性が高い — ユーザが考えずに通せる値だから）。
3. 詰まった箇所は**詰まった事実として**記録する。回避策を見つけて先に進めた場合も、
   回避策ではなく詰まりを記録する（回避できたことは改善不要の証拠にならない）。
4. 記録は `YYYY-MM-DD-<主題>.md` として下記の様式で置く。

## 記録の様式

各セッションのファイルは次の 4 節を持つ。様式を固定するのは、複数セッションの記録を
後で突き合わせて既定値を決めるため（自由記述だと突き合わせられない）。

```markdown
# YYYY-MM-DD — <主題>

## 環境
コミット / 起動コマンド / 触った画面

## 獲得した値（既定値候補）
| 対象 | 入れた値 | なぜその値にしたか | 既定値にしてよいか |
|------|---------|------------------|-----------------|

## 詰まり（改善候補）
| どこで | 何が起きた／何が分からなかった | 期待した挙動 |
|--------|---------------------------|------------|

## 判定結果
grasp-search が返した内容と、それを見て考えを変えた点
```

「獲得した値」の表がそのまま `createDefaultCellDoc()` の中身になり、「詰まり」の表が
次イテレーションの改善対象になる。どちらの列も空欄のまま残すことを許す — 埋まらなかった
という事実自体が記録である。
